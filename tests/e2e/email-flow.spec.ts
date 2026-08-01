import type { APIRequestContext } from '@playwright/test'

import { expect, test } from './fixtures'

// Full email round-trips against the Mailpit catcher (SMTP 1025 / API 8025),
// which the e2e web server is pointed at (playwright.config `webServer.env`).
// These skip themselves when Mailpit isn't reachable, so a local run without
// `pnpm docker:mail` still passes the rest of the suite.

const MAILPIT = 'http://127.0.0.1:8025'

/** Poll Mailpit for the newest message to `address` and return a link from its
 *  text body matching `linkRe`. */
async function waitForEmailLink(
  request: APIRequestContext,
  address: string,
  linkRe: RegExp,
): Promise<string> {
  // 60 × 500ms = 30s. The previous 9s deadline was tight enough to flake when
  // the suite runs in parallel and SMTP delivery queues behind other tests.
  // `limit` keeps the target message in the page once a dev Mailpit has
  // accumulated mail from earlier runs.
  for (let i = 0; i < 60; i++) {
    const list = await request.get(`${MAILPIT}/api/v1/messages?limit=200`)
    const { messages = [] } = (await list.json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
    }
    const msg = messages.find((m) =>
      (m.To ?? []).some(
        (t) => t.Address?.toLowerCase() === address.toLowerCase(),
      ),
    )
    if (msg) {
      const full = await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)
      const { Text = '' } = (await full.json()) as { Text?: string }
      const match = Text.match(linkRe)
      if (match) return match[0]
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No email link matching ${linkRe} for ${address}`)
}

test.beforeEach(async ({ request }) => {
  let up = false
  try {
    up = (await request.get(`${MAILPIT}/readyz`)).ok()
  } catch {
    up = false
  }
  test.skip(!up, 'Mailpit not reachable — run `pnpm docker:mail`')
  // Start each test from an empty mailbox so we match our own message.
  await request.delete(`${MAILPIT}/api/v1/messages`)
})

async function register(page: import('@playwright/test').Page, email: string) {
  await page.goto('/register')
  await page.getByLabel('Name').fill('Email RT')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('email verification: register → emailed link → verified', async ({
  page,
  request,
}) => {
  const email = `verify-rt+${Date.now()}@example.com`
  await register(page, email)

  const link = await waitForEmailLink(
    request,
    email,
    /https?:\/\/[^\s]+\/verify-email\?[^\s]+/,
  )
  await page.goto(link)
  await expect(page.getByText(/email verified/i)).toBeVisible()
})

test('password reset: request → emailed link → new password → sign in', async ({
  page,
  request,
}) => {
  const email = `reset-rt+${Date.now()}@example.com`
  const newPassword = 'NewPass456'

  // Create a credentials account (has a password to reset), then sign out.
  await register(page, email)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Request the reset — always the same anti-enumeration message.
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(
    page.getByText(/we've sent a password reset link/i),
  ).toBeVisible()

  // Follow the emailed link and set a new password.
  const link = await waitForEmailLink(
    request,
    email,
    /https?:\/\/[^\s]+\/reset-password\?[^\s]+/,
  )
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page).toHaveURL(/\/login/)

  // The new password works.
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
})

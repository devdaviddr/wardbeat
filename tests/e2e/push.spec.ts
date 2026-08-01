import { config } from 'dotenv'

import { expect, test, openSettingsTab } from './fixtures'

// Playwright only forwards env to the webServer, not to the test process, so
// read `.env` here to learn what the app under test was actually started with.
config({ path: '.env' })

// Actual push delivery needs VAPID keys, HTTPS, and a real push service, so the
// subscribe→deliver round-trip is verified manually (see spec 0015). Here we
// assert the panel's visibility matches whether push is configured.
//
// Both states are legitimate: a bare checkout has no VAPID keys, while an
// environment that has generated a pair (as v0.10.0's notification work needs)
// does. Asserting only the unconfigured case made the suite fail the moment
// someone configured push — which is a passing feature, not a regression.

const pushConfigured = Boolean(process.env.VAPID_PUBLIC_KEY)

test('the notifications panel tracks whether push is configured', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')

  const panel = page.getByText(/get push notifications/i)
  if (pushConfigured) {
    // Configured: the panel is offered, and the feature is not inert.
    await expect(panel.first()).toBeVisible()
  } else {
    // Unconfigured: the feature must be entirely absent, not merely disabled.
    await expect(panel).toHaveCount(0)
  }
})

import { expect, test } from './fixtures'

/**
 * End-to-end smoke test of the auth flow. Requires a running app and a
 * migrated database (see README → Testing). Registers a unique user, lands on
 * the dashboard, signs out, and signs back in.
 */
test('register → dashboard → sign out → sign in', async ({ page }) => {
  const email = `e2e+${Date.now()}@example.com`
  const password = 'Password123'

  // Register
  await page.goto('/register')
  await page.getByLabel('Name').fill('E2E User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
  // `/dashboard` has been the ward board since v0.6.0, so the signed-in email
  // lives only in the app-shell topbar, not in `main`. Assert both: the right
  // identity, and that the board itself actually rendered.
  await expect(page.getByRole('banner').getByText(email)).toBeVisible()
  await expect(page.getByRole('main')).toContainText(/occupied/i)

  // Sign out
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Sign back in
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
})

test('protected route redirects unauthenticated users to login', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

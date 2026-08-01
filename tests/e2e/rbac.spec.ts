import { expect, test, openSettingsTab } from './fixtures'

// RBAC: relies on the seeded admin (demo@example.com / Password123).

test('a non-admin user does not see the admin panel', async ({ page }) => {
  const email = `noadmin+${Date.now()}@example.com`

  // Register a fresh user (gets no roles) — lands on the dashboard.
  await page.goto('/register')
  await page.getByLabel('Name').fill('No Admin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await expect(page.getByText('Current User')).toBeVisible()
  // Settings is tabbed (v0.8.0), so the gate is now the tab itself: a
  // non-admin must not be offered Administration at all, and its contents must
  // be unreachable.
  await expect(page.getByRole('tab', { name: 'Administration' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add User' })).toHaveCount(0)
})

test('an admin invites a user who then claims the account', async ({
  page,
}) => {
  // Sign in as the seeded admin.
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Administration')
  await expect(page.getByRole('button', { name: 'Add User' })).toBeVisible()

  const email = `invited+${Date.now()}@example.com`
  await page.getByRole('button', { name: 'Add User' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('Ada Lovelace').fill('Invited User')
  await dialog.getByPlaceholder('user@example.com').fill(email)
  await dialog
    .locator('label')
    .filter({ hasText: /^member$/ })
    .getByRole('checkbox')
    .click()
  await dialog.getByRole('button', { name: 'Create' }).click()

  // The one-time invite link is shown; wait for that view, grab it, then finish.
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible()
  const inviteUrl = await dialog.getByRole('textbox').inputValue()
  expect(inviteUrl).toContain('/register?invite=')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText(email)).toBeVisible() // now in the table

  // The invited user (fresh session) claims the account via the link.
  await page.context().clearCookies()
  await page.goto(inviteUrl)
  await page.getByLabel('Name').fill('Invited User')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
})

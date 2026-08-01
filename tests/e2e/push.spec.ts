import { expect, test, openSettingsTab } from './fixtures'

// Actual push delivery needs VAPID keys, HTTPS, and a real push service, so the
// subscribe→deliver round-trip is verified manually (see spec 0015). Here we
// assert the feature is fully inert when unconfigured (the default test env).

test('notifications panel is hidden when push is not configured', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')
  // The panel only renders when the server passes a VAPID public key.
  await expect(page.getByText(/get push notifications/i)).toHaveCount(0)
})

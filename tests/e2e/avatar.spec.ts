import { expect, test, openSettingsTab } from './fixtures'

// Profile photo upload (spec 0018): built on the same storage/ownership
// machinery as general file uploads (spec 0007), so these tests focus on
// what's specific to avatars — replace-swaps-the-old-object, the narrower
// image-only allow-list, and the immediate session refresh via update().

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('upload, replace, and remove a profile photo', async ({ page }) => {
  const email = `avatar+${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel('Name').fill('Avatar Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Account')
  // No photo yet — fallback initials render ("AT" for "Avatar Tester"),
  // "Remove" isn't offered because there's nothing to remove.
  await expect(page.getByText('AT', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0)

  // Upload the first photo. Scoped to <main> — the app shell topbar has its
  // own avatar with the same alt text, checked separately below.
  await page.getByLabel('Upload profile photo').setInputFiles({
    name: 'first.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  const firstImg = page
    .getByRole('main')
    .locator('img[alt="Avatar Tester"]')
    .first()
  await expect(firstImg).toBeVisible()
  const firstSrc = await firstImg.getAttribute('src')
  expect(firstSrc).toBeTruthy()

  // Replace with a second photo — the old object is deleted, not just
  // unlinked (verified by re-fetching the old href once the swap lands).
  await page.getByLabel('Upload profile photo').setInputFiles({
    name: 'second.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  await expect(async () => {
    const src = await firstImg.getAttribute('src')
    expect(src).not.toBe(firstSrc)
  }).toPass()
  const oldRes = await page.request.get(firstSrc!)
  expect(oldRes.status()).toBe(404)

  // The app shell topbar reflects the same photo, without a reload/re-login.
  const shellAvatar = page.locator('header img[alt="Avatar Tester"]')
  await expect(shellAvatar).toBeVisible()

  // Remove it — back to fallback initials everywhere, object gone.
  const secondSrc = await firstImg.getAttribute('src')
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('AT', { exact: true }).first()).toBeVisible()
  await expect(page.locator('img[alt="Avatar Tester"]')).toHaveCount(0)
  const removedRes = await page.request.get(secondSrc!)
  expect(removedRes.status()).toBe(404)
})

test('serves the avatar with cacheable, immutable headers (no flash on refresh)', async ({
  page,
}) => {
  const email = `avatar-cache+${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel('Name').fill('Cache Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Account')
  await page.getByLabel('Upload profile photo').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  const img = page.getByRole('main').locator('img[alt="Cache Tester"]').first()
  await expect(img).toBeVisible()
  const href = await img.getAttribute('src')
  expect(href).toBeTruthy()

  // Unlike general file downloads (no-store), the avatar is privately
  // cacheable and immutable — this is what stops the browser re-fetching it
  // on every refresh and flashing the fallback initials.
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  const cacheControl = res.headers()['cache-control']
  expect(cacheControl).toContain('private')
  expect(cacheControl).toContain('immutable')
  expect(cacheControl).not.toContain('no-store')
})

test('rejects a non-image file with a clear error (PDF is fine for general uploads, not avatars)', async ({
  page,
}) => {
  const email = `avatar-reject+${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel('Name').fill('Reject Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Account')
  await page.getByLabel('Upload profile photo').setInputFiles({
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 not a real pdf'),
  })

  await expect(page.getByText(/isn't allowed/)).toBeVisible()
  await expect(page.locator('img[alt="Reject Tester"]')).toHaveCount(0)
})

test('deleting a user also removes their profile photo', async ({ page }) => {
  const emailE = `avatar-e+${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Name').fill('User E')
  await page.getByLabel('Email').fill(emailE)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Account')
  await page.getByLabel('Upload profile photo').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  const img = page.locator('img[alt="User E"]').first()
  await expect(img).toBeVisible()
  const href = await img.getAttribute('src')
  expect(href).toBeTruthy()

  // Admin deletes the user.
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Administration')
  const row = page.getByRole('row').filter({ hasText: emailE })
  await row.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(emailE)).toHaveCount(0)

  const res = await page.request.get(href!)
  expect(res.status()).toBe(404)
})

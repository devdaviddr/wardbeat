import { expect, test, openSettingsTab } from './fixtures'

// File uploads (spec 0007): a fresh user uploads, lists, downloads, and
// deletes a file, and can't reach another user's file by guessing its id.

test('upload, list, download, and delete a file', async ({ page }) => {
  const email = `files+${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel('Name').fill('Files Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')
  await expect(page.getByText('My Files')).toBeVisible()
  await expect(page.getByText('No files uploaded yet.')).toBeVisible()

  const fileName = `test-${Date.now()}.png`
  await page.getByLabel('Upload a file').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    // Minimal valid 1x1 PNG.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })

  await expect(page.getByText(fileName)).toBeVisible()
  await expect(page.getByText('No files uploaded yet.')).toHaveCount(0)

  // Download: the link resolves and streams the object back with the right type.
  const downloadLink = page.getByRole('link', {
    name: `Download ${fileName}`,
  })
  const href = await downloadLink.getAttribute('href')
  expect(href).toBeTruthy()
  const downloadRes = await page.request.get(href!)
  expect(downloadRes.ok()).toBeTruthy()
  expect(downloadRes.headers()['content-type']).toContain('image/png')
  // General file downloads stay uncached (only avatars are cacheable — see
  // avatar.spec.ts). Guards the avatar-scoped cache-control logic.
  expect(downloadRes.headers()['cache-control']).toContain('no-store')

  // Delete: confirm via the dialog, file disappears from the list.
  await page.getByRole('button', { name: `Delete ${fileName}` }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(fileName)).toHaveCount(0)
  await expect(page.getByText('No files uploaded yet.')).toBeVisible()
})

test('downloads a file whose name contains non-Latin-1 characters', async ({
  page,
}) => {
  // Regression: a filename with a char above 0xFF (e.g. the U+202F narrow
  // no-break space macOS puts in screenshot names) used to 500 the download
  // route, because the Content-Disposition `filename="..."` value can't hold
  // a non-ByteString character. All the other tests use plain-ASCII names, so
  // they never caught it.
  const email = `files-unicode+${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel('Name').fill('Unicode Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')
  // Mimic a real macOS screenshot name: "... 12.01.47<U+202F>pm.png".
  const nbsp = String.fromCharCode(0x202f)
  const fileName = `Screenshot 2026-06-20 at 12.01.47${nbsp}pm.png`
  await page.getByLabel('Upload a file').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })

  const href = await page
    .getByRole('link', { name: `Download ${fileName}` })
    .getAttribute('href')
  expect(href).toBeTruthy()

  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('image/png')
  // The modern RFC 5987 param carries the real, percent-encoded name.
  expect(res.headers()['content-disposition']).toContain("filename*=UTF-8''")
})

test('rejects a disallowed file type with a clear error', async ({ page }) => {
  const email = `files-reject+${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel('Name').fill('Reject Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')
  await page.getByLabel('Upload a file').setInputFiles({
    name: 'not-allowed.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('not a real executable'),
  })

  await expect(page.getByText(/isn't allowed/)).toBeVisible()
  await expect(page.getByText('No files uploaded yet.')).toBeVisible()
})

test("a user cannot download another user's file", async ({
  page,
  request,
}) => {
  // User A uploads a file.
  const emailA = `files-a+${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Name').fill('User A')
  await page.getByLabel('Email').fill(emailA)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')
  const fileName = `private-${Date.now()}.png`
  await page.getByLabel('Upload a file').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.getByText(fileName)).toBeVisible()
  const href = await page
    .getByRole('link', { name: `Download ${fileName}` })
    .getAttribute('href')
  expect(href).toBeTruthy()

  // Anonymous request (no session cookie) must not be able to fetch it.
  const anonRes = await request.get(href!)
  expect(anonRes.status()).toBe(401)

  // A different, signed-in user must not be able to fetch it either — the
  // ownership check, not just an auth check, is what's under test here.
  await page.context().clearCookies()
  const emailB = `files-b+${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Name').fill('User B')
  await page.getByLabel('Email').fill(emailB)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  const crossUserRes = await page.request.get(href!)
  expect(crossUserRes.status()).toBe(404)
})

test("deleting a user removes their uploaded files' download access", async ({
  page,
}) => {
  // Target user uploads a file.
  const emailD = `files-d+${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Name').fill('User D')
  await page.getByLabel('Email').fill(emailD)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Files & notifications')
  const fileName = `to-be-cascaded-${Date.now()}.png`
  await page.getByLabel('Upload a file').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.getByText(fileName)).toBeVisible()
  const href = await page
    .getByRole('link', { name: `Download ${fileName}` })
    .getAttribute('href')
  expect(href).toBeTruthy()

  // Admin deletes the user via the admin panel.
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  await openSettingsTab(page, 'Administration')
  const row = page.getByRole('row').filter({ hasText: emailD })
  await row.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(emailD)).toHaveCount(0)

  // The FK cascade removed the `files` row — the route 404s (same response
  // shape as "not found") for anyone, admin included, once the row is gone.
  const res = await page.request.get(href!)
  expect(res.status()).toBe(404)
})

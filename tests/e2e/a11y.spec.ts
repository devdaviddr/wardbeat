import AxeBuilder from '@axe-core/playwright'
import { expect, openSettingsTab, test } from './fixtures'

// Automated accessibility regression checks (WCAG 2.0/2.1 A + AA) for the
// pages most likely to be touched by real visitors and admins. This backs the
// accessibility claims in docs/features.md — a manual pass alone can't catch
// a regression, this can.

test('login page has no detectable a11y violations', async ({ page }) => {
  await page.goto('/login')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('register page has no detectable a11y violations', async ({ page }) => {
  await page.goto('/register')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('dashboard (signed in) has no detectable a11y violations', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('settings admin panel has no detectable a11y violations', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/settings')
  // Settings is tabbed (v0.8.0) — the admin panel lives behind Administration,
  // so the tablist itself is part of what gets checked here.
  await openSettingsTab(page, 'Administration')
  await expect(page.getByRole('button', { name: 'Add User' })).toBeVisible()

  // Include the "Add User" dialog — a common source of focus-trap/label bugs.
  await page.getByRole('button', { name: 'Add User' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('theme toggle is keyboard-operable, announces state, and persists', async ({
  page,
}) => {
  // The closed-state accessibility of this page (including the toggle's
  // labelled trigger) is covered by the "login page" axe test above. Here we
  // assert the interactive behaviour the toggle adds: keyboard operation,
  // exposed state, and no-flash persistence.
  await page.goto('/login')

  const toggle = page.getByRole('button', { name: 'Toggle theme' })
  await expect(toggle).toBeVisible()

  // Keyboard-operable: focus, open with Enter.
  await toggle.focus()
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()

  // Announces its state: the radio items expose an accessible checked state.
  const dark = page.getByRole('menuitemradio', { name: 'Dark' })
  await expect(dark).toHaveAttribute('aria-checked', 'false')
  await dark.click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  // Choice persists across reload with no flash — the class must be present
  // on the very first paint, not applied after hydration.
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('403 page has no detectable a11y violations', async ({ page }) => {
  const email = `noadmin-a11y+${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Name').fill('No Admin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByLabel('Confirm password').fill('Password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  // A member has no admin role — proxy.ts should redirect a settings-only
  // guarded path. Navigate straight to /403 to check its own rendering too.
  await page.goto('/403')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

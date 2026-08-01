import { test as base, expect } from '@playwright/test'

// Every test gets a UNIQUE client IP via X-Forwarded-For. The app derives the
// rate-limit key from that header (`clientIpFromHeaders`), and registration is
// keyed by IP alone — so without this, every test shares one `register:::1`
// bucket that accumulates across the suite and trips under CI retries (the
// historical source of e2e flakiness). A distinct IP per test = an isolated
// bucket, so rate limits only fire within a test that deliberately provokes
// them (see auth-errors.spec.ts). The worker index is folded in so parallel
// workers can't collide.
let seq = 0

export const test = base.extend({
  extraHTTPHeaders: async ({}, use, testInfo) => {
    const n = ++seq
    const ip = `10.${testInfo.workerIndex & 255}.${(n >> 8) & 255}.${n & 255}`
    // `use` here is Playwright's fixture callback, not React's `use` hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use({ 'x-forwarded-for': ip })
  },
})

export { expect }

/** The tabs `/settings` is split into (v0.8.0). */
export type SettingsTab =
  'Account' | 'Files & notifications' | 'System' | 'Administration'

/**
 * Select a tab on `/settings`.
 *
 * Since v0.8.0 the settings page is tabbed, so anything below Account —
 * files, push, build info, the admin panel — is not in the DOM until its tab is
 * chosen. The tablist is a client component, so a click that lands before
 * hydration is silently dropped; retry until the tab actually reports itself
 * selected rather than assuming the first click took.
 */
export async function openSettingsTab(
  page: import('@playwright/test').Page,
  name: SettingsTab,
): Promise<void> {
  const tab = page.getByRole('tab', { name })
  await expect(tab).toBeVisible()
  await expect(async () => {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true', {
      timeout: 1000,
    })
  }).toPass({ timeout: 15_000 })
}

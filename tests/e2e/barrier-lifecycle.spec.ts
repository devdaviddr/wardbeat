import { expect, test } from './fixtures'

/**
 * The journey v0.10.0 exists to make possible: find a blocked discharge, take
 * ownership of it, record progress, and finish it — with the ward's open count
 * actually going down. Before this release the last two steps did not exist.
 *
 * Relies on the seeded admin (demo@example.com / Password123) and on
 * `pnpm db:seed:ward` + an extraction run having produced barriers.
 */

// The suite is `fullyParallel`, but these tests all mutate the same seeded
// ward — one clears a barrier while another is reading the same bed. Run them
// in order so they don't contend over shared clinical state.
test.describe.configure({ mode: 'serial' })

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

/** Opens the first bed that has at least one open barrier. */
async function openBedWithBarrier(page: import('@playwright/test').Page) {
  const card = page
    .getByRole('button')
    .filter({ hasText: /\d+ barriers?/ })
    .first()
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('the board says when the notes were last read', async ({ page }) => {
  await signIn(page)
  // Freshness is what lets staff judge how much to trust the board.
  await expect(page.getByText(/Notes (last read|not yet read)/i)).toBeVisible()
})

test('a clinician assigns, comments on, and clears a barrier', async ({
  page,
}) => {
  await signIn(page)
  await openBedWithBarrier(page)

  // Scope to ONE barrier record — a bed can hold several, and mixing `.first()`
  // across separate locators can target different rows.
  const barrier = page.getByRole('dialog').getByRole('listitem').first()
  const note = `Pharmacy says 4pm ${Date.now()}`

  // Assign it to someone — the picker lists registered users.
  await barrier.locator('select').selectOption({ index: 1 })
  await expect(barrier.getByText(/Owner:/)).toBeVisible()

  // Record progress. This is the thread that survives re-extraction.
  await barrier.getByPlaceholder('Add a progress note…').fill(note)
  const noteButton = barrier.getByRole('button', { name: 'Note' })
  await expect(noteButton).toBeEnabled()
  await noteButton.click()
  await expect(barrier.getByText(note)).toBeVisible({ timeout: 10_000 })

  // Clearing demands a reason.
  await barrier.getByRole('button', { name: 'Mark cleared' }).click()
  const reason = barrier.getByPlaceholder('How was it resolved?')
  await expect(reason).toBeVisible()
  await reason.fill('TTOs collected')
  await barrier.getByRole('button', { name: 'Confirm' }).click()

  // The barrier leaves the open board — the count finally goes down.
  await expect(page.getByRole('dialog').getByText(note)).toHaveCount(0, {
    timeout: 10_000,
  })
})

test('a clinician can raise a barrier the extraction missed', async ({
  page,
}) => {
  await signIn(page)
  await openBedWithBarrier(page)

  // Unique per run — the barrier is real data that persists, so a fixed string
  // would collide with every previous run of this test.
  const description = `Family meeting needed ${Date.now()}`

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Add barrier' }).click()
  await dialog
    .getByPlaceholder('What is holding this discharge up?')
    .fill(description)
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()

  // The text appears twice by design — once as the barrier, once in its
  // "raised" event — so match the barrier body exactly.
  await expect(dialog.getByText(description, { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await expect(dialog.getByText('Added by a clinician').first()).toBeVisible()
  // And it must be attributed in the thread.
  await expect(dialog.getByText(/raised:/).first()).toBeVisible()
})

test('the estimated discharge date can be overridden by hand', async ({
  page,
}) => {
  await signIn(page)
  await openBedWithBarrier(page)

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /^(Set|Change)$/ }).click()
  await dialog.locator('input[type="date"]').fill('2026-09-15')
  await dialog.getByRole('button', { name: 'Save' }).click()

  // The board must say the date is a clinician's, not the model's.
  await expect(dialog.getByText(/Set by/)).toBeVisible({ timeout: 10_000 })
})

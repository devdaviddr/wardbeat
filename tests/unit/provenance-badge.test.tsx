import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProvenanceBadge } from '@/components/ward/provenance-badge'

/**
 * The release's user-facing promise: a non-live answer is visually distinct and
 * never shows the green grounded badge. These assert the badge cannot regress
 * into claiming grounding for output no model produced.
 */
describe('ProvenanceBadge', () => {
  it('shows the grounded marker for a live, grounded answer', () => {
    render(<ProvenanceBadge provenance="live" grounded />)
    expect(screen.getByText(/● grounded/)).toBeTruthy()
  })

  it('shows no-support for a live answer nothing supports', () => {
    render(<ProvenanceBadge provenance="live" grounded={false} />)
    expect(screen.getByText(/○ no support/)).toBeTruthy()
  })

  it('never shows a grounded badge for a mock answer', () => {
    render(<ProvenanceBadge provenance="mock" grounded />)
    expect(screen.queryByText(/grounded/)).toBeNull()
    expect(screen.getByText(/not model-generated/)).toBeTruthy()
  })

  it('never shows a grounded badge for a fallback answer', () => {
    render(<ProvenanceBadge provenance="fallback" grounded />)
    expect(screen.queryByText(/grounded/)).toBeNull()
    expect(screen.getByText(/model unavailable/)).toBeTruthy()
  })

  it('distinguishes fallback from mock, not just from live', () => {
    const { container: mock } = render(
      <ProvenanceBadge provenance="mock" grounded={false} />,
    )
    const { container: fallback } = render(
      <ProvenanceBadge provenance="fallback" grounded={false} />,
    )
    expect(mock.textContent).not.toBe(fallback.textContent)
    expect(fallback.querySelector('[data-provenance="fallback"]')).toBeTruthy()
  })

  it('honours per-surface wording for the recommendation card', () => {
    render(
      <ProvenanceBadge
        provenance="live"
        grounded
        groundedLabel="policy-grounded"
      />,
    )
    expect(screen.getByText(/● policy-grounded/)).toBeTruthy()
  })

  it('falls back to the grounded pair when provenance is unknown', () => {
    // Stored recommendations have no provenance column yet — the badge must
    // degrade rather than assert something it cannot know.
    render(<ProvenanceBadge grounded />)
    expect(screen.getByText(/● grounded/)).toBeTruthy()
  })
})

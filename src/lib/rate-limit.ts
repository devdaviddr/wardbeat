/**
 * Minimal in-memory rate limiter (fixed window).
 *
 * Good enough for a single instance. For serverless or multi-instance
 * deployments, swap the store for a shared backend such as
 * `@upstash/ratelimit` — keep the `rateLimit()` signature and only the storage
 * changes.
 *
 * NOTE: this limits per key. Login attempts are limited twice: per IP+email
 * (brute force against one account) and globally per IP (`loginPerIp` —
 * credential stuffing across many accounts from one source). Registrations
 * are keyed by IP.
 */
export interface RateLimitResult {
  success: boolean
  remaining: number
  /** Epoch ms when the current window resets. */
  resetAt: number
}

interface Bucket {
  count: number
  resetAt: number
}

const store = new Map<string, Bucket>()

export const AUTH_LIMITS = {
  login: { limit: 8, windowMs: 10 * 60_000 },
  // Global per-IP cap across ALL accounts — blunts credential stuffing while
  // still allowing a handful of users behind one NAT to mistype passwords.
  loginPerIp: { limit: 50, windowMs: 10 * 60_000 },
  register: { limit: 20, windowMs: 10 * 60_000 },
} as const

export const UPLOAD_LIMITS = {
  upload: { limit: 20, windowMs: 10 * 60_000 },
} as const

/**
 * Per-user limits on the AI-backed server actions (spec v0.12.0 M5). These
 * paths are authenticated, so the key is the user id — never the IP, which
 * would conflate every user behind one hospital NAT.
 *
 * Budget arithmetic — the hosted NIM free tier allows ~40 RPM and the `ai`
 * service self-throttles at NIM_RPM=30 (ai/app/settings.py), so ~30 RPM is
 * the shared budget one user must not be able to exhaust alone:
 *
 * - copilot: ~3 NIM calls per question (route + retrieval embed/rerank +
 *   answer). 6/min → worst case ≤ 18 calls/min from one user.
 * - briefing: ≤ 2 NIM calls per generate (forecasts are deterministic; the
 *   narration is the model call). 6 per 5 min → ≤ 12 calls/5 min ≈ 2.4 RPM.
 * - generate: ~2 NIM calls per delayed patient (policy retrieval + recommend);
 *   a full ~24-bed ward ≈ 48 calls per run. 2 runs per 10 min ≈ ≤ 10 RPM
 *   sustained — the burst inside a run is smoothed by the AI plane's own
 *   token bucket.
 *
 * Worst-case sustained total ≈ 18 + 2.4 + 10 ≈ 30 RPM — one user can at most
 * saturate the budget briefly, not starve it indefinitely, and the fixed
 * windows mean the pressure clears within minutes.
 */
export const AI_LIMITS = {
  copilot: { limit: 6, windowMs: 60_000 },
  briefing: { limit: 6, windowMs: 5 * 60_000 },
  generate: { limit: 2, windowMs: 10 * 60_000 },
} as const

/** User-facing refusal for a rate-limited AI action (CLAUDE.md: expected
 *  failures are returned, never thrown). */
export const AI_RATE_LIMIT_MESSAGE =
  'Too many requests — try again in a moment.'

/** Disable in environments (e.g. certain test runs) via env. */
const DISABLED = process.env.RATE_LIMIT_DISABLED === 'true'

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (DISABLED)
    return { success: true, remaining: limit, resetAt: now + windowMs }

  const existing = store.get(key)

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    // Opportunistic cleanup so the map can't grow unbounded.
    if (store.size > 10_000) {
      for (const [k, v] of store) if (v.resetAt <= now) store.delete(k)
    }
    return { success: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  if (existing.count >= limit) {
    return { success: false, remaining: 0, resetAt: existing.resetAt }
  }

  existing.count += 1
  return {
    success: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  }
}

/** Test helper — clear one key or the whole store. */
export function resetRateLimit(key?: string): void {
  if (key) store.delete(key)
  else store.clear()
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving
 * input order in the results. A lightweight `p-limit` — enough for fanning out
 * bounded, rate-limited I/O (e.g. AI extraction calls) without a dependency.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const size = Math.max(1, Math.min(limit, items.length))

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()))
  return results
}

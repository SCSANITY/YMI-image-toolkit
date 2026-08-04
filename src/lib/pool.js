/**
 * Run `worker` over `items` with at most `size` in flight.
 * Resolves once every item has been handled; `worker` is expected to swallow its own errors.
 */
export async function runPool(items, size, worker) {
  let cursor = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
}

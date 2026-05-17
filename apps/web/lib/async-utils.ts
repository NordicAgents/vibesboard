/**
 * Limits the concurrency of async operations.
 *
 * @param items The items to process.
 * @param concurrency The maximum number of concurrent operations.
 * @param fn The async function to execute for each item.
 */
export async function limitConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
) {
  const executing: Promise<void>[] = []
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.splice(executing.indexOf(p), 1)
    })
    executing.push(p)
    if (executing.length >= concurrency) {
      await Promise.race(executing)
    }
  }
  await Promise.all(executing)
}

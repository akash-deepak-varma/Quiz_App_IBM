/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order in the result.
 *
 * Hand-rolled rather than pulling in p-limit: it is fifteen lines, the project has no other
 * concurrency dependency, and order preservation matters to both call sites -- generation batches
 * map onto question slots, and submission grading maps onto `answerLogs` rows.
 *
 * If `fn` rejects, this rejects with the first rejection. Every worker promise is already awaited
 * by `Promise.all`, so in-flight work cannot become an unhandled rejection.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [...items];
  if (list.length === 0) return [];

  const results = new Array(list.length);
  const workers = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let next = 0;

  async function run() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, run));
  return results;
}

/** Exponential backoff with full jitter, so concurrent batches do not retry in lockstep. */
export function backoffDelayMs(attempt, baseMs = 500, capMs = 8000) {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(Math.random() * ceiling);
}

export function sleep(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

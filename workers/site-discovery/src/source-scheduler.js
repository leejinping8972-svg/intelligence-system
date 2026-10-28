const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// All collectors in the API process share these lanes. Deployment keeps the
// existing runner guards, so an old/new process cannot collect concurrently.
const key = Symbol.for('intelligence.source-lanes.v1');
const lanes = (globalThis[key] ||= new Map());
export function sourceLane(source, intervalMs = 1000) {
  if (!lanes.has(source))
    lanes.set(source, { tail: Promise.resolve(), nextAt: 0, intervalMs });
  return lanes.get(source);
}
export async function scheduleSource(source, callback, options = {}) {
  const lane = sourceLane(source, options.intervalMs);
  const previous = lane.tail;
  let release;
  lane.tail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const wait = Math.max(0, lane.nextAt - Date.now());
    if (wait) await sleep(wait);
    const result = await callback();
    if (result?.status === 429)
      lane.nextAt =
        Date.now() +
        Math.max(
          60_000,
          (Number(result.headers?.get?.('retry-after')) || 0) * 1000,
        );
    return result;
  } catch (error) {
    if (error.status === 429)
      lane.nextAt =
        Date.now() + Math.max(60_000, (error.retryAfterSeconds || 0) * 1000);
    throw error;
  } finally {
    lane.nextAt = Math.max(
      lane.nextAt,
      Date.now() + (options.intervalMs ?? lane.intervalMs),
    );
    release();
  }
}
export async function parallelItems(items, limit, callback) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) await callback(items[cursor++]);
    },
  );
  const results = await Promise.allSettled(workers);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export function scheduledFetch(url, options) {
  const host = new URL(
    typeof url === 'string' || url instanceof URL ? url : url.url,
  ).hostname
    .toLowerCase()
    .replace(/^www\./, '');
  const source =
    host === 'mcp.sorftime.com'
      ? 'sorftime'
      : host === 'api.search.brave.com'
        ? 'brave'
        : 'site:' + host;
  return scheduleSource(source, () => fetch(url, options));
}

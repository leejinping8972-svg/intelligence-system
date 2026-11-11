const checkpoints = new WeakMap();
export function beginTrendTiming(io, cp) {
  cp.timings ||= {};
  const requested = Number(cp.nextRunAt);
  if (requested > 0 && requested <= io.now()) {
    cp.timings.lastQueueMs = io.now() - requested;
    cp.timings.queueMs = (cp.timings.queueMs || 0) + cp.timings.lastQueueMs;
  }
  if (Number.isFinite(io.schedulingMs))
    cp.timings.lastSchedulingMs = io.schedulingMs;
}
export async function saveTrendCheckpoint(io, job, cp, status) {
  let cache = checkpoints.get(io.saveCheckpoint);
  if (!cache) {
    cache = new Map();
    checkpoints.set(io.saveCheckpoint, cache);
  }
  const previous = cache.get(job.id);
  if (previous) {
    cp.timings ||= {};
    cp.timings.lastCheckpointMs = previous.ms;
    cp.timings.checkpointMeasuredAt = previous.at;
  }
  const started = performance.now();
  const result = await io.saveCheckpoint(job, cp, status);
  cache.delete(job.id);
  cache.set(job.id, {
    ms: performance.now() - started,
    at: new Date(io.now()).toISOString(),
  });
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return result;
}

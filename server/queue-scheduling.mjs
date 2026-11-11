// Called only under the existing runner lease. Scheduling stays serial, while
// normal page continuations avoid re-reading every plan on every queue turn.
export function createQueueScheduling(
  tasks,
  { now = Date.now, intervalMs = 30_000 } = {},
) {
  let nextAt = 0;
  return async () => {
    if (now() < nextAt) return 0;
    const started = now();
    for (const task of tasks) await task();
    nextAt = now() + intervalMs;
    return Math.max(0, now() - started);
  };
}

// A dependency becomes runnable as soon as its collector finishes or is
// cancelled. No polling task and no extra wake-up write/lease are needed.
export const ingredientDependencyFilter = (sql) => `NOT EXISTS (
  SELECT 1 FROM research_jobs ingredient_dependency
  WHERE ${sql('ingredient_dependency.id::text', 'ingredient_dependency.id')}=${sql("research_jobs.checkpoint->>'waitingForCollectionId'", "JSON_UNQUOTE(JSON_EXTRACT(research_jobs.checkpoint,'$.waitingForCollectionId'))")}
  AND ingredient_dependency.status IN ('queued','running') AND ingredient_dependency.cancelled=false
)`;

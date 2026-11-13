import { setTimeout as sleep } from 'node:timers/promises';

export async function waitForAdvisoryLock(connection, engine, key, waitMs) {
  if (!Number.isFinite(waitMs) || waitMs <= 0 || waitMs > 90_000)
    throw new RangeError('Lock wait must be between 0 and 90000 milliseconds');
  if (engine === 'mysql') {
    // Register a server-side waiter so the next index batch cannot keep winning
    // the short gaps between release and reacquisition.
    const { rows } = await connection.query(
      'SELECT GET_LOCK($1,$2) AS locked',
      [key, waitMs / 1000],
    );
    return Boolean(rows[0]?.locked);
  }
  const deadline = performance.now() + waitMs;
  for (;;) {
    const { rows } = await connection.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key],
    );
    if (rows[0]?.locked) return true;
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(250, remaining));
  }
}

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export function researchSignature(input) {
  const sorted = (values) =>
    [...new Set(values || [])].toSorted((a, b) => a.localeCompare(b));
  return JSON.stringify({
    seeds: sorted(
      (input.seeds || []).map((s) =>
        s.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase(),
      ),
    ),
    markets: sorted(input.markets),
    sources: sorted(input.sources),
    depth: input.depth,
    limit: input.limit,
    sorftimeRequestLimit: input.sorftimeRequestLimit,
    socialTrends: input.socialTrends
      ? {
          sources: sorted(input.socialTrends.sources),
          maxPages: input.socialTrends.maxPages,
        }
      : null,
    existingRecords: input.existingRecords
      ? sorted(input.existingRecords.map((r) => `${r.market}|${r.id}`))
      : null,
  });
}

// Request IDs make transport retries idempotent; deliberate submissions queue independently.
// Existing completed runs remain history; they are never deleted or cancelled here.
export async function submitKeywordJob(
  value,
  requestId,
  { pool, lock, unlock },
) {
  const connection = await pool.connect();
  let held = false;
  try {
    for (let attempt = 0; attempt < 25 && !held; attempt++) {
      held = await lock(connection, 'keyword-submit');
      if (!held) await sleep(100);
    }
    if (!held) throw new Error('另一个关键词任务正在提交，请稍后重试');
    const previousResult = await connection.query(
      'SELECT * FROM research_jobs WHERE request_id=$1',
      [requestId],
    );
    const previous = previousResult.rows[0];
    if (previous) return { job: previous, reused: true };
    const active = await connection.query(
      "SELECT id,input FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
    );
    if (active.rows.length >= 20)
      throw new Error('后台已有20个待完成任务，请稍后提交');
    const id = randomUUID();
    await connection.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, requestId, value, { submittedAt: new Date().toISOString() }],
    );
    const inserted = await connection.query(
      'SELECT * FROM research_jobs WHERE id=$1',
      [id],
    );
    return {
      job: inserted.rows[0],
      reused: false,
    };
  } finally {
    try {
      if (held) await unlock(connection, 'keyword-submit');
    } finally {
      connection.release();
    }
  }
}

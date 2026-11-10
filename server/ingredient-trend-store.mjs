import {
  contentHash,
  DAY,
  iso,
  trendHash,
} from './ingredient-trend-domain.mjs';

// Existing document storage: no schema migration or startup backfill.
export function createTrendArchive(io, market) {
  const read = io.read;
  const write = (name, value) =>
    io.putDocument('workspace_documents', name, value, false);
  const prefix = `ingredient-trend:`;
  const key = (record) =>
    `${prefix}${record.type}:${market}:${(record.publishedAt || 'unknown').slice(0, 10)}:${record.id}`;
  const all = async (start) => {
    let after = '';
    const result = [];
    while (true) {
      const { rows } = await io.pool.query(
        'SELECT name,value FROM workspace_documents WHERE name LIKE $1 AND name>$2 ORDER BY name LIMIT 250',
        [`${start}%`, after],
      );
      result.push(...rows.map((r) => r.value));
      if (rows.length < 250) return result;
      after = rows.at(-1).name;
    }
  };
  return {
    read,
    write,
    key,
    async recent(type, now, days = 14) {
      const rows = [];
      for (let d = 0; d <= days; d++)
        rows.push(
          ...(await all(
            `${prefix}${type}:${market}:${iso(now - d * DAY).slice(0, 10)}:`,
          )),
        );
      return rows;
    },
    async observe(record, captureId, observedAt) {
      const name = key(record),
        old = await read(name);
      // A partial detail response must not erase a complete archived body.
      const current = {
        ...old,
        ...record,
        text: record.text || old?.text || '',
        firstSeenAt: old?.firstSeenAt || observedAt,
        firstSeenCapture: old?.firstSeenCapture || captureId,
        lastSeenAt: observedAt,
      };
      const hash = contentHash(current);
      const versionKey = `${prefix}version:${market}:${record.type}:${record.id}:${hash}`;
      const version = await read(versionKey);
      await write(versionKey, {
        ...current,
        firstSeenAt: version?.firstSeenAt || observedAt,
        contentHash: hash,
      });
      await write(
        `${prefix}observation:${market}:${trendHash([captureId, record.type, record.id])}`,
        {
          sourceId: record.id,
          type: record.type,
          captureId,
          observedAt,
          contentHash: hash,
          reportedComments: record.reportedComments ?? null,
          score: record.score ?? null,
        },
      );
      await write(name, { ...current, contentHash: hash });
      return {
        record: { ...current, contentHash: hash },
        added: !old || old.firstSeenCapture === captureId,
      };
    },
    async savePost(post, patch) {
      const name = key(post),
        current = await read(name);
      await write(name, { ...current, ...patch });
    },
    async reports() {
      const result = await io.pool.query(
        'SELECT value FROM workspace_documents WHERE name LIKE $1 ORDER BY name DESC LIMIT 12',
        [`${prefix}report:${market}:%`],
      );
      return result.rows.map((r) => r.value);
    },
  };
}

export async function ingredientTrendSnapshot(io, market) {
  const archive = createTrendArchive(io, market);
  const savedReports = await archive.reports();
  const reports = savedReports
    .toSorted((a, b) => b.asOf.localeCompare(a.asOf))
    .slice(0, 12);
  const result = await io.pool.query(
    'SELECT value FROM workspace_documents WHERE name LIKE $1',
    [`ingredient-trend:coverage:${market}:%`],
  );
  const states = result.rows.map((r) => r.value);
  const now = Date.now();
  const recentPosts = await archive.recent('post', now, 7),
    recentComments = await archive.recent('comment', now, 7);
  const posts = recentPosts.filter(
    (p) => Date.parse(p.publishedAt) >= now - 7 * DAY,
  );
  const comments = recentComments.filter(
    (p) => Date.parse(p.publishedAt) >= now - 7 * DAY,
  );
  return {
    reports,
    coverage: states,
    stats: {
      posts: posts.length,
      comments: comments.length,
      bodyPresent: posts.filter((p) => p.text).length,
      commentPartialPosts: posts.filter(
        (p) =>
          p.commentState &&
          (!p.commentState.countsMatch ||
            p.commentState.pending?.length ||
            p.commentState.blocked),
      ).length,
      communities: [...new Set(posts.map((p) => p.community))],
      asOf: iso(now),
    },
  };
}

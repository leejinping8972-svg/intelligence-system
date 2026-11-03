import { compactTask } from './workspace-snapshot.mjs';
import { projectJobTasks } from './task-projection.mjs';

const PAGE_SIZES = new Set([10, 20, 50, 100]);
const STATUS_FILTERS = new Set([
  'queued',
  'running',
  'waiting',
  'awaiting_review',
  'completed',
  'failed',
  'partial',
  'cancelled',
  'bulk_running',
  'bulk_paused',
  'bulk_blocked',
  'unavailable',
]);
const ACTIVE_STATUSES = new Set(['queued', 'running']);

function pageSizeOf(value) {
  const size = Number(value);
  return PAGE_SIZES.has(size) ? size : 10;
}

function pageOf(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function statusesOf(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string' && value
      ? [value]
      : [];
  return [
    ...new Set(
      list
        .map((item) => String(item || '').trim())
        .filter((item) => STATUS_FILTERS.has(item)),
    ),
  ];
}

function searchOf(value) {
  return String(value || '')
    .trim()
    .slice(0, 120)
    .toLowerCase();
}

function marketOf(value) {
  const market = String(value || '').trim().toUpperCase();
  return ['US', 'MX', 'VN'].includes(market) ? market : '';
}

function sqlStatus(statuses) {
  if (!statuses.length) return { clause: '', params: [] };
  const mapped = [
    ...new Set(
      statuses.flatMap((status) =>
        status === 'waiting'
          ? ['running']
          : status === 'unavailable'
            ? []
            : [status],
      ),
    ),
  ];
  if (!mapped.length) return { clause: ' AND 1=0', params: [] };
  return {
    clause: ` AND status IN (${mapped.map((_, i) => `$${i + 1}`).join(',')})`,
    params: mapped,
  };
}

function sqlSearch(search, offset, sql) {
  if (!search) return { clause: '', params: [] };
  const like = `%${search}%`;
  return {
    clause: sql(
      ` AND (
        LOWER(id) LIKE $${offset + 1}
        OR LOWER(input::text) LIKE $${offset + 1}
      )`,
      ` AND (
        LOWER(id) LIKE $${offset + 1}
        OR LOWER(CAST(input AS CHAR)) LIKE $${offset + 1}
      )`,
    ),
    params: [like],
  };
}

function sqlMarket(market, offset, sql) {
  if (!market) return { clause: '', params: [] };
  return {
    clause: sql(
      ` AND (
        COALESCE(input->>'market','') = $${offset + 1}
        OR COALESCE(input->'markets','[]'::jsonb) ? $${offset + 1}
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(input->'work','[]'::jsonb)) item
          WHERE item->>'market' = $${offset + 1}
        )
      )`,
      ` AND (
        JSON_UNQUOTE(JSON_EXTRACT(input,'$.market')) = $${offset + 1}
        OR JSON_CONTAINS(JSON_EXTRACT(input,'$.markets'), JSON_QUOTE($${offset + 1}))
        OR JSON_SEARCH(JSON_EXTRACT(input,'$.work'), 'one', $${offset + 1}, NULL, '$[*].market') IS NOT NULL
      )`,
    ),
    params: [market],
  };
}

export function normalizeTaskPageInput(input = {}) {
  return {
    page: pageOf(input.page),
    pageSize: pageSizeOf(input.pageSize),
    statuses: statusesOf(input.statuses ?? input.status),
    search: searchOf(input.search ?? input.query),
    market: marketOf(input.market),
  };
}

export async function listTaskPage(
  input,
  {
    pool,
    sql,
    jobTasks,
    decorateTasks,
    project = projectJobTasks,
    compact = compactTask,
  },
) {
  const query = normalizeTaskPageInput(input);
  const status = sqlStatus(query.statuses);
  const search = sqlSearch(query.search, status.params.length, sql);
  const market = sqlMarket(
    query.market,
    status.params.length + search.params.length,
    sql,
  );
  const filters = `${status.clause}${search.clause}${market.clause}`;
  const where = filters ? `WHERE ${filters.replace(/^\s*AND\s+/, '')}` : '';
  const params = [...status.params, ...search.params, ...market.params];
  const order = `ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC, id DESC`;
  const countSql = `SELECT COUNT(*)::integer AS n FROM research_jobs ${where}`;
  const listSql = `SELECT * FROM research_jobs ${where} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const countsSql =
    'SELECT status, COUNT(*)::integer AS n FROM research_jobs GROUP BY status';
  const [totalResult, list, counts, active] = await Promise.all([
    pool.query(sql(countSql, countSql.replaceAll('::integer', '')), params),
    pool.query(sql(listSql, listSql.replaceAll('::integer', '')), [
      ...params,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ]),
    pool.query(sql(countsSql, countsSql.replaceAll('::integer', ''))),
    pool.query(
      `SELECT id, status, updated_at FROM research_jobs
       WHERE cancelled=false AND status IN ('queued','running')
       ORDER BY updated_at DESC, id DESC
       LIMIT 20`,
    ),
  ]);
  const projected = list.rows.flatMap((job) => project(job, jobTasks));
  const tasks = (
    decorateTasks ? await decorateTasks(projected, list.rows) : projected
  ).map(compact);
  const statusCounts = Object.fromEntries(
    counts.rows.map((row) => [row.status, Number(row.n) || 0]),
  );
  return {
    ...query,
    total: Number(totalResult.rows[0]?.n) || 0,
    tasks,
    statusCounts,
    activeJobs: active.rows
      .filter((row) => ACTIVE_STATUSES.has(row.status))
      .map((row) => ({
        id: row.id,
        status: row.status,
        updatedAt: row.updated_at,
      })),
    generatedAt: new Date().toISOString(),
  };
}

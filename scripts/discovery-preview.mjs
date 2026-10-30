// Isolated synthetic preview. Queue submissions persist, but no worker or provider runs.
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

process.env.DATABASE_CONFIG_FILE = resolve(
  '.artifacts/preview-no-database-config.json',
);
process.env.DATABASE_URL =
  'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
process.env.HCI_UI_QA_KEYWORD_DB = resolve(
  '.artifacts/discovery-keyword-preview-db',
);
const { PGlite } = createRequire(
  new URL('../server/package.json', import.meta.url),
)('@electric-sql/pglite');
await mkdir('.artifacts/discovery-preview-db', { recursive: true });
const db = new PGlite(resolve('.artifacts/discovery-preview-db'));
const { pool, putDocument } = await import('../server/database.mjs');
pool.query = async (statement, params = []) => {
  if (statement.startsWith('SELECT pg_try_advisory_lock'))
    return { rows: [{ locked: true }] };
  if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
  if (
    !params.length &&
    statement
      .trim()
      .split(';')
      .filter((s) => s.trim()).length > 1
  )
    return (await db.exec(statement)).at(-1);
  return db.query(
    statement,
    params.map((v) =>
      v && typeof v === 'object' && !(v instanceof Date)
        ? JSON.stringify(v)
        : v,
    ),
  );
};
pool.connect = async () => ({
  query: (...args) => pool.query(...args),
  release() {},
});
const { migrate } = await import('../server/store.mjs');
const { discoveryAction } =
  await import('../server/discovery-monitor-store.mjs');
const { jobTasks } = await import('../server/runner.mjs');
const { estimateTask } = await import('../server/task-estimate.mjs');
const { action: baseAction } = await import('./ui-redesign-preview.mjs');
await migrate();
const admin = { role: 'admin', id: 'local-qa' };
const channels = [
  { id: 'amazon', name: 'Amazon', markets: ['US', 'MX', 'GB', 'DE', 'JP'] },
  {
    id: 'tiktok',
    name: 'TikTok Shop',
    markets: ['US', 'MY', 'PH', 'VN', 'TH', 'ID', 'GB', 'JP'],
  },
  {
    id: 'shopee',
    name: 'Shopee',
    markets: ['VN', 'ID', 'SG', 'TH', 'MY', 'TW', 'PH', 'BR'],
  },
  { id: 'temu', name: 'Temu', markets: ['US', 'EU'] },
  { id: 'walmart', name: 'Walmart', sourceMarket: 'US' },
  { id: 'ali1688', name: '1688（中国货源）', sourceMarket: 'CN' },
].map((c) => ({ ...c, tools: [] }));
await putDocument(
  'workspace_documents',
  'discovery:ingredient:synthetic',
  {
    id: 'synthetic-ingredient',
    name: 'Urolithin A',
    summary: '合成样本：讨论服用体验与费用，证据尚不足以确认功效。',
    market: 'US',
    firstSeenAt: '2026-10-30T01:00:00Z',
    lastSeenAt: '2026-10-31T01:00:00Z',
    firstSeenInSystem: true,
    mentionCount: 1,
    platforms: ['reddit'],
    mentions: [
      {
        id: 'synthetic-mention',
        platform: 'reddit',
        publishedAt: '2026-10-30',
        url: 'https://www.reddit.com/',
        topic: 'dietary supplements',
        quote: 'Synthetic example: Urolithin A supplement discussion.',
      },
    ],
  },
  true,
);
async function action(input) {
  if (input.action === 'server_task_estimate') return estimateTask(input.input);
  if (input.action === 'server_discovery_capabilities')
    return {
      channels,
      social: ['reddit', 'quora'].map((id) => ({
        id,
        supported: true,
        details: true,
      })),
    };
  if (input.action?.startsWith('server_discovery_'))
    return discoveryAction(input, admin);
  if (input.action === 'server_product_resource_capabilities')
    return { routes: [], platforms: [], configured: {} };
  if (input.action === 'server_task_detail') {
    const job = (
      await pool.query('SELECT * FROM research_jobs WHERE id=$1', [input.jobId])
    ).rows[0];
    return { tasks: job ? jobTasks(job) : [] };
  }
  if (
    input.action === 'server_snapshot' ||
    input.action === 'server_task_snapshot'
  )
    return {
      jobs: (
        await pool.query('SELECT * FROM research_jobs ORDER BY created_at DESC')
      ).rows,
      tasks: (
        await pool.query('SELECT * FROM research_jobs ORDER BY created_at DESC')
      ).rows.flatMap(jobTasks),
    };
  if (input.action === 'server_workspace_delta') {
    const result = await baseAction(input);
    return {
      ...result,
      tasks: (
        await pool.query('SELECT * FROM research_jobs ORDER BY created_at DESC')
      ).rows.flatMap(jobTasks),
    };
  }
  if (input.action === 'server_source_fields_submit')
    return { queued: input.ids.length };
  return baseAction(input);
}
http
  .createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const result = await action(JSON.parse(body || '{}'));
      res.writeHead(result?.error ? 400 : 200, {
        'content-type': 'application/json',
      });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  })
  .listen(5400, '127.0.0.1', () =>
    console.log('Synthetic discovery fixture at http://127.0.0.1:5400'),
  );

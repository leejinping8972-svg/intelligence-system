import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  buildRadarFindings, buildCollectedRadarFindings, buildFreeSourceRadarFindings,
  buildSourceCoverage, buildRadarReport, opportunityRows, formulaStatistics, radarStatistics,
} from './model.js';

const VERSION = 3;
export const encodeStatistic = value => ({ codec: 'deflate-json-v1', body: deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64') });
export const decodeStatistic = value => value?.codec === 'deflate-json-v1'
  ? JSON.parse(inflateRawSync(Buffer.from(value.body, 'base64'), { maxOutputLength: 4 * 1024 * 1024 }).toString('utf8'))
  : value;
const windows = [3, 7, 14, 30];
const markets = ['ALL', 'US', 'MX', 'VN'];
const types = ['all', 'ad', 'product', 'concept', 'ingredient'];
const tabs = ['concept', 'keyword', 'ingredient', 'claim', 'site', 'new'];
const marketLabel = market => ({ ALL: '全部市场', US: '美国', MX: '墨西哥', VN: '越南' })[market];
export function createPublicObservationReader({ fetcher = fetch, base = process.env.PUBLIC_OBSERVATIONS_BASE_URL || 'https://is.luckdate.com/admin/data/' } = {}) {
  const cached = new Map();
  let previous;
  let checkedAt = 0;
  return async () => {
    if (previous && Date.now() - checkedAt < 300_000) return previous;
    const result = {};
    await Promise.all([['collector', 'public-site-observations.json', 'observations'], ['free', 'free-source-observations.json', 'signals']].map(async ([key, file, field]) => {
      try {
        const response = await fetcher(new URL(file, base), { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('Public observations unavailable');
        // Bound public feed memory independently of upstream Content-Length.
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 16 * 1024 * 1024) throw new Error('Public observation feed too large');
          chunks.push(Buffer.from(chunk));
        }
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(value[field])) throw new Error('Invalid public observation feed');
        cached.set(key, value);
      } catch { result[`${key}Stale`] = true; }
      result[key] = cached.get(key) || null;
    }));
    previous = result;
    checkedAt = Date.now();
    return result;
  };
}

export function createWorkspaceStatistics({ pool, sql, putDocument, loadPublic = createPublicObservationReader() }) {
  let nextCheck = 0;
  const radarCache = new Map();
  const keyOf = (kind, market, variant) => `read:statistics:${kind}:${market}:${variant}`;
  async function rebuild(connection, revision) {
    const now = Date.now();
    const previous = (await connection.query("SELECT value FROM workspace_documents WHERE name='read:statistics-version'")).rows[0]?.value;
    if (previous?.version === VERSION && previous.revision === String(revision) && now - previous.at < 300_000) return;
    const state = { keywords: [], products: [], sites: [], ads: [] };
    // Use compact projections in bounded batches, never raw business evidence documents.
    for (const collection of Object.keys(state)) {
      let cursor = '';
      for (;;) {
        const rows = (await connection.query('SELECT id,payload FROM workspace_read_rows WHERE collection=$1 AND id>$2 ORDER BY id LIMIT 200', [collection, cursor])).rows;
        state[collection].push(...rows.map(r => r.payload));
        if (rows.length < 200) break;
        cursor = rows.at(-1).id;
      }
    }
    const publicData = await loadPublic();
    const savedPublic = (await connection.query("SELECT value FROM workspace_documents WHERE name='read:statistics-public'")).rows[0]?.value;
    publicData.collector ||= savedPublic?.collector || null;
    publicData.free ||= savedPublic?.free || null;
    if (publicData.collector || publicData.free) await putDocument('workspace_documents', 'read:statistics-public', { collector: publicData.collector, free: publicData.free }, false, connection);
    const generatedAt = new Date(now).toISOString();
    const allRadar = new Map(windows.map(days => [days, [
      ...buildRadarFindings(state, days, false),
      ...buildCollectedRadarFindings(publicData.collector, days),
      ...buildFreeSourceRadarFindings(publicData.free, days),
    ].sort((a, b) => (b.businessScore ?? -1) - (a.businessScore ?? -1) || b.confidenceScore - a.confidenceScore || a.id.localeCompare(b.id))]));
    const references = new Map();
    for (const [days, rows] of allRadar) {
      references.set(days, new Map(rows.map((row, index) => [row, index])));
      await putDocument('workspace_documents', `read:radar-payload:${days}`, { revision: String(revision), data: encodeStatistic(rows) }, false, connection);
    }
    async function save(kind, market, variant, rows, summary) {
      await connection.query('DELETE FROM workspace_statistic_rows WHERE kind=$1 AND market=$2 AND variant=$3', [kind, market, variant]);
      for (let start = 0; start < rows.length;) {
        const batch = [];
        let bytes = 0;
        while (start + batch.length < rows.length && batch.length < 1000) {
          const row = rows[start + batch.length];
          const payload = kind === 'radar' ? references.get(Number(variant)).get(row) : row;
          const size = Buffer.byteLength(JSON.stringify(payload));
          if (batch.length && bytes + size > 512 * 1024) break;
          batch.push([kind, market, variant, start + batch.length, row.type || '', payload]);
          bytes += size;
        }
        await connection.query(`INSERT INTO workspace_statistic_rows(kind,market,variant,position,subtype,payload) VALUES ${batch.map((_, i) => `(${Array.from({ length: 6 }, (_, j) => `$${i * 6 + j + 1}`).join(',')})`).join(',')}`, batch.flat());
        start += batch.length;
      }
      await putDocument('workspace_documents', keyOf(kind, market, variant), { generatedAt, revision: String(revision), total: rows.length, ...summary }, false, connection);
    }
    for (const market of markets) {
      const scoped = Object.fromEntries(Object.entries(state).map(([kind, rows]) => [kind, rows.filter(row => market === 'ALL' || row.market === market)]));
      for (const days of windows) {
        const rows = allRadar.get(days).filter(row => market === 'ALL' || row.market === market);
        const summaries = Object.fromEntries(types.map(type => [type, radarStatistics(rows.filter(row => type === 'all' || row.type === type))]));
        const scopedCollector = publicData.collector ? { ...publicData.collector, observations: publicData.collector.observations.filter(row => market === 'ALL' || row.market === market) } : null;
        const scopedFree = publicData.free ? { ...publicData.free, signals: publicData.free.signals.filter(row => market === 'ALL' || row.market === market || row.market === 'GLOBAL') } : null;
        await save('radar', market, String(days), rows, { radarPayloadKey: `read:radar-payload:${days}`, summaries, coverage: buildSourceCoverage(scoped, scopedCollector, scopedFree), publicDataStale: !!(publicData.collectorStale || publicData.freeStale) });
      }
      for (const tab of tabs) await save('opportunities', market, tab, opportunityRows(scoped, tab), {});
      const formula = formulaStatistics(scoped.products);
      await save('formulas', market, 'all', formula.rows, { coverage: formula.coverage });
    }
    await putDocument('workspace_documents', 'read:statistics-version', { version: VERSION, revision: String(revision), at: now }, false, connection);
  }
  function due() { if (Date.now() < nextCheck) return false; nextCheck = Date.now() + 30_000; return true; }
  async function readSnapshot(input, connection) {
    const kind = input.kind;
    if (!['radar', 'opportunities', 'formulas'].includes(kind)) throw new Error('未知统计类型');
    const market = markets.includes(input.market) ? input.market : 'ALL';
    const variant = kind === 'radar' ? String(windows.includes(Number(input.days)) ? Number(input.days) : 7) : kind === 'opportunities' ? tabs.includes(input.tab) ? input.tab : 'concept' : 'all';
    const subtype = kind === 'radar' && types.includes(input.type) ? input.type : 'all';
    const snapshot = (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [keyOf(kind, market, variant)])).rows[0]?.value;
    if (!snapshot) return { rows: [], total: 0, page: 1, pageSize: 20, snapshot: null, indexing: true };
    async function resolveRows(values) {
      if (!snapshot.radarPayloadKey) return values.map(decodeStatistic);
      let cached = radarCache.get(snapshot.radarPayloadKey);
      if (cached?.revision !== snapshot.revision) {
        const saved = (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [snapshot.radarPayloadKey])).rows[0]?.value;
        if (saved?.revision !== snapshot.revision) throw new Error('Radar snapshot payload unavailable');
        const rows = JSON.parse(inflateRawSync(Buffer.from(saved.data.body, 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
        if (!Array.isArray(rows)) throw new Error('Invalid radar snapshot payload');
        cached = { revision: snapshot.revision, rows };
        radarCache.set(snapshot.radarPayloadKey, cached);
      }
      return values.map(index => {
        if (!Number.isInteger(index) || index < 0 || index >= cached.rows.length) throw new Error('Invalid radar snapshot reference');
        return cached.rows[index];
      });
    }
    const params = [kind, market, variant];
    let where = 'kind=$1 AND market=$2 AND variant=$3';
    if (subtype !== 'all') { params.push(subtype); where += ` AND subtype=$${params.length}`; }
    if (kind === 'opportunities' && Array.isArray(input.saved)) {
      if (input.saved.length > 1000) throw new Error('收藏筛选最多1000项');
      if (!input.saved.length) where += ' AND 1=0';
      else {
        const title = sql("payload->>'title'", "JSON_UNQUOTE(JSON_EXTRACT(payload,'$.title'))");
        const slots = input.saved.map(title => { params.push(String(title)); return `$${params.length}`; });
        where += ` AND ${title} IN (${slots.join(',')})`;
      }
    }
    if (kind === 'radar' && input.report === true) {
      const rows = await resolveRows((await connection.query(`SELECT payload FROM workspace_statistic_rows WHERE ${where} ORDER BY position`, params)).rows.map(r => r.payload));
      return { report: `${buildRadarReport(rows, Number(variant), marketLabel(market), input.appName ? String(input.appName).slice(0, 120) : undefined)}\n\n数据快照时间：${snapshot.generatedAt}`, snapshot };
    }
    const total = Number((await connection.query(`SELECT COUNT(*) AS total FROM workspace_statistic_rows WHERE ${where}`, params)).rows[0].total);
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 20)));
    const page = Math.max(1, Math.min(Math.ceil(total / pageSize) || 1, Math.floor(Number(input.page) || 1)));
    const rows = await resolveRows((await connection.query(`SELECT payload FROM workspace_statistic_rows WHERE ${where} ORDER BY position LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize])).rows.map(r => r.payload));
    const { summaries, radarPayloadKey, ...metadata } = snapshot;
    return { rows, total, page, pageSize, snapshot: { ...metadata, summary: summaries?.[subtype] } };
  }
  async function read(input) {
    const connection = await pool.connect();
    try {
      await connection.query(sql('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
      const result = await readSnapshot(input, connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }
  return { rebuild, read, due };
}

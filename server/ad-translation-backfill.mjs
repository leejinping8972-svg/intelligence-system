import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pool, engine } from './database.mjs';
import { openAdsKey } from './ads-provider.mjs';

const BACKUP_PATH = '/tmp/ad-translation-backfill-20261104-backup.json';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const adRows = async () => (await pool.query("SELECT name,value,revision FROM workspace_documents WHERE name LIKE 'business:ads:%' ORDER BY name")).rows;

async function audit() {
  const ads = await adRows();
  const missing = (value, field) => Boolean(String(value[field] || '').trim()) && !String(value[`${field}Zh`] || '').trim();
  const pending = ads.filter(({ value }) => ['brand', 'headline', 'copy'].some((field) => missing(value, field)));
  const counts = {
    total: ads.length,
    ads_missing: pending.length,
    brand_missing: ads.filter(({ value }) => missing(value, 'brand')).length,
    headline_missing: ads.filter(({ value }) => missing(value, 'headline')).length,
    copy_missing: ads.filter(({ value }) => missing(value, 'copy')).length,
    source_characters: ads.reduce((total, { value }) => total + ['brand', 'headline', 'copy'].reduce((sum, field) => sum + String(value[field] || '').length, 0), 0),
    unique_missing: Object.fromEntries(['brand', 'headline', 'copy'].map((field) => [field, new Set(ads.filter(({ value }) => missing(value, field)).map(({ value }) => value[field])).size])),
    longest: Object.fromEntries(['brand', 'headline', 'copy'].map((field) => [field, Math.max(...ads.map(({ value }) => String(value[field] || '').length))])),
  };
  const markets = Object.entries(Object.groupBy(ads, ({ value }) => `${value.market || 'unknown'}:${value.dataNature || 'unknown'}`)).map(([key, rows]) => ({ key, total: rows.length }));
  const { rows: candidateJobs } = await pool.query("SELECT status,input FROM research_jobs WHERE status IN ('queued','running','started')");
  const jobs = Object.entries(Object.groupBy(candidateJobs.filter(({ input }) => input?.kind === 'source_fields' && input?.targetKind === 'ads'), ({ status }) => status)).map(([status, rows]) => ({ status, total: rows.length }));
  const examples = pending.slice(0, 5).map(({ value }) => ({
    id: value.id, market: value.market,
    brand_length: String(value.brand || '').length,
    headline_length: String(value.headline || '').length,
    copy_length: String(value.copy || '').length,
    analysis_status: value.fieldAnalysis?.status || null,
  }));
  const stored = (await pool.query("SELECT value FROM provider_configs WHERE name='provider:analysis:v1'")).rows[0]?.value;
  const configured = stored ? JSON.parse(openAdsKey(stored)) : null;
  console.log(JSON.stringify({ engine, counts, markets, jobs, examples,
    model: configured ? { name: configured.model, maxTokens: configured.maxTokens } : null,
  }));
}

async function backup() {
  const rows = await adRows();
  const content = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), engine, rows });
  await writeFile(BACKUP_PATH, content, { mode: 0o600, flag: 'wx' });
  const readBack = await readFile(BACKUP_PATH);
  if (hash(readBack) !== hash(content)) throw new Error('备份写入校验失败');
  console.log(JSON.stringify({ backup: BACKUP_PATH, rows: rows.length, bytes: readBack.length, sha256: hash(readBack) }));
}

try {
  if (process.argv[2] === '--audit') await audit();
  else if (process.argv[2] === '--backup') await backup();
  else throw new Error('当前仅支持 --audit 或 --backup');
} finally {
  await pool.end();
}

import { readFile } from 'node:fs/promises';
import { pool } from './database.mjs';
import { FIELDS, missing } from './ad-translation-backfill-domain.mjs';

try {
  const ads = (await pool.query("SELECT name,value,revision FROM workspace_documents WHERE name LIKE 'business:ads:%' ORDER BY name")).rows;
  const projected = (await pool.query("SELECT id,payload FROM workspace_read_rows WHERE collection='ads'")).rows;
  const byId = new Map(projected.map((row) => [row.id, row.payload]));
  const paths = [
    '/data/ad-translation-backfill-20261104.jsonl',
    '/data/ad-translation-backfill-recovery-20261104.jsonl',
    '/data/ad-translation-backfill-recovery-130-20261104.jsonl',
    '/data/ad-brand-chinese-backfill-20261104.jsonl',
    '/data/ad-brand-chinese-backfill-late-20261104.jsonl',
    '/data/ad-headline-chinese-backfill-20261104.jsonl',
  ];
  const journals = await Promise.all(paths.map(async (path) => (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))));
  const journal = journals[0];
  const events = journals.flat();
  const calls = events.filter((event) => event.type === 'completed' && event.usage);
  const usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens'].map((key) => [key, calls.reduce((sum, call) => sum + Number(call.usage?.[key] || 0), 0)]));
  const missingFields = Object.fromEntries(FIELDS.map((field) => [`${field}Zh`, ads.filter(({ value }) => missing(value, field)).length]));
  const withoutChinese = Object.fromEntries(FIELDS.map((field) => [`${field}Zh`, ads.filter(({ value }) => String(value[`${field}Zh`] || '').trim() && !/\p{Script=Han}/u.test(value[`${field}Zh`])).length]));
  if (process.argv.includes('--brands')) {
    console.log(JSON.stringify(ads.filter(({ value }) => String(value.brandZh || '').trim() && !/\p{Script=Han}/u.test(value.brandZh)).slice(0, 30).map(({ value }) => ({ brand: value.brand, brandZh: value.brandZh }))));
  }
  if (process.argv.includes('--headlines')) {
    console.log(JSON.stringify(ads.filter(({ value }) => String(value.headlineZh || '').trim() && !/\p{Script=Han}/u.test(value.headlineZh)).map(({ value }) => ({ id: value.id, headline: value.headline, headlineZh: value.headlineZh }))));
  }
  if (process.argv.includes('--missing')) {
    console.log(JSON.stringify(ads.filter(({ value }) => FIELDS.some((field) => missing(value, field))).map(({ name, value, revision }) => ({ name, revision, market: value.market,
      brand: value.brand, headline: value.headline, copyLength: String(value.copy || '').length,
      missing: FIELDS.filter((field) => missing(value, field)), lastCollectedAt: value.lastCollectedAt,
      analysisStatus: value.fieldAnalysis?.status }))));
  }
  const missingSellingPoint = ads.filter(({ value }) => !String(value.sellingPointZh || '').trim() && (value.headline || value.copy)).length;
  const projectionMismatch = ads.filter(({ value }) => {
    const row = byId.get(value.id);
    return !row || FIELDS.some((field) => String(row[`${field}Zh`] || '') !== String(value[`${field}Zh`] || '')) || String(row.sellingPointZh || '') !== String(value.sellingPointZh || '');
  }).map(({ value }) => value.id);
  const dirty = (await pool.query("SELECT COUNT(*) AS total FROM workspace_read_dirty WHERE kind='business' AND source_key LIKE 'business:ads:%'")).rows[0].total;
  console.log(JSON.stringify({ ads: ads.length, projected: projected.length, missingFields, withoutChinese, missingSellingPoint,
    projectionMismatch: projectionMismatch.length, mismatchIds: projectionMismatch.slice(0, 10), dirtyAds: Number(dirty),
    modelCallsWithUsage: calls.length, failedAttemptsWithoutUsage: events.filter(({ type }) => type === 'failed').length,
    interruptedAttempts: journal.filter((event) => event.type === 'skipped' && event.reason === 'api-deployment-interrupted-unknown-result').length,
    reviewedFieldsAfterProviderRefusal: journal.filter((event) => event.reviewedAfterProviderRefusal).reduce((sum, event) => sum + Object.keys(event.translations || {}).length, 0), usage,
    lastEvent: journal.at(-1)?.type || journal.at(-1)?.phase }));
} finally { await pool.end(); }

import { pool, sql } from './database.mjs';

// Read original journals, never checkpoints, keyword metrics or cached provider
// documents: those repeat the same charge when a task is resumed or re-scored.
export const usageQueries = {
  research: {
    postgres: `SELECT r.job_id,r.step,r.status,j.created_at,
      json_build_object('apiUnits',r.response->'apiUnits','cached',r.response->'cached',
        'unknownCharges',r.response->'semrushUnknownCharges',
        'semrushKeyId',r.response->'semrushKeyId',
        'provider',CASE WHEN r.step ~ '^platform:[0-9]{1,8}$'
          THEN j.checkpoint->'work'->split_part(r.step,':',2)::integer->'provider' END) AS record
      FROM research_requests r JOIN research_jobs j ON j.id=r.job_id
      WHERE r.step LIKE 'sem-%' OR r.step LIKE 'metrics:%' OR r.step LIKE 'domain:%'
        OR r.step LIKE 'site-score:%' OR r.step LIKE 'platform:%'`,
    mysql: `SELECT r.job_id,r.step,r.status,j.created_at,
      JSON_OBJECT('apiUnits',JSON_EXTRACT(r.response,'$.apiUnits'),
        'cached',JSON_EXTRACT(r.response,'$.cached'),
        'unknownCharges',JSON_EXTRACT(r.response,'$.semrushUnknownCharges'),
        'semrushKeyId',JSON_EXTRACT(r.response,'$.semrushKeyId'),
        'provider',CASE WHEN r.step REGEXP '^platform:[0-9]{1,8}$'
          THEN JSON_EXTRACT(j.checkpoint,CONCAT('$.work[',SUBSTRING_INDEX(r.step,':',-1),'].provider')) END) AS record
      FROM research_requests r JOIN research_jobs j ON j.id=r.job_id
      WHERE r.step LIKE 'sem-%' OR r.step LIKE 'metrics:%' OR r.step LIKE 'domain:%'
        OR r.step LIKE 'site-score:%' OR r.step LIKE 'platform:%'`,
  },
  monitor: {
    postgres: `SELECT name,value->>'status' AS status,value->>'step' AS step,value->>'at' AS created_at,
      json_build_object('apiUnits',value->'response'->'apiUnits','cached',value->'response'->'cached',
        'semrushKeyId',value->'response'->'semrushKeyId') AS record
      FROM workspace_documents WHERE name LIKE 'competitor:request:%' AND value->>'step' LIKE 'semrush:%'`,
    mysql: `SELECT name,JSON_UNQUOTE(JSON_EXTRACT(value,'$.status')) AS status,
      JSON_UNQUOTE(JSON_EXTRACT(value,'$.step')) AS step,JSON_UNQUOTE(JSON_EXTRACT(value,'$.at')) AS created_at,
      JSON_OBJECT('apiUnits',JSON_EXTRACT(value,'$.response.apiUnits'),
        'cached',JSON_EXTRACT(value,'$.response.cached'),
        'semrushKeyId',JSON_EXTRACT(value,'$.response.semrushKeyId')) AS record
      FROM workspace_documents WHERE name LIKE 'competitor:request:%'
        AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.step')) LIKE 'semrush:%'`,
  },
};

const categories = [
  ['keywords', '关键词研究与指标'],
  ['sites', '独立站指标'],
  ['products', '平台商品研究'],
  ['monitor', '关键词监控'],
];
const emptyTotals = () => ({
  confirmedUnits: 0,
  confirmedRecords: 0,
  unknownRecords: 0,
  cachedRecords: 0,
  breakdown: categories.map(([id, label]) => ({
    id,
    label,
    confirmedUnits: 0,
    confirmedRecords: 0,
    unknownRecords: 0,
  })),
});
export function summarizeSemrushUsage(
  research,
  monitor,
  now = new Date(),
  { currentKeyId = null, keyConfigured = false } = {},
) {
  const currentKey = emptyTotals();
  const otherKeys = emptyTotals();
  const unassigned = emptyTotals();
  const totals = { currentKey, otherKeys, unassigned };
  const seen = new Set();
  let unclassifiedRecords = 0;
  let cachedRecords = 0;
  let firstRecordedAt = null;
  for (const row of [...research, ...monitor]) {
    const identity = row.name
      ? `monitor:${row.name}`
      : `research:${row.job_id}:${row.step}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const record = row.record || {};
    let category;
    if (row.name && row.step?.startsWith('semrush:')) category = 'monitor';
    else if (/^(?:sem-(?:discover|metric)|metrics):/.test(row.step))
      category = 'keywords';
    else if (/^(?:domain|site-score):/.test(row.step)) category = 'sites';
    else if (row.step.startsWith('platform:')) {
      if (record.provider === 'semrush') category = 'products';
      else if (!record.provider) unclassifiedRecords++;
    }
    if (!category) continue;
    const timestamp = Date.parse(row.created_at);
    if (
      Number.isFinite(timestamp) &&
      (!firstRecordedAt || timestamp < Date.parse(firstRecordedAt))
    )
      firstRecordedAt = new Date(timestamp).toISOString();
    if (record.cached === true) {
      cachedRecords++;
      continue;
    }
    let attribution = 'unassigned';
    if (record.semrushKeyId) {
      attribution =
        currentKeyId && record.semrushKeyId === currentKeyId
          ? 'currentKey'
          : 'otherKeys';
    }
    const attributedGroup = totals[attribution].breakdown.find(
      (item) => item.id === category,
    );
    const confirmed =
      ['completed', 'done'].includes(row.status) &&
      Number.isSafeInteger(record.apiUnits) &&
      record.apiUnits >= 0;
    if (confirmed) {
      totals[attribution].confirmedUnits += record.apiUnits;
      totals[attribution].confirmedRecords++;
      attributedGroup.confirmedUnits += record.apiUnits;
      attributedGroup.confirmedRecords++;
    }
    // Legacy expansion summed known charges without tracking missing metadata.
    // Preserve its confirmed subtotal, but explicitly mark its possible gap.
    if (
      !confirmed ||
      Number(record.unknownCharges) > 0 ||
      (row.step.startsWith('sem-discover:') &&
        !Number.isSafeInteger(record.unknownCharges))
    ) {
      totals[attribution].unknownRecords++;
      attributedGroup.unknownRecords++;
    }
  }
  return {
    currentKey,
    otherKeys,
    unassigned,
    keyConfigured,
    currentKeyAvailable: Boolean(currentKeyId),
    confirmedUnits: currentKey.confirmedUnits,
    confirmedRecords: currentKey.confirmedRecords,
    unknownRecords: currentKey.unknownRecords,
    cachedRecords,
    unclassifiedRecords,
    firstRecordedAt,
    checkedAt: now.toISOString(),
    breakdown: currentKey.breakdown,
  };
}

export async function semrushUsage(
  { currentKeyId = null, keyConfigured = false } = {},
  connection = pool,
) {
  const [research, monitor] = await Promise.all([
    connection.query(
      sql(usageQueries.research.postgres, usageQueries.research.mysql),
    ),
    connection.query(
      sql(usageQueries.monitor.postgres, usageQueries.monitor.mysql),
    ),
  ]);
  return summarizeSemrushUsage(research.rows, monitor.rows, new Date(), {
    currentKeyId,
    keyConfigured,
  });
}

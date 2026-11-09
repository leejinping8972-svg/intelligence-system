// Pure helpers shared by report parsing, persistence and the keyword UI.
export const SEMRUSH_KEYWORD_COLUMNS = [
  'keyword',
  'volume',
  'keyword_difficulty',
  'cpc',
  'competitive_density',
  'intent',
  'results',
  'trend',
  'relevance',
  'triggered_serp_features',
];

export function semrushExportColumns(schema) {
  const allowed = schema.parameters?.export_columns?.items?.enum || [];
  return SEMRUSH_KEYWORD_COLUMNS.filter((column) => allowed.includes(column));
}

const first = (row, keys) => {
  for (const key of keys)
    if (row[key] !== undefined && row[key] !== null && row[key] !== '')
      return row[key];
};

export function validSemrushTrend(value) {
  return (
    value?.version === 1 &&
    value.status === 'collected' &&
    value.scale === 'relative_0_1' &&
    Array.isArray(value.values) &&
    value.values.length === 12 &&
    [...value.values].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
    ) &&
    Number.isFinite(Date.parse(value.collectedAt))
  );
}

export function parseSemrushTrend(raw, collectedAt, report, supported = true) {
  const base = { version: 1, collectedAt, report, scale: 'relative_0_1' };
  if (!supported)
    return {
      ...base,
      status: 'unsupported',
      message: '当前报告未开放月度趋势字段',
    };
  if (raw === undefined || raw === null || raw === '')
    return {
      ...base,
      status: 'unavailable',
      message: '来源未返回月度趋势；保留未知，不按0处理',
    };
  let values = raw;
  if (typeof values === 'string') {
    const text = values.trim();
    try {
      values = text.startsWith('[') ? JSON.parse(text) : text.split(',');
    } catch {
      values = null;
    }
  }
  if (Array.isArray(values))
    values = Array.from(values, (value) => {
      if (typeof value === 'number') return value;
      if (
        typeof value === 'string' &&
        /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
      )
        return Number(value);
      return Number.NaN;
    });
  const trend = { ...base, status: 'collected', values };
  if (!validSemrushTrend(trend))
    return {
      ...base,
      status: 'invalid',
      message: '月度趋势格式不完整：应为12个0–1相对值；未补0或推算搜索次数',
    };
  return { ...trend, message: '过去12个月，由早到晚；来源未返回逐月日期' };
}

export function semrushExtraMetrics(row, at, report, columns) {
  const result = {};
  for (const [key, aliases, max] of [
    ['searchResultCount', ['results', 'Number of Results', 'Nr'], Infinity],
    ['relatedRelevance', ['relevance', 'Related Relevance', 'Rr'], 1],
  ]) {
    const raw = first(row, aliases);
    if (
      (typeof raw === 'number' || typeof raw === 'string') &&
      /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(raw).trim())
    ) {
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0 && value <= max)
        result[key] = value;
    }
  }
  const features = first(row, [
    'triggered_serp_features',
    'SERP Features',
    'Fk',
  ]);
  if (features !== undefined) {
    const list = Array.isArray(features)
      ? features
      : String(features).split(',');
    const safe = Array.from(list, (v) => String(v).trim());
    if (safe.length <= 100 && safe.every((v) => /^[\w -]{1,80}$/.test(v)))
      result.serpFeatures = [...new Set(safe)];
  }
  if (columns) result.semrushColumns = [...columns];
  result.searchTrend = parseSemrushTrend(
    first(row, ['trend', 'trends', 'Trends', 'Td']),
    at,
    report,
    !columns || columns.includes('trend'),
  );
  return result;
}

export function sanitizeSemrushExtras(metrics) {
  const extra = {};
  for (const [key, max] of [
    ['searchResultCount', Infinity],
    ['relatedRelevance', 1],
  ]) {
    const n = metrics[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max)
      extra[key] = n;
  }
  if (typeof metrics.relatedTo === 'string' && metrics.relatedTo.trim())
    extra.relatedTo = metrics.relatedTo.trim().slice(0, 500);
  if (
    Array.isArray(metrics.serpFeatures) &&
    metrics.serpFeatures.length <= 100 &&
    [...metrics.serpFeatures].every(
      (v) => typeof v === 'string' && /^[\w -]{1,80}$/.test(v),
    )
  )
    extra.serpFeatures = [...new Set(metrics.serpFeatures)];
  if (Array.isArray(metrics.semrushColumns))
    extra.semrushColumns = SEMRUSH_KEYWORD_COLUMNS.filter((c) =>
      metrics.semrushColumns.includes(c),
    );
  const trend = metrics.searchTrend;
  if (trend?.version === 1 && Number.isFinite(Date.parse(trend.collectedAt))) {
    if (validSemrushTrend(trend))
      extra.searchTrend = {
        version: 1,
        status: 'collected',
        scale: 'relative_0_1',
        values: [...trend.values],
        collectedAt: trend.collectedAt,
        report: String(trend.report || '').slice(0, 100),
        message: '过去12个月，由早到晚；来源未返回逐月日期',
      };
    else if (['unavailable', 'unsupported', 'invalid'].includes(trend.status))
      extra.searchTrend = {
        version: 1,
        status: trend.status,
        scale: 'relative_0_1',
        collectedAt: trend.collectedAt,
        report: String(trend.report || '').slice(0, 100),
        message: String(trend.message || '').slice(0, 300),
      };
  }
  return extra;
}

export function semrushTrendSummary(metrics, market) {
  const trend =
    metrics?.market === market && /Semrush/i.test(metrics.source || '')
      ? metrics.searchTrend
      : undefined;
  if (!validSemrushTrend(trend))
    return {
      available: false,
      values: [],
      collectedAt: trend?.collectedAt || '',
      message:
        trend?.message || '尚未获取Semrush月度趋势；可在补齐指标中更新字段',
      monthChange: null,
      quarterChange: null,
      halfChange: null,
      peakPositions: [],
      latestHeat: null,
    };
  const values = trend.values.map((v) => Math.round(v * 10_000) / 100);
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const change = (recent, previous) =>
    previous > 0 ? Math.round((recent / previous - 1) * 1000) / 10 : null;
  const peak = Math.max(...values);
  return {
    available: true,
    values,
    collectedAt: trend.collectedAt,
    message: trend.message,
    latestHeat: values.at(-1),
    monthChange: change(trend.values[11], trend.values[10]),
    quarterChange: change(
      mean(trend.values.slice(-3)),
      mean(trend.values.slice(-6, -3)),
    ),
    halfChange: change(
      mean(trend.values.slice(-6)),
      mean(trend.values.slice(0, 6)),
    ),
    peakPositions:
      peak > 0 ? values.flatMap((v, i) => (v === peak ? [i + 1] : [])) : [],
  };
}

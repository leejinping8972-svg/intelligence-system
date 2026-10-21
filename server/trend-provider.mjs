import { fetchGoogleTrendsBatch, trendSeriesMessage } from './collector.js';

// Each journal entry contains exactly one period, so a daily failure cannot
// discard or repeat an already successful annual collection.
export async function collectTrendPart(
  request,
  fetchBatch = fetchGoogleTrendsBatch,
  now = Date.now(),
) {
  const phase = request.trendPhase;
  if (
    !['annual', 'daily'].includes(phase) ||
    request.keywords?.length !== 1 ||
    request.markets?.length !== 1
  )
    throw new Error('趋势步骤参数无效');
  const keyword = request.keywords[0];
  const market = request.markets[0];
  const extended = phase === 'annual' && request.trendComparisonVersion === 2;
  const captured = new Date(now);
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  start.setUTCDate(start.getUTCDate() - 8);
  let period = phase === 'annual' ? 'today 12-m' : 'today 3-m';
  if (extended)
    period = `${start.toISOString().slice(0, 10)} ${captured.toISOString().slice(0, 10)}`;
  try {
    const rows = await fetchBatch([keyword], market, period, {
      includeInsights: phase === 'annual',
    });
    const row = rows?.[0];
    if (!row || !Array.isArray(row.points))
      throw new Error('Google Trends返回结构异常，需人工核对');
    if (phase === 'daily' && row.points.length > 0 && row.resolution !== 'day')
      throw new Error('Google Trends未返回日粒度，需人工核对');
    const historyPoints = row.points.filter((p) => !p.isPartial);
    if (
      historyPoints.some(
        (p) =>
          !Number.isFinite(p.value) ||
          p.value < 0 ||
          p.value > 100 ||
          !Number.isFinite(Date.parse(p.date)),
      )
    )
      throw new Error('Google Trends时点格式异常，需人工核对');
    const annualStart = new Date(row.collectedAt || now);
    annualStart.setUTCFullYear(annualStart.getUTCFullYear() - 1);
    annualStart.setUTCDate(annualStart.getUTCDate() - 7);
    const points = extended
      ? historyPoints.filter((p) => Date.parse(p.date) >= annualStart.getTime())
      : historyPoints;
    let message = 'Google Trends已返回，但本周期没有可用时点';
    if (points.length > 0) {
      message = trendSeriesMessage(points.map((p) => p.value));
      if (phase === 'annual')
        message = points.some((p) => p.value > 0)
          ? '已采集一年趋势'
          : '一年相对热度均为0，Google Trends样本不足';
    }
    return {
      status: points.length > 0 ? 'success' : 'empty',
      phase,
      keyword,
      market,
      period,
      points,
      ...(extended ? { historyPoints } : {}),
      resolution: row.resolution,
      collectedAt: row.collectedAt || new Date().toISOString(),
      sourceUrl: `https://trends.google.com/trends/explore?geo=${encodeURIComponent(market)}&date=${encodeURIComponent(period)}&q=${encodeURIComponent(keyword)}`,
      ...(phase === 'annual'
        ? {
            regions: Array.isArray(row.regions) ? row.regions : [],
            relatedTop: Array.isArray(row.relatedTop) ? row.relatedTop : [],
            relatedRising: Array.isArray(row.relatedRising)
              ? row.relatedRising
              : [],
            insightsStatus: row.insightsStatus || 'empty',
            insightsMessage: row.insightsMessage || '',
            insightsPeriod: row.insightsPeriod || period,
          }
        : {}),
      message,
    };
  } catch (error) {
    return {
      status: 'error',
      phase,
      keyword,
      market,
      message: error.message,
      httpStatus: Number(error.status) || 0,
      retryAfterSeconds: Number(error.retryAfterSeconds) || 0,
    };
  }
}

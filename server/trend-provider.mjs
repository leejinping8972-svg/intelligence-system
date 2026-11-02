import { fetchGoogleTrendsBatch, trendSeriesMessage } from './collector.js';

// Each journal entry contains exactly one period, so a daily failure cannot
// discard or repeat an already successful annual collection.
export async function collectTrendPart(
  request,
  fetchBatch = fetchGoogleTrendsBatch,
) {
  const phase = request.trendPhase;
  if (
    !['annual', 'daily'].includes(phase) ||
    request.keywords?.length !== 1 ||
    request.markets?.length !== 1
  )
    throw new Error('趋势步骤参数无效');
  const keyword = request.keywords[0],
    market = request.markets[0];
  const period = phase === 'annual' ? 'today 12-m' : 'today 3-m';
  try {
    const rows = await fetchBatch([keyword], market, period);
    const row = rows?.[0];
    if (!row || !Array.isArray(row.points))
      throw new Error('Google Trends返回结构异常，需人工核对');
    if (phase === 'daily' && row.points.length && row.resolution !== 'day')
      throw new Error('Google Trends未返回日粒度，需人工核对');
    const points = row.points.filter((p) => !p.isPartial);
    if (points.some((p) => !Number.isFinite(p.value) || !p.date))
      throw new Error('Google Trends时点格式异常，需人工核对');
    return {
      status: points.length ? 'success' : 'empty',
      phase,
      keyword,
      market,
      period,
      points,
      resolution: row.resolution,
      collectedAt: row.collectedAt || new Date().toISOString(),
      sourceUrl: `https://trends.google.com/trends/explore?geo=${encodeURIComponent(market)}&date=${encodeURIComponent(period)}&q=${encodeURIComponent(keyword)}`,
      message: !points.length
        ? 'Google Trends已返回，但本周期没有可用时点'
        : phase === 'annual'
          ? points.some((p) => p.value > 0)
            ? '已采集一年趋势'
            : '一年相对热度均为0，Google Trends样本不足'
          : trendSeriesMessage(points.map((p) => p.value)),
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

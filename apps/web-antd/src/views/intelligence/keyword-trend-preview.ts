import type { Keyword } from './data';

export function keywordTrendPreview(keyword: Keyword) {
  const dated = (keyword.trendPoints || []).filter((p) => Number.isFinite(Date.parse(p.date)) && Number.isFinite(p.value));
  const end = dated.length ? Math.max(...dated.map((p) => Date.parse(p.date))) : 0;
  const points = dated.filter((p) => Date.parse(p.date) >= end - 365 * 86_400_000).toSorted((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const values = points.length ? points.map((p) => p.value) : (keyword.series || []).filter(Number.isFinite);
  const start = Date.parse(points[0]?.date || '');
  const duration = end - start;
  const coordinates = values.map((value, i) => {
    const fraction = points.length && duration > 0 ? (Date.parse(points[i]!.date) - start) / duration : i / Math.max(1, values.length - 1);
    return [4 + fraction * 160, 40 - Math.max(0, Math.min(100, value)) * 0.36];
  });
  return {
    coordinates: coordinates.map((point) => point.join(',')).join(' '),
    first: coordinates[0],
    count: values.length,
    range: points.length ? `${points[0]!.date} 至 ${points.at(-1)!.date}` : '日期未记录',
  };
}

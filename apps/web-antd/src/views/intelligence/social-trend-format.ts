import type { SocialPeriod } from './keyword-social-trends';

export function formatSocialPeriod(p: SocialPeriod) {
  if (p.count === null) return `${p.label}：—（待回查）`;
  const prefix = p.currentComplete === false && p.state !== 'legacy' ? '≥' : '';
  const value = `${p.label}：${prefix}${p.count}条`;
  if (p.stale) return `${value}（上次）`;
  if (p.state === 'legacy') return `${value}（需回查）`;
  if (p.state === 'coverage_insufficient') return `${value}（历史不足）`;
  if (p.state === 'empty_period') return `${value}（未满1日）`;
  if (p.state === 'zero_base') return `${value}（基期为0）`;
  if (p.change === null || !Number.isFinite(p.change))
    return `${value}（缺对比）`;
  return `${value}(${p.change > 0 ? '+' : ''}${p.change}%)`;
}
export function socialPeriodTitle(p: SocialPeriod) {
  const current = p.start
    ? `本期${p.start}至${p.end}：${p.count ?? '未知'}条`
    : '尚未回查';
  const previous = p.previousStart
    ? `前期${p.previousStart}至${p.previousEnd}：${p.previousCount ?? '未知'}条`
    : '';
  const means =
    p.currentMean === null || p.currentMean === undefined
      ? ''
      : `日均${p.currentMean.toFixed(2)}，此前日均${p.previousMean?.toFixed(2) ?? '未知'}`;
  return [
    current,
    previous,
    means,
    p.reason,
    p.collectedAt ? `采集于${p.collectedAt}` : '',
    p.stale ? '本次历史未取全，保留上次成功环比' : '',
  ]
    .filter(Boolean)
    .join('；');
}

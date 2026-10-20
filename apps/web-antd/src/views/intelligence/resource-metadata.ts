import type { Product, Site } from './data';

// Collection timestamps only: source publication, first discovery, metric dates and
// task start/finish dates must not be presented as a successful resource capture.
function latest(values: (string | undefined)[]) {
  return values
    .filter(
      (value): value is string => !!value && Number.isFinite(Date.parse(value)),
    )
    .toSorted((a, b) => Date.parse(b) - Date.parse(a))[0];
}
export const siteCollectedAt = (
  site: Pick<Site, 'lastCollectedAt' | 'sourceEvidence'>,
) =>
  latest([
    site.lastCollectedAt,
    ...(site.sourceEvidence || []).map((item) => item.collectedAt),
  ]);
export const productCollectedAt = (
  product: Pick<Product, 'lastCollectedAt' | 'sourceContent' | 'sourceMetrics'>,
) =>
  latest([
    product.lastCollectedAt,
    product.sourceMetrics?.collectedAt,
    product.sourceContent?.collectedAt,
  ]);
export function collectionTimeLabel(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未记录';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}（仅日期）`;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
export const collectionTimeOrder = (value?: string) =>
  value ? Date.parse(value) || 0 : 0;

import type { WatchConfig, WatchRun } from './competitor-monitor';
import type { MarketFilter, Product } from './data';

export interface ProductMonitor {
  id: string;
  productId: string;
  enabled: boolean;
  frequency: string;
}
export interface FocusedMonitorRow {
  id: string;
  title: string;
  subtitle: string;
  kind: 'advertiser' | 'product' | 'site';
  market: string;
  enabled: boolean;
  fields: string;
  schedule: string;
  target?: WatchConfig;
  legacy?: ProductMonitor;
  run?: WatchRun;
}
export function focusedMonitorRows(
  products: Product[],
  monitors: ProductMonitor[],
  targets: WatchConfig[],
  runs: WatchRun[],
  market: MarketFilter,
): FocusedMonitorRow[] {
  const rows: FocusedMonitorRow[] = [];
  for (const target of targets) {
    if (market !== 'ALL' && target.market !== market) continue;
    let subtitle = target.pageId ? `关联广告主 ${target.pageId}` : '独立站';
    if (target.kind === 'advertiser') subtitle = `Page ID ${target.pageId}`;
    rows.push({
      id: `competitor:${target.id}`,
      kind: target.kind,
      market: target.market,
      title: target.label,
      subtitle,
      enabled: target.enabled,
      schedule: `每天 ${String(target.hour).padStart(2, '0')}:00`,
      fields: [target.siteId ? '新品' : '', target.pageId ? '新广告' : '']
        .filter(Boolean)
        .join(' / '),
      target,
      run: runs.find((run) => run.id === target.id),
    });
  }
  for (const monitor of monitors) {
    const product = products.find((p) => p.id === monitor.productId);
    if (!product || (market !== 'ALL' && product.market !== market)) continue;
    rows.push({
      id: `product:${monitor.id}`,
      kind: 'product',
      market: product.market,
      title: product.title,
      subtitle: product.brand,
      enabled: monitor.enabled,
      schedule: monitor.frequency,
      fields: '价格 / 库存状态 / 配方',
      legacy: monitor,
    });
  }
  return rows;
}

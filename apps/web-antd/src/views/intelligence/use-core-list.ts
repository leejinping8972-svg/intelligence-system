import { computed, ref } from 'vue';
import { useWindowSize } from '@vueuse/core';
import type { ComputedRef } from 'vue';
import type { CoreKind, CorePeriod, EvidenceMetric } from './core-list-metrics';
import type { Ad, Keyword, Product, Site } from './data';
import { coreExport, coreMetrics } from './core-list-metrics';
import { coreListContext } from './core-list-context';
import { state } from './data';
import { serverMode } from './session';

const presets: Record<CoreKind, Array<[string, string]>> = {
  products: [
    ['priceOriginal', '原币价格'],
    ['priceUsd', '美元对比价'],
    ['sales', '所选周期销量'],
    ['dailySales', '日均件数'],
    ['ingredients', '成分与剂量'],
    ['claim', '品牌宣称'],
  ],
  sites: [
    ['organicTraffic', '自然搜索流量估算'],
    ['paidTraffic', '付费搜索流量估算'],
    ['organicKeywords', '搜索关键词覆盖'],
    ['linkedAds', '关联广告'],
    ['linkedProducts', '商品覆盖'],
    ['referenceUse', '参考用途'],
  ],
  ads: [
    ['status', '状态'],
    ['startDate', '平台开始日期'],
    ['firstObserved', '首次观察'],
    ['lastObserved', '最近观察'],
    ['sellingPoints', '素材卖点'],
    ['linkedProducts', '关联商品'],
    ['linkedSites', '关联站点'],
  ],
  keywords: [
    ['searchVolume', '月搜索量估算'],
    ['relativeHeat', '相对热度'],
    ['trendChange', '周期热度变化'],
    ['expansionCount', '去重扩词'],
    ['relatedTop', '热门相关查询'],
    ['relatedRising', '上升相关查询'],
  ],
};
const extra: Record<CoreKind, Array<[string, string]>> = {
  products: [
    ['cumulativeSold', '累计展示已售'],
    ['listingDate', '上架时间'],
    ['spec', '规格'],
    ['sellingPoints', '卖点'],
  ],
  sites: [
    ['paidKeywords', '付费关键词覆盖'],
    ['trafficChange', '搜索流量快照变化'],
    ['revenue', '实际营收'],
    ['roas', '实际ROAS'],
  ],
  ads: [
    ['creative', '素材'],
    ['landingPages', '落地页'],
    ['spend', '花费'],
    ['impressions', '曝光'],
    ['clicks', '点击'],
    ['purchases', '购买'],
    ['roas', 'ROAS'],
  ],
  keywords: [
    ['autocomplete', '搜索联想词数'],
    ['aiSuggestions', 'AI建议词数'],
    ['otherExpansion', '其他扩词数'],
    ['linkedProducts', '关联商品'],
    ['linkedSites', '关联站点'],
  ],
};
type Column = {
  key?: string;
  title?: string;
  dataIndex?: string;
  width?: number;
  fixed?: 'left' | 'right' | boolean;
};
export function useCoreList(kind: CoreKind) {
  const { width } = useWindowSize();
  const preset = ref('original');
  const period = ref<CorePeriod>(30);
  const context = () => ({
    complete: !serverMode,
    products: state.products,
    sites: state.sites,
    ads: state.ads,
    keywords: state.keywords,
    fx: coreListContext.fx,
  });
  function columns<T extends Column>(base: T[]) {
    const responsive =
      width.value < 768
        ? base.map((c) => ({ ...c, fixed: false as const }))
        : base;
    if (preset.value === 'original') return responsive;
    const identity = responsive.filter((c) =>
      ['product', 'brand', 'term', 'market', 'category', 'actions'].includes(
        c.key || '',
      ),
    );
    const actions = identity.filter((c) => c.key === 'actions');
    const fields: Array<[string, string]> = [
      ...presets[kind],
      ...(preset.value === 'evidence' ? extra[kind] : []),
      ['sourceContext', '来源 / 更新时间'],
    ];
    return [
      ...identity.filter((c) => c.key !== 'actions'),
      ...fields.map(([key, title]) => ({
        key: `core:${key}`,
        title,
        width: [
          'ingredients',
          'referenceUse',
          'claim',
          'sellingPoints',
          'relatedTop',
          'relatedRising',
          'creative',
          'landingPages',
        ].includes(key)
          ? 230
          : kind === 'products' ? 116 : 165,
      })),
      ...actions,
    ];
  }
  const metricCache = new WeakMap<object, ComputedRef<EvidenceMetric[]>>();
  function metric(record: Product | Site | Ad | Keyword, columnKey: unknown) {
    let metrics = metricCache.get(record);
    if (!metrics) {
      metrics = computed(() =>
        coreMetrics(kind, record, period.value, context()),
      );
      metricCache.set(record, metrics);
    }
    const found = metrics.value.find(
      (m) => m.key === String(columnKey).replace('core:', ''),
    );
    if (!found) throw new Error(`Unknown core metric: ${String(columnKey)}`);
    return found;
  }
  function exportRecord(record: Product | Site | Ad | Keyword) {
    return coreExport(kind, record, context());
  }
  return { preset, period, columns, metric, exportRecord };
}

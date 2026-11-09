import type { Keyword } from './data';

type Collection = 'ads' | 'products' | 'sites';

export function keywordAssociationColumns(
  server: boolean,
  count: (record: Keyword, collection: Collection) => number,
) {
  return ([
    { title: '关联广告', key: 'relatedAds', collection: 'ads', width: 88 },
    { title: '关联商品', key: 'relatedProducts', collection: 'products', width: 88 },
    { title: '关联独立站', key: 'relatedSites', collection: 'sites', width: 98 },
  ] as const).map(({ collection, ...column }) => ({
    ...column,
    sortDirections: ['descend', 'ascend'] as ('ascend' | 'descend')[],
    sorter: server ? true : (a: Keyword, b: Keyword) => count(a, collection) - count(b, collection),
  }));
}

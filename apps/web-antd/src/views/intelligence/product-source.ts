import type { Product } from './data';
export const productProvider = (product: Pick<Product, 'sourceProvider' | 'dataNature' | 'siteId'>) => product.sourceProvider || (product.dataNature === 'demo' ? '演示样本' : '人工导入 / 来源待确认');
export const productPlatform = (product: Pick<Product, 'sourcePlatform' | 'siteId'>) => product.sourcePlatform || '未记录';

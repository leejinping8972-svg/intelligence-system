import type { Product } from './data';
export const productProvider = (product: Pick<Product, 'sourceProvider' | 'dataNature' | 'siteId'>) => product.sourceProvider || (product.dataNature === 'demo' ? '演示样本' : '人工导入 / 来源待确认');
export const productPlatform = (product: Pick<Product, 'sourcePlatform' | 'siteId'>) => product.sourcePlatform || '未记录';
export const productSiteLabel = (product: Pick<Product, 'siteId' | 'linkedSite'>, fallbackDomain = '') => !product.siteId ? '未关联' : product.linkedSite?.domain || (product.linkedSite === null ? '关联站点已移除' : fallbackDomain || '站点信息待加载');

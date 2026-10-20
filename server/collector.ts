export { default } from '../workers/site-discovery/src/index.js';
export { connect as connectSorftime } from '../workers/site-discovery/src/sorftime.js';
export { readSorftimeToken } from '../workers/site-discovery/src/provider-config.js';

export {
  classifyStore,
  inferCategory,
  isCandidateUrl,
  hostnameRoot,
  extractJsonLdProducts,
  productFromJsonLd,
  productPageUrls,
} from '../workers/site-discovery/src/index.js';

export {
  fetchGoogleTrendsBatch,
  calculate28DayGrowth,
  calculate30DayGrowth,
  trendSeriesMessage,
} from '../workers/site-discovery/src/index.js';

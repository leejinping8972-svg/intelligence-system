export { default } from '../workers/site-discovery/src/index.js';

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
  trendSeriesMessage,
} from '../workers/site-discovery/src/index.js';

import { configuredJson } from './discovery-ai.mjs';
import { PRODUCT_KEYWORDS_PROMPT, validateProductKeywords } from './product-keywords-domain.mjs';

export async function productKeywordsRequest(request, overrides = {}) {
  const response = await configuredJson(PRODUCT_KEYWORDS_PROMPT, request.sample, overrides);
  let keywords;
  try { keywords = validateProductKeywords(response.result, request.sample); }
  catch (error) {
    throw Object.assign(error, { rawPreview: {
      kind: 'product_keywords', model: response.model, preview: JSON.stringify(response.result).slice(0, 2500),
    } });
  }
  return {
    keywords,
    usage: response.usage, model: response.model,
  };
}

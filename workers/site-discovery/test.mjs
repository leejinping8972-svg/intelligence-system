import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- this Worker package uses Node's built-in test runner
import test from 'node:test';

import {
  braveSearchRequest,
  classifyStore,
  extractJsonLdProducts,
  hostnameRoot,
  isCandidateUrl,
  productPageUrl,
} from './src/index.js';

test('uses Brave-compatible targeting for Vietnam', () => {
  const request = braveSearchRequest('Sức khỏe phụ nữ', 'VN', 20);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('country'), 'ALL');
  assert.equal(url.searchParams.get('search_lang'), 'vi');
  assert.match(url.searchParams.get('q'), /Việt Nam/);
  assert.equal(request.locationCountry, 'VN');
});

const productPage = `<!doctype html><html><head>
<meta property="og:site_name" content="Natura Lab">
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Product",
  "name":"Daily Probiotic","sku":"DP-30",
  "brand":{"@type":"Brand","name":"Natura Lab"},
  "offers":{"@type":"Offer","price":"32.00","priceCurrency":"USD"}
}</script></head><body class="shopify"><button>Add to cart</button>
<a href="/checkout">Checkout</a><script src="https://cdn.shopify.com/a.js"></script></body></html>`;

test('extracts Product JSON-LD', () => {
  const products = extractJsonLdProducts(productPage);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Daily Probiotic');
});

test('classifies a product-selling independent site', () => {
  const result = classifyStore(
    productPage,
    'https://example.com/products/daily',
  );
  assert.equal(result.isIndependentStore, true);
  assert.equal(result.platform, 'Shopify');
  assert.ok(result.confidence >= 80);
});

test('rejects marketplaces, assets and local addresses', () => {
  assert.equal(isCandidateUrl('https://amazon.com/product/1'), false);
  assert.equal(isCandidateUrl('https://brand.com/image.jpg'), false);
  assert.equal(isCandidateUrl('http://127.0.0.1/product'), false);
  assert.equal(isCandidateUrl('https://brand.com/products/a'), true);
});

test('normalizes common country-code domains', () => {
  assert.equal(hostnameRoot('shop.brand.com.mx'), 'brand.com.mx');
  assert.equal(hostnameRoot('www.brand.com'), 'brand.com');
});

test('finds an on-site product page without following external links', () => {
  const html =
    '<a href="https://marketplace.example/products/a">External</a>' +
    '<a href="/products/daily-probiotic">Product</a>';
  assert.equal(
    productPageUrl(html, 'https://brand.com/'),
    'https://brand.com/products/daily-probiotic',
  );
});

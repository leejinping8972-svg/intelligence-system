import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- this Worker package uses Node's built-in test runner
import test from 'node:test';

import {
  amazonSuggestUrl,
  braveSearchRequest,
  calculate28DayGrowth,
  classifyStore,
  extractJsonLdProducts,
  googleCookieHeader,
  googleSuggestUrl,
  googleTrendsExploreUrl,
  hostnameRoot,
  inferCategory,
  isCandidateUrl,
  parseGoogleTrendsPayload,
  productFromJsonLd,
  productPageUrl,
  productPageUrls,
  trendSeriesMessage,
} from './src/index.js';

test('builds localized Google suggestion requests', () => {
  const url = new URL(googleSuggestUrl('sức khỏe phụ nữ', 'VN'));
  assert.equal(url.hostname, 'suggestqueries.google.com');
  assert.equal(url.searchParams.get('gl'), 'vn');
  assert.equal(url.searchParams.get('hl'), 'vi');
});

test('builds Amazon requests only for local marketplaces', () => {
  const us = new URL(amazonSuggestUrl('probiotic', 'US'));
  const mx = new URL(amazonSuggestUrl('probioticos', 'MX'));
  assert.equal(us.hostname, 'completion.amazon.com');
  assert.equal(mx.hostname, 'completion.amazon.com.mx');
  assert.equal(amazonSuggestUrl('men vi sinh', 'VN'), null);
});

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

test('extracts image, formula, size, benefits and ingredient records', () => {
  const record = productFromJsonLd(
    {
      '@type': 'Product',
      name: 'Daily Probiotic Capsules',
      image: '/daily.webp',
      size: '30 capsules',
      ingredients: 'Lactobacillus acidophilus 10 mg, Inulin 100 mg',
      description: 'Supports digestive balance. Designed for daily use.',
    },
    'https://example.com/products/daily',
    'US',
    'Natura Lab',
  );
  assert.equal(record.image, 'https://example.com/daily.webp');
  assert.equal(record.form, '胶囊');
  assert.equal(record.size, '30 capsules');
  assert.equal(record.benefits.length, 2);
  assert.equal(record.ingredientInsights.length, 2);
  assert.ok(record.collectionFields.includes('配方'));

  const labeled = productFromJsonLd(
    {
      '@type': 'Product',
      name: 'Fiber Powder 30 servings',
      description: 'Helps support digestive regularity.',
    },
    'https://example.com/products/fiber',
    'US',
    'Natura Lab',
    '<h3>Ingredients</h3><p>Inulin 5 g, Psyllium husk 3 g</p>',
  );
  assert.equal(labeled.size, '30 servings');
  assert.match(labeled.ingredients, /Inulin/);
  assert.match(labeled.ingredientInsights[0].role, /膳食纤维/);

  const sanitized = productFromJsonLd(
    {
      '@type': 'Product',
      name: 'Multi Collagen Peptides Powder',
      ingredients: 'trên cùng một trục ngang */ display:flex',
      description: 'Hydrolyzed collagen peptide formula.',
    },
    'https://example.vn/products/collagen',
    'VN',
    'Codeage',
    '<style>.ingredients{/* trên cùng một trục ngang */}</style><meta property="og:image" content="/collagen.webp"><h3>Thành phần</h3><p>Hydrolyzed collagen peptides 10 g</p>',
  );
  assert.equal(sanitized.image, 'https://example.vn/collagen.webp');
  assert.equal(sanitized.ingredients, 'Hydrolyzed collagen peptides 10 g');

  const marketingCopy = productFromJsonLd(
    {
      '@type': 'Product',
      name: 'Women Probiotic',
      ingredients:
        'work together to support balanced vaginal and gut microbiomes',
    },
    'https://example.com/products/women-probiotic',
    'US',
    'Example',
    '<h3>Ingredients</h3><p>Label Directions</p>',
  );
  assert.equal(marketingCopy.ingredients, '');
  assert.deepEqual(marketingCopy.ingredientInsights, []);
  assert.ok(!marketingCopy.collectionFields.includes('配方'));
});

test('classifies supplement categories from multilingual evidence', () => {
  assert.equal(inferCategory('men vi sinh cho nữ'), '肠道与益生菌');
  assert.equal(inferCategory('multi collagen beauty powder'), '美容与抗衰');
  assert.equal(inferCategory('creatine sport nutrition'), '运动营养');
});

test('builds and calculates Google Trends series', () => {
  const url = new URL(
    googleTrendsExploreUrl(
      ['sức khỏe phụ nữ', 'sức khỏe phụ nữ tuổi 30'],
      'VN',
    ),
  );
  const request = JSON.parse(url.searchParams.get('req'));
  assert.equal(request.comparisonItem[0].geo, 'VN');
  assert.equal(request.comparisonItem[0].time, 'today 3-m');
  assert.equal(request.comparisonItem[1].keyword, 'sức khỏe phụ nữ tuổi 30');
  assert.deepEqual(parseGoogleTrendsPayload(`)]}',\n{"ok":true}`), {
    ok: true,
  });
  assert.equal(
    calculate28DayGrowth([
      ...Array.from({ length: 28 }, () => 50),
      ...Array.from({ length: 28 }, () => 75),
    ]),
    50,
  );
  assert.equal(
    calculate28DayGrowth(Array.from({ length: 20 }, () => 10)),
    null,
  );
  assert.equal(
    trendSeriesMessage([
      ...Array.from({ length: 28 }, () => 0),
      ...Array.from({ length: 28 }, () => 4),
    ]),
    '此前28天均值为0，最近28天已出现搜索信号，无法计算百分比变化',
  );
});

test('keeps only cookie pairs for a Google Trends session', () => {
  assert.equal(
    googleCookieHeader('NID=abc; Path=/; Secure, CONSENT=yes; Path=/'),
    'NID=abc; CONSENT=yes',
  );
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
  assert.deepEqual(
    productPageUrls(
      '<a href="/products/a">A</a><a href="/products/b">B</a>',
      'https://brand.com/',
      2,
    ),
    ['https://brand.com/products/a', 'https://brand.com/products/b'],
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runProductsJob,
  initializeProducts,
  canonicalCatalogUrl,
  shopifyCatalogProducts,
  productProgress,
  productKeywordIds,
  productFromMetadata,
  productPacing,
  resumeProductFallbacks,
} from './product-queue.mjs';
import { normalizeProduct, siteBase } from './product-jobs.mjs';

function harness(n = 2, maxRequests = 20) {
  let clock = Date.now(),
    saved;
  const calls = [],
    docs = new Map(),
    gates = new Map();
  const job = {
    id: 'qa-product',
    status: 'queued',
    input: {
      kind: 'products',
      records: Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        brand: `Brand ${i}`,
        domain: `s${i}.example`,
        market: 'US',
        platform: 'Shopify',
      })),
      maxProducts: 100,
      maxRequests,
    },
    checkpoint: {},
  };
  const io = {
    now: () => clock,
    random: () => 0,
    cancelled: async () => false,
    getHostGate: async (s) => gates.get(s.id) || {},
    setHostGate: async (s, g) => gates.set(s.id, g),
    saveCheckpoint: async (j, cp, status = 'running') => {
      saved = structuredClone({ ...j, checkpoint: cp, status });
    },
    patchSite: async (id, p) => docs.set(id, p),
    linkKeywords: async () => {},
    mergeBusiness: async (k, v) => docs.set(k, v),
    readProduct: async (id) => docs.get(`products:${id}`),
    fetchPage: async (url) => {
      calls.push(url);
      return {
        url,
        html: JSON.stringify({
          products: [
            {
              title: 'Creatine Gummies',
              handle: 'creatine',
              vendor: 'B',
              images: [{ src: 'https://cdn.example/creatine.jpg' }],
              variants: [{ price: '29.95', sku: 'SKU-1' }],
              body_html: '<p>Ingredients: Creatine monohydrate, glucose.</p>',
            },
          ],
        }),
      };
    },
  };
  return {
    job,
    io,
    calls,
    docs,
    gates,
    get saved() {
      return saved;
    },
    advance: (ms) => {
      clock +=
        ms ?? Math.max(1, (saved?.checkpoint.nextRunAt || clock) - clock + 1);
    },
    now: () => clock,
  };
}

function dynamicHarness(maxRequests = 20) {
  const h = harness(1, maxRequests);
  Object.assign(h.job.input, {
    collectionPolicyVersion: 1,
    maxBrowserPages: 5,
    maxPaidRequests: 0,
  });
  h.job.checkpoint = initializeProducts(h.job, h.now());
  h.job.checkpoint.siteWork[0].urls = ['https://s0.example/products/dynamic'];
  h.io.fetchPage = async (url) => {
    h.calls.push(url);
    return {
      url,
      html: '<div id="app"></div><script src="/bundle.js"></script>',
    };
  };
  return h;
}
const productHtml =
  '<script type="application/ld+json">{"@type":"Product","name":"Creatine","url":"https://s0.example/products/dynamic","image":"https://s0.example/c.jpg"}</script>';
test('dynamic page schedules a bounded browser attempt on another dispatch and preserves product provenance', async () => {
  const h = dynamicHarness();
  let renders = 0;
  h.io.fetchFallback = async (url, site, mode) => {
    assert.equal(mode, 'browser');
    renders++;
    return { url, html: productHtml, resourceRequests: 2 };
  };
  await runProductsJob(h.job, h.io);
  assert.equal(renders, 0);
  assert.equal(h.saved.checkpoint.siteWork[0].status, 'retry_wait');
  h.advance();
  await runProductsJob(h.saved, h.io);
  assert.equal(renders, 1);
  assert.equal(h.saved.checkpoint.browserPages, 1);
  assert.equal(h.saved.checkpoint.paidRequests || 0, 0);
  assert.match(
    [...h.docs.values()].find((v) => v.evidenceUrl).extractionMethod,
    /浏览器渲染/,
  );
});
test('paid fallback stays off by default and a zero browser budget cannot silently switch to hosted', async () => {
  const h = dynamicHarness();
  h.job.input.maxBrowserPages = 0;
  h.io.fetchFallback = async () => {
    throw new Error('must not call');
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.checkpoint.browserPages || 0, 0);
  assert.equal(h.saved.checkpoint.paidRequests || 0, 0);
});
test('explicit paid fallback waits for host cooldown; network failure never retries a billable request', async () => {
  const h = dynamicHarness();
  h.job.input.maxPaidRequests = 2;
  h.io.fetchPage = async () => {
    throw Object.assign(new Error('HTTP 403'), { status: 403 });
  };
  let calls = 0;
  h.io.fetchFallback = async (url, site, mode) => {
    assert.equal(mode, 'hosted');
    calls++;
    throw new Error('托管响应未知');
  };
  await runProductsJob(h.job, h.io);
  assert.equal(calls, 0);
  assert.equal(h.saved.checkpoint.siteWork[0].nextRunAt, h.now() + 1800000);
  await runProductsJob(h.saved, h.io);
  assert.equal(calls, 0);
  h.advance();
  await runProductsJob(h.saved, h.io);
  assert.equal(calls, 1);
  assert.equal(h.saved.checkpoint.paidRequests, 1);
  assert.equal(h.saved.checkpoint.siteWork[0].status, 'partial');
  h.advance();
  await runProductsJob(h.saved, h.io);
  assert.equal(calls, 1);
});
test('in-flight hosted recovery retains the reserved counter and never sends again', async () => {
  const h = dynamicHarness();
  h.job.input.maxPaidRequests = 2;
  Object.assign(h.job.checkpoint, {
    paidRequests: 1,
    requests: 1,
    inFlight: {
      index: 0,
      url: 'https://s0.example/products/dynamic',
      method: 'hosted',
    },
  });
  h.io.fetchFallback = async () => {
    throw new Error('must not replay');
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.checkpoint.paidRequests, 1);
  assert.match(h.saved.checkpoint.siteWork[0].message, /不自动重放/);
  assert.equal(h.saved.checkpoint.siteWork[0].status, 'partial');
});
test('browser and hosted attempts cannot exceed overall page budget', async () => {
  const h = dynamicHarness(1);
  h.job.input.maxPaidRequests = 1;
  let calls = 0;
  h.io.fetchFallback = async () => {
    calls++;
  };
  await runProductsJob(h.job, h.io);
  h.advance();
  await runProductsJob(h.saved, h.io);
  assert.equal(calls, 0);
  assert.equal(h.saved.checkpoint.requests, 1);
  assert.equal(h.saved.checkpoint.siteWork[0].status, 'partial');
});
test('first round touches every site; a busy catalog cannot consume the entire batch', async () => {
  const h = harness(8, 100);
  for (let i = 0; i < 8; i++) await runProductsJob(h.saved || h.job, h.io);
  assert.equal(new Set(h.calls.map((u) => new URL(u).hostname)).size, 8);
  assert.equal(h.saved.checkpoint.requests, 8);
  assert.equal(h.saved.checkpoint.products, 8);
  assert.ok(h.saved.checkpoint.siteWork.every((w) => w.requests === 1));
});
test('429 cools only its own site; healthy sites continue and Retry-After is honored', async () => {
  const h = harness();
  const original = h.io.fetchPage;
  h.io.fetchPage = async (url) => {
    if (new URL(url).hostname === 's0.example') {
      h.calls.push(url);
      throw Object.assign(new Error('HTTP 429'), {
        status: 429,
        retryAfterSeconds: 600,
      });
    }
    return original(url);
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.checkpoint.siteWork[0].nextRunAt, h.now() + 600000);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.saved.checkpoint.products, 1);
  assert.equal(h.saved.checkpoint.siteWork[0].requests, 1);
  assert.equal(h.gates.get('s0').until, h.now() + 600000);
  assert.equal(productProgress(h.saved.checkpoint, h.job.input).waiting, 1);
});
test('catalog products are saved immediately with real image, price and evidence', async () => {
  const h = harness(1, 1);
  await runProductsJob(h.job, h.io);
  const p = [...h.docs.values()].find((v) => v.evidenceUrl);
  assert.equal(p.imageUrl, 'https://cdn.example/creatine.jpg');
  assert.equal(p.price, 29.95);
  assert.equal(p.evidenceUrl, 'https://s0.example/products/creatine');
  assert.match(p.ingredient, /Creatine monohydrate/);
  assert.equal(h.saved.checkpoint.products, 1);
});
test('subdomain storefronts use the verified shop origin and stay inside official domain', () => {
  const site = {
    id: 'g',
    domain: 'goldsgym.com',
    evidenceUrl: 'https://shop.goldsgym.com/products/creatine',
    market: 'US',
  };
  assert.equal(siteBase(site), 'https://shop.goldsgym.com');
  assert.doesNotThrow(() =>
    normalizeProduct(
      { title: 'X', url: 'https://shop.goldsgym.com/products/x' },
      site,
    ),
  );
  assert.throws(() =>
    normalizeProduct(
      { title: 'X', url: 'https://goldsgym.com.evil.example/products/x' },
      site,
    ),
  );
  assert.equal(
    siteBase({ ...site, evidenceUrl: 'https://evil.example/products/x' }),
    'https://goldsgym.com',
  );
});
test('tracking parameters are removed while query-based product identity is retained', () => {
  const base = 'https://s.example';
  assert.equal(
    canonicalCatalogUrl('/products/a?utm_source=x&variant=2#foo', base),
    'https://s.example/products/a?variant=2',
  );
  assert.equal(
    canonicalCatalogUrl('/collections/all?sort_by=best-selling&page=2', base),
    'https://s.example/collections/all?page=2',
  );
  assert.equal(
    canonicalCatalogUrl('https://evil.example/products/a', base),
    null,
  );
});
test('reaching the catalog product cap still completes queued detail evidence', async () => {
  const h = harness(1, 3);
  h.job.input.maxProducts = 1;
  h.job.input.maxDetailProducts = 1;
  h.job.input.collectionPolicyVersion = 4;
  const original = h.io.fetchPage;
  h.io.fetchPage = async (url) => {
    if (url.includes('/products/creatine')) {
      h.calls.push(url);
      return {
        url,
        html: '<script type="application/ld+json">{"@type":"Product","name":"Creatine Gummies","url":"https://s0.example/products/creatine","image":"https://s0.example/new.jpg","additionalProperty":[{"name":"Ingredients","value":"Creatine monohydrate 5 g"},{"name":"Serving Size","value":"2 gummies"}]}</script>',
      };
    }
    return original(url);
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.checkpoint.siteWork[0].productIds.length, 1);
  assert.equal(h.saved.checkpoint.siteWork[0].detailTargets.length, 1);
  assert.notEqual(h.saved.status, 'completed');
  h.advance();
  await runProductsJob(h.saved, h.io);
  const progress = productProgress(h.saved.checkpoint, h.job.input);
  assert.equal(progress.detailTarget, 1);
  assert.equal(progress.detailCompleted, 1);
  assert.equal(h.saved.status, 'completed');
  assert.equal(
    h.calls.filter((url) => url.includes('/products/creatine')).length,
    1,
  );
});
test('single-site request ceiling is enforced before moving on and total cap is never exceeded', async () => {
  const h = harness(2, 4);
  h.job.input.maxRequestsPerSite = 1;
  await runProductsJob(h.job, h.io);
  await runProductsJob(h.saved, h.io);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.calls.length, 2);
  assert.equal(h.saved.status, 'partial');
  assert.ok(h.saved.checkpoint.siteWork.every((w) => w.requests === 1));
});
test('restart preserves saved products and records an interrupted free page request as unknown', async () => {
  const h = harness();
  h.job.checkpoint = initializeProducts(h.job, h.now());
  h.job.checkpoint.requests = 1;
  h.job.checkpoint.siteWork[0].requests = 1;
  h.job.checkpoint.inFlight = {
    index: 0,
    url: 'https://s0.example/products.json',
    at: new Date(h.now()).toISOString(),
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0], /s1.example/);
  assert.equal(h.saved.checkpoint.requestLog[0].status, 'unknown');
  assert.equal(h.saved.checkpoint.requests, 2);
});
test('403 is explicit manual attention and never prevents the next site from running', async () => {
  const h = harness(),
    original = h.io.fetchPage;
  h.io.fetchPage = async (url) => {
    if (url.includes('s0.example')) {
      h.calls.push(url);
      throw Object.assign(new Error('HTTP 403'), { status: 403 });
    }
    return original(url);
  };
  await runProductsJob(h.job, h.io);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.saved.checkpoint.siteWork[0].status, 'blocked');
  assert.equal(h.saved.checkpoint.products, 1);
});
test('cancelled tasks issue no new request and 24h expiry settles all remaining sites', async () => {
  const h = harness();
  await runProductsJob(h.job, { ...h.io, cancelled: async () => true });
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.status, 'cancelled');
  const h2 = harness();
  h2.job.checkpoint = initializeProducts(h2.job, h2.now());
  h2.advance(86400001);
  await runProductsJob(h2.job, h2.io);
  assert.equal(h2.calls.length, 0);
  assert.equal(h2.saved.status, 'partial');
  assert.equal(h2.saved.checkpoint.index, 2);
});
test('a real empty catalog does not fabricate products or claim a successful collection', async () => {
  const h = harness(1, 1);
  h.io.fetchPage = async (url) => ({ url, html: '{"products":[]}' });
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.checkpoint.products, 0);
  assert.equal(h.saved.status, 'partial');
  assert.throws(
    () =>
      shopifyCatalogProducts({}, 'https://s.example', h.job.input.records[0]),
    /目录格式/,
  );
});

test('an unavailable JSON catalog falls back to the product page instead of abandoning the site', async () => {
  const h = harness(1, 3);
  h.io.fetchPage = async (url) => {
    h.calls.push(url);
    return {
      url,
      html: url.includes('products.json')
        ? '<html>Catalog is not available</html>'
        : '<script type="application/ld+json">' +
          JSON.stringify({
            '@type': 'Product',
            name: 'Creatine',
            url: 'https://s0.example/products/creatine',
            image: 'https://cdn.example/creatine.jpg',
          }) +
          '</script>',
    };
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.status, 'running');
  h.advance(30001);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.saved.checkpoint.products, 1);
  assert.equal(h.calls.length, 2);
});
test('legacy sites without keywordIds still associate products through saved site links and source evidence', () => {
  const site = {
    id: 's',
    market: 'US',
    keyword: 'creatine',
    sourceEvidence: [{ keyword: 'gummy creatine' }],
  };
  const records = [
    { id: 'a', term: 'creatine', market: 'US' },
    { id: 'b', term: 'unrelated', market: 'US', siteIds: ['s'] },
    { id: 'c', term: 'gummy creatine', market: 'US' },
    { id: 'd', term: 'creatine', market: 'MX' },
  ];
  assert.deepEqual(productKeywordIds(site, records), ['a', 'b', 'c']);
});
test('unstructured product pages require matching H1, canonical URL and image; missing formulation stays unknown', () => {
  const url = 'https://s0.example/products/herbs/mushroom-capsules/';
  const html = `<h1>Mushroom Capsules</h1><meta property="og:type" content="article"><meta property="og:title" content="Mushroom Capsules"><meta property="og:url" content="${url}"><meta property="og:image" content="https://cdn.example/p.jpg"><meta name="description" content="Manufacturer product catalog">`;
  const site = { id: 's0', domain: 's0.example', brand: 'B', market: 'US' };
  const p = productFromMetadata(html, url, site);
  assert.equal(p.title, 'Mushroom Capsules');
  assert.equal(p.image, 'https://cdn.example/p.jpg');
  assert.equal(p.ingredients, '');
  assert.equal(
    productFromMetadata(
      html.replace('<h1>Mushroom Capsules</h1>', '<h1>Herbs Category</h1>'),
      url,
      site,
    ),
    null,
  );
  assert.equal(
    productFromMetadata(
      html,
      'https://s0.example/blog/mushroom-capsules/',
      site,
    ),
    null,
  );
});

test('templates, encoded placeholders and JS property links never enter page or product queues', async () => {
  const base = 'https://s0.example';
  for (const path of [
    '/products/item.url',
    '/products/product.handle',
    '/products/%7B%7Bhandle%7D%7D',
    '/products/%2524%257Bitem.url%257D',
    '/products/[slug]',
    '/products/undefined',
    '/products/null',
    '/products/[object Object]',
  ])
    assert.equal(canonicalCatalogUrl(path, base), null, path);
  assert.equal(
    canonicalCatalogUrl('/products/creatine-gummies', base),
    base + '/products/creatine-gummies',
  );
  assert.equal(
    shopifyCatalogProducts(
      {
        products: [
          { handle: 'item.url', title: 'Template' },
          { handle: 'creatine', title: 'Real' },
        ],
      },
      base,
      { market: 'US' },
    ).length,
    1,
  );
  const h = harness(1, 5);
  h.job.checkpoint = initializeProducts(h.job, h.now());
  Object.assign(h.job.checkpoint.siteWork[0], {
    urls: [base + '/products/item.url', base + '/products/creatine'],
    productIds: ['saved-product'],
    requests: 2,
  });
  h.job.checkpoint.products = 1;
  h.job.checkpoint.requests = 2;
  await runProductsJob(h.job, h.io);
  assert.equal(h.calls[0], base + '/products/creatine');
  assert.equal(h.saved.checkpoint.requests, 3);
  assert.ok(
    h.saved.checkpoint.siteWork[0].productIds.includes('saved-product'),
  );
});

test('catalog 429 waits for the entire host, then switches to a different public entry and saves products', async () => {
  const h = harness(2, 20),
    original = h.io.fetchPage;
  h.io.fetchPage = async (url) => {
    if (url === 'https://s0.example/products.json?limit=50&page=1') {
      h.calls.push(url);
      throw Object.assign(new Error('HTTP 429'), {
        status: 429,
        retryAfterSeconds: 1200,
      });
    }
    if (url === 'https://s0.example/sitemap.xml') {
      h.calls.push(url);
      return {
        url,
        html: '<urlset><url><loc>https://s0.example/products/creatine</loc></url><url><loc>https://s0.example/products/item.url</loc></url></urlset>',
      };
    }
    if (url === 'https://s0.example/products/creatine') {
      h.calls.push(url);
      return {
        url,
        html: '<script type="application/ld+json">{"@type":"Product","name":"Creatine","url":"https://s0.example/products/creatine"}</script>',
      };
    }
    return original(url);
  };
  await runProductsJob(h.job, h.io);
  assert.equal(h.saved.checkpoint.siteWork[0].nextRunAt, h.now() + 1200000);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.saved.checkpoint.products, 1);
  h.advance(30000);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.calls.filter((u) => u.includes('s0.example')).length, 1);
  h.advance(1200000);
  await runProductsJob(h.saved, h.io);
  assert.equal(
    h.calls.filter((u) => u.includes('s0.example'))[1],
    'https://s0.example/sitemap.xml',
  );
  for (
    let i = 0;
    i < 6 && h.saved.checkpoint.siteWork[0].productIds.length === 0;
    i++
  ) {
    h.advance(30000);
    await runProductsJob(h.saved, h.io);
  }
  assert.ok(h.saved.checkpoint.siteWork[0].productIds.length > 0);
  assert.equal(
    h.calls.filter(
      (u) => u === 'https://s0.example/products.json?limit=50&page=1',
    ).length,
    1,
  );
  assert.ok(!h.calls.some((u) => u.includes('item.url')));
});

test('three distinct 429 responses open a host circuit instead of cycling the same address', async () => {
  const h = harness(1, 20);
  h.io.fetchPage = async (url) => {
    h.calls.push(url);
    throw Object.assign(new Error('HTTP 429'), { status: 429 });
  };
  for (let i = 0; i < 3; i++) {
    await runProductsJob(h.saved || h.job, h.io);
    h.advance();
  }
  assert.equal(h.saved.checkpoint.siteWork[0].status, 'blocked');
  assert.equal(h.saved.status, 'partial');
  assert.equal(new Set(h.calls).size, 3);
  assert.equal(h.calls.length, 3);
  const n = h.calls.length;
  await runProductsJob(h.saved, h.io);
  assert.equal(h.calls.length, n);
  assert.ok(h.gates.get('s0').until > h.now() - 2);
});

test('normal pacing is 20 to 30 seconds, survives restart and is shared by another job on the host', async () => {
  assert.equal(
    productPacing(() => 0),
    20000,
  );
  assert.equal(
    productPacing(() => 1),
    30000,
  );
  const h = harness(1, 20);
  await runProductsJob(h.job, h.io);
  const other = { ...h.job, id: 'another-job', checkpoint: {} };
  await runProductsJob(other, h.io);
  assert.equal(h.calls.length, 1);
  h.advance(19999);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.calls.length, 1);
  h.advance(2);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.calls.length, 2);
});

test('bounded recovery preserves counters and products, skips rejected paths, and does not reopen twice', () => {
  const h = harness(2, 20);
  h.job.checkpoint = initializeProducts(h.job, h.now());
  const cp = h.job.checkpoint;
  cp.requests = 7;
  cp.products = 2;
  cp.previousRequests = 100;
  Object.assign(cp.siteWork[0], {
    status: 'blocked',
    requests: 4,
    productIds: ['p1', 'p2'],
    message: '官网HTTP 429，需人工处理',
    attempts: { 'https://s0.example/products.json?limit=50&page=1': 4 },
  });
  cp.siteWork[1].status = 'completed';
  h.job.status = 'partial';
  assert.equal(
    resumeProductFallbacks({ ...h.job, cancelled: true }, h.now()),
    null,
  );
  assert.equal(
    resumeProductFallbacks({ ...h.job, status: 'running' }, h.now()),
    null,
  );
  const r = resumeProductFallbacks(h.job, h.now());
  assert.equal(r.requests, 7);
  assert.equal(r.products, 2);
  assert.equal(r.previousRequests, 100);
  assert.equal(r.siteWork[0].requests, 4);
  assert.deepEqual(r.siteWork[0].productIds, ['p1', 'p2']);
  assert.equal(r.siteWork[0].status, 'retry_wait');
  assert.equal(r.siteWork[0].nextRunAt, h.now() + 1800000);
  assert.ok(r.siteWork[0].urls.every((u) => !u.includes('products.json')));
  assert.equal(r.siteWork[1].status, 'completed');
  assert.equal(
    resumeProductFallbacks({ ...h.job, checkpoint: r }, h.now()),
    null,
  );
  assert.equal(
    resumeProductFallbacks(
      { ...h.job, checkpoint: { ...cp, requests: 20 } },
      h.now(),
    ),
    null,
  );
  assert.equal(resumeProductFallbacks(h.job, h.now() + 86400001), null);
});

test('catalog 404 falls back without retry, while a real timeout retains its retry classification', async () => {
  const h = harness(1, 10);
  h.io.fetchPage = async (url) => {
    h.calls.push(url);
    throw Object.assign(new Error('HTTP 404'), { status: 404 });
  };
  await runProductsJob(h.job, h.io);
  h.advance(30000);
  await runProductsJob(h.saved, h.io);
  assert.equal(h.calls[1], 'https://s0.example/sitemap.xml');
  assert.equal(new Set(h.calls).size, 2);
  const n = harness(1, 10);
  n.io.fetchPage = async () => {
    throw new Error('官网访问超时');
  };
  await runProductsJob(n.job, n.io);
  assert.equal(
    productProgress(n.saved.checkpoint, n.job.input).rows[0].errorKind,
    'network',
  );
  assert.equal(n.saved.checkpoint.siteWork[0].status, 'retry_wait');
});


test('official refresh retains prior cumulative sales and listing evidence when the new page omits them', async () => {
  const h = harness(1);
  const site = h.job.input.records[0];
  const old = normalizeProduct({ title: 'Creatine Gummies', url: 'https://s0.example/products/creatine', currency: 'USD', price: 19.95, publishedAt: '2020-01-01', soldCount: 100 }, site, '2026-10-22T00:00:00Z');
  old.sourceMetrics.reviewCount = 12;
  old.favorite = true;
  h.docs.set('products:' + old.id, old);
  await runProductsJob(h.job, h.io);
  const saved = h.docs.get('products:' + old.id);
  assert.deepEqual(saved.sourceMetrics, old.sourceMetrics);
  assert.deepEqual(saved.decisionData.listing, old.decisionData.listing);
  assert.equal(saved.favorite, true);
  assert.equal(saved.price, 29.95);
});

test('official refresh replaces observed cumulative sales while retaining unrelated source metrics', async () => {
  const h = harness(1);
  const site = h.job.input.records[0];
  const old = normalizeProduct({ title: 'Creatine Gummies', url: 'https://s0.example/products/creatine', currency: 'USD', soldCount: 100 }, site, '2026-10-22T00:00:00Z');
  old.sourceMetrics.reviewCount = 12;
  h.docs.set('products:' + old.id, old);
  h.io.fetchPage = async (url) => ({ url, html: JSON.stringify({ products: [{ title: 'Creatine Gummies', handle: 'creatine', sold_count: 125, variants: [] }] }) });
  await runProductsJob(h.job, h.io);
  const saved = h.docs.get('products:' + old.id);
  assert.equal(saved.sourceMetrics.soldCount, 125);
  assert.equal(saved.sourceMetrics.reviewCount, 12);
  assert.equal(saved.sourceMetrics.soldSourceField, 'Shopify catalog JSON.sold_count');
});

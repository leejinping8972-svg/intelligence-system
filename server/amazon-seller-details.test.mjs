/* oxlint-disable vitest/no-import-node-test -- Server tests use Node's test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amazonSellerSource,
  needsSellerDetails,
} from './amazon-seller-details.mjs';
import {
  mergePlatformProduct,
  normalizeAmazon,
  normalizeAmazonContent,
} from './platform-product-data.mjs';
import { prepareProductIntake } from './product-intake.mjs';
import { parseOfficialDetail } from './official-new-releases.mjs';
import {
  productSellerDetails,
  productSellerId,
  productSellerUrl,
  productSellerName,
} from './product-seller.mjs';
import { projectRecord } from './workspace-reads.mjs';

const at = '2026-11-10T03:00:00.000Z';
const id = 'A1234567890123';
const product = () => ({
  id: 'p',
  title: 'Synthetic',
  brand: 'Brand',
  sourcePlatform: 'Amazon',
  sourceProvider: 'Sorftime',
  sourceMarket: 'US',
  market: 'MX',
  sourceProductId: 'B000000001',
  sellerName: 'Store A',
});
const schema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    query_type: { type: 'integer' },
    amz_seller_site: { type: 'string', enum: ['US', 'MX'] },
    page: { type: 'integer' },
  },
};
const detail = (extra = {}) => ({
  seller_name: 'Store A',
  business_name: 'Synthetic &amp; Co',
  business_address: 'Line 1<br/>City<br />US<script>bad()</script>',
  ...extra,
});
function mockClient(row, name = 'seller_detail') {
  const calls = [];
  return {
    calls,
    tools: [{ name, inputSchema: schema }],
    rpc: async (_method, args) => {
      calls.push(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              doc: { business_name: 'documentation' },
              data: row,
            }),
          },
        ],
      };
    },
  };
}
async function collectDetails(p = product(), row = detail()) {
  const client = mockClient(row);
  return amazonSellerSource(
    { op: 'seller_detail', product: p },
    { client, now: () => Date.parse(at) },
  );
}

test('verified seller schema preserves address lines, decodes text and reports one source call', async () => {
  const result = await collectDetails();
  assert.equal(result.patch.sellerDetails.businessName, 'Synthetic & Co');
  assert.deepEqual(result.patch.sellerDetails.businessAddress, [
    'Line 1',
    'City',
    'US',
  ]);
  assert.equal(result.patch.sellerDetails.market, 'US');
  assert.equal(result.patch.sellerDetails.lookup, 'exact_name');
  assert.equal(result.patch.sellerDetails.collectedAt, at);
  assert.deepEqual(result.usage, {
    requests: 1,
    sorftimeCalls: 1,
    providerCalls: 1,
  });
});

test('known seller IDs use exact ID queries and source market; missing tools make no data call', async () => {
  const client = mockClient(detail());
  await amazonSellerSource(
    { op: 'seller_detail', product: { ...product(), sellerId: id } },
    { client },
  );
  assert.deepEqual(client.calls[0].arguments, {
    name: id,
    query_type: 2,
    amz_seller_site: 'US',
  });
  client.tools = [];
  const result = await amazonSellerSource(
    { op: 'seller_detail', product: product() },
    { client },
  );
  assert.equal(result.unsupported, true);
  assert.equal(result.usage.sorftimeCalls, 0);
  assert.equal(client.calls.length, 1);
});

test('identity lookup requires a unique exact seller and never selects a fuzzy search result', async () => {
  const client = mockClient(
    [
      { seller_id: 'A9999999999999', seller_name: 'Other store' },
      { seller_id: id, seller_name: 'STORE A' },
    ],
    'seller_search_from_name',
  );
  const request = { op: 'seller_identity', product: product() };
  const identity = await amazonSellerSource(request, { client });
  assert.equal(identity.patch.sellerId, id);
  client.rpc = async () => ({
    structuredContent: {
      data: [
        { seller_name: 'Store A', seller_id: id },
        { seller_name: 'Store A', seller_id: 'A9999999999999' },
      ],
    },
  });
  await assert.rejects(amazonSellerSource(request, { client }), /唯一匹配/);
});

test('wrong seller, ID or marketplace is rejected, and empty fields stay missing', async () => {
  for (const row of [
    detail({ seller_name: 'Different' }),
    detail({ market: 'MX' }),
    detail({ seller_id: 'A9999999999999' }),
  ])
    await assert.rejects(
      collectDetails({ ...product(), sellerId: id }, row),
      /不一致|唯一匹配/,
    );
  const result = await collectDetails(product(), {
    seller_name: 'Store A',
    business_name: '',
    business_address: '',
  });
  assert.equal(result.patch.sellerDetails.status, 'unavailable');
  assert.equal(result.patch.sellerDetails.businessName, '');
  assert.deepEqual(result.patch.sellerDetails.businessAddress, []);
});

test('source errors are not retried and known empty responses are distinguished', async () => {
  const client = mockClient(detail());
  client.rpc = async () => {
    client.calls.push('sent');
    throw new Error('unknown');
  };
  await assert.rejects(
    amazonSellerSource({ op: 'seller_detail', product: product() }, { client }),
    /unknown/,
  );
  assert.equal(client.calls.length, 1);
  client.rpc = async () => ({
    content: [{ type: 'text', text: 'No data available.' }],
  });
  const noData = await amazonSellerSource(
    { op: 'seller_detail', product: product() },
    { client },
  );
  assert.equal(noData.empty, true);
});

test('placeholder seller names trigger a unique ASIN lookup, preserving Chinese company and address', async () => {
  const p = { ...product(), sellerName: 'N/A', resourceRaw: {shopName:'N/A'} };
  assert.equal(productSellerName(p),'');
  assert.equal(productSellerName({...p,resourceRaw:{seller_name:'广东中文店铺'}}),'广东中文店铺');
  assert.equal(needsSellerDetails(p),true);
  const client = mockClient([{seller_id:id,seller_name:'中文店铺'}], 'seller_search_from_name');
  const identity = await amazonSellerSource({op:'seller_identity',product:p},{client});
  assert.equal(client.calls[0].arguments.name,'B000000001');
  assert.equal(client.calls[0].arguments.query_type,2);
  assert.deepEqual(identity.patch,{sellerName:'中文店铺',sellerId:id});
  const details = await collectDetails({...p,...identity.patch}, detail({seller_name:'中文店铺',seller_id:id,
    business_name:'佛山市示例商贸有限公司',business_address:['文昌路118号','佛山市','禅城区','广东省','528000','CN']}));
  assert.equal(details.patch.sellerDetails.businessName,'佛山市示例商贸有限公司');
  assert.deepEqual(details.patch.sellerDetails.businessAddress,['文昌路118号','佛山市','禅城区','广东省','528000','CN']);
  client.rpc=async()=>({structuredContent:{data:[{seller_id:id,seller_name:'甲'},{seller_id:'A9999999999999',seller_name:'乙'}]}});
  await assert.rejects(amazonSellerSource({op:'seller_identity',product:p},{client}),/未唯一匹配/);
});

test('source seller IDs survive detail/content and canonical seller links use the actual Amazon market', () => {
  const row = {
    asin: 'B000000001',
    title: 'Synthetic',
    seller_name: 'Store A',
    seller_id: id,
  };
  const p = normalizeAmazon(row, 'US', at);
  assert.equal(productSellerId(p), id);
  assert.equal(normalizeAmazonContent(row, p, at).sellerId, id);
  assert.equal(
    productSellerUrl({ ...p, market: 'MX', sourceMarket: 'US' }),
    `https://www.amazon.com/sp?seller=${id}`,
  );
  assert.equal(productSellerUrl({ ...p, sellerId: 'javascript:bad' }), '');
  assert.equal(productSellerUrl({ ...p, sourcePlatform: 'Shopee' }), '');
});

test('official seller links require the same Amazon origin and retain only the seller ID', () => {
  const parse = (href) =>
    parseOfficialDetail(
      `<input id="ASIN" value="B000000001"><span id="productTitle">Synthetic</span><a id="sellerProfileTriggerId" href="${href}">Store A</a>`,
      {
        asin: 'B000000001',
        market: 'US',
        sourceMarket: 'US',
        now: Date.parse(at),
        ranking: { rank: 1 },
      },
    ).product;
  assert.equal(parse(`/sp?seller=${id}&ref_=test`).sellerId, id);
  assert.equal(
    parse(`https://attacker.test/sp?seller=${id}`).sellerId,
    undefined,
  );
});

test('seller changes invalidate previous business details and raw IDs; partial product refreshes preserve them', async () => {
  const details = await collectDetails({ ...product(), sellerId: id });
  const p = mergePlatformProduct({ ...product(), sellerId: id }, details.patch);
  assert.equal(productSellerDetails(p).businessName, 'Synthetic & Co');
  assert.equal(
    projectRecord('products', p).data.sellerDetails.businessAddress[0],
    'Line 1',
  );
  assert.equal(
    mergePlatformProduct(p, { id: p.id, price: 20 }).sellerDetails.businessName,
    'Synthetic & Co',
  );
  const changed = mergePlatformProduct(
    { ...p, resourceRaw: { shopId: id } },
    { id: p.id, sellerName: 'Store B' },
  );
  assert.equal(changed.sellerDetails, undefined);
  assert.equal(productSellerId(changed), '');
  assert.equal(
    mergePlatformProduct(p, { id: p.id, sellerId: 'A9999999999999' })
      .sellerDetails,
    undefined,
  );
  assert.equal(
    mergePlatformProduct(p, { id: p.id, sourceMarket: 'MX' }).sellerDetails,
    undefined,
  );
});

test('matching saved details cache for seven days and refresh after expiry; other platforms do not enrich', async () => {
  const details = await collectDetails();
  const p = { ...product(), ...details.patch };
  assert.equal(needsSellerDetails(p, Date.parse(at) + 6 * 86_400_000), false);
  assert.equal(needsSellerDetails(p, Date.parse(at) + 7 * 86_400_000), true);
  assert.equal(needsSellerDetails({ ...p, sourcePlatform: 'Shopee' }), false);
});

test('intake journals two bounded seller steps and resumes without repeating completed or unknown source requests', async () => {
  const journal = new Map(),
    paid = [],
    steps = [];
  const p = { ...product(), sourceProvider: 'Amazon Official' };
  const io = {
    collect: async (_job, step, request) => {
      steps.push({ step, request });
      if (journal.has(step)) {
        const result = journal.get(step);
        if (result instanceof Error) throw result;
        return result;
      }
      let result;
      if (request.op === 'seller_identity') {
        paid.push(step);
        result = { patch: { sellerId: id } };
      } else if (request.op === 'seller_detail') {
        paid.push(step);
        result = await collectDetails(request.product);
      } else result = { analysis: { status: 'analyzed' } };
      journal.set(step, result);
      return result;
    },
  };
  const first = await prepareProductIntake({ id: 'job' }, p, io);
  assert.equal(first.product.sellerDetails.sellerId, id);
  assert.ok(
    steps
      .filter(({ request }) => request.op)
      .every(
        ({ step, request }) =>
          step.length <= 100 && request.sorftimeRequestLimit === 1,
      ),
  );
  await prepareProductIntake({ id: 'job' }, p, io);
  assert.equal(paid.length, 2);
  const identityStep = paid[0];
  journal.set(identityStep, new Error('unknown prior request'));
  steps.length = 0;
  const unknown = await prepareProductIntake({ id: 'job' }, p, io);
  assert.match(unknown.errors[0], /unknown/);
  assert.equal(
    steps.some(({ request }) => request.op === 'seller_detail'),
    false,
  );
  assert.equal(paid.length, 2);
});

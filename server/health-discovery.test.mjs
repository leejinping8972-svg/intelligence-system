import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { healthCategories, healthCategoryWork, healthCoverageSteps, futureHealthPlan, HEALTH_COVERAGE_VERSION, HEALTH_PRODUCT_POLICY } from './health-category-domain.mjs';
import { healthProductSample, healthProductDecision } from './health-product-domain.mjs';
import { sourceFieldSample, validateSourceFields } from './source-field-domain.mjs';
import { discoveryPlan } from './discovery-monitor-domain.mjs';
import { dailyNewProductPlan } from './product-pool-domain.mjs';
import { runHealthDiscovery } from './health-discovery-runner.mjs';
import { runDiscoveryMonitor, submitDiscovery } from './discovery-monitor-store.mjs';
import { prepareProductIntake } from './product-intake.mjs';
import { fieldAnalysisRequest } from './discovery-ai.mjs';

const now = Date.parse('2026-11-10T02:00:00Z');
const basePlan = () => discoveryPlan({ kind: 'regular_new', market: 'US', channels: ['amazon', 'tiktok'], completeDays: true });
const plan = patch => discoveryPlan(futureHealthPlan({ ...basePlan(), ...patch }));
const product = (id = 'synthetic', title = 'Meal replacement powder; mix with water and drink for nutrition.') => ({
  id, title, brand: 'Synthetic', sourceUrl: `https://example.test/${id}`,
  decisionData: { listing: { date: '2026-11-09' } }, resourceRaw: { salesEvidence: { value: 2 } },
});
function candidate(sample, kind = 'meal_powder', route = 'oral') {
  const evidence = { sourceId: 'title', quote: sample.sources.find(s => s.id === 'title').text };
  return { fields: [], supplement: { value: false, ...evidence },
    healthProduct: { kind, route, evidence, usage: evidence, purpose: evidence, form: evidence } };
}
function harness(patch = {}, source = () => ({ products: [], sourceRows: 0 })) {
  const job = { id: randomUUID(), input: { plan: plan(patch) }, checkpoint: {} };
  const requests = [], writes = [], reviews = [], journal = new Map();
  let status, cancel = false, actualCalls = 0;
  const io = {
    now: () => now,
    pool: { query: async () => ({ rows: [{ cancelled: cancel }] }) },
    collect: async (_job, step, request) => {
      requests.push(request);
      if (journal.has(step)) return structuredClone(journal.get(step));
      actualCalls++;
      const result = request.sample
        ? validateSourceFields(candidate(request.sample), request.sample)
        : request.sources[0] === 'discovery_sorftime' ? source(request) : {};
      journal.set(step, result);
      return structuredClone(result);
    },
    translate: async (_kind, records) => records,
    upsertProduct: async p => writes.push(p),
    putDocument: async (_table, name, value) => reviews.push({ name, value }),
    saveCheckpoint: async (_job, cp, value) => { job.checkpoint = structuredClone(cp); status = value; },
  };
  return { job, io, requests, writes, reviews, journal, get status() { return status; },
    get actualCalls() { return actualCalls; }, cancel: value => { cancel = value; },
    async finish() {
      for (let i = 0; i < 2000 && !['completed', 'partial', 'cancelled'].includes(status); i++)
        await runDiscoveryMonitor(job, io);
      assert.ok(['completed', 'partial', 'cancelled'].includes(status), 'runner terminates');
    } };
}

test('verified catalogue retains 206 Amazon + 4 TikTok base categories and two separate powder entries', () => {
  const work = healthCategoryWork(plan());
  assert.equal(work.length, 212);
  assert.equal(new Set(work.map(w => `${w.channel}:${w.nodeId}`)).size, 212);
  assert.equal(work.filter(w => w.channel === 'amazon' && !w.powderOnly).length, 206);
  assert.equal(work.filter(w => w.channel === 'tiktok').length, 4);
  assert.deepEqual(work.filter(w => w.powderOnly).map(w => w.nodeId).sort(), ['6939043011', '6939082011']);
  for (const id of ['3774411', '6973724011', '3774141', '3774941', '3765951'])
    assert.ok(work.some(w => w.nodeId === id));
  assert.ok(!healthCategories.some(c => /shaker|best sellers|protein bars|cookies/i.test(c.name)));
});

test('future schedules adopt coverage; frozen jobs and non-US plans retain their policy', () => {
  const old = basePlan(), frozen = structuredClone(old);
  assert.equal(discoveryPlan(old).healthCoverageVersion, undefined);
  const future = dailyNewProductPlan(old);
  assert.equal(future.healthCoverageVersion, HEALTH_COVERAGE_VERSION);
  assert.equal(future.healthProductPolicy, HEALTH_PRODUCT_POLICY);
  assert.deepEqual(old, frozen);
  assert.equal(futureHealthPlan({ ...old, market: 'MX' }).healthCoverageVersion, undefined);
  assert.throws(() => discoveryPlan({ ...future, healthCoverageVersion: 'unknown' }));
});

test('all 212 categories reach product source requests without name lookup or the 30/100-item truncation', async () => {
  const h = harness();
  await h.finish();
  const source = h.requests.filter(r => r.sources[0] === 'discovery_sorftime');
  assert.equal(source.length, 212);
  assert.ok(source.every(r => r.nodeId && !r.categoryLookup && r.sorftimeRequestLimit === 1));
  assert.equal(h.status, 'completed');
  assert.equal(Object.values(h.job.checkpoint.healthCoverage).filter(c => c.firstPage === 'done').length, 212);
  assert.match(healthCoverageSteps(h.job.checkpoint).join('\n'), /206\/206/);
  assert.match(healthCoverageSteps(h.job.checkpoint).join('\n'), /4\/4/);
});

test('accepted-product limit still scans every first page, preserves deduplication and reports partial', async () => {
  const h = harness({ maxProducts: 1 }, r => ({ products: [product(r.nodeId), product('same')], sourceRows: 2, hasMore: true }));
  await h.finish();
  assert.equal(h.writes.length, 1);
  assert.equal(h.requests.filter(r => r.sources[0] === 'discovery_sorftime' && r.page === 1).length, 212);
  assert.equal(h.requests.filter(r => r.sources[0] === 'discovery_sorftime' && r.page > 1).length, 0);
  assert.equal(h.status, 'partial');
  assert.ok(h.job.checkpoint.healthLimitSkipped > 0);
  assert.ok(Object.values(h.job.checkpoint.healthCoverage).some(c => c.truncated === 'product_limit'));
});

test('cross-category duplicate is written once; page cap, repeated page and failed category remain visible', async () => {
  const h = harness({ maxPages: 2 }, r => {
    if (r.nodeId === '700650') throw Error('来源结果未知，未重放');
    return { products: [product()], sourceRows: 1, hasMore: true, pageFingerprint: 'same-page' };
  });
  await h.finish();
  assert.equal(h.writes.length, 1);
  assert.equal(h.status, 'partial');
  assert.equal(h.requests.filter(r => r.nodeId === '700650').length, 1);
  assert.ok(Object.values(h.job.checkpoint.healthCoverage).some(c => c.truncated === 'repeated_page'));
  assert.equal(h.job.checkpoint.healthCoverage['tiktok:700650'].firstPage, 'failed');
  const cap = harness({ maxPages: 1 }, () => ({ products: [], sourceRows: 0, hasMore: true }));
  await cap.finish();
  assert.equal(cap.status, 'partial');
  assert.ok(Object.values(cap.job.checkpoint.healthCoverage).every(c => c.truncated === 'page_limit'));
});

test('cancellation preserves current source work and recovery reuses paid receipt', async () => {
  const h = harness();
  const collect = h.io.collect;
  h.io.collect = async (...args) => { const result = await collect(...args); h.cancel(true); return result; };
  await runHealthDiscovery(h.job, h.io);
  assert.equal(h.status, 'cancelled');
  assert.equal(h.job.checkpoint.work.length, 212);
  const count = h.actualCalls;
  h.cancel(false); h.io.collect = collect;
  await runHealthDiscovery(h.job, h.io);
  assert.equal(h.actualCalls, count);
  assert.equal(h.job.checkpoint.work.length, 211);
});

test('meal, milkshake and protein powders survive food classification; oral/topical products require original evidence', () => {
  for (const [title, kind, route] of [
    ['Meal replacement powder; mix and drink for nutrition.', 'meal_powder', 'oral'],
    ['Milkshake powder nutrition; add water and drink.', 'meal_powder', 'oral'],
    ['Protein powder; mix with milk and drink for protein nutrition.', 'protein_powder', 'oral'],
    ['Dietary supplement capsules; swallow for nutritional support.', 'oral_supplement', 'oral'],
    ['Topical gel; apply to skin for muscle care.', 'topical_health', 'topical'],
  ]) {
    const sample = healthProductSample(sourceFieldSample('products', product('p', title)), HEALTH_PRODUCT_POLICY);
    const result = validateSourceFields(candidate(sample, kind, route), sample);
    assert.equal(result.analysis.supplement, false);
    assert.equal(healthProductDecision(result.analysis).status, 'accepted');
    assert.equal(healthProductDecision(result.analysis, true).status, /powder/.test(kind) ? 'accepted' : 'excluded');
  }
});

test('equipment, ordinary food/drinks, cosmetics and programmes are excluded; invalid or missing evidence is pending', () => {
  const sample = healthProductSample(sourceFieldSample('products', product()), HEALTH_PRODUCT_POLICY);
  for (const kind of ['ordinary_food', 'equipment', 'cosmetic', 'program'])
    assert.equal(validateSourceFields(candidate(sample, kind), sample).analysis.healthProduct.status, 'excluded');
  for (const key of ['evidence', 'usage', 'purpose', 'form']) {
    const result = candidate(sample);
    result.healthProduct[key].quote = 'Meal...nutrition';
    assert.equal(validateSourceFields(result, sample).analysis.healthProduct.status, 'pending');
  }
  const liquid = healthProductSample(sourceFieldSample('products', product('p', 'Ready to drink meal replacement shake for nutrition')), HEALTH_PRODUCT_POLICY);
  assert.equal(validateSourceFields(candidate(liquid), liquid).analysis.healthProduct.status, 'pending');
  assert.equal(healthProductDecision({ supplement: false }).status, 'pending');
});

test('health classification policy changes fingerprint, bypasses old oral-only cache and reaches model prompt', async () => {
  const p = product(), old = sourceFieldSample('products', p);
  p.fieldAnalysis = { version: 2, fingerprint: old.fingerprint, status: 'analyzed', supplement: false };
  let calls = 0;
  const result = await prepareProductIntake({ id: 'synthetic' }, p, {
    collect: async (_job, _step, request) => {
      calls++;
      assert.notEqual(request.sample.fingerprint, old.fingerprint);
      return fieldAnalysisRequest(request, {
        config: { model: 'synthetic' },
        pool: { query: async () => ({ rows: [] }) },
        postModel: async (_config, messages) => {
          assert.match(messages[0].content, /meal_powder/);
          return { choices: [{ message: { content: JSON.stringify(candidate(request.sample)) } }] };
        },
      });
    },
  }, { sourceDetails: false, healthProductPolicy: HEALTH_PRODUCT_POLICY });
  assert.equal(calls, 1);
  assert.equal(result.analysis.healthProduct.status, 'accepted');
  await prepareProductIntake({ id: 'synthetic' }, result.product, {
    collect: async () => { throw Error('cache should be reused'); },
  }, { sourceDetails: false, healthProductPolicy: HEALTH_PRODUCT_POLICY });
});

test('uncertain health products are archived for confirmation and never written to product pool', async () => {
  const h = harness({}, () => ({ products: [product()], sourceRows: 1 }));
  const collect = h.io.collect;
  h.io.collect = async (...args) => args[2].sample ? {
    analysis: { status: 'analyzed', healthProduct: { policy: HEALTH_PRODUCT_POLICY, status: 'pending', reason: 'invalid_quote' } },
  } : collect(...args);
  await h.finish();
  assert.equal(h.status, 'partial');
  assert.equal(h.writes.length, 0);
  // One unrestricted candidate and one conditional candidate, same archived id.
  assert.ok(h.reviews.length > 0);
  assert.ok(h.reviews.every(r => r.value.status === 'pending' && r.value.product.id === 'synthetic'));
});

test('runner keeps all three nutrition powders while rejecting utensils and food without consuming accepted allowance', async () => {
  const powders = [
    product('meal', 'Meal replacement powder; mix with water and drink for nutrition.'),
    product('shake', 'Milkshake powder; mix with water and drink for nutrition.'),
    product('protein', 'Protein powder; mix with milk and drink for nutrition.'),
  ];
  const h = harness({ maxProducts: 3 }, () => ({ products: [
    product('equipment', 'Shaker bottle for mixing nutrition drinks'),
    product('food', 'Ready to drink meal replacement milkshake'), ...powders,
  ], sourceRows: 5 }));
  const collect = h.io.collect;
  h.io.collect = async (...args) => {
    const request = args[2];
    if (!request.sample) return collect(...args);
    const title = request.sample.sources.find(s => s.id === 'title').text;
    const kind = title.startsWith('Shaker') ? 'equipment' : title.startsWith('Ready') ? 'ordinary_food' :
      title.startsWith('Protein') ? 'protein_powder' : 'meal_powder';
    return validateSourceFields(candidate(request.sample, kind), request.sample);
  };
  await h.finish();
  assert.deepEqual(h.writes.map(p => p.id).toSorted(), ['meal', 'protein', 'shake']);
  assert.equal(h.job.checkpoint.healthExcluded, 2);
});

test('conditional diet entries accept powders only and do not suppress supplements found later in base categories', async () => {
  const h = harness({ channels: ['amazon'] });
  // Put the mixed entry first to exercise cross-entry deduplication order.
  const work = healthCategoryWork(h.job.input.plan);
  const mixed = work.find(w => w.powderOnly);
  const base = work.find(w => !w.powderOnly);
  h.job.checkpoint.healthCoverage = Object.fromEntries([mixed, base].map(w => [`${w.channel}:${w.nodeId}`, {
    channel: w.channel, nodeId: w.nodeId, powderOnly: w.powderOnly, firstPage: 'pending', pages: 0,
  }]));
  h.job.checkpoint.work = [mixed, base];
  const collect = h.io.collect;
  h.io.collect = async (...args) => args[2].sample
    ? validateSourceFields(candidate(args[2].sample, 'oral_supplement'), args[2].sample)
    : { products: [product('capsule', 'Dietary supplement capsules; swallow for nutrition.')], sourceRows: 1 };
  await h.finish();
  assert.equal(h.writes.length, 1);
  assert.equal(h.job.checkpoint.healthExcluded, 1);
  assert.equal(h.status, 'completed');
  h.io.collect = collect;
});

test('submission is idempotent for new and legacy request IDs without expanding old jobs', async () => {
  const saved = new Map();
  const connection = { query: async (sql, args) => {
    if (sql.startsWith('SELECT * FROM research_jobs WHERE request_id')) return { rows: saved.has(args[0]) ? [saved.get(args[0])] : [] };
    if (sql.startsWith('INSERT INTO research_jobs')) {
      const [id, request_id, input, checkpoint] = args;
      saved.set(request_id, { id, request_id, input, checkpoint });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT * FROM research_jobs WHERE id')) return { rows: [...saved.values()].filter(r => r.id === args[0]) };
    throw Error(`Unexpected SQL ${sql}`);
  } };
  const requestId = randomUUID(), raw = basePlan();
  const first = await submitDiscovery({ requestId, plan: raw }, connection);
  assert.equal(first.input.plan.healthCoverageVersion, HEALTH_COVERAGE_VERSION);
  assert.equal((await submitDiscovery({ requestId, plan: raw }, connection)).id, first.id);
  await assert.rejects(submitDiscovery({ requestId, plan: { ...raw, maxProducts: 2 } }, connection), /不同任务/);
  const oldId = randomUUID();
  saved.set(oldId, { id: 'old', input: { plan: raw }, checkpoint: { work: ['frozen'] } });
  assert.equal((await submitDiscovery({ requestId: oldId, plan: raw }, connection)).input.plan.healthCoverageVersion, undefined);
});

/* eslint-disable unicorn/no-await-expression-member -- Keep SQL row access consistent with existing server modules. */
import { randomUUID } from 'node:crypto';

import { readSorftimeToken } from './collector.js';
import { appendCoreEvidence, archiveCoreEvidence } from './core-evidence.mjs';
import { lock, pool, putDocument, unlock } from './database.mjs';
import { observeDiscovery } from './discovery-newness.mjs';
import { readKeyword } from './enrichment-jobs.mjs';
import { withFormulaIntelligence } from './formula-intelligence.mjs';
import { collectorEnv } from './local-provider.mjs';
import {
  completionKey,
  productCompletionWork,
  unsupportedCompletion,
} from './platform-product-completion.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { publicProductUrl } from './product-public-enrichment.mjs';
import {
  archiveResourceEvidence,
  validateResourceInput,
} from './product-resource-domain.mjs';
import { runProductResourceDiscovery } from './product-resource-engine.mjs';
import {
  assertResourceCategory,
  upsertResourceContent,
} from './product-resource-service.mjs';
import { collect, saveCheckpoint } from './store.mjs';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export function validatePlatformProducts(input) {
  if (!uuid.test(input.requestId || '')) throw new Error('缺少有效提交编号');
  if (input.resourceDiscovery === true) return validateResourceInput(input);
  const seeds = [
    ...new Set(
      String(input.terms || '')
        .split(/\r?\n/)
        .map((s) => s.normalize('NFKC').replaceAll(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  ];
  if (
    seeds.length === 0 ||
    seeds.length > 100 ||
    seeds.some((s) => s.length > 200)
  )
    throw new Error('请输入1～100个关键词，每行一个，每词不超过200字符');
  if (!['MX', 'US', 'VN'].includes(input.market))
    throw new Error('请选择支持的目标市场');
  if (
    !Array.isArray(input.providers) ||
    input.providers.length === 0 ||
    input.providers.some(
      (p) => !['semrush', 'sorftime', 'tiktok_shop'].includes(p),
    )
  )
    throw new Error('请选择 Sorftime、Semrush 或 TikTok Shop 来源');
  const value = {
    kind: 'platform_products',
    seeds,
    market: input.market,
    markets: [input.market],
    providers: [...new Set(input.providers)],
    completeAll: input.completeAll !== false,
    enrich: input.enrich !== false,
    trend: input.trend !== false,
    maxProducts: input.maxProducts ?? 100,
    perKeyword: input.perKeyword ?? 20,
    maxRequests: input.maxRequests ?? 150,
    maxDetailProducts: input.maxDetailProducts ?? 20,
    maxDomains: input.maxDomains ?? 3,
    semrushUnitLimit: 0,
  };
  for (const [key, min, max] of [
    ['maxProducts', 1, 1000],
    ['perKeyword', 1, 100],
    ['maxRequests', 1, 100_000],
    ['maxDetailProducts', 0, 1000],
    ['maxDomains', 1, 5],
  ])
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
      throw new Error('商品数量或请求次数不在允许范围');
  if (value.market === 'VN' && value.providers.includes('sorftime'))
    throw new Error(
      '当前 Sorftime 商品来源为 Amazon，不支持越南；可选择 Semrush，不跨国替代',
    );
  if (
    value.maxRequests > 0 &&
    value.maxRequests < value.seeds.length * value.providers.length
  )
    throw new Error(
      '整批请求上限不足以覆盖每个关键词和所选来源，请提高上限或减少关键词',
    );
  return value;
}
export async function submitPlatformProducts(input, context = {}) {
  const c = await pool.connect();
  const value = validatePlatformProducts(input);
  if (context.discoveryDay) value.discoveryDay = context.discoveryDay;
  let locked = false;
  try {
    locked = await lock(c, 'platform-products-submit');
    if (!locked) throw new Error('正在提交商品任务，请稍后重试');
    const old = (
      await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
        input.requestId,
      ])
    ).rows[0];
    if (old) return old;
    if (value.resourceDiscovery)
      await assertResourceCategory(value.resourcePlan, c);
    const active = (
      await c.query(
        "SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      )
    ).rows;
    if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
    if (
      active.some(
        (j) =>
          j.input.kind === value.kind &&
          (value.resourceDiscovery
            ? j.input.resourceDiscovery &&
              j.input.market === value.market &&
              j.input.resourcePlan?.routeId === value.resourcePlan.routeId &&
              j.input.resourcePlan?.mode === value.resourcePlan.mode &&
              (value.resourcePlan.mode === 'category'
                ? j.input.resourcePlan.category?.id ===
                  value.resourcePlan.category?.id
                : value.resourcePlan.mode === 'urls'
                  ? j.input.resourcePlan.urls?.some((url) =>
                      value.resourcePlan.urls.includes(url),
                    )
                  : j.input.resourcePlan.terms?.some((term) =>
                      value.resourcePlan.terms.includes(term),
                    ))
            : !j.input.resourceDiscovery &&
              ((j.input.mode === 'enrich' &&
                j.input.markets?.includes(value.market)) ||
                (j.input.market === value.market &&
                  j.input.seeds?.some((s) => value.seeds.includes(s))))),
      )
    )
      throw new Error('这些关键词已有平台商品任务，请等待完成');
    if (value.resourceDiscovery) {
      const configNames = {
        sorftime: ['provider:sorftime:mcp:v1', 'credentials'],
        semrush: ['provider:semrush:mcp:v1'],
        tiktok_shop: ['provider:scrapecreators:v1'],
        scrapecreators: ['provider:scrapecreators:v1'],
        instagram_scrapecreators: ['provider:scrapecreators:v1'],
        brave: ['credentials'],
      };
      const names = configNames[value.resourcePlan.provider] || [];
      if (names.length) {
        const configured = await c.query(
          `SELECT name FROM provider_configs WHERE name IN (${names.map((_, index) => `$${index + 1}`).join(',')})`,
          names,
        );
        if (!configured.rows.length)
          throw new Error(
            '请先在数据源与设置中配置所选来源；本次检查未读取凭据或调用供应商',
          );
      }
    }
    if (
      !value.resourceDiscovery &&
      value.providers.includes('sorftime') &&
      !(await readSorftimeToken(await collectorEnv()))
    )
      throw new Error('请先在数据源与设置中配置 Sorftime MCP Token');
    if (
      !value.resourceDiscovery &&
      value.providers.includes('semrush') &&
      (
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [
          'provider:semrush:mcp:v1',
        ])
      ).rows.length === 0
    )
      throw new Error('请先配置 Semrush MCP');
    if (
      !value.resourceDiscovery &&
      value.providers.includes('tiktok_shop') &&
      (
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [
          'provider:scrapecreators:v1',
        ])
      ).rows.length === 0
    )
      throw new Error('请先在数据源与设置中配置 ScrapeCreators API Key');
    const all = (
      await c.query(
        'SELECT natural_key,data FROM research_keywords ORDER BY updated_at DESC LIMIT 10000',
      )
    ).rows;
    value.keywordRecords = all
      .filter(
        ({ data: k }) =>
          k.market === value.market &&
          value.seeds.some((s) => s.toLowerCase() === k.term.toLowerCase()),
      )
      .map(({ natural_key, data: k }) => ({
        id: k.id,
        term: k.term,
        naturalKey: natural_key,
      }));
    const id = randomUUID();
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, input.requestId, value, { submittedAt: new Date().toISOString() }],
    );
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
  } finally {
    if (locked) await unlock(c, 'platform-products-submit');
    c.release();
  }
}
export async function upsertProduct(patch) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const name = `business:products:${patch.id}`;
    const old = (
      await c.query(
        'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
        [name],
      )
    ).rows[0]?.value;
    if (!old && !patch.title) {
      await c.query('COMMIT');
      return undefined;
    }
    const { gateSourceFields } = await import('./source-field-domain.mjs');
    const { queueSourceFields } = await import('./source-field-store.mjs');
    const merged = withFormulaIntelligence(gateSourceFields('products', old,
      observeDiscovery(old, mergePlatformProduct(old, patch), 'product'), patch));
    await queueSourceFields('products', merged, c);
    const value = appendCoreEvidence('products', old, merged, {
      ...patch,
      id: merged.id,
      market: merged.market,
      sourceProvider: merged.sourceProvider,
      sourcePlatform: merged.sourcePlatform,
      sourceProductId: merged.sourceProductId,
    });
    await archiveCoreEvidence(
      'products',
      value.id,
      value,
      (key, snapshot, only) =>
        putDocument('workspace_documents', key, snapshot, only, c),
      old,
    );
    await archiveResourceEvidence(value, old, (key, snapshot, only) =>
      putDocument('workspace_documents', key, snapshot, only, c),
    );
    await putDocument('workspace_documents', name, value, false, c);
    await c.query('COMMIT');
    return value;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export async function readProduct(id) {
  return (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `business:products:${id}`,
    ])
  ).rows[0]?.value;
}
async function linkKeyword(keyword, productIds) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const row = (
      await c.query(
        'SELECT natural_key,data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
        [keyword.naturalKey],
      )
    ).rows[0];
    if (row?.data.id === keyword.id)
      await c.query(
        'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
        [
          row.natural_key,
          {
            ...row.data,
            productIds: [
              ...new Set([...(row.data.productIds || []), ...productIds]),
            ],
          },
        ],
      );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
const workId = (w) =>
  [
    w.provider,
    w.op,
    w.term || '',
    w.page || '',
    w.domain || '',
    w.productId || '',
    w.trendType || '',
  ].join('|');

function enrichmentIds(input) {
  const ids = input.productIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 5000 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || id.length > 200)
  )
    throw new Error('请选择有效且不重复的商品');
  return ids;
}
export function enrichmentPlan(products) {
  const sorftime = products.filter(
    (p) =>
      p.sourceProvider === 'Sorftime' &&
      /^[A-Z0-9]{10}$/.test(p.sourceProductId || '') &&
      ['MX', 'US'].includes(p.market),
  ).length;
  const publicCount = products.filter((p) => publicProductUrl(p)).length;
  const estimatedRequests = sorftime * 5 + publicCount * 2;
  return {
    total: products.length,
    sorftime,
    public: publicCount,
    unsupported: products.length - sorftime - publicCount,
    estimatedRequests,
    defaultMaxRequests: Math.max(1, Math.min(150, estimatedRequests)),
  };
}
export async function previewPlatformProductEnrichment(input) {
  const ids = enrichmentIds(input);
  const products = [];
  for (let start = 0; start < ids.length; start += 250) {
    const batch = ids.slice(start, start + 250);
    const rows = (
      await pool.query(
        'SELECT value FROM workspace_documents WHERE name IN (' +
          batch.map((_, i) => '$' + (i + 1)).join(',') +
          ')',
        batch.map((id) => 'business:products:' + id),
      )
    ).rows;
    if (rows.length !== batch.length)
      throw new Error('选中的商品已不存在，请刷新列表');
    products.push(...rows.map((row) => row.value));
  }
  return enrichmentPlan(products);
}
export async function submitPlatformProductEnrichment(input) {
  if (!uuid.test(input.requestId || '')) throw new Error('缺少有效提交编号');
  const ids = enrichmentIds(input);
  const c = await pool.connect();
  let locked = false;
  try {
    locked = await lock(c, 'platform-products-submit');
    if (!locked) throw new Error('正在提交平台商品任务，请稍后重试');
    await c.query('BEGIN');
    const old = (
      await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
        input.requestId,
      ])
    ).rows[0];
    if (old) {
      await c.query('COMMIT');
      return old;
    }
    const active = (
      await c.query(
        "SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      )
    ).rows;
    if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
    const products = [];
    for (const id of ids) {
      const p = (
        await c.query(
          'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
          [`business:products:${id}`],
        )
      ).rows[0]?.value;
      if (!p) throw new Error('选中的商品已不存在，请刷新列表');
      if (
        active.some(
          (j) =>
            j.input.kind === 'platform_products' &&
            ((j.input.productIds || []).includes(id) ||
              (j.checkpoint.productIds || []).includes(id) ||
              (j.input.mode !== 'enrich' && j.input.market === p.market)),
        )
      )
        throw new Error('这些商品仍有平台采集任务，请等待完成或取消');
      products.push(p);
    }
    if (
      products.some((p) => p.sourceProvider === 'Sorftime') &&
      !(await readSorftimeToken(await collectorEnv()))
    )
      throw new Error('请先配置 Sorftime MCP Token');
    const maxRequests = Number(
      input.maxRequests ?? enrichmentPlan(products).defaultMaxRequests,
    );
    if (
      !Number.isInteger(maxRequests) ||
      maxRequests < 1 ||
      maxRequests > 100_000
    )
      throw new Error('商品补全请求上限须为1～100000');
    const at = new Date().toISOString();
    const id = randomUUID();
    const value = {
      kind: 'platform_products',
      mode: 'enrich',
      publicCompletionVersion: 1,
      completeAll: true,
      enrich: input.enrich !== false,
      trend: true,
      seeds: [],
      productIds: ids,
      markets: [...new Set(products.map((p) => p.market))],
      providers: [
        ...new Set(
          products.flatMap((p) =>
            publicProductUrl(p)
              ? ['public_product']
              : p.sourceProvider === 'Sorftime'
                ? ['sorftime']
                : [],
          ),
        ),
      ],
      maxProducts: ids.length,
      perKeyword: 1,
      maxRequests,
      maxDomains: 1,
      semrushUnitLimit: 0,
      initialWork: [],
    };
    const completion = {};
    for (const p of products) {
      const work = productCompletionWork(p, value);
      const states = {};
      if (work.length === 0) {
        const official = p.sourceProvider !== 'Sorftime';
        states[official ? 'public_detail' : 'trend'] = {
          ...unsupportedCompletion(p, id, at),
          ...(official
            ? {
                message:
                  '缺少可核验的官网商品链接，当前来源无法补全该商品的上架时间和销量',
              }
            : {}),
        };
      }
      for (const step of work) {
        const key = completionKey(step);
        const current = p.dataCompletion?.[key];
        const fresh =
          current?.status === 'completed' &&
          Date.now() - Date.parse(current.at) < 86_400_000;
        if (
          !input.refresh &&
          fresh &&
          (step.provider !== 'public_product' ||
            (p.publicDataEvidence?.listing?.status === 'observed' &&
              p.publicDataEvidence?.sold?.status === 'observed' &&
              (!p.catalogEvidenceUrl?.includes('westmonth.com') ||
                p.priceEvidence?.kind === 'discount')))
        )
          states[key] = { ...current, jobId: id };
        else {
          value.initialWork.push(step);
          states[key] = {
            status: 'queued',
            jobId: id,
            at,
            message: '等待后台补全，覆盖全部所选商品',
          };
        }
      }
      completion[p.id] = states;
      await putDocument(
        'workspace_documents',
        `business:products:${p.id}`,
        mergePlatformProduct(p, { id: p.id, dataCompletion: states }),
        false,
        c,
      );
    }
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, input.requestId, value, { submittedAt: at, completion }],
    );
    await c.query('COMMIT');
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked) await unlock(c, 'platform-products-submit');
    c.release();
  }
}

export async function cancelPlatformCompletion(job) {
  if (job?.input?.kind !== 'platform_products' || !job.input.completeAll)
    return;
  const cp = job.checkpoint;
  for (const [id, steps] of Object.entries(cp.completion || {})) {
    const p = await readProduct(id);
    const patch = {};
    for (const [key, value] of Object.entries(steps)) {
      if (
        p?.dataCompletion?.[key]?.jobId === job.id &&
        ['queued', 'running'].includes(value.status)
      ) {
        patch[key] = {
          ...value,
          status: 'cancelled',
          message: '任务已取消，可重新补全未完成部分',
          at: new Date().toISOString(),
        };
        cp.completion[id][key] = patch[key];
      }
    }
    if (Object.keys(patch).length > 0)
      await upsertProduct({ id, dataCompletion: patch });
  }
  await saveCheckpoint(job, cp, 'cancelled');
}
export async function runPlatformProducts(job, overrides = {}) {
  const io = {
    collect,
    saveCheckpoint,
    upsertProduct,
    upsertContent: upsertResourceContent,
    readProduct,
    linkKeyword,
    now: () => Date.now(),
    readKeyword,
    isCancelled: async () =>
      Boolean(
        (
          await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
            job.id,
          ])
        ).rows[0]?.cancelled,
      ),
    ...overrides,
  };
  const v = job.input;
  if (v.resourceDiscovery) return runProductResourceDiscovery(job, io);
  const cp = {
    index: 0,
    requests: 0,
    discoveryRequests: 0,
    completion: {},
    products: v.productIds?.length || 0,
    failures: 0,
    semrushReserved: 0,
    semrushUnits: 0,
    productIds: v.productIds || [],
    detailIds: [],
    termProductIds: {},
    work:
      v.initialWork ||
      v.seeds.flatMap((term) =>
        v.providers.map((provider) => ({
          provider,
          term,
          op: provider === 'semrush' ? 'domains' : 'search',
          page: 1,
        })),
      ),
    logs: [],
    ...job.checkpoint,
  };
  cp.startedAt ||= new Date(io.now()).toISOString();
  const setCompletion = async (work, status, message, points) => {
    if (!v.completeAll || !work.productId) return;
    const key = completionKey(work);
    const state = {
      status,
      message,
      points,
      jobId: job.id,
      at: new Date(io.now()).toISOString(),
    };
    (cp.completion[work.productId] ||= {})[key] = state;
    await io.upsertProduct({
      id: work.productId,
      dataCompletion: { [key]: state },
    });
  };
  const finish = async (status) => {
    if (v.completeAll && ['cancelled', 'partial'].includes(status)) {
      for (const [id, states] of Object.entries(cp.completion))
        for (const [key, state] of Object.entries(states))
          if (['queued', 'running'].includes(state.status)) {
            const ended = {
              ...state,
              status: status === 'cancelled' ? 'cancelled' : 'failed',
              message:
                status === 'cancelled'
                  ? '任务已取消，可重新补全未完成部分'
                  : cp.stopReason === 'request_limit'
                    ? '达到手动设置的请求预算，本步骤未执行'
                    : '任务未完成该步骤，请查看日志后重试',
            };
            cp.completion[id][key] = ended;
            await io.upsertProduct({ id, dataCompletion: { [key]: ended } });
          }
    }
    cp.finishedAt = new Date(io.now()).toISOString();
    cp.nextRunAt = 0;
    return io.saveCheckpoint(job, cp, status);
  };
  if (await io.isCancelled()) return finish('cancelled');
  if (
    !cp.inFlight &&
    cp.requests >= v.maxRequests &&
    cp.index < cp.work.length
  ) {
    cp.failures++;
    cp.stopReason = 'request_limit';
    cp.logs.push('已达到整批调用上限，剩余步骤未执行；已保存商品保留');
    return finish('partial');
  }
  if (cp.index >= cp.work.length)
    return finish(cp.failures ? 'partial' : 'completed');
  if (v.discoveryDay) {
    const current = await Promise.all(
      (v.keywordRecords || []).map((k) => io.readKeyword(k.id)),
    );
    if (
      !current.some(
        (k) =>
          k?.reviewStatus === 'selected' &&
          k.market === v.market &&
          v.seeds.includes(k.term),
      )
    ) {
      cp.logs.push('入选关键词已移除或变更，停止本次每日商品发现');
      return finish('cancelled');
    }
  }
  const w = cp.work[cp.index];
  if (w.provider === 'public_product' && !cp.inFlight) {
    const product = await io.readProduct(w.productId);
    const url = product && publicProductUrl(product);
    const host = url ? new URL(url).hostname : '';
    if (host && cp.publicBlockedHosts?.[host]) {
      cp.failures++;
      await setCompletion(
        w,
        'failed',
        '该官网本批已返回限流或访问受限，后续商品未发起请求；可稍后重新补全',
      );
      cp.index++;
      cp.nextRunAt = io.now() + 1500;
      return cp.index >= cp.work.length
        ? finish('partial')
        : io.saveCheckpoint(job, cp, 'running');
    }
    if (host && (cp.publicDomainNextAt?.[host] || 0) > io.now()) {
      cp.nextRunAt = cp.publicDomainNextAt[host];
      return io.saveCheckpoint(job, cp, 'running');
    }
  }
  const termKey = `${w.provider}:${w.term}`;
  cp.currentTerm = w.term || w.productId;
  const addWork = (work) => {
    const key = workId(work);
    if (!cp.work.some((x) => workId(x) === key)) cp.work.push(work);
  };
  try {
    const limit =
      w.op === 'domains'
        ? v.maxDomains
        : Math.max(
            1,
            Math.min(
              20,
              v.perKeyword - (cp.termProductIds[termKey] || []).length,
              v.maxProducts - cp.productIds.length,
            ),
          );
    const units =
      w.provider === 'semrush' ? limit * (w.op === 'domains' ? 20 : 30) : 0;
    const isDiscovery = ['domains', 'search', 'shopping'].includes(w.op);
    const exhausted = cp.requests >= v.maxRequests;
    if (cp.blockedProviders?.[w.provider]) {
      cp.failures++;
      await setCompletion(
        w,
        'failed',
        '该来源鉴权、额度或限流异常；未继续发起本步骤，可修复后补全',
      );
      cp.logs.push(
        `${w.provider}：此前鉴权或结构检查失败，本步骤未发起请求，其他来源继续`,
      );
    } else if (!cp.inFlight && exhausted) {
      cp.failures++;
      await setCompletion(w, 'failed', '达到手动设置的请求预算，本步骤未执行');
      cp.logs.push(
        `${w.provider} · ${cp.currentTerm}：达到任务调用预算，未发起请求`,
      );
    } else {
      const product = w.productId
        ? await io.readProduct(w.productId)
        : undefined;
      if (w.productId && !product) throw new Error('商品已删除，跳过详情请求');
      const remainingForTerm =
        v.perKeyword - (cp.termProductIds[termKey] || []).length;
      const needsDiscovery = ['domains', 'search', 'shopping'].includes(w.op);
      if (
        needsDiscovery &&
        (cp.productIds.length >= v.maxProducts || remainingForTerm <= 0)
      ) {
        cp.logs.push(`${w.term}：商品数量已达上限，跳过后续发现请求`);
      } else {
        if (!cp.inFlight) {
          const allowance =
            w.provider === 'public_product'
              ? Math.min(2, v.maxRequests - cp.requests)
              : 1;
          cp.requests += allowance;
          if (w.provider === 'public_product') {
            const url = publicProductUrl(product);
            if (url)
              (cp.publicDomainNextAt ||= {})[new URL(url).hostname] =
                io.now() + 30_000;
          }
          if (isDiscovery) cp.discoveryRequests++;
          await setCompletion(w, 'running', '正在向平台请求数据');
          cp.semrushReserved += units;
          cp.inFlight = {
            index: cp.index,
            units,
            ...(w.provider === 'public_product'
              ? { requestAllowance: allowance }
              : {}),
          };
          await io.saveCheckpoint(job, cp, 'running');
        }
        const request = {
          sources: ['platform_products'],
          ...w,
          market: product?.market || v.market,
          refreshEmpty: v.mode === 'enrich',
          discoveryDay: v.discoveryDay,
          ...(w.provider === 'public_product'
            ? { publicRequestLimit: cp.inFlight.requestAllowance || 1 }
            : {}),
          limit: needsDiscovery ? limit : undefined,
          product,
        };
        const result = await io.collect(job, `platform:${cp.index}`, request);
        if (w.provider === 'public_product') {
          const reserved = cp.inFlight.requestAllowance || 1;
          if (
            !Number.isInteger(result.providerCalls) ||
            result.providerCalls < 0 ||
            result.providerCalls > reserved
          )
            throw new Error('公开商品返回请求计数异常，未释放预留预算');
          cp.requests -= reserved - result.providerCalls;
          const errors = result.patch?.publicDataEvidence?.errors || [];
          if (errors.length) cp.failures++;
          if (
            errors.some(
              (e) =>
                e.reason === 'rate_limited' || [401, 403].includes(e.status),
            )
          ) {
            const url = publicProductUrl(product);
            if (url)
              (cp.publicBlockedHosts ||= {})[new URL(url).hostname] = true;
          }
        }
        if (
          w.provider === 'tiktok_shop' &&
          Number.isFinite(result.providerCalls)
        )
          cp.creditsCharged = (cp.creditsCharged || 0) + result.providerCalls;
        if (Number.isFinite(result.apiUnits) && result.apiUnits >= 0)
          cp.semrushUnits += result.apiUnits;
        if (w.provider === 'semrush' && !Number.isFinite(result.apiUnits))
          cp.unknownCharges = (cp.unknownCharges || 0) + 1;
        if (w.provider === 'semrush' && result.apiUnits > units) {
          cp.semrushReserved += result.apiUnits - units;
          cp.logs.push(
            'Semrush 返回用量高于当前预留费率，已按实际用量修正记录',
          );
        }
        if (result.cached) {
          cp.cacheHits = (cp.cacheHits || 0) + 1;
          cp.semrushReserved -= units;
        }
        if (result.domains)
          for (const domain of result.domains.slice(0, v.maxDomains))
            addWork({
              provider: 'semrush',
              op: 'shopping',
              domain,
              term: w.term,
            });
        if (result.products) {
          for (const p of result.products) {
            const existing = cp.productIds.includes(p.id);
            const ids = (cp.termProductIds[termKey] ||= []);
            if (
              ids.length >= v.perKeyword ||
              (!existing && cp.productIds.length >= v.maxProducts)
            )
              break;
            const keywords = (v.keywordRecords || []).filter(
              (k) => k.term.toLowerCase() === w.term.toLowerCase(),
            );
            const keywordIds = keywords.map((k) => k.id);
            await io.upsertProduct({ ...p, keywordIds, queryTerms: [w.term] });
            for (const keyword of keywords)
              await io.linkKeyword(keyword, [p.id]);
            if (!existing) cp.productIds.push(p.id);
            if (!ids.includes(p.id)) ids.push(p.id);
            if (v.completeAll && w.provider === 'sorftime') {
              if (!cp.detailIds.includes(p.id)) {
                cp.detailIds.push(p.id);
                const planned = productCompletionWork(p, v, w.term);
                if (planned.length === 0 && (v.enrich || v.trend)) {
                  const state = unsupportedCompletion(
                    p,
                    job.id,
                    new Date(io.now()).toISOString(),
                  );
                  (cp.completion[p.id] ||= {}).trend = state;
                  await io.upsertProduct({
                    id: p.id,
                    dataCompletion: { trend: state },
                  });
                }
                for (const step of planned) {
                  addWork(step);
                  await setCompletion(
                    step,
                    'queued',
                    '等待后台补全，覆盖全部已发现商品',
                  );
                }
              }
            } else if (
              w.provider === 'sorftime' &&
              (v.enrich || v.trend) &&
              !cp.detailIds.includes(p.id) &&
              cp.detailIds.length < v.maxDetailProducts
            ) {
              cp.detailIds.push(p.id);
              if (v.enrich)
                for (const op of [
                  ...(p.sourceMetrics?.rating === undefined ||
                  !p.decisionData?.listing
                    ? ['detail']
                    : []),
                  'content',
                ])
                  addWork({
                    provider: 'sorftime',
                    op,
                    productId: p.id,
                    term: w.term,
                  });
              if (v.trend)
                addWork({
                  provider: 'sorftime',
                  op: 'trend',
                  productId: p.id,
                  term: w.term,
                });
            }
          }
          const seenPages = ((cp.discoveryPages ||= {})[termKey] ||= []);
          const repeatedPage =
            result.pageFingerprint &&
            seenPages.includes(result.pageFingerprint);
          if (result.pageFingerprint && !repeatedPage)
            seenPages.push(result.pageFingerprint);
          if (repeatedPage)
            cp.logs.push(
              `${w.term}：平台返回重复搜索页，停止翻页；已发现商品补全继续`,
            );
          if (
            ['sorftime', 'tiktok_shop'].includes(w.provider) &&
            !repeatedPage &&
            result.hasMore &&
            w.page < 5 &&
            (cp.termProductIds[termKey] || []).length < v.perKeyword
          )
            addWork({ ...w, page: w.page + 1 });
        }
        if (product) {
          let patch = { id: product.id };
          if (result.product) patch = result.product;
          if (result.patch) patch = { ...patch, ...result.patch };
          if (result.series?.points.length)
            patch.decisionData = { series: [result.series] };
          await io.upsertProduct(patch);
          await setCompletion(
            w,
            result.empty && result.patch?.publicDataEvidence?.errors?.length
              ? 'failed'
              : result.empty ||
                  (result.series && result.series.points.length === 0)
                ? 'empty'
                : 'completed',
            result.message || '已保存来源数据；未返回的字段保持未知',
            result.series?.points.length,
          );
        }
        cp.products = cp.productIds.length;
        let message = '已保存平台详情；缺项保留未知';
        if (result.products)
          message = `返回${result.products.length}件，任务累计保存${cp.products}件`;
        if (result.domains) message = `发现${result.domains.length}个商家域名`;
        cp.logs.push(
          `${w.provider} · ${w.op} · ${cp.currentTerm}：${result.message || message}`,
        );
      }
    }
  } catch (error) {
    if (
      /HTTP (401|403|429)|unauthori|过期|重新适配|字段结构已变化/i.test(
        error.message,
      )
    )
      (cp.blockedProviders ||= {})[w.provider] = true;
    cp.failures++;
    await setCompletion(
      w,
      /结果未知|可能.*扣费/.test(error.message) ? 'unknown' : 'failed',
      error.message,
    );
    cp.logs.push(
      `${w.provider} · ${w.op} · ${cp.currentTerm}：${error.message}。其他对象继续；未自动重复可能扣费的请求`,
    );
  }
  cp.inFlight = undefined;
  cp.index++;
  if (await io.isCancelled()) return finish('cancelled');
  cp.logs = cp.logs.slice(-300);
  if (cp.index >= cp.work.length)
    return finish(cp.failures ? 'partial' : 'completed');
  cp.nextRunAt = io.now() + 1500;
  return io.saveCheckpoint(job, cp, 'running');
}

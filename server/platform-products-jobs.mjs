/* eslint-disable unicorn/no-await-expression-member -- Keep SQL row access consistent with existing server modules. */
import { randomUUID } from 'node:crypto';
import { lock, unlock, pool, putDocument } from './database.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { observeDiscovery } from './discovery-newness.mjs';
import { readKeyword } from './enrichment-jobs.mjs';
import { collectorEnv } from './local-provider.mjs';
import { readSorftimeToken } from './collector.js';
import {
  completionKey,
  productCompletionWork,
  unsupportedCompletion,
} from './platform-product-completion.mjs';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export function validatePlatformProducts(input) {
  if (!uuid.test(input.requestId || '')) throw new Error('缺少有效提交编号');
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
  if (!['US', 'MX', 'VN'].includes(input.market))
    throw new Error('请选择支持的目标市场');
  if (
    !Array.isArray(input.providers) ||
    input.providers.length === 0 ||
    input.providers.some((p) => !['sorftime', 'semrush'].includes(p))
  )
    throw new Error('请选择 Sorftime 或 Semrush 来源');
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
    maxRequests: input.maxRequests ?? (input.completeAll === false ? 25 : 0),
    maxDetailProducts:
      input.maxDetailProducts ?? (input.completeAll === false ? 5 : 0),
    maxDomains: input.maxDomains ?? 3,
    semrushUnitLimit:
      input.semrushUnitLimit ?? (input.completeAll === false ? 2000 : 0),
  };
  for (const [key, min, max] of [
    ['maxProducts', 1, 1000],
    ['perKeyword', 1, 100],
    ['maxRequests', value.completeAll ? 0 : 1, 100_000],
    ['maxDetailProducts', 0, 100],
    ['maxDomains', 1, 5],
    ['semrushUnitLimit', 0, 100_000],
  ])
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
      throw new Error('商品数量、请求次数或单位预算不在允许范围');
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
  const value = validatePlatformProducts(input),
    c = await pool.connect();
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
          ((j.input.mode === 'enrich' &&
            j.input.markets?.includes(value.market)) ||
            (j.input.market === value.market &&
              j.input.seeds?.some((s) => value.seeds.includes(s)))),
      )
    )
      throw new Error('这些关键词已有平台商品任务，请等待完成');
    if (
      value.providers.includes('sorftime') &&
      !(await readSorftimeToken(await collectorEnv()))
    )
      throw new Error('请先在数据源与设置中配置 Sorftime MCP Token');
    if (
      value.providers.includes('semrush') &&
      (
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [
          'provider:semrush:mcp:v1',
        ])
      ).rows.length === 0
    )
      throw new Error('请先配置 Semrush MCP');
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
    const value = observeDiscovery(old, mergePlatformProduct(old, patch), 'product');
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

export async function submitPlatformProductEnrichment(input) {
  if (!uuid.test(input.requestId || '')) throw new Error('缺少有效提交编号');
  const ids = input.productIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 5000 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || id.length > 200)
  )
    throw new Error('请选择有效且不重复的商品');
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
    const id = randomUUID(),
      at = new Date().toISOString();
    const value = {
      kind: 'platform_products',
      mode: 'enrich',
      completeAll: true,
      enrich: input.enrich !== false,
      trend: true,
      seeds: [],
      productIds: ids,
      markets: [...new Set(products.map((p) => p.market))],
      providers: ['sorftime'],
      maxProducts: ids.length,
      perKeyword: 1,
      maxRequests: 0,
      maxDomains: 1,
      semrushUnitLimit: 0,
      initialWork: [],
    };
    const completion = {};
    for (const p of products) {
      const work = productCompletionWork(p, value);
      const states = {};
      if (work.length === 0) states.trend = unsupportedCompletion(p, id, at);
      for (const step of work) {
        const key = completionKey(step),
          current = p.dataCompletion?.[key];
        const fresh =
          current?.status === 'completed' &&
          Date.now() - Date.parse(current.at) < 86_400_000;
        if (!input.refresh && fresh) states[key] = { ...current, jobId: id };
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
          op: provider === 'sorftime' ? 'search' : 'domains',
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
    !v.completeAll &&
    !cp.inFlight &&
    cp.requests >= v.maxRequests &&
    cp.index < cp.work.length
  ) {
    cp.failures++;
    cp.logs.push('已达到整批调用上限，剩余步骤未执行；已保存商品保留');
    return finish('partial');
  }
  if (cp.index >= cp.work.length)
    return finish(cp.failures ? 'partial' : 'completed');
  if (v.discoveryDay) {
    const current = await Promise.all((v.keywordRecords || []).map((k) => io.readKeyword(k.id)));
    if (!current.some((k) => k?.reviewStatus === 'selected' && k.market === v.market && v.seeds.includes(k.term))) {
      cp.logs.push('入选关键词已移除或变更，停止本次每日商品发现');
      return finish('cancelled');
    }
  }
  const w = cp.work[cp.index];
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
    const isDiscovery = ['search', 'shopping', 'domains'].includes(w.op);
    const exhausted =
      v.maxRequests > 0 &&
      (v.completeAll ? cp.discoveryRequests : cp.requests) >= v.maxRequests;
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
    } else if (
      !cp.inFlight &&
      ((exhausted && (!v.completeAll || isDiscovery)) ||
        (v.semrushUnitLimit > 0 &&
          cp.semrushReserved + units > v.semrushUnitLimit))
    ) {
      cp.failures++;
      await setCompletion(w, 'failed', '达到手动设置的请求预算，本步骤未执行');
      cp.logs.push(
        `${w.provider} · ${cp.currentTerm}：达到任务调用或 Semrush 单位预算，未发起请求`,
      );
    } else {
      const product = w.productId
        ? await io.readProduct(w.productId)
        : undefined;
      if (w.productId && !product) throw new Error('商品已删除，跳过详情请求');
      const remainingForTerm =
        v.perKeyword - (cp.termProductIds[termKey] || []).length;
      const needsDiscovery = ['search', 'shopping', 'domains'].includes(w.op);
      if (
        needsDiscovery &&
        (cp.productIds.length >= v.maxProducts || remainingForTerm <= 0)
      ) {
        cp.logs.push(`${w.term}：商品数量已达上限，跳过后续发现请求`);
      } else {
        if (!cp.inFlight) {
          cp.requests++;
          if (isDiscovery) cp.discoveryRequests++;
          await setCompletion(w, 'running', '正在向平台请求数据');
          cp.semrushReserved += units;
          cp.inFlight = { index: cp.index, units };
          await io.saveCheckpoint(job, cp, 'running');
        }
        const request = {
          sources: ['platform_products'],
          ...w,
          market: product?.market || v.market,
          refreshEmpty: v.mode === 'enrich',
          discoveryDay: v.discoveryDay,
          limit: needsDiscovery ? limit : undefined,
          product,
        };
        const result = await io.collect(job, `platform:${cp.index}`, request);
        if (Number.isFinite(result.apiUnits) && result.apiUnits >= 0)
          cp.semrushUnits += result.apiUnits;
        if (w.provider === 'semrush' && !Number.isFinite(result.apiUnits))
          cp.unknownCharges = (cp.unknownCharges || 0) + 1;
        if (w.provider === 'semrush' && result.apiUnits > units) {
          cp.semrushReserved += result.apiUnits - units;
          cp.logs.push(
            'Semrush 返回用量高于当前预留费率，已修正预留并按新余额停止后续超预算请求',
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
            if (v.completeAll) {
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
            w.provider === 'sorftime' &&
            !repeatedPage &&
            result.hasMore &&
            (v.completeAll || w.page < 5) &&
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
            result.empty || (result.series && result.series.points.length === 0)
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

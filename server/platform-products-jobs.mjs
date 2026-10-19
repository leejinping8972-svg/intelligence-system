/* eslint-disable unicorn/no-await-expression-member -- Keep SQL row access consistent with existing server modules. */
import { randomUUID } from 'node:crypto';
import { lock, unlock, pool, putDocument } from './database.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { collectorEnv } from './local-provider.mjs';
import { readSorftimeToken } from './collector.js';

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
    enrich: input.enrich === true,
    trend: input.trend === true,
    maxProducts: input.maxProducts ?? 100,
    perKeyword: input.perKeyword ?? 20,
    maxRequests: input.maxRequests ?? 25,
    maxDetailProducts: input.maxDetailProducts ?? 5,
    maxDomains: input.maxDomains ?? 3,
    semrushUnitLimit: input.semrushUnitLimit ?? 2000,
  };
  for (const [key, min, max] of [
    ['maxProducts', 1, 1000],
    ['perKeyword', 1, 100],
    ['maxRequests', 1, 1000],
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
  if (value.maxRequests < value.seeds.length * value.providers.length)
    throw new Error(
      '整批请求上限不足以覆盖每个关键词和所选来源，请提高上限或减少关键词',
    );
  return value;
}
export async function submitPlatformProducts(input) {
  const value = validatePlatformProducts(input),
    c = await pool.connect();
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
          j.input.market === value.market &&
          j.input.seeds?.some((s) => value.seeds.includes(s)),
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
async function upsertProduct(patch) {
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
    const value = mergePlatformProduct(old, patch);
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
async function readProduct(id) {
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
  ].join('|');
export async function runPlatformProducts(job, overrides = {}) {
  const io = {
    collect,
    saveCheckpoint,
    upsertProduct,
    readProduct,
    linkKeyword,
    now: () => Date.now(),
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
    products: 0,
    failures: 0,
    semrushReserved: 0,
    semrushUnits: 0,
    productIds: [],
    detailIds: [],
    termProductIds: {},
    work: v.seeds.flatMap((term) =>
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
  const finish = (status) => {
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
    cp.logs.push('已达到整批调用上限，剩余步骤未执行；已保存商品保留');
    return finish('partial');
  }
  if (cp.index >= cp.work.length)
    return finish(cp.failures ? 'partial' : 'completed');
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
    if (cp.blockedProviders?.[w.provider]) {
      cp.failures++;
      cp.logs.push(
        `${w.provider}：此前鉴权或结构检查失败，本步骤未发起请求，其他来源继续`,
      );
    } else if (
      !cp.inFlight &&
      (cp.requests >= v.maxRequests ||
        cp.semrushReserved + units > v.semrushUnitLimit)
    ) {
      cp.failures++;
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
          cp.semrushReserved += units;
          cp.inFlight = { index: cp.index, units };
          await io.saveCheckpoint(job, cp, 'running');
        }
        const request = {
          sources: ['platform_products'],
          ...w,
          market: v.market,
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
            if (
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
          if (
            w.provider === 'sorftime' &&
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
    cp.logs.push(
      `${w.provider} · ${w.op} · ${cp.currentTerm}：${error.message}。其他对象继续；未自动重复可能扣费的请求`,
    );
  }
  cp.inFlight = undefined;
  cp.index++;
  cp.logs = cp.logs.slice(-300);
  if (cp.index >= cp.work.length)
    return finish(cp.failures ? 'partial' : 'completed');
  cp.nextRunAt = io.now() + 1500;
  return io.saveCheckpoint(job, cp, 'running');
}

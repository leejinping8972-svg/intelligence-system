import { createHash, randomUUID } from 'node:crypto';
import { pool, lock, unlock } from './database.mjs';
import { inferCategory } from './collector.js';
export function siteHostAllowed(host, domain) {
  const root = String(domain)
    .toLowerCase()
    .replace(/^www\./, '');
  host = String(host)
    .toLowerCase()
    .replace(/^www\./, '');
  return host === root || host.endsWith(`.${root}`);
}
export function siteBase(site) {
  try {
    const u = new URL(site.evidenceUrl);
    if (
      siteHostAllowed(u.hostname, site.domain) &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password
    )
      return u.origin;
  } catch {}
  return `https://${site.domain}`;
}
const read = async (id) =>
  (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `business:sites:${id}`,
    ])
  ).rows[0]?.value;
export function catalogLinks(html, pageUrl, sitemap = false) {
  const values = sitemap
    ? [...html.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map((m) =>
        m[1].replace(/<!\[CDATA\[|\]\]>/g, ''),
      )
    : [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  return [
    ...new Set(
      values.flatMap((v) => {
        try {
          const u = new URL(v.replaceAll('&amp;', '&'), pageUrl);
          if (
            u.hostname.replace(/^www\./, '') !== host ||
            !['https:', 'http:'].includes(u.protocol) ||
            u.username ||
            u.password ||
            /\.(?:jpe?g|png|webp|pdf|mp4)$/i.test(u.pathname)
          )
            return [];
          u.hash = '';
          return /sitemap.*\.xml|\/(?:products?|collections?|shop|tienda|san-pham)(?:\/|$)|[?&](?:page|paged)=/i.test(
            u.pathname + u.search,
          )
            ? [u.toString()]
            : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
export function normalizeProduct(p, site, at = new Date().toISOString()) {
  const url = new URL(p.url);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !siteHostAllowed(url.hostname, site.domain)
  )
    throw new Error('商品结构化地址不是当前独立站，未关联入库');
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  const hash = createHash('sha256')
    .update(url.toString())
    .digest('hex')
    .slice(0, 24);
  return {
    id: `${site.market}-product-${hash}`,
    title: p.title,
    brand: p.brand || site.brand,
    market: site.market,
    category: inferCategory(p.title, p.ingredients, p.description),
    form: p.form || '待识别',
    size: p.size || '官网未公开',
    price: Number.isFinite(p.price) ? p.price : 0,
    currency: p.currency,
    ingredient: p.ingredients || '官网未公开可验证配方',
    dose: p.servingSize || '官网未公开每份用量',
    claim: p.description || '',
    benefits: p.benefits || [],
    benefitEvidence: p.description
      ? `官网商品页描述：${p.description}`
      : '未提取到公开卖点',
    ingredientInsights: p.ingredientInsights || [],
    siteId: site.id,
    imageUrl: p.image || undefined,
    collectionFields: p.collectionFields || [],
    extractionMethod: p.extractionMethod || '官网结构化商品数据',
    color: '#e9f4f0',
    reviewed: false,
    favorite: false,
    firstSeenAt: at,
    lastCollectedAt: at,
    evidenceUrl: url.toString(),
    dataNature: 'collected',
  };
}
export async function submitProducts(input) {
  if (
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId) ||
    !Array.isArray(input.siteIds) ||
    !input.siteIds.length ||
    input.siteIds.length > 100 ||
    input.siteIds.some((id) => typeof id !== 'string' || id.length > 160)
  )
    throw new Error('请选择1～100家站点');
  const maxProducts = Number(input.maxProducts ?? 100),
    maxRequests = Number(input.maxRequests ?? 100);
  const perSite = Number(
    input.maxRequestsPerSite ??
      Math.ceil(maxRequests / new Set(input.siteIds).size),
  );
  if (
    !Number.isInteger(maxProducts) ||
    maxProducts < 1 ||
    maxProducts > 1000 ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 2000 ||
    maxRequests < new Set(input.siteIds).size ||
    !Number.isInteger(perSite) ||
    perSite < 1 ||
    perSite > maxRequests
  )
    throw new Error(
      '单站商品上限1～1000，任务网页请求上限须覆盖全部站点且不超过2000；单站请求上限不得超过整批上限',
    );
  const c = await pool.connect();
  let locked = false;
  try {
    locked = await lock(c, 'products-submit');
    if (!locked) throw new Error('正在提交，请稍后重试');
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
    const records = [];
    for (const id of new Set(input.siteIds)) {
      const site = await read(id);
      if (!site) throw new Error('所选站点已删除');
      if (
        active.some(
          (j) => j.input.kind === 'products' && j.input.siteIds.includes(id),
        )
      )
        throw new Error('选中站点已有商品采集任务');
      records.push(site);
    }
    const id = randomUUID();
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [
        id,
        input.requestId,
        {
          kind: 'products',
          siteIds: records.map((s) => s.id),
          records,
          markets: [...new Set(records.map((s) => s.market))],
          maxProducts,
          maxRequests,
          maxRequestsPerSite: perSite,
        },
        { submittedAt: new Date().toISOString() },
      ],
    );
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
  } finally {
    if (locked) await unlock(c, 'products-submit');
    c.release();
  }
}
export { runProductsJob } from './product-queue.mjs';

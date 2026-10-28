import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { transcriptFailure } from './ad-transcript.mjs';
import { requireAdmin } from './auth.mjs';
import { pool, putDocument } from './database.mjs';
import { landingUrl } from './safe-web.mjs';
import { scheduleSource } from './source-scheduler.mjs';
const NAME = 'provider:scrapecreators:v1';
const aad = Buffer.from(NAME);
export function sealAdsKey(
  key,
  secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(secret, 'base64'), iv);
  c.setAAD(aad);
  return {
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([c.update(key, 'utf8'), c.final()]).toString(
      'base64',
    ),
    tag: c.getAuthTag().toString('base64'),
  };
}
export function openAdsKey(
  value,
  secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
) {
  const c = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(secret, 'base64'),
    Buffer.from(value.iv, 'base64'),
  );
  c.setAAD(aad);
  c.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    c.update(Buffer.from(value.ciphertext, 'base64')),
    c.final(),
  ]).toString('utf8');
}
export async function adsConfig(input, user) {
  if (input.action === 'server_ads_config' || input.verify) requireAdmin(user);
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME])
  ).rows[0]?.value;
  if (input.action === 'server_ads_config') {
    const key = String(input.apiKey || '').trim();
    if (key.length < 10 || key.length > 4096 || /\s|https?:|bearer/i.test(key))
      throw new Error('请填写 ScrapeCreators API Key 本身');
    await putDocument('provider_configs', NAME, {
      ...sealAdsKey(key),
      updatedAt: new Date().toISOString(),
    });
    return {
      configured: true,
      ready: false,
      message: '密钥已在服务器加密保存，请检测连接',
    };
  }
  if (!stored)
    return {
      configured: false,
      ready: false,
      message: '尚未配置 ScrapeCreators API Key',
    };
  if (!input.verify)
    return {
      configured: true,
      ready: false,
      ...stored.lastCheck,
      message: stored.lastCheck?.message || '已配置，等待检测连接',
    };
  const result = await scrapeRequest(
    '/v1/account/credit-balance',
    {},
    openAdsKey(stored),
  );
  const check = {
    configured: true,
    ready: true,
    message: 'ScrapeCreators 连接成功',
    checkedAt: new Date().toISOString(),
    creditsRemaining:
      result.creditCount ??
      result.credits_remaining ??
      result.credit_balance ??
      result.credits,
  };
  await putDocument('provider_configs', NAME, { ...stored, lastCheck: check });
  return check;
}
export async function scrapeRequest(
  path,
  params,
  key,
  fetcher = fetch,
  method = 'POST',
) {
  const url = new URL(path, 'https://api.scrapecreators.com');
  if (method === 'GET')
    for (const [name, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(name, String(value));
  return scheduleSource(
    'scrapecreators',
    async () => {
      const response = await fetcher(url, {
        method: path.includes('/account/') ? 'GET' : method,
        redirect: 'manual',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        ...(path.includes('/account/') || method === 'GET'
          ? {}
          : { body: JSON.stringify(params) }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        if (path === '/v1/facebook/adLibrary/ad/transcript')
          throw await transcriptFailure(response);
        await response.body?.cancel();
        throw Object.assign(
          new Error(
            `ScrapeCreators HTTP ${response.status}：${[401, 403].includes(response.status) ? '密钥无效或权限不足' : response.status === 429 ? '上游限流，请稍后重试' : '接口请求未成功'}`,
          ),
          {
            status: response.status,
            retryAfterSeconds: Number(response.headers.get('retry-after')) || 0,
          },
        );
      }
      const result = await response.json();
      if (result.success === false)
        throw new Error(
          'ScrapeCreators 未成功返回数据，请核对账户额度与接口权限',
        );
      return result;
    },
    { intervalMs: fetcher === fetch ? 1000 : 0 },
  );
}
const txt = (v) =>
  typeof v === 'string'
    ? v.slice(0, 12000)
    : typeof v?.text === 'string'
      ? v.text.slice(0, 12000)
      : '';
const mediaUrl = (v) => {
  try {
    const u = new URL(v);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};
export function normalizeAds(payload, record, at = new Date().toISOString()) {
  if (!Array.isArray(payload.searchResults))
    throw new Error('广告接口未返回 searchResults，已停止以避免误报完成');
  const ads = new Map();
  for (const raw of payload.searchResults) {
    if (!/^\d+$/.test(String(raw.ad_archive_id || ''))) continue;
    const s = raw.snapshot || {};
    const cards = Array.isArray(s.cards) ? s.cards : [];
    const links = [s.link_url, ...cards.map((c) => c.link_url)]
      .map(landingUrl)
      .filter(Boolean);
    const images = [...(s.images || []), ...cards]
      .map((i) => mediaUrl(i.original_image_url || i.resized_image_url))
      .filter(Boolean);
    const videoItems = [...(s.videos || []), ...cards];
    const videos = videoItems
      .flatMap((i) => [mediaUrl(i.video_hd_url), mediaUrl(i.video_sd_url)])
      .filter(Boolean);
    const posters = videoItems
      .map((i) => mediaUrl(i.video_preview_image_url || i.preview_image_url))
      .filter(Boolean);
    const ad = {
      id: `meta-${record.market}-${raw.ad_archive_id}`,
      archiveId: String(raw.ad_archive_id),
      pageId: String(raw.page_id || ''),
      brand: txt(raw.page_name || s.page_name),
      market: record.market,
      platform: 'Meta',
      headline: txt(s.title || cards[0]?.title),
      copy: txt(s.body),
      format: String(s.display_format || '未知'),
      status:
        raw.is_active === true
          ? '投放中'
          : raw.is_active === false
            ? '已停止'
            : '未知',
      color: '',
      productId: '',
      keywordIds: [record.id],
      query: record.term,
      landingUrls: [...new Set(links)],
      imageUrls: [...new Set(images)],
      videoUrls: [...new Set(videos)],
      videoPosterUrls: [...new Set(posters)],
      firstSeenAt: at,
      lastCollectedAt: at,
      evidenceUrl: `https://www.facebook.com/ads/library/?id=${raw.ad_archive_id}`,
      dataNature: 'collected',
      source: 'Meta 广告库 / ScrapeCreators',
      siteIds: [],
    };
    if (Number(raw.start_date) > 0)
      ad.startDate = new Date(Number(raw.start_date) * 1000).toISOString();
    ads.set(ad.id, ad);
  }
  return {
    ads: [...ads.values()],
    cursor: typeof payload.cursor === 'string' ? payload.cursor : '',
    creditsCharged:
      typeof payload.credits_charged === 'number'
        ? payload.credits_charged
        : null,
    creditsRemaining: payload.credits_remaining,
  };
}
export async function collectAds(request) {
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME])
  ).rows[0]?.value;
  if (!stored) throw new Error('请先配置 ScrapeCreators API Key');
  const path = request.pageId
    ? '/v1/facebook/adLibrary/company/ads'
    : '/v1/facebook/adLibrary/search/ads';
  const params = {
    country: request.record.market,
    status: request.adStatus || 'ACTIVE',
    ...(request.pageId
      ? { pageId: request.pageId }
      : { query: request.record.term }),
    ...(request.cursor ? { cursor: request.cursor } : {}),
  };
  return normalizeAds(
    await scrapeRequest(path, params, openAdsKey(stored)),
    request.record,
  );
}

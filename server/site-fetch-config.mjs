import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { pool, putDocument } from './database.mjs';
import { requireAdmin } from './auth.mjs';
const NAME = 'provider:site-fetch:v1';
const aad = Buffer.from(NAME);
const secret = () => process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
export function sealFetchKey(value, key = secret()) {
  const iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', Buffer.from(key || '', 'base64'), iv);
  c.setAAD(aad);
  const ciphertext = Buffer.concat([
    c.update(value, 'utf8'),
    c.final(),
  ]).toString('base64');
  return {
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    ciphertext,
  };
}
export function openFetchKey(value, key = secret()) {
  const c = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key || '', 'base64'),
    Buffer.from(value.iv, 'base64'),
  );
  c.setAAD(aad);
  c.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    c.update(Buffer.from(value.ciphertext, 'base64')),
    c.final(),
  ]).toString('utf8');
}
const read = async () => {
  const { rows } = await pool.query(
    'SELECT value FROM provider_configs WHERE name=$1',
    [NAME],
  );
  return rows[0]?.value || {};
};
export async function fetchConfiguration(includeKey = true) {
  const stored = await read();
  return {
    browserEnabled: stored.browserEnabled !== false,
    paidEnabled: stored.paidEnabled === true,
    apiKey:
      includeKey && stored.paidEnabled && stored.key
        ? openFetchKey(stored.key)
        : '',
  };
}
export async function siteFetchConfig(input, user, overrides = {}) {
  const io = {
    read,
    write: (v) => putDocument('provider_configs', NAME, v),
    secret: secret(),
    ...overrides,
  };
  if (input.action === 'server_site_fetch_config') requireAdmin(user);
  let stored = await io.read();
  if (input.action === 'server_site_fetch_config') {
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey && !/^fc-[A-Za-z0-9_-]{10,200}$/.test(apiKey))
      throw new Error('请填写 Firecrawl API Key 本身（fc- 开头）');
    const key = apiKey ? sealFetchKey(apiKey, io.secret) : stored.key;
    if (input.paidEnabled === true && !key)
      throw new Error('启用托管备用前请先填写 Firecrawl Key');
    stored = {
      browserEnabled: input.browserEnabled !== false,
      paidEnabled: input.paidEnabled === true,
      ...(key ? { key } : {}),
      updatedAt: new Date().toISOString(),
    };
    await io.write(stored);
  }
  return {
    browserEnabled: stored.browserEnabled !== false,
    paidEnabled: stored.paidEnabled === true,
    configured: !!stored.key,
    updatedAt: stored.updatedAt,
    message:
      '公开目录与直连优先；渲染只用于动态页面。托管备用还需管理员在每次任务中设置大于0的请求上限；保存不检测或调用收费服务。',
  };
}
export function collectionBudget(input, user) {
  const maxBrowserPages = Number(input.maxBrowserPages ?? 5),
    maxPaidRequests = Number(input.maxPaidRequests ?? 0);
  if (
    !Number.isInteger(maxBrowserPages) ||
    maxBrowserPages < 0 ||
    maxBrowserPages > 50 ||
    !Number.isInteger(maxPaidRequests) ||
    maxPaidRequests < 0 ||
    maxPaidRequests > 100
  )
    throw new Error('浏览器渲染上限0～50页，托管备用上限0～100次；0表示关闭');
  if (maxPaidRequests > 0) requireAdmin(user);
  return { collectionPolicyVersion: 1, maxBrowserPages, maxPaidRequests };
}

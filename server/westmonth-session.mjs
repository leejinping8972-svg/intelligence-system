import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { requireAdmin } from './auth.mjs';
import { pool, putDocument } from './database.mjs';
import { withQueueConfig } from './queue-config-lock.mjs';
const NAME = 'provider:westmonth-session:v1';
const secret = () => process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
export function sessionToken(value) {
  const token =
    typeof value === 'string' ? value.trim().replace(/^Bearer\s+/i, '') : '';
  if (!token || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token))
    throw new Error('请填写西之月登录后的 access_token；无需账号密码');
  return token;
}
export function sealSession(value, key = secret()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key || '', 'base64'),
    iv,
  );
  cipher.setAAD(Buffer.from(NAME));
  return {
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]).toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
export function openSession(value, key = secret()) {
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key || '', 'base64'),
    Buffer.from(value.iv, 'base64'),
  );
  cipher.setAAD(Buffer.from(NAME));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return sessionToken(
    Buffer.concat([
      cipher.update(Buffer.from(value.ciphertext, 'base64')),
      cipher.final(),
    ]).toString('utf8'),
  );
}
const read = async () =>
  (await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME]))
    .rows[0]?.value || {};
const write = (value) => putDocument('provider_configs', NAME, value);
export async function westmonthAuthorization(url) {
  const target = new URL(url);
  if (
    target.origin !== 'https://api-x.westmonth.com' ||
    target.username ||
    target.password ||
    ![
      '/product-center/shop/products/detail',
      '/product-center/shop/products/load-list',
    ].includes(target.pathname)
  )
    throw new Error('西之月会话不可用于此地址');
  const stored = await read();
  return stored.enabled && stored.token
    ? 'Bearer ' + openSession(stored.token)
    : '';
}
export async function westmonthSessionAction(input, user, overrides = {}) {
  requireAdmin(user);
  const io = {
    read,
    write,
    mutate: overrides.read
      ? (fn) => fn()
      : (fn) => withQueueConfig('monitor-config', fn),
    secret: secret(),
    probe: async (token) => {
      const { fetchPublicPage } = await import('./safe-web.mjs');
      const url =
        'https://api-x.westmonth.com/product-center/shop/products/load-list?page=1&pagesize=60&source=rankings&onlyShow=1&locale=zh_cn&ranking_type=new&delivery_region_id=9';
      const result = await fetchPublicPage(url, 0, ['application/json'], {
        allowedDomain: 'westmonth.com',
        manualRedirect: true,
        westmonthAuthorization: 'Bearer ' + token,
      });
      if (result.redirect) throw new Error('会话验证遇到跳转，请更新登录会话');
      const body = JSON.parse(result.html);
      if (body.code !== 0 || !Array.isArray(body.data?.data))
        throw new Error('西之月未接受该会话，请重新登录后更新');
      const { westmonthPrice } = await import('./westmonth-price.mjs');
      return body.data.data.some((row) => westmonthPrice(row).price > 0);
    },
    ...overrides,
  };
  let stored = await io.read();
  if (input.action === 'server_westmonth_session_save') {
    await io.mutate(async () => {
      stored = await io.read();
      if (input.clear === true)
        stored = { enabled: false, updatedAt: new Date().toISOString() };
      else {
        const token = input.accessToken
          ? sealSession(sessionToken(input.accessToken), io.secret)
          : stored.token;
        if (input.enabled !== false && !token)
          throw new Error('请先填写西之月登录会话');
        stored = {
          enabled: input.enabled !== false,
          ...(token ? { token } : {}),
          updatedAt: new Date().toISOString(),
        };
      }
      await io.write(stored);
    });
  } else if (input.action === 'server_westmonth_session_check') {
    if (!stored.token) throw new Error('请先保存登录会话');
    let status;
    try {
      status = (await io.probe(openSession(stored.token, io.secret)))
        ? 'price_available'
        : 'price_unavailable';
    } catch {
      status = 'check_failed';
    }
    const checked = stored;
    await io.mutate(async () => {
      stored = await io.read();
      if (JSON.stringify(stored) !== JSON.stringify(checked)) return;
      stored = { ...stored, checkedAt: new Date().toISOString(), status };
      await io.write(stored);
    });
  }
  return {
    configured: !!stored.token,
    enabled: stored.enabled === true,
    updatedAt: stored.updatedAt,
    checkedAt: stored.checkedAt,
    status: stored.status || 'unchecked',
  };
}

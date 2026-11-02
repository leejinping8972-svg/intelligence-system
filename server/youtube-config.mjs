import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireAdmin } from './auth.mjs';
import { pool, putDocument } from './database.mjs';

const NAME = 'provider:youtube:v1';
const aad = Buffer.from(NAME);
export function validateYoutubeKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(key))
    throw new Error('请填写 Google Cloud API Key 本身，不要填写网址或其他凭据');
  return key;
}
export function sealYoutubeKey(key, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(secret || '', 'base64'),
    iv,
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(key, 'utf8'),
    cipher.final(),
  ]).toString('base64');
  return {
    iv: iv.toString('base64'),
    ciphertext,
    tag: cipher.getAuthTag().toString('base64'),
  };
}
export function openYoutubeKey(value, secret) {
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(secret || '', 'base64'),
    Buffer.from(value.iv, 'base64'),
  );
  cipher.setAAD(aad);
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, 'base64')),
    cipher.final(),
  ]).toString('utf8');
}
const read = async () =>
  (await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME]))
    .rows[0]?.value;
export async function readYoutubeKey() {
  const stored = await read();
  return stored
    ? openYoutubeKey(stored, process.env.PROVIDER_CONFIG_ENCRYPTION_KEY)
    : process.env.YOUTUBE_API_KEY || '';
}
export async function checkYoutubeKey(key, fetcher = fetch) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videoCategories');
  url.search = new URLSearchParams({ part: 'snippet', regionCode: 'US', key });
  try {
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(body.items))
      return {
        ready: true,
        message: 'YouTube Data API 连接正常，公开视频读取权限已通过',
      };
    const reason = body.error?.errors?.[0]?.reason || '';
    let message = 'YouTube 检测未通过，请稍后重试';
    if (/quota|dailyLimit/i.test(reason) || response.status === 429)
      message =
        'YouTube 每日配额已用完或请求受限，请查看 Google Cloud 配额后重试';
    else if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason))
      message = '请在此 Key 所属的 Google Cloud 项目中启用 YouTube Data API v3';
    else if (/ip|referer|forbidden/i.test(reason))
      message =
        'Key 的应用或 API 限制不允许当前服务器访问，请检查 IP 限制和 YouTube API 权限';
    else if (response.status === 400 || response.status === 401)
      message = 'API Key 无效，请核对 Google Cloud 中的密钥';
    else if (response.status === 403)
      message = '访问被拒绝，请检查 YouTube API 是否启用、Key 限制及每日配额';
    return { ready: false, message };
  } catch {
    // Never return upstream errors: they may include the URL with its API key.
    return {
      ready: false,
      message: '连接 YouTube 超时或网络不可达，请稍后重试',
    };
  }
}
export async function youtubeAction(input, user, overrides = {}) {
  if (input.action === 'server_youtube_config' || input.verify === true)
    requireAdmin(user);
  const io = {
    read,
    write: (v) => putDocument('provider_configs', NAME, v),
    secret: process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
    envKey: process.env.YOUTUBE_API_KEY || '',
    check: checkYoutubeKey,
    ...overrides,
  };
  if (input.action === 'server_youtube_config') {
    const key = validateYoutubeKey(input.apiKey);
    await io.write({
      ...sealYoutubeKey(key, io.secret),
      updatedAt: new Date().toISOString(),
    });
    return {
      configured: true,
      ready: false,
      message: 'Key 已在服务器加密保存，请检测连接；保存不会启动采集',
    };
  }
  const stored = await io.read();
  if (!stored && !io.envKey)
    return {
      configured: false,
      ready: false,
      message: '尚未配置 YouTube API Key',
    };
  if (input.verify !== true)
    return {
      configured: true,
      ready: false,
      ...stored?.lastCheck,
      message: stored?.lastCheck?.message || '已配置，等待检测连接',
    };
  let key;
  try {
    key = stored ? openYoutubeKey(stored, io.secret) : io.envKey;
  } catch {
    throw new Error('YouTube 密钥无法解密，请重新保存 Key');
  }
  const result = {
    ...(await io.check(key)),
    configured: true,
    checkedAt: new Date().toISOString(),
  };
  if (stored) await io.write({ ...stored, lastCheck: result });
  return result;
}

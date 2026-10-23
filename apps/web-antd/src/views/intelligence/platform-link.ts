export interface PlatformLinkKey {
  created_at: number | string;
  display_hint: string;
  expires_at: null | number | string;
  revoked_at: null | number | string;
}

export interface PlatformLinkPeer {
  display_hint: string;
  display_name: string;
  subject: string;
  updated_at: number | string;
}

export interface PlatformLinkSettings {
  enabled: boolean;
  key: null | PlatformLinkKey;
  ok: true;
  peer: null | PlatformLinkPeer;
}

const apiBase = '/api/platform-link/v1';
const peerOrigin = 'https://ai.chatviva.com';
const messages: Record<string, string> = {
  ACCOUNT_DISABLED: '账号已停用，请联系管理员',
  AUTH_REQUIRED: '登录已失效，请重新登录',
  FLOW_SESSION_CHANGED: '当前登录账号已改变，请刷新后重新操作',
  INVALID_REQUEST: '请求未完成，请检查输入后重试',
  KEY_INVALID: '登录 key 无效或已撤销',
  LOGIN_DISABLED: '接入尚未启用',
  PEER_KEY_INVALID: 'AI 登录 key 无效或已撤销，请核对后重新填写',
  PEER_NOT_CONFIGURED: '请先配置 AI 账号登录 key',
  PEER_UNAVAILABLE: 'AI 平台暂不可用，请稍后重试',
};

export class PlatformLinkError extends Error {
  code: string;

  constructor(code: string) {
    super(messages[code] || '操作未完成，请稍后重试');
    this.name = 'PlatformLinkError';
    this.code = code;
  }
}

async function request<T>(
  path: string,
  method = 'GET',
  input?: Record<string, unknown>,
): Promise<T> {
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: input === undefined ? undefined : JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object') {
      throw new PlatformLinkError('INVALID_RESPONSE');
    }
    const payload = result as Record<string, unknown>;
    if (!response.ok || payload.ok !== true) {
      throw new PlatformLinkError(
        typeof payload.code === 'string' ? payload.code : 'REQUEST_FAILED',
      );
    }
    return result as T;
  } catch (cause) {
    if (cause instanceof PlatformLinkError) throw cause;
    throw new PlatformLinkError('REQUEST_FAILED');
  }
}

export function getPlatformLinkSettings() {
  return request<PlatformLinkSettings>('/settings');
}

export function generatePlatformLinkKey() {
  return request<{ key: string; ok: true }>('/account-key/generate', 'POST', {
    confirm: true,
  });
}

export function revokePlatformLinkKey() {
  return request<{ ok: true }>('/account-key/revoke', 'POST', {
    confirm: true,
  });
}

export function savePlatformLinkPeer(key: string) {
  return request<{ ok: true }>('/peer-key', 'POST', { key });
}

export function removePlatformLinkPeer() {
  return request<{ ok: true }>('/peer-key', 'DELETE', {});
}

export function platformLinkRedirect(value: string) {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new PlatformLinkError('INVALID_REDIRECT');
  }
  const query = target.searchParams;
  if (
    target.origin !== peerOrigin ||
    target.pathname !== '/api/platform-link/v1/login/start' ||
    target.username ||
    target.password ||
    target.hash ||
    query.getAll('source').length !== 1 ||
    query.get('source') !== 'selection-platform' ||
    query.getAll('state').length !== 1 ||
    !/^[\w-]{43}$/.test(query.get('state') || '') ||
    [...query.keys()].some((name) => name !== 'source' && name !== 'state')
  ) {
    throw new PlatformLinkError('INVALID_REDIRECT');
  }
  return target.href;
}

export async function launchPlatformLink() {
  const result = await request<{ ok: true; redirect: string }>(
    '/launch',
    'POST',
    {},
  );
  return platformLinkRedirect(result.redirect);
}

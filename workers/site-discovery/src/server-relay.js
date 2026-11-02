export const SERVER_ACTIONS = new Set([
  'server_cancel',
  'server_clear_keywords',
  'server_import_keywords',
  'server_patch_keywords',
  'server_snapshot',
  'server_status',
  'server_submit',
]);
export async function serverRelay(input, env, fetcher = fetch) {
  if (!env.SERVER_API_URL || !env.SERVER_BRIDGE_KEY)
    throw new Error('腾讯云业务服务尚未接通，请稍后再试');
  const url = new URL(env.SERVER_API_URL);
  if (url.protocol !== 'https:') throw new Error('云端业务服务必须使用HTTPS');
  const response = await fetcher(url.toString(), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'x-server-key': env.SERVER_BRIDGE_KEY,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error('业务服务返回重定向，已停止转发访问密钥');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || `腾讯云业务服务HTTP ${response.status}`);
  return payload;
}

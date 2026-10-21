import process from 'node:process';

function origin(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('SSO域名必须为不含路径和账号的HTTPS源地址');
  return url.origin;
}

export function adminSsoConfig(env = process.env) {
  if (env.ADMIN_SSO_ENABLED !== 'true') return null;
  const ownOrigin = origin(
    env.ADMIN_SSO_PUBLIC_ORIGIN || 'https://is.luckdate.com',
  );
  const peerOrigin = origin(
    env.ADMIN_SSO_PEER_ORIGIN || 'https://ai.chatviva.com',
  );
  const clientId = env.ADMIN_SSO_CLIENT_ID || 'intelligence-system';
  const peerId = env.ADMIN_SSO_PEER_ID || 'chatviva-admin';
  const secret = env.ADMIN_SSO_SHARED_SECRET || '';
  if (
    ownOrigin === peerOrigin ||
    clientId === peerId ||
    !/^[a-z0-9-]{3,64}$/.test(clientId) ||
    !/^[a-z0-9-]{3,64}$/.test(peerId) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(secret)
  )
    throw new Error('请配置独立的SSO系统标识、域名和至少32字节的随机共享密钥');
  let entries;
  try {
    const map = JSON.parse(env.ADMIN_SSO_ACCOUNT_MAP || 'null');
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new Error('SSO account map must be an object');
    entries = Object.entries(map);
  } catch {
    throw new Error(
      'ADMIN_SSO_ACCOUNT_MAP必须为对端不可变账号ID到本地账号ID的JSON对象',
    );
  }
  if (
    entries.length === 0 ||
    entries.length > 1000 ||
    entries.some(
      ([remote, local]) =>
        !/^[\w.-]{1,128}$/.test(remote) ||
        typeof local !== 'string' ||
        !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(local),
    ) ||
    new Set(entries.map(([, local]) => local)).size !== entries.length
  )
    throw new Error('SSO账号绑定需为一对一的不可变ID，不得使用用户名或空绑定');
  return {
    ownOrigin,
    peerOrigin,
    clientId,
    peerId,
    secret,
    accounts: new Map(entries),
  };
}

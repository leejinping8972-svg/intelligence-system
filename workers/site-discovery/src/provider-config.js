const STORAGE_KEY = 'provider:sorftime:mcp:v1';
const encode = (value) => btoa(String.fromCodePoint(...value));
const decode = (value) =>
  Uint8Array.from(atob(value), (letter) => letter.codePointAt(0));

async function encryptionKey(env) {
  if (!env.PROVIDER_CONFIG_ENCRYPTION_KEY || !env.PROVIDER_CONFIG)
    throw new Error('云端密钥存储尚未启用，请联系管理员完成部署');
  return crypto.subtle.importKey(
    'raw',
    decode(env.PROVIDER_CONFIG_ENCRYPTION_KEY),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function saveSorftimeToken(input, env) {
  const token =
    typeof input.sorftimeToken === 'string' ? input.sorftimeToken.trim() : '';
  if (token.length < 10 || token.length > 4096 || /\s|https?:\/\//i.test(token))
    throw new Error(
      '请填写 MCP ACCESS TOKEN 本身，不要粘贴完整网址；留空不会清除原密钥',
    );
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(STORAGE_KEY),
    },
    key,
    new TextEncoder().encode(token),
  );
  const updatedAt = new Date().toISOString();
  await env.PROVIDER_CONFIG.put(
    STORAGE_KEY,
    JSON.stringify({
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext)),
      updatedAt,
    }),
  );
  return {
    configured: true,
    updatedAt,
    message: 'Token 已加密保存到云端，页面不回显密钥；全球同步可能需要约一分钟',
  };
}

export async function readSorftimeToken(env) {
  if (env.PROVIDER_CONFIG && env.PROVIDER_CONFIG_ENCRYPTION_KEY) {
    const saved = await env.PROVIDER_CONFIG.get(STORAGE_KEY, 'json');
    if (saved) {
      try {
        const key = await encryptionKey(env);
        const value = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: decode(saved.iv),
            additionalData: new TextEncoder().encode(STORAGE_KEY),
          },
          key,
          decode(saved.ciphertext),
        );
        return new TextDecoder().decode(value);
      } catch {
        throw new Error('云端密钥解密失败，请重新保存 Sorftime Token');
      }
    }
  }
  return env.SORFTIME_MCP_TOKEN || '';
}

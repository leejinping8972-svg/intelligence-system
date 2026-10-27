import { Buffer } from 'node:buffer';
import process from 'node:process';

export const IDENTITY_BASE = '/api/identity';
export const AI_HOME = 'https://ai.chatviva.com/admin/';
export function identityConfig(env = process.env) {
  if (env.IDENTITY_ENABLED !== 'true') return null;
  const origin = env.IDENTITY_PUBLIC_ORIGIN || 'https://is.luckdate.com';
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin)
    throw new Error('IDENTITY_PUBLIC_ORIGIN must be a canonical HTTPS origin');
  const secret = env.IDENTITY_AI_CLIENT_SECRET || '';
  const cookieKeys = JSON.parse(env.IDENTITY_COOKIE_KEYS || '[]');
  const jwks = JSON.parse(env.IDENTITY_SIGNING_JWKS || '{}');
  const encryptionKey = env.PROVIDER_CONFIG_ENCRYPTION_KEY || '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret))
    throw new Error(
      'IDENTITY_AI_CLIENT_SECRET must contain at least 256 random bits',
    );
  if (
    !Array.isArray(cookieKeys) ||
    cookieKeys.length === 0 ||
    cookieKeys.some(
      (key) => typeof key !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(key),
    )
  )
    throw new Error(
      'IDENTITY_COOKIE_KEYS must be an array of persistent random keys',
    );
  if (
    !Array.isArray(jwks.keys) ||
    jwks.keys.length === 0 ||
    jwks.keys.some(
      (key) =>
        key.kty !== 'RSA' ||
        !key.d ||
        !key.kid ||
        key.alg !== 'RS256' ||
        Buffer.from(key.n || '', 'base64url').length < 256,
    )
  )
    throw new Error(
      'IDENTITY_SIGNING_JWKS must contain persistent private RSA signing keys',
    );
  if (
    Buffer.from(encryptionKey, 'base64').length !== 32 ||
    Buffer.from(encryptionKey, 'base64').toString('base64') !== encryptionKey
  )
    throw new Error(
      'PROVIDER_CONFIG_ENCRYPTION_KEY must be canonical base64 for 32 bytes',
    );
  const adminIds = JSON.parse(env.IDENTITY_AI_ADMIN_USER_IDS || '[]');
  if (
    !Array.isArray(adminIds) ||
    adminIds.some(
      (id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id),
    )
  )
    throw new Error(
      'IDENTITY_AI_ADMIN_USER_IDS must be an array of existing account IDs',
    );
  return {
    origin,
    issuer: `${origin}${IDENTITY_BASE}`,
    secret,
    cookieKeys,
    jwks,
    encryptionKey,
    adminIds,
    clientId: 'chatviva-admin',
    redirectUri: 'https://ai.chatviva.com/api/auth/oidc/callback',
  };
}

export function identityProfile(user, config) {
  if (!user?.enabled || !['admin', 'researcher'].includes(user.role))
    return null;
  return {
    sub: user.id,
    name: user.display_name,
    preferred_username: user.username,
    selection_role: user.role,
    ai_role:
      user.role === 'admin' && config.adminIds.includes(user.id)
        ? 'admin'
        : 'researcher',
  };
}

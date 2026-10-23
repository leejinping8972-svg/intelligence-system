import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import process from 'node:process';

export const PLATFORM_LINK_BASE = '/api/platform-link/v1';

function origin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Platform link requires a valid HTTPS origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Platform link requires an HTTPS origin without a path or credentials',
    );
  return url.origin;
}

function encryptionKey(value) {
  if (typeof value !== 'string' || value.length !== 44)
    throw new Error(
      'PLATFORM_LINK_ENCRYPTION_KEY must be canonical base64 for 32 bytes',
    );
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value)
    throw new Error(
      'PLATFORM_LINK_ENCRYPTION_KEY must be canonical base64 for 32 bytes',
    );
  return decoded;
}

export function platformLinkConfig(env = process.env) {
  const enabled = env.PLATFORM_LINK_ENABLED === 'true';
  const ownOrigin = origin(
    env.PLATFORM_LINK_PUBLIC_ORIGIN || 'https://is.luckdate.com',
  );
  const peerOrigin = origin(
    env.PLATFORM_LINK_PEER_ORIGIN || 'https://ai.chatviva.com',
  );
  const source = env.PLATFORM_LINK_SOURCE || 'selection-platform';
  const peerSource = env.PLATFORM_LINK_PEER_SOURCE || 'ai-platform';
  if (
    ownOrigin === peerOrigin ||
    source === peerSource ||
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(source) ||
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(peerSource)
  )
    throw new Error(
      'Platform link requires distinct origins and fixed platform identifiers',
    );
  const key = env.PLATFORM_LINK_ENCRYPTION_KEY || '';
  if (enabled || key) encryptionKey(key);
  return {
    enabled,
    ownOrigin,
    peerOrigin,
    source,
    peerSource,
    home: '/admin/overview',
    trustProxy: env.PLATFORM_LINK_TRUST_PROXY === 'true',
    encryptionKey: key,
  };
}

export const hashPlatformToken = (value) =>
  createHash('sha256').update(value).digest('hex');

export const newPlatformToken = () => randomBytes(32).toString('base64url');

export function validatePeerKey(value) {
  return typeof value === 'string' && /^[!-~]{16,512}$/.test(value);
}

function requirePeerKey(value) {
  if (!validatePeerKey(value))
    throw new Error(
      'Platform key must contain 16 to 512 printable ASCII characters without whitespace',
    );
  return value;
}

function contextBytes(context) {
  if (typeof context !== 'string' || !context || context.length > 512)
    throw new Error('Platform key encryption requires an account context');
  return Buffer.from(context, 'utf8');
}

export function sealPeerKey(value, base64key, context) {
  requirePeerKey(value);
  const key = encryptionKey(base64key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(contextBytes(context));
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

function decodeField(value, expectedLength) {
  if (typeof value !== 'string')
    throw new Error('Invalid platform key envelope');
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.toString('base64') !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  )
    throw new Error('Invalid platform key envelope');
  return decoded;
}

export function openPeerKey(serialized, base64key, context) {
  const key = encryptionKey(base64key);
  const aad = contextBytes(context);
  try {
    if (typeof serialized !== 'string' || serialized.length > 2048)
      throw new Error('Invalid platform key envelope');
    const envelope = JSON.parse(serialized);
    if (
      !envelope ||
      envelope.version !== 1 ||
      Object.keys(envelope).length !== 4
    )
      throw new Error('Invalid platform key envelope');
    const nonce = decodeField(envelope.nonce, 12);
    const tag = decodeField(envelope.tag, 16);
    const ciphertext = decodeField(envelope.ciphertext);
    if (ciphertext.length < 16 || ciphertext.length > 512)
      throw new Error('Invalid platform key envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return requirePeerKey(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      ),
    );
  } catch {
    throw new Error('Stored platform key cannot be decrypted');
  }
}

import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import process from 'node:process';

import { requireAdmin } from './auth.mjs';
import { pool, putDocument } from './database.mjs';
import { semrushBalance } from './semrush-balance.mjs';
import { semrushUsage } from './semrush-usage.mjs';
import {
  SEMRUSH_MCP_URL,
  semrushConnectionStatus,
  validateSemrushKey,
} from './semrush-mcp.mjs';

const CONFIG_NAME = 'provider:semrush:mcp:v1';
const aad = Buffer.from(CONFIG_NAME);
export function encryptSemrushKey(apiKey, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(secret || '', 'base64'),
    iv,
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, 'utf8'),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
export function decryptSemrushKey(value, secret) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(secret || '', 'base64'),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
export async function semrushAction(input, user, overrides = {}) {
  if (
    input.action === 'server_semrush_config' ||
    input.action === 'server_semrush_balance' ||
    input.action === 'server_semrush_usage' ||
    input.verify === true
  )
    requireAdmin(user);
  const io = {
    async read() {
      const { rows } = await pool.query(
        'SELECT value FROM provider_configs WHERE name=$1',
        [CONFIG_NAME],
      );
      return rows[0]?.value;
    },
    write: (value) => putDocument('provider_configs', CONFIG_NAME, value),
    secret: process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
    status: semrushConnectionStatus,
    balance: semrushBalance,
    usage: semrushUsage,
    ...overrides,
  };
  if (input.action === 'server_semrush_usage') return io.usage();
  const stored = await io.read();
  if (input.action === 'server_semrush_balance') {
    if (!stored) return { configured: false, balance: null };
    let apiKey;
    try {
      apiKey = decryptSemrushKey(stored, io.secret);
    } catch {
      throw new Error('Semrush 密钥解密失败，请重新保存 API Key');
    }
    const balance = await io.balance(apiKey);
    const latest = await io.read();
    if (
      !latest ||
      latest.ciphertext !== stored.ciphertext ||
      latest.iv !== stored.iv
    )
      throw new Error('Key 已更换，请刷新后重新读取余额');
    await io.write({ ...latest, lastBalance: balance });
    return { configured: true, balance };
  }
  if (input.action === 'server_semrush_config') {
    requireAdmin(user);
    const apiKey = validateSemrushKey(input.apiKey);
    const saved = {
      ...encryptSemrushKey(apiKey, io.secret),
      updatedAt: new Date().toISOString(),
    };
    await io.write(saved);
    return {
      configured: true,
      ready: false,
      endpoint: SEMRUSH_MCP_URL,
      updatedAt: saved.updatedAt,
      message: 'Semrush API Key 已在服务器加密保存，不回显密钥；请点击检测连接',
    };
  }
  if (input.verify === true) requireAdmin(user);
  if (!stored) return io.status('', false);
  if (input.verify !== true)
    return {
      configured: true,
      ready: false,
      endpoint: SEMRUSH_MCP_URL,
      updatedAt: stored.updatedAt,
      balance: stored.lastBalance || null,
      ...stored.lastCheck,
      message: stored.lastCheck?.message || 'API Key 已保存，等待检测连接',
    };
  let apiKey;
  try {
    apiKey = decryptSemrushKey(stored, io.secret);
  } catch {
    throw new Error('Semrush 密钥解密失败，请重新保存 API Key');
  }
  const result = await io.status(apiKey, true);
  await io.write({ ...stored, lastCheck: result });
  return result;
}

import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import process from 'node:process';

import collector from './collector.js';
import { putDocument } from './database.mjs';
import { pool } from './store.mjs';

const key = () =>
  Buffer.from(process.env.PROVIDER_CONFIG_ENCRYPTION_KEY || '', 'base64');
export async function readCredentials(connection = pool, forUpdate = false) {
  const { rows } = await connection.query(
    `SELECT value FROM provider_configs WHERE name='credentials'${forUpdate ? ' FOR UPDATE' : ''}`,
  );
  if (!rows[0]) return {};
  const { iv, tag, ciphertext } = rows[0].value;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAAD(Buffer.from('intelligence-server-credentials-v1'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  );
}
export async function migrateCredentials(value) {
  const allowed = {};
  for (const name of [
    'RESEARCH_ACCESS_KEY',
    'BRAVE_SEARCH_API_KEY',
    'SORFTIME_MCP_TOKEN',
  ])
    if (typeof value[name] === 'string' && value[name].length <= 4096)
      allowed[name] = value[name];
  if (!allowed.RESEARCH_ACCESS_KEY) throw new Error('迁移配置缺少研究访问码');
  const record = sealCredentials(allowed);
  await putDocument('provider_configs', 'credentials', record, true);
  return {
    configured: true,
    message: '服务凭证已在服务器加密保存，不回显密钥',
  };
}
function sealCredentials(allowed) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from('intelligence-server-credentials-v1'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(allowed), 'utf8'),
    cipher.final(),
  ]);
  const record = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return record;
}
export async function saveBraveCredential(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim().length < 10 || apiKey.length > 4096 || /\s/.test(apiKey.trim())) throw new Error('请填写有效的 Brave Search Key');
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const existing = await readCredentials(connection, true);
    await putDocument('provider_configs', 'credentials', sealCredentials({ ...existing, BRAVE_SEARCH_API_KEY: apiKey.trim() }), false, connection);
    await connection.query('COMMIT');
    return { configured: true };
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
  finally { connection.release(); }
}
export async function collectorEnv() {
  return {
    ...(await readCredentials()),
    ALLOWED_ORIGINS:
      'https://is.luckdate.com,https://43.172.66.45,http://43.172.66.45,http://127.0.0.1:5666,http://localhost:5666',
    PROVIDER_CONFIG_ENCRYPTION_KEY: process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
    PROVIDER_CONFIG: {
      async get(name) {
        const { rows } = await pool.query(
          'SELECT value FROM provider_configs WHERE name=$1',
          [name],
        );
        return rows[0]?.value || null;
      },
      async put(name, value) {
        await putDocument('provider_configs', name, JSON.parse(value));
      },
    },
  };
}
export async function localCollect(input) {
  const env = await collectorEnv();
  return collector.fetch(
    new Request('https://43.172.66.45/api', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://43.172.66.45',
        'x-research-key': env.RESEARCH_ACCESS_KEY || '',
      },
      body: JSON.stringify(input),
    }),
    env,
  );
}

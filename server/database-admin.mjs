import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

import { verifyMysqlConnection } from './database-connection.mjs';
import {
  configPath,
  currentDatabase,
  engine,
  lock,
  mysqlPool,
  pool,
  unlock,
} from './database.mjs';
import { encryptConfig } from './secrets.mjs';
import { authSchema, mysqlSchema } from './store.mjs';
import { platformLinkPersistentTables } from './platform-link-store.mjs';

export let maintenance = false;
const tables = [
  'research_jobs',
  'research_keywords',
  'research_requests',
  'research_imports',
  'provider_configs',
  'workspace_documents',
  'admin_users',
  'admin_sessions',
  'admin_login_attempts',
  'admin_audit',
  ...platformLinkPersistentTables,
];
function connectionConfig(input) {
  if (input.tlsMode !== undefined && !['plain', 'ssl'].includes(input.tlsMode)) throw new Error('请选择SSL加密连接或普通连接');
  if (
    input.host !== 'rm-bp17h3w0e2dte4l4r8o.mysql.rds.aliyuncs.com' ||
    input.database !== 'leo'
  )
    throw new Error('仅允许连接已指定的 leo 数据库');
  if (
    typeof input.user !== 'string' ||
    !input.user.trim() ||
    input.user.length > 100 ||
    typeof input.password !== 'string' ||
    !input.password ||
    input.password.length > 4096
  )
    throw new Error('请填写数据库账号和密码');
  if (
    input.ca &&
    (typeof input.ca !== 'string' ||
      input.ca.length > 32_000 ||
      !input.ca.includes('-----BEGIN CERTIFICATE-----'))
  )
    throw new Error('CA 证书格式不正确');
  return {
    host: input.host,
    database: input.database,
    user: input.user.trim(),
    password: input.password,
    tlsMode: input.tlsMode || 'ssl',
    ...(input.ca ? { ca: input.ca } : {}),
  };
}
function connectionError(error) {
  const reasons = {
    ETIMEDOUT: '数据库连接超时，请检查外网地址、白名单和端口3306',
    ECONNREFUSED: '数据库拒绝连接，请确认已开通外网访问',
    ENOTFOUND: '数据库域名无法解析，请核对外网地址',
    ER_ACCESS_DENIED_ERROR: '数据库账号、密码或来源白名单不正确',
    ER_BAD_DB_ERROR: '数据库 leo 不存在，或当前账号没有访问权限',
    HANDSHAKE_NO_SSL_SUPPORT: '当前数据库未启用SSL；可在连接方式中选择普通连接，或在数据库开启SSL后重试',
  };
  if (reasons[error.code]) return reasons[error.code];
  if (/CERT|TLS|SSL|VERIFY|SELF_SIGNED/.test(error.code || ''))
    return 'SSL 证书校验未通过。请开启 RDS SSL，下载并上传该实例的 CA 证书，确认证书对应此外网地址';
  return `数据库操作失败（${error.code || '连接或权限异常'}），当前数据库保持不变`;
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function normalize(row) {
  const result = { ...row };
  if ('cancelled' in result) result.cancelled = Number(result.cancelled);
  for (const key of [
    'created_at',
    'updated_at',
    'imported_at',
    'last_login_at',
    'password_changed_at',
    'expires_at',
    'revoked_at',
    'last_seen_at',
    'locked_until',
  ])
    if (result[key] !== null && /^\d+$/.test(String(result[key])))
      result[key] = Number(result[key]);
  return canonical(result);
}
const digest = (rows) =>
  createHash('sha256')
    .update(
      rows
        .map((row) => JSON.stringify(normalize(row)))
        .sort()
        .join('\n'),
    )
    .digest('hex');
export async function databaseAction(input) {
  if (input.action === 'database_status')
    return {
      ...currentDatabase(),
      maintenance,
      targetHost: 'rm-bp17h3w0e2dte4l4r8o.mysql.rds.aliyuncs.com',
      targetDatabase: 'leo',
    };
  if (maintenance) throw new Error('正在迁移数据库，请等待服务恢复');
  if (!['database_migrate', 'database_test'].includes(input.action))
    throw new Error('不支持的数据库操作');
  const value = connectionConfig(input);
  if (input.action === 'database_migrate') maintenance = true;
  const target = mysqlPool(value);
  let connection;
  let source;
  let locked = false;
  try {
    connection = await target.getConnection();
    const verified = await verifyMysqlConnection(connection, value.tlsMode);
    if (input.action === 'database_test')
      return {
        ...verified,
        connected: true,
        message: verified.encrypted ? '已通过SSL连接验证；尚未切换数据库' : '普通连接验证成功（未加密传输）；尚未切换数据库',
      };
    if (engine !== 'postgres')
      throw new Error('当前已使用独立数据库，无需重复迁移');
    if (input.confirm !== 'migrate-to-leo')
      throw new Error('请确认将现有数据迁移到 leo');
    source = await pool.connect();
    locked = await lock(source);
    if (!locked)
      throw new Error('后台采集任务尚未结束，请完成或取消任务后再迁移');
    const active = await source.query(
      "SELECT id FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false LIMIT 1",
    );
    if (active.rows.length)
      throw new Error('存在待执行任务，请完成或取消任务后再迁移');
    for (const statement of [...mysqlSchema, ...authSchema])
      await connection.query(statement);
    for (const table of tables) {
      const [count] = await connection.query(
        `SELECT count(*) AS total FROM ${table}`,
      );
      if (Number(count[0].total))
        throw new Error('目标数据库已存在本系统数据，为避免覆盖已停止迁移');
    }
    const snapshot = {};
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    for (const table of tables)
      snapshot[table] = (await source.query(`SELECT * FROM ${table}`)).rows;
    await source.query('COMMIT');
    // Retain an encrypted full snapshot alongside the original PostgreSQL backup.
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(
      `${dirname(configPath)}/before-mysql-${Date.now()}.enc.json`,
      JSON.stringify(encryptConfig(snapshot)),
      { mode: 0o600 },
    );
    await connection.beginTransaction();
    const counts = {};
    for (const table of tables) {
      const rows = snapshot[table];
      if (rows.length) {
        const columns = Object.keys(rows[0]);
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const values = batch.flatMap((row) =>
            columns.map((key) => {
              const v = row[key];
              return v !== null && typeof v === 'object' && !(v instanceof Date)
                ? JSON.stringify(v)
                : typeof v === 'boolean'
                  ? Number(v)
                  : v;
            }),
          );
          await connection.query(
            `INSERT INTO ${table} (${columns.map((key) => `\`${key}\``).join(',')}) VALUES ${batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`,
            values,
          );
        }
      }
      const [copied] = await connection.query(`SELECT * FROM ${table}`);
      if (copied.length !== rows.length || digest(copied) !== digest(rows))
        throw new Error(`迁移校验未通过：${table}，未切换数据库`);
      counts[table] = rows.length;
    }
    // Prepare configuration before committing; only rename activates it on restart.
    await writeFile(
      `${configPath}.next`,
      JSON.stringify(encryptConfig(value)),
      { mode: 0o600 },
    );
    await connection.commit();
    await rename(`${configPath}.next`, configPath);
    setTimeout(() => process.exit(0), 1500).unref();
    return {
      migrated: true,
      counts,
      message:
        '数据已完整复制并校验，服务正在切换到 MySQL，请稍后刷新；原数据库保留供回退',
    };
  } catch (error) {
    await connection?.rollback().catch(() => {});
    if (maintenance) maintenance = false;
    if (error.code) throw new Error(connectionError(error));
    throw error;
  } finally {
    if (locked) await unlock(source).catch(() => {});
    source?.release();
    connection?.release();
    await target.end();
  }
}

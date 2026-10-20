import { readFile } from 'node:fs/promises';
import process from 'node:process';

import mysql from 'mysql2/promise';
import pg from 'pg';

import { mysqlConnectionOptions } from './database-connection.mjs';
import { decryptConfig } from './secrets.mjs';

export const configPath =
  process.env.DATABASE_CONFIG_FILE || '/data/database.enc.json';
let config;
try {
  config = decryptConfig(JSON.parse(await readFile(configPath, 'utf8')));
} catch (error) {
  if (error.code !== 'ENOENT')
    throw new Error('数据库配置无法解密，请检查服务器加密密钥');
}
export const engine = config ? 'mysql' : 'postgres';
export const sql = (postgres, my) => (engine === 'mysql' ? my : postgres);
export function mysqlPool(value) {
  return mysql.createPool(mysqlConnectionOptions(value));
}
function wrap(connection, isPool = false) {
  return {
    async query(statement, params = []) {
      const values = [];
      const text = statement
        .replace(/\$(\d+)/g, (_, index) => {
          const value = params[Number(index) - 1];
          values.push(
            value !== null &&
              typeof value === 'object' &&
              !(value instanceof Date)
              ? JSON.stringify(value)
              : value,
          );
          return '?';
        })
        .replaceAll('::integer', '');
      const [result] = await connection.query(text, values);
      const rows = Array.isArray(result) ? result : [];
      return {
        rows,
        rowCount: Array.isArray(result) ? result.length : result.affectedRows,
      };
    },
    async connect() {
      return wrap(await connection.getConnection());
    },
    release: () => connection.release(),
    on: (...args) => connection.on(...args),
    removeListener: (...args) => connection.removeListener(...args),
    end: () => (isPool ? connection.end() : undefined),
  };
}
export const rawMysql = config ? mysqlPool(config) : null;
export const pool = rawMysql
  ? wrap(rawMysql, true)
  : new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const advisoryLocks = new Map([
  ['keyword-submit', 89_761_032],
  ['enrichment-submit', 89_761_018],
  ['runner', 89_761_016],
  ['trend-runner', 89_761_019],
]);
function lockKey(name) {
  if (engine === 'mysql') return `intelligence:${name}`;
  return advisoryLocks.get(name) ?? 89_761_017;
}
export async function lock(connection, name = 'runner') {
  const { rows } = await connection.query(
    sql(
      'SELECT pg_try_advisory_lock($1) AS locked',
      'SELECT GET_LOCK($1,0) AS locked',
    ),
    [lockKey(name)],
  );
  return Boolean(rows[0].locked);
}
export async function unlock(connection, name = 'runner') {
  await connection.query(
    sql('SELECT pg_advisory_unlock($1)', 'SELECT RELEASE_LOCK($1)'),
    [lockKey(name)],
  );
}
export async function putDocument(
  table,
  name,
  value,
  importOnly = false,
  connection = pool,
) {
  if (!['provider_configs', 'workspace_documents'].includes(table))
    throw new Error('Invalid document table');
  await connection.query(
    sql(
      `INSERT INTO ${table}(name,value) VALUES($1,$2) ON CONFLICT(name) ${importOnly ? 'DO NOTHING' : `DO UPDATE SET value=EXCLUDED.value${table === 'workspace_documents' ? ',revision=workspace_documents.revision+1' : ''}`}`,
      `INSERT ${importOnly ? 'IGNORE' : ''} INTO ${table}(name,value) VALUES($1,$2) ${importOnly ? '' : `ON DUPLICATE KEY UPDATE value=VALUES(value)${table === 'workspace_documents' ? ',revision=revision+1' : ''}`}`,
    ),
    [name, value],
  );
}
export const currentDatabase = () => ({
  engine,
  host: config?.host || '本机 PostgreSQL',
  database: config?.database || 'intelligence',
  connectionMode: config ? config.tlsMode || 'ssl' : 'internal',
});

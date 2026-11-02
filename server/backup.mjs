import { Buffer } from 'node:buffer';
import process from 'node:process';

import { engine, pool } from './database.mjs';
import { encryptConfig } from './secrets.mjs';

const connection = await pool.connect();
try {
  await connection.query(
    engine === 'mysql'
      ? 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'
      : 'BEGIN ISOLATION LEVEL REPEATABLE READ',
  );
  if (engine === 'mysql')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const tables = {};
  for (const table of [
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
  ])
    tables[table] = (await connection.query(`SELECT * FROM ${table}`)).rows;
  await connection.query('COMMIT');
  process.stdout.write(
    Buffer.from(
      JSON.stringify(
        encryptConfig({ engine, createdAt: new Date().toISOString(), tables }),
      ),
    ),
  );
} finally {
  connection.release();
  await pool.end();
}

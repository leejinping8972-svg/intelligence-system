import assert from 'node:assert/strict';
import test from 'node:test';

import { mysqlConnectionOptions, verifyMysqlConnection } from './database-connection.mjs';

const connection = (cipher = '') => ({ async query(sql) { return sql.startsWith('SELECT') ? [[{ version: '8.0.46', name: 'leo' }]] : [[{ Variable_name: 'Ssl_cipher', Value: cipher }]]; } });
test('existing configurations retain verified TLS; plain connection requires explicit selection', () => {
  assert.equal(mysqlConnectionOptions({}).ssl.rejectUnauthorized, true);
  assert.equal(mysqlConnectionOptions({}).ssl.verifyIdentity, true);
  assert.equal(mysqlConnectionOptions({ tlsMode: 'ssl', ca: 'QA CA' }).ssl.ca, 'QA CA');
  assert.equal(mysqlConnectionOptions({ tlsMode: 'plain', ca: 'QA CA' }).ssl, undefined);
});
test('plain MySQL sessions can be verified and report their actual encryption status', async () => {
  assert.deepEqual(await verifyMysqlConnection(connection(), 'plain'), { version: '8.0.46', database: 'leo', encrypted: false });
  assert.equal((await verifyMysqlConnection(connection('TLS_AES_256_GCM_SHA384'))).encrypted, true);
});
test('SSL selection never falls back to an unencrypted session', async () => {
  await assert.rejects(verifyMysqlConnection(connection()), /没有使用SSL/);
});

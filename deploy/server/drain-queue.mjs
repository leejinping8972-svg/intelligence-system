// Run in a separate compose one-off container, mounted /release and /app.
// Hold both runner session locks across the API restart; never kill collectors.
import { access, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { lock, pool, unlock } from '/app/database.mjs';
const prefix = process.argv[2];
if (!/^\/release\/[a-z0-9-]+$/.test(prefix || ''))
  throw new Error('Invalid gate prefix');
const deadline = Date.now() + 15 * 60 * 1000;
const held = [];
const connection = await pool.connect();
connection.on('error', () => process.exit(1));
try {
  for (const name of [
    'runner',
    'trend-runner',
    'competitor-runner',
    'hotwords-runner',
    'keyword-trends-runner',
    'monitor-config',
    'keyword-trends-config',
    'public-content-runner',
  ]) {
    while (!(await lock(connection, name))) {
      if (Date.now() > deadline) throw new Error('Queue drain timed out');
      await sleep(1000);
    }
    held.push(name);
  }
  await writeFile(`${prefix}.ready`, new Date().toISOString(), { mode: 0o600 });
  console.log('In-flight jobs drained; both queue lanes locked');
  while (true) {
    try {
      await access(`${prefix}.release`);
      break;
    } catch {}
    if (Date.now() > deadline) throw new Error('Deployment gate expired');
    await sleep(1000);
  }
} finally {
  for (const name of held.reverse())
    await unlock(connection, name).catch(() => {});
  connection.release();
  await pool.end();
}

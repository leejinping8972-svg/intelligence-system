import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import pg from 'pg';

// Isolated database and process; never creates or changes production accounts.
const original = process.env.DATABASE_URL;
if (!original) throw new Error('Run in server QA container');
const name = `auth_qa_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: original });
await admin.query(`CREATE DATABASE ${name}`);
const url = new URL(original);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_CONFIG_FILE = `/tmp/${name}.json`;
const { migrate, pool } = await import('./store.mjs');
const { putDocument } = await import('./database.mjs');
const { migrateCredentials } = await import('./local-provider.mjs');
await migrate();
await migrateCredentials({ RESEARCH_ACCESS_KEY: 'QA-bootstrap-only' });
const child = spawn(process.execPath, ['index.mjs'], {
  env: { ...process.env, PORT: '18081' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const origin = 'https://is.luckdate.com';
const call = async (action, input = {}, cookie = '', extra = {}) => {
  const response = await fetch('http://127.0.0.1:18081/api', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
      ...extra,
    },
    body: JSON.stringify({ ...input, action }),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie') || '',
  };
};
try {
  for (let i = 0; i < 50; i++) {
    try {
      await call('auth_status');
      break;
    } catch {
      await sleep(200);
    }
  }
  assert.equal((await call('auth_status')).data.setupRequired, true);
  assert.equal(
    (await fetch('http://127.0.0.1:18081/api/media?ad=meta-US-123')).status,
    401,
  );
  assert.equal(
    (
      await call('server_snapshot', {}, '', {
        'x-research-key': 'QA-bootstrap-only',
      })
    ).status,
    401,
  );
  assert.equal(
    (await call('auth_status', {}, '', { origin: 'https://untrusted.test' }))
      .status,
    403,
  );
  assert.equal(
    (
      await call('auth_setup', {
        username: 'owner',
        displayName: 'QA owner',
        setupCode: 'wrong',
        password: 'QA-owner-password-123',
      })
    ).status,
    400,
  );
  const setup = await call('auth_setup', {
    username: 'owner',
    displayName: 'QA owner',
    setupCode: 'QA-bootstrap-only',
    password: 'QA-owner-password-123',
  });
  assert.equal(setup.status, 200);
  assert.match(setup.cookie, /HttpOnly/);
  assert.match(setup.cookie, /Secure/);
  assert.match(setup.cookie, /SameSite=Strict/);
  const owner = setup.cookie.split(';')[0];
  assert.equal(
    (
      await fetch('http://127.0.0.1:18081/api/media?ad=meta-US-123', {
        headers: { cookie: owner },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch('http://127.0.0.1:18081/api/media?ad=invalid', {
        headers: { cookie: owner },
      })
    ).status,
    400,
  );
  assert.equal((await call('auth_status')).data.setupRequired, false);
  assert.equal((await call('server_snapshot', {}, owner)).status, 200);
  await putDocument(
    'workspace_documents',
    'business:insightReports:qa-report',
    { id: 'qa-report' },
  );
  await putDocument(
    'workspace_documents',
    'business:researchEvidence:qa-evidence',
    { id: 'qa-evidence' },
  );
  const workspace = await call('server_workspace_snapshot', {}, owner);
  assert.equal(workspace.status, 200);
  assert.ok(
    !workspace.data.entries.some((entry) =>
      /^(insightReports|researchEvidence):/.test(entry.key),
    ),
    'server reports and evidence never enter the editable workspace snapshot',
  );
  assert.equal(
    (
      await call('auth_setup', {
        username: 'intruder',
        setupCode: 'QA-bootstrap-only',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        'auth_create_user',
        {
          username: 'analyst',
          displayName: 'QA analyst',
          role: 'researcher',
          password: 'QA-analyst-password-123',
        },
        owner,
      )
    ).status,
    200,
  );
  const list = await call('auth_users', {}, owner);
  assert.ok(!JSON.stringify(list.data).includes('password_hash'));
  const researcherId = list.data.users.find(
    (user) => user.username === 'analyst',
  ).id;
  const researcherLogin = await call('auth_login', {
    username: 'analyst',
    password: 'QA-analyst-password-123',
  });
  const researcher = researcherLogin.cookie.split(';')[0];
  assert.equal(researcherLogin.status, 200);
  for (const action of [
    'auth_users',
    'server_clear_keywords',
    'database_status',
    'keyword_sources_config',
  ])
    assert.equal((await call(action, {}, researcher)).status, 403);
  assert.equal(
    (
      await call(
        'server_workspace_sync',
        { entries: [{ key: 'branding:main', value: {} }] },
        researcher,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        'server_workspace_sync',
        { entries: [{ key: 'sites:qa-only', value: { id: 'qa-only' } }] },
        researcher,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        'auth_update_user',
        { id: setup.data.user.id, role: 'researcher', enabled: true },
        owner,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        'auth_update_user',
        { id: researcherId, role: 'researcher', enabled: false },
        owner,
      )
    ).status,
    200,
  );
  assert.equal((await call('server_snapshot', {}, researcher)).status, 401);
  assert.equal(
    (
      await call(
        'auth_update_user',
        { id: researcherId, role: 'researcher', enabled: true },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        'auth_reset_password',
        { id: researcherId, password: 'Qa123456' },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call('auth_login', {
        username: 'analyst',
        password: 'QA-analyst-password-123',
      })
    ).status,
    400,
  );
  assert.equal(
    (await call('auth_login', { username: 'analyst', password: 'Qa123456' }))
      .status,
    200,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call('auth_login', { username: 'blocked', password: 'wrong' }))
        .status,
      400,
    );
  assert.equal(
    (await call('auth_login', { username: 'blocked', password: 'wrong' }))
      .status,
    429,
  );
  await pool.query(
    'UPDATE admin_sessions SET last_seen_at=$1 WHERE user_id=$2',
    [Date.now() - 31 * 60_000, setup.data.user.id],
  );
  assert.equal((await call('server_snapshot', {}, owner)).status, 401);
  const newLogin = await call('auth_login', {
    username: 'owner',
    password: 'QA-owner-password-123',
  });
  const token = newLogin.cookie.split(';')[0];
  assert.equal(
    (
      await call(
        'auth_change_password',
        { currentPassword: 'wrong', password: 'Qa654321' },
        token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        'auth_change_password',
        { currentPassword: 'QA-owner-password-123', password: 'Qa654321' },
        token,
      )
    ).status,
    200,
  );
  assert.equal((await call('server_snapshot', {}, token)).status, 401);
  const finalLogin = await call('auth_login', {
    username: 'owner',
    password: 'Qa654321',
  });
  const finalToken = finalLogin.cookie.split(';')[0];
  assert.equal(
    (
      await call(
        'auth_change_password',
        { username: 'owner_new', currentPassword: 'Qa654321', password: '' },
        finalToken,
      )
    ).status,
    200,
  );
  assert.equal((await call('server_snapshot', {}, finalToken)).status, 401);
  const renamed = await call('auth_login', {
    username: 'owner_new',
    password: 'Qa654321',
  });
  assert.equal(renamed.status, 200);
  assert.equal(
    (await call('auth_logout', {}, renamed.cookie.split(';')[0])).status,
    200,
  );
  assert.equal((await call('server_snapshot', {}, finalToken)).status, 401);
  console.warn(
    'PASS: bootstrap protection, cookie login, roles, last admin, disable, reset, lockout, idle expiry, password change and logout (isolated QA database)',
  );
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
}

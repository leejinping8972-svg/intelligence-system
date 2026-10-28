import { Buffer } from 'node:buffer';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import { lock, pool, sql, unlock } from './database.mjs';
import { readCredentials } from './local-provider.mjs';

const derive = promisify(scrypt);
const cookieName = '__Host-is_session';
const sha = (value) => createHash('sha256').update(value).digest('hex');
export const publicUser = (row) =>
  row
    ? {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        enabled: Boolean(row.enabled),
        createdAt: Number(row.created_at),
        lastLoginAt: Number(row.last_login_at) || null,
      }
    : null;
export { passwordPolicy } from './password-policy.mjs';
import { passwordPolicy } from './password-policy.mjs';
export async function hashPassword(password) {
  passwordPolicy(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, {
    N: 32768,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
const dummyHash = await hashPassword(randomBytes(24).toString('hex'));
export async function verifyPassword(password, stored = dummyHash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = await derive(password, salt, 64, {
    N: 32768,
    maxmem: 64 * 1024 * 1024,
  });
  const buffer = Buffer.from(expected, 'hex');
  return actual.length === buffer.length && timingSafeEqual(actual, buffer);
}
function cookie(response, token = '', seconds = 0) {
  response.setHeader(
    'set-cookie',
    `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`,
  );
}
export async function sessionUser(request, touch = false, connection = pool) {
  const token = String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const now = Date.now();
  const { rows } = await connection.query(
    'SELECT u.*,s.token_hash,s.last_seen_at FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND s.last_seen_at>$3 AND u.enabled=1',
    [sha(token), now, now - 30 * 60_000],
  );
  const user = rows[0];
  if (user && touch && Number(user.last_seen_at) < now - 60_000)
    await connection.query(
      'UPDATE admin_sessions SET last_seen_at=$2 WHERE token_hash=$1',
      [sha(token), now],
    );
  return user || null;
}
let nextSessionCleanupAt = 0;
function scheduleSessionCleanup(now) {
  if (now < nextSessionCleanupAt) return;
  nextSessionCleanupAt = now + 15 * 60_000;
  // Expiry is enforced by sessionUser; housekeeping must not delay sign-in.
  setImmediate(async () => {
    try {
      await pool.query(
        'DELETE FROM admin_sessions WHERE expires_at<$1 OR last_seen_at<$2',
        [now, now - 30 * 60_000],
      );
    } catch {
      nextSessionCleanupAt = Date.now() + 60_000;
      console.warn(
        'Expired session cleanup failed; retrying after one minute.',
      );
    }
  });
}
async function signIn(user, response, { action, attemptKey, connection = pool } = {}) {
  const now = Date.now();
  const token = randomBytes(32).toString('hex');
  const writes = [
    connection.query(
      'INSERT INTO admin_sessions(token_hash,user_id,created_at,expires_at,last_seen_at) VALUES($1,$2,$3,$4,$3)',
      [sha(token), user.id, now, now + 12 * 60 * 60_000],
    ),
    connection.query('UPDATE admin_users SET last_login_at=$2 WHERE id=$1', [
      user.id,
      now,
    ]),
  ];
  if (attemptKey)
    writes.push(
      connection.query('DELETE FROM admin_login_attempts WHERE attempt_key=$1', [
        attemptKey,
      ]),
    );
  if (action) writes.push(audit(user, action, user.id, connection));
  // Request accounting must cover remaining writes even when one has failed.
  const results = await Promise.allSettled(writes);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  cookie(response, token, 12 * 60 * 60);
  scheduleSessionCleanup(now);
  return { user: publicUser({ ...user, last_login_at: now }) };
}
async function audit(actor, action, target = '', connection = pool) {
  await connection.query(
    'INSERT INTO admin_audit(id,actor_id,action,target_id,created_at) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), actor?.id || null, action, target, Date.now()],
  );
}
export async function adminSsoSignIn(user, response, peerId) {
  requireAdmin(user);
  if (!user.enabled) throw new Error('管理员已停用');
  return signIn(user, response, { action: `单点登录 ${peerId}` });
}
export async function platformLinkSignIn(user, response, peerId, connection = pool) {
  if (!user?.enabled || !['admin', 'researcher'].includes(user.role))
    throw Object.assign(new Error('账号不可用'), { status: 403 });
  return signIn(user, response, { action: `平台登录 ${peerId}`, connection });
}
export function platformLinkAudit(user, action, connection = pool) {
  return audit(user, action, user.id, connection);
}
export async function setupRequired() {
  const { rows } = await pool.query('SELECT id FROM admin_users LIMIT 1');
  return rows.length === 0;
}
export function requireAdmin(user) {
  if (user?.role !== 'admin')
    throw Object.assign(new Error('仅管理员可以执行此操作'), { status: 403 });
}
async function withAdminLock(callback) {
  const connection = await pool.connect();
  try {
    if (!(await lock(connection, 'admins')))
      throw new Error('正在保存管理员配置，请稍后再试');
    await connection.query('BEGIN');
    const result = await callback(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    await unlock(connection, 'admins').catch(() => {});
    connection.release();
  }
}
function userFields(input) {
  const username = String(input.username || '')
    .trim()
    .toLowerCase();
  const displayName = String(input.displayName || '').trim();
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username))
    throw new Error('账号需为3～64位字母、数字、点、下划线或短横线');
  if (!displayName || displayName.length > 100)
    throw new Error('请填写100字以内的姓名');
  const role = input.role === 'researcher' ? 'researcher' : 'admin';
  return { username, displayName, role };
}
async function failedAttempt(key, ipKey) {
  for (const attemptKey of [key, ipKey]) {
    const now = Date.now();
    const limit = attemptKey === ipKey ? 20 : 5;
    await pool.query(
      sql(
        'INSERT INTO admin_login_attempts(attempt_key,failures,locked_until,updated_at) VALUES($1,1,0,$2) ON CONFLICT(attempt_key) DO UPDATE SET failures=CASE WHEN admin_login_attempts.updated_at>$3 THEN admin_login_attempts.failures+1 ELSE 1 END,locked_until=CASE WHEN admin_login_attempts.updated_at>$3 AND admin_login_attempts.failures+1>=$4 THEN $5::bigint ELSE 0 END,updated_at=EXCLUDED.updated_at',
        'INSERT INTO admin_login_attempts(attempt_key,failures,locked_until,updated_at) VALUES($1,1,0,$2) ON DUPLICATE KEY UPDATE failures=IF(updated_at>$3,failures+1,1),locked_until=IF(failures>=$4,$5,0),updated_at=VALUES(updated_at)',
      ),
      [attemptKey, now, now - 15 * 60_000, limit, now + 15 * 60_000],
    );
  }
}
export async function authAction(input, request, response, user) {
  if (input.action === 'auth_status')
    return {
      setupRequired: user?.id ? false : await setupRequired(),
      user: publicUser(user),
    };
  if (input.action === 'auth_login' || input.action === 'auth_setup') {
    const ip = String(
      request.headers['x-forwarded-for'] || request.socket.remoteAddress,
    )
      .split(',')
      .at(-1)
      .trim();
    const username = String(input.username || '')
      .trim()
      .toLowerCase();
    const ipKey = sha(`ip|${ip}`);
    const key = sha(`${ip}|${username}`);
    const found = await pool.query(
      input.action === 'auth_setup'
        ? 'SELECT locked_until FROM admin_login_attempts WHERE (attempt_key=$1 OR attempt_key=$2) AND locked_until>$3'
        : 'SELECT u.*,EXISTS(SELECT 1 FROM admin_login_attempts WHERE attempt_key IN ($1,$2) AND locked_until>$3) AS login_blocked FROM (SELECT 1 AS marker) AS login_request LEFT JOIN admin_users u ON u.username=$4',
      input.action === 'auth_setup'
        ? [key, ipKey, Date.now()]
        : [key, ipKey, Date.now(), username],
    );
    if (
      input.action === 'auth_setup'
        ? found.rows.length
        : found.rows[0]?.login_blocked
    )
      throw Object.assign(new Error('尝试次数过多，请15分钟后重试'), {
        status: 429,
      });
    if (input.action === 'auth_setup') {
      if (!(await setupRequired())) throw new Error('管理员已创建，请直接登录');
      const expected = Buffer.from(
        (await readCredentials()).RESEARCH_ACCESS_KEY || '',
      );
      const supplied = Buffer.from(String(input.setupCode || ''));
      if (
        !expected.length ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        await failedAttempt(key, ipKey);
        throw new Error('原研究访问码不正确，无法创建首位管理员');
      }
      const fields = userFields({ ...input, role: 'admin' });
      const passwordHash = await hashPassword(input.password);
      const created = await withAdminLock(async (db) => {
        const { rows } = await db.query('SELECT id FROM admin_users LIMIT 1');
        if (rows.length) throw new Error('管理员已创建，请直接登录');
        const id = randomUUID();
        const now = Date.now();
        await db.query(
          'INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at,password_changed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)',
          [id, fields.username, fields.displayName, passwordHash, 'admin', now],
        );
        return {
          id,
          username: fields.username,
          display_name: fields.displayName,
          role: 'admin',
          enabled: 1,
          created_at: now,
        };
      });
      return signIn(created, response, { action: '创建首位管理员' });
    }
    const foundUser = found.rows[0]?.id ? found.rows[0] : undefined;
    if (
      !(await verifyPassword(input.password, foundUser?.password_hash)) ||
      !foundUser?.enabled
    ) {
      await failedAttempt(key, ipKey);
      throw new Error('账号或密码错误，或账号已停用');
    }
    return signIn(foundUser, response, { action: '登录', attemptKey: key });
  }
  if (!user) throw Object.assign(new Error('请先登录'), { status: 401 });
  if (input.action === 'auth_touch') return { active: true };
  if (input.action === 'auth_logout') {
    await pool.query('DELETE FROM identity_artifacts WHERE account_id=$1', [user.id]);
    await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [
      user.token_hash,
    ]);
    cookie(response);
    return { loggedOut: true };
  }
  if (input.action === 'auth_change_password') {
    const attemptKey = sha(`account-change|${user.id}`);
    const blocked = await pool.query(
      'SELECT locked_until FROM admin_login_attempts WHERE attempt_key=$1 AND locked_until>$2',
      [attemptKey, Date.now()],
    );
    if (blocked.rows.length)
      throw new Error('当前密码验证失败次数过多，请15分钟后重试');
    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      await failedAttempt(
        attemptKey,
        sha(`account-ip|${request.socket.remoteAddress}`),
      );
      throw new Error('当前密码不正确');
    }
    const username =
      input.username === undefined
        ? user.username
        : String(input.username).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username))
      throw new Error('账号需为3～64位字母、数字、点、下划线或短横线');
    const hash = input.password
      ? await hashPassword(input.password)
      : user.password_hash;
    if (!input.password && username === user.username)
      throw new Error('请填写新账号或新密码');
    await withAdminLock(async (db) => {
      const existing = await db.query(
        'SELECT id FROM admin_users WHERE username=$1 AND id<>$2',
        [username, user.id],
      );
      if (existing.rows.length) throw new Error('账号已存在');
      await db.query(
        'UPDATE admin_users SET username=$2,password_hash=$3,password_changed_at=$4 WHERE id=$1',
        [user.id, username, hash, Date.now()],
      );
      await db.query('DELETE FROM admin_sessions WHERE user_id=$1', [user.id]);
      await db.query('DELETE FROM identity_artifacts WHERE account_id=$1', [user.id]);
      await db.query('DELETE FROM admin_login_attempts WHERE attempt_key=$1', [
        attemptKey,
      ]);
    });
    await audit(user, '修改本人账号或密码', user.id);
    cookie(response);
    return { saved: true, relogin: true };
  }
  requireAdmin(user);
  if (input.action === 'auth_users') {
    const users = await pool.query(
      'SELECT * FROM admin_users ORDER BY created_at',
    );
    const events = await pool.query(
      'SELECT a.*,u.username FROM admin_audit a LEFT JOIN admin_users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 50',
    );
    return {
      users: users.rows.map(publicUser),
      events: events.rows.map((row) => ({
        action: row.action,
        username: row.username,
        targetId: row.target_id,
        at: Number(row.created_at),
      })),
    };
  }
  if (input.action === 'auth_create_user') {
    const fields = userFields(input);
    const id = randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(input.password);
    const found = await pool.query(
      'SELECT id FROM admin_users WHERE username=$1',
      [fields.username],
    );
    if (found.rows.length) throw new Error('账号已存在');
    await pool.query(
      'INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at,password_changed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)',
      [id, fields.username, fields.displayName, passwordHash, fields.role, now],
    );
    await audit(user, '新增账号', id);
    return { saved: true };
  }
  if (input.action === 'auth_update_user') {
    await withAdminLock(async (db) => {
      const found = await db.query(
        'SELECT * FROM admin_users WHERE id=$1 FOR UPDATE',
        [input.id],
      );
      if (!found.rows[0]) throw new Error('账号不存在');
      const enabled = input.enabled ? 1 : 0;
      const role = input.role === 'researcher' ? 'researcher' : 'admin';
      if (
        found.rows[0].role === 'admin' &&
        found.rows[0].enabled &&
        (!enabled || role !== 'admin')
      ) {
        const active = await db.query(
          "SELECT id FROM admin_users WHERE role='admin' AND enabled=1",
        );
        if (active.rows.length <= 1)
          throw new Error('必须保留至少一位启用的管理员');
      }
      if (input.id === user.id && (!enabled || role !== 'admin'))
        throw new Error('不能停用或降级当前登录账号');
      await db.query('UPDATE admin_users SET role=$2,enabled=$3 WHERE id=$1', [
        input.id,
        role,
        enabled,
      ]);
      await db.query('DELETE FROM admin_sessions WHERE user_id=$1', [input.id]);
      await db.query('DELETE FROM identity_artifacts WHERE account_id=$1', [input.id]);
    });
    await audit(user, '修改账号权限或状态', input.id);
    return { saved: true };
  }
  if (input.action === 'auth_reset_password') {
    if (input.id === user.id)
      throw new Error('请使用修改我的密码并验证当前密码');
    const hash = await hashPassword(input.password);
    const found = await pool.query('SELECT id FROM admin_users WHERE id=$1', [
      input.id,
    ]);
    if (!found.rows.length) throw new Error('账号不存在');
    await pool.query(
      'UPDATE admin_users SET password_hash=$2,password_changed_at=$3 WHERE id=$1',
      [input.id, hash, Date.now()],
    );
    await pool.query('DELETE FROM admin_sessions WHERE user_id=$1', [input.id]);
    await pool.query('DELETE FROM identity_artifacts WHERE account_id=$1', [input.id]);
    await audit(user, '重设账号密码', input.id);
    return { saved: true };
  }
  throw new Error('不支持的账号操作');
}

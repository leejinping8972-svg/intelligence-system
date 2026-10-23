import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import {
  hashPlatformToken as hash,
  newPlatformToken as token,
  openPeerKey,
  PLATFORM_LINK_BASE as base,
  sealPeerKey,
  validatePeerKey,
} from './platform-link-config.mjs';

const validToken = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const fail = (code, message, status = 400) =>
  Object.assign(new Error(message), { code, status });
const cookieName = (kind, handle) =>
  `__Host-is_link_${kind}_${handle.slice(0, 12)}`;
function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function appendCookie(response, value) {
  const old = response.getHeader('set-cookie');
  const existing = Array.isArray(old) ? old : [];
  if (old && !Array.isArray(old)) existing.push(old);
  response.setHeader('set-cookie', [...existing, value]);
}
function flowCookie(response, name, value = '', seconds = 0) {
  appendCookie(
    response,
    `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`,
  );
}
function readCookie(request, name) {
  return String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function requireBinding(request, name, expected) {
  const actual = readCookie(request, name);
  if (!validToken(actual) || !equal(hash(actual), expected))
    throw fail('BROWSER_MISMATCH', '登录链接不属于当前浏览器，请重新发起');
}
const respond = (response, value) =>
  response.end(JSON.stringify({ ok: true, ...value }));
const keySummary = (key) =>
  key
    ? {
        display_hint: key.display_hint,
        created_at: Number(key.created_at),
        revoked_at: key.revoked_at === null ? null : Number(key.revoked_at),
        expires_at: key.expires_at === null ? null : Number(key.expires_at),
      }
    : null;

export function createPlatformLink({
  config,
  store,
  sessionUser,
  signIn,
  audit = async () => {},
  fetchPeer = globalThis.fetch,
  now = Date.now,
}) {
  const rates = new Map();
  let nextCleanup = 0;
  function limit(request, bucket, maximum = 30) {
    // Only the private API network may trust the header overwritten by Caddy.
    const forwarded = request.headers['x-platform-link-client-ip'];
    const client =
      config.trustProxy && typeof forwarded === 'string' && isIP(forwarded)
        ? forwarded
        : request.socket.remoteAddress || 'unknown';
    const key = `${bucket}:${client}`;
    const time = now();
    if (rates.size > 4096)
      for (const [id, item] of rates) if (item.until <= time) rates.delete(id);
    if (rates.size > 4096)
      throw fail('RATE_LIMITED', '请求过于频繁，请稍后重试', 429);
    const item = rates.get(key);
    if (!item || item.until <= time)
      rates.set(key, { count: 1, until: time + 60_000 });
    else if (++item.count > maximum)
      throw fail('RATE_LIMITED', '请求过于频繁，请稍后重试', 429);
  }
  function sameOrigin(request) {
    if (request.headers.origin !== config.ownOrigin)
      throw fail('ORIGIN_INVALID', '请从本平台发起操作', 403);
  }
  async function body(request, allowed = []) {
    if (
      !String(request.headers['content-type'] || '')
        .toLowerCase()
        .startsWith('application/json')
    )
      throw fail('INVALID_REQUEST', '请求需要 JSON 格式');
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2048) throw fail('INVALID_REQUEST', '请求过大', 413);
      chunks.push(chunk);
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw fail('INVALID_REQUEST', '请求格式错误');
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.includes(key))
    )
      throw fail('INVALID_REQUEST', '请求字段无效');
    return input;
  }
  async function authenticated(request, connection) {
    const user = await sessionUser(request, false, connection);
    if (!user?.id || !user.enabled || !user.token_hash)
      throw fail('AUTH_REQUIRED', '请先登录当前平台', 401);
    return user;
  }
  function activeUser(user) {
    if (!user?.enabled || !['admin', 'researcher'].includes(user.role))
      throw fail('ACCOUNT_DISABLED', '目标账号不可用', 403);
  }
  function activeKey(key, user) {
    if (!key || key.revoked_at !== null)
      throw fail('KEY_INVALID', '登录 key 无效或已撤销', 401);
    if (key.expires_at !== null && Number(key.expires_at) <= now())
      throw fail('KEY_EXPIRED', '登录 key 已过期', 410);
    activeUser(user || key);
    return key;
  }
  async function bearer(request) {
    const match = /^Bearer ([\u0021-\u007E]{16,512})$/.exec(
      String(request.headers.authorization || ''),
    );
    if (!match) throw fail('KEY_INVALID', '登录 key 无效或已撤销', 401);
    return activeKey(await store.keyByHash(hash(match[1])));
  }
  async function flow(kind, handle, storage = store) {
    if (!validToken(handle)) throw fail('INVALID_REQUEST', '登录参数无效');
    const row = await storage.getFlow(kind, handle);
    if (!row) throw fail('INVALID_REQUEST', '登录请求不存在，请重新发起');
    if (row.consumed_at !== null)
      throw fail(
        kind === 'request' ? 'REQUEST_ALREADY_ISSUED' : 'TICKET_USED',
        '登录请求已使用，请重新发起',
        409,
      );
    if (Number(row.expires_at) <= now())
      throw fail(
        kind === 'request' ? 'REQUEST_EXPIRED' : 'TICKET_EXPIRED',
        '登录请求已过期，请重新发起',
        410,
      );
    return row;
  }
  async function peerCall(path, key, input) {
    try {
      const remote = await fetchPeer(`${config.peerOrigin}${base}${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(input),
      });
      if (!remote.ok) {
        if ([401, 403, 410].includes(remote.status))
          throw fail(
            'PEER_KEY_INVALID',
            '对方登录 key 已失效或账号不可用，请更新配置',
          );
        throw fail(
          'PEER_UNAVAILABLE',
          '对方登录接口暂不可用，请稍后重新发起',
          502,
        );
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of remote.body) {
        size += chunk.length;
        if (size > 8192) throw new Error('Oversized peer response');
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result?.ok !== true) throw new Error('Invalid peer response');
      return result;
    } catch (error) {
      if (
        error.code === 'PEER_KEY_INVALID' ||
        error.code === 'PEER_UNAVAILABLE'
      )
        throw error;
      throw fail(
        'PEER_UNAVAILABLE',
        '对方登录接口暂不可用，请稍后重新发起',
        502,
      );
    }
  }
  function peerContext(userId) {
    return `platform-link/v1|${userId}|${config.peerOrigin}`;
  }
  async function settings(request, response) {
    const user = await authenticated(request);
    const [key, peer] = await Promise.all([
      store.keyForUser(user.id),
      store.getPeer(user.id),
    ]);
    respond(response, {
      enabled: config.enabled,
      key: keySummary(key),
      peer: peer
        ? {
            subject: peer.peer_subject,
            display_name: peer.peer_display_name,
            display_hint: '***',
            updated_at: Number(peer.updated_at),
          }
        : null,
    });
  }
  async function accountKey(request, response, generate) {
    sameOrigin(request);
    const user = await authenticated(request);
    const input = await body(request, ['confirm']);
    if (input.confirm !== true)
      throw fail('INVALID_REQUEST', '请确认登录授权操作');
    const raw = generate ? `sel_${token()}` : null;
    await store.withUser(user.id, async (tx, current, connection) => {
      activeUser(current);
      const fresh = await authenticated(request, connection);
      if (fresh.token_hash !== user.token_hash)
        throw fail('FLOW_SESSION_CHANGED', '来源会话已变化，请重新操作', 409);
      await (generate
        ? tx.replaceKey(user.id, {
            id: randomUUID(),
            keyHash: hash(raw),
            displayHint: `${raw.slice(0, 8)}...${raw.slice(-4)}`,
          })
        : tx.revokeKey(user.id));
      await audit(
        current,
        generate ? '生成平台登录key' : '撤销平台登录key',
        connection,
      );
    });
    respond(response, generate ? { key: raw } : {});
  }
  async function peerSetting(request, response, remove) {
    sameOrigin(request);
    const user = await authenticated(request);
    const input = await body(request, remove ? [] : ['key']);
    let identity, encryptedKey;
    if (!remove) {
      if (!validatePeerKey(input.key))
        throw fail('INVALID_REQUEST', '请输入有效的对方登录 key');
      identity = await peerCall('/key/inspect', input.key, {});
      if (
        typeof identity.subject !== 'string' ||
        !identity.subject ||
        identity.subject.length > 128 ||
        // oxlint-disable-next-line no-control-regex -- Reject control characters in a peer identity.
        /[\u0000-\u001F\u007F]/.test(identity.subject) ||
        typeof identity.display_name !== 'string' ||
        !identity.display_name.trim() ||
        identity.display_name.length > 200
      )
        throw fail('PEER_UNAVAILABLE', '对方账号信息格式无效', 502);
      encryptedKey = sealPeerKey(
        input.key,
        config.encryptionKey,
        peerContext(user.id),
      );
    }
    await store.withUser(user.id, async (tx, current, connection) => {
      activeUser(current);
      // A slow remote inspect must not save a setting after its source session was revoked.
      const fresh = await authenticated(request, connection);
      if (fresh.id !== user.id || fresh.token_hash !== user.token_hash)
        throw fail('FLOW_SESSION_CHANGED', '当前账号已变化，请重新操作', 409);
      await (remove
        ? tx.removePeer(user.id)
        : tx.setPeer(user.id, {
            subject: identity.subject,
            displayName: identity.display_name,
            encryptedKey,
            version: randomUUID(),
          }));
      await audit(
        current,
        remove ? '移除跨平台配置' : '保存跨平台配置',
        connection,
      );
    });
    respond(response, {});
  }
  async function launch(request, response) {
    sameOrigin(request);
    const user = await authenticated(request);
    await body(request);
    const state = token(),
      binding = token();
    await store.withUser(user.id, async (tx, current, connection) => {
      activeUser(current);
      const fresh = await authenticated(request, connection);
      if (fresh.token_hash !== user.token_hash)
        throw fail('FLOW_SESSION_CHANGED', '来源会话已变化，请重新发起', 409);
      const peer = await tx.getPeer(user.id);
      if (!peer)
        throw fail('PEER_NOT_CONFIGURED', '请先配置 AI 全域平台账号', 409);
      await tx.putFlow(
        'launch',
        state,
        {
          userId: user.id,
          browserHash: hash(binding),
          payload: {
            sessionHash: user.token_hash,
            peerVersion: peer.version,
          },
        },
        300_000,
      );
    });
    flowCookie(response, cookieName('launch', state), binding, 300);
    const target = new URL(`${config.peerOrigin}${base}/login/start`);
    target.searchParams.set('source', config.source);
    target.searchParams.set('state', state);
    respond(response, { redirect: target.href });
  }
  async function start(request, response, url) {
    const state = url.searchParams.get('state');
    if (
      url.searchParams.get('source') !== config.peerSource ||
      !validToken(state) ||
      [...url.searchParams.keys()].some(
        (key) => !['source', 'state'].includes(key),
      )
    )
      throw fail('INVALID_REQUEST', '来源或登录参数无效');
    const id = token(),
      binding = token();
    await store.putFlow(
      'request',
      id,
      { browserHash: hash(binding), payload: { source: config.peerSource } },
      300_000,
    );
    flowCookie(response, cookieName('request', id), binding, 300);
    const target = new URL(`${config.peerOrigin}${base}/launch/callback`);
    target.searchParams.set('request_id', id);
    target.searchParams.set('state', state);
    response.writeHead(303, { location: target.href }).end();
  }
  async function tickets(request, response) {
    const key = await bearer(request);
    const input = await body(request, ['request_id']);
    const ticket = token();
    await store.withUser(key.user_id, async (tx, user) => {
      activeUser(user);
      const current = activeKey(await tx.keyForUser(user.id), user);
      if (current.id !== key.id)
        throw fail('KEY_INVALID', '登录 key 无效或已撤销', 401);
      const req = await flow('request', input.request_id, tx);
      if (req.payload.source !== config.peerSource)
        throw fail('INVALID_REQUEST', '来源不匹配');
      if (!(await tx.consumeFlow('request', input.request_id)))
        throw fail('REQUEST_ALREADY_ISSUED', '该请求已签票', 409);
      await tx.putFlow(
        'ticket',
        ticket,
        {
          userId: user.id,
          keyId: current.id,
          browserHash: req.browser_hash,
          payload: { requestCookie: cookieName('request', input.request_id) },
        },
        60_000,
      );
    });
    respond(response, { ticket, expires_in: 60 });
  }
  async function completeLaunch(request, response) {
    sameOrigin(request);
    const input = await body(request, ['state', 'request_id']);
    if (!validToken(input.request_id))
      throw fail('INVALID_REQUEST', '登录请求无效');
    const state = await flow('launch', input.state);
    requireBinding(
      request,
      cookieName('launch', input.state),
      state.browser_hash,
    );
    const session = await authenticated(request);
    if (
      session.id !== state.user_id ||
      session.token_hash !== state.payload.sessionHash
    )
      throw fail('FLOW_SESSION_CHANGED', '来源登录账号已变化，请重新发起', 409);
    const peer = await store.withUser(
      session.id,
      async (tx, user, connection) => {
        activeUser(user);
        const fresh = await authenticated(request, connection);
        if (fresh.token_hash !== state.payload.sessionHash)
          throw fail('FLOW_SESSION_CHANGED', '来源会话已变化，请重新发起', 409);
        const setting = await tx.getPeer(session.id);
        if (!setting || setting.version !== state.payload.peerVersion)
          throw fail(
            'FLOW_SESSION_CHANGED',
            '跨平台配置已变化，请重新发起',
            409,
          );
        if (!(await tx.consumeFlow('launch', input.state)))
          throw fail('TICKET_USED', '登录请求已使用', 409);
        return setting;
      },
    );
    flowCookie(response, cookieName('launch', input.state));
    const key = openPeerKey(
      peer.encrypted_key,
      config.encryptionKey,
      peerContext(session.id),
    );
    const result = await peerCall('/login/tickets', key, {
      request_id: input.request_id,
    });
    if (!validToken(result.ticket) || result.expires_in !== 60)
      throw fail('PEER_UNAVAILABLE', '对方票据格式无效', 502);
    const target = new URL(`${config.peerOrigin}${base}/login/consume`);
    target.searchParams.set('ticket', result.ticket);
    respond(response, { redirect: target.href });
  }
  async function consume(request, response, confirm = false) {
    sameOrigin(request);
    const input = await body(
      request,
      confirm ? ['confirm', 'accept'] : ['ticket'],
    );
    if (confirm && typeof input.accept !== 'boolean')
      throw fail('INVALID_REQUEST', '请确认是否切换账号');
    const kind = confirm ? 'confirm' : 'ticket',
      handle = confirm ? input.confirm : input.ticket;
    const saved = await flow(kind, handle);
    requireBinding(request, saved.payload.requestCookie, saved.browser_hash);
    const result = await store.withUser(
      saved.user_id,
      async (tx, user, connection) => {
        activeUser(user);
        const currentSession = await sessionUser(request, false, connection);
        const key = activeKey(await tx.keyForUser(user.id), user);
        if (key.id !== saved.key_id)
          throw fail('KEY_INVALID', '登录 key 已变更，请重新发起', 401);
        if (
          confirm &&
          (currentSession?.token_hash || null) !== saved.payload.previousSession
        )
          throw fail('FLOW_SESSION_CHANGED', '当前账号已变化，请重新发起', 409);
        if (!(await tx.consumeFlow(kind, handle)))
          throw fail('TICKET_USED', '登录请求已使用', 409);
        if (confirm && !input.accept)
          return { cancelled: true, redirect: config.home };
        if (!confirm && currentSession && currentSession.id !== user.id) {
          const confirmation = token();
          await tx.putFlow(
            'confirm',
            confirmation,
            {
              userId: user.id,
              keyId: key.id,
              browserHash: saved.browser_hash,
              payload: {
                requestCookie: saved.payload.requestCookie,
                previousSession: currentSession.token_hash,
              },
            },
            60_000,
          );
          return {
            requires_confirmation: true,
            confirm: confirmation,
            subject: user.id,
            display_name: user.display_name,
          };
        }
        if (currentSession?.id === user.id) return { redirect: config.home };
        // Buffer session headers until the surrounding transaction commits.
        const headers = new Map();
        await connection.query('SAVEPOINT platform_link_session');
        try {
          await signIn(
            user,
            {
              setHeader: (name, value) =>
                headers.set(name.toLowerCase(), value),
            },
            config.peerSource,
            connection,
          );
          await connection.query('RELEASE SAVEPOINT platform_link_session');
        } catch {
          // A failed session must not make a previously consumed ticket reusable.
          await connection.query('ROLLBACK TO SAVEPOINT platform_link_session');
          await connection.query('RELEASE SAVEPOINT platform_link_session');
          return { sessionFailed: true };
        }
        return { redirect: config.home, cookie: headers.get('set-cookie') };
      },
    );
    if (result.sessionFailed)
      throw fail('SESSION_FAILED', '登录会话未能创建，请重新发起', 503);
    if (!result.requires_confirmation)
      flowCookie(response, saved.payload.requestCookie);
    if (result.cookie) appendCookie(response, result.cookie);
    const { cookie: _cookie, ...publicResult } = result;
    respond(response, publicResult);
  }
  function landing(response, path, input) {
    const nonce = randomBytes(18).toString('base64');
    const serialized = JSON.stringify(input).replaceAll(
      '<',
      String.raw`\u003c`,
    );
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader(
      'content-security-policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>平台登录</title><style nonce="${nonce}">body{margin:0;font:16px system-ui;color:#172421;background:#f4f7f5}main{max-width:480px;margin:15vh auto;padding:24px}h1{font-size:22px}button,a{font:inherit}button{padding:10px 18px;margin:8px 12px 8px 0;border:1px solid #bac7bf;border-radius:6px;background:white;cursor:pointer}button:first-child{background:#116b50;color:white}a{color:#116b50}p{overflow-wrap:anywhere;line-height:1.6}</style></head><body><main><h1>平台登录</h1><p id="status" role="status">正在验证登录状态...</p><div id="actions" hidden><button id="accept">确认切换</button><button id="cancel">取消</button></div><a href="/admin/overview">返回选品平台</a></main><script nonce="${nonce}">
const payload=${serialized};history.replaceState(null,'',location.pathname);
const status=document.getElementById('status'),actions=document.getElementById('actions');
async function send(path,data){const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok||!v.ok)throw new Error(v.message||'登录暂不可用，请重新发起');return v;}
function finish(v){if(v.redirect)location.replace(v.redirect);}
function failure(e){actions.hidden=true;status.textContent=e.message||'登录暂不可用，请重新发起';}
send(${JSON.stringify(path)},payload).then(v=>{if(!v.requires_confirmation){finish(v);return;}status.textContent='将切换至 '+v.display_name+'（'+v.subject+'）';actions.hidden=false;for(const [id,accept] of [['accept',true],['cancel',false]])document.getElementById(id).onclick=async()=>{actions.hidden=true;try{finish(await send('${base}/login/confirm',{confirm:v.confirm,accept}));}catch(e){failure(e);}};}).catch(failure);
</script></body></html>`);
  }
  return {
    enabled: Boolean(config.enabled),
    async handle(request, response, url) {
      response.setHeader('cache-control', 'no-store');
      response.setHeader('referrer-policy', 'no-referrer');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('x-frame-options', 'DENY');
      response.setHeader('content-type', 'application/json; charset=utf-8');
      try {
        const route = `${request.method} ${url.pathname.slice(base.length)}`;
        if (route === 'GET /settings') return await settings(request, response);
        if (!config.enabled)
          throw fail('LOGIN_DISABLED', '跨平台登录尚未启用', 503);
        limit(
          request,
          route.startsWith('POST /login/tickets') ||
            route === 'POST /key/inspect'
            ? 'key'
            : 'browser',
          60,
        );
        if (now() >= nextCleanup) {
          nextCleanup = now() + 60_000;
          try {
            await store.cleanup();
          } catch {
            nextCleanup = now() + 10_000;
          }
        }
        switch (route) {
          case 'POST /key/inspect': {
            await body(request);
            const key = await bearer(request);
            return respond(response, {
              subject: key.user_id,
              display_name: key.display_name,
              expires_at:
                key.expires_at === null ? null : Number(key.expires_at),
            });
          }
          case 'POST /account-key/generate': {
            return await accountKey(request, response, true);
          }
          case 'POST /account-key/revoke': {
            return await accountKey(request, response, false);
          }
          case 'POST /peer-key': {
            return await peerSetting(request, response, false);
          }
          case 'DELETE /peer-key': {
            return await peerSetting(request, response, true);
          }
          case 'POST /launch': {
            return await launch(request, response);
          }
          case 'GET /login/start': {
            return await start(request, response, url);
          }
          case 'POST /login/tickets': {
            return await tickets(request, response);
          }
          case 'GET /launch/callback': {
            const input = {
              state: url.searchParams.get('state'),
              request_id: url.searchParams.get('request_id'),
            };
            const state = await flow('launch', input.state);
            requireBinding(
              request,
              cookieName('launch', input.state),
              state.browser_hash,
            );
            if (!validToken(input.request_id))
              throw fail('INVALID_REQUEST', '登录请求无效');
            return landing(response, `${base}/launch/callback`, input);
          }
          case 'POST /launch/callback': {
            return await completeLaunch(request, response);
          }
          case 'GET /login/consume': {
            const ticket = url.searchParams.get('ticket');
            const saved = await flow('ticket', ticket);
            requireBinding(
              request,
              saved.payload.requestCookie,
              saved.browser_hash,
            );
            return landing(response, `${base}/login/consume`, { ticket });
          }
          case 'POST /login/consume': {
            return await consume(request, response);
          }
          case 'POST /login/confirm': {
            return await consume(request, response, true);
          }
          default: {
            throw fail('INVALID_REQUEST', '接口不存在', 404);
          }
        }
      } catch (error) {
        response.statusCode = error.status || 500;
        if (response.statusCode === 429)
          response.setHeader('retry-after', '60');
        response.end(
          JSON.stringify({
            ok: false,
            code: error.status ? error.code : 'INTERNAL_ERROR',
            message: error.status ? error.message : '登录暂不可用，请重新发起',
          }),
        );
      }
    },
  };
}

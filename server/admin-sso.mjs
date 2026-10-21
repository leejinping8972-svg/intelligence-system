import { Buffer } from 'node:buffer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const token = () => randomBytes(32).toString('base64url');
const sha = (value) => createHash('sha256').update(value).digest('base64url');
const validToken = (value) =>
  typeof value === 'string' && /^[\w-]{43}$/.test(value);
const cookieName = (state) => `__Host-is_sso_${state.slice(0, 12)}`;
const callback = (origin) => `${origin}/api/sso/callback`;
const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const one = Buffer.from(a),
    two = Buffer.from(b);
  return one.length === two.length && timingSafeEqual(one, two);
}
function appendCookie(response, value) {
  const old = response.getHeader('set-cookie');
  const values = Array.isArray(old) ? old : [];
  if (old && !Array.isArray(old)) values.push(old);
  response.setHeader('set-cookie', [...values, value]);
}
function flowCookie(response, state, value = '', maxAge = 0) {
  appendCookie(
    response,
    `${cookieName(state)}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  );
}
function readCookie(request, state) {
  return String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName(state)}=`))
    ?.slice(cookieName(state).length + 1);
}
function redirect(response, url) {
  response.writeHead(303, { location: url }).end();
}
function json(response, value) {
  response.end(JSON.stringify(value));
}
export function ssoReturnPath(value, ownOrigin) {
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    !value.startsWith('/admin/') ||
    // oxlint-disable-next-line no-control-regex -- Reject browser URL controls in post-login return paths.
    /[\\\u0000-\u0020\u007F]/.test(value)
  )
    return '/admin/overview';
  const url = new URL(value, ownOrigin);
  if (
    url.origin !== ownOrigin ||
    !url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/admin/auth')
  )
    return '/admin/overview';
  return `${url.pathname}${url.search}${url.hash}`;
}
async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw error('SSO请求过大', 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('SSO body must be an object');
    return parsed;
  } catch {
    throw error('SSO请求格式无效');
  }
}

// Bilateral SSO bridge v1. This is an opaque-code identity exchange, not OIDC.
export function createAdminSso({
  config,
  store,
  sessionUser,
  signIn,
  fetchPeer = globalThis.fetch,
}) {
  // Limit unauthenticated browser flows per source address; upstream should also limit these routes.
  const rates = new Map();
  function limit(request) {
    const ip = String(
      request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '',
    )
      .split(',')
      .at(-1)
      .trim();
    const key = sha(ip),
      minute = Math.floor(Date.now() / 60_000);
    if (rates.size > 10_000) {
      for (const [address, entry] of rates)
        if (entry.minute !== minute) rates.delete(address);
      if (rates.size > 10_000) throw error('SSO请求繁忙，请稍后重试', 429);
    }
    const entry = rates.get(key);
    const count = entry?.minute === minute ? entry.count + 1 : 1;
    rates.set(key, { minute, count });
    if (count > 30) throw error('SSO请求过于频繁，请稍后重试', 429);
  }
  function validateAuthorization(input) {
    if (
      input.client_id !== config.peerId ||
      input.redirect_uri !== callback(config.peerOrigin) ||
      input.response_type !== 'code' ||
      input.code_challenge_method !== 'S256' ||
      !validToken(input.state) ||
      !validToken(input.code_challenge) ||
      input.prompt !== 'none'
    )
      throw error('SSO授权参数无效');
  }
  function browserOrigin(request) {
    if (
      request.headers.origin !== config.ownOrigin ||
      !String(request.headers['content-type'] || '').startsWith(
        'application/json',
      )
    )
      throw error('SSO请求来源无效', 403);
  }
  async function start(request, response, url) {
    limit(request);
    const state = token(),
      binding = token(),
      verifier = token();
    await store.put(
      'state',
      state,
      {
        binding: sha(binding),
        verifier,
        returnTo: ssoReturnPath(
          url.searchParams.get('return_to'),
          config.ownOrigin,
        ),
      },
      5 * 60_000,
    );
    flowCookie(response, state, binding, 300);
    const target = new URL('/api/sso/authorize', config.peerOrigin);
    target.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: callback(config.ownOrigin),
      response_type: 'code',
      state,
      code_challenge: sha(verifier),
      code_challenge_method: 'S256',
      prompt: 'none',
    }).toString();
    redirect(response, target.href);
  }
  function landing(request, response, url) {
    if (url.pathname === '/api/sso/authorize')
      validateAuthorization(Object.fromEntries(url.searchParams));
    else if (!validToken(url.searchParams.get('state')))
      throw error('SSO登录状态无效');
    // A same-origin fetch after navigation can use the existing Strict session cookie.
    // Never relax the local session cookie to support cross-site navigation.
    const nonce = randomBytes(18).toString('base64');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader(
      'content-security-policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>验证登录状态</title><p role="status" id="status">正在验证管理员登录状态…</p><a href="/admin/auth/login?sso=skip">使用账号密码登录</a><script nonce="${nonce}">
fetch(location.pathname, {method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new URLSearchParams(location.search)))})
.then(async r=>{const data=await r.json();if(!r.ok)throw new Error();location.replace(data.redirect);})
.catch(()=>{document.getElementById('status').textContent='登录验证暂不可用，请关闭此页并返回系统使用账号密码登录。';});
</script></html>`);
  }
  async function authorize(request, response) {
    browserOrigin(request);
    limit(request);
    const input = await body(request);
    validateAuthorization(input);
    const user = await sessionUser(request, false);
    const target = new URL(callback(config.peerOrigin));
    target.searchParams.set('state', input.state);
    if (!user || !user.enabled || user.role !== 'admin' || !user.token_hash) {
      target.searchParams.set(
        'error',
        user ? 'access_denied' : 'login_required',
      );
    } else {
      const code = token();
      await store.put(
        'code',
        code,
        {
          userId: user.id,
          sessionHash: user.token_hash,
          challenge: input.code_challenge,
          clientId: input.client_id,
          redirectUri: input.redirect_uri,
        },
        60_000,
      );
      target.searchParams.set('code', code);
    }
    json(response, { redirect: target.href });
  }
  async function exchange(request, response) {
    if (!equal(request.headers.authorization, `Bearer ${config.secret}`))
      throw error('SSO客户端认证失败', 401);
    if (
      !String(request.headers['content-type'] || '').startsWith(
        'application/json',
      )
    )
      throw error('SSO需要JSON请求');
    const input = await body(request);
    if (
      input.grant_type !== 'authorization_code' ||
      input.client_id !== config.peerId ||
      input.redirect_uri !== callback(config.peerOrigin) ||
      !validToken(input.code) ||
      !validToken(input.code_verifier)
    )
      throw error('SSO凭证参数无效');
    const ticket = await store.get('code', input.code);
    if (
      !ticket ||
      ticket.clientId !== input.client_id ||
      ticket.redirectUri !== input.redirect_uri ||
      !equal(ticket.challenge, sha(input.code_verifier))
    )
      throw error('SSO凭证无效或已过期');
    const user = await store.activeAdmin(ticket.userId, ticket.sessionHash);
    if (!user || !(await store.consume('code', input.code)))
      throw error('SSO凭证无效或已过期');
    json(response, {
      protocol_version: '1',
      issuer: config.ownOrigin,
      audience: config.peerId,
      sub: user.id,
      role: 'admin',
    });
  }
  async function complete(request, response) {
    browserOrigin(request);
    const input = await body(request);
    const state = input.state;
    if (!validToken(state)) throw error('SSO登录状态无效');
    const binding = readCookie(request, state);
    const flow = await store.get('state', state);
    if (
      !flow ||
      !validToken(binding) ||
      !equal(flow.binding, sha(binding)) ||
      !(await store.consume('state', state))
    )
      throw error('SSO登录状态已失效，请重新登录');
    let destination = '/admin/auth/login?sso=unavailable';
    try {
      const code = input.code;
      if (!input.error && validToken(code)) {
        const remote = await fetchPeer(
          `${config.peerOrigin}/api/sso/exchange`,
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.secret}`,
            },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              client_id: config.clientId,
              redirect_uri: callback(config.ownOrigin),
              code,
              code_verifier: flow.verifier,
            }),
          },
        );
        if (!remote.ok) throw error('SSO对端验证失败');
        const chunks = [];
        let bytes = 0;
        for await (const chunk of remote.body) {
          bytes += chunk.length;
          if (bytes > 8192) throw error('SSO对端响应过大');
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        const identity = JSON.parse(raw);
        const localId = config.accounts.get(identity.sub);
        if (
          identity.protocol_version !== '1' ||
          identity.issuer !== config.peerOrigin ||
          identity.audience !== config.clientId ||
          identity.role !== 'admin' ||
          !localId
        )
          throw error('SSO账号未绑定');
        const local = await store.localAdmin(localId);
        if (!local) throw error('SSO本地管理员不可用');
        // Do not switch an already authenticated local account in another tab.
        const current = await sessionUser(request, false);
        if (current && current.id !== local.id)
          throw error('请先退出当前本地账号');
        await signIn(local, response, config.peerId);
        destination = flow.returnTo;
      }
    } catch {
      destination = '/admin/auth/login?sso=failed';
    }
    flowCookie(response, state);
    json(response, { redirect: destination });
  }
  return {
    enabled: Boolean(config),
    async handle(request, response, url) {
      response.setHeader('cache-control', 'no-store');
      response.setHeader('referrer-policy', 'no-referrer');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('x-frame-options', 'DENY');
      response.setHeader('content-type', 'application/json; charset=utf-8');
      try {
        if (!config) throw error('单点登录尚未启用', 404);
        switch (`${request.method} ${url.pathname}`) {
          case 'GET /api/sso/start': {
            await start(request, response, url);
            break;
          }
          case 'GET /api/sso/authorize': {
            landing(request, response, url);
            break;
          }
          case 'POST /api/sso/authorize': {
            await authorize(request, response);
            break;
          }
          case 'POST /api/sso/exchange': {
            await exchange(request, response);
            break;
          }
          case 'GET /api/sso/callback': {
            landing(request, response, url);
            break;
          }
          case 'POST /api/sso/callback': {
            await complete(request, response);
            break;
          }
          default: {
            throw error('SSO接口不存在', 404);
          }
        }
      } catch (error) {
        response.writeHead(error.status || 400);
        json(response, {
          error: error.status
            ? error.message
            : '单点登录暂不可用，请使用账号密码登录',
        });
      }
    },
  };
}

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { AI_HOME, IDENTITY_BASE, identityProfile } from './identity-config.mjs';

const escape = (value) =>
  String(value).replaceAll(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
const redirect = (response, target) =>
  response.writeHead(303, { location: target }).end();
function page(
  response,
  { title = '统一登录', content, script = '', formOrigin = '' },
) {
  const nonce = randomBytes(24).toString('base64');
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader(
    'content-security-policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; form-action 'self' ${formOrigin}; base-uri 'none'; frame-ancestors 'none'`,
  );
  response.end(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17252d;font:15px system-ui,sans-serif}main{max-width:420px;margin:12vh auto;padding:28px}img{width:44px;height:44px}h1{font-size:24px}label{display:block;margin:18px 0}input,button{width:100%;min-height:44px;padding:10px;border:1px solid #a8b2ba;border-radius:6px;font:inherit}input{margin-top:6px;background:white}button{background:#127b65;color:white;cursor:pointer}p[role=alert]{color:#b42318}@media(max-width:480px){main{margin:6vh auto}}</style><main><img src="/admin/hci-logo.svg" alt=""><h1>${escape(title)}</h1>${content}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</html>`,
  );
}
async function formBody(request) {
  if (
    !String(request.headers['content-type'] || '').startsWith(
      'application/x-www-form-urlencoded',
    )
  )
    throw Object.assign(new Error('请求格式无效'), { status: 415 });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 4096)
      throw Object.assign(new Error('请求过大'), { status: 413 });
    chunks.push(chunk);
  }
  return Object.fromEntries(
    new URLSearchParams(Buffer.concat(chunks).toString()),
  );
}

export async function createIdentity({
  config,
  store,
  sessionUser,
  authAction,
  lock,
  unlock,
  pool,
  ProviderClass,
  onError = () => {},
}) {
  if (!config)
    return {
      enabled: false,
      handle: async (_request, response) =>
        response.writeHead(503).end('{"error":"统一登录尚未启用"}'),
    };
  const providerModule = ProviderClass ? null : await import('oidc-provider');
  const Provider = ProviderClass || providerModule.Provider;
  const provider = new Provider(config.issuer, {
    adapter: store.Adapter,
    clients: [
      {
        client_id: config.clientId,
        client_secret: config.secret,
        redirect_uris: [config.redirectUri],
        post_logout_redirect_uris: [AI_HOME],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'client_secret_basic',
        id_token_signed_response_alg: 'RS256',
      },
    ],
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      names: {
        session: '__Host-is_oidc',
        interaction: '__Secure-is_oidc_interaction',
        resume: '__Secure-is_oidc_resume',
      },
      long: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      short: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      introspection: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) =>
          client.clientId === token.clientId,
      },
      revocation: { enabled: true },
    },
    pkce: { required: () => true, methods: ['S256'] },
    clientBasedCORS: () => false,
    responseTypes: ['code'],
    scopes: ['openid', 'profile', 'platform_access'],
    claims: {
      openid: ['sub'],
      profile: ['name', 'preferred_username'],
      platform_access: ['selection_role', 'ai_role'],
    },
    conformIdTokenClaims: false,
    ttl: {
      AccessToken: 300,
      IdToken: 300,
      AuthorizationCode: 60,
      Interaction: 300,
      Session: 12 * 3600,
      Grant: 12 * 3600,
    },
    interactions: {
      url: (_ctx, interaction) =>
        `${IDENTITY_BASE}/interaction/${interaction.uid}`,
    },
    async findAccount(_ctx, id) {
      const profile = identityProfile(await store.user(id), config);
      return profile
        ? { accountId: id, claims: async () => profile }
        : undefined;
    },
    async renderError(ctx, out) {
      ctx.type = 'html';
      ctx.body = `<!doctype html><meta charset="utf-8"><title>登录未完成</title><p>统一登录未完成：${escape(out.error)}</p><a href="/admin/">返回系统</a>`;
    },
  });
  provider.proxy = true;
  provider.on('server_error', (_ctx, error) => onError(error));
  const callback = provider.callback();
  let nextCleanup = 0;
  let tail = Promise.resolve();
  let pending = 0;
  const rates = new Map();
  function loginPage(response, uid, message = '', reauthenticate = false) {
    const action = `${IDENTITY_BASE}/interaction/${uid}`;
    page(response, {
      formOrigin: new URL(config.redirectUri).origin,
      content: `${message ? `<p role="alert">${escape(message)}</p>` : ''}<form method="post" action="${action}"><label>账号<input name="username" autocomplete="username" required maxlength="64"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><button>登录</button></form>`,
      script:
        message || reauthenticate
          ? ''
          : `const f=document.createElement('form');f.method='post';f.action=${JSON.stringify(action)};document.body.append(f);f.submit();`,
    });
  }
  async function interaction(request, response, uid) {
    const details = await provider.interactionDetails(request, response);
    if (details.uid !== uid)
      throw Object.assign(new Error('登录请求已过期，请重新进入'), {
        status: 400,
      });
    if (request.method === 'GET') {
      loginPage(
        response,
        uid,
        '',
        details.prompt.name === 'login' &&
          (String(details.params.prompt || '')
            .split(' ')
            .includes('login') ||
            details.params.max_age !== undefined),
      );
      return;
    }
    if (request.method !== 'POST')
      throw Object.assign(new Error('请求方式无效'), { status: 405 });
    const input = await formBody(request);
    let user = await sessionUser(request, true);
    const force =
      details.prompt.name === 'login' &&
      (String(details.params.prompt || '')
        .split(' ')
        .includes('login') ||
        details.params.max_age !== undefined);
    if (input.username || input.password) {
      try {
        await authAction(
          {
            action: 'auth_login',
            username: input.username,
            password: input.password,
          },
          request,
          response,
          null,
        );
        const cookies = response.getHeader('set-cookie');
        const value = (Array.isArray(cookies) ? cookies : [cookies]).find(
          (item) => String(item).startsWith('__Host-is_session='),
        );
        user = await sessionUser({
          ...request,
          headers: { ...request.headers, cookie: String(value).split(';')[0] },
        });
      } catch (error) {
        onError(error);
        response.statusCode = error.code ? 503 : error.status || 400;
        loginPage(
          response,
          uid,
          error.code ? '登录服务暂不可用，请稍后重试' : error.message,
        );
        return;
      }
    } else if (force) user = null;
    if (!user) {
      loginPage(response, uid, '', true);
      return;
    }
    if (!identityProfile(user, config))
      throw Object.assign(new Error('账号不可用'), { status: 403 });
    store.context.getStore().user = user;
    const grant = new provider.Grant({
      accountId: user.id,
      clientId: details.params.client_id,
    });
    grant.addOIDCScope(String(details.params.scope || 'openid'));
    const grantId = await grant.save();
    await provider.interactionFinished(
      request,
      response,
      {
        login: {
          accountId: user.id,
          amr: ['pwd'],
          ts: Math.floor(Number(user.last_login_at || Date.now()) / 1000),
        },
        consent: { grantId },
      },
      { mergeWithLastSubmission: false },
    );
  }
  return {
    enabled: true,
    issuer: config.issuer,
    provider,
    async directory(actor) {
      if (actor?.role !== 'admin' || !actor.id)
        throw Object.assign(new Error('仅管理员可以导出账号目录'), {
          status: 403,
        });
      const users = await store.directory();
      return {
        issuer: config.issuer,
        users: users.map((user) => ({
          sub: user.id,
          username: user.username,
          name: user.display_name,
          enabled: Boolean(user.enabled),
          ...identityProfile(user, config),
        })),
      };
    },
    async handle(request, response, url) {
      response.setHeader('cache-control', 'no-store');
      response.setHeader('referrer-policy', 'strict-origin');
      response.setHeader('x-frame-options', 'DENY');
      let connection;
      let locked = false;
      let releaseTurn;
      try {
        if (request.headers.host !== new URL(config.origin).host)
          throw Object.assign(new Error('登录域名无效'), { status: 400 });
        const address =
          request.headers['x-platform-link-client-ip'] ||
          request.socket.remoteAddress;
        const minute = Math.floor(Date.now() / 60_000);
        if (rates.size > 10_000)
          for (const [ip, entry] of rates)
            if (entry.minute !== minute) rates.delete(ip);
        const rate = rates.get(address);
        const count = rate?.minute === minute ? rate.count + 1 : 1;
        if (count > 120 || (rates.size >= 10_000 && !rate))
          throw Object.assign(new Error('请求过于频繁'), { status: 429 });
        rates.set(address, { minute, count });
        if (
          request.method === 'POST' &&
          (url.pathname === `${IDENTITY_BASE}/auth` ||
            url.pathname.startsWith(`${IDENTITY_BASE}/interaction/`)) &&
          request.headers.origin !== config.origin
        )
          throw Object.assign(new Error('请从统一登录页面操作'), {
            status: 403,
          });
        if (pending >= 40)
          throw Object.assign(new Error('登录服务繁忙'), { status: 503 });
        pending++;
        const predecessor = tail;
        tail = new Promise((resolve) => {
          releaseTurn = resolve;
        });
        await predecessor;
        // Serialize stateful protocol requests across workers, including code redemption.
        connection = await pool.connect();
        locked = await lock(connection, 'identity');
        if (!locked)
          throw Object.assign(new Error('登录服务繁忙，请重试'), {
            status: 503,
          });
        const user = await sessionUser(request);
        await store.context.run({ user }, async () => {
          if (
            url.pathname === `${IDENTITY_BASE}/auth` &&
            request.method === 'GET' &&
            request.headers['sec-fetch-site'] === 'cross-site'
          ) {
            const fields = [...url.searchParams]
              .map(
                ([name, value]) =>
                  `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`,
              )
              .join('');
            page(response, {
              formOrigin: new URL(config.redirectUri).origin,
              content: `<form id="continue" method="get" action="${IDENTITY_BASE}/auth">${fields}<button>继续登录</button></form>`,
              script:
                'HTMLFormElement.prototype.submit.call(document.getElementById("continue"));',
            });
          } else if (url.pathname.startsWith(`${IDENTITY_BASE}/interaction/`)) {
            const uid = url.pathname.slice(
              `${IDENTITY_BASE}/interaction/`.length,
            );
            if (!/^[\w-]{16,128}$/.test(uid))
              throw Object.assign(new Error('登录请求无效'), { status: 400 });
            await interaction(request, response, uid);
          } else if (
            url.pathname === `${IDENTITY_BASE}/logout` &&
            request.method === 'GET'
          ) {
            page(response, {
              title: '退出统一登录',
              content: `<form method="post" action="${IDENTITY_BASE}/logout"><button>确认退出</button></form>`,
            });
          } else if (
            url.pathname === `${IDENTITY_BASE}/logout` &&
            request.method === 'POST'
          ) {
            if (request.headers.origin !== config.origin || !user)
              throw Object.assign(new Error('请先登录'), { status: 403 });
            await authAction(
              { action: 'auth_logout' },
              request,
              response,
              user,
            );
            redirect(response, '/admin/auth/login?sso=skip');
          } else {
            // oidc-provider is mounted at the issuer path; preserve the public URLs it generates.
            request.url = request.url.slice(IDENTITY_BASE.length) || '/';
            request.baseUrl = IDENTITY_BASE;
            await callback(request, response);
          }
          if (Date.now() >= nextCleanup) {
            nextCleanup = Date.now() + 60_000;
            await store.cleanup();
          }
        });
      } catch (error) {
        onError(error);
        if (!response.headersSent) {
          response.statusCode = error.status || 400;
          page(response, {
            title: '登录未完成',
            content:
              '<p role="alert">登录请求无效或已过期，请从平台重新进入。</p><a href="/admin/">返回系统</a>',
          });
        }
      } finally {
        try {
          if (locked) await unlock(connection, 'identity');
        } catch (error) {
          onError(error);
        } finally {
          connection?.release();
          if (releaseTurn) {
            pending--;
            releaseTurn();
          }
        }
      }
    },
  };
}

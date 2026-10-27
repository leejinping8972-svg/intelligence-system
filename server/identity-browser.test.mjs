import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
/* oxlint-disable vitest/no-import-node-test -- Real HTTPS cross-site browser acceptance on synthetic accounts. */
/* oxlint-disable unicorn/no-await-expression-member -- Browser acceptance reads synthetic state directly in assertions. */
import test from 'node:test';

import { chromium } from 'playwright-core';

import { identityFixture } from './identity-test-fixture.mjs';

test('two HTTPS origins share login in both directions with real browser cookies', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'identity-browser-'));
  const openssl =
    process.env.IDENTITY_TEST_OPENSSL ||
    (process.platform === 'win32'
      ? 'C:/Program Files/Git/usr/bin/openssl.exe'
      : 'openssl');
  const executablePath =
    process.env.IDENTITY_TEST_BROWSER ||
    (process.platform === 'win32'
      ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      : '/usr/bin/chromium');
  const output = resolve(import.meta.dirname, '../.artifacts/identity-browser');
  await mkdir(output, { recursive: true });
  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(temp, 'key.pem'),
      '-out',
      join(temp, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=is.authority.test',
    ],
    { stdio: 'ignore' },
  );
  let f;
  let identity;
  let browser;
  const pending = new Map();
  const peers = new Map();
  const cookie = (request, name) =>
    String(request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  const send = (response, value) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(value));
  };
  const redirect = (response, location) =>
    response.writeHead(303, { location }).end();
  const server = createServer(
    {
      key: await readFile(join(temp, 'key.pem')),
      cert: await readFile(join(temp, 'cert.pem')),
    },
    (request, response) => {
      void handle(request, response).catch((error) => {
        console.error(error);
        response.writeHead(500).end('Synthetic fixture failure');
      });
    },
  );
  server.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const port = server.address().port;
  const ours = `https://is.authority.test:${port}`;
  const peer = `https://ai.relying.test:${port}`;
  async function exchange(code, verifier) {
    return new Promise((done, reject) => {
      const request = httpsRequest(
        `https://127.0.0.1:${port}/api/identity/token`,
        {
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            host: new URL(ours).host,
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Basic ${Buffer.from(`${f.config.clientId}:${f.config.secret}`).toString('base64')}`,
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            done({
              status: response.statusCode,
              data: JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: f.config.redirectUri,
        }).toString(),
      );
    });
  }
  async function handle(request, response) {
    const url = new URL(request.url, `https://${request.headers.host}`);
    if (url.origin === peer) {
      if (url.pathname === '/admin/' && url.searchParams.get('sso') === '1') {
        redirect(response, '/login');
      } else if (url.pathname === '/login') {
        const id = randomBytes(24).toString('hex');
        const state = randomBytes(32).toString('base64url');
        const nonce = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        pending.set(id, { state, nonce, verifier });
        response.setHeader(
          'set-cookie',
          `__Host-qa_pending=${id}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        );
        redirect(
          response,
          `${f.config.issuer}/auth?${new URLSearchParams({
            client_id: f.config.clientId,
            redirect_uri: f.config.redirectUri,
            response_type: 'code',
            scope: 'openid profile platform_access',
            state,
            nonce,
            code_challenge: createHash('sha256')
              .update(verifier)
              .digest('base64url'),
            code_challenge_method: 'S256',
          })}`,
        );
      } else if (url.pathname === '/callback') {
        const id = cookie(request, '__Host-qa_pending');
        const flow = pending.get(id);
        pending.delete(id);
        assert.ok(flow);
        assert.equal(url.searchParams.get('state'), flow.state);
        const tokens = await exchange(
          url.searchParams.get('code'),
          flow.verifier,
        );
        assert.equal(tokens.status, 200, JSON.stringify(tokens.data));
        // This fixture asserts browser/session transport; signature validation is covered in identity.test.mjs.
        const claims = JSON.parse(
          Buffer.from(tokens.data.id_token.split('.')[1], 'base64url'),
        );
        assert.equal(claims.nonce, flow.nonce);
        assert.equal(claims.sub, f.user.id);
        const session = randomBytes(32).toString('hex');
        peers.set(session, claims.sub);
        response.setHeader(
          'set-cookie',
          `__Host-qa_peer=${session}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        );
        redirect(response, '/admin/');
      } else if (peers.get(cookie(request, '__Host-qa_peer'))) {
        response.setHeader('content-type', 'text/html');
        response.end(
          `<p id="who">${peers.get(cookie(request, '__Host-qa_peer'))}</p><a href="${ours}/admin/">Intelligence System</a>`,
        );
      } else redirect(response, '/login');
      return;
    }
    if (url.pathname.startsWith('/api/identity/')) {
      await identity.handle(request, response, url);
      return;
    }
    if (url.pathname === '/admin/hci-logo.svg') {
      response.setHeader('content-type', 'image/svg+xml');
      response.end(
        await readFile(
          resolve(import.meta.dirname, '../apps/web-antd/public/hci-logo.svg'),
        ),
      );
      return;
    }
    if (url.pathname === '/api' && request.method === 'POST') {
      assert.equal(request.headers.origin, ours);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const user = await f.auth.sessionUser(request);
      send(response, await f.auth.authAction(input, request, response, user));
      return;
    }
    if (url.pathname === '/normal-login') {
      response.setHeader('content-type', 'text/html');
      response.end(
        '<form id="form"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>Login</button></form><script>document.querySelector("form").onsubmit=async(e)=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));await fetch("/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"auth_login",...data})});location.href="/admin/"}</script>',
      );
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      `<p id="who"></p><a href="${peer}/admin/?sso=1">AI platform</a><script>fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'auth_status'})}).then(r=>r.json()).then(r=>{document.getElementById('who').textContent=r.user?.id||'anonymous'})</script>`,
    );
  }
  try {
    f = await identityFixture(ours);
    f.config.redirectUri = `${peer}/callback`;
    identity = await f.create();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-proxy-server',
        '--host-resolver-rules=MAP is.authority.test 127.0.0.1, MAP ai.relying.test 127.0.0.1',
      ],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.on('console', (entry) => {
      if (entry.type() === 'error')
        console.error('Synthetic browser console', entry.text());
    });
    await page.goto(`${ours}/normal-login`);
    await page.locator('[name=username]').fill(f.user.username);
    await page.locator('[name=password]').fill(f.password);
    await page.locator('button').click();
    await page.waitForURL(`${ours}/admin/`);
    await page.locator('a').click();
    await page
      .waitForURL(`${peer}/admin/`, { timeout: 10_000 })
      .catch(async (error) => {
        console.error(
          'Synthetic browser stopped at',
          new URL(page.url()).pathname,
          await page.locator('body').innerText(),
        );
        console.error(
          'Cookie metadata',
          (await context.cookies()).map(({ name, path, sameSite }) => ({
            name,
            path,
            sameSite,
          })),
        );
        console.error(
          'Provider errors',
          f.errors.map((failure) => ({
            name: failure.name,
            message: failure.message,
          })),
        );
        const uid = new URL(page.url()).pathname.split('/').at(-1);
        const interaction = await new f.store.Adapter('Interaction').findByUid(
          uid,
        );
        console.error(
          'Interaction prompt',
          interaction?.prompt,
          interaction?.params?.max_age,
          interaction?.params?.prompt,
        );
        await page.screenshot({ path: join(output, 'failure.png') });
        throw error;
      });
    assert.equal(await page.locator('#who').textContent(), f.user.id);
    await page.goto(`${peer}/admin/?sso=1`);
    await page.waitForURL(`${peer}/admin/`);
    assert.equal(await page.locator('#who').textContent(), f.user.id);
    const firstUser = { ...f.user };
    await f.auth.authAction(
      {
        action: 'auth_create_user',
        username: 'qa-second',
        displayName: 'Second synthetic user',
        password: f.password,
        role: 'researcher',
      },
      {},
      {},
      firstUser,
    );
    const secondUser = (
      await f.pool.query('SELECT * FROM admin_users WHERE username=$1', [
        'qa-second',
      ])
    ).rows[0];
    Object.assign(f.user, { id: secondUser.id, username: secondUser.username });
    await page.goto(`${ours}/normal-login`);
    await page.locator('[name=username]').fill(f.user.username);
    await page.locator('[name=password]').fill(f.password);
    await page.locator('button').click();
    await page.waitForURL(`${ours}/admin/`);
    await page.locator('a').click();
    await page.waitForURL(`${peer}/admin/`);
    assert.equal(await page.locator('#who').textContent(), secondUser.id);
    await page.locator('a').click();
    await page.waitForFunction(
      (id) => document.querySelector('#who')?.textContent === id,
      f.user.id,
    );
    await context.close();
    Object.assign(f.user, firstUser);

    const reverse = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });
    const reversePage = await reverse.newPage();
    await reversePage.goto(`${peer}/admin/`);
    await reversePage.locator('input[name=username]').waitFor();
    await reversePage.waitForLoadState('networkidle');
    assert.ok(
      await reversePage
        .locator('img')
        .evaluate((element) => element.complete && element.naturalWidth > 0),
    );
    await reversePage.screenshot({ path: join(output, 'login-desktop.png') });
    await reversePage.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await reversePage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await reversePage.screenshot({ path: join(output, 'login-mobile.png') });
    await reversePage.locator('input[name=username]').fill(f.user.username);
    await reversePage.locator('input[name=password]').fill(f.password);
    await reversePage.locator('button').click();
    await reversePage.waitForURL(`${peer}/admin/`);
    assert.equal(await reversePage.locator('#who').textContent(), f.user.id);
    await reversePage.locator('a').click();
    await reversePage.waitForFunction(
      (id) => document.querySelector('#who')?.textContent === id,
      f.user.id,
    );
    const localCookies = await reverse.cookies(ours);
    assert.ok(
      localCookies.some(
        (entry) =>
          entry.name === '__Host-is_session' &&
          entry.sameSite === 'Strict' &&
          entry.httpOnly &&
          entry.secure,
      ),
    );
    assert.ok(!f.errors.some((error) => !error.status || error.status >= 500));
    await reverse.close();
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
    await f?.close();
    await rm(temp, { recursive: true });
  }
});

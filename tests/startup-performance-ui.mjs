import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from 'playwright';

const build = resolve(
  process.argv[2] || '.artifacts/startup-performance/frontend',
);
const label = process.argv[3] || 'optimized';
const output = resolve('.artifacts/startup-performance');
await mkdir(output, { recursive: true });
const branding = {
  appName: 'QA Performance Workspace',
  logo: '/admin/hci-logo.svg',
};
const user = {
  id: 'qa-local-only',
  username: 'qa_local',
  displayName: 'QA Local',
  role: 'admin',
  enabled: true,
  createdAt: 1,
  lastLoginAt: 1,
};
const revisions = { published: 'qa-1', tasks: 'qa-1' };
const requests = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      requests.push({ action: input.action, at: Date.now() });
      const authenticated = /hci-qa-auth=1/.test(request.headers.cookie || '');
      let result;
      switch (input.action) {
        case 'public_branding':
          await delay(3000);
          result = branding;
          break;
        case 'auth_status':
          await delay(600);
          result = {
            setupRequired: false,
            ssoEnabled: false,
            user: authenticated ? user : null,
          };
          break;
        case 'auth_login':
          await delay(600);
          response.setHeader(
            'set-cookie',
            'hci-qa-auth=1; HttpOnly; SameSite=Strict; Path=/',
          );
          result = { user };
          break;
        case 'auth_touch':
          result = { user };
          break;
        case 'server_workspace_bootstrap':
          result = {
            entries: [{ key: 'branding:main', value: branding }],
            revisions,
            active: 0,
            indexing: false,
            generatedAt: new Date().toISOString(),
          };
          break;
        case 'server_workspace_overview':
          result = {
            indexing: false,
            snapshot: {
              counts: { keywords: 0, sites: 0, products: 0, reviews: 0 },
              keywords: {
                total: 0,
                priority: 0,
                pending: 0,
                selected: 0,
                completed: 0,
                active: 0,
              },
              productMarkets: {},
              topKeywords: [],
              revision: 'qa-1',
              generatedAt: new Date().toISOString(),
            },
          };
          break;
        default:
          throw new Error(`Unexpected mock API action: ${input.action}`);
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result));
      return;
    }
    const relative = decodeURIComponent(pathname)
      .replace(/^\/admin\/?/, '')
      .replace(/^\//, '');
    let file = resolve(build, relative || 'index.html');
    if (file !== build && !file.startsWith(`${build}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (!extname(file)) file = resolve(build, 'index.html');
    response.setHeader(
      'content-type',
      {
        '.css': 'text/css',
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      }[extname(file)] || 'application/octet-stream',
    );
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(500).end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (label === 'preview') {
  console.log(
    JSON.stringify({
      url: `${origin}/admin/overview`,
      syntheticDataOnly: true,
    }),
  );
} else {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const measurements = [];
  let currentPage;
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      currentPage = page;
      const errors = [];
      const external = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // All data and API responses in this check are synthetic and local.
      await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin === origin)
          return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      const startIndex = requests.length;
      const started = Date.now();
      await page.goto(`${origin}/admin/overview`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByPlaceholder('输入账号').waitFor({ state: 'visible' });
      await page.waitForFunction(
        () => !document.querySelector('#__app-loading__'),
      );
      const loginReadyMs = Date.now() - started;
      const loginResources = await page.evaluate(() => {
        const scripts = performance
          .getEntriesByType('resource')
          .filter((entry) => new URL(entry.name).pathname.endsWith('.js'));
        return {
          javascriptRequests: scripts.length,
          javascriptBytes: scripts.reduce(
            (total, entry) => total + entry.decodedBodySize,
            0,
          ),
        };
      });
      const statusBeforeLogin = requests
        .slice(startIndex)
        .filter((entry) => entry.action === 'auth_status').length;
      await page.screenshot({
        path: resolve(output, `${label}-${viewport.width}-login.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByPlaceholder('输入账号').fill(user.username);
      await page
        .locator('input[type="password"]')
        .fill('qa-synthetic-password-only');
      const clicked = Date.now();
      await page.locator('button[type="submit"]').click();
      await page
        .locator('.hci-stat-label')
        .filter({ hasText: '在研关键词' })
        .waitFor();
      const enterWorkspaceMs = Date.now() - clicked;
      await page.getByText('数据更新于', { exact: false }).waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      await page.screenshot({
        path: resolve(output, `${label}-${viewport.width}-overview.png`),
        fullPage: true,
        animations: 'disabled',
      });
      const sample = {
        viewport,
        loginReadyMs,
        enterWorkspaceMs,
        loginResources,
        statusBeforeLogin,
        statusTotal: requests
          .slice(startIndex)
          .filter((entry) => entry.action === 'auth_status').length,
        apiActions: requests.slice(startIndex).map((entry) => entry.action),
        errors,
        overflow,
        externalRequestsBlocked: external.length,
      };
      assert.deepEqual(errors, []);
      assert.equal(overflow, false);
      assert.equal(statusBeforeLogin, 1);
      if (label !== 'baseline') assert.equal(sample.statusTotal, 1);
      const returningIndex = requests.length;
      const returning = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .locator('.hci-stat-label')
        .filter({ hasText: '在研关键词' })
        .waitFor();
      await page.waitForFunction(
        () => !document.querySelector('#__app-loading__'),
      );
      sample.returningReadyMs = Date.now() - returning;
      sample.returningStatusRequests = requests
        .slice(returningIndex)
        .filter((entry) => entry.action === 'auth_status').length;
      assert.equal(sample.returningStatusRequests, 1);
      assert.equal(
        requests
          .slice(returningIndex)
          .some((entry) => entry.action === 'auth_login'),
        false,
      );
      measurements.push(sample);
      await context.close();
    }
    await writeFile(
      resolve(output, `${label}.json`),
      `${JSON.stringify({ build, delays: { branding: 3000, status: 600, login: 600 }, measurements }, null, 2)}\n`,
    );
    console.log(JSON.stringify({ label, measurements }, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        requests,
        url: currentPage?.url(),
        body: await currentPage?.locator('body').innerText(),
      }),
    );
    await currentPage?.screenshot({
      path: resolve(output, `${label}-failure.png`),
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}

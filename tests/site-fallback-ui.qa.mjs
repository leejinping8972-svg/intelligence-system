import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = resolve('apps/web-antd/dist'), calls = [];
const site = { id: 'synthetic-site', brand: 'Synthetic QA', domain: 'store.example', market: 'US', category: '运动营养', platform: 'Shopify', mainProducts: [], type: '独立电商', dataNature: 'collected', keyword: 'creatine' };
let config = { configured: false, browserEnabled: true, paidEnabled: false, message: '合成配置' };
const server = createServer(async (req, res) => {
  if (req.url === '/api') {
    let body = ''; for await (const c of req) body += c;
    const v = JSON.parse(body); calls.push(v); let r = {};
    if (v.action === 'auth_status') r = { setupRequired: false, user: { id: 'qa', username: 'qa', role: 'admin', displayName: '合成测试' } };
    if (v.action === 'public_branding') r = { appName: '合成测试' };
    if (v.action === 'server_workspace_snapshot') r = { entries: [{ key: 'sites:synthetic-site', value: site }] };
    if (v.action === 'server_snapshot') r = { keywords: [], tasks: [] };
    if (v.action === 'server_workspace_delta') r = { business: { entries: [{ key: 'sites:synthetic-site', value: site }] }, keywords: [], tasks: [], revisions: {} };
    if (v.action === 'server_site_fetch_config') config = { configured: !!v.apiKey, browserEnabled: v.browserEnabled, paidEnabled: v.paidEnabled, message: '已保存合成配置，没有调用采集服务' };
    if (/^server_site_fetch_/.test(v.action)) r = config;
    if (v.action === 'server_submit_products') r = { jobId: '00000000-0000-4000-8000-000000000123', tasks: [] };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(r)); return;
  }
  const file = resolve(base, decodeURIComponent(req.url.split('?')[0]).replace(/^\/admin\/?/, '').replace(/^\//, ''));
  if (!file.startsWith(base)) return res.writeHead(403).end();
  try {
    const data = await readFile(file); res.setHeader('content-type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(file)] || 'application/octet-stream'); res.end(data);
  } catch { res.setHeader('content-type', 'text/html'); res.end(await readFile(resolve(base, 'index.html'))); }
});
await new Promise(r => server.listen(5699, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, channel: 'chrome' }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5699/admin/settings');
  const panel = page.locator('#site-fetch-provider');
  await panel.waitFor();
  const switches = panel.getByRole('switch');
  assert.equal(await switches.nth(0).getAttribute('aria-checked'), 'true');
  assert.equal(await switches.nth(1).getAttribute('aria-checked'), 'false');
  const key = 'fc-synthetic-test-only-12345';
  await panel.locator('#site-firecrawl-key').fill(key);
  await panel.getByRole('button', { name: '保存采集策略' }).click();
  await panel.getByText('已保存合成配置，没有调用采集服务', { exact: true }).waitFor();
  assert.equal(await panel.locator('#site-firecrawl-key').inputValue(), '');
  assert.equal(calls.find(v => v.action === 'server_site_fetch_config').paidEnabled, false);
  assert.ok(!(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).includes(key));
  await mkdir('.artifacts', { recursive: true });
  await panel.screenshot({ path: '.artifacts/site-fallback-settings.png' });
  await page.goto('http://127.0.0.1:5699/admin/sites');
  await page.getByText('Synthetic QA', { exact: true }).first().waitFor();
  await page.locator('.ant-table-tbody').getByRole('button', { name: '采集商品', exact: true }).click();
  const modal = page.getByRole('dialog');
  const paid = modal.getByRole('spinbutton').last();
  assert.equal(await paid.inputValue(), '0');
  await modal.screenshot({ path: '.artifacts/site-fallback-dialog.png' });
  await modal.getByRole('button', { name: '提交后台采集' }).click();
  await page.waitForURL(/monitor/);
  const submitted = calls.find(v => v.action === 'server_submit_products');
  assert.equal(submitted.maxPaidRequests, 0);
  assert.equal(submitted.maxBrowserPages, 5);
  assert.deepEqual(errors, []);
  console.log('UI QA passed: default off, encrypted save request without probes, cleared secret, task default zero paid and bounded browser pages.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }

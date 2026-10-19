import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = resolve('apps/web-antd/dist');
const key = 'AIza-local-fixture-not-a-real-key-123456';
let configured = false, ready = false, failure = false;
const calls = [];
const server = createServer(async (req, res) => {
  if (req.url === '/api') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    calls.push(input);
    let result = {};
    if (input.action === 'auth_status') result = { setupRequired: false, user: { id: 'qa', username: 'qa', role: 'admin', displayName: '本地验收' } };
    if (input.action === 'public_branding') result = { appName: '本地验收' };
    if (input.action === 'server_snapshot') result = { keywords: [], tasks: [] };
    if (input.action === 'server_workspace_snapshot') result = { entries: [] };
    if (input.action === 'server_youtube_config') {
      assert.equal(input.apiKey, key);
      configured = true; ready = false;
    }
    if (input.action.startsWith('server_youtube_')) {
      if (input.verify) ready = !failure;
      result = { configured, ready, message: ready ? 'YouTube 连接正常' : failure ? 'YouTube 每日配额已用完' : configured ? '已配置，等待检测连接' : '尚未配置 YouTube API Key' };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
    return;
  }
  const file = resolve(base, decodeURIComponent(req.url.split('?')[0]).replace(/^\/admin\/?/, ''));
  if (!file.startsWith(base)) return res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.setHeader('content-type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.setHeader('content-type', 'text/html');
    res.end(await readFile(resolve(base, 'index.html')));
  }
});
await new Promise(r => server.listen(5698, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5698/admin/settings');
  const panel = page.locator('#youtube-provider');
  await panel.getByText('尚未配置 YouTube API Key', { exact: true }).waitFor();
  const save = panel.getByRole('button', { name: '加密保存到服务器', exact: true });
  const check = panel.getByRole('button', { name: '检测连接', exact: true });
  assert.equal(await save.isDisabled(), true);
  assert.equal(await check.isDisabled(), true);
  await panel.locator('#youtube-api-key').fill('invalid URL');
  await panel.locator('#youtube-api-key').blur();
  await panel.getByText('请粘贴 API Key 本身，不要填写网址或 OAuth 凭据').waitFor();
  await panel.locator('#youtube-api-key').fill(key);
  await save.click();
  await panel.getByText('已配置，等待检测连接', { exact: true }).waitFor();
  assert.equal(await panel.locator('#youtube-api-key').inputValue(), '');
  assert.equal(calls.some(v => v.verify && v.action === 'server_youtube_status'), false);
  await check.click();
  await panel.getByText('YouTube 连接正常', { exact: true }).waitFor();
  assert.equal(calls.filter(v => v.verify && v.action === 'server_youtube_status').length, 1);
  await page.reload();
  await panel.getByText('上次检测已连接', { exact: true }).waitFor();
  assert.equal(await panel.locator('#youtube-api-key').inputValue(), '');
  assert.ok(!(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).includes(key));
  failure = true;
  await check.click();
  await panel.getByText('YouTube 每日配额已用完', { exact: true }).waitFor();
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: '../.artifacts/youtube-settings-qa.png' });
  assert.deepEqual(errors, []);
  console.log('YouTube settings UI passed: validation, save, single check, persisted status, no browser key storage, quota feedback.');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { summarizeSocial } from '../server/keyword-trends-domain.mjs';

const base = resolve('.artifacts/web-dist'),
  calls = [],
  errors = [];
const end = Date.parse('2026-10-21T00:00:00Z');
const points = (n) =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - i) * 86_400_000).toISOString().slice(0, 10),
    value: i < n / 2 ? 40 : 60,
  }));
const words = ['synthetic creatine gummies', 'synthetic magnesium'].map(
  (term, i) => ({
    id: `qa-trend-${i}`,
    term,
    termZh: '合成关键词',
    market: 'US',
    category: '运动营养',
    source: '用户种子词',
    growth: null,
    series: [40, 60],
    favorite: false,
    productIds: [],
    siteIds: [],
    reviewStatus: 'selected',
    dataNature: 'collected',
    collectedAt: '2026-10-21T02:00:00Z',
    trendDailyPoints: points(80),
    trendDailyCollectedAt: '2026-10-21T02:00:00Z',
    trendHistoryPoints: points(740),
    trendHistoryResolution: 'day',
    trendHistoryCollectedAt: '2026-10-21T02:00:00Z',
  }),
);
const archive = [];
for (
  let at = Date.parse('2025-10-20T16:00:00Z');
  at < end - 8 * 3_600_000;
  at += 86_400_000
)
  for (let n = 0; n < (at >= Date.parse('2026-07-20T16:00:00Z') ? 2 : 1); n++)
    archive.push({
      id: `${at}-${n}`,
      publishedAt: new Date(at + 3_600_000).toISOString(),
    });
const summaries = ['tiktok', 'instagram', 'facebook'].map((source) =>
  summarizeSocial({
    keywordId: words[0].id,
    term: words[0].term,
    market: 'US',
    source,
    comparisonVersion: 2,
    at: '2026-10-21T02:00:00Z',
    anchorAt: '2026-10-21T02:00:00Z',
    coverage: '合成接口样本；不代表全站搜索量',
    items: source === 'facebook' ? [] : archive,
    history:
      source === 'instagram'
        ? {
            exhausted: false,
            chronological: false,
            stopReason: 'INS接口最多11页',
          }
        : { exhausted: true },
  }),
);
summaries.push({
  ...summaries[0],
  keywordId: words[1].id,
  term: words[1].term,
  comparisonVersion: 1,
  metric: 'playback_snapshot',
  periods: summaries[0].periods.map((p) => ({ ...p, change: 999 })),
});
let plan = {
  comparisonVersion: 2,
  enabled: false,
  time: '09:00',
  sources: ['google', 'tiktok', 'instagram', 'facebook'],
  markets: ['US', 'MX', 'VN'],
  maxRequests: 100,
  maxPages: 11,
};
let failSnapshot = false,
  role = 'admin';
const server = createServer(async (req, res) => {
  if (req.url === '/api') {
    let body = '';
    for await (const c of req) body += c;
    const v = JSON.parse(body);
    calls.push(v);
    let data = {};
    if (v.action === 'auth_status')
      data = {
        setupRequired: false,
        user: { id: 'qa', username: 'qa', role, displayName: '合成测试' },
      };
    if (v.action === 'public_branding')
      data = { appName: '四平台趋势合成验收' };
    if (v.action === 'server_snapshot') data = { keywords: words, tasks: [] };
    if (v.action === 'server_workspace_snapshot') data = { entries: [] };
    if (v.action === 'server_workspace_delta')
      data = {
        business: { entries: [] },
        keywords: words,
        tasks: [],
        revisions: {},
      };
    if (v.action === 'server_keyword_trends_snapshot') {
      if (failSnapshot) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '合成读取失败' }));
        return;
      }
      data = { plan, summaries, run: null };
    }
    if (v.action === 'server_keyword_trends_save') {
      plan = { ...v.plan };
      delete plan.budgetAcknowledged;
      data = { plan };
    }
    if (v.action === 'server_keyword_trends_collect')
      data = { accepted: 4, reused: 0, day: '2026-10-21' };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(data));
    return;
  }
  const path = resolve(
    base,
    decodeURIComponent((req.url || '/').split('?')[0])
      .replace(/^\/admin\/?/, '')
      .replace(/^\//, ''),
  );
  if (path !== base && !path.startsWith(`${base}${sep}`))
    return res.writeHead(403).end();
  try {
    res.setHeader(
      'content-type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
      }[extname(path)] || 'application/octet-stream',
    );
    res.end(await readFile(path));
  } catch {
    res.setHeader('content-type', 'text/html');
    res.end(await readFile(resolve(base, 'index.html')));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) =>
  new URL(r.request().url()).origin === url ? r.continue() : r.abort(),
);
try {
  await page.goto(`${url}/admin/research`);
  await page.getByText(words[0].term, { exact: true }).first().waitFor();
  for (const title of ['谷歌趋势', 'TK趋势', 'INS趋势', 'FB趋势'])
    await page
      .getByRole('columnheader', { name: title, exact: true })
      .waitFor();
  assert.ok(
    (
      await page.locator('.keyword-trend-comparison').first().innerText()
    ).includes('近3个月'),
  );
  assert.ok(
    (await page.locator('.social-trend-cell').first().innerText()).includes(
      '4条(0%)',
    ),
  );
  assert.ok(
    (await page.locator('.social-trend-cell').nth(2).innerText()).includes(
      '0条',
    ),
  );
  assert.ok(
    (await page.locator('.social-trend-cell').nth(4).innerText()).includes(
      '待回查',
    ),
  );
  const firstCell = await page
    .locator('.social-trend-cell')
    .first()
    .innerText();
  assert.ok(firstCell.includes('184条(+100%)'));
  assert.ok(firstCell.includes('275条(+50.3%)'));
  assert.ok(
    (await page.locator('.social-trend-cell').nth(1).innerText()).includes(
      '历史不足',
    ),
  );
  assert.ok(
    (await page.locator('.social-trend-cell').nth(3).innerText()).includes(
      '需回查',
    ),
  );
  assert.ok(
    !(await page.locator('.ant-table-tbody').innerText()).includes('待积累'),
  );
  assert.ok(
    !(await page.locator('.ant-table-tbody').innerText()).includes('+999%'),
  );
  await page.locator('.ant-table-content').evaluate((el) => {
    el.scrollLeft = 330;
  });
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({
    path: '.artifacts/keyword-trends-research.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: '趋势采集 / 每日监测', exact: true })
    .click();
  let modal = page.getByRole('dialog');
  assert.equal(
    await modal
      .getByRole('button', { name: '采集勾选关键词（0）', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await modal.getByRole('switch').getAttribute('aria-checked'),
    'false',
  );
  await modal.locator('.ant-modal-close').click();
  await modal.waitFor({ state: 'hidden' });
  await page.locator('.ant-table-tbody input[type="checkbox"]').first().check();
  await page
    .getByRole('button', { name: '趋势采集 / 每日监测', exact: true })
    .click();
  modal = page.getByRole('dialog');
  await modal.getByRole('checkbox').check();
  await modal
    .getByRole('button', { name: '采集勾选关键词（1）', exact: true })
    .click();
  const submitted = calls.find(
    (v) => v.action === 'server_keyword_trends_collect',
  );
  assert.deepEqual(submitted.keywordIds, [words[0].id]);
  assert.deepEqual(submitted.plan.sources, [
    'google',
    'tiktok',
    'instagram',
    'facebook',
  ]);
  assert.equal(submitted.plan.maxRequests, 100);
  assert.equal(submitted.plan.maxPages, 11);
  assert.equal(submitted.plan.comparisonVersion, 2);
  assert.equal(submitted.budgetAcknowledged, true);
  await modal.getByRole('switch').click();
  await modal.locator('input[type="time"]').fill('14:20');
  await modal
    .getByRole('button', { name: '保存每日计划', exact: true })
    .click();
  await page
    .getByText('已保存入选关键词每日趋势计划', { exact: true })
    .waitFor();
  assert.equal(
    calls.find((v) => v.action === 'server_keyword_trends_save').plan.time,
    '14:20',
  );
  await modal.screenshot({ path: '.artifacts/keyword-trends-plan.png' });
  failSnapshot = true;
  await modal.getByRole('button', { name: '刷新结果', exact: true }).click();
  await modal.getByText('合成读取失败', { exact: true }).waitFor();
  assert.ok(
    (await page.locator('.social-trend-cell').first().innerText()).includes(
      '4条(0%)',
    ),
  );
  failSnapshot = false;
  await modal.locator('.ant-modal-close').click();
  await page.goto(`${url}/admin/selected-keywords`);
  await page.getByText(words[0].term, { exact: true }).first().waitFor();
  for (const title of ['谷歌趋势', 'TK趋势', 'INS趋势', 'FB趋势'])
    await page
      .getByRole('columnheader', { name: title, exact: true })
      .waitFor();
  await page.screenshot({
    path: '.artifacts/keyword-trends-selected.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: '.artifacts/keyword-trends-mobile.png',
    fullPage: true,
  });
  role = 'researcher';
  await page.reload();
  await page
    .getByRole('button', { name: '趋势采集 / 每日监测', exact: true })
    .click();
  modal = page.getByRole('dialog');
  assert.equal(await modal.getByRole('switch').isDisabled(), true);
  assert.equal(
    await modal
      .getByRole('button', { name: '保存每日计划', exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'UI QA passed: four columns and four periods on both lists; immediate historical comparisons; partial history and zero/missing data; old playback percentages hidden; complete selection and source/budget payload; pause/time settings; failed reads preserve data; mobile bounds; researcher read-only; zero page errors.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

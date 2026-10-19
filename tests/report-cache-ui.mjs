import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = resolve('apps/web-antd/dist'),
  actions = [];
const site = {
  id: 'ui-site',
  brand: '仅本地界面测试',
  domain: 'example.com',
  market: 'US',
  keyword: 'creatine gummies',
  platform: 'Shopify',
  category: '运动营养',
  mainProducts: ['Creatine gummies'],
  ownershipBackground: '待核验',
  ownershipOperations: '',
  ownershipEvidence: '',
  ownershipSource: '',
  type: '独立电商',
  dataNature: 'collected',
};
const ad = {
  id: 'ui-ad',
  archiveId: '123',
  pageId: '456',
  brand: '仅本地界面测试',
  market: 'US',
  platform: 'Meta',
  headline: 'Creatine gummies',
  copy: 'QA sample: save 20%, buy creatine gummies',
  format: 'IMAGE',
  status: '投放中',
  keywordIds: ['ui-keyword'],
  siteIds: [site.id],
  evidenceUrl: 'https://www.facebook.com/ads/library/?id=123',
};
const evidence = {
  id: 'e1',
  text: '仅本地界面测试：How much sugar? Price is expensive.',
  url: 'https://www.reddit.com/r/Supplements/comments/abc/topic/',
  platform: 'Reddit',
  kind: 'comment',
  market: 'US',
};
const report = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '仅本地界面测试 · 消费者需求',
  kind: 'consumer_research',
  market: 'US',
  createdAt: new Date().toISOString(),
  status: 'completed',
  evidenceIds: ['e1'],
  statistics: {
    method: '界面测试样本，不是真实业务结论',
    sampleSize: 1,
    sourceCount: 1,
    confidence: '低',
    limitations: ['仅本地测试'],
    themes: [
      {
        key: 'formula',
        label: '配方与剂量疑问',
        count: 1,
        sourceCount: 1,
        evidenceIds: ['e1'],
        suggestion: '核对官网标签',
      },
    ],
  },
};
report.revision = 1;
const adReport = {
  ...report,
  id: '00000000-0000-4000-8000-000000000002',
  title: '仅本地测试广告报告',
  kind: 'ad_analysis',
  reportType: 'ad',
};
let failDetails = false;
const server = createServer(async (req, res) => {
  if (req.url === '/api') {
    let body = '';
    for await (const c of req) body += c;
    const input = JSON.parse(body);
    actions.push(input);
    let result = {};
    if (input.action === 'public_branding')
      result = { appName: '本地交互验收', logo: '/admin/hci-logo.svg' };
    if (input.action === 'auth_status')
      result = {
        setupRequired: false,
        user: {
          id: 'ui',
          username: 'ui',
          role: 'admin',
          displayName: '仅本地测试',
        },
      };
    if (input.action === 'server_workspace_snapshot')
      result = {
        entries: [
          { key: 'sites:ui-site', value: site },
          { key: 'ads:ui-ad', value: ad },
          { key: 'insightReports:' + report.id, value: report },
          { key: 'researchEvidence:e1', value: evidence },
        ],
      };
    if (input.action === 'server_snapshot')
      result = {
        keywords: [
          {
            id: 'ui-keyword',
            term: 'creatine gummies',
            market: 'US',
            category: '运动营养',
            source: '本地测试',
            growth: null,
            series: [],
            favorite: false,
            productIds: [],
            siteIds: [site.id],
            reviewStatus: 'selected',
          },
        ],
        tasks: [],
        generatedAt: new Date().toISOString(),
      };
    if (input.action === 'server_insight_snapshot')
      result = {
        reports: input.kind === 'ad' ? [adReport] : [report],
        total: 1,
      };
    if (input.action === 'server_insight_details') {
      await new Promise((r) => setTimeout(r, 250));
      if (failDetails) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '本地模拟读取失败' }));
        return;
      }
      result = {
        report: input.reportId === adReport.id ? adReport : report,
        evidence: [evidence],
      };
    }
    if (input.action === 'server_review_insight') {
      const target = input.reportId === adReport.id ? adReport : report;
      Object.assign(target, {
        reviewStatus: input.status,
        reviewNote: input.note,
        revision: target.revision + 1,
      });
      result = { saved: true, report: target };
    }
    if (
      input.action === 'server_workspace_sync' &&
      input.entries.some((e) =>
        /^(insightReports|researchEvidence):/.test(e.key),
      )
    ) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '业务记录格式不正确' }));
      return;
    }

    if (input.action === 'server_analysis_status')
      result = { configured: false };
    if (input.action === 'server_ads_status')
      result = { configured: false, message: '尚未配置' };
    if (input.action === 'server_semrush_status')
      result = { configured: false };
    if (
      input.action === 'server_submit_insight' ||
      input.action === 'server_submit_products'
    )
      result = { jobId: '00000000-0000-4000-8000-000000000099', tasks: [] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
    return;
  }
  let file = resolve(
    base,
    decodeURIComponent(req.url.split('?')[0])
      .replace(/^\/admin\/?/, '')
      .replace(/^\//, ''),
  );
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      'content-type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
      }[extname(file)] || 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.setHeader('content-type', 'text/html');
    res.end(await readFile(resolve(base, 'index.html')));
  }
});
await new Promise((r) => server.listen(5697, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, channel: 'chrome' }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('503')) errors.push(m.text());
});
page.on('requestfailed', (r) => console.log('NETWORK', r.url(), r.failure()));
try {
  const count = (id = report.id) =>
    actions.filter(
      (a) => a.action === 'server_insight_details' && a.reportId === id,
    ).length;
  const drawer = page.locator('.ant-drawer-open');
  const close = async () => {
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
  };
  const openConsumer = async () => {
    await page
      .getByRole('button', { name: '查看报告', exact: true })
      .last()
      .click();
    await drawer.locator('.report-document').waitFor();
  };
  await page.goto(
    'http://127.0.0.1:5697/admin/consumer-insights?report=' + report.id,
  );
  await drawer.locator('.report-document').waitFor();
  assert.equal(count(), 1);
  await close();
  assert.ok(!new URL(page.url()).searchParams.has('report'));
  await openConsumer();
  assert.equal(count(), 1, 'reopening uses saved report and evidence');
  await drawer
    .getByPlaceholder('记录采纳原因、待验证假设或排除原因')
    .fill('本地验收审阅意见');
  await drawer.locator('.report-appendix summary').click();
  await drawer.getByRole('button', { name: '刷新报告', exact: true }).click();
  assert.equal(
    await drawer.locator('.report-document').count(),
    1,
    'refresh keeps document visible',
  );
  await page.waitForFunction(
    () => !document.querySelector('.ant-drawer .ant-btn-loading'),
  );
  assert.equal(count(), 2);
  assert.equal(
    await drawer
      .getByPlaceholder('记录采纳原因、待验证假设或排除原因')
      .inputValue(),
    '本地验收审阅意见',
  );
  assert.equal(
    await drawer.locator('.report-appendix').getAttribute('open'),
    '',
  );
  await drawer.getByRole('button', { name: '标为入选', exact: true }).click();
  await page.getByText('审阅状态已保存', { exact: true }).waitFor();
  assert.equal(
    count(),
    2,
    'saving review updates metadata without reloading evidence',
  );
  await close();
  await openConsumer();
  assert.equal(count(), 2);
  assert.equal(
    await drawer
      .getByPlaceholder('记录采纳原因、待验证假设或排除原因')
      .inputValue(),
    '本地验收审阅意见',
  );
  failDetails = true;
  await drawer.getByRole('button', { name: '刷新报告', exact: true }).click();
  await page.getByText('本地模拟读取失败', { exact: true }).waitFor();
  assert.equal(await drawer.locator('.report-document').count(), 1);
  failDetails = false;
  await close();
  await page.getByText('商品情报库', { exact: true }).first().click();
  await page.waitForURL('**/products');
  await page.getByText('消费者需求洞察', { exact: true }).first().click();
  await page.waitForURL('**/consumer-insights');
  await openConsumer();
  assert.equal(
    count(),
    3,
    'route navigation preserves detail cache after failed refresh',
  );
  await close();
  report.revision++;
  report.title = '已更新的本地报告';
  await page
    .getByRole('button', { name: /^刷\s*新$/ })
    .last()
    .click();
  await page.getByText(report.title, { exact: true }).waitFor();
  await openConsumer();
  assert.equal(count(), 4, 'new server revision reloads report exactly once');
  await close();
  await page.getByText('广告观察', { exact: true }).first().click();
  await page.waitForURL('**/ads');
  await page.getByRole('button', { name: adReport.title, exact: true }).click();
  await drawer.locator('.report-document').waitFor();
  assert.equal(count(adReport.id), 1);
  await close();
  await page.getByRole('button', { name: adReport.title, exact: true }).click();
  await drawer.locator('.report-document').waitFor();
  assert.equal(count(adReport.id), 1);
  await page.waitForFunction(() => !document.querySelector('#__app-loading__'));
  await page.screenshot({
    path: '../.artifacts/report-cache-20261019.png',
    fullPage: true,
    animations: 'disabled',
  });
  await close();
  // Change a real editable object, then wait for one scheduled workspace sync cycle.
  await page.getByText('商品情报库', { exact: true }).first().click();
  await page.waitForURL('**/products');
  await page.waitForTimeout(11000);
  assert.ok(
    !actions.some(
      (a) =>
        a.action === 'server_workspace_sync' &&
        a.entries.some((e) =>
          /^(insightReports|researchEvidence):/.test(e.key),
        ),
    ),
    'server evidence must never enter client deletion queue',
  );
  assert.equal(await page.getByText(/业务记录格式不正确/).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks: 12,
      consumerDetailRequests: count(),
      adDetailRequests: count(adReport.id),
      pageErrors: errors,
      cloudSyncSafe: true,
    }),
  );
} catch (e) {
  console.log(
    JSON.stringify({
      url: page.url(),
      body: (await page.locator('body').innerText()).slice(-4000),
      errors,
      actions: actions.map((a) => a.action),
    }),
  );
  await page.screenshot({
    path: '../.artifacts/report-cache-failure.png',
    fullPage: true,
    animations: 'disabled',
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

// Local synthetic browser acceptance. No external requests or real credentials.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { AI_PROMPTS, aiPromptSnapshot } from '../server/ai-prompt-defaults.mjs';
import { consumerTopics, insightSummary } from '../server/consumer-topics.mjs';
const base = resolve('apps/web-antd/dist'),
  actions = [];
const keywords = ['creatine gummies', 'magnesium gummies'].map((term, i) => ({
  id: `k${i + 1}`,
  term,
  market: 'US',
  category: '运动营养',
  source: 'synthetic',
  series: [],
  reviewStatus: 'selected',
  siteIds: [],
  productIds: [],
  growth: null,
  favorite: false,
}));
const evidence = [
  {
    id: 'e1',
    text: 'How much sugar is in one serving?',
    platform: 'Reddit',
    kind: 'comment',
    market: 'US',
    url: 'https://www.reddit.com/r/Supplements/comments/abc/topic/c1/',
    sourceUrl: 'https://www.reddit.com/r/Supplements/comments/abc/topic/',
    likes: 8,
  },
  {
    id: 'e2',
    text: 'The price is too expensive.',
    platform: 'Facebook',
    kind: 'comment',
    market: 'US',
    url: 'https://www.facebook.com/posts/123',
    sourceUrl: 'https://www.facebook.com/posts/123',
    likes: 3,
  },
];
const reports = keywords.map((k, i) => {
  const r = {
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    revision: 1,
    title: `${k.term} · 消费者洞察`,
    kind: 'consumer_research',
    reportType: 'consumer',
    market: 'US',
    createdAt: '2026-10-21T01:00:00Z',
    status: 'completed',
    keywordIds: [k.id],
    evidenceIds: [evidence[i].id],
    statistics: {
      method: '合成界面测试',
      sampleSize: 1,
      sourceCount: 1,
      confidence: '低',
      limitations: [],
      themes: [],
    },
    modelAnalysis: {
      model: 'synthetic-model',
      inputEvidenceCount: 1,
      summary: '仅本机模拟数据，消费者关注配方与购买成本。',
      findings: [
        {
          label: i === 0 ? '配方与剂量' : '价格与性价比',
          interpretation: i === 0 ? '关注每份含糖量和剂量。' : '关注每份成本。',
          suggestion:
            i === 0
              ? '核对每份剂量与标签，整理商品页FAQ。'
              : '比较每份有效用量价格，测试组合装。',
          evidenceIds: [evidence[i].id],
        },
      ],
    },
  };
  r.topicSummary = consumerTopics(r, [evidence[i]]);
  return r;
});
const prompts = Object.entries(AI_PROMPTS).map(([key, spec]) => ({
  ...spec,
  defaultText: spec.text,
  ...aiPromptSnapshot(key),
}));
let failedOnce = false;
const server = createServer(async (req, res) => {
  if (req.url === '/api') {
    let body = '';
    for await (const c of req) body += c;
    const input = JSON.parse(body);
    actions.push(input);
    let result = {};
    switch (input.action) {
      case 'public_branding':
        result = { appName: '消费者洞察本机验收', logo: '/admin/hci-logo.svg' };
        break;
      case 'auth_status':
        result = {
          setupRequired: false,
          user: {
            id: 'qa',
            username: 'qa',
            role: 'admin',
            displayName: '本机测试',
          },
        };
        break;
      case 'server_snapshot':
        result = { keywords, tasks: [], generatedAt: new Date().toISOString() };
        break;
      case 'server_workspace_delta':
        result = {
          keywords,
          tasks: [],
          business: { entries: [] },
          revisions: { keywords: 'qa', tasks: 'qa', business: 'qa' },
          generatedAt: new Date().toISOString(),
        };
        break;
      case 'server_workspace_snapshot':
        result = { entries: [] };
        break;
      case 'server_workspace_sync':
        result = { saved: true };
        break;
      case 'server_analysis_status':
        result = {
          configured: true,
          baseUrl: 'https://example.com/v1',
          model: 'synthetic-model',
          maxTokens: 2000,
        };
        break;
      case 'server_ads_status':
      case 'server_semrush_status':
        result = { configured: false };
        break;
      case 'server_insight_snapshot': {
        let list = reports;
        if (input.keywordId)
          list = list.filter((r) => r.keywordIds.includes(input.keywordId));
        if (input.topic)
          list = list.filter((r) =>
            r.topicSummary.some((t) => t.label === input.topic),
          );
        if (input.search)
          list = list.filter((r) => r.title.includes(input.search));
        result = {
          reports: list.map(insightSummary),
          total: list.length,
          topicOptions: ['配方与剂量', '价格与性价比'],
          keywordIds: ['k1', 'k2'],
        };
        break;
      }
      case 'server_insight_details': {
        const r = reports.find((r) => r.id === input.reportId);
        result = {
          report: r,
          evidence: evidence.filter((e) => r.evidenceIds.includes(e.id)),
        };
        break;
      }
      case 'server_submit_insight': {
        if (input.keywordIds?.[0] === 'k2' && !failedOnce) {
          failedOnce = true;
          res
            .writeHead(503, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: '合成提交中断' }));
          return;
        }
        result = { jobId: `qa-${input.keywordIds?.[0]}`, tasks: [] };
        break;
      }
      case 'server_ai_prompts':
        result = { prompts };
        break;
      case 'server_ai_prompt_save': {
        const p = prompts.find((p) => p.key === input.key);
        Object.assign(
          p,
          aiPromptSnapshot(input.key, { text: input.text, updatedBy: 'qa' }),
        );
        result = { prompts };
        break;
      }
    }
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
await mkdir('.artifacts', { recursive: true });
await new Promise((r) => server.listen(5698, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, channel: 'chrome' }),
  page = await browser.newPage({ viewport: { width: 1512, height: 1050 } }),
  errors = [];
await page.route('**/*', (route) =>
  new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue()
    : route.abort(),
);
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5698/admin/selected-keywords');
  await page.getByText('消费者重点话题 / 样本热度', { exact: true }).waitFor();
  await page.getByText('配方与剂量', { exact: true }).first().waitFor();
  const table = page.locator('.hci-resource-table');
  await table.locator('thead input[type=checkbox]').check();
  await page
    .getByRole('button', { name: '生成消费者洞察报告', exact: true })
    .click();
  const modal = page.locator('.ant-modal-content');
  await modal.getByRole('button', { name: '提交生成', exact: true }).click();
  await modal.getByText('合成提交中断', { exact: true }).waitFor();
  await modal
    .getByRole('button', { name: '重试未确认项', exact: true })
    .click();
  await modal.waitFor({ state: 'hidden' });
  const submits = actions.filter((a) => a.action === 'server_submit_insight');
  assert.equal(submits.length, 3);
  assert.equal(submits[0].keywordIds[0], 'k1');
  assert.equal(submits[1].requestId, submits[2].requestId);
  assert.equal(submits[0].autoComments, true);
  assert.equal(submits[0].analyze, true);
  await page.screenshot({
    path: resolve('.artifacts/consumer-keywords.png'),
    fullPage: true,
  });
  await page.goto('http://127.0.0.1:5698/admin/consumer-insights');
  await page
    .getByRole('button', { name: '查看报告', exact: true })
    .first()
    .waitFor();
  await page.locator('.insight-toolbar .ant-select').nth(0).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('magnesium gummies', { exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length ===
      1,
  );
  assert.equal(
    await page.getByRole('button', { name: '查看报告', exact: true }).count(),
    1,
  );
  await page.locator('.insight-toolbar .ant-select').nth(1).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('价格与性价比', { exact: true })
    .click();
  await page.waitForTimeout(400);
  assert.ok(
    actions.some(
      (a) =>
        a.action === 'server_insight_snapshot' &&
        a.keywordId === 'k2' &&
        a.topic === '价格与性价比',
    ),
  );
  await page.screenshot({
    path: resolve('.artifacts/consumer-list.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await page
    .getByRole('heading', { name: '话题方向与热度', exact: true })
    .waitFor();
  assert.ok(page.url().includes('/consumer-insights/reports/'));
  assert.equal(await page.locator('.ant-drawer-open').count(), 0);
  await page.getByRole('button', { name: '筛原文', exact: true }).click();
  await page
    .getByText('The price is too expensive.', { exact: true })
    .waitFor();
  await page.screenshot({
    path: resolve('.artifacts/consumer-report.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: resolve('.artifacts/consumer-report-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.goto('http://127.0.0.1:5698/admin/ai-config');
  await page
    .getByRole('button', { name: '编辑提示词', exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: '编辑提示词', exact: true }).count(),
    4,
  );
  await page
    .getByRole('button', { name: '编辑提示词', exact: true })
    .first()
    .click();
  await page
    .getByRole('textbox', { name: 'AI提示词', exact: true })
    .fill(
      '关注消费者对口感、配方剂量和购买顾虑的讨论，每个方向给出简洁且可验证的保健品业务建议。',
    );
  await modal.getByRole('button', { name: '保存提示词', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.ok(
    actions.some(
      (a) =>
        a.action === 'server_ai_prompt_save' &&
        a.key === 'consumer_report' &&
        a.version,
    ),
  );
  await page.screenshot({
    path: resolve('.artifacts/consumer-ai-config.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Browser acceptance passed: keyword summaries, 2-keyword batch/retry UUID, keyword+topic filters, standalone report/evidence table, mobile overflow and four prompt settings.',
  );
} catch (error) {
  await page.screenshot({
    path: resolve('.artifacts/consumer-ui-failure.png'),
    fullPage: true,
  });
  console.error(
    'QA STATE',
    await page.locator('main').last().innerText(),
    actions.filter((a) => /insight|snapshot/.test(a.action)),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

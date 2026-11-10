/* oxlint-disable vitest/no-import-node-test -- Browser integration uses Node's test runner. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

test('ingredient page shows weekly scope, gaps and original evidence; settings save daily and weekly separately', async () => {
  const root = resolve(import.meta.dirname, '..'),
    fixture = resolve(root, '.artifacts/ingredient-browser');
  await mkdir(fixture, { recursive: true });
  const path = root.replaceAll('\\', '/');
  await writeFile(
    resolve(fixture, 'index.html'),
    `<div id="app"></div><script type="module">import {createApp} from 'vue';import App from '/@fs/${path}/apps/web-antd/src/views/intelligence/ingredient-research.vue';import '/@fs/${path}/apps/web-antd/src/views/intelligence/intelligence.css';import '/@fs/${path}/apps/web-antd/node_modules/ant-design-vue/dist/reset.css';window.calls=[];createApp(App).mount('#app');</script>`,
  );
  const finding = {
    id: 'f1',
    market: 'US',
    name: 'Creatine',
    summary: '合成示例：同时保留正面体验与负面反馈。',
    firstSeenAt: '2026-11-09T01:00:00Z',
    lastSeenAt: '2026-11-10T01:00:00Z',
    firstSeenInSystem: true,
    mentionCount: 2,
    platforms: ['Reddit'],
    current: { postCount: 1, commentCount: 1, authorCount: 2, mentionCount: 2 },
    observedChange: null,
    mentions: [
      {
        id: 'c1',
        type: 'comment',
        community: 'Supplements',
        quote: 'Creatine made me feel unwell',
        publishedAt: '2026-11-09T01:00:00Z',
        url: 'https://www.reddit.com/r/Supplements/comments/abc/post/c1/',
      },
    ],
  };
  const response = {
    reports: [
      {
        id: 'r1',
        market: 'US',
        asOf: '2026-11-10T01:00:00Z',
        generatedAt: '2026-11-10T02:00:00Z',
        window: { start: '2026-11-03T01:00:00Z', end: '2026-11-10T01:00:00Z' },
        findings: [finding],
        recordCount: 20,
        omittedRecords: 0,
        comparisonReady: false,
        postCoverageReady: true,
        communities: ['Supplements'],
        commentCoverage: [
          {
            postId: 'abc',
            reported: 3,
            unique: 2,
            pending: 0,
            countsMatch: false,
          },
        ],
      },
    ],
    coverage: [
      {
        community: 'Supplements',
        coveredThrough: '2026-11-10T01:00:00Z',
        partial: false,
      },
    ],
    stats: {
      posts: 12,
      comments: 20,
      bodyPresent: 10,
      commentPartialPosts: 1,
      communities: ['Supplements'],
    },
  };
  const mocks = {
    './components/PageHeader.vue': `import {h} from 'vue';export default {props:['title'],setup:(props,{slots})=>()=>h('header',[h('h1',props.title),slots.default?.()])};`,
    './data': `export const state={market:'US'};`,
    '../data': `export const state={market:'US'};`,
    '../session': `export const serverMode=true;export const session={user:{role:'admin'}};`,
    'vue-router': `export const useRouter=()=>({push:async()=>{}});`,
    './cloud-workspace': `export async function cloudRequest(action,input){window.calls.push({action,input});if(action==='server_discovery_snapshot')return {plans:[],ingredients:${JSON.stringify([finding])}};if(action==='server_discovery_trend_snapshot')return ${JSON.stringify(response)};throw Error(action);}`,
    '../cloud-workspace': `export async function cloudRequest(action,input){window.calls.push({action,input});if(action==='server_discovery_save')return {plan:input.plan};throw Error(action);}`,
  };
  const server = await createServer({
    configFile: false,
    root: fixture,
    cacheDir: resolve(fixture, 'cache'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [
      {
        name: 'isolated-ingredient-ui',
        enforce: 'pre',
        resolveId(id, importer) {
          if (mocks[id] && importer?.includes('/views/intelligence/'))
            return `\0ingredient-fixture:${  id  }.js`;
        },
        load(id) {
          if (id.startsWith('\0ingredient-fixture:'))
            return mocks[id.slice(20, -3)];
        },
      },
      vue(),
    ],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page
      .getByRole('heading', { name: '成分风向', exact: true })
      .waitFor();
    await page.getByText('Creatine', { exact: true }).waitFor();
    await page.getByText('待积累', { exact: true }).waitFor();
    assert.match(await page.locator('main').innerText(), /评论存在缺口/);
    assert.match(await page.locator('main').innerText(), /历史基线不足/);
    await page.getByRole('button', { name: /原\s*文/ }).click();
    await page
      .getByText('Creatine made me feel unwell', { exact: true })
      .waitFor();
    const evidence = page.locator('.ant-drawer a');
    assert.match(await evidence.getAttribute('href'), /reddit\.com/);
    await page.screenshot({
      path: resolve(fixture, 'evidence.png'),
      fullPage: true,
    });
    await page.locator('.ant-drawer-close').click();
    await page
      .getByRole('button', { name: '采集与分析设置', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    assert.equal(
      await dialog.locator('textarea').first().inputValue(),
      'Supplements\nNootropics\nBiohackers',
    );
    assert.match(await dialog.innerText(), /每周分析日期/);
    await dialog.getByRole('button', { name: '保存监控', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() =>
      window.calls.find((c) => c.action === 'server_discovery_save'),
    );
    assert.equal(saved.input.plan.sourceMode, 'ingredient_trends');
    assert.equal(saved.input.plan.maxRequests, 60);
    assert.equal(saved.input.plan.maxCommentRequests, 30);
    assert.equal(saved.input.plan.frequency, 'daily');
    assert.equal(saved.input.plan.analysisWeekday, 1);
    await page.screenshot({
      path: resolve(fixture, 'desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: resolve(fixture, 'mobile.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await writeFile(
      resolve(fixture, 'result.json'),
      JSON.stringify(
        {
          pageErrors: errors,
          save: saved.input.plan,
          checked: [
            'coverage',
            'baseline',
            'quotes',
            'default-communities',
            'daily-weekly-save',
            'mobile-overflow',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

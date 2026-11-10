/* oxlint-disable vitest/no-import-node-test -- Server browser tests run with the native Node test runner. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { healthCategoryKey, healthCategoryWork, futureHealthPlan } from './health-category-domain.mjs';
import { taskOverview } from './task-overview.mjs';

test('list, card and detail views show fixed category scope and unclipped product results', async () => {
  const root = resolve(import.meta.dirname, '..');
  const fixture = resolve(root, '.artifacts/progress-browser');
  await mkdir(fixture, { recursive: true });
  const plan = futureHealthPlan({ kind: 'regular_new', market: 'US', channels: ['amazon', 'tiktok'] });
  const work = healthCategoryWork(plan);
  const checkpoint = {
    healthCoverage: Object.fromEntries(work.map((w, i) => [healthCategoryKey(w), { firstPage: i < 29 ? 'done' : 'pending', pages: i < 29 ? 1 : 0 }])),
    work: work.slice(29), pending: [{}, {}, {}, {}], products: 1, healthReviewCount: 1, sourceRows: 6,
  };
  const job = { input: { kind: 'discovery_monitor', plan }, checkpoint, status: 'running' };
  const overview = taskOverview(job, {});
  const task = { id: 'synthetic-progress', cloudJobId: 'synthetic-progress', title: '常规新品发现', market: 'US', markets: ['US'], taskIds: ['synthetic-progress'], status: 'running', created: '2026-11-10T06:20:00Z', steps: [], overview };
  Object.values(checkpoint.healthCoverage).forEach(c => Object.assign(c, { firstPage: 'done', pages: 1 }));
  checkpoint.work = [{ ...work[0], page: 2 }];
  const fullFirstPageOverview = taskOverview(job, {});
  const components = `${root.replaceAll('\\', '/')}/apps/web-antd/src/views/intelligence/components`;
  await writeFile(resolve(fixture, 'index.html'), `
    <style>body{font:14px system-ui;margin:20px;color:#25323b}*{box-sizing:border-box}h1{font-size:20px}aside{margin:32px auto;max-width:850px}.preview-title{margin:20px 0}button{cursor:pointer}</style>
    <div id="app"></div><script type="module">
      import {createApp,h,reactive} from 'vue';
      import List from '/@fs/${components}/ResearchTaskList.vue';
      import Detail from '/@fs/${components}/TaskDetailPanel.vue';
      const task=reactive(${JSON.stringify(task)});
      window.showFullFirstPages=()=>{task.overview=${JSON.stringify(fullFirstPageOverview)}};
      window.retryClicks=0;
      window.showFailures=()=>{task.status='partial';task.overview.healthDiscovery.remainingWork=0;task.overview.healthDiscovery.issues=1;task.overview.healthDiscovery.products.pending=0;};
      createApp({render:()=>h('main',[
        h('h1',{class:'preview-title'},'新品采集进度'),h(List,{tasks:[task],retrying:'',onContinue:()=>window.retryClicks++}),
        h('aside',[h(Detail,{task})])
      ])}).mount('#app');
    </script>`);
  const mocks = {
    '../data': `import {reactive} from 'vue';export const state=reactive({market:'US'});export const marketName=()=> '美国';`,
    '../session': `export const serverMode=false;`,
    '../cloud-workspace': `export const cloudWorkspace={taskRevision:'synthetic'};`,
    '../task-page': `export async function fetchTaskPage(){throw Error('Network not allowed in fixture')}`,
    'vue-router': `export const useRouter=()=>({push(){}});`,
    './ProductDrawer.vue': `export default {render:()=>null};`,
    './TaskCollections.vue': `export default {render:()=>null};`,
    './TaskProgress.vue': `export default {render:()=>null};`,
  };
  const server = await createServer({
    configFile: false, root: fixture, cacheDir: resolve(fixture, 'cache'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [{
      name: 'synthetic-progress-only', enforce: 'pre',
      resolveId(id, importer) {
        if (mocks[id] && importer?.includes('/views/intelligence/')) return `\0progress:${id}`;
      },
      load(id) { if (id.startsWith('\0progress:')) return mocks[id.slice(10)]; },
    }, vue()],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const listResult = page.locator('.task-result-discovery');
    await listResult.waitFor();
    assert.match(await listResult.innerText(), /商品入库 1 · 排除 0 · 待确认 1 · 待处理 4/);
    assert.match(await page.locator('.task-progress-summary').innerText(), /类目首屏 29\/212/);
    assert.equal(await listResult.evaluate(e => getComputedStyle(e).webkitLineClamp), 'none');
    assert.equal(await listResult.evaluate(e => e.scrollHeight <= e.clientHeight + 1), true);
    await page.screenshot({ path: resolve(fixture, 'desktop.png'), fullPage: true });
    await page.evaluate(() => window.showFullFirstPages());
    await page.getByText('类目首屏 212/212 · 商品资料处理中', { exact: true }).first().waitFor();
    assert.match(await listResult.innerText(), /待翻页 1/);
    assert.equal(await page.getByText('本次采集目标完成', { exact: true }).count(), 0);
    await page.evaluate(() => window.showFailures());
    await page.getByRole('button',{name:'仅重试异常',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.retryClicks),1);
    await page.getByText('卡片', { exact: true }).click();
    await page.locator('.task-card').waitFor();
    assert.match(await page.locator('.task-card').innerText(), /仅重试异常/);
    await page.getByRole('button',{name:'仅重试异常',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.retryClicks),2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ant-progress-bg')].every(e => {
      const track = e.closest('.ant-progress-inner');
      return track && e.getBoundingClientRect().width >= track.getBoundingClientRect().width * 0.99;
    }));
    assert.equal(await listResult.evaluate(e => e.scrollHeight <= e.clientHeight + 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: resolve(fixture, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

test('US discovery categories, daily watch controls and honest trend display on desktop and mobile', async () => {
  const root = resolve(import.meta.dirname, '..');
  const fixture = resolve(root, '.artifacts/pool-browser');
  await mkdir(fixture, { recursive: true });
  const components = `${root.replaceAll('\\', '/')}/apps/web-antd/src/views/intelligence/components`;
  await writeFile(
    resolve(fixture, 'index.html'),
    `<style>body{font:14px system-ui;margin:16px}*{box-sizing:border-box}.hci-toolbar{display:flex;gap:8px;flex-wrap:wrap}.hci-subtle{color:#687385}p{overflow-wrap:anywhere}.hci-toolbar .ant-input{min-width:0;flex:1}</style><div id="app"></div><script type="module">import {createApp,h} from 'vue';import Discovery from '/@fs/${components}/DiscoveryPlanForm.vue';import Panel from '/@fs/${components}/ProductWatchPanel.vue';import History from '/@fs/${components}/ProductWatchHistory.vue';import Metric from '/@fs/${components}/EvidenceMetric.vue';window.calls=[];createApp({render:()=>h('main',[h(Metric,{metric:{key:'listingDate',label:'曝光日期（替代上架）',value:'2026-11-01',status:'available',reason:'未取得TikTok可靠上架日期，曝光日期不等于实际上架日期。',source:'Sorftime',market:'US',platform:'TikTok Shop',unit:'日期',period:'曝光日期（替代上架）',timezone:'来源时区',collectedAt:'2026-11-05',nature:'platform_display'}}),h('h2','新品池 · 采集设置'),h(Discovery,{kind:'regular_new',scheduled:true}),h(Panel),h('h2','持续观察趋势'),h(History,{productId:'synthetic'})])}).mount('#app');</script>`,
  );
  const mocks = {
    '../data': `import {reactive} from 'vue'; export const state=reactive({market:'US'});`,
    '../session': `export const serverMode=true;export const session={user:{role:'admin'}};`,
    'vue-router': `export const useRouter=()=>({push:async r=>{window.route=r}});`,
    '../cloud-workspace': `export async function cloudRequest(action,input){window.calls.push({action,input});
      if(action==='server_discovery_capabilities') return {channels:[{id:'amazon',name:'Amazon',markets:['US','MX']},{id:'tiktok',name:'TikTok Shop',markets:['US','VN']},{id:'shopee',name:'Shopee',markets:['VN']}],social:[]};
      if(action==='server_product_resource_categories')return {categories:[{id:'123',name:'Synthetic Vitamins',path:['123'],receiptId:'11111111-1111-4111-a111-111111111111',market:'US'}]};
      if(action==='server_discovery_save')return {plan:input.plan};
      if(action==='server_product_watch_config')return {config:{market:'US',enabled:false,time:'01:00'}};
      if(action==='server_product_watch_save')return {config:input};
      if(action==='server_product_watch_history')return {snapshots:[{day:'2026-11-03',at:'2026-11-03T01:00:00Z',price:20,currency:'USD',monthlySales:50,status:'completed'},{day:'2026-11-04',at:'2026-11-04T01:00:00Z',status:'failed',reason:'来源暂无数据'},{day:'2026-11-05',at:'2026-11-05T01:00:00Z',price:18,currency:'USD',monthlySales:60,status:'completed',changes:[{field:'title',before:'Old name',after:'New name'}]}],dailySales:[{date:'2026-11-03',value:3},{date:'2026-11-04',value:null},{date:'2026-11-05',value:4,partial:true}]};
      throw Error('unexpected '+action);
    }`,
  };
  const server = await createServer({
    configFile: false,
    root: fixture,
    cacheDir: resolve(fixture, 'cache'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [
      {
        name: 'mock-pool-ui',
        enforce: 'pre',
        resolveId(id, importer) {
          if (mocks[id] && importer?.includes('/views/intelligence/'))
            return `\0pool:${id}`;
        },
        load(id) {
          if (id.startsWith('\0pool:')) return mocks[id.slice(6)];
        },
      },
      vue(),
    ],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      executablePath:
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1000 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const dateButton=page.getByRole('button', {name:/曝光日期（替代上架）.*查看来源与口径/});
    assert.equal(await dateButton.locator('.date-help').textContent(), '?');
    await dateButton.click();
    await page.getByText('未取得TikTok可靠上架日期，曝光日期不等于实际上架日期。',{exact:true}).waitFor();
    await dateButton.click();
    await page
      .getByRole('button', { name: '获取Sorftime类目' })
      .first()
      .click();
    await page.locator('#source-category-amazon').click();
    await page.getByText('Synthetic Vitamins · 123', { exact: true }).click();
    await page
      .getByRole('button', { name: '保存监控', exact: true })
      .first()
      .click();
    await page.waitForFunction(() =>
      window.calls.some((c) => c.action === 'server_discovery_save'),
    );
    const saved = await page.evaluate(
      () =>
        window.calls.find((c) => c.action === 'server_discovery_save').input
          .plan,
    );
    assert.equal(saved.days, 7);
    assert.equal(saved.time, '00:00');
    assert.equal(saved.completeDays, true);
    assert.deepEqual(saved.channels, ['amazon', 'tiktok']);
    assert.equal(saved.categories.amazon[0].id, '123');
    await page.locator('.watch-panel').getByRole('switch').click();
    await page
      .locator('.watch-panel')
      .getByRole('button', { name: '保存监控' })
      .click();
    await page.waitForFunction(() =>
      window.calls.some(
        (c) => c.action === 'server_product_watch_save' && c.input.enabled,
      ),
    );
    await page.locator('#product-watch-metric').focus();
    await page.locator('#product-watch-metric').press('ArrowDown');
    await page.getByText('Sorftime每日销量', { exact: true }).click();
    assert.ok(await page.getByText('无数据', { exact: true }).count());
    assert.equal(
      await page.locator('svg[role="img"] line').count(),
      0,
      'missing date must break trend lines',
    );
    await page.screenshot({
      path: resolve(fixture, 'desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(fixture, 'mobile.png'),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    assert.ok(overflow < 4, `mobile overflow ${overflow}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

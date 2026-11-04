import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(
  process.env.DISCOVERY_TEST_PLAYWRIGHT_MODULE || 'playwright-core',
);
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

test('edited ingredient monitor immediately submits 5000 posts, closes the modal and navigates; failures remain visible', async () => {
  const root = resolve(import.meta.dirname, '..');
  const fixture = resolve(root, '.artifacts/discovery-form-browser');
  await mkdir(fixture, { recursive: true });
  const component = `${root.replaceAll('\\', '/')}/apps/web-antd/src/views/intelligence/components/DiscoveryMonitors.vue`;
  await writeFile(
    resolve(fixture, 'index.html'),
    `<div id="app"></div><script type="module">
    import {createApp} from 'vue'; import App from '/@fs/${component}';
    window.calls=[]; window.routes=[]; window.messages=[]; window.nextError='';
    createApp(App).mount('#app');</script>`,
  );
  const mocks = {
    '../data': `export const state={market:'US'};`,
    '../session': `export const serverMode=true; export const session={user:{role:'admin'}};`,
    'vue-router': `export const useRouter=()=>({push:async (route)=>{window.routes.push(route)}});`,
    '@vben/icons': `export const createIconifyIcon=()=>({render:()=>null});`,
    '../cloud-workspace': `
      const plan={id:'11111111-1111-4111-a111-111111111111',kind:'ingredients',market:'US',channels:['reddit','quora'],topics:['Synthetic supplement'],days:7,maxProducts:500,maxPages:3,maxDetails:0,enabled:true,frequency:'daily',time:'09:00',weekday:1,monthDay:1};
      export async function cloudRequest(action,input){window.calls.push({action,input});
        if(action==='server_discovery_snapshot')return {plans:[plan]};
        if(action==='server_discovery_capabilities')return {channels:[],social:[{id:'reddit',supported:true},{id:'quora',supported:true}]};
        if(action==='server_discovery_submit'){
          if(window.nextError)throw Error(window.nextError);
          await new Promise(resolve=>{window.completeSubmit=resolve});
          return {jobId:'22222222-2222-4222-a222-222222222222'};
        }
        if(action==='server_discovery_save')return {plan:input.plan};
        throw Error('Unexpected fixture action '+action);
      }
      export const syncCloudWorkspace=()=>new Promise(()=>{});`,
  };
  const server = await createServer({
    configFile: false,
    root: fixture,
    cacheDir: resolve(fixture, 'cache'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [
      {
        name: 'synthetic-discovery-modules',
        enforce: 'pre',
        resolveId(id, importer) {
          if (mocks[id] && importer?.includes('/views/intelligence/'))
            return `\0fixture:${id}`;
        },
        load(id) {
          if (id.startsWith('\0fixture:')) return mocks[id.slice(9)];
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
        process.env.DISCOVERY_TEST_BROWSER ||
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
    });
    const page = await browser.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(url);
    await page.getByRole('button', { name: /编\s*辑/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('spinbutton').first().fill('5000');
    await dialog
      .getByRole('button', { name: '按当前设置立即运行', exact: true })
      .click();
    await page.waitForFunction(
      () => typeof window.completeSubmit === 'function',
    );
    const runningButton = dialog
      .locator('button')
      .filter({ hasText: '按当前设置立即运行' });
    assert.match(await runningButton.getAttribute('class'), /ant-btn-loading/);
    await runningButton.click({ force: true });
    const submitted = await page.evaluate(() =>
      window.calls.filter((v) => v.action === 'server_discovery_submit'),
    );
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].input.plan.maxProducts, 5000);
    assert.equal(
      submitted[0].input.monitorId,
      '11111111-1111-4111-a111-111111111111',
    );
    await page.evaluate(() => window.completeSubmit());
    await page.waitForFunction(() => window.routes.length === 1);
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await page.evaluate(() => window.routes[0])).query.job,
      '22222222-2222-4222-a222-222222222222',
    );
    assert.equal(
      (
        await page.evaluate(() =>
          window.calls.filter((v) => v.action === 'server_discovery_save'),
        )
      ).length,
      0,
    );
    await page.getByRole('button', { name: /编\s*辑/ }).click();
    await page.evaluate(() => {
      window.nextError = 'Synthetic submit failure';
    });
    await dialog
      .getByRole('button', { name: '按当前设置立即运行', exact: true })
      .click();
    await dialog
      .getByText('Synthetic submit failure', { exact: true })
      .waitFor();
    assert.equal(await dialog.isVisible(), true);
    assert.equal((await page.evaluate(() => window.routes)).length, 1);
    await page.screenshot({
      path: resolve(fixture, 'failure-visible.png'),
      fullPage: true,
    });
    assert.deepEqual(failures, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

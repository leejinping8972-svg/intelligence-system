import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = '.artifacts/discovery-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  failed = [],
  requests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', async (response) => {
  if (response.url().endsWith('/api')) {
    requests.push(response.status());
    if (response.status() >= 400) failed.push(await response.text());
  }
});
const screenshot = async (name) => {
  await page.waitForTimeout(450);
  return page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
};
const item = (dialog, label) =>
  dialog.locator('.ant-form-item').filter({
    has: page.locator('label').filter({
      hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    }),
  });
async function choose(select, label) {
  await select.click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: label })
    .first()
    .click();
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'Document has horizontal overflow',
  );
}
try {
  await page.goto('http://127.0.0.1:4193/monitor');
  await page.getByRole('button', { name: '新建监控', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存监控', exact: true }).waitFor();
  assert.doesNotMatch(await dialog.innerText(), /调用总上限|请求上限/);
  await dialog.locator('textarea').fill('dietary supplements\nvitamins');
  await screenshot('fbm-desktop');
  await dialog.getByRole('button', { name: '保存监控', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: '新建监控', exact: true }).click();
  dialog = page.getByRole('dialog');
  await choose(dialog.locator('.ant-select').first(), '每周监控2');
  await item(dialog, '1688（中国货源） 来源站点')
    .waitFor()
    .catch(async () => {
      assert.match(await dialog.innerText(), /1688/);
    });
  assert.equal(
    await dialog
      .locator('.ant-select-selection-item')
      .filter({ hasText: /^Shopee$/ })
      .count(),
    1,
  );
  await screenshot('regular-six-channels');
  await dialog.getByRole('button', { name: '保存监控', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: /重点监控/ }).click();
  await page
    .getByRole('button', { name: /编\s*辑/ })
    .first()
    .waitFor();
  await page.reload();
  await page.getByRole('tab', { name: /重点监控/ }).click();
  assert.ok((await page.getByRole('button', { name: /编\s*辑/ }).count()) >= 2);
  await screenshot('monitor-saved');
  await page
    .getByRole('button', { name: /编\s*辑/ })
    .first()
    .click();
  dialog = page.getByRole('dialog');
  await item(dialog, '执行时间（北京时间）').locator('input').fill('10:30');
  await dialog.getByRole('button', { name: '保存监控', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page
    .locator('.ant-table-tbody')
    .filter({ hasText: '10:30' })
    .first()
    .waitFor();
  const firstSwitch = page
    .locator('.ant-table-tbody')
    .first()
    .getByRole('switch')
    .first();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith('/api') &&
        r.request().postDataJSON()?.action === 'server_discovery_snapshot',
    ),
    firstSwitch.click(),
  ]);

  await page.goto('http://127.0.0.1:4193/ingredient-research');
  await page.getByText('Urolithin A', { exact: true }).waitFor();
  await page.getByRole('button', { name: /原\s*文/ }).click();
  await page.locator('.ant-drawer:visible blockquote').waitFor();
  assert.match(
    await page.locator('.ant-drawer:visible').innerText(),
    /Urolithin A/,
  );
  await screenshot('ingredient-evidence-desktop');
  await page.locator('.ant-drawer:visible .ant-drawer-close').click();
  await page.getByRole('button', { name: '研究设置', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .locator('textarea')
    .fill('new supplement ingredients\nurolithin A');
  await choose(item(dialog, '讨论时间范围').locator('.ant-select'), '近30天');
  await choose(item(dialog, '定时周期').locator('.ant-select'), '每月');
  await item(dialog, '每月日期').locator('input').fill('15');
  await screenshot('ingredient-monthly-settings');
  await dialog.getByRole('button', { name: '保存监控', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.goto('http://127.0.0.1:4193/products');
  await page
    .getByRole('button', { name: '从平台获取商品', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /新上架/ }).click();
  assert.doesNotMatch(await dialog.innerText(), /调用总上限|请求上限/);
  await choose(item(dialog, '上架时间').locator('.ant-select'), '近90天');
  await screenshot('manual-new-listings');
  await dialog
    .getByRole('button', { name: '抓取新上架商品', exact: true })
    .click();
  await page.waitForURL('**/monitor?*');
  await page.getByText('云端 · 常规新品', { exact: false }).first().waitFor();
  await screenshot('submitted-task');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4193/ingredient-research');
  await page.getByText('Urolithin A', { exact: true }).waitFor();
  await noOverflow();
  await screenshot('ingredient-mobile');
  await page.getByRole('button', { name: /原\s*文/ }).click();
  await page.locator('.ant-drawer:visible blockquote').waitFor();
  assert.ok(
    await page
      .locator('.ant-drawer-content-wrapper')
      .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
  );
  await screenshot('ingredient-evidence-mobile');
  await page.locator('.ant-drawer:visible .ant-drawer-close').click();
  await page.goto('http://127.0.0.1:4193/monitor');
  await page.getByRole('button', { name: '新建监控', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '保存监控', exact: true })
    .waitFor();
  await noOverflow();
  await screenshot('new-monitor-mobile');

  const response = await fetch('http://127.0.0.1:5400', {
    method: 'POST',
    body: JSON.stringify({ action: 'server_discovery_snapshot' }),
  });
  const snapshot = await response.json();
  assert.ok(
    snapshot.plans.some(
      (p) =>
        p.kind === 'regular_new' &&
        p.channels.length === 6 &&
        p.sourceMarkets.shopee === 'VN',
    ),
  );
  assert.ok(
    snapshot.plans.some(
      (p) =>
        p.kind === 'ingredients' &&
        p.frequency === 'monthly' &&
        p.monthDay === 15 &&
        p.days === 30,
    ),
  );
  assert.ok(
    snapshot.plans.some((p) => p.kind === 'fbm_new' && p.topics.length === 2),
  );
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        errors,
        failed,
        apiRequests: requests.length,
        plans: snapshot.plans.length,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
  console.log(
    'Discovery UI workflows passed: monitor save/reload/edit/toggle, six channels, ingredient citations and monthly settings, manual 90-day task, 1440/390px.',
  );
} finally {
  await writeFile(
    `${output}/last-state.txt`,
    await page.locator('body').innerText(),
  );
  await browser.close();
}

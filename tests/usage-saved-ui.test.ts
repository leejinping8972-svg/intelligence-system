import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  adminRequest: request,
  session: { user: { role: 'admin' } },
}));
vi.mock('ant-design-vue', () => {
  const text = defineComponent({
    props: ['message', 'description'],
    setup: (props, { slots }) => () => h('div', [props.message, props.description, slots.default?.()]),
  });
  const button = defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) });
  const form = Object.assign(text, { Item: text });
  const input = Object.assign(text, { Password: text });
  return {
    Alert: text, Button: button, Checkbox: text, DatePicker: text, Empty: text,
    Form: form, Input: input, InputNumber: text, Modal: text, Pagination: text,
    Progress: text, Select: text, Skeleton: text, Tag: text, Tooltip: text,
    message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  };
});

// Resolve from the app too, so shared dependency junctions use the same mock ID.
const appRequire = createRequire(resolve('apps/web-antd/package.json'));
vi.doMock(appRequire.resolve('@vben/icons').replaceAll('\\', '/'), () => ({ createIconifyIcon: () => defineComponent({ setup: () => () => h('i') }) }));
vi.doMock(appRequire.resolve('@vben/plugins/echarts').replaceAll('\\', '/'), () => ({
  EchartsUI: defineComponent({ setup: () => () => h('div') }),
  useEcharts: () => ({ renderEcharts: vi.fn() }),
}));
const { default: SemrushSettings } = await import('../apps/web-antd/src/views/intelligence/components/SemrushSettings.vue');
const { default: SourceUsageDashboard } = await import('../apps/web-antd/src/views/intelligence/components/SourceUsageDashboard.vue');

let dispose: (() => void) | undefined;
const flush = async () => { for (let i = 0; i < 12; i++) await nextTick(); };
function mount(component: any) {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(component);
  app.mount(host);
  dispose = () => { app.unmount(); host.remove(); };
  return host;
}
beforeEach(() => { request.mockReset(); });
afterEach(() => { dispose?.(); });
const totals = { confirmedUnits: 25, confirmedRecords: 2, unknownRecords: 1, cachedRecords: 0, breakdown: [] };

it('Semrush opens with saved usage, and refresh asks only for the same saved statistics', async () => {
  request.mockImplementation(async (action: string) => {
    if (action === 'server_semrush_status') return { configured: true, ready: true, message: '已保存配置' };
    if (action === 'server_semrush_usage') return {
      currentKeyAvailable: true, currentKey: totals, otherKeys: { ...totals, confirmedRecords: 0, unknownRecords: 0 },
      unassigned: totals, cachedRecords: 0, unclassifiedRecords: 0, checkedAt: '2026-11-05T10:00:00Z',
    };
    throw new Error(`unexpected action: ${action}`);
  });
  const host = mount(SemrushSettings);
  await flush();
  expect(host.textContent).toContain('25');
  expect(host.textContent).toContain('任务执行后自动汇总保存');
  expect(request.mock.calls.map(([action]) => action)).toEqual(['server_semrush_status', 'server_semrush_usage']);
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes('刷新已保存统计'))!;
  button.click();
  await flush();
  expect(request.mock.calls.map(([action]) => action)).toEqual(['server_semrush_status', 'server_semrush_usage', 'server_semrush_usage']);
});

it('resource page mount and refresh read saved usage without automatically fetching missing account balances', async () => {
  request.mockImplementation(async (action: string) => {
    if (action !== 'server_source_usage') throw new Error(`unexpected action: ${action}`);
    return {
      sources: [{ id: 'firecrawl', name: 'Firecrawl', configured: true, automatic: true, quota: null, records: 2, today: 3, cumulative: 8, unknown: 0, undated: 0, unit: 'credits' }],
      daily: [], entries: [], total: 0, page: 1, pageSize: 25, undated: 0,
      checkedAt: '2026-11-05T10:00:00Z', start: '2026-11-01', end: '2026-11-05',
    };
  });
  const host = mount(SourceUsageDashboard);
  await flush();
  expect(request.mock.calls.map(([action]) => action)).toEqual(['server_source_usage']);
  expect(host.textContent).toContain('已保存统计');
  (host.querySelector('[aria-label="刷新消耗记录"]') as HTMLButtonElement).click();
  await flush();
  expect(request.mock.calls.map(([action]) => action)).toEqual(['server_source_usage', 'server_source_usage']);
});

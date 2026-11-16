/* eslint-disable vue/one-component-per-file -- Native control fixtures keep interactions observable. */
import type { SourceUsageSnapshot, UsageSource } from '../apps/web-antd/src/views/intelligence/source-usage';

import { createApp, defineComponent, h, nextTick } from 'vue';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  adminRequest: mocks.request,
  session: { user: { role: 'admin' } },
}));
vi.mock('../packages/icons/src/index', () => ({ createIconifyIcon: () => () => null }));
vi.mock('../packages/effects/plugins/src/echarts/index', () => ({ EchartsUI: () => null, useEcharts: () => ({ renderEcharts: vi.fn() }) }));
// Native controls keep quota inputs and submission observable without popup/layout machinery.
vi.mock('../apps/web-antd/node_modules/ant-design-vue/es/index.js', () => {
  const box = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) });
  return {
    Alert: box, Checkbox: box, Empty: box, Pagination: box,
    Input: Object.assign(defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }), { Password: box }),
    Progress: box, Select: box, Skeleton: box, Tag: box, Tooltip: box,
    DatePicker: box,
    Button: defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }),
    Form: Object.assign(defineComponent({ setup: (_, { slots }) => () => h('form', slots.default?.()) }), { Item: box }),
    InputNumber: defineComponent({
      props: { value: { type: Number, default: undefined } }, emits: ['update:value'],
      setup: (props, { emit }) => () => h('input', {
        type: 'number', value: props.value,
        onInput: (event: Event) => emit('update:value', Number((event.target as HTMLInputElement).value)),
      }),
    }),
    Modal: defineComponent({ props: { open: Boolean }, setup: (props, { slots }) => () => props.open ? h('div', { role: 'dialog' }, slots.default?.()) : null }),
    message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});
import SemrushSettings from '../apps/web-antd/src/views/intelligence/components/SemrushSettings.vue';
import Dashboard from '../apps/web-antd/src/views/intelligence/components/SourceUsageDashboard.vue';

let app: ReturnType<typeof createApp>;
let snapshot: SourceUsageSnapshot;
let root: HTMLDivElement;

function source(id: string, name: string, origin: 'calculated' | 'manual'): UsageSource {
  return {
    id, name, unit: 'API units', mark: 'SE', description: '', configured: true,
    records: 1, today: 680, cumulative: 680, unknown: 0, todayUnknown: 0, cached: 0, undated: 0,
    quota: { remaining: 49_320, total: 50_000, origin, updatedAt: '2026-11-16T08:00:00Z' },
    manualQuota: { remaining: 12, total: 50_000, origin: 'manual', updatedAt: '2026-11-16T08:00:00Z' },
    preferManual: true, quotaMessage: '总额度减去当前 Key 已记录消耗积分',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshot = {
    sources: [source('semrush', 'Semrush', 'calculated'), source('firecrawl', 'Firecrawl', 'manual')],
    entries: [], daily: [], total: 0, page: 1, pageSize: 25, start: '2026-11-10', end: '2026-11-16', today: '2026-11-16',
    checkedAt: '2026-11-16T08:00:00Z', undated: 0, unattributed: 0, coverage: '',
  };
  mocks.request.mockImplementation(async (action) => {
    if (action === 'server_source_usage') return structuredClone(snapshot);
    if (action === 'server_semrush_usage') {
      const totals = { confirmedUnits: 680, confirmedRecords: 1, unknownRecords: 0, cachedRecords: 0, breakdown: [] };
      return { currentKeyAvailable: true, keyConfigured: true, currentKey: totals, otherKeys: totals, unassigned: totals, checkedAt: snapshot.checkedAt };
    }
    if (action === 'server_semrush_status') return { configured: true, ready: true, message: '' };
    return { saved: true };
  });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(Dashboard);
  app.mount(root);
});

afterEach(() => { app.unmount(); root.remove(); });

async function open(name: string) {
  await vi.waitFor(() => expect(root.querySelector(`[aria-label="编辑 ${name} 配置"]`)).not.toBeNull());
  root.querySelector<HTMLButtonElement>(`[aria-label="编辑 ${name} 配置"]`)!.click();
  await nextTick();
}

it('shows calculated Semrush remaining and only submits total and expiry', async () => {
  await open('Semrush');
  expect(root.querySelector('[aria-label="手动剩余额度"]')).toBeNull();
  expect(root.querySelector('.source-current-quota')?.textContent).toContain('49,320');
  expect(root.querySelector('.source-current-quota')?.textContent).toContain('按已记录消耗计算');
  const total = root.querySelector<HTMLInputElement>('[aria-label="总额度"]')!;
  total.value = '60000';
  total.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('保存额度登记'))!.click();
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith('server_source_quota_save', expect.objectContaining({ sourceId: 'semrush', total: 60_000 })));
  const payload = mocks.request.mock.calls.find(([action]) => action === 'server_source_quota_save')![1];
  expect(payload).not.toHaveProperty('remaining');
});

it('preserves manual remaining controls and saving for other sources', async () => {
  await open('Firecrawl');
  expect(root.querySelector<HTMLInputElement>('[aria-label="手动剩余额度"]')!.value).toBe('12');
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('保存额度登记'))!.click();
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith('server_source_quota_save', expect.objectContaining({ sourceId: 'firecrawl', remaining: 12 })));
});

it('updates the open quota panel when saved usage is refreshed', async () => {
  await open('Semrush');
  snapshot.sources[0]!.quota!.remaining = 49_000;
  root.querySelector<HTMLButtonElement>('[aria-label="刷新消耗记录"]')!.click();
  await vi.waitFor(() => expect(root.querySelector('.source-current-quota')?.textContent).toContain('49,000'));
});

it('refreshes remaining along with the Semrush saved consumption button', async () => {
  app.unmount();
  app = createApp({
    render: () => h(Dashboard, null, {
      configuration: ({ refreshUsage }: { refreshUsage: () => Promise<unknown> }) =>
        h(SemrushSettings, { onUsageUpdated: () => { void refreshUsage(); } }),
    }),
  });
  app.mount(root);
  await open('Semrush');
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith('server_semrush_usage'));
  snapshot.sources[0]!.quota!.remaining = 49_000;
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('刷新已保存统计'))!.click();
  await vi.waitFor(() => expect(root.querySelector('.source-current-quota')?.textContent).toContain('49,000'));
});

import type { Task } from '../apps/web-antd/src/views/intelligence/data';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';

vi.mock('../apps/web-antd/src/views/intelligence/data', () => ({
  marketName: (market: string) => market,
}));
vi.mock('ant-design-vue', () => {
  const text = defineComponent({
    props: ['message'],
    setup:
      (props, { slots }) =>
      () =>
        h('div', [props.message, slots.default?.()]),
  });
  return {
    Alert: text,
    Tag: text,
    Progress: defineComponent({
      props: ['percent'],
      setup: (props) => () => h('progress', { value: props.percent, max: 100 }),
    }),
    Table: defineComponent({
      props: ['columns', 'dataSource'],
      setup:
        (props, { slots }) =>
        () =>
          h('table', [
            h(
              'thead',
              props.columns.map((column: any) => h('th', column.title)),
            ),
            h(
              'tbody',
              props.dataSource.map((record: any) =>
                h(
                  'tr',
                  props.columns.map((column: any) =>
                    h(
                      'td',
                      slots.bodyCell?.({ column, record }) ||
                        record[column.dataIndex],
                    ),
                  ),
                ),
              ),
            ),
          ]),
    }),
  };
});
import TaskProgress from '../apps/web-antd/src/views/intelligence/components/TaskProgress.vue';

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());
const progress = {
  expansionOnly: true,
  phase: 'finished',
  terminal: true,
  percent: 4,
  discovered: 709,
  target: 709,
  discoveryTotal: 42,
  discoveryDone: 31,
  discoveryFailed: 32,
  semrushEnabled: true,
  metricProcessed: 0,
  metricPending: 709,
  metricUnknown: 0,
  total: 709,
  processed: 0,
  succeeded: 0,
  failed: 0,
  rows: [
    {
      id: 'k',
      term: 'curcumin supplement',
      market: 'US',
      status: 'not_started',
      message: '关键词已获取；月搜索量未执行：Semrush API额度为0',
      failed: false,
    },
  ],
};
function render(extra = {}) {
  const task = {
    id: 'task',
    title: '采集',
    market: 'US',
    created: '',
    steps: [],
    status: 'partial',
    progress,
    ...extra,
  } as Task;
  const host = document.createElement('div');
  const app = createApp(TaskProgress, { task, detail: true });
  app.mount(host);
  dispose = () => app.unmount();
  return host;
}
it('shows discovered words separately from metrics and keeps skipped rows in the incomplete filter', async () => {
  const host = render();
  expect(host.textContent).toContain('累计得到关键词709 个');
  expect(host.textContent).toContain('月搜索量0 / 709');
  expect(host.textContent).toContain('任务已结束 · 部分完成');
  expect(host.textContent).not.toContain('各关键词已处理完毕');
  expect(host.textContent).not.toContain('趋势处理');
  expect(host.textContent).not.toContain('一年 / 日趋势时点');
  const filter = host.querySelector('select')!;
  filter.value = 'incomplete';
  filter.dispatchEvent(new Event('change'));
  await nextTick();
  expect(host.textContent).toContain('curcumin supplement');
  expect(host.textContent).toContain('月搜索量未执行：Semrush API额度为0');
});
it('shows AI analysis as a phase of the parent task', () => {
  const host = render({
    sourceAnalysis: {
      total: 3,
      queued: 1,
      running: 0,
      completed: 1,
      failed: 1,
      cancelled: 0,
    },
  });
  expect(host.textContent).toContain('AI分析环节：完成 1/3');
  expect(host.textContent).toContain('失败 1');
});

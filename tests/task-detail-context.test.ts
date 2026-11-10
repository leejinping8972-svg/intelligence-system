import type { TaskGroup } from '../apps/web-antd/src/views/intelligence/task-list';

import { createApp, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import TaskDetailPanel from '../apps/web-antd/src/views/intelligence/components/TaskDetailPanel.vue';
import { taskObjectSummary, taskTime } from '../apps/web-antd/src/views/intelligence/task-context';
import { taskTitle } from '../apps/web-antd/src/views/intelligence/task-list';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../apps/web-antd/src/views/intelligence/components/ProductDrawer.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../apps/web-antd/src/views/intelligence/components/TaskProgress.vue', () => ({ default: { template: '<div>generic usage</div>' } }));

const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); document.body.replaceChildren(); });
function mount(component: typeof TaskDetailPanel, options: { props: { task: TaskGroup } }) {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(component, options.props);
  apps.push(app);
  app.mount(host);
  const find = (selector: string) => {
    const element = host.querySelector(selector) as HTMLElement;
    return { element, text: () => element?.textContent || '', attributes: (name: string) => element?.getAttribute(name), trigger: async (_event: string) => { element.click(); await nextTick(); } };
  };
  return { find, findAll: (selector: string) => Array.from(host.querySelectorAll(selector)).map(element => ({ element, attributes: (name: string) => element.getAttribute(name) })), text: () => host.textContent || '' };
}

const fixture = (): TaskGroup => ({
  id: 'synthetic-job', cloudJobId: 'synthetic-job', market: 'US', markets: ['US'], taskIds: ['synthetic-job'], status: 'completed', title: '云端 · 平台商品发现与趋势补全 · 美国', created: '2026-11-05T10:00:00Z', steps: ['Saved receipt'],
  context: { kind: 'sales_verification', title: '商品销量核对', purpose: '重新读取目标商品的来源详情，核对预估月销量。', objectLabel: '目标商品', objectCount: 1, objects: [{ kind: 'products', id: 'synthetic-product', label: '合成测试镁胶囊', sourceId: 'B012345678', identifierLabel: 'ASIN', market: 'US' }], hasMore: false, scope: '仅核对并保存记录，不更新商品库', verificationOnly: true, result: { summary: '已取得本次预估月销量', metrics: [{ label: '预估月销量', previous: '7', value: '0' }], at: '2026-11-05T10:00:00Z', provider: 'Sorftime', notice: '本次结果已保存到核对记录，未覆盖商品库原值。', usage: [{ label: '模型调用', value: 0 }] } },
});

describe('task detail context', () => {
  it('names the object and purpose before results and collapses logs and usage', () => {
    const wrapper = mount(TaskDetailPanel, { props: { task: fixture() } });
    expect(wrapper.find('h1').text()).toBe('商品销量核对');
    expect(wrapper.text()).toContain('合成测试镁胶囊');
    expect(wrapper.text()).toContain('ASIN B012345678');
    expect(wrapper.text()).toContain('未覆盖商品库原值');
    expect(wrapper.find('.fresh-value').text()).toBe('0');
    expect(wrapper.find('.task-targets').element.compareDocumentPosition(wrapper.find('.task-outcome').element) & 4).toBe(4);
    expect(wrapper.findAll('details').every(detail => !detail.attributes('open'))).toBe(true);
    expect(wrapper.text()).not.toContain('等待人工审阅');
    expect(wrapper.text()).not.toContain('generic usage');
  });
  it('keeps legacy metadata honest', () => {
    const task = { ...fixture(), context: undefined };
    const wrapper = mount(TaskDetailPanel, { props: { task } });
    expect(wrapper.text()).toContain('历史任务未记录对象信息');
    expect(taskObjectSummary(task)).toBe('历史任务未记录对象信息');
    expect(taskTitle(task)).toBe('平台商品发现与趋势补全');
  });
  it('uses the category scope in discovery details instead of calling categories generic targets', () => {
    const task = fixture();
    task.context = undefined;
    task.status = 'running';
    task.overview = {
      status: 'running', total: 212, processed: 212, succeeded: 212, failed: 0, waiting: 0,
      remaining: 0, percent: 100, outcome: '商品资料处理中', reason: '', startedAt: '', finishedAt: '', elapsedSeconds: null,
      healthDiscovery: {
        categories: { total: 212, processed: 212, succeeded: 212, failed: 0, remaining: 0 },
        pages: { processed: 212, pending: 1, failed: 0, truncated: 0 },
        products: { returned: 6, accepted: 1, excluded: 0, review: 1, pending: 4, evidenceSkipped: 0, limitSkipped: 0 },
        issues: 0, remainingWork: 5, phase: '商品资料处理中',
      },
    };
    const wrapper = mount(TaskDetailPanel, { props: { task } });
    expect(wrapper.find('.task-progress-summary').text()).toContain('类目首屏 212/212 · 商品资料处理中');
    expect(wrapper.text()).toContain('商品入库 1 · 排除 0 · 待确认 1 · 待处理 4');
    expect(wrapper.text()).not.toContain('212 个目标');
    expect(wrapper.text()).not.toContain('本次采集目标完成');
  });
  it('expands batch objects and retains the true total', async () => {
    const task = fixture();
    const context = task.context!;
    context.objectCount = 18;
    context.objects = Array.from({ length: 8 }, (_, index) => ({ kind: 'products', id: `p${index}`, label: `合成商品 ${index}` }));
    context.hasMore = true;
    const wrapper = mount(TaskDetailPanel, { props: { task } });
    expect(wrapper.findAll('.task-target')).toHaveLength(3);
    expect(wrapper.text()).toContain('共 18 项');
    await wrapper.find('.expand-targets').trigger('click');
    expect(wrapper.findAll('.task-target')).toHaveLength(8);
    expect(taskObjectSummary(task)).toContain('等 18 项');
  });
  it('shows missing product identity without fabricating a name and uses Beijing time', () => {
    const task = fixture();
    task.context!.objects[0]!.label = '名称未记录';
    expect(taskObjectSummary(task)).toBe('B012345678');
    expect(taskTime('2026-11-05T10:00:00Z')).toContain('18:00:00');
    expect(taskTime('invalid')).toBe('未记录');
  });
});

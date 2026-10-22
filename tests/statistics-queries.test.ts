import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { computed, createApp, nextTick, ref } from 'vue';

const mock = vi.hoisted(() => ({ request: vi.fn(), session: null as any, cloud: null as any }));
vi.mock('../apps/web-antd/src/views/intelligence/session', async () => {
  const { reactive } = await import('vue');
  mock.session = reactive({ user: { id: 'qa' } });
  return { session: mock.session, serverMode: true };
});
vi.mock('../apps/web-antd/src/views/intelligence/cloud-workspace', async () => {
  const { reactive } = await import('vue');
  mock.cloud = reactive({ publishedRevision: '1' });
  return { cloudRequest: mock.request, cloudWorkspace: mock.cloud };
});
import { useStatistics } from '../apps/web-antd/src/views/intelligence/statistics-queries';
let dispose: (() => void) | undefined;
let user = 0;
const response = (id: string) => ({ rows: [{ id }], total: 120, snapshot: { generatedAt: '2026-10-22', revision: '1' }, page: 1, pageSize: 20 });
const settle = async () => { await vi.advanceTimersByTimeAsync(150); await nextTick(); };
function setup(enabled = true) {
  const market = ref('US'), open = ref(enabled);
  let data!: ReturnType<typeof useStatistics<{ id: string }>>;
  const app = createApp({ setup() {
    data = useStatistics(computed(() => ({ kind: 'radar', market: market.value, enabled: open.value })));
    return () => null;
  } });
  app.mount(document.createElement('div'));
  dispose = () => app.unmount();
  return { market, open, data };
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.session.user = { id: `qa-${++user}` };
  mock.request.mockReset().mockImplementation(async (_action, input) => response(input.market));
});
afterEach(() => { dispose?.(); vi.useRealTimers(); });
it('loads a bounded statistics page and uses cached results on return', async () => {
  const { market, data } = setup();
  await settle();
  expect(data.total.value).toBe(120);
  expect(mock.request.mock.calls.every(([action]) => action === 'server_workspace_statistics')).toBe(true);
  market.value = 'MX'; await settle();
  market.value = 'US'; await settle();
  expect(data.rows.value[0]?.id).toBe('US');
  expect(mock.request).toHaveBeenCalledTimes(2);
});
it('ignores a late response from another market', async () => {
  let finish!: (value: unknown) => void;
  mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { market, data } = setup();
  await settle();
  market.value = 'VN'; await settle();
  finish(response('US')); await settle();
  expect(data.rows.value[0]?.id).toBe('VN');
});
it('does not query a closed formula dialog and stops polling on unmount', async () => {
  const { open } = setup(false);
  await settle(); expect(mock.request).not.toHaveBeenCalled();
  open.value = true; await settle(); expect(mock.request).toHaveBeenCalledTimes(1);
  dispose?.(); dispose = undefined;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mock.request).toHaveBeenCalledTimes(1);
});
it('retains the last successful snapshot on a refresh failure', async () => {
  const { data } = setup(); await settle();
  mock.request.mockRejectedValueOnce(new Error('offline'));
  await data.reload(true);
  expect(data.rows.value[0]?.id).toBe('US');
  expect(data.error.value).toBe('offline');
});

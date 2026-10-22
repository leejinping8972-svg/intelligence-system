import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, nextTick, ref } from 'vue';

const mock = vi.hoisted(() => ({
  request: vi.fn(),
  cloud: null as any,
  session: null as any,
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', async () => {
  const { reactive } = await import('vue');
  mock.session = reactive({ user: { id: 'qa' } });
  return { serverMode: true, session: mock.session };
});
vi.mock('../apps/web-antd/src/views/intelligence/cloud-workspace', async () => {
  const { reactive } = await import('vue');
  mock.cloud = reactive({ publishedRevision: '1' });
  return {
    cloudRequest: mock.request,
    cloudWorkspace: mock.cloud,
    applyWorkspaceRecords: vi.fn(),
  };
});
vi.mock('../apps/web-antd/src/views/intelligence/data', () => ({
  state: { market: 'ALL' },
}));
import { useWorkspaceList } from '../apps/web-antd/src/views/intelligence/workspace-queries';

let dispose: (() => void) | undefined;
let user = 0;
const result = (id: string, page = 1) => ({
  rows: [{ id }],
  total: 40,
  page,
  pageSize: 20,
  revisions: { published: '1' },
  indexing: true,
});
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  await nextTick();
};
function setup() {
  const filter = ref(''),
    page = ref(1),
    pageSize = ref(20);
  let list!: ReturnType<typeof useWorkspaceList<{ id: string }>>;
  const host = document.createElement('div');
  const app = createApp({
    setup() {
      list = useWorkspaceList(
        'advertisers',
        computed(() => ({ search: filter.value })),
        page,
        pageSize,
      );
      return () => null;
    },
  });
  app.mount(host);
  dispose = () => app.unmount();
  return { list, filter, page };
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.session.user.id = `qa-${++user}`;
  mock.request.mockReset();
  mock.request.mockImplementation(async (action, input) =>
    action === 'server_workspace_facets'
      ? { facets: {} }
      : result(`page${input.page}`, input.page),
  );
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

describe('paged workspace queries', () => {
  it('loads separate pages and reuses cached pages without downloading the workspace', async () => {
    const { list, page } = setup();
    await settle();
    expect(list.rows.value[0]?.id).toBe('page1');
    page.value = 2;
    await settle();
    expect(list.rows.value[0]?.id).toBe('page2');
    page.value = 1;
    await settle();
    expect(list.rows.value[0]?.id).toBe('page1');
    expect(
      mock.request.mock.calls.filter(
        ([action]) => action === 'server_workspace_list',
      ),
    ).toHaveLength(2);
    expect(
      mock.request.mock.calls.every(
        ([action]) => action !== 'server_workspace_delta',
      ),
    ).toBe(true);
  });
  it('retains the last successful page on failure, and clears rows for a different filter', async () => {
    const { list, filter } = setup();
    await settle();
    mock.request.mockRejectedValue(new Error('offline'));
    await list.reload(true);
    expect(list.rows.value[0]?.id).toBe('page1');
    expect(list.error.value).toBe('offline');
    filter.value = 'new filter';
    await settle();
    expect(list.rows.value).toEqual([]);
    expect(list.total.value).toBe(0);
  });
  it('ignores late responses after filters change and separates users', async () => {
    const { list, filter } = setup();
    await settle();
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementation((action, input) =>
      action === 'server_workspace_list' && input.search === 'old'
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(
            action === 'server_workspace_facets'
              ? { facets: {} }
              : result(input.search || 'user2'),
          ),
    );
    filter.value = 'old';
    await settle();
    filter.value = 'new';
    await settle();
    resolve(result('stale'));
    await settle();
    expect(list.rows.value[0]?.id).toBe('new');
    mock.session.user.id = 'another-user';
    mock.request.mockRejectedValue(new Error('offline'));
    await settle();
    expect(list.rows.value).toEqual([]);
  });
});

import { computed, createApp, nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  request: vi.fn(),
  cloud: null as any,
  session: null as any,
  state: null as any,
  hydrate: vi.fn(),
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
    applyWorkspaceRecords: mock.hydrate,
  };
});
vi.mock('../apps/web-antd/src/views/intelligence/data', () => {
  mock.state = { market: 'ALL', products: [] };
  return { state: mock.state };
});
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
function setup(
  market = ref('ALL'),
  collection: 'advertisers' | 'products' = 'advertisers',
) {
  const filter = ref('');
  const page = ref(1);
  const pageSize = ref(20);
  let list!: ReturnType<typeof useWorkspaceList<{ id: string }>>;
  const host = document.createElement('div');
  const app = createApp({
    setup() {
      list = useWorkspaceList(
        collection,
        computed(() => ({ search: filter.value, market: market.value })),
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
  mock.state.products = [];
  mock.hydrate.mockReset();
  mock.hydrate.mockImplementation((collection, records) => {
    for (const record of records) {
      const previous = mock.state[collection].find(
        (row: any) => row.id === record.id,
      );
      if (previous) Object.assign(previous, record);
      else mock.state[collection].push({ ...record });
    }
  });
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
  it('shows loading before the first request and throughout the search debounce', async () => {
    const { list, filter, page } = setup();
    expect(list.loading.value).toBe(true);
    await settle();
    expect(list.loading.value).toBe(false);

    filter.value = 'new batch';
    await nextTick();
    expect(list.loading.value).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(list.loading.value).toBe(true);
    await settle();
    expect(list.loading.value).toBe(false);

    page.value = 2;
    await nextTick();
    expect(list.loading.value).toBe(true);
    await settle();
    page.value = 1;
    await nextTick();
    expect(list.loading.value).toBe(false);
    await settle();
  });
  it('hydrates each cached page once and restores it after a different filter fails', async () => {
    const { list, filter, page } = setup(ref('ALL'), 'products');
    await settle();
    expect(mock.hydrate).toHaveBeenCalledTimes(1);
    await list.reload();
    expect(mock.hydrate).toHaveBeenCalledTimes(1);
    page.value = 2;
    await settle();
    expect(mock.hydrate).toHaveBeenCalledTimes(2);
    page.value = 1;
    await settle();
    expect(mock.hydrate).toHaveBeenCalledTimes(3);
    mock.request.mockRejectedValue(new Error('different filter offline'));
    filter.value = 'unavailable';
    await settle();
    expect(list.rows.value).toEqual([]);
    filter.value = '';
    await settle();
    expect(list.rows.value[0]?.id).toBe('page1');
    expect(mock.hydrate).toHaveBeenCalledTimes(4);
  });
  it('keeps current market summary separate from filter totals and clears it while switching market', async () => {
    mock.request.mockImplementation(async (action, input) =>
      action === 'server_workspace_facets'
        ? { facets: {} }
        : {
            ...result('visible', input.page),
            total: 1,
            marketSummary: {
              total: 841,
              priority: 34,
              pending: 700,
              selected: 17,
            },
          },
    );
    const market = ref('ALL');
    const { list, filter } = setup(market);
    await settle();
    expect(list.total.value).toBe(1);
    expect(list.marketSummary.value?.total).toBe(841);
    filter.value = 'curcumin';
    await settle();
    expect(list.marketSummary.value?.total).toBe(841);
    mock.request.mockImplementation((action) =>
      action === 'server_workspace_facets'
        ? Promise.resolve({ facets: {} })
        : new Promise(() => {}),
    );
    market.value = 'US';
    await settle();
    expect(list.marketSummary.value).toBeUndefined();
  });
  it('downloads only the visible page after indexing completes', async () => {
    mock.request.mockImplementation(async (action, input) =>
      action === 'server_workspace_facets'
        ? { facets: {} }
        : { ...result('visible', input.page), indexing: false },
    );
    setup();
    await settle();
    expect(
      mock.request.mock.calls.filter(
        ([action]) => action === 'server_workspace_list',
      ),
    ).toHaveLength(1);
  });
  it('cancels an old filter and stops its download when the page closes', async () => {
    const { filter } = setup();
    await settle();
    const signals: AbortSignal[] = [];
    mock.request.mockImplementation((action, _input, options) => {
      if (action === 'server_workspace_list') {
        signals.push(options.signal);
        return new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true },
          ),
        );
      }
      return Promise.resolve({ facets: {} });
    });
    filter.value = 'first';
    await settle();
    filter.value = 'second';
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    dispose?.();
    dispose = undefined;
    await settle();
    expect(signals[1]?.aborted).toBe(true);
  });
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
  it('keeps a loaded page interactive during a background refresh', async () => {
    const { list, filter } = setup();
    await settle();
    let finish!: (value: unknown) => void;
    mock.request.mockImplementation((action) =>
      action === 'server_workspace_list'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ facets: {} }),
    );
    mock.cloud.publishedRevision = `refresh-${user}`;
    await nextTick();
    expect(list.rows.value[0]?.id).toBe('page1');
    expect(list.loading.value).toBe(false);
    finish(result('updated'));
    await settle();
    expect(list.rows.value[0]?.id).toBe('updated');
    filter.value = 'new filter';
    await settle();
    expect(list.loading.value).toBe(true);
    expect(list.rows.value).toEqual([]);
    finish(result('filtered'));
    await settle();
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

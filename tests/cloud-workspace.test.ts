import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  seed: null as any,
  state: null as any,
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  serverMode: true,
  session: { user: { id: 'qa', role: 'admin' } },
  adminRequest: mock.request,
  leaveSession: vi.fn(),
}));
vi.mock('../apps/web-antd/src/views/intelligence/data', async () => {
  const { reactive } = await import('vue');
  mock.state = reactive(
    mock.seed || {
      keywords: [],
      tasks: [],
      sites: [],
      products: [],
      ads: [],
      reviews: [],
      monitors: [],
      imports: [],
      audit: [],
      branding: {},
      settings: {},
    },
  );
  return { state: mock.state };
});
const initial = () => ({
  revisions: { business: 'b1', keywords: 'k1', tasks: 't1' },
  generatedAt: '2026-10-20T01:00:00Z',
  business: {
    entries: [
      { key: 'products:p1', value: { id: 'p1', title: 'old' } },
      { key: 'branding:main', value: {} },
      { key: 'preferences:main', value: {} },
    ],
  },
  keywords: [{ id: 'k1', favorite: false, reviewStatus: 'pending' }],
  tasks: [
    { id: 'j1:US', cloudJobId: 'j1', status: 'running' },
    { id: 'j1:VN', cloudJobId: 'j1', status: 'running' },
  ],
});
beforeEach(() => {
  vi.resetModules();
  mock.request.mockReset();
  mock.seed = null;
  localStorage.clear();
});
async function setup() {
  mock.request.mockImplementation(async (action) =>
    action === 'server_workspace_delta' ? initial() : {},
  );
  const cloud =
    await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
  await cloud.syncCloudWorkspace();
  mock.request.mockClear();
  return cloud;
}
describe('workspace delta synchronization', () => {
  it('shares an awaited request, sends revisions, and preserves unchanged object identity', async () => {
    const cloud = await setup();
    const product = mock.state.products[0];
    const keyword = mock.state.keywords[0];
    let resolve!: (v: unknown) => void;
    mock.request.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const a = cloud.syncCloudWorkspace();
    const b = cloud.syncCloudWorkspace();
    expect(a).toBe(b);
    await Promise.resolve();
    expect(mock.request).toHaveBeenCalledExactlyOnceWith(
      'server_workspace_delta',
      { revisions: initial().revisions },
      90_000,
    );
    resolve({ revisions: initial().revisions, generatedAt: 'next' });
    await a;
    await b;
    expect(mock.state.products[0]).toBe(product);
    expect(mock.state.keywords[0]).toBe(keyword);
    expect(cloud.cloudWorkspace.active).toBe(1);
  });
  it('a task-only response neither reloads business data nor uploads it back', async () => {
    const cloud = await setup();
    const product = mock.state.products[0];
    mock.request.mockResolvedValue({
      revisions: { ...initial().revisions, tasks: 't2' },
      tasks: [],
      generatedAt: 'next',
    });
    await cloud.syncCloudWorkspace();
    await cloud.syncCloudWorkspace();
    expect(mock.state.products[0]).toBe(product);
    expect(mock.state.tasks).toHaveLength(0);
    expect(mock.request.mock.calls.map((c) => c[0])).toEqual([
      'server_workspace_delta',
      'server_workspace_delta',
    ]);
  });
  it('preserves keyword and product edits made during a fetch, and uploads them on the next synchronization', async () => {
    const cloud = await setup();
    let resolve!: (v: unknown) => void;
    mock.request.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = cloud.syncCloudWorkspace();
    await Promise.resolve();
    mock.state.keywords[0].favorite = true;
    mock.state.products[0].title = 'edited';
    resolve(initial());
    await pending;
    expect(mock.state.keywords[0].favorite).toBe(true);
    expect(mock.state.products[0].title).toBe('edited');
    mock.request.mockImplementation(async (action) =>
      action === 'server_workspace_delta'
        ? { revisions: initial().revisions, generatedAt: 'next' }
        : {},
    );
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith('server_patch_keywords', {
      updates: [
        expect.objectContaining({
          id: 'k1',
          patch: expect.objectContaining({ favorite: true }),
        }),
      ],
    });
    expect(mock.request).toHaveBeenCalledWith('server_workspace_sync', {
      entries: [
        expect.objectContaining({
          key: 'products:p1',
          value: expect.objectContaining({ title: 'edited' }),
        }),
      ],
    });
  });
  it('keeps the last good data and revision after a failure, then retries successfully', async () => {
    const cloud = await setup();
    const product = mock.state.products[0];
    mock.request.mockRejectedValueOnce(new Error('offline'));
    await expect(cloud.syncCloudWorkspace()).rejects.toThrow('offline');
    expect(mock.state.products[0]).toBe(product);
    expect(cloud.cloudWorkspace.syncing).toBe(false);
    mock.request.mockResolvedValue({
      revisions: initial().revisions,
      generatedAt: 'next',
    });
    await cloud.syncCloudWorkspace();
    expect(cloud.cloudWorkspace.error).toBe('');
    expect(mock.request).toHaveBeenLastCalledWith('server_workspace_delta', {
      revisions: initial().revisions,
    }, 90_000);
  });
  it('restores matching cached revisions so a reload keeps list data and requests only deltas', async () => {
    await setup();
    const savedState = JSON.parse(JSON.stringify(mock.state));
    const cached = localStorage.getItem('intelligence-workspace-revisions-v1');
    expect(cached).toContain('"keywords":"k1"');
    vi.resetModules();
    mock.seed = savedState;
    mock.request.mockReset();
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const cloud =
      await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
    const pending = cloud.syncCloudWorkspace();
    await Promise.resolve();
    expect(cloud.cloudWorkspace.ready).toBe(true);
    expect(mock.state.keywords).toHaveLength(1);
    expect(mock.request).toHaveBeenCalledExactlyOnceWith(
      'server_workspace_delta',
      { revisions: initial().revisions },
      90_000,
    );
    resolve({ revisions: initial().revisions, generatedAt: 'next' });
    await pending;
  });
  it('falls back to a full refresh when cached content changed without changing list counts', async () => {
    await setup();
    mock.state.keywords[0].favorite = true;
    const savedState = JSON.parse(JSON.stringify(mock.state));
    vi.resetModules();
    mock.seed = savedState;
    mock.request.mockReset();
    mock.request.mockResolvedValue(initial());
    const cloud =
      await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledExactlyOnceWith(
      'server_workspace_delta',
      { revisions: {} },
      90_000,
    );
  });
});

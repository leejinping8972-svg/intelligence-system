import { nextTick, toRaw } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  seed: null as any,
  state: null as any,
  trackers: [] as Array<{ stop: () => void }>,
}));
vi.mock(
  '../apps/web-antd/src/views/intelligence/workspace-change-tracker',
  async (original) => {
    const { createWorkspaceChangeTracker } =
      await original<
        typeof import('../apps/web-antd/src/views/intelligence/workspace-change-tracker')
      >();
    return {
      createWorkspaceChangeTracker(
        options: Parameters<typeof createWorkspaceChangeTracker>[0],
      ) {
        const tracker = createWorkspaceChangeTracker(options);
        mock.trackers.push(tracker);
        return tracker;
      },
    };
  },
);
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
  for (const tracker of mock.trackers.splice(0)) tracker.stop();
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
  cloud.setWorkspaceReadMode('legacy');
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
    await vi.waitFor(() => expect(mock.request).toHaveBeenCalled());
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
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
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
    expect(mock.request).toHaveBeenCalledWith(
      'server_patch_keywords',
      {
        updates: [
          expect.objectContaining({
            id: 'k1',
            patch: expect.objectContaining({ favorite: true }),
          }),
        ],
      },
      30_000,
    );
    expect(mock.request).toHaveBeenCalledWith(
      'server_workspace_sync',
      {
        entries: [
          expect.objectContaining({
            key: 'products:p1',
            value: expect.objectContaining({ title: 'edited' }),
          }),
        ],
      },
      30_000,
    );
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
    expect(mock.request).toHaveBeenLastCalledWith(
      'server_workspace_delta',
      {
        revisions: initial().revisions,
      },
      90_000,
    );
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
    cloud.setWorkspaceReadMode('legacy');
    const pending = cloud.syncCloudWorkspace();
    await vi.waitFor(() => expect(mock.request).toHaveBeenCalled());
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
    cloud.setWorkspaceReadMode('legacy');
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledExactlyOnceWith(
      'server_workspace_delta',
      { revisions: {} },
      90_000,
    );
  });
});

describe('paged server workspace', () => {
  async function paged() {
    mock.request.mockImplementation(async () => ({
      entries: [],
      revisions: { published: '1' },
      active: 0,
      generatedAt: 'now',
      indexing: false,
    }));
    const cloud =
      await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
    await cloud.syncCloudWorkspace();
    return cloud;
  }

  it('refreshes a page without serializing other cached payloads or uploading server data', async () => {
    const cloud = await paged();
    cloud.applyWorkspaceRecords(
      'products',
      Array.from({ length: 400 }, (_, index) => ({
        id: `p${index}`,
        title: 'cached',
        listSummary: true,
      })),
    );
    await nextTick();
    const untouchedRead = vi.fn(() => ({ body: 'large saved evidence' }));
    for (const record of mock.state.products.slice(20))
      Object.defineProperty(toRaw(record), 'savedEvidence', {
        enumerable: true,
        get: untouchedRead,
      });
    cloud.applyWorkspaceRecords(
      'products',
      Array.from({ length: 20 }, (_, index) => ({
        id: `p${index}`,
        title: 'refreshed',
        listSummary: true,
      })),
    );
    await nextTick();
    expect(untouchedRead).not.toHaveBeenCalled();
    mock.request.mockClear();
    await cloud.syncCloudWorkspace();
    expect(mock.request.mock.calls.map(([action]) => action)).toEqual([
      'server_workspace_bootstrap',
    ]);
  });

  it('preserves an edit immediately followed by a readback in the same turn', async () => {
    const cloud = await paged();
    cloud.applyWorkspaceRecords('products', [
      { id: 'same-turn', favorite: false, title: 'server' },
    ]);
    mock.state.products.find((row: any) => row.id === 'same-turn').favorite =
      true;
    cloud.applyWorkspaceRecords('products', [
      { id: 'same-turn', favorite: false, title: 'new server title' },
    ]);
    expect(
      mock.state.products.find((row: any) => row.id === 'same-turn'),
    ).toMatchObject({ favorite: true, title: 'new server title' });
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith(
      'server_workspace_sync',
      {
        patch: true,
        entries: [{ key: 'products:same-turn', value: { favorite: true } }],
      },
      30_000,
    );
  });

  it('saves local additions and deletions while keeping a failed save available to retry', async () => {
    const cloud = await paged();
    mock.state.products.push({ id: 'new-local', title: 'draft' });
    mock.request.mockRejectedValueOnce(new Error('save failed'));
    await expect(cloud.syncCloudWorkspace()).rejects.toThrow('save failed');
    await cloud.syncCloudWorkspace();
    expect(
      mock.request.mock.calls.filter(
        ([action]) => action === 'server_workspace_sync',
      ),
    ).toHaveLength(2);
    const index = mock.state.products.findIndex(
      (row: any) => row.id === 'new-local',
    );
    mock.state.products.splice(index, 1);
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith(
      'server_workspace_sync',
      { patch: true, entries: [{ key: 'products:new-local', value: null }] },
      30_000,
    );
  });

  it('retains a second edit made while a business save is in flight', async () => {
    const cloud = await paged();
    cloud.applyWorkspaceRecords('products', [
      { id: 'saving', title: 'server' },
    ]);
    const record = mock.state.products.find((row: any) => row.id === 'saving');
    record.title = 'first edit';
    let finish!: (value: unknown) => void;
    mock.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = cloud.syncCloudWorkspace();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    record.title = 'second edit';
    finish({});
    await saving;
    mock.request.mockClear();
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith(
      'server_workspace_sync',
      {
        patch: true,
        entries: [{ key: 'products:saving', value: { title: 'second edit' } }],
      },
      30_000,
    );
  });

  it('detaches nested keyword edits from the request already being saved', async () => {
    const cloud = await paged();
    cloud.applyWorkspaceRecords('keywords', [
      { id: 'nested', term: 'example', metrics: { note: 'server' } },
    ]);
    const record = mock.state.keywords.find((row: any) => row.id === 'nested');
    record.metrics.note = 'first';
    let finish!: (value: unknown) => void;
    mock.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = cloud.syncCloudWorkspace();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const sent = mock.request.mock.calls.find(
      ([action]) => action === 'server_patch_keywords',
    )![1];
    record.metrics.note = 'second';
    expect(sent.updates[0].patch.metrics.note).toBe('first');
    finish({});
    await saving;
    mock.request.mockClear();
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith(
      'server_patch_keywords',
      {
        updates: [
          {
            id: 'nested',
            patch: expect.objectContaining({ metrics: { note: 'second' } }),
          },
        ],
      },
      30_000,
    );
  });

  it('tracks preference edits without uploading connection credentials', async () => {
    const cloud = await paged();
    mock.state.settings.productsPerSite = 9;
    mock.state.settings.researchAccessKey = 'synthetic-test-value';
    mock.state.settings.researchApiUrl = 'https://example.test/api';
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith(
      'server_workspace_sync',
      {
        patch: true,
        entries: [{ key: 'preferences:main', value: { productsPerSite: 9 } }],
      },
      30_000,
    );
  });

  it('monitor tabs read scoped records, reuse revisions and do not echo server data as edits', async () => {
    mock.request.mockImplementation(async (action) =>
      action === 'server_monitor_workspace'
        ? {
            revision: 'b2',
            entries: [
              { key: 'monitors:m1', value: { id: 'm1', productId: 'p1' } },
              { key: 'audit:a1', value: { id: 'a1', at: 'now' } },
            ],
            products: [
              {
                id: 'p1',
                title: 'Product',
                market: 'US',
                brand: 'Brand',
                listSummary: true,
              },
            ],
          }
        : {
            entries: [],
            revisions: { tasks: 't2' },
            active: 1,
            generatedAt: 'now',
          },
    );
    const cloud =
      await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
    cloud.setWorkspaceReadMode('monitor');
    await cloud.syncCloudWorkspace();
    expect(mock.state.monitors).toHaveLength(1);
    expect(mock.state.audit).toHaveLength(1);
    expect(cloud.cloudWorkspace.taskRevision).toBe('t2');
    mock.request.mockImplementation(async (action) =>
      action === 'server_monitor_workspace'
        ? { revision: 'b2' }
        : {
            entries: [],
            revisions: { tasks: 't2' },
            active: 1,
            generatedAt: 'now',
          },
    );
    mock.request.mockClear();
    await cloud.syncCloudWorkspace();
    expect(mock.state.monitors).toHaveLength(1);
    expect(mock.request.mock.calls.map((call) => call[0]).sort()).toEqual([
      'server_monitor_workspace',
      'server_workspace_bootstrap',
    ]);
    expect(
      mock.request.mock.calls.find(
        (call) => call[0] === 'server_monitor_workspace',
      )?.[1],
    ).toEqual({ revision: 'b2' });
  });
  it('accepted resume succeeds even when its background refresh fails and shares double clicks', async () => {
    const cloud = await setup();
    let accept!: (value: unknown) => void;
    mock.request.mockImplementation((action) =>
      action === 'server_resume_partial'
        ? new Promise((resolve) => {
            accept = resolve;
          })
        : Promise.reject(new Error('refresh unavailable')),
    );
    const a = cloud.resumePartialCloudJob('j1');
    const b = cloud.resumePartialCloudJob('j1');
    expect(
      mock.request.mock.calls.filter(
        (call) => call[0] === 'server_resume_partial',
      ),
    ).toHaveLength(1);
    accept({ status: 'queued' });
    await expect(a).resolves.toEqual({ status: 'queued' });
    await expect(b).resolves.toEqual({ status: 'queued' });
    expect(
      mock.state.tasks.every((task: any) => task.status === 'queued'),
    ).toBe(true);
  });
  it('starts with configuration and revisions without downloading business collections', async () => {
    mock.request.mockImplementation(async () => ({
      entries: [],
      revisions: { published: '1' },
      active: 0,
      generatedAt: 'now',
      indexing: false,
    }));
    const cloud =
      await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
    await cloud.syncCloudWorkspace();
    expect(mock.request.mock.calls.map((call) => call[0])).toEqual([
      'server_workspace_bootstrap',
    ]);
    expect(cloud.cloudWorkspace.ready).toBe(true);
    cloud.applyWorkspaceRecords('products', [
      { id: 'p1', title: 'summary', favorite: false, listSummary: true },
    ]);
    cloud.applyWorkspaceRecords('products', [
      {
        id: 'p1',
        title: 'summary',
        favorite: false,
        sourceContent: { descriptions: ['full detail'] },
        ingredientInsights: [{ evidence: 'full ingredient evidence' }],
        listSummary: false,
      },
    ]);
    cloud.applyWorkspaceRecords('products', [
      {
        id: 'p1',
        title: 'summary',
        favorite: false,
        ingredientInsights: [{ evidence: '' }],
        listSummary: true,
      },
    ]);
    expect(mock.state.products[0].ingredientInsights[0].evidence).toBe(
      'full ingredient evidence',
    );
    expect(mock.state.products[0].listSummary).toBe(false);
    mock.request.mockClear();
    await cloud.syncCloudWorkspace();
    expect(mock.request.mock.calls.map((call) => call[0])).toEqual([
      'server_workspace_bootstrap',
    ]);
    mock.state.products[0].favorite = true;
    await cloud.syncCloudWorkspace();
    expect(mock.request).toHaveBeenCalledWith(
      'server_workspace_sync',
      {
        patch: true,
        entries: [{ key: 'products:p1', value: { favorite: true } }],
      },
      30_000,
    );
    expect(mock.state.products[0].sourceContent.descriptions).toEqual([
      'full detail',
    ]);
  });
  it('task polling requests the task channel without reloading keywords or products', async () => {
    mock.request.mockImplementation(async (action) =>
      action === 'server_workspace_delta'
        ? { tasks: [], revisions: { tasks: '1' } }
        : {
            entries: [],
            revisions: { published: '1' },
            active: 0,
            generatedAt: 'now',
            indexing: false,
          },
    );
    const cloud =
      await import('../apps/web-antd/src/views/intelligence/cloud-workspace');
    cloud.setWorkspaceReadMode('tasks');
    await cloud.syncCloudWorkspace();
    expect(mock.request.mock.calls.map((call) => call[0])).toEqual([
      'server_workspace_bootstrap',
      'server_workspace_delta',
    ]);
    expect(mock.request.mock.calls[1][1]).toEqual({
      channels: ['tasks'],
      revisions: {},
    });
  });
});

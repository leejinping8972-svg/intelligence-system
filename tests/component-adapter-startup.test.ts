import type { Router } from '../apps/web-antd/node_modules/vue-router/dist/vue-router.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryHistory, createRouter } from '../apps/web-antd/node_modules/vue-router/dist/vue-router.js';

const mocks = vi.hoisted(() => ({
  componentImport: vi.fn(),
  formImport: vi.fn(),
  initComponentAdapter: vi.fn(),
  initSetupVbenForm: vi.fn(),
}));

vi.mock('../apps/web-antd/src/adapter/component', async () => {
  await mocks.componentImport();
  return { initComponentAdapter: mocks.initComponentAdapter };
});
vi.mock('../apps/web-antd/src/adapter/form', async () => {
  await mocks.formImport();
  return { initSetupVbenForm: mocks.initSetupVbenForm };
});

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.componentImport.mockResolvedValue(undefined);
  mocks.formImport.mockResolvedValue(undefined);
  mocks.initComponentAdapter.mockResolvedValue(undefined);
  mocks.initSetupVbenForm.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(serverMode = true) {
  const beforeResolve = vi.fn();
  const { setupComponentAdapters } = await import('../apps/web-antd/src/adapter/setup');
  const ready = setupComponentAdapters({ beforeResolve } as unknown as Router, serverMode);
  const resolve = beforeResolve.mock.calls[0]?.[0] as ((to: { name: string }) => Promise<void> | undefined) | undefined;
  return { ready, resolve };
}

describe('component adapter startup scheduling', () => {
  it('renders the native server login without loading framework adapters', async () => {
    const { resolve } = await setup();
    await resolve!({ name: 'Login' });
    expect(mocks.componentImport).not.toHaveBeenCalled();
    expect(mocks.formImport).not.toHaveBeenCalled();
    expect(mocks.initComponentAdapter).not.toHaveBeenCalled();
    expect(mocks.initSetupVbenForm).not.toHaveBeenCalled();
  });

  it('does not load adapters for a protected route redirected to the native login', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/overview', name: 'Overview', component: {} },
        { path: '/auth/login', name: 'Login', component: {} },
      ],
    });
    router.beforeEach((to) => to.name === 'Overview' ? { name: 'Login' } : true);
    const { setupComponentAdapters } = await import('../apps/web-antd/src/adapter/setup');
    await setupComponentAdapters(router, true);
    await router.push('/overview');
    expect(router.currentRoute.value.name).toBe('Login');
    expect(mocks.componentImport).not.toHaveBeenCalled();
    expect(mocks.formImport).not.toHaveBeenCalled();
  });

  it('does not block native intelligence pages on unused framework form adapters', async () => {
    mocks.componentImport.mockReturnValue(new Promise(() => {}));
    mocks.formImport.mockReturnValue(new Promise(() => {}));
    const { resolve } = await setup();
    for (const name of ['HciOverview', 'HciResearch', 'HciSettings', 'HciProducts']) {
      expect(resolve!({ name })).toBeUndefined();
    }
    expect(mocks.componentImport).not.toHaveBeenCalled();
    expect(mocks.formImport).not.toHaveBeenCalled();
    await resolve!({ name: 'Login' });
  });

  it('starts both imports together and finishes adapter setup before the workspace can render', async () => {
    let imported!: () => void;
    let initialized!: () => void;
    mocks.componentImport.mockReturnValue(new Promise<void>((resolve) => { imported = resolve; }));
    mocks.initComponentAdapter.mockReturnValue(new Promise<void>((resolve) => { initialized = resolve; }));
    const { resolve } = await setup();
    const ready = resolve!({ name: 'Overview' });
    let rendered = false;
    void ready!.then(() => { rendered = true; });
    await vi.waitFor(() => {
      expect(mocks.componentImport).toHaveBeenCalledTimes(1);
      expect(mocks.formImport).toHaveBeenCalledTimes(1);
    });
    expect(mocks.initComponentAdapter).not.toHaveBeenCalled();
    expect(rendered).toBe(false);
    imported();
    await vi.waitFor(() => expect(mocks.initComponentAdapter).toHaveBeenCalledTimes(1));
    expect(mocks.initSetupVbenForm).not.toHaveBeenCalled();
    expect(rendered).toBe(false);
    initialized();
    await ready;
    expect(mocks.initSetupVbenForm).toHaveBeenCalledTimes(1);
    expect(rendered).toBe(true);
  });

  it('shares concurrent initialization and reuses completed adapters', async () => {
    let initialized!: () => void;
    mocks.initComponentAdapter.mockReturnValue(new Promise<void>((resolve) => { initialized = resolve; }));
    const { resolve } = await setup();
    const overview = resolve!({ name: 'Overview' });
    const otherPage = resolve!({ name: 'Research' });
    await vi.waitFor(() => expect(mocks.initComponentAdapter).toHaveBeenCalledTimes(1));
    initialized();
    await Promise.all([overview, otherPage]);
    await resolve!({ name: 'Settings' });
    expect(mocks.initComponentAdapter).toHaveBeenCalledTimes(1);
    expect(mocks.initSetupVbenForm).toHaveBeenCalledTimes(1);
  });

  it('allows retrying navigation after adapter initialization fails', async () => {
    mocks.initComponentAdapter.mockRejectedValueOnce(new Error('temporary initialization failure'));
    const { resolve } = await setup();
    await expect(resolve!({ name: 'Overview' })).rejects.toThrow('temporary initialization failure');
    expect(mocks.initSetupVbenForm).not.toHaveBeenCalled();
    await resolve!({ name: 'Overview' });
    expect(mocks.initComponentAdapter).toHaveBeenCalledTimes(2);
    expect(mocks.initSetupVbenForm).toHaveBeenCalledTimes(1);
  });

  it('initializes adapters eagerly for the existing non-server authentication pages', async () => {
    const { ready, resolve } = await setup(false);
    await ready;
    expect(resolve).toBeUndefined();
    expect(mocks.initComponentAdapter).toHaveBeenCalledTimes(1);
    expect(mocks.initSetupVbenForm).toHaveBeenCalledTimes(1);
    expect(mocks.initComponentAdapter.mock.invocationCallOrder[0]).toBeLessThan(mocks.initSetupVbenForm.mock.invocationCallOrder[0]!);
  });
});

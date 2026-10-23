import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  initPreferences: vi.fn(),
  initializePublicBranding: vi.fn(),
  refreshSession: vi.fn(),
  unmountGlobalLoading: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock('../packages/preferences/src/index', () => ({
  initPreferences: mocks.initPreferences,
  updatePreferences: mocks.updatePreferences,
}));
vi.mock('../packages/utils/src/index', () => ({ unmountGlobalLoading: mocks.unmountGlobalLoading }));
vi.mock('../apps/web-antd/src/preferences', () => ({ overridesPreferences: {}, preferencesExtension: {} }));
vi.mock('../apps/web-antd/src/public-branding', () => ({ initializePublicBranding: mocks.initializePublicBranding }));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({ refreshSession: mocks.refreshSession, serverMode: true }));
vi.mock('../apps/web-antd/src/bootstrap', () => ({ bootstrap: mocks.bootstrap }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.initPreferences.mockResolvedValue(undefined);
  mocks.initializePublicBranding.mockReturnValue(new Promise(() => {}));
  mocks.refreshSession.mockReturnValue(new Promise(() => {}));
  mocks.bootstrap.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('application startup scheduling', () => {
  it('loads the application while branding is slow and starts the session check immediately', async () => {
    await import('../apps/web-antd/src/main');
    await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(1));
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.initPreferences.mock.invocationCallOrder[0]!);
    expect(mocks.unmountGlobalLoading).toHaveBeenCalledTimes(1);
  });

  it('keeps the startup overlay until the application has mounted its ready route', async () => {
    let mounted!: () => void;
    mocks.bootstrap.mockReturnValue(new Promise<void>((resolve) => { mounted = resolve; }));
    await import('../apps/web-antd/src/main');
    await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(1));
    expect(mocks.unmountGlobalLoading).not.toHaveBeenCalled();
    mounted();
    await vi.waitFor(() => expect(mocks.unmountGlobalLoading).toHaveBeenCalledTimes(1));
  });

  it('continues startup when the speculative session check fails', async () => {
    mocks.refreshSession.mockRejectedValue(new Error('temporary outage'));
    await import('../apps/web-antd/src/main');
    await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(1));
    expect(mocks.unmountGlobalLoading).toHaveBeenCalledTimes(1);
  });
});

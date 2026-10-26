import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initApplication: vi.fn(),
  refreshSession: vi.fn(),
  startSso: vi.fn(),
  session: {
    checked: false,
    user: null as null | { id: string },
    setupRequired: false,
    ssoEnabled: false,
  },
}));
vi.mock('../apps/web-antd/src/application', () => ({
  initApplication: mocks.initApplication,
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  login: vi.fn(),
  session: mocks.session,
  refreshSession: mocks.refreshSession,
  startSso: mocks.startSso,
}));
import { startLoginEntry } from '../apps/web-antd/src/login-entry';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BASE_URL', '/admin/');
  vi.stubEnv('VITE_ROUTER_HISTORY', 'history');
  history.replaceState(null, '', '/admin/auth/login');
  Object.assign(mocks.session, {
    checked: false,
    user: null,
    setupRequired: false,
    ssoEnabled: false,
  });
  mocks.initApplication.mockResolvedValue(undefined);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('direct login entry', () => {
  it('mounts editable login fields before slow status, without importing the workspace', async () => {
    mocks.refreshSession.mockReturnValue(new Promise(() => {}));
    startLoginEntry();
    const input = document.querySelector<HTMLInputElement>(
      'input[name="username"]',
    )!;
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(false);
    expect(document.querySelector('#__app-loading__')).toBeNull();
    expect(mocks.initApplication).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
  });
  it('preserves the destination for an existing session and removes login after mounting the workspace', async () => {
    let mounted!: () => void;
    mocks.initApplication.mockReturnValue(
      new Promise<void>((resolve) => {
        mounted = resolve;
      }),
    );
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.user = { id: 'qa' };
    });
    history.replaceState(null, '', '/admin/products?market=VN');
    startLoginEntry();
    await vi.waitFor(() =>
      expect(mocks.initApplication).toHaveBeenCalledTimes(1),
    );
    expect(document.querySelector('#login-entry')).not.toBeNull();
    expect(location.pathname + location.search).toBe(
      '/admin/products?market=VN',
    );
    mounted();
    await vi.waitFor(() =>
      expect(document.querySelector('#login-entry')).toBeNull(),
    );
  });
  it('shows a recoverable status error and allows reconnection', async () => {
    mocks.refreshSession
      .mockRejectedValueOnce(new Error('QA offline'))
      .mockResolvedValueOnce(undefined);
    startLoginEntry();
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        'QA offline',
      ),
    );
    document.querySelector<HTMLButtonElement>('.admin-login-retry')!.click();
    await vi.waitFor(() =>
      expect(mocks.refreshSession).toHaveBeenCalledTimes(2),
    );
    expect(mocks.initApplication).not.toHaveBeenCalled();
  });
  it('starts configured SSO and respects logout and failure fallback', async () => {
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.ssoEnabled = true;
    });
    startLoginEntry();
    await vi.waitFor(() =>
      expect(mocks.startSso).toHaveBeenCalledWith('/auth/login'),
    );
    for (const reason of ['skip', 'failed', 'unavailable']) {
      mocks.startSso.mockClear();
      history.replaceState(null, '', `/admin/auth/login?sso=${reason}`);
      startLoginEntry();
      await Promise.resolve();
      expect(mocks.startSso).not.toHaveBeenCalled();
    }
    expect(mocks.initApplication).not.toHaveBeenCalled();
  });
});

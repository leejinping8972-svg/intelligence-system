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

let dispose: () => void;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function expectNoLogin() {
  expect(document.querySelector('form')).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(document.querySelector('.admin-login')).toBeNull();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('BASE_URL', '/admin/');
  vi.stubEnv('VITE_ROUTER_HISTORY', 'history');
  history.replaceState(null, '', '/admin/auth/login');
  Object.assign(mocks.session, {
    checked: false,
    user: null,
    setupRequired: false,
    ssoEnabled: false,
  });
  mocks.refreshSession.mockImplementation(async () => {
    mocks.session.checked = true;
  });
  mocks.initApplication.mockResolvedValue(undefined);
});

afterEach(() => {
  dispose?.();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('direct login entry', () => {
  it('keeps credentials hidden while a slow cookie check is pending', () => {
    mocks.refreshSession.mockReturnValue(new Promise(() => {}));
    dispose = startLoginEntry();
    expectNoLogin();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('正在进入工作区');
    expect(mocks.initApplication).not.toHaveBeenCalled();
  });

  it('never mounts login for a valid cookie, including while the workspace loads', async () => {
    const status = deferred();
    const workspace = deferred();
    mocks.initApplication.mockReturnValue(workspace.promise);
    mocks.refreshSession.mockImplementation(async () => {
      await status.promise;
      mocks.session.checked = true;
      mocks.session.user = { id: 'qa' };
    });
    history.replaceState(null, '', '/admin/products?market=VN#details');
    dispose = startLoginEntry();
    expectNoLogin();
    status.resolve();
    await vi.waitFor(() => expect(mocks.initApplication).toHaveBeenCalledTimes(1));
    expectNoLogin();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    expect(location.pathname + location.search + location.hash).toBe('/admin/products?market=VN#details');
    workspace.resolve();
    await vi.waitFor(() => expect(document.querySelector('#login-entry')).toBeNull());
    expectNoLogin();
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('opens the workspace directly when visiting the login URL with a valid cookie', async () => {
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.checked = true;
      mocks.session.user = { id: 'qa' };
    });
    dispose = startLoginEntry();
    expectNoLogin();
    await vi.waitFor(() => expect(document.querySelector('#login-entry')).toBeNull());
    expect(mocks.initApplication).toHaveBeenCalledTimes(1);
    expect(mocks.startSso).not.toHaveBeenCalled();
  });

  it('shows login only after the server confirms there is no valid cookie', async () => {
    const status = deferred();
    mocks.refreshSession.mockImplementation(async () => {
      await status.promise;
      mocks.session.checked = true;
    });
    dispose = startLoginEntry();
    expectNoLogin();
    status.resolve();
    await vi.waitFor(() => expect(document.querySelector('input[name="username"]')).not.toBeNull());
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(mocks.initApplication).not.toHaveBeenCalled();
  });

  it('preserves first administrator setup after the status response', async () => {
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.checked = true;
      mocks.session.setupRequired = true;
      mocks.session.ssoEnabled = true;
    });
    dispose = startLoginEntry();
    expectNoLogin();
    await vi.waitFor(() => expect(document.querySelector('input[name="setupCode"]')).not.toBeNull());
    expect(document.querySelector('h1')?.textContent).toBe('创建首位管理员');
    expect(mocks.startSso).not.toHaveBeenCalled();
  });

  it('shows a connection error without a login form and recovers into the workspace', async () => {
    mocks.refreshSession
      .mockRejectedValueOnce(new Error('服务暂时不可用（HTTP 502）'))
      .mockImplementationOnce(async () => {
        mocks.session.checked = true;
        mocks.session.user = { id: 'qa' };
      });
    dispose = startLoginEntry();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('HTTP 502'));
    expectNoLogin();
    document.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(document.querySelector('#login-entry')).toBeNull());
    expect(mocks.refreshSession).toHaveBeenCalledTimes(2);
    expect(mocks.initApplication).toHaveBeenCalledTimes(1);
  });

  it('allows retry after workspace loading fails for an authenticated session', async () => {
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.checked = true;
      mocks.session.user = { id: 'qa' };
    });
    mocks.initApplication.mockRejectedValueOnce(new Error('QA module unavailable'));
    dispose = startLoginEntry();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('QA module unavailable'));
    expectNoLogin();
    document.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(document.querySelector('#login-entry')).toBeNull());
    expect(mocks.initApplication).toHaveBeenCalledTimes(2);
  });

  it('keeps credentials hidden during automatic SSO and preserves the hash destination', async () => {
    vi.stubEnv('VITE_ROUTER_HISTORY', 'hash');
    history.replaceState(null, '', '/admin/#/products?market=US');
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.checked = true;
      mocks.session.ssoEnabled = true;
    });
    dispose = startLoginEntry();
    await vi.waitFor(() => expect(mocks.startSso).toHaveBeenCalledWith('/products?market=US'));
    expectNoLogin();
    expect(mocks.initApplication).not.toHaveBeenCalled();
  });

  it.each(['skip', 'failed', 'unavailable'])('preserves local login fallback for sso=%s', async (reason) => {
    history.replaceState(null, '', `/admin/auth/login?sso=${reason}`);
    mocks.refreshSession.mockImplementation(async () => {
      mocks.session.checked = true;
      mocks.session.ssoEnabled = true;
    });
    dispose = startLoginEntry();
    await vi.waitFor(() => expect(document.querySelector('form')).not.toBeNull());
    expect(mocks.startSso).not.toHaveBeenCalled();
    expect(mocks.initApplication).not.toHaveBeenCalled();
    if (reason === 'failed') expect(document.querySelector('[role="alert"]')?.textContent).toContain('单点登录未完成');
  });
});

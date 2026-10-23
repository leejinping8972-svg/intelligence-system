import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = {
  id: 'test-admin',
  username: 'admin',
  displayName: 'Test administrator',
  role: 'admin' as const,
  enabled: true,
  createdAt: 1,
  lastLoginAt: 2,
};
const anonymous = { setupRequired: false, ssoEnabled: true, user: null };

function response(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('session startup requests', () => {
  it('shares the initial cookie check between startup and route navigation', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetch);
    const { refreshSession, session } = await import('../apps/web-antd/src/views/intelligence/session');
    const startup = refreshSession();
    const navigation = refreshSession();
    expect(startup).toBe(navigation);
    expect(session.checked).toBe(false);
    pending.resolve(response(anonymous));
    await Promise.all([startup, navigation]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api', expect.objectContaining({
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'auth_status' }),
    }));
    expect(session).toMatchObject({ ...anonymous, checked: true });
  });

  it('retries a failed check and preserves setup and SSO configuration', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ ...anonymous, setupRequired: true }));
    vi.stubGlobal('fetch', fetch);
    const { refreshSession, session } = await import('../apps/web-antd/src/views/intelligence/session');
    await expect(refreshSession()).rejects.toThrow('offline');
    expect(session.checked).toBe(false);
    await refreshSession();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session).toMatchObject({ ...anonymous, setupRequired: true, checked: true });
  });

  it('uses the authenticated login response without another status request', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ user }));
    vi.stubGlobal('fetch', fetch);
    const { login, session } = await import('../apps/web-antd/src/views/intelligence/session');
    session.ssoEnabled = true;
    await login({ username: 'admin', password: 'test-password' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      action: 'auth_login', username: 'admin', password: 'test-password',
    });
    expect(session).toMatchObject({ checked: true, setupRequired: false, ssoEnabled: true, user });
  });

  it('adopts the initial administrator response and exits setup mode', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ user }));
    vi.stubGlobal('fetch', fetch);
    const { login, session } = await import('../apps/web-antd/src/views/intelligence/session');
    session.setupRequired = true;
    await login({ username: 'admin', setupCode: 'synthetic-code' }, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body).action).toBe('auth_setup');
    expect(session).toMatchObject({ checked: true, setupRequired: false, user });
  });

  it('keeps a failed login unauthenticated and reports the server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Invalid credentials' }, 400)));
    const { login, session } = await import('../apps/web-antd/src/views/intelligence/session');
    await expect(login({ username: 'admin', password: 'invalid' })).rejects.toThrow('Invalid credentials');
    expect(session.user).toBeNull();
  });

  it('does not let a late anonymous check replace a completed login', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ user })));
    const { login, refreshSession, session } = await import('../apps/web-antd/src/views/intelligence/session');
    const checking = refreshSession();
    await login({ username: 'admin', password: 'test-password' });
    pending.resolve(response(anonymous));
    await checking;
    expect(session.user).toEqual(user);
  });

  it('does not let an expired response from an older session clear a completed login', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ user })));
    const { login, refreshSession, session } = await import('../apps/web-antd/src/views/intelligence/session');
    const checking = refreshSession();
    await login({ username: 'admin', password: 'test-password' });
    pending.resolve(response({ error: 'Expired session' }, 401));
    await expect(checking).rejects.toThrow('Expired session');
    expect(session.user).toEqual(user);
  });

  it('clears an expired session and discards a status request started before expiry', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ error: 'Expired session' }, 401)));
    const { adminRequest, refreshSession, session } = await import('../apps/web-antd/src/views/intelligence/session');
    session.user = user;
    const checking = refreshSession();
    await expect(adminRequest('auth_touch')).rejects.toThrow('Expired session');
    pending.resolve(response({ ...anonymous, user }));
    await checking;
    expect(session.user).toBeNull();
  });

  it('can recheck the new cookie while a previous status request is still in flight', async () => {
    const previous = deferred<ReturnType<typeof response>>();
    const current = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn()
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce(response({ user }))
      .mockReturnValueOnce(current.promise);
    vi.stubGlobal('fetch', fetch);
    const { login, refreshSession, session } = await import('../apps/web-antd/src/views/intelligence/session');
    const olderCheck = refreshSession();
    await login({ username: 'admin', password: 'test-password' });
    const newerCheck = refreshSession();
    expect(fetch).toHaveBeenCalledTimes(3);
    previous.resolve(response(anonymous));
    await olderCheck;
    expect(refreshSession()).toBe(newerCheck);
    current.resolve(response({ ...anonymous, user }));
    await newerCheck;
    expect(session.user).toEqual(user);
  });

  it('registers activity listeners once after authentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...anonymous, user })));
    const { login, refreshSession } = await import('../apps/web-antd/src/views/intelligence/session');
    await refreshSession();
    await refreshSession();
    await login({ username: 'admin', password: 'test-password' });
    expect(window.addEventListener).toHaveBeenCalledTimes(2);
    expect(window.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), { passive: true });
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), { passive: true });
  });
});

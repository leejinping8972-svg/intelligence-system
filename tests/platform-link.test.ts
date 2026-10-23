import { createApp, KeepAlive, nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  user: {
    id: 'synthetic-researcher',
    username: 'synthetic-researcher',
    displayName: '合成研究员',
    role: 'researcher' as const,
    enabled: true,
    createdAt: 1,
    lastLoginAt: 1,
  },
}));

vi.mock('../apps/web-antd/src/views/intelligence/session', async () => {
  const { reactive } = await import('vue');
  return { session: reactive({ user: { ...fixture.user } }) };
});
vi.mock('@vben/icons', () => ({
  Copy: () => null,
  ExternalLink: () => null,
  LockKeyhole: () => null,
  RotateCw: () => null,
  Unlink2: () => null,
}));

import PlatformLinkSettings from '../apps/web-antd/src/views/intelligence/components/PlatformLinkSettings.vue';
import {
  generatePlatformLinkKey,
  getPlatformLinkSettings,
  launchPlatformLink,
  PlatformLinkError,
  platformLinkRedirect,
  savePlatformLinkPeer,
} from '../apps/web-antd/src/views/intelligence/platform-link';
import { session } from '../apps/web-antd/src/views/intelligence/session';

const fakeRawKey = 'qa-only-key-never-sent-to-peer';
const state = 'a'.repeat(43);
const validRedirect = `https://ai.chatviva.com/api/platform-link/v1/login/start?source=selection-platform&state=${state}`;

function settings() {
  return { ok: true, enabled: true, key: null, peer: null };
}

function response(payload: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => payload,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLDivElement | undefined;
const visible = ref(true);
function mountSettings(keepAlive = false) {
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(
    keepAlive
      ? {
          components: { KeepAlive, PlatformLinkSettings },
          setup: () => ({ visible }),
          template:
            '<KeepAlive><PlatformLinkSettings v-if="visible" /></KeepAlive>',
        }
      : PlatformLinkSettings,
  );
  app.mount(root);
}

async function click(label: string) {
  let button: HTMLButtonElement | undefined;
  await vi.waitFor(() => {
    button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) =>
        element.textContent?.replaceAll(/\s/g, '') ===
        label.replaceAll(/\s/g, ''),
    );
    expect(button, label).toBeDefined();
    expect(button!.disabled, label).toBe(false);
  });
  button!.click();
  await nextTick();
}

async function enterPeerKey() {
  const input = root!.querySelector<HTMLInputElement>(
    'input[placeholder="填写 AI 账号的专用 key"]',
  )!;
  input.value = fakeRawKey;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  return input;
}

beforeEach(() => {
  vi.restoreAllMocks();
  visible.value = true;
  session.user = { ...fixture.user };
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  root?.remove();
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('platform link browser API boundaries', () => {
  it('uses one bounded same-origin request and sends secrets only in the body', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await savePlatformLinkPeer(fakeRawKey);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/platform-link/v1/peer-key',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ key: fakeRawKey }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not echo an untrusted error message or repeat a failed write', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response(
        { ok: false, code: 'PEER_KEY_INVALID', message: fakeRawKey },
        400,
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const operation = savePlatformLinkPeer(fakeRawKey);
    await expect(operation).rejects.toThrow('AI 登录 key 无效或已撤销');
    await expect(operation).rejects.not.toThrow(fakeRawKey);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing peer distinguishable so the header can open settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({ ok: false, code: 'PEER_NOT_CONFIGURED' }, 409),
      ),
    );
    await expect(launchPlatformLink()).rejects.toMatchObject({
      code: 'PEER_NOT_CONFIGURED',
      message: '请先配置 AI 账号登录 key',
    });
  });

  it('rejects failed or malformed API payloads with a safe message', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(null))
      .mockRejectedValueOnce(new Error(fakeRawKey));
    vi.stubGlobal('fetch', fetch);
    await expect(getPlatformLinkSettings()).rejects.toThrow(PlatformLinkError);
    await expect(generatePlatformLinkKey()).rejects.not.toThrow(fakeRawKey);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('allows only the exact peer login route with one source and one short-lived state', async () => {
    expect(platformLinkRedirect(validRedirect)).toBe(validRedirect);
    for (const value of [
      'javascript:alert(1)',
      '/api/platform-link/v1/login/start',
      validRedirect.replace('https:', 'http:'),
      validRedirect.replace('ai.chatviva.com', 'ai.chatviva.com.evil.test'),
      validRedirect.replace('ai.chatviva.com', 'user@ai.chatviva.com'),
      validRedirect.replace('/login/start', '/login/other'),
      validRedirect.replace('selection-platform', 'unrecognized'),
      validRedirect.replace(state, 'short'),
      `${validRedirect}&state=${state}`,
      `${validRedirect}&source=selection-platform`,
      `${validRedirect}&redirect=https://evil.test`,
      `${validRedirect}#callback`,
    ]) {
      expect(() => platformLinkRedirect(value), value).toThrow(PlatformLinkError);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: true, redirect: validRedirect })),
    );
    await expect(launchPlatformLink()).resolves.toBe(validRedirect);
  });
});

describe('personal platform link settings (synthetic transport)', () => {
  it('lets a researcher generate only after consent and clears the one-time key on close', async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        response(
          url.endsWith('/generate')
            ? { ok: true, key: fakeRawKey }
            : settings(),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    mountSettings();
    await vi.waitFor(() => expect(root!.textContent).toContain('尚未生成'));
    await click('生成 key');
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('持有新 key 的人可以'),
    );
    await click('生成并授权');
    await vi.waitFor(() =>
      expect(document.querySelector('.platform-link-revealed')?.textContent).toBe(
        fakeRawKey,
      ),
    );
    expect(document.querySelectorAll('.ant-modal-content')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/platform-link/v1/account-key/generate',
      expect.objectContaining({ body: '{"confirm":true}' }),
    );
    await click('完成');
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toContain(fakeRawKey),
    );
    expect(localStorage.length).toBe(0);
  });

  it('clears an entered peer key after rejection and never displays a returned key in an error', async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/peer-key')
          ? response(
              { ok: false, code: 'PEER_KEY_INVALID', message: fakeRawKey },
              400,
            )
          : response(settings()),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    mountSettings();
    await vi.waitFor(() => expect(root!.textContent).toContain('尚未配置 AI 账号'));
    const input = await enterPeerKey();
    await click('验证并保存');
    await vi.waitFor(() =>
      expect(root!.querySelector('[role="alert"]')?.textContent).toContain(
        'AI 登录 key 无效或已撤销',
      ),
    );
    expect(input.value).toBe('');
    expect(document.body.textContent).not.toContain(fakeRawKey);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('requires confirmation to replace or remove the saved target identity', async () => {
    let hasPeer = true;
    const fetch = vi.fn((url: string, options: RequestInit) => {
      if (url.endsWith('/peer-key')) hasPeer = options.method !== 'DELETE';
      return Promise.resolve(
        response(
          url.endsWith('/settings')
            ? {
                ...settings(),
                peer: hasPeer
                  ? {
                      subject: 'qa-target-account',
                      display_name: '合成 AI 账号',
                      display_hint: 'qa…hint',
                      updated_at: 1,
                    }
                  : null,
              }
            : { ok: true },
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);
    mountSettings();
    await vi.waitFor(() => expect(root!.textContent).toContain('合成 AI 账号'));
    const input = await enterPeerKey();
    await click('验证并保存');
    expect(fetch).toHaveBeenCalledTimes(1);
    await click('验证并更换');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(input.value).toBe('');
    await click('移除配置');
    expect(fetch).toHaveBeenCalledTimes(3);
    await click('确认移除');
    await vi.waitFor(() => expect(root!.textContent).toContain('尚未配置 AI 账号'));
    expect(fetch).toHaveBeenCalledWith(
      '/api/platform-link/v1/peer-key',
      expect.objectContaining({ method: 'DELETE', body: '{}' }),
    );
  });

  it('blocks writes while the integration is disabled', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...settings(), enabled: false }));
    vi.stubGlobal('fetch', fetch);
    mountSettings();
    await vi.waitFor(() => expect(root!.textContent).toContain('接入尚未启用'));
    expect(root!.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    const generate = [...root!.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '生成 key',
    );
    expect(generate!.disabled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('discards a late generated secret after a different user takes over', async () => {
    const generated = deferred<ReturnType<typeof response>>();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/generate')
          ? generated.promise
          : Promise.resolve(response(settings())),
      ),
    );
    mountSettings();
    await vi.waitFor(() => expect(root!.textContent).toContain('尚未生成'));
    await click('生成 key');
    await click('生成并授权');
    session.user = { ...fixture.user, id: 'another-synthetic-account' };
    await nextTick();
    generated.resolve(response({ ok: true, key: fakeRawKey }));
    await nextTick();
    await nextTick();
    expect(document.body.textContent).not.toContain(fakeRawKey);
    expect(document.querySelector('.platform-link-revealed')).toBeNull();
  });

  it('clears the one-time key when a cached page deactivates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          response(
            url.endsWith('/generate')
              ? { ok: true, key: fakeRawKey }
              : settings(),
          ),
        ),
      ),
    );
    mountSettings(true);
    await vi.waitFor(() => expect(root!.textContent).toContain('尚未生成'));
    await click('生成 key');
    await click('生成并授权');
    await vi.waitFor(() => expect(document.body.textContent).toContain(fakeRawKey));
    visible.value = false;
    await nextTick();
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toContain(fakeRawKey),
    );
    visible.value = true;
    await nextTick();
    await nextTick();
    expect(document.body.textContent).not.toContain(fakeRawKey);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { brandingEvent, initializePublicBranding } from '../apps/web-antd/src/public-branding';

const brand = { appName: 'Configured workspace', logo: '/admin/hci-logo.svg' };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  delete (window as Window & { __hciBranding?: unknown }).__hciBranding;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('public branding startup', () => {
  it('loads the server name in a new browser without a cached workspace', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => brand });
    vi.stubGlobal('fetch', fetch);
    await initializePublicBranding(true, '/admin/');
    expect(document.title).toBe(brand.appName);
    expect(JSON.parse(localStorage.getItem('intelligence-public-branding-v1')!)).toEqual(brand);
    expect(fetch).toHaveBeenCalledWith('/api', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
  });

  it('starts the app promptly and applies configuration arriving after the old three-second limit', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })));
    const startup = initializePublicBranding(true, '/admin/');
    await vi.advanceTimersByTimeAsync(1500);
    await startup;
    const listener = vi.fn();
    window.addEventListener(brandingEvent, listener, { once: true });
    await vi.advanceTimersByTimeAsync(3500);
    resolve({ ok: true, json: async () => brand });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.title).toBe(brand.appName);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: brand }));
  });

  it('replaces a stale cached name and retries one temporary failure', async () => {
    localStorage.setItem('intelligence-public-branding-v1', JSON.stringify({ ...brand, appName: 'Old name' }));
    const fetch = vi.fn().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ ok: true, json: async () => brand });
    vi.stubGlobal('fetch', fetch);
    const startup = initializePublicBranding(true, '/admin/');
    expect(document.title).toBe('Old name');
    await vi.advanceTimersByTimeAsync(1000);
    await startup;
    expect(document.title).toBe(brand.appName);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves cached branding when both requests fail without an endless retry loop', async () => {
    localStorage.setItem('intelligence-public-branding-v1', JSON.stringify(brand));
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const startup = initializePublicBranding(true, '/admin/');
    await vi.advanceTimersByTimeAsync(2000);
    await startup;
    expect(document.title).toBe(brand.appName);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

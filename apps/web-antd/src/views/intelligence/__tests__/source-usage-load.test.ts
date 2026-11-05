import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUsageLoader } from '../source-usage-load';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type Snapshot = { total: number; refreshing?: boolean; refreshError?: string };
const setup = () => {
  const apply = vi.fn(),
    busy = vi.fn(),
    error = vi.fn();
  return {
    loader: createUsageLoader<Snapshot>({ apply, busy, error }),
    apply,
    busy,
    error,
  };
};

afterEach(() => vi.useRealTimers());
describe('usage snapshots remain visible while the latest query finishes', () => {
  it('shows stale results immediately and polls the same refresh without forcing another scan', async () => {
    vi.useFakeTimers();
    const { loader, apply, busy } = setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ total: 18, refreshing: true })
      .mockResolvedValueOnce({ total: 19 });
    const pending = loader.load(request, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith({ total: 18, refreshing: true });
    expect(busy).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(true);
    expect(request.mock.calls).toEqual([[true], [false]]);
    expect(apply).toHaveBeenLastCalledWith({ total: 19 });
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('never turns a cold pending response into zero totals', async () => {
    vi.useFakeTimers();
    const { loader, apply } = setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ loading: true, retryAfterMs: 1000 })
      .mockResolvedValueOnce({ total: 8 });
    const pending = loader.load(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ total: 8 });
  });

  it('ignores an older query that finishes after a new filter', async () => {
    const { loader, apply } = setup();
    const first = deferred<Snapshot>();
    const old = loader.load(() => first.promise);
    await loader.load(async () => ({ total: 2 }));
    first.resolve({ total: 99 });
    expect(await old).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith({ total: 2 });
  });

  it('stops background retries when leaving the page', async () => {
    vi.useFakeTimers();
    const { loader, apply, busy } = setup();
    const request = vi.fn().mockResolvedValue({ total: 4, refreshing: true });
    const pending = loader.load(request);
    await vi.advanceTimersByTimeAsync(0);
    loader.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('keeps the prior displayed values when refresh fails and reports stale snapshot errors', async () => {
    const { loader, apply, error } = setup();
    await loader.load(async () => ({ total: 9 }));
    await loader.load(async () => {
      throw Error('refresh failed');
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenLastCalledWith('refresh failed');
    await loader.load(async () => ({
      total: 9,
      refreshError: 'showing previous results',
    }));
    expect(error).toHaveBeenLastCalledWith('showing previous results');
  });
});

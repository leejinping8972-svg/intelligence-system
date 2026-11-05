import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceReadClient } from '../apps/web-antd/src/views/intelligence/workspace-read-client';

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
describe('workspace read scheduling', () => {
  it('does not start a request cancelled between scheduling and dispatch', async () => {
    const client = createWorkspaceReadClient(1);
    const controller = new AbortController();
    const request = vi.fn(async () => 'unused');
    const reading = client.run('list', request, { signal: controller.signal });
    const cancelled = reading.catch(error => error);
    await Promise.resolve();
    controller.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
    expect(await client.run('next', async () => 'ready')).toBe('ready');
  });
  it('releases a slot when a request throws before returning a promise', async () => {
    const client = createWorkspaceReadClient(1);
    await expect(client.run('bad', () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(await client.run('next', async () => 'ready')).toBe('ready');
  });
  it('bounds concurrent downloads and starts the visible list before queued statistics', async () => {
    const client = createWorkspaceReadClient(1);
    const hold = deferred<string>();
    const calls: string[] = [];
    const first = client.run('old-list', async () => {
      calls.push('old');
      return hold.promise;
    });
    await tick();
    const stats = client.run(
      'stats',
      async () => {
        calls.push('stats');
        return 'stats';
      },
      { priority: 'background' },
    );
    const visible = client.run('visible', async () => {
      calls.push('visible');
      return 'visible';
    });
    await tick();
    expect(calls).toEqual(['old']);
    hold.resolve('old');
    await Promise.all([first, stats, visible]);
    expect(calls).toEqual(['old', 'visible', 'stats']);
  });
  it('coalesces readers without letting one closed tab cancel another tab', async () => {
    const client = createWorkspaceReadClient();
    const hold = deferred<string>();
    let sharedSignal!: AbortSignal;
    const request = vi.fn(async (signal: AbortSignal) => {
      sharedSignal = signal;
      return hold.promise;
    });
    const closed = new AbortController();
    const a = client.run('same-user:list', request, { signal: closed.signal });
    const b = client.run('same-user:list', request);
    const cancelled = a.catch(error => error);
    await tick();
    closed.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(false);
    hold.resolve('rows');
    expect(await b).toBe('rows');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('removes obsolete filters from the queue before they reach the server', async () => {
    const client = createWorkspaceReadClient(1);
    const hold = deferred<string>();
    const first = client.run('first', () => hold.promise);
    await tick();
    const controller = new AbortController();
    const obsoleteRequest = vi.fn(async () => 'obsolete');
    const obsolete = client.run('obsolete-filter', obsoleteRequest, {
      signal: controller.signal,
    });
    const cancelled = obsolete.catch(error => error);
    controller.abort();
    hold.resolve('done');
    await first;
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(obsoleteRequest).not.toHaveBeenCalled();
  });
  it('aborts an abandoned download and permits a clean request for the same list', async () => {
    const client = createWorkspaceReadClient(1);
    const controller = new AbortController();
    let signal!: AbortSignal;
    const abandoned = client.run(
      'list',
      (current) =>
        new Promise<string>((_resolve, reject) => {
          signal = current;
          current.addEventListener('abort', () => reject(current.reason), {
            once: true,
          });
        }),
      { signal: controller.signal },
    );
    const cancelled = abandoned.catch(error => error);
    await tick();
    controller.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(signal.aborted).toBe(true);
    expect(await client.run('list', async () => 'new rows')).toBe('new rows');
  });
  it('releases a failed request without replaying it or blocking a different list', async () => {
    const client = createWorkspaceReadClient(1);
    const request = vi.fn(async () => {
      throw new Error('timeout');
    });
    await expect(client.run('bad-list', request)).rejects.toThrow('timeout');
    expect(await client.run('good-list', async () => 'ok')).toBe('ok');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

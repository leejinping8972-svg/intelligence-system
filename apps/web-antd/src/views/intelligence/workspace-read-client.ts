type Priority = 'foreground' | 'background';
interface ReadOptions {
  signal?: AbortSignal;
  priority?: Priority;
}
interface Flight {
  key: string;
  priority: Priority;
  controller: AbortController;
  readers: number;
  started: boolean;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  request: (signal: AbortSignal) => Promise<unknown>;
}

export const workspaceReadActions = new Set([
  'server_monitor_workspace',
  'server_task_page',
  'server_workspace_list',
  'server_workspace_overview',
  'server_workspace_facets',
  'server_workspace_bootstrap',
]);

// Keep route changes from filling the browser and database connection queues.
// Writes and collection tasks never enter this queue.
export function createWorkspaceReadClient(concurrency = 2) {
  const flights = new Map<string, Flight>();
  const queued: Flight[] = [];
  let active = 0;
  function forget(flight: Flight) {
    if (flights.get(flight.key) === flight) flights.delete(flight.key);
  }
  function pump() {
    while (active < concurrency && queued.length > 0) {
      let index = queued.findIndex(
        (flight) => flight.priority === 'foreground',
      );
      if (index < 0) index = 0;
      const flight = queued.splice(index, 1)[0];
      if (!flight || flight.controller.signal.aborted) continue;
      flight.started = true;
      active++;
      void Promise.resolve()
        .then(() => {
          flight.controller.signal.throwIfAborted();
          return flight.request(flight.controller.signal);
        })
        .then(flight.resolve, flight.reject)
        .finally(() => {
          active--;
          forget(flight);
          pump();
        });
    }
  }
  function run<T>(
    key: string,
    request: (signal: AbortSignal) => Promise<T>,
    options: ReadOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    let flight = flights.get(key);
    if (!flight) {
      let resolve!: Flight['resolve'], reject!: Flight['reject'];
      const promise = new Promise<unknown>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      flight = {
        key,
        request,
        promise,
        resolve,
        reject,
        controller: new AbortController(),
        readers: 0,
        started: false,
        priority: options.priority || 'foreground',
      };
      flights.set(key, flight);
      queued.push(flight);
    } else if (options.priority !== 'background')
      flight.priority = 'foreground';
    const shared = flight;
    shared.readers++;
    const result = new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true;
        options.signal?.removeEventListener('abort', abort);
        shared.readers--;
        callback();
      };
      const abort = () =>
        finish(() => {
          reject(
            options.signal?.reason || new DOMException('Aborted', 'AbortError'),
          );
          if (shared.readers === 0) {
            shared.controller.abort();
            forget(shared);
            if (!shared.started) {
              const index = queued.indexOf(shared);
              if (index !== -1) queued.splice(index, 1);
              shared.reject(shared.controller.signal.reason);
            }
          }
        });
      options.signal?.addEventListener('abort', abort, { once: true });
      shared.promise.then(
        (value) => finish(() => resolve(value as T)),
        (error) => finish(() => reject(error)),
      );
    });
    queueMicrotask(pump);
    return result;
  }
  return { run };
}

import type { WatchStopHandle } from 'vue';

import { nextTick, toRaw, watch } from 'vue';

interface Options {
  entries: () => Map<string, object>;
  changed: (key: string, record: object, snapshot: string) => void;
  removed?: (key: string) => void;
  select?: (key: string, record: object) => unknown;
  snapshot?: (key: string, record: object) => string;
}

// Collection membership is cheap to observe. Nested edits belong to the one
// record that changed, rather than a synchronous scan of every cached record.
export function createWorkspaceChangeTracker(options: Options) {
  const tracked = new Map<
    string,
    { record: object; snapshot: string; stop: WatchStopHandle }
  >();
  const snapshot = (key: string, record: object) =>
    options.snapshot?.(key, record) ?? JSON.stringify(toRaw(record));
  function capture(key: string) {
    const entry = tracked.get(key);
    if (!entry) return;
    const value = snapshot(key, entry.record);
    if (entry.snapshot === value) return;
    entry.snapshot = value;
    options.changed(key, entry.record, value);
  }
  function reconcile(remote = false) {
    const entries = options.entries();
    for (const [key, entry] of tracked) {
      if (entries.get(key) === entry.record) continue;
      entry.stop();
      tracked.delete(key);
      if (!remote && !entries.has(key)) options.removed?.(key);
    }
    for (const [key, record] of entries) {
      if (tracked.has(key)) continue;
      const stop = watch(
        () => options.select?.(key, record) ?? record,
        () => capture(key),
        { deep: true, flush: 'pre' },
      );
      const value = snapshot(key, record);
      tracked.set(key, { record, snapshot: value, stop });
      if (!remote) options.changed(key, record, value);
    }
  }
  const stopMembership = watch(options.entries, () => reconcile(), {
    flush: 'pre',
  });
  reconcile(true);
  return {
    // A synchronous readback can arrive in the same turn as a local edit,
    // before Vue's batched watchers run. Capture only the records it will touch.
    capture(keys: Iterable<string>) {
      reconcile();
      for (const key of keys) {
        capture(key);
      }
    },
    acceptRemote() {
      reconcile(true);
    },
    async flush() {
      await nextTick();
    },
    reset() {
      for (const entry of tracked.values()) entry.stop();
      tracked.clear();
      reconcile(true);
    },
    stop() {
      stopMembership();
      for (const entry of tracked.values()) entry.stop();
      tracked.clear();
    },
  };
}

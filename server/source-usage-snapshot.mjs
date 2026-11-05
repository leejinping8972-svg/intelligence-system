import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { deflateRaw, inflateRaw } from 'node:zlib';

const compress = promisify(deflateRaw);
const decompress = promisify(inflateRaw);
export const USAGE_SNAPSHOT_NAME = 'read:source-usage:events:v1';

export async function encodeUsageSnapshot(snapshot) {
  return {
    version: 1,
    codec: 'deflate-json-v1',
    checkedAt: snapshot.checkedAt,
    body: (
      await compress(Buffer.from(JSON.stringify(snapshot.events)))
    ).toString('base64'),
  };
}

export async function decodeUsageSnapshot(value, now = Date.now()) {
  if (
    value?.version !== 1 ||
    value.codec !== 'deflate-json-v1' ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    Date.parse(value.checkedAt) > now + 60_000
  )
    return;
  try {
    const events = JSON.parse(
      (
        await decompress(Buffer.from(value.body, 'base64'), {
          maxOutputLength: 32 * 1024 * 1024,
        })
      ).toString('utf8'),
    );
    if (
      Array.isArray(events) &&
      events.every(
        (event) =>
          typeof event?.id === 'string' && typeof event.sourceId === 'string',
      )
    )
      return { events, checkedAt: value.checkedAt };
  } catch {
    // This is a disposable read cache. Rebuild it from the request journals.
  }
}

// Both dashboard panels use the same completed snapshot and the same in-flight
// rebuild. Stale results remain readable while a new, complete snapshot loads.
export function createUsageSnapshotReader({
  read,
  load,
  save,
  now = Date.now,
  ttl = 30_000,
  minInterval = 15_000,
  onCacheError = () => {},
}) {
  const states = new WeakMap();
  let generation = 0;
  const cached = async (connection, { refresh = false } = {}) => {
    let state = states.get(connection);
    if (!state) {
      state = { lastStarted: -Infinity };
      states.set(connection, state);
      state.hydrating = Promise.resolve()
        .then(() => load?.(connection))
        .then((value) => decodeUsageSnapshot(value, now()))
        .then((snapshot) => {
          state.snapshot = snapshot;
          state.generation = generation;
        })
        .catch(onCacheError)
        .finally(() => {
          state.hydrating = null;
        });
    }
    if (state.hydrating) await state.hydrating;
    const expired =
      !state.snapshot || now() - Date.parse(state.snapshot.checkedAt) >= ttl;
    const invalidated =
      state.generation !== generation &&
      now() - state.lastStarted >= minInterval;
    if (
      !state.pending &&
      now() >= (state.retryAt || 0) &&
      (refresh || expired || invalidated)
    ) {
      state.lastStarted = now();
      state.error = null;
      state.retryAt = 0;
      const startedGeneration = generation;
      state.pending = Promise.resolve()
        .then(() => read(connection))
        .then(async (events) => {
          const snapshot = { events, checkedAt: new Date(now()).toISOString() };
          state.snapshot = snapshot;
          state.generation = startedGeneration;
          state.error = null;
          try {
            await save?.(await encodeUsageSnapshot(snapshot), connection);
          } catch (error) {
            onCacheError(error);
          }
          return snapshot;
        })
        .catch((error) => {
          state.error = error;
          state.retryAt = now() + 5000;
        })
        .finally(() => {
          state.pending = null;
        });
    }
    if (!state.snapshot && state.pending) await state.pending;
    if (!state.snapshot)
      throw state.error || new Error('消耗记录暂不可用，请稍后重试');
    return {
      ...state.snapshot,
      refreshing: Boolean(state.pending),
      ...(state.error
        ? { refreshError: '更新未完成，正在显示上次结果，请稍后刷新。' }
        : {}),
    };
  };
  cached.invalidate = () => {
    generation++;
  };
  return cached;
}

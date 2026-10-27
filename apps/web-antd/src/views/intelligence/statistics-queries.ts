import type { ComputedRef } from 'vue';

import type { RadarSourceCoverage } from './radar-engine';
import type { radarStatistics } from './statistics-engine';

import { onActivated, onDeactivated, onUnmounted, ref, shallowRef, watch } from 'vue';

import { cloudRequest, cloudWorkspace } from './cloud-workspace';
import { serverMode, session } from './session';

export interface StatisticsSnapshot {
  generatedAt: string;
  revision: string;
  summary?: ReturnType<typeof radarStatistics>;
  coverage?: RadarSourceCoverage[] | { total: number; observed: number; verified: number; percent: number };
  publicDataStale?: boolean;
}
interface Result<T> { rows: T[]; total: number; page: number; pageSize: number; snapshot: null | StatisticsSnapshot }
const cache = new Map<string, { at: number; result: Result<unknown> }>();
const flights = new Map<string, Promise<Result<unknown>>>();
const keyOf = (input: object) => JSON.stringify([session.user?.id, input]);
const summaries = new Map<string, Pick<Result<unknown>, 'snapshot' | 'total'>>();
export function useStatistics<T>(query: ComputedRef<Record<string, unknown>>) {
  const rows = shallowRef<T[]>([]);
  const snapshot = shallowRef<null | StatisticsSnapshot>(null);
  const error = ref('');
  const loading = ref(false);
  const total = ref(0);
  const pagination = shallowRef({ page: 1, pageSize: 20 });
  let active = true;
  let sequence = 0;
  let displayed = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function reload(force = false) {
    if (!serverMode || !active || query.value.enabled === false || !session.user) return;
    const ticket = ++sequence;
    const { enabled: _enabled, ...input } = query.value;
    const key = keyOf(input);
    const { page: _page, pageSize: _pageSize, ...scope } = input;
    const scopeKey = keyOf(scope);
    const previous = cache.get(key);
    if (displayed !== key) {
      rows.value = previous?.result.rows as T[] || [];
      total.value = previous?.result.total ?? summaries.get(scopeKey)?.total ?? 0;
      snapshot.value = previous?.result.snapshot ?? summaries.get(scopeKey)?.snapshot ?? null;
    }
    displayed = key;
    loading.value = true;
    try {
      let result = previous?.result;
      if (force || !previous || Date.now() - previous.at >= 30_000) {
        let flight = flights.get(key);
        if (!flight) {
          flight = cloudRequest<Result<unknown>>('server_workspace_statistics', input).then(result => {
            cache.delete(key);
            cache.set(key, { at: Date.now(), result });
            while (cache.size > 24) cache.delete(cache.keys().next().value!);
            return result;
          }).finally(() => flights.delete(key));
          flights.set(key, flight);
        }
        result = await flight;
      }
      if (ticket !== sequence || !active || key !== keyOf(input)) return;
      if (!result!.snapshot && snapshot.value) return;
      rows.value = result!.rows as T[];
      total.value = result!.total;
      pagination.value = { page: result!.page, pageSize: result!.pageSize };
      snapshot.value = result!.snapshot;
      if (result!.snapshot) {
        summaries.delete(scopeKey);
        summaries.set(scopeKey, { snapshot: result!.snapshot, total: result!.total });
        while (summaries.size > 24) summaries.delete(summaries.keys().next().value!);
      }
      error.value = '';
    } catch (cause) {
      if (ticket === sequence) error.value = cause instanceof Error ? cause.message : '统计读取失败';
    } finally {
      if (ticket === sequence) loading.value = false;
      if (active && ticket === sequence) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { if (document.visibilityState !== 'hidden') void reload(true); else schedule(); }, snapshot.value ? 30_000 : 3000);
      }
    }
  }
  function schedule(force = false) {
    sequence++;
    if (timer) clearTimeout(timer);
    if (query.value.enabled === false || !session.user) { loading.value = false; return; }
    if (active) timer = setTimeout(() => void reload(force), force ? 500 : 100);
  }
  watch([query, () => session.user?.id], () => schedule(), { deep: true, immediate: true });
  watch(() => cloudWorkspace.publishedRevision, () => { if (active) schedule(true); });
  onActivated(() => { active = true; schedule(); });
  const stop = () => { active = false; sequence++; loading.value = false; if (timer) clearTimeout(timer); };
  onDeactivated(stop);
  onUnmounted(stop);
  return { rows, total, snapshot, loading, error, pagination, reload };
}

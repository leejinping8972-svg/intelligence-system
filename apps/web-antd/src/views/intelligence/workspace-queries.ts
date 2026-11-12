import type { ComputedRef, Ref } from 'vue';

import {
  computed,
  onActivated,
  onDeactivated,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import {
  applyWorkspaceRecords,
  cloudRequest,
  cloudWorkspace,
} from './cloud-workspace';
import { state } from './data';
import { serverMode, session } from './session';

export type ReadCollection =
  | 'ads'
  | 'advertisers'
  | 'keywords'
  | 'products'
  | 'sites';
export interface PageResult<T> {
  marketSummary?: {
    total: number;
    priority: number;
    pending: number;
    selected: number;
  };
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  revisions: Record<string, string>;
  indexing: boolean;
  error?: string;
}
interface CachedPage {
  value: PageResult<unknown>;
  at: number;
}
const cache = new Map<string, CachedPage>();
function keyOf(input: object) {
  return JSON.stringify([session.user?.id, input]);
}
async function requestPage<T>(
  input: object,
  force = false,
  signal?: AbortSignal,
): Promise<PageResult<T>> {
  const key = keyOf(input);
  const cached = cache.get(key);
  if (
    !force &&
    cached &&
    Date.now() - cached.at < 30_000 &&
    cached.value.revisions.published === cloudWorkspace.publishedRevision
  )
    return cached.value as PageResult<T>;
  return cloudRequest<PageResult<T>>(
    'server_workspace_list',
    input as Record<string, unknown>,
    { signal, priority: 'foreground' },
  ).then((value) => {
    signal?.throwIfAborted();
    cache.delete(key);
    cache.set(key, { value, at: Date.now() });
    while (cache.size > 20) cache.delete(cache.keys().next().value!);
    return value;
  });
}
export function useWorkspaceList<T extends { id: string }>(
  collection: ReadCollection,
  query: ComputedRef<Record<string, unknown>>,
  page: Ref<number>,
  pageSize: Ref<number>,
) {
  const error = ref('');
  const loading = ref(false);
  const rows = shallowRef<T[]>([]);
  const total = ref(0);
  const facets = ref<Record<string, any[]>>({});
  const marketSummary = shallowRef<PageResult<T>['marketSummary']>();
  let summaryMarket: unknown;
  const order = ref('descend');
  const sort = ref('');
  let active = true;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let displayedKey = '';
  let facetScope = '';
  let loadedKey = '';
  let hydratedPage: PageResult<T> | undefined;
  const input = computed(() => ({
    ...query.value,
    collection,
    page: page.value,
    pageSize: pageSize.value,
    sort: sort.value,
    order: order.value,
  }));
  function hydrate(records: T[]) {
    if (collection === 'advertisers') return records;
    applyWorkspaceRecords(collection, records);
    const stored = state[collection] as unknown as T[];
    const byId = new Map(stored.map((record) => [record.id, record]));
    return records.map((record) => byId.get(record.id)!);
  }
  function display(result: PageResult<T>) {
    if (hydratedPage !== result) {
      rows.value = hydrate(result.rows);
      hydratedPage = result;
    }
    total.value = result.total;
    marketSummary.value = result.marketSummary;
  }
  async function reload(force = false) {
    if (!serverMode || !active || query.value.enabled === false) return;
    const ticket = ++sequence;
    const requested = input.value;
    if (summaryMarket !== query.value.market) {
      marketSummary.value = undefined;
      summaryMarket = query.value.market;
    }
    const requestedKey = keyOf(requested);
    const cached = cache.get(requestedKey);
    if (displayedKey !== requestedKey || controller?.signal.aborted) {
      controller?.abort();
      controller = new AbortController();
    }
    controller ||= new AbortController();
    const signal = controller.signal;
    if (!cached && displayedKey !== requestedKey) {
      rows.value = [];
      total.value = 0;
      hydratedPage = undefined;
    }
    displayedKey = requestedKey;
    if (cached) {
      display(cached.value as PageResult<T>);
      loadedKey = requestedKey;
    }
    loading.value = !cached && loadedKey !== requestedKey;
    try {
      const result = await requestPage<T>(requested, force, signal);
      if (ticket !== sequence || !active) return;
      display(result);
      loadedKey = requestedKey;
      page.value = result.page;
      error.value = result.error || '';
      const scope = JSON.stringify([
        session.user?.id,
        collection,
        query.value.market,
      ]);
      if (facetScope !== scope) {
        facetScope = scope;
        void cloudRequest<{ facets: Record<string, any[]> }>(
          'server_workspace_facets',
          { collection, market: query.value.market },
          { signal, priority: 'background' },
        )
          .then((value) => {
            if (facetScope === scope) facets.value = value.facets;
          })
          .catch(() => {
            if (facetScope === scope) facetScope = '';
          });
      }
    } catch (cause) {
      if (ticket === sequence)
        error.value = cause instanceof Error ? cause.message : '列表读取失败';
    } finally {
      if (ticket === sequence) loading.value = false;
    }
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    // Invalidate before the debounce so a late response cannot replace new filters.
    sequence += 1;
    timer = setTimeout(() => void reload(), query.value.search ? 250 : 0);
  }
  watch(input, schedule, { deep: true, immediate: true });
  watch(
    () => session.user?.id,
    () => {
      facetScope = '';
      facets.value = {};
      schedule();
    },
  );
  watch(
    () => cloudWorkspace.publishedRevision,
    () => {
      if (active) void reload(true);
    },
  );
  onActivated(() => {
    active = true;
    void reload();
  });
  const stop = () => {
    active = false;
    sequence += 1;
    controller?.abort();
    if (timer) clearTimeout(timer);
    loading.value = false;
    hydratedPage = undefined;
  };
  onDeactivated(stop);
  onUnmounted(stop);
  async function selectAll() {
    const requested = { ...query.value, collection };
    let result;
    try {
      result = await cloudRequest<{
        rows: T[];
        count: number;
        selectionId: string;
      }>('server_workspace_selection', requested);
    } catch (cause) {
      error.value = (cause as Error).message;
      throw cause;
    }
    if (
      JSON.stringify(requested) !==
      JSON.stringify({ ...query.value, collection })
    )
      throw new Error('筛选条件已变化，请重新选择');
    if (result.count !== result.rows.length)
      throw new Error('选择数量不一致，请重试');
    return hydrate(result.rows);
  }
  function tableChange(
    _pagination: unknown,
    _filters: unknown,
    value:
      | { columnKey?: number | string; order?: null | string }
      | { columnKey?: number | string; order?: null | string }[],
  ) {
    const sorter = Array.isArray(value) ? value[0] || {} : value;
    sort.value =
      sorter.columnKey === 'assessment' || sorter.columnKey === 'score'
        ? 'score'
        : String(sorter.columnKey || '');
    order.value = sorter.order || 'descend';
  }
  return {
    rows,
    sort,
    order,
    total,
    loading,
    error,
    facets,
    marketSummary,
    reload,
    selectAll,
    async exportRows(ids: string[] = []): Promise<T[]> {
      const keys = ids.length
        ? [...new Set(ids)]
        : (await selectAll()).map((row) => row.id);
      const records: T[] = [];
      for (let offset = 0; offset < keys.length; offset += 50) {
        const batch = keys.slice(offset, offset + 50);
        const result = await cloudRequest<{ rows: T[] }>(
          'server_workspace_export',
          { collection, ids: batch },
        );
        if (result.rows.length !== batch.length)
          throw new Error('导出记录已变化，请刷新后重试');
        records.push(...result.rows);
      }
      return records;
    },
    tableChange,
  };
}

export interface OverviewSnapshot {
  todayNewProducts?: { count: number; day: string };
  monitoring?: { total: number; problems: number };
  counts: {
    keywords: number;
    sites: number;
    products: number;
    ads?: number;
    reviews: number;
  };
  keywords: {
    total: number;
    priority: number;
    pending: number;
    selected: number;
    completed: number;
    active: number;
  };
  productMarkets: Record<string, number>;
  topKeywords: import('./data').Keyword[];
  revision: string;
  generatedAt: string;
}
const overviewCache = new Map<string, OverviewSnapshot>();
export function useOverviewSnapshot() {
  const error = ref('');
  const indexing = ref(false);
  const loading = ref(false);
  const snapshot = shallowRef<OverviewSnapshot>();
  let active = true;
  let sequence = 0;
  let controller: AbortController | undefined;
  let scope = '';
  async function reload() {
    if (!serverMode || !active) return;
    const ticket = ++sequence;
    const key = keyOf({ market: state.market });
    if (key !== scope || controller?.signal.aborted) {
      controller?.abort();
      controller = new AbortController();
      scope = key;
    }
    controller ||= new AbortController();
    snapshot.value = overviewCache.get(key);
    loading.value = !snapshot.value;
    try {
      const result = await cloudRequest<{
        snapshot: null | OverviewSnapshot;
        indexing: boolean;
        error?: string;
      }>(
        'server_workspace_overview',
        { market: state.market },
        { signal: controller.signal, priority: 'background' },
      );
      if (ticket !== sequence || !active) return;
      if (result.snapshot) {
        snapshot.value = result.snapshot;
        overviewCache.set(key, result.snapshot);
      }
      indexing.value = result.indexing;
      error.value = result.error || '';
    } catch (cause) {
      if (ticket === sequence) error.value = (cause as Error).message;
    } finally {
      if (ticket === sequence) loading.value = false;
    }
  }
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const startRefresh = () => {
    refreshTimer ??= setInterval(() => void reload(), 60_000);
  };
  startRefresh();
  watch(
    () => [session.user?.id, state.market, cloudWorkspace.publishedRevision],
    () => void reload(),
    { immediate: true },
  );
  onActivated(() => {
    active = true;
    startRefresh();
    void reload();
  });
  const stop = () => {
    active = false;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
    sequence += 1;
    controller?.abort();
    loading.value = false;
  };
  onDeactivated(stop);
  onUnmounted(stop);
  return { snapshot, error, loading, indexing, reload };
}

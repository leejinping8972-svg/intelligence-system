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
const flights = new Map<string, Promise<PageResult<unknown>>>();
function keyOf(input: object) {
  return JSON.stringify([session.user?.id, input]);
}
async function requestPage<T>(
  input: object,
  force = false,
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
  let flight = flights.get(key);
  if (!flight) {
    flight = cloudRequest<PageResult<unknown>>(
      'server_workspace_list',
      input as Record<string, unknown>,
    )
      .then((value) => {
        cache.delete(key);
        cache.set(key, { value, at: Date.now() });
        while (cache.size > 20) cache.delete(cache.keys().next().value!);
        return value;
      })
      .finally(() => {
        flights.delete(key);
      });
    flights.set(key, flight);
  }
  return flight as Promise<PageResult<T>>;
}
export function useWorkspaceList<T extends { id: string }>(
  collection: ReadCollection,
  query: ComputedRef<Record<string, unknown>>,
  page: Ref<number>,
  pageSize: Ref<number>,
) {
  const rows = shallowRef<T[]>([]),
    total = ref(0),
    loading = ref(false),
    error = ref('');
  const facets = ref<Record<string, any[]>>({});
  const sort = ref(''),
    order = ref('descend');
  let active = true,
    sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let facetScope = '',
    displayedKey = '';
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
    return records.map((record) => stored.find((row) => row.id === record.id)!);
  }
  async function reload(force = false) {
    if (!serverMode || !active || query.value.enabled === false) return;
    const ticket = ++sequence;
    const requested = input.value;
    const requestedKey = keyOf(requested);
    const cached = cache.get(requestedKey);
    if (!cached && displayedKey !== requestedKey) {
      rows.value = [];
      total.value = 0;
    }
    displayedKey = requestedKey;
    if (cached) {
      rows.value = hydrate(cached.value.rows as T[]);
      total.value = cached.value.total;
    }
    loading.value = true;
    try {
      const result = await requestPage<T>(requested, force);
      if (ticket !== sequence || !active) return;
      rows.value = hydrate(result.rows);
      total.value = result.total;
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
        )
          .then((value) => {
            if (facetScope === scope) facets.value = value.facets;
          })
          .catch(() => {
            if (facetScope === scope) facetScope = '';
          });
      }
      if (
        !result.indexing &&
        result.page * result.pageSize < result.total &&
        flights.size < 2 &&
        document.visibilityState !== 'hidden'
      )
        void requestPage({ ...requested, page: result.page + 1 }).catch(
          () => {},
        );
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
    if (timer) clearTimeout(timer);
    loading.value = false;
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
    reload,
    selectAll,
    async exportRows(ids: string[] = []): Promise<T[]> {
      const keys = ids.length ? [...new Set(ids)] : (await selectAll()).map((row) => row.id);
      const records: T[] = [];
      for (let offset = 0; offset < keys.length; offset += 50) {
        const batch = keys.slice(offset, offset + 50);
        const result = await cloudRequest<{ rows: T[] }>('server_workspace_export', { collection, ids: batch });
        if (result.rows.length !== batch.length) throw new Error('导出记录已变化，请刷新后重试');
        records.push(...result.rows);
      }
      return records;
    },
    tableChange,
  };
}

export interface OverviewSnapshot {
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
  const snapshot = shallowRef<OverviewSnapshot>(),
    error = ref(''),
    loading = ref(false),
    indexing = ref(false);
  let active = true,
    sequence = 0;
  async function reload() {
    if (!serverMode || !active) return;
    const ticket = ++sequence;
    const key = keyOf({ market: state.market });
    snapshot.value = overviewCache.get(key);
    loading.value = true;
    try {
      const result = await cloudRequest<{
        snapshot: OverviewSnapshot | null;
        indexing: boolean;
        error?: string;
      }>('server_workspace_overview', { market: state.market });
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
  watch(
    () => [session.user?.id, state.market, cloudWorkspace.publishedRevision],
    () => void reload(),
    { immediate: true },
  );
  onActivated(() => {
    active = true;
    void reload();
  });
  const stop = () => {
    active = false;
    sequence += 1;
  };
  onDeactivated(stop);
  onUnmounted(stop);
  return { snapshot, error, loading, indexing, reload };
}

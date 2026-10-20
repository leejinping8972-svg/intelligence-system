import type { ComputedRef } from 'vue';

import { computed, ref, watch } from 'vue';

export interface ScoreFilter {
  min: null | number;
  max: null | number;
  status: 'all' | 'scored' | 'unscored';
}
export const emptyScoreFilter = (): ScoreFilter => ({
  min: null,
  max: null,
  status: 'all',
});
export function matchesScore(
  score: null | number | undefined,
  filter: ScoreFilter,
) {
  const scored = typeof score === 'number' && Number.isFinite(score);
  if (filter.status === 'unscored') return !scored;
  if (!scored)
    return (
      filter.status === 'all' && filter.min === null && filter.max === null
    );
  if (filter.min !== null && filter.max !== null && filter.min > filter.max)
    return false;
  return (
    (filter.min === null || score >= filter.min) &&
    (filter.max === null || score <= filter.max)
  );
}

// Selection operates on the complete filtered collection, independently of pagination.
// Request limits remain the responsibility of each existing action; selecting never submits.
export function useFilteredSelection<
  T extends { id: string; dataNature?: string },
>(rows: ComputedRef<T[]>, ids = ref<string[]>([])) {
  const selectable = computed(() =>
    rows.value.filter((item) => item.dataNature !== 'demo'),
  );
  const selected = computed(() => {
    const selectedIds = new Set(ids.value);
    return selectable.value.filter((item) => selectedIds.has(item.id));
  });
  const selectAll = () => {
    ids.value = selectable.value.map((item) => item.id);
  };
  const clear = () => {
    ids.value = [];
  };
  watch(
    () => selectable.value.map((item) => item.id).join('\0'),
    () => {
      const available = new Set(selectable.value.map((item) => item.id));
      ids.value = ids.value.filter((id) => available.has(id));
    },
    { flush: 'sync' },
  );
  let selectingAll = false;
  const rowSelection = computed(() => ({
    preserveSelectedRowKeys: true,
    selectedRowKeys: ids.value,
    getCheckboxProps: (item: T) => ({ disabled: item.dataNature === 'demo' }),
    onChange: (keys: (number | string)[]) => {
      if (!selectingAll) ids.value = keys.map(String);
    },
    onSelectAll: (checked: boolean) => {
      selectingAll = true;
      if (checked) selectAll();
      else clear();
      queueMicrotask(() => {
        selectingAll = false;
      });
    },
  }));
  return { ids, selected, selectable, selectAll, clear, rowSelection };
}

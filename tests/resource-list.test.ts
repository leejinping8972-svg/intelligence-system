import { computed, nextTick, ref } from 'vue';

import { describe, expect, it } from 'vitest';

import {
  emptyScoreFilter,
  matchesScore,
  useFilteredSelection,
} from '../apps/web-antd/src/views/intelligence/resource-list';

describe('score intervals', () => {
  it('uses inclusive bounds and keeps unknown distinct from zero', () => {
    const filter = { ...emptyScoreFilter(), min: 0, max: 80 };
    expect(
      [null, undefined, 0, 79.9, 80, 81, Number.NaN].filter((score) =>
        matchesScore(score, filter),
      ),
    ).toEqual([0, 79.9, 80]);
    expect(matchesScore(null, emptyScoreFilter())).toBe(true);
    expect(matchesScore(0, { ...filter, status: 'unscored' })).toBe(false);
    expect(matchesScore(null, { ...filter, status: 'unscored' })).toBe(true);
  });
  it('supports a single bound, scored-only and invalid intervals', () => {
    expect(matchesScore(100, { ...emptyScoreFilter(), min: 90 })).toBe(true);
    expect(matchesScore(0, { ...emptyScoreFilter(), max: 0 })).toBe(true);
    expect(
      matchesScore(null, { ...emptyScoreFilter(), status: 'scored' }),
    ).toBe(false);
    expect(matchesScore(80, { ...emptyScoreFilter(), min: 90, max: 50 })).toBe(
      false,
    );
  });
});
describe('all filtered records selection', () => {
  it('retains checked records across server pages and selects the complete server result', async () => {
    const input = ref([{ id: '1' }, { id: '2' }]);
    const all = Array.from({ length: 34 }, (_, i) => ({ id: String(i + 1) }));
    const selection = useFilteredSelection(computed(() => input.value), undefined, async () => all);
    selection.rowSelection.value.onChange(['1']);
    input.value = [{ id: '3' }, { id: '4' }];
    await nextTick();
    expect(selection.ids.value).toEqual(['1']);
    expect(selection.selected.value.map((r) => r.id)).toEqual(['1']);
    await selection.selectAll();
    expect(selection.ids.value).toHaveLength(34);
    expect(selection.selected.value).toHaveLength(34);
  });
  it('selects more than 100 records across pages without truncation or submission', async () => {
    const input = ref(
      Array.from({ length: 220 }, (_, i) => ({
        id: String(i),
        dataNature: i === 219 ? 'demo' : 'collected',
      })),
    );
    const selection = useFilteredSelection(computed(() => input.value));
    selection.rowSelection.value.onSelectAll(true);
    selection.rowSelection.value.onChange(['0', '1', '2']);
    expect(selection.ids.value).toHaveLength(219);
    expect(selection.ids.value).not.toContain('219');
    await nextTick();
    selection.rowSelection.value.onChange(['5']);
    expect(selection.ids.value).toEqual(['5']);
    selection.selectAll();
    input.value = input.value.filter((item) => Number(item.id) >= 210);
    expect(selection.ids.value).toEqual([
      '210',
      '211',
      '212',
      '213',
      '214',
      '215',
      '216',
      '217',
      '218',
    ]);
    selection.clear();
    expect(selection.selected.value).toEqual([]);
  });
  it('does not mix records from a new market or filtering result', () => {
    const market = ref('US');
    const selection = useFilteredSelection(
      computed(() => [{ id: market.value }]),
    );
    selection.selectAll();
    market.value = 'MX';
    expect(selection.ids.value).toEqual([]);
    selection.selectAll();
    expect(selection.ids.value).toEqual(['MX']);
  });
});

import { effectScope } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = vi.hoisted(() => ({ id: 'qa-a' }));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  session: { user },
}));
import { useListFilterMemory } from '../apps/web-antd/src/views/intelligence/list-filter-memory';

const scopes: ReturnType<typeof effectScope>[] = [];
function controls(list: string) {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => {
    const memory = useListFilterMemory(list);
    return {
      search: memory.field('search', ''),
      dates: memory.field<string[]>('dates', []),
      score: memory.field<{
        min: null | number;
        max: null | number;
        status: string;
      }>('score', { min: null, max: null, status: 'all' }),
      sort: memory.field('sort', ''),
      page: memory.field('page', 1),
      order: memory.field('order', 'descend'),
      optional: memory.field<string | undefined>('optional', undefined),
    };
  })!;
}
beforeEach(() => {
  localStorage.clear();
  user.id = 'qa-a';
});
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  vi.restoreAllMocks();
});

describe('list filter memory', () => {
  it.each(['research', 'selected-keywords', 'products', 'sites', 'ads'])(
    'restores %s after unmount with search, nested filters, dates, sort and pagination',
    (list) => {
      const first = controls(list);
      first.search.value = '合成关键词';
      first.dates.value = ['2026-11-01', '2026-11-12'];
      first.score.value.min = 65;
      first.sort.value = 'collectedAt';
      first.order.value = 'ascend';
      first.page.value = 3;
      first.optional.value = 'linked-record';
      scopes.at(-1)!.stop();
      const returned = controls(list);
      expect(
        Object.fromEntries(
          Object.entries(returned).map(([key, value]) => [key, value.value]),
        ),
      ).toEqual(
        Object.fromEntries(
          Object.entries(first).map(([key, value]) => [key, value.value]),
        ),
      );
      returned.optional.value = undefined;
      expect(controls(list).optional.value).toBeUndefined();
    },
  );
  it('keeps different lists and accounts independent', () => {
    controls('products').search.value = 'product-query';
    expect(controls('sites').search.value).toBe('');
    user.id = 'qa-b';
    expect(controls('products').search.value).toBe('');
    user.id = 'qa-a';
    expect(controls('products').search.value).toBe('product-query');
  });
  it('ignores corrupt or incompatible stored data and tolerates blocked storage', () => {
    const key = 'hci-list-filters-v1:qa-a:products';
    localStorage.setItem(key, '{broken');
    expect(controls('products').search.value).toBe('');
    localStorage.setItem(
      key,
      JSON.stringify({
        search: 123,
        dates: { invalid: true },
        score: { min: 'invalid' },
        page: null,
      }),
    );
    const restored = controls('products');
    expect(restored.search.value).toBe('');
    expect(restored.dates.value).toEqual([]);
    expect(restored.score.value).toEqual({
      min: null,
      max: null,
      status: 'all',
    });
    expect(restored.page.value).toBe(1);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      restored.search.value = 'still usable';
    }).not.toThrow();
  });
});

import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { state } from './data';

export function useWeeklySummaryFilter(path: string) {
  const route = useRoute();
  const router = useRouter();
  const week = computed(() => route.path === path && typeof route.query.summaryWeek === 'string' ? route.query.summaryWeek : '');
  const onlyNew = computed(() => Boolean(week.value) && route.query.summaryNew === '1');
  const query = computed(() => week.value ? { summaryWeek: week.value, summaryNew: onlyNew.value ? '1' : '0' } : {});
  function onEntry(reset: () => void) {
    watch(() => [route.path, week.value, onlyNew.value, route.query.market], () => {
      if (!week.value) return;
      const market = route.query.market;
      if (['ALL', 'MX', 'US', 'VN'].includes(String(market))) state.market = market as typeof state.market;
      reset();
    }, { immediate: true });
  }
  function clear() {
    const { summaryWeek: _week, summaryNew: _new, ...rest } = route.query;
    void router.replace({ path: route.path, query: rest });
  }
  return { week, onlyNew, query, onEntry, clear };
}

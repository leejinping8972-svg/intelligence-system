import type { Ref } from 'vue';

import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** Explicit URL filters take priority; ordinary visits may restore the last dropdown value. */
export function useSiteKeywordFilter(remembered?: Ref<string>) {
  const route = useRoute();
  const router = useRouter();
  if (remembered)
    watch(
      () => route.query.keywordId,
      (value, previous) => {
        if (route.path !== '/sites') return;
        if (typeof value === 'string') remembered.value = value;
        else if (previous !== undefined) remembered.value = '';
      },
      { immediate: true },
    );
  return computed({
    get: () =>
      typeof route.query.keywordId === 'string'
        ? route.query.keywordId
        : remembered?.value || '',
    set: (value: string | undefined) => {
      if (remembered) remembered.value = value || '';
      const { keywordId: _keywordId, ...query } = route.query;
      void router.replace({
        path: route.path,
        query: value ? { ...query, keywordId: value } : query,
      });
    },
  });
}

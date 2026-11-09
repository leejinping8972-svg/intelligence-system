import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** The URL is the single filter value, including dropdown clear and browser navigation. */
export function useSiteKeywordFilter() {
  const route = useRoute();
  const router = useRouter();
  return computed({
    get: () =>
      typeof route.query.keywordId === 'string' ? route.query.keywordId : '',
    set: (value: string | undefined) => {
      const { keywordId: _keywordId, ...query } = route.query;
      void router.replace({
        path: route.path,
        query: value ? { ...query, keywordId: value } : query,
      });
    },
  });
}

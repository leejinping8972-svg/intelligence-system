// Context IDs belong to the previous market. Keep unrelated view/query settings.
const contextKeys: Record<string, string[]> = {
  '/sites': ['keywordId', 'keyword', 'site'],
  '/products': ['keyword', 'site', 'product'],
  '/ads': ['keywordId', 'site', 'report', 'pageId'],
  '/trends': ['keyword', 'term', 'market'],
  '/consumer-insights': ['keywordId', 'site', 'product', 'report'],
};

export function marketQuery<T>(path: string, query: Record<string, T>) {
  const keys = contextKeys[path] || [];
  return Object.fromEntries(
    Object.entries(query).filter(([key]) => !keys.includes(key)),
  );
}

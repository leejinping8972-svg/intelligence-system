const keywordDash = /[-‐‑‒–—−﹘﹣－]+/g;

export function keywordIdentity(value: null | string | undefined) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(keywordDash, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function dedupeKeywords<T extends { market?: string; term?: string }>(
  records: T[],
) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const identity = keywordIdentity(record.term);
    if (!identity) return true;
    const key = `${record.market || ''}|${identity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

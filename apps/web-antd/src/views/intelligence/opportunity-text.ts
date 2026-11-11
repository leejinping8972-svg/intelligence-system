import { productChineseName } from '../../../../../server/product-names.mjs';

import { keywordChineseName } from './keyword-names';

const marketNames: Record<string, string> = { US: '美国', MX: '墨西哥', VN: '越南' };

// Reading-only fallback: no network calls and no changes to saved source fields.
export function opportunityChineseName(title: string, saved: string | undefined, tab: string) {
  if (saved?.trim()) return saved.trim();
  if (tab === 'site') return '';
  if (tab === 'keyword') {
    const parts = /^(.*) · (US|MX|VN)$/.exec(title);
    const term = parts?.[1] || title;
    const name = keywordChineseName({ term });
    return name ? `${name}${parts ? ` · ${marketNames[parts[2]!]}` : ''}` : '';
  }
  if (/\p{Script=Han}/u.test(title)) return '';
  const name = tab === 'new'
    ? productChineseName({ title })
    : keywordChineseName({ term: title });
  return name === title ? '' : name;
}

export function opportunityOriginalNote(title: string, translated?: string) {
  if (/^(?:待补充|未返回|.*未(?:返回|公开).*配方.*)$/.test(title.trim()))
    return '暂无来源原文';
  if (/\p{Script=Han}/u.test(title) && (!translated || translated.trim() === title.trim()))
    return `来源原文（中文）：${title}`;
  return undefined;
}

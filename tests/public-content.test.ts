import type { ContentItem } from '../apps/web-antd/src/views/intelligence/public-content';

import { describe, expect, it } from 'vitest';

import {
  contentCsv,
  contentDate,
  filterContent,
  itemScopes,
} from '../apps/web-antd/src/views/intelligence/public-content';

const make = (id: string, extra: Partial<ContentItem> = {}): ContentItem => ({
  id,
  source: 'youtube',
  sourceId: id,
  sourceLabel: 'YouTube',
  category: 'social',
  type: 'video',
  title: 'Creatine video',
  summary: 'Routine',
  author: 'Creator',
  authorCountry: 'unknown',
  language: 'en',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  publishedAt: null,
  collectedAt: new Date().toISOString(),
  searchMarket: 'US',
  searchLanguage: 'en',
  matchedQueries: ['creatine'],
  matchReason: '命中creatine',
  keywordIds: [],
  productIds: [],
  favorite: false,
  textAvailability: '描述',
  ...extra,
});
const all = {
  category: 'ALL',
  type: 'ALL',
  source: 'ALL',
  language: 'ALL',
  since: 'ALL',
  search: '',
  favorites: false,
};
describe('public content search result presentation', () => {
  it('filters multi-scope records without relabelling old records as local evidence', () => {
    const records = [
      make('old'),
      make('local', { searchScope: 'local' }),
      make('both', {
        searchContexts: [
          { scope: 'local', market: 'VN', language: 'vi', query: 'creatine' },
          { scope: 'global', market: 'ALL', language: 'en', query: 'creatine' },
        ],
      }),
    ];
    expect(itemScopes(make('old'))).toEqual([]);
    expect(
      filterContent(records, { ...all, scope: 'global' }).map(
        (record) => record.id,
      ),
    ).toEqual(['both']);
    expect(
      filterContent(records, { ...all, scope: 'local' }).map(
        (record) => record.id,
      ),
    ).toEqual(['local', 'both']);
    expect(contentCsv(records)).toContain('历史记录未区分');
    expect(contentCsv(records)).toContain('全球参考证据');
  });
  it('combines category, content type and translated text filters', () => {
    const rows = [
      make('v'),
      make('p', {
        source: 'europepmc',
        category: 'academic',
        type: 'paper',
        ai: {
          titleZh: '肌酸研究',
          summaryZh: '研究局限',
          reason: '',
          quote: '',
          duplicateOf: '',
        },
      }),
    ];
    expect(
      filterContent(rows, {
        ...all,
        category: 'academic',
        type: 'paper',
        search: '肌酸',
      }).map((i) => i.id),
    ).toEqual(['p']);
    expect(
      filterContent(rows, { ...all, category: 'social', type: 'paper' }),
    ).toEqual([]);
  });
  it('does not turn unknown publication dates into recent content', () => {
    const rows = [
      make('unknown'),
      make('recent', { publishedAt: new Date().toISOString() }),
    ];
    expect(
      filterContent(rows, { ...all, since: '30' }).map((i) => i.id),
    ).toEqual(['recent']);
    expect(contentDate(null)).toBe('来源未提供');
  });
  it('supports favorites and actual source language without assuming author location', () => {
    const rows = [
      make('a'),
      make('b', { language: 'unknown', favorite: true }),
    ];
    expect(
      filterContent(rows, { ...all, favorites: true, language: 'unknown' }).map(
        (i) => i.id,
      ),
    ).toEqual(['b']);
  });
  it('exports provenance, quotes CSV, and neutralizes spreadsheet formulas', () => {
    const csv = contentCsv([
      make('a', {
        title: '=HYPERLINK("x")',
        summary: 'line1\nline2',
        productIds: ['p1'],
      }),
    ]);
    expect(csv).toContain('原文链接');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""x""');
    expect(csv).toContain('https://www.youtube.com/');
    expect(csv).toContain('p1');
  });
});

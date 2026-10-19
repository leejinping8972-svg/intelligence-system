import type { ArticleDocument } from '../apps/web-antd/src/views/intelligence/article-details';

import { describe, expect, it } from 'vitest';

import {
  articleCoverage,
  canReadArticle,
} from '../apps/web-antd/src/views/intelligence/article-details';

describe('article details availability presentation', () => {
  it('distinguishes ordinary readable HTML, official full text and truncated extraction', () => {
    expect(
      articleCoverage({
        format: 'jats_xml',
        truncated: false,
      } as ArticleDocument),
    ).toBe('官方开放全文');
    expect(
      articleCoverage({
        format: 'public_html',
        truncated: false,
      } as ArticleDocument),
    ).toContain('公开可读');
    expect(
      articleCoverage({
        format: 'jats_xml',
        truncated: true,
      } as ArticleDocument),
    ).toContain('部分正文');
  });
  it('offers body collection for article sources and papers without treating videos/posts as articles', () => {
    expect(canReadArticle({ source: 'europepmc', type: 'paper' })).toBe(true);
    expect(canReadArticle({ source: 'global_health', type: 'article' })).toBe(
      true,
    );
    expect(canReadArticle({ source: 'youtube', type: 'video' })).toBe(false);
    expect(canReadArticle({ source: 'reddit', type: 'post' })).toBe(false);
  });
});

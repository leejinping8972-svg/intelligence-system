export interface ArticleDocument {
  title: string;
  abstract: string;
  license: string;
  sourceUrl: string;
  pmcid: string;
  format: string;
  coverage: string;
  characters: number;
  truncated: boolean;
  collectedAt: string;
  note: string;
  sections: {
    id: string;
    heading: string;
    depth: number;
    blocks: { type: string; text?: string; id?: string }[];
  }[];
  tables: {
    id: string;
    label: string;
    caption: string;
    notes: string;
    truncated: boolean;
    rows: {
      text: string;
      header: boolean;
      colspan: number;
      rowspan: number;
    }[][];
  }[];
  figures: {
    id: string;
    label: string;
    caption: string;
    imageUrl: string;
    sourceUrl: string;
  }[];
}
export interface ArticleSnapshot {
  article: ArticleDocument | null;
  state: string;
  reason: string;
  jobId: string;
  itemId: string;
}
export function canReadArticle(item: { source: string; type: string }) {
  return (
    (item.type === 'paper' && item.source === 'europepmc') ||
    (item.type === 'article' &&
      ['global_health', 'local_health', 'medlineplus', 'web_articles'].includes(
        item.source,
      ))
  );
}
export function articleCoverage(document: ArticleDocument) {
  if (document.truncated) return '部分正文（达到保留上限）';
  return document.format === 'jats_xml'
    ? '官方开放全文'
    : '公开可读正文（不含未加载动态区）';
}

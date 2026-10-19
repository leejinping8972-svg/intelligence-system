import { load } from 'cheerio';

import { ArticleError, articleHttpsUrl } from './public-article-http.mjs';

export const plainArticleText = (value, limit = 12_000) =>
  String(value || '')
    // oxlint-disable-next-line eslint/no-control-regex -- Strip non-printing source controls, preserving scientific < and >.
    .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
const safeLink = (value, base) => {
  if (!value) return '';
  try {
    return articleHttpsUrl(new URL(value, base).href).href;
  } catch {
    return '';
  }
};
export function parseArticleDocument(text, { pmcid, url, xml = false } = {}) {
  if (text.length > 5_000_000 || /<!ENTITY\b/i.test(text))
    throw new ArticleError('原文XML声明或大小不支持', 'unsupported');
  const $ = load(text, xml ? { xml: true } : {});
  const article = $('article').first();
  if (xml && (article.length === 0 || $('body').length === 0))
    throw new ArticleError('来源未返回可用的全文XML', 'unavailable');
  if (xml && pmcid) {
    const actual = $(
      'article-id[pub-id-type="pmc"], article-id[pub-id-type="pmcid"]',
    )
      .first()
      .text()
      .replace(/^PMC/i, '');
    if (actual && actual !== pmcid.replace(/^PMC/i, ''))
      throw new ArticleError('全文编号与原文不一致', 'failed');
  }
  if (
    !xml &&
    /(?:just a moment|access denied|captcha|verify you are human)/i.test(
      $('title').text(),
    )
  )
    throw new ArticleError(
      '原文要求验证或拒绝自动读取，保留原文链接',
      'blocked',
    );
  let jsonBody = '';
  for (const element of $('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse($(element).text());
      const objects = Array.isArray(value)
        ? value
        : [value, ...(value['@graph'] || [])];
      for (const object of objects) {
        if (!object || typeof object !== 'object') continue;
        if (
          object.isAccessibleForFree === false ||
          object.isAccessibleForFree === 'false'
        )
          throw new ArticleError(
            '原文声明需要订阅或授权，未读取付费正文',
            'blocked',
          );
        if (
          typeof object.articleBody === 'string' &&
          object.articleBody.length > jsonBody.length
        )
          jsonBody = object.articleBody;
      }
    } catch (error) {
      if (error instanceof ArticleError) throw error;
    }
  }
  const title = plainArticleText(
    xml
      ? $('article-title').first().text()
      : $('meta[property="og:title"]').attr('content') ||
          $('h1').first().text() ||
          $('title').text(),
    500,
  );
  const abstract = xml
    ? plainArticleText(
        $('abstract')
          .map((_, node) => $(node).text())
          .get()
          .join(' '),
        20_000,
      )
    : '';
  const license = xml
    ? plainArticleText($('permissions').text(), 3000)
    : '来源未提供再利用授权，保留原始出处';
  $(
    'script, style, nav, header, footer, aside, form, noscript, iframe, button',
  ).remove();
  let root = xml
    ? $('article > body').first()
    : $(
        'article, [itemprop="articleBody"], .article-body, .article-content, .entry-content, main',
      )
        .filter((_, node) => $(node).text().trim().length >= 200)
        .first();
  if (root.length === 0 && !xml) root = $('body').first();
  const sections = [];
  const tables = [];
  const figures = [];
  let characters = 0;
  let blocks = 0;
  let truncated = false;
  const textWithinBudget = (value, limit = 12_000) => {
    const full = plainArticleText(value, 500_000);
    const remaining = Math.max(0, 240_000 - characters);
    const content = full.slice(0, Math.min(limit, remaining));
    if (content.length < full.length) truncated = true;
    characters += content.length;
    return content;
  };
  const section = (heading, depth = 0) => {
    const result = {
      id: `section-${sections.length + 1}`,
      heading: plainArticleText(heading, 300) || '正文',
      depth: Math.min(depth, 4),
      blocks: [],
    };
    if (sections.length < 100) sections.push(result);
    else truncated = true;
    return result;
  };
  const addText = (target, value) => {
    const content = textWithinBudget(value, 20_000);
    if (!content) return;
    if (blocks >= 700) {
      truncated = true;
      return;
    }
    blocks++;
    target.blocks.push({ type: 'paragraph', text: content });
  };
  const figure = (node, target) => {
    if (figures.length >= 30) {
      truncated = true;
      return;
    }
    const id = `figure-${figures.length + 1}`;
    let imageUrl = '';
    if (xml) {
      const graphic = $(node).find('graphic[content-type="image"]').first();
      const raw = $.xml(graphic);
      const path = raw.match(
        /<\?cloudpmc-path\s+(blobs\/[a-f\d]+\/\d+\/[a-f\d]+\/[\w.-]+\.(?:webp|png|jpe?g|gif))\s*\?>/i,
      )?.[1];
      if (path && path.split('/')[2] === pmcid?.replace(/^PMC/i, ''))
        imageUrl = `https://cdn.ncbi.nlm.nih.gov/pmc/${path}`;
    } else {
      const image = $(node).find('img').first();
      const candidate = safeLink(
        image.attr('src') || image.attr('data-src') || '',
        url,
      );
      if (candidate && new URL(candidate).hostname === new URL(url).hostname)
        imageUrl = candidate;
    }
    figures.push({
      id,
      label:
        plainArticleText($(node).children('label').text(), 100) ||
        `图 ${figures.length + 1}`,
      caption: textWithinBudget(
        $(node)
          .find(xml ? 'caption' : 'figcaption')
          .text(),
        5000,
      ),
      imageUrl,
      sourceUrl: `${url}#${encodeURIComponent($(node).attr('id') || '')}`,
    });
    target.blocks.push({ type: 'figure', id });
  };
  const table = (node, target) => {
    if (tables.length >= 40) {
      truncated = true;
      return;
    }
    const id = `table-${tables.length + 1}`;
    const allRows = $(node).find('tr').toArray();
    const rows = allRows.slice(0, 150).map((row) =>
      $(row)
        .children('th,td')
        .slice(0, 20)
        .map((_, cell) => ({
          text: textWithinBudget($(cell).text(), 2000),
          header: cell.name === 'th',
          colspan: Math.min(
            20,
            Math.max(1, Number($(cell).attr('colspan')) || 1),
          ),
          rowspan: Math.min(
            150,
            Math.max(1, Number($(cell).attr('rowspan')) || 1),
          ),
        }))
        .get(),
    );
    const clipped =
      allRows.length > 150 ||
      allRows.some((row) => $(row).children('th,td').length > 20);
    if (clipped) truncated = true;
    tables.push({
      id,
      label:
        plainArticleText($(node).children('label').text(), 100) ||
        `表 ${tables.length + 1}`,
      caption: plainArticleText($(node).children('caption').text(), 3000),
      notes: plainArticleText($(node).find('table-wrap-foot').text(), 5000),
      rows,
      truncated: clipped,
    });
    target.blocks.push({ type: 'table', id });
  };
  const walk = (parent, current, depth = 0) => {
    for (const node of $(parent).children()) {
      if (blocks >= 700 || characters >= 240_000) {
        truncated = true;
        break;
      }
      const name = node.name?.toLowerCase();
      if (xml && name === 'sec') {
        const heading = [
          $(node).children('label').text(),
          $(node).children('title').text(),
        ]
          .filter(Boolean)
          .join(' ');
        if (sections.length >= 100) {
          truncated = true;
          continue;
        }
        walk(node, section(heading, depth), depth + 1);
      } else if (!xml && /^h[1-6]$/.test(name || ''))
        current = section($(node).text(), Math.max(0, Number(name[1]) - 2));
      else if (name === 'fig' || name === 'figure') figure(node, current);
      else if (name === 'table-wrap' || (!xml && name === 'table'))
        table(node, current);
      else if (
        name === 'p' ||
        name === 'li' ||
        name === 'list-item' ||
        name === 'blockquote' ||
        name === 'disp-formula'
      ) {
        const clone = $(node).clone();
        clone.find('fig,table-wrap,figure,table').remove();
        addText(current, clone.text());
        for (const nested of $(node)
          .find('fig,table-wrap,figure,table')
          .filter(
            (_, nested) =>
              $(nested).parentsUntil(node, 'fig,table-wrap,figure,table')
                .length === 0,
          )) {
          if (['table', 'table-wrap'].includes(nested.name))
            table(nested, current);
          else figure(nested, current);
        }
      } else if (
        !['caption', 'graphic', 'label', 'ref-list', 'title'].includes(name)
      )
        walk(node, current, depth);
    }
  };
  const first = section('正文');
  if (jsonBody.length > root.text().trim().length) addText(first, jsonBody);
  else walk(root, first);
  if (xml) {
    const references = $('ref-list ref');
    if (references.length > 0) {
      const refSection = section('参考文献');
      references.each((_, ref) => addText(refSection, $(ref).text()));
    }
  }
  const useful = sections.filter((s) => s.blocks.length > 0);
  if (characters < 200 && tables.length === 0)
    throw new ArticleError(
      '未取得可读正文；可能仅提供索引、需要动态加载或访问授权，请查看原文',
      'unavailable',
    );
  const sourceCoverage = xml ? 'fulltext' : 'public_text';
  return {
    title,
    abstract,
    license,
    sourceUrl: url,
    pmcid: pmcid || '',
    format: xml ? 'jats_xml' : 'public_html',
    coverage: truncated ? 'partial' : sourceCoverage,
    sections: useful,
    tables,
    figures,
    characters,
    truncated,
    collectedAt: new Date().toISOString(),
    note: xml
      ? '来自官方全文XML；没有摘要不代表没有正文。表格/图注按原文保留，不替代原文审阅。'
      : '提取公开可读的HTML正文（含已有折叠区内容）；不执行页面脚本，不代表付费区或动态接口已完整采集。',
  };
}

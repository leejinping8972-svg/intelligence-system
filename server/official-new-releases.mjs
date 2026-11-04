import { load } from 'cheerio';
import { stableId } from './discovery-monitor-domain.mjs';
import {
  officialBoardUrl,
  officialHosts,
} from './official-new-release-domain.mjs';
import { scheduleSource } from './source-scheduler.mjs';

const clean = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
const validAsin = (value) => /^[A-Z0-9]{10}$/.test(value || '');
export function officialListingDate(value) {
  const text = clean(value)
    .replaceAll(/[\u200e\u200f\u202a-\u202e]/g, '')
    .trim()
    .toLowerCase();
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const spanish = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  let date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  const en = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  const es = /^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/.exec(text);
  if (en && months.includes(en[1]))
    date = `${en[3]}-${String(months.indexOf(en[1]) + 1).padStart(2, '0')}-${en[2].padStart(2, '0')}`;
  if (es && spanish.includes(es[2]))
    date = `${es[3]}-${String(spanish.indexOf(es[2]) + 1).padStart(2, '0')}-${es[1].padStart(2, '0')}`;
  return date &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
    ? date
    : '';
}
function document(html) {
  const $ = load(html);
  if (
    $(
      'form[action*="validateCaptcha"], #captchacharacters, input[name="cvf_captcha_input"]',
    ).length ||
    /robot check|sorry! something went wrong|automated access/i.test(
      $('title').text(),
    )
  )
    throw new Error(
      'Amazon官方页面要求验证或暂时拒绝访问，已停止；未改用搜索或销量榜',
    );
  return $;
}
function product(asin, title, imageUrl, request, ranking) {
  const at = ranking.observedAt;
  const url = `https://${officialHosts[request.sourceMarket]}/dp/${asin}`;
  const context = {
    provider: 'Amazon Official',
    platform: 'Amazon',
    market: request.sourceMarket,
    collectedAt: at,
    evidenceUrl: url,
  };
  return {
    id: `${request.market}-amazon-official-${stableId(`${request.sourceMarket}|${asin}`)}`,
    title,
    brand: '品牌待确认',
    market: request.market,
    sourceMarket: request.sourceMarket,
    category: '待分类',
    form: '待识别',
    size: '官网未返回规格',
    price: 0,
    currency: '',
    ingredient: '',
    dose: '',
    claim: '',
    benefits: [],
    ingredientInsights: [],
    siteId: '',
    reviewed: false,
    favorite: false,
    dataNature: 'collected',
    firstSeenAt: at,
    sourceProvider: 'Amazon Official',
    sourcePlatform: 'Amazon',
    sourceProductId: asin,
    sourceUrl: url,
    evidenceUrl: url,
    ...(imageUrl?.startsWith('https://') ? { imageUrl } : {}),
    collectionFields: ['title'],
    sourceEvidence: [context],
    sourceMetrics: { collectedAt: at },
    decisionData: { series: [] },
    resourceRaw: { officialNewRelease: ranking },
  };
}

export function parseOfficialBoard(html, request) {
  const url = officialBoardUrl(request.url, request.sourceMarket);
  const $ = document(html);
  if (!/new releases|últimas novedades|novedades/i.test($('title').text()))
    throw new Error('官方响应未确认是新品榜页面，未作为零新品结果');
  const ranking = (rank) => ({
    source: 'amazon_official_new_releases',
    boardUrl: url,
    rank,
    observedAt: new Date(request.now ?? Date.now()).toISOString(),
  });
  const items = new Map();
  $('#gridItemRoot, .zg-grid-general-faceout').each((_i, el) => {
    const card = $(el);
    const asin =
      card.attr('data-asin') ||
      card.find('[data-asin]').first().attr('data-asin') ||
      card
        .find('a[href*="/dp/"]')
        .first()
        .attr('href')
        ?.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
    const rank = Number(
      clean(card.find('.zg-bdg-text').first().text()).replace(/[^\d]/g, ''),
    );
    if (!validAsin(asin) || !Number.isInteger(rank) || rank < 1 || rank > 1000)
      return;
    const title =
      clean(card.find('[class*="p13n-sc-css-line-clamp"]').first().text()) ||
      clean(card.find('img').first().attr('alt'));
    items.set(asin, {
      asin,
      ranking: ranking(rank),
      ...(title
        ? {
            product: product(
              asin,
              title,
              card.find('img').first().attr('src'),
              request,
              ranking(rank),
            ),
          }
        : {}),
    });
  });
  // Amazon initially renders 30 cards but embeds membership/ranks for 50.
  $('[data-client-recs-list]').each((_i, el) => {
    let rows;
    try {
      rows = JSON.parse($(el).attr('data-client-recs-list'));
    } catch {
      return;
    }
    if (!Array.isArray(rows)) return;
    for (const row of rows.slice(0, 1000)) {
      const rank = Number(row.metadataMap?.['render.zg.rank']);
      if (
        validAsin(row.id) &&
        Number.isInteger(rank) &&
        rank > 0 &&
        rank <= 1000 &&
        !items.has(row.id)
      )
        items.set(row.id, { asin: row.id, ranking: ranking(rank) });
    }
  });
  if (!items.size)
    throw new Error(
      '官方新品榜未返回可核对的商品排名，可能是空榜、站点限制或页面变化；未作为成功零结果',
    );
  const current = new URL(url);
  const page = Number(current.searchParams.get('pg') || 1);
  const pages = [];
  $('.a-pagination a[href]').each((_i, el) => {
    try {
      const next = officialBoardUrl(
        new URL($(el).attr('href'), url).href,
        request.sourceMarket,
      );
      const parsed = new URL(next);
      if (
        parsed.pathname === current.pathname &&
        Number(parsed.searchParams.get('pg') || 1) === page + 1
      )
        pages.push(next);
    } catch {
      /* Ignore off-board navigation. */
    }
  });
  return {
    items: [...items.values()],
    sourceRows: items.size,
    nextUrl: pages[0] || null,
  };
}

export function parseOfficialDetail(html, request) {
  const $ = document(html);
  const title = clean($('#productTitle').text());
  const pageAsin = $('input#ASIN').attr('value') || $('#dp').attr('data-asin');
  if (!title || pageAsin !== request.asin)
    throw new Error('官方商品详情缺失或商品编号不匹配');
  const p = product(
    request.asin,
    title,
    $('#landingImage').attr('src'),
    request,
    request.ranking,
  );
  const descriptions = $('#feature-bullets li .a-list-item')
    .toArray()
    .map((el) => clean($(el).text()))
    .filter(Boolean)
    .slice(0, 12);
  p.sourceContent = { descriptions };
  $(
    '#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr',
  ).each((_i, el) => {
    const row = clean($(el).text()).replaceAll(
      /[\u200e\u200f\u202a-\u202e]/g,
      '',
    );
    const match =
      /^(Date First Available|Disponible en Amazon(?:\.com\.mx)? desde|Producto en Amazon(?:\.com\.mx)? desde)\s*:?\s*(.+)$/i.exec(
        row,
      );
    const date = match && officialListingDate(match[2]);
    if (date && !p.decisionData.listing)
      p.decisionData.listing = {
        date,
        provider: 'Amazon Official',
        sourceField: match[1],
        collectedAt: new Date(request.now ?? Date.now()).toISOString(),
        evidenceUrl: p.sourceUrl,
      };
  });
  const ships = clean(
    $(
      '#fulfillerInfoFeature_feature_div .offer-display-feature-text-message, #tabular-buybox [tabular-attribute-name="Ships from"] .tabular-buybox-text, #tabular-buybox [tabular-attribute-name="Enviado por"] .tabular-buybox-text',
    )
      .first()
      .text(),
  );
  const sold = clean(
    $(
      '#merchantInfoFeature_feature_div .offer-display-feature-text-message, #sellerProfileTriggerId',
    )
      .first()
      .text(),
  );
  // A seller name alone is insufficient: a third-party seller can use FBA.
  const fulfillment = ships
    ? /^amazon(?:\.com(?:\.mx)?)?$/i.test(ships)
      ? 'FBA'
      : sold && ships === sold
        ? 'FBM'
        : 'unknown'
    : 'unknown';
  p.resourceRaw = {
    ...p.resourceRaw,
    fulfillment,
    shipsFrom: ships,
    soldBy: sold,
    fulfillmentEvidenceUrl: p.sourceUrl,
    fulfillmentObservedAt: new Date(request.now ?? Date.now()).toISOString(),
  };
  return { product: p, sourceRows: 1 };
}

export async function officialNewReleases(request, overrides = {}) {
  const detail = request.op === 'detail';
  let url;
  if (detail) {
    if (
      !validAsin(request.asin) ||
      request.ranking?.source !== 'amazon_official_new_releases' ||
      !Number.isInteger(request.ranking.rank) ||
      request.ranking.rank < 1
    )
      throw new Error('商品详情必须有官方新品榜成员证据');
    officialBoardUrl(request.ranking.boardUrl, request.sourceMarket);
    url = `https://${officialHosts[request.sourceMarket]}/dp/${request.asin}`;
  } else url = officialBoardUrl(request.url, request.sourceMarket);
  const fetcher = overrides.fetch || globalThis.fetch;
  return (overrides.schedule || scheduleSource)(
    `official-new-releases:${new URL(url).hostname}`,
    async () => {
      const response = await fetcher(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept-Language':
            request.sourceMarket === 'MX' ? 'es-MX,es;q=0.9' : 'en-US,en;q=0.9',
        },
      });
      if (!response.ok) {
        const error = new Error(
          `Amazon官方页面HTTP ${response.status}，已停止该步骤，未自动重试`,
        );
        error.status = response.status;
        error.retryAfterSeconds = Math.min(
          300,
          Number(response.headers.get('retry-after')) || 0,
        );
        throw error;
      }
      if (response.url && response.url !== url)
        throw new Error('官方页面发生未授权跳转，已停止');
      if (!response.headers.get('content-type')?.includes('text/html'))
        throw new Error('官方页面未返回HTML');
      const reader = response.body.getReader();
      const parts = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 4_000_000) throw new Error('官方页面超过大小限制');
          parts.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const html = Buffer.concat(parts).toString('utf8');
      return {
        ...(detail
          ? parseOfficialDetail(html, request)
          : parseOfficialBoard(html, request)),
        requests: 1,
      };
    },
    { intervalMs: 1500 },
  );
}

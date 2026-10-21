import { createHash } from 'node:crypto';

const markets = new Set(['MX', 'US', 'VN']);
const periodDays = { week: 7, month: 31, quarter: 92 };

export function validateMarketReport(input = {}) {
  if (!markets.has(input.market)) throw new Error('请选择美国、墨西哥或越南');
  if (!Object.hasOwn(periodDays, input.period))
    throw new Error('报告周期须为周、月或季度');
  const endDate = String(
    input.endDate || new Date().toISOString().slice(0, 10),
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
    !Number.isFinite(Date.parse(`${endDate}T23:59:59.999Z`)) ||
    new Date(`${endDate}T23:59:59.999Z`).toISOString().slice(0, 10) !== endDate
  )
    throw new Error('报告截止日期无效');
  const periodLabel = { week: '周报', month: '月报', quarter: '季报' }[
    input.period
  ];
  return {
    kind: 'market_analysis',
    reportType: 'market',
    market: input.market,
    markets: [input.market],
    period: input.period,
    endDate,
    title: String(
      input.title || `${input.market}市场商品与消费者${periodLabel}`,
    )
      .trim()
      .slice(0, 160),
    analyze: input.analyze !== false,
    researchFocus: String(input.researchFocus || '')
      .trim()
      .slice(0, 2000),
  };
}

export function reportRange(period, endDate) {
  const end = new Date(`${endDate}T23:59:59.999Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - periodDays[period] + 1);
  start.setUTCHours(0, 0, 0, 0);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function evidenceId(kind, record) {
  return `market-${createHash('sha256')
    .update(
      `${kind}:${record.id || record.url || record.domain}:${JSON.stringify(record)}`,
    )
    .digest('hex')
    .slice(0, 24)}`;
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const collectedAt = (record) =>
  record.lastCollectedAt ||
  record.collectedAt ||
  record.updatedAt ||
  record.firstSeenAt ||
  record.createdAt ||
  '';
const within = (record, range) => {
  const value = Date.parse(collectedAt(record));
  return (
    Number.isFinite(value) &&
    value >= Date.parse(range.startAt) &&
    value <= Date.parse(range.endAt)
  );
};

export const originalMarketRecord = (record) =>
  record &&
  record.dataNature !== 'demo' &&
  !String(record.id || '').startsWith('market-');

export function marketObservationRecords(observations) {
  const result = {
    products: [],
    ads: [],
    sites: [],
    content: [],
    comments: [],
  };
  for (const observation of observations)
    for (const key of Object.keys(result))
      result[key].push(
        ...(observation[key] || []).filter((record) =>
          originalMarketRecord(record),
        ),
      );
  return result;
}

// Give each evidence type a turn; comments from different videos also take turns.
export function marketModelSample(evidence, limit = 240) {
  const kinds = new Map();
  for (const record of evidence) {
    if (!kinds.has(record.kind)) kinds.set(record.kind, new Map());
    const sources = kinds.get(record.kind);
    const source =
      record.kind === 'comment' ? record.sourceUrl || record.url : record.id;
    if (!sources.has(source)) sources.set(source, []);
    sources.get(source).push(record);
  }
  const queues = [...kinds.values()].map((sources) => {
    const queue = [];
    while ([...sources.values()].some((rows) => rows.length > 0))
      for (const rows of sources.values())
        if (rows.length > 0) queue.push(rows.shift());
    return queue;
  });
  const sample = [];
  while (sample.length < limit && queues.some((rows) => rows.length > 0))
    for (const rows of queues)
      if (sample.length < limit && rows.length > 0) sample.push(rows.shift());
  return sample;
}

export function buildMarketSnapshot(
  { products, ads, sites, content, comments },
  request,
) {
  const range = reportRange(request.period, request.endDate);
  const filter = (records) => {
    const latest = new Map();
    for (const record of records.filter(
      (item) => originalMarketRecord(item) && within(item, range),
    )) {
      const key = record.id || record.url || record.domain;
      if (!key) continue;
      const old = latest.get(key);
      if (
        !old ||
        Date.parse(collectedAt(record)) > Date.parse(collectedAt(old))
      )
        latest.set(key, record);
    }
    return [...latest.values()];
  };
  const scoped = {
    products: filter(products),
    ads: filter(ads).filter((record) =>
      ['ACTIVE', '投放中'].includes(record.status),
    ),
    sites: filter(sites),
    content: filter(content),
    comments: filter(comments),
  };
  const topProducts = scoped.products
    .map((record) => ({
      id: record.id,
      title: record.title,
      brand:
        record.brand || record.shopName || record.sourceMetrics?.shopName || '',
      source: record.sourcePlatform || record.source || '独立站',
      reportedSales: number(
        record.sourceMetrics?.reportedSales ?? record.sales,
      ),
      reviewCount: number(
        record.sourceMetrics?.reviewCount ?? record.reviewCount,
      ),
      rating: number(record.sourceMetrics?.rating ?? record.rating),
      price: number(record.price),
      currency: record.currency || '',
      url: record.evidenceUrl || record.url || '',
      collectedAt: collectedAt(record),
    }))
    .toSorted(
      (a, b) =>
        b.reportedSales - a.reportedSales || b.reviewCount - a.reviewCount,
    )
    .slice(0, 50);
  const ingredientCounts = new Map();
  for (const record of scoped.products)
    for (const item of record.ingredientInsights || []) {
      const name = String(item.name || '').trim();
      if (name)
        ingredientCounts.set(name, (ingredientCounts.get(name) || 0) + 1);
    }
  const topIngredients = [...ingredientCounts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 20);
  const advertisers = new Map();
  for (const record of scoped.ads) {
    const name = record.brand || record.pageName || '未知广告主';
    const item = advertisers.get(name) || {
      name,
      ads: 0,
      landingSites: new Set(),
    };
    item.ads++;
    for (const id of record.siteIds || []) item.landingSites.add(id);
    advertisers.set(name, item);
  }
  const topAdvertisers = [...advertisers.values()]
    .map((item) => ({ ...item, landingSites: item.landingSites.size }))
    .toSorted((a, b) => b.ads - a.ads)
    .slice(0, 20);
  const topContent = scoped.content
    .map((record) => ({
      id: record.id,
      title: record.titleZh || record.title,
      url: record.url,
      source: record.source,
      likes: number(record.likes ?? record.engagement?.likes),
      comments: number(record.commentsCount ?? record.engagement?.comments),
      collectedAt: collectedAt(record),
    }))
    .toSorted((a, b) => b.likes + b.comments - a.likes - a.comments)
    .slice(0, 50);
  return {
    schemaVersion: 1,
    market: request.market,
    period: request.period,
    endDate: request.endDate,
    ...range,
    frozenAt: new Date().toISOString(),
    coverage: {
      products: scoped.products.length,
      tiktokShopProducts: scoped.products.filter((record) =>
        /tiktok/i.test(`${record.sourcePlatform || ''} ${record.source || ''}`),
      ).length,
      independentSiteProducts: scoped.products.filter(
        (record) =>
          !/tiktok|amazon/i.test(
            `${record.sourcePlatform || ''} ${record.source || ''}`,
          ),
      ).length,
      activeMetaAds: scoped.ads.length,
      independentSites: scoped.sites.length,
      tiktokContent: scoped.content.filter(
        (record) => record.source === 'tiktok',
      ).length,
      consumerComments: scoped.comments.length,
    },
    topProducts,
    topIngredients,
    topAdvertisers,
    topContent,
    limitations: [
      '统计范围仅包含系统在所选国家、周期、种子词和预算内实际发现的数据，不代表整个国家市场全量。',
      '平台展示销量、评论数和互动量按采集时快照保存，不能直接解释为本周期新增销量或真实成交额。',
      '目标市场只表示检索与商品市场，不能证明内容发布者、评论者或广告受众的实际所在地。',
      '消费者表达和广告宣称用于提出待验证假设，不构成疗效、医学或合规结论。',
    ],
    _records: scoped,
  };
}

export function snapshotEvidence(snapshot) {
  const rows = [];
  const add = (kind, record, text, url, platform) => {
    const id = evidenceId(kind, record);
    rows.push({
      id,
      kind,
      text: String(text || '').slice(0, 6000),
      url: String(url || '').startsWith('https://') ? url : '',
      sourceUrl: String(url || '').startsWith('https://') ? url : '',
      platform,
      market: snapshot.market,
      collectedAt: collectedAt(record),
      dataNature: 'collected',
    });
  };
  for (const record of snapshot._records.products)
    add(
      'product',
      record,
      [
        record.title,
        record.brand,
        record.description,
        ...(record.ingredientInsights || []).map((item) => item.name),
        `价格：${record.price ?? '未记录'} ${record.currency || ''}；平台展示销量：${record.sourceMetrics?.reportedSales ?? record.sales ?? '未记录'}；评论数：${record.sourceMetrics?.reviewCount ?? record.reviewCount ?? '未记录'}`,
      ]
        .filter(Boolean)
        .join('\n'),
      record.evidenceUrl || record.url,
      record.sourcePlatform || record.source || '独立站',
    );
  for (const record of snapshot._records.ads)
    add(
      'advertiser_claim',
      record,
      [record.headline, record.copy].filter(Boolean).join('\n'),
      record.evidenceUrl || record.landingUrls?.[0],
      'Meta',
    );
  for (const record of snapshot._records.content)
    add(
      'content',
      record,
      [
        record.title,
        record.summary,
        record.description,
        record.transcript?.text,
        record.summaryZh,
      ]
        .filter(Boolean)
        .join('\n'),
      record.url,
      record.source || 'TikTok',
    );
  for (const record of snapshot._records.comments)
    add(
      'comment',
      record,
      record.text,
      record.sourceUrl || record.url,
      record.platform || 'TikTok',
    );
  for (const record of snapshot._records.sites)
    add(
      'site',
      record,
      [record.brand, record.domain, record.category].filter(Boolean).join('\n'),
      record.evidenceUrl || (record.domain ? `https://${record.domain}` : ''),
      '独立站',
    );
  return [
    ...new Map(
      rows.filter((row) => row.text).map((row) => [row.id, row]),
    ).values(),
  ];
}

export function publicSnapshot(snapshot) {
  const { _records, ...result } = snapshot;
  return result;
}

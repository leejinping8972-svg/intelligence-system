// Research priority, never a revenue, conversion or profitability estimate.
export function scoreSite(site, now = Date.now()) {
  const dims = [];
  const text =
    `${site.brand || ''} ${site.category || ''} ${(site.mainProducts || []).join(' ')} ${(site.signals || []).join(' ')}`
      .normalize('NFKC')
      .toLowerCase();
  const tokens =
    String(site.keyword || '')
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  const matches = tokens.filter((t) => text.includes(t)).length;
  const confidence = Number.isFinite(site.confidence) ? site.confidence : null;
  const m = site.metrics;
  const fresh =
    m &&
    m.market === site.market &&
    now - Date.parse(m.collectedAt) >= 0 &&
    now - Date.parse(m.collectedAt) <= 30 * 86400000;
  const traffic =
    fresh && Number.isFinite(m.organicTraffic) && m.organicTraffic >= 0
      ? m.organicTraffic
      : null;
  const add = (key, label, weight, value, evidence) =>
    dims.push({ key, label, weight, value, evidence });
  add(
    'relevance',
    '关键词与商品相关性',
    30,
    tokens.length ? Math.round((matches / tokens.length) * 100) : null,
    '关键词与官网品牌、类别和主要商品的文本匹配，需人工确认语义',
  );
  add(
    'storefront',
    '官网电商证据',
    20,
    confidence,
    '官网商品结构化数据、购物车、结账入口等验证信号',
  );
  add(
    'visibility',
    '目标市场自然搜索可见度',
    30,
    traffic === null
      ? null
      : Math.min(100, Math.round((Math.log10(traffic + 1) / 6) * 100)),
    traffic === null
      ? '待补同市场、30天内 Semrush 域名指标；缺失不计为0'
      : `Semrush 自然搜索流量估算 ${traffic}，不是网站全部访问量`,
  );
  const commerce =
    confidence === null
      ? null
      : Math.min(
          100,
          ((site.mainProducts || []).length ? 50 : 0) +
            ((site.signals || []).some((s) =>
              /购物车|结账|价格|Product/.test(s),
            )
              ? 50
              : 0),
        );
  add(
    'commerce',
    '商品研究可用性',
    20,
    commerce,
    '是否提取到主要商品及购买相关公开信号，不代表销量或盈利',
  );
  const coverage = dims.reduce(
    (n, d) => n + (d.value === null ? 0 : d.weight),
    0,
  );
  const score =
    coverage >= 50
      ? Math.round(
          dims.reduce((n, d) => n + (d.value ?? 0) * d.weight, 0) / coverage,
        )
      : null;
  const status =
    traffic !== null && confidence !== null && coverage === 100
      ? 'rated'
      : 'provisional';
  return {
    version: 'site-v1',
    score,
    coverage,
    status,
    grade:
      score === null
        ? '待评分'
        : status === 'provisional'
          ? '暂评'
          : score >= 80
            ? 'A'
            : score >= 65
              ? 'B'
              : score >= 50
                ? 'C'
                : 'D',
    dimensions: dims,
    assessedAt: new Date(now).toISOString(),
  };
}

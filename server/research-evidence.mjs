import { createHash } from 'node:crypto';

export const sourceKinds = {
  reddit_search: { platform: 'Reddit', path: '/v1/reddit/search' },
  reddit_comments: {
    platform: 'Reddit',
    path: '/v1/reddit/post/comments',
    hosts: ['reddit.com'],
  },
  facebook_comments: { platform: 'Facebook', path: '/v1/facebook/post/comments', hosts: ['facebook.com'] },
  youtube_comments: {
    platform: 'YouTube',
    path: '/v1/youtube/video/comments',
    hosts: ['youtube.com', 'youtu.be'],
  },
  tiktok_comments: {
    platform: 'TikTok',
    path: '/v1/tiktok/video/comments',
    hosts: ['tiktok.com'],
  },
};
export function sourceUrl(value, hosts) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port)
      return '';
    if (
      hosts &&
      !hosts.some(
        (host) => u.hostname === host || u.hostname.endsWith(`.${host}`),
      )
    )
      return '';
    return u.toString();
  } catch {
    return '';
  }
}
export function normalizeEvidence(payload, request) {
  const spec = sourceKinds[request.kind];
  if (!spec) throw new Error('不支持的评论来源');
  const records =
    request.kind === 'reddit_search' ? payload.posts : payload.comments;
  if (!Array.isArray(records))
    throw new Error('数据源未返回预期列表，不能作为零结果完成');
  const result = new Map();
  for (const raw of records) {
    const text = [
      raw.title,
      raw.selftext || raw.body || raw.content || raw.text,
    ]
      .filter((s) => typeof s === 'string')
      .join('\n')
      .trim()
      .slice(0, 6000);
    if (!text || /^\[(?:removed|deleted)\]$/.test(text)) continue;
    const url = sourceUrl(
      (raw.permalink ? `https://www.reddit.com${raw.permalink}` : raw.url) ||
        request.url,
      spec.hosts || ['reddit.com'],
    );
    if (!url) continue;
    const nativeId = String(
      raw.id ||
        raw.cid ||
        raw.name ||
        createHash('sha256')
          .update(`${url}:${text}`)
          .digest('hex')
          .slice(0, 24),
    );
    const id = createHash('sha256')
      .update(`${spec.platform}:${url.split('?')[0]}:${nativeId}`)
      .digest('hex')
      .slice(0, 32);
    const epoch = raw.created_utc || raw.create_time || raw.created;
    const postedAt =
      raw.publishedTime ||
      raw.created_at_iso ||
      raw.created_at ||
      (Number(epoch) > 0
        ? new Date(Number(epoch) * 1000).toISOString()
        : undefined);
    result.set(id, {
      id,
      text,
      url,
      sourceUrl: request.kind === 'reddit_search' ? url : request.url,
      platform: spec.platform,
      kind: request.kind === 'reddit_search' ? 'post' : 'comment',
      postedAt,
      collectedAt: new Date().toISOString(),
      likes: Number(raw.score ?? raw.digg_count ?? raw.engagement?.likes ?? raw.reaction_count) || 0,
      market: request.market,
      marketBasis: '研究目标市场；未证明评论者所在地',
      keywordIds: request.keywordIds || [],
      siteIds: request.siteIds || [],
      productIds: request.productIds || [],
      query: request.query || '',
      dataNature: 'collected',
    });
  }
  const next =
    payload.after ??
    payload.continuationToken ??
    payload.more?.cursor ??
    payload.more?.next_cursor ??
    payload.cursor;
  return {
    records: [...result.values()],
    cursor:
      next === null || next === undefined || next === 0 || next === ''
        ? ''
        : String(next),
    creditsCharged: Number.isFinite(payload.credits_charged)
      ? payload.credits_charged
      : null,
  };
}
const themes = [
  [
    'price',
    '价格与性价比',
    /price|expensive|cost|afford|giá|đắt|precio|car[oa]|价格|太贵/iu,
    '比较每份有效用量的价格，核实消费者能否接受目标售价。',
  ],
  [
    'taste',
    '口感与食用体验',
    /taste|flavou?r|texture|chew|vị|mùi|sabor|口感|味道|难吃/iu,
    '打样时重点验证口感和食用体验，避免只对比配方。',
  ],
  [
    'formula',
    '配方与剂量疑问',
    /dose|dosage|ingredient|serving|sugar|liều|thành phần|đường|dosis|ingrediente|azúcar|剂量|成分|含糖/iu,
    '核对标签、每份剂量与食用份数，整理待供应链确认的问题。',
  ],
  [
    'quality',
    '质量与信任',
    /lab|tested|testing|certif|fake|trust|kiểm nghiệm|chứng nhận|prueba|calidad|检测|认证|真假/iu,
    '核验检测证明、原料来源及公开标签，区分宣传和证据。',
  ],
  [
    'objection',
    '使用顾虑与负面体验',
    /not work|doesn.t work|side effect|bloat|nausea|tác dụng phụ|không hiệu quả|efecto secundario|no funciona|无效|副作用|不舒服/iu,
    '保留原话作为使用顾虑；个体体验不作为医学结论。',
  ],
  [
    'purchase',
    '购买意向与渠道',
    /where.*buy|where.*get|want to buy|recommend|mua ở|muốn mua|dónde.*compr|recomiend|哪里买|想买|推荐/iu,
    '检查可购买渠道和购买阻碍；表达意向不代表实际成交。',
  ],
  [
    'question',
    '待回答的问题',
    /[?？]|how|why|which|có nên|tại sao|cómo|cuál|为什么|怎么/iu,
    '形成商品页 FAQ，并用官网和供应链资料核实答案。',
  ],
];
export function evidenceReport(records, kind = 'consumer') {
  const unique = [...new Map(records.map((r) => [r.id, r])).values()];
  const adThemes = [
    [
      'offer',
      '优惠与价格表达',
      /discount|save|off\b|bundle|subscribe|free shipping|giảm|miễn phí|descuento|gratis|优惠|折扣/iu,
      '比较实际价格、订阅条款与组合装，不把促销频繁视作高销量。',
    ],
    [
      'audience',
      '人群与场景表达',
      /women|men\b|athlete|fitness|sleep|stress|phụ nữ|hombres|mujeres|女性|运动|睡眠/iu,
      '核对广告提及的人群与商品定位，作为定位测试假设。',
    ],
    [
      'formula',
      '成分与用量宣称',
      /creatine|collagen|probiotic|magnesium|ingredient|dose|thành phần|ingrediente|肌酸|胶原|成分|剂量/iu,
      '与官网商品标签逐项核对，广告出现成分不代表配方已经确认。',
    ],
    [
      'proof',
      '信任与证明表达',
      /clinical|tested|doctor|review|science|chứng nhận|clínic|医生|临床|检测|认证/iu,
      '保留原文并核验来源，不将宣传证明直接视为科学证据。',
    ],
    [
      'cta',
      '购买引导',
      /shop|buy|order|learn more|mua|compra|pedido|购买|下单|了解更多/iu,
      '检查落地页与购买路径，形成页面和引导表达的测试建议。',
    ],
  ];
  const groups = (kind === 'advertiser' ? adThemes : themes)
    .map(([key, label, regex, suggestion]) => {
      const matches = unique.filter((r) => regex.test(r.text));
      return {
        key,
        label,
        count: matches.length,
        sourceCount: new Set(matches.map((r) => r.sourceUrl || r.url)).size,
        evidenceIds: matches.map((r) => r.id),
        suggestion,
      };
    })
    .filter((r) => r.count)
    .sort((a, b) => b.count - a.count);
  const sourceCount = new Set(unique.map((r) => r.sourceUrl || r.url)).size;
  return {
    version: 1,
    method: '多语言关键词规则统计；非模型语义判断',
    kind,
    sampleSize: unique.length,
    sourceCount,
    confidence:
      unique.length >= 30 && sourceCount >= 3
        ? '中（抽样证据）'
        : '低（样本有限）',
    themes: groups,
    limitations: [
      '样本不是市场总体，不计算真实购买率、疗效或销量。',
      '目标研究国家不代表评论者或受众实际所在地。',
      '同一帖子评论存在选择和排序偏差；主题数可能重叠。',
    ],
    generatedAt: new Date().toISOString(),
  };
}
export function adEvidence(ad) {
  const text = [ad.headline, ad.copy, ad.transcript].filter(Boolean).join('\n');
  const id = createHash('sha256')
    .update(`${ad.id}:${ad.lastCollectedAt || ''}:${text}`)
    .digest('hex')
    .slice(0, 32);
  return {
    id,
    adId: ad.id,
    text,
    url: sourceUrl(ad.evidenceUrl),
    platform: ad.platform,
    kind: 'advertiser_claim',
    brand: ad.brand,
    market: ad.market,
    keywordIds: ad.keywordIds || [],
    siteIds: ad.siteIds || [],
    productIds: ad.productId ? [ad.productId] : [],
    startDate: ad.startDate,
    status: ad.status,
    collectedAt: ad.lastCollectedAt,
    headline: ad.headline,
    transcript: ad.transcript || '',
    landingUrl: sourceUrl(ad.landingUrls?.[0]),
    archiveId: ad.archiveId,
    collectionSource: ad.source || '来源未记录',
  };
}
export function validateModelReport(value, records, options = {}) {
  if (
    !value ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.findings)
  )
    throw new Error('模型未返回有效报告结构，原始证据已保留');
  const ids = new Set(records.map((r) => r.id));
  const sections = new Set([
    'audience',
    'creative',
    'positioning',
    'offer',
    'opportunity',
    'test',
  ]);
  const findings = value.findings.slice(0, 15).flatMap((f) => {
    if (!f || typeof f !== 'object') return [];
    const evidenceIds = Array.isArray(f.evidenceIds)
      ? [...new Set(f.evidenceIds.filter((id) => ids.has(id)))]
      : [];
    if (!evidenceIds.length || typeof f.label !== 'string') return [];
    return [
      {
        label: f.label.slice(0, 160),
        interpretation: String(f.interpretation || '').slice(0, 2000),
        suggestion: String(f.suggestion || '').slice(0, 1500),
        evidenceIds,
        ...(options.ad
          ? {
              section: sections.has(f.section) ? f.section : 'opportunity',
              observation: String(f.observation || '').slice(0, 2000),
              confidence: ['高', '中', '低'].includes(f.confidence)
                ? f.confidence
                : '低',
              quotes: (Array.isArray(f.quotes) ? f.quotes : [])
                .slice(0, 2)
                .flatMap((q) => {
                  const source = records.find((r) => r.id === q?.evidenceId);
                  return source &&
                    evidenceIds.includes(source.id) &&
                    typeof q.text === 'string' &&
                    q.text.length >= 4 &&
                    source.text.includes(q.text)
                    ? [{ evidenceId: source.id, text: q.text.slice(0, 350) }]
                    : [];
                }),
              ...(f.section === 'test' && f.test && typeof f.test === 'object'
                ? {
                    test: Object.fromEntries(
                      [
                        'hypothesis',
                        'control',
                        'variant',
                        'constant',
                        'metric',
                        'decisionRule',
                        'priority',
                      ].map((key) => [
                        key,
                        String(f.test[key] || '').slice(0, 1000),
                      ]),
                    ),
                  }
                : {}),
            }
          : {}),
      },
    ];
  });
  if (!findings.length)
    throw new Error('模型结论缺少有效证据引用，未保存为有效分析');
  if (
    options.ad &&
    (!['creative', 'opportunity', 'test'].every((section) =>
      findings.some(
        (f) =>
          f.section === section &&
          f.observation &&
          f.interpretation &&
          f.suggestion,
      ),
    ) ||
      findings
        .filter((f) => f.section === 'test')
        .some(
          (f) =>
            !f.test ||
            [
              'hypothesis',
              'control',
              'variant',
              'constant',
              'metric',
              'decisionRule',
            ].some((key) => !f.test[key]),
        ))
  )
    throw new Error(
      '广告报告缺少创意拆解、机会依据或完整测试计划；原始证据保留，未自动重试模型调用',
    );
  return {
    summary: value.summary.slice(0, 4000),
    findings,
    limitations: (Array.isArray(value.limitations) ? value.limitations : [])
      .map(String)
      .slice(0, 10),
    method: '模型推断；需人工审核',
    generatedAt: new Date().toISOString(),
  };
}

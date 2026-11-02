// apps/web-antd/src/views/intelligence/keyword-scoring.ts
var KEYWORD_MODEL_VERSION = "keyword-research-v2.0";
var clamp = (value) => Math.round(Math.max(0, Math.min(100, value)));
function gradeForScore(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}
function assessKeyword(keyword) {
  const text = keyword.term.toLocaleLowerCase();
  const tags = /* @__PURE__ */ new Set();
  if (keyword.source.includes("Sorftime")) tags.add("Amazon\u7AD9\u5185\u6765\u6E90");
  const offTopic = /\b(hospital|clinic|doctor|jobs?|salary|magazine|badge reel|services?|partners|specialists?)\b|bệnh viện|tuyển dụng|招聘|医院/.test(
    text
  );
  const ingredient = /magnesium|glycinate|collagen|creatine|probiotic|prebiotic|inositol|ashwagandha|berberine|melatonin|omega|vitamin|protein|electrolyte|inulin|psyllium|colágeno|probiótico|men vi sinh|chất xơ|胶原|益生菌/.test(
    text
  );
  const form = /gumm|capsul|powder|softgel|tablet|liquid|cápsula|polvo|\bbột\b|viên|软糖|胶囊|粉剂/.test(
    text
  );
  const commercial = /supplement|buy|price|shop|comprar|precio|suplemento|bổ sung|mua|giá|保健品|购买/.test(
    text
  );
  const brand = /\b(amazon|walmart|iherb|now foods|nature made|garden of life|lemme|goli)\b/.test(
    text
  );
  const classified = Boolean(
    keyword.category && !["\u5F85\u5206\u7C7B", "\u672A\u5206\u7C7B"].includes(keyword.category)
  );
  if (ingredient) tags.add("\u6210\u5206\u8BCD");
  if (form) tags.add("\u5242\u578B\u8BCD");
  if (commercial || ingredient || form) tags.add("\u5546\u54C1\u9700\u6C42\u8BCD");
  if (/women|female|menopause|prenatal|phụ nữ|mujer|女性/.test(text))
    tags.add("\u4EBA\u7FA4\u8BCD");
  if (brand) tags.add("\u54C1\u724C\u5BFC\u822A\u8BCD");
  if (offTopic) tags.add("\u975E\u5546\u54C1\u9700\u6C42");
  if (/how|what|benefits|side effects|cách|là gì|cómo|para qué|功效|副作用/.test(
    text
  ))
    tags.add("\u5185\u5BB9\u7814\u7A76\u8BCD");
  let relevance = 30;
  if (ingredient) relevance = 80;
  if (classified) relevance = 85;
  if (offTopic) relevance = 10;
  let product = offTopic ? 10 : clamp(
    25 + (ingredient ? 30 : 0) + (form ? 25 : 0) + (commercial ? 20 : 0)
  );
  const normalized = new Map(
    (keyword.trendPoints || []).filter(
      (p) => !p.isPartial && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100 && Number.isFinite(Date.parse(p.date))
    ).map((p) => [p.date, p])
  );
  const points = [...normalized.values()].toSorted(
    (a, b) => Date.parse(a.date) - Date.parse(b.date)
  );
  const annualSeries = points.map((p) => p.value);
  const span = points.length > 1 ? (Date.parse(points.at(-1).date) - Date.parse(points[0].date)) / 864e5 : 0;
  const trendAge = keyword.trendCollectedAt ? (Date.now() - Date.parse(keyword.trendCollectedAt)) / 864e5 : Number.NaN;
  const usableTrend = points.length >= 8 && span >= 56 && span <= 800 && annualSeries.some((v) => v > 0) && trendAge >= -1 && trendAge <= 45;
  let trendScore = null;
  let trendEvidence = keyword.trendMessage || "\u5C1A\u65E0\u8DB3\u591F\u7684\u6709\u6548\u8D8B\u52BF\u65F6\u5E8F";
  if (usableTrend) {
    const daily = (keyword.trendDailyPoints || []).filter(
      (p) => !p.isPartial && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100 && Number.isFinite(Date.parse(p.date))
    ).toSorted((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const dailySpan = daily.length > 1 ? (Date.parse(daily.at(-1).date) - Date.parse(daily[0].date)) / 864e5 : 0;
    const windowPoints = daily.length >= 56 && dailySpan >= 55 ? daily : points;
    const dailyUsed = windowPoints === daily;
    const step = dailyUsed ? 1 : Math.min(31, Math.max(1, Math.round(span / (points.length - 1))));
    const end = Date.parse(windowPoints.at(-1).date) + step * 864e5;
    const avgWindow = (start, finish) => {
      let days = 0;
      let sum = 0;
      for (let i = 0; i < windowPoints.length; i++) {
        const p = windowPoints[i];
        const from = Date.parse(p.date);
        const to = i + 1 < windowPoints.length ? Math.min(
          Date.parse(windowPoints[i + 1].date),
          from + step * 864e5
        ) : from + step * 864e5;
        const overlap = Math.max(0, Math.min(to, finish) - Math.max(from, start)) / 864e5;
        sum += p.value * overlap;
        days += overlap;
      }
      return days >= 27 ? sum / days : null;
    };
    const previous = avgWindow(end - 56 * 864e5, end - 28 * 864e5);
    const recent = avgWindow(end - 28 * 864e5, end);
    const continuity = annualSeries.filter((v) => v > 0).length / annualSeries.length;
    let momentum = 50;
    if (recent !== null && previous !== null) {
      if (previous > 0)
        momentum = clamp(50 + 50 * (recent - previous) / previous);
      else momentum = recent > 0 ? 70 : 20;
    }
    const total = annualSeries.reduce((sum, v) => sum + v, 0);
    const spike = Math.max(...annualSeries) / total > 0.45;
    trendScore = clamp(
      (continuity * 65 + momentum * 0.35) * (spike ? 0.65 : 1)
    );
    if (spike) tags.add("\u5076\u53D1\u5C16\u5CF0");
    else if (continuity >= 0.7) tags.add("\u9700\u6C42\u6301\u7EED");
    if (recent !== null && previous !== null) {
      if (recent > previous * 1.2 && recent > 0)
        tags.add(previous === 0 ? "\u65B0\u51FA\u73B0\u4FE1\u53F7" : "\u8FD1\u671F\u589E\u957F");
      else if (previous > 0 && recent < previous * 0.8) tags.add("\u8FD1\u671F\u56DE\u843D");
      else if (continuity >= 0.7) tags.add("\u8D70\u52BF\u5E73\u7A33");
    }
    if (continuity < 0.2) tags.add("\u4F4E\u6837\u672C\u4FE1\u53F7");
    trendEvidence = `\u4E00\u5E74\u8D8B\u52BF\u6301\u7EED\u602765% + \u8FD128\u5929\u76F8\u5BF9\u6B64\u524D28\u5929\u52A8\u91CF35%\uFF1B${dailyUsed ? "\u65E5\u6570\u636E" : "\u6309\u539F\u59CB\u65F6\u70B9\u8986\u76D6\u5929\u6570\u52A0\u6743"}\uFF0C\u6709\u6548\u70B9${points.length}\u4E2A\uFF0C\u8986\u76D6${Math.round(span)}\u5929\uFF1B\u5C16\u5CF0\u964D\u6743\uFF0C\u4E0D\u4EE3\u8868\u641C\u7D22\u91CF`;
  } else tags.add(points.length > 0 ? "\u8D8B\u52BF\u6837\u672C\u4E0D\u8DB3\u6216\u8FC7\u671F" : "\u5F85\u8865\u8D8B\u52BF");
  const metrics = keyword.metrics;
  const metricDate = metrics ? Date.parse(metrics.collectedAt) : Number.NaN;
  const metricAge = (Date.now() - metricDate) / 864e5;
  const validMetrics = Boolean(
    metrics?.source.trim() && metrics.market === keyword.market && Number.isFinite(metricDate) && metricAge >= -1 && metricAge <= 90
  );
  const volume = validMetrics && Number.isFinite(metrics?.monthlySearchVolume) && (metrics?.monthlySearchVolume ?? -1) >= 0 ? metrics?.monthlySearchVolume : void 0;
  const volumeCeiling = keyword.market === "US" ? 1e5 : 5e4;
  const demandScore = volume === void 0 ? null : clamp(Math.log10(1 + volume) / Math.log10(1 + volumeCeiling) * 100);
  const kd = validMetrics && typeof metrics?.difficulty === "number" && Number.isFinite(metrics.difficulty) && metrics.difficulty >= 0 && metrics.difficulty <= 100 ? metrics.difficulty : void 0;
  const competitionScore = kd === void 0 ? null : clamp(100 - kd);
  if (demandScore === null) tags.add("\u5F85\u8865\u641C\u7D22\u91CF");
  if (kd === void 0) tags.add("\u5F85\u8865KD");
  if (metrics && !validMetrics) tags.add("\u6307\u6807\u5F85\u6838\u9A8C\u6216\u8FC7\u671F");
  if (metrics?.source.includes("Semrush")) {
    tags.add("Semrush\u6307\u6807");
    if (metrics.intent) tags.add(`\u641C\u7D22\u610F\u56FE\uFF1A${metrics.intent}`);
  }
  const intent = validMetrics ? metrics?.intent || "" : "";
  const purchaseIntent = /(?:^|[,;\s])(2|3)(?:$|[,;\s])|commercial|transactional/i.test(intent);
  const navigationIntent = /^1$|^navigational$/i.test(intent.trim());
  if (purchaseIntent && !offTopic) product = clamp(product + 10);
  if (volume === 0) tags.add("\u5E73\u53F0\u641C\u7D22\u91CF\u4E3A0");
  const dimensions = [
    {
      key: "relevance",
      label: "\u4E1A\u52A1\u76F8\u5173\u6027",
      weight: 25,
      coveredWeight: 25,
      score: relevance,
      evidence: offTopic ? "\u547D\u4E2D\u533B\u9662\u3001\u670D\u52A1\u3001\u62DB\u8058\u6216\u5A92\u4F53\u7B49\u975E\u5546\u54C1\u8868\u8FBE\u89C4\u5219" : "\u7ED3\u5408\u5173\u952E\u8BCD\u3001\u79CD\u5B50\u8BCD\u4E0A\u4E0B\u6587\u548C\u7814\u7A76\u54C1\u7C7B\u7684\u89C4\u5219\u5224\u65AD"
    },
    {
      key: "demand",
      label: "\u9700\u6C42\u89C4\u6A21",
      weight: 20,
      coveredWeight: demandScore === null ? 0 : 20,
      score: demandScore,
      evidence: volume === void 0 ? "\u7F3A\u5C11\u6709\u6765\u6E90\u3001\u65E5\u671F\u548C\u540C\u5E02\u573A\u7684\u641C\u7D22\u91CF\u6307\u6807" : `\u6708\u641C\u7D22\u91CF${volume}\uFF1B${metrics?.source}\uFF1B\u5E02\u573A\u56FA\u5B9A\u53C2\u8003\u4E0A\u6CBF${volumeCeiling}`
    },
    {
      key: "trend",
      label: "\u8D8B\u52BF\u8868\u73B0",
      weight: 20,
      coveredWeight: trendScore === null ? 0 : 20,
      score: trendScore,
      evidence: trendEvidence
    },
    {
      key: "product",
      label: "\u5546\u54C1\u7814\u7A76\u4EF7\u503C",
      weight: 20,
      coveredWeight: 20,
      score: product,
      evidence: `\u6210\u5206\u3001\u5242\u578B\u4E0E\u5546\u54C1\u8868\u8FBE\u7684\u89C4\u5219\u8BC4\u5206${purchaseIntent ? "\uFF1BSemrush \u5546\u4E1A\u6216\u4EA4\u6613\u610F\u56FE\u52A010\u5206\uFF08\u672C\u7EF4\u5EA6\u5C01\u9876100\uFF09" : ""}\uFF1B\u4E0D\u4EE3\u8868\u9500\u91CF\u6216\u5229\u6DA6`
    },
    {
      key: "competition",
      label: "\u7ADE\u4E89\u5207\u5165\u7A7A\u95F4",
      weight: 15,
      coveredWeight: kd === void 0 ? 0 : 15,
      score: competitionScore,
      evidence: kd === void 0 ? "\u7F3A\u5C11\u540C\u5E02\u573A\u81EA\u7136\u641C\u7D22 KD\uFF1B\u5E7F\u544A\u7ADE\u4E89\u5EA6\u4E0D\u662F KD" : `100 \u2212 KD(${kd})\uFF1B${metrics?.source}\uFF1B\u4EC5\u53CD\u6620\u81EA\u7136\u641C\u7D22\u6392\u540D\u96BE\u5EA6\uFF0C\u4E0D\u7B49\u4E8E\u5546\u4E1A\u7ADE\u4E89\u3001\u76C8\u5229\u6216\u524D\u4E09\u7AD9\u70B9\u6D41\u91CF\u4EFD\u989D`
    }
  ];
  const coverage = dimensions.reduce(
    (sum, item) => sum + item.coveredWeight,
    0
  );
  const canGrade = trendScore !== null && demandScore !== null && coverage >= 80;
  let score = canGrade ? clamp(
    dimensions.reduce(
      (sum, item) => sum + (item.score || 0) * item.coveredWeight,
      0
    ) / coverage
  ) : null;
  if (score !== null) {
    if (offTopic) score = Math.min(score, 39);
    if (brand || navigationIntent) score = Math.min(score, 64);
    if (volume === 0) score = Math.min(score, 49);
  }
  const grade = score === null ? null : gradeForScore(score);
  let status = "pending";
  if (grade) status = coverage === 100 ? "rated" : "provisional";
  const recommendations = {
    A: "\u4F18\u5148\u4EBA\u5DE5\u590D\u6838\uFF0C\u53EF\u5165\u9009\u4E0B\u4E00\u6B65\u72EC\u7ACB\u7AD9\u7814\u7A76",
    B: "\u6709\u7814\u7A76\u4EF7\u503C\uFF0C\u7ED3\u5408\u5206\u9879\u4F9D\u636E\u51B3\u5B9A\u662F\u5426\u5165\u9009",
    C: "\u7EE7\u7EED\u89C2\u5BDF\uFF0C\u4F18\u5148\u8865\u5145\u7F3A\u5931\u8BC1\u636E",
    D: "\u6682\u7F13\u6DF1\u5165\u7814\u7A76\uFF0C\u68C0\u67E5\u76F8\u5173\u6027\u548C\u9700\u6C42\u4FE1\u53F7"
  };
  return {
    version: KEYWORD_MODEL_VERSION,
    assessedAt: metrics?.collectedAt || keyword.trendCollectedAt || keyword.collectedAt || keyword.updatedAt || "",
    grade,
    status,
    score,
    coverage,
    tags: [...tags],
    recommendation: grade ? recommendations[grade] : "\u5148\u8865\u9F50\u6709\u6548\u8D8B\u52BF\u4E0E\u5173\u952E\u6307\u6807\uFF0C\u518D\u8FDB\u884C\u8BC4\u7EA7",
    dimensions
  };
}

// apps/web-antd/src/views/intelligence/site-discovery.ts
function trendRecordFields(trend) {
  return {
    growth: trend.growth,
    series: trend.series,
    trendPoints: trend.points,
    trendDailyPoints: trend.dailyPoints || [],
    trendResolution: trend.resolution || "unknown",
    trendPeriod: trend.period,
    trendSourceUrl: trend.sourceUrl,
    trendCollectedAt: trend.collectedAt,
    trendDailyMessage: trend.dailyMessage,
    trendStatus: trend.series.length > 0 ? "collected" : "failed",
    trendMessage: trend.message || trend.dailyMessage || "\u5DF2\u91C7\u96C6\u4E00\u5E74\u8D8B\u52BF"
  };
}
function classifyKeyword(...values) {
  const text = values.join(" ").toLocaleLowerCase();
  const rules = [
    [
      /probiotic|prebiotic|gut|digest|inulin|psyllium|fiber|fibre|men vi sinh|đường ruột|chất xơ|probiótico|digestiv/,
      "\u80A0\u9053\u4E0E\u76CA\u751F\u83CC"
    ],
    [
      /women|woman|female|menopause|prenatal|fertility|inositol|phụ nữ|nội tiết|mujer|femenin/,
      "\u5973\u6027\u5065\u5EB7"
    ],
    [
      /collagen|skin|beauty|hair|nail|anti-aging|anti aging|làm đẹp|da tóc|belleza/,
      "\u7F8E\u5BB9\u4E0E\u6297\u8870"
    ],
    [
      /weight|slim|metabolism|fat burn|keto|giảm cân|control de peso/,
      "\u4F53\u91CD\u7BA1\u7406"
    ],
    [/sleep|stress|calm|melatonin|ashwagandha|ngủ|estrés|sueño/, "\u7761\u7720\u4E0E\u538B\u529B"],
    [/protein|creatine|bcaa|workout|sport|gym|thể thao|deport/, "\u8FD0\u52A8\u8425\u517B"],
    [
      /multivitamin|vitamin|mineral|magnesium|omega|zinc|supplement|thực phẩm bổ sung|vitamina|suplemento/,
      "\u529F\u80FD\u6027\u8425\u517B"
    ]
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "\u5F85\u5206\u7C7B";
}
export {
  assessKeyword,
  classifyKeyword,
  trendRecordFields
};

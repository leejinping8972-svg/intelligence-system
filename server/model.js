// apps/web-antd/src/views/intelligence/keyword-relevance.ts
function normalize(value) {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase().replaceAll("\u0111", "d").replaceAll(/[‐‑‒–—−]/g, "-").replaceAll(/\s+/g, " ").trim();
}
var families = [
  ["omega", /\b(?:omega\s*-?\s*[369]|dha|epa)\b|欧米伽\s*[369]|欧米茄\s*[369]/],
  ["fish-oil", /\b(?:fish[ -]oil|aceite de pescado|dau ca)\b|鱼油|魚油/],
  ["magnesium", /\b(?:magnesium|magnesio|magie)\b|镁|鎂/],
  ["collagen", /\b(?:collagen|colageno|collagene)\b|胶原|膠原/],
  ["creatine", /\b(?:creatine|creatina)\b|肌酸/],
  ["probiotic", /\b(?:probiotics?|probioticos?|men vi sinh)\b|益生菌/],
  [
    "prebiotic",
    /\b(?:prebiotics?|prebioticos?|inulin|inulina|psyllium)\b|益生元|菊粉|车前子/
  ],
  ["inositol", /\b(?:inositol|myo inositol)\b|肌醇/],
  ["ashwagandha", /\bashwagandha\b|南非醉茄/],
  ["berberine", /\b(?:berberine|berberina)\b|小檗碱/],
  ["melatonin", /\b(?:melatonin|melatonina)\b|褪黑素/],
  [
    "vitamin",
    /\b(?:multi\s*-?\s*vitamins?|vitamins?|vitaminas?)\b|维生素|維生素/
  ],
  ["protein", /\b(?:protein|proteina|whey)\b|蛋白/],
  ["electrolyte", /\b(?:electrolytes?|electrolitos?|dien giai)\b|电解质/],
  ["fiber", /\b(?:fibers?|fibres?|fibra|chat xo)\b|膳食纤维/],
  ["zinc", /\b(?:zinc|kem)\b|锌|鋅/],
  ["calcium", /\b(?:calcium|calcio|canxi)\b|钙|鈣/],
  ["iron", /\b(?:iron|hierro|sat)\b|补铁|補鐵/],
  ["coq10", /\b(?:coq\s*-?\s*10|coenzyme q10|ubiquinol)\b|辅酶Q10/i]
];
var formPattern = /\b(?:gumm(?:y|ies)|capsules?|capsulas?|powders?|polvo|softgels?|tablets?|liquid|liquido|bot|vien)\b|软糖|軟糖|胶囊|膠囊|粉剂|片剂|滴剂/;
var supplementPattern = /\b(?:supplements?|suplementos?|complementos? alimenticios?|thuc pham (?:bo sung|chuc nang)|bo sung|health products?)\b|保健品|膳食补充剂|营养补充剂|營養補充劑/;
var purchasePattern = /\b(?:buy|price|shop|comprar|precio|mua|gia)\b|购买|價格|价格/;
var dosePattern = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|iu|cfu|ui)\b|\d+\s*(?:毫克|微克|亿菌|%)/;
var audiencePattern = /\b(?:women|female|menopause|prenatal|pregnancy|kids|children|seniors|phu nu|mujeres?|ninos)\b|女性|孕妇|儿童|老年/;
var informationPattern = /\b(?:how|what|benefits?|side effects?|cach|la gi|como|para que)\b|功效|副作用|是什么/;
var brandPattern = /\b(?:amazon|walmart|iherb|now foods|nature made|garden of life|lemme|goli)\b/;
var excludedPattern = /\b(?:watch(?:es)?|watchbands?|watchstraps?|seamaster|speedmaster|swatch|rolex|reloj(?:es)?|dong ho|cars?|car parts?|motor oil|engine oil|pet food|dog food|cat food|dogs?|cats?|puppies|pets?|veterinary|perros?|gatos?|thu cung|cho meo|shampoo|serum|face cream)\b|手表|腕表|欧米茄手表|汽车|机油|宠物|猫粮|狗粮|洗发水|面霜/;
var servicePattern = /\b(?:hospitals?|clinics?|doctors?|jobs?|salary|magazine|badge reel|services?|partners|specialists?|environmental protection agency)\b|benh vien|tuyen dung|招聘|医院/;
function ingredients(text) {
  return families.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
}
function assessSupplementRelevance(keyword) {
  const text = normalize(keyword.term);
  const found = ingredients(text);
  const seeds = ingredients(normalize(keyword.seedTerm || ""));
  const scope = (key) => key === "fish-oil" ? "omega" : key;
  const seedMatch = found.some(
    (key) => seeds.some((seed) => scope(key) === scope(seed))
  );
  const seedMismatch = found.length > 0 && seeds.length > 0 && !seedMatch;
  const ingredient = found.length > 0;
  const form = formPattern.test(text);
  const commercial = supplementPattern.test(text) || purchasePattern.test(text);
  const information = informationPattern.test(text);
  const brand = brandPattern.test(text);
  const audience = audiencePattern.test(text);
  const dose = dosePattern.test(text);
  const excluded = excludedPattern.test(text) || /\bomega\b.*\b(?:constellation|de ville|planet ocean)\b/.test(text);
  const service = servicePattern.test(text);
  const offTopic = excluded || service;
  const ambiguous = /\bomega\b/.test(text) && !ingredient;
  const broadFishOil = found.length === 1 && found.includes("fish-oil") && !(form && dose);
  const broadCategory = !ingredient && supplementPattern.test(text);
  const bareIngredient = ingredient && !form && !dose && !audience;
  const tags = [];
  if (ingredient && !offTopic) tags.push("\u6210\u5206\u8BCD");
  if (form && ingredient && !offTopic) tags.push("\u5242\u578B\u8BCD");
  if ((ingredient || broadCategory) && !offTopic) tags.push("\u5546\u54C1\u9700\u6C42\u8BCD");
  if (audience) tags.push("\u4EBA\u7FA4\u8BCD");
  if (brand) tags.push("\u54C1\u724C\u5BFC\u822A\u8BCD");
  if (information) tags.push("\u5185\u5BB9\u7814\u7A76\u8BCD");
  if (seedMatch && !offTopic) tags.push("\u79CD\u5B50\u6210\u5206\u5339\u914D");
  if (seedMismatch && !offTopic) tags.push("\u504F\u79BB\u79CD\u5B50\u6210\u5206");
  let relevance = 20;
  let product = 10;
  let scoreCap = 49;
  let evidence = "\u5173\u952E\u8BCD\u81EA\u8EAB\u7F3A\u5C11\u53EF\u8BC6\u522B\u7684\u4FDD\u5065\u54C1\u6210\u5206\u4F9D\u636E\uFF0C\u5206\u7C7B\u6807\u7B7E\u4E0E\u79CD\u5B50\u8BCD\u4E0D\u4F5C\u4E3A\u76F8\u5173\u6027\u8BC1\u660E\uFF1B\u603B\u5206\u6700\u9AD849";
  if (ingredient) {
    relevance = Math.min(
      100,
      75 + (form ? 15 : 0) + (dose ? 5 : 0) + (audience ? 5 : 0) + (seedMatch ? 5 : 0)
    );
    product = Math.min(
      100,
      55 + (form ? 25 : 0) + (commercial ? 10 : 0) + (dose ? 10 : 0) + (audience ? 5 : 0)
    );
    scoreCap = bareIngredient ? 69 : 100;
    evidence = `\u5173\u952E\u8BCD\u81EA\u8EAB\u8BC6\u522B\u5230\u4FDD\u5065\u54C1\u6210\u5206${form ? "\u3001\u5242\u578B" : ""}${dose ? "\u3001\u5242\u91CF" : ""}${audience ? "\u3001\u9002\u7528\u4EBA\u7FA4" : ""}${seedMatch ? "\uFF1B\u4E0E\u79CD\u5B50\u6210\u5206\u5339\u914D" : ""}${bareIngredient ? "\uFF1B\u6210\u5206\u77ED\u8BCD\u7F3A\u5C11\u5177\u4F53\u5546\u54C1\u9650\u5B9A\uFF0C\u603B\u5206\u6700\u9AD869" : ""}`;
  }
  if (broadFishOil || broadCategory) {
    relevance = broadFishOil ? 55 : 40;
    product = broadFishOil ? 40 : 25;
    scoreCap = broadFishOil ? 59 : 49;
    tags.push("\u6CDB\u8BCD\u964D\u6743");
    evidence = `${broadFishOil ? "\u9C7C\u6CB9\u7C7B\u6CDB\u8BCD\uFF0C\u672A\u660E\u786EOmega-3/EPA/DHA\u6216\u5242\u578B\u4E0E\u5242\u91CF\u7EC4\u5408" : "\u4FDD\u5065\u54C1\u7C7B\u76EE\u6CDB\u8BCD\uFF0C\u672A\u660E\u786E\u5177\u4F53\u6210\u5206"}\uFF1B\u603B\u5206\u6700\u9AD8${scoreCap}`;
  }
  if (seedMismatch) {
    relevance = Math.min(relevance, 45);
    scoreCap = Math.min(scoreCap, 59);
    evidence += "\uFF1B\u5173\u952E\u8BCD\u6210\u5206\u4E0E\u79CD\u5B50\u6210\u5206\u4E0D\u5339\u914D\uFF0C\u603B\u5206\u6700\u9AD859";
  }
  if (information && !offTopic) {
    scoreCap = Math.min(scoreCap, 64);
    evidence += "\uFF1B\u4FE1\u606F\u67E5\u8BE2\u7528\u4E8E\u5185\u5BB9\u7814\u7A76\uFF0C\u603B\u5206\u6700\u9AD864";
  }
  if (ambiguous && !offTopic) {
    relevance = 15;
    product = 10;
    scoreCap = 39;
    tags.push("\u540C\u540D\u6B67\u4E49\u5F85\u6838\u9A8C");
    evidence = "\u5355\u72ECOmega\u4E0D\u80FD\u8BC1\u660E\u662FOmega-3\u4FDD\u5065\u54C1\uFF1B\u9700\u660E\u786E\u6210\u5206\u8868\u8FBE\uFF0C\u603B\u5206\u6700\u9AD839";
  }
  if (offTopic) {
    relevance = excluded ? 0 : 10;
    product = excluded ? 0 : 10;
    scoreCap = excluded ? 19 : 39;
    tags.push("\u975E\u5546\u54C1\u9700\u6C42", ...excluded ? ["\u975E\u4FDD\u5065\u54C1\u7C7B\u76EE"] : []);
    evidence = `${excluded ? "\u547D\u4E2D\u624B\u8868\u3001\u6C7D\u8F66\u3001\u5BA0\u7269\u6216\u5916\u7528\u62A4\u80A4\u7B49\u975E\u76EE\u6807\u7C7B\u76EE" : "\u547D\u4E2D\u533B\u7597\u670D\u52A1\u3001\u62DB\u8058\u6216\u5A92\u4F53\u7B49\u975E\u5546\u54C1\u8868\u8FBE"}\uFF1B\u79CD\u5B50\u4E0E\u5206\u7C7B\u4E0D\u80FD\u62B5\u6D88\uFF0C\u603B\u5206\u6700\u9AD8${scoreCap}`;
  }
  return { relevance, product, scoreCap, evidence, tags, offTopic, brand };
}

// apps/web-antd/src/views/intelligence/keyword-scoring.ts
var KEYWORD_MODEL_VERSION = "keyword-research-v3.1-30d";
var clamp = (value) => Math.round(Math.max(0, Math.min(100, value)));
function gradeForScore(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}
function assessKeyword(keyword) {
  if (keyword.listSummary && keyword.assessment) return keyword.assessment;
  const business = assessSupplementRelevance(keyword);
  const { relevance, offTopic, brand } = business;
  const tags = new Set(business.tags);
  if (keyword.source.includes("Sorftime")) tags.add("Amazon\u7AD9\u5185\u6765\u6E90");
  let product = business.product;
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
    const windowPoints = daily.length >= 60 && dailySpan >= 59 ? daily : points;
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
      return days >= 30 ? sum / days : null;
    };
    const previous = avgWindow(end - 60 * 864e5, end - 30 * 864e5);
    const recent = avgWindow(end - 30 * 864e5, end);
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
    trendEvidence = `\u4E00\u5E74\u8D8B\u52BF\u6301\u7EED\u602765% + \u8FD130\u5929\u76F8\u5BF9\u6B64\u524D30\u5929\u52A8\u91CF35%\uFF1B${dailyUsed ? "\u65E5\u6570\u636E" : "\u6309\u539F\u59CB\u65F6\u70B9\u8986\u76D6\u5929\u6570\u52A0\u6743"}\uFF0C\u6709\u6548\u70B9${points.length}\u4E2A\uFF0C\u8986\u76D6${Math.round(span)}\u5929\uFF1B\u5C16\u5CF0\u964D\u6743\uFF0C\u4E0D\u4EE3\u8868\u641C\u7D22\u91CF`;
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
  const purchaseBonus = purchaseIntent && !offTopic && business.scoreCap > 49;
  if (purchaseBonus) product = clamp(product + 10);
  if (volume === 0) tags.add("\u5E73\u53F0\u641C\u7D22\u91CF\u4E3A0");
  const dimensions = [
    {
      key: "relevance",
      label: "\u4E1A\u52A1\u76F8\u5173\u6027",
      weight: 25,
      coveredWeight: 25,
      score: relevance,
      evidence: business.evidence
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
      evidence: `\u4FDD\u5065\u54C1\u6210\u5206\u3001\u5242\u578B\u3001\u5242\u91CF\u3001\u4EBA\u7FA4\u4E0E\u5546\u54C1\u8868\u8FBE\u7684\u89C4\u5219\u8BC4\u5206${purchaseBonus ? "\uFF1BSemrush \u5546\u4E1A\u6216\u4EA4\u6613\u610F\u56FE\u52A010\u5206\uFF08\u672C\u7EF4\u5EA6\u5C01\u9876100\uFF09" : ""}\uFF1B\u4E0D\u4EE3\u8868\u9500\u91CF\u6216\u5229\u6DA6`
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
    score = Math.min(score, business.scoreCap);
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
  let recommendation = grade ? recommendations[grade] : "\u5148\u8865\u9F50\u6709\u6548\u8D8B\u52BF\u4E0E\u5173\u952E\u6307\u6807\uFF0C\u518D\u8FDB\u884C\u8BC4\u7EA7";
  if (tags.has("\u6CDB\u8BCD\u964D\u6743"))
    recommendation = "\u6CDB\u8BCD\u4F18\u5148\u7EC6\u5316\u6210\u5206\u3001\u5242\u578B\u3001\u5242\u91CF\u6216\u4EBA\u7FA4\uFF0C\u518D\u8BC4\u4F30\u5546\u54C1\u673A\u4F1A";
  if (tags.has("\u540C\u540D\u6B67\u4E49\u5F85\u6838\u9A8C"))
    recommendation = "\u5148\u6838\u9A8C\u662F\u5426\u6307Omega-3\u4FDD\u5065\u54C1\uFF0C\u660E\u786E\u6210\u5206\u540E\u518D\u7814\u7A76";
  if (offTopic) recommendation = "\u4E0D\u5C5E\u4E8E\u76EE\u6807\u4FDD\u5065\u54C1\u5546\u54C1\u9700\u6C42\uFF0C\u5EFA\u8BAE\u6392\u9664\u6216\u4EBA\u5DE5\u6838\u9A8C";
  return {
    version: KEYWORD_MODEL_VERSION,
    assessedAt: metrics?.collectedAt || keyword.trendCollectedAt || keyword.collectedAt || keyword.updatedAt || "",
    grade,
    status,
    score,
    coverage,
    tags: [...tags],
    recommendation,
    dimensions
  };
}

// apps/web-antd/src/views/intelligence/trend-comparison.ts
var DAY = 864e5;
var day = (value) => Math.floor(value / DAY) * DAY;
var date = (value) => new Date(value).toISOString().slice(0, 10);
var round = (value) => Math.round(value * 10) / 10;
function monthsBefore(end, months) {
  const original = new Date(end);
  const target = new Date(
    Date.UTC(original.getUTCFullYear(), original.getUTCMonth() - months, 1)
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(original.getUTCDate(), lastDay));
  return target.getTime();
}
function intervals(points = [], resolution = "unknown", collectedAt) {
  const valid = [
    ...new Map(
      points.filter(
        (p) => !p.isPartial && Number.isFinite(Date.parse(p.date)) && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100
      ).map((p) => [day(Date.parse(p.date)), p.value])
    ).entries()
  ].toSorted((a, b) => a[0] - b[0]);
  let step = 0;
  if (resolution === "day") step = 1;
  if (resolution === "week") step = 7;
  if (!step || valid.length === 0) return [];
  const captured = Date.parse(collectedAt || "");
  const cutoff = Number.isFinite(captured) ? day(captured) : Infinity;
  return valid.map(([start, value], i) => ({
    start,
    end: Math.min(start + step * DAY, valid[i + 1]?.[0] ?? Infinity, cutoff),
    value
  })).filter((p) => p.end > p.start);
}
function compare(key, label, source, months = 0, bounds) {
  const result = {
    key,
    label,
    heat: null,
    change: null,
    currentMean: null,
    previousMean: null,
    reason: "\u7F3A\u5C11\u5B8C\u6574\u8D8B\u52BF\u65F6\u5E8F"
  };
  const lastPoint = source.at(-1);
  if (!lastPoint) return result;
  const end = bounds?.end ?? lastPoint.end;
  const start = bounds?.start ?? (months ? monthsBefore(end, months) : end - 30 * DAY);
  const previousStart = bounds?.previousStart ?? (months ? monthsBefore(end, months * 2) : start - 30 * DAY);
  if (end <= start) {
    result.reason = "\u672C\u5468\u671F\u5C1A\u65E0\u5B8C\u6574\u65E5\u6570\u636E";
    return result;
  }
  Object.assign(result, {
    start: date(start),
    end: date(end - DAY),
    previousStart: date(previousStart)
  });
  const average = (from, to) => {
    let coverage = 0;
    let total = 0;
    let first = Infinity;
    let last = -Infinity;
    const tolerance = source.some((p) => p.end - p.start > DAY) ? 7 * DAY : 0;
    for (const p of source) {
      const overlap = Math.max(
        0,
        Math.min(to, p.end) - Math.max(from, p.start)
      );
      if (!overlap) continue;
      coverage += overlap;
      total += p.value * overlap;
      first = Math.min(first, Math.max(from, p.start));
      last = Math.max(last, Math.min(to, p.end));
    }
    return coverage > 0 && coverage === last - first && coverage >= to - from - tolerance ? { mean: total / coverage } : null;
  };
  const current = average(start, end);
  if (!current) return result;
  result.currentMean = current.mean;
  result.heat = Math.round(current.mean);
  const previous = average(previousStart, bounds?.previousEnd ?? start);
  if (!previous) {
    result.reason = "\u7F3A\u5C11\u6B64\u524D\u7B49\u957F\u5468\u671F\uFF0C\u5F85\u8865\u5BF9\u6BD4";
    return result;
  }
  result.previousMean = previous.mean;
  if (previous.mean === 0) {
    result.reason = current.mean > 0 ? "\u6B64\u524D\u57FA\u671F\u4E3A0\uFF0C\u65B0\u51FA\u73B0\u4FE1\u53F7\uFF0C\u4E0D\u80FD\u8BA1\u7B97\u767E\u5206\u6BD4" : "\u57FA\u671F\u4E3A0\uFF0C\u641C\u7D22\u6837\u672C\u4E0D\u8DB3\uFF0C\u4E0D\u80FD\u8BA1\u7B97\u767E\u5206\u6BD4";
    return result;
  }
  result.change = round((current.mean - previous.mean) / previous.mean * 100);
  if (Object.is(result.change, -0)) result.change = 0;
  result.reason = "\u4E0E\u6B64\u524D\u7B49\u957F\u5468\u671F\u5E73\u5747\u70ED\u5EA6\u6BD4\u8F83";
  return result;
}
function trendComparisons(record) {
  if (record.listSummary && record.trendSummary?.length === 3)
    return record.trendSummary;
  const daily = intervals(
    record.trendDailyPoints,
    "day",
    record.trendDailyCollectedAt
  );
  const annual = intervals(
    record.trendPoints,
    record.trendResolution,
    record.trendCollectedAt
  );
  const history = intervals(
    record.trendHistoryPoints,
    record.trendHistoryResolution,
    record.trendHistoryCollectedAt
  );
  return [
    compare("month", "\u8FD130\u5929", daily),
    compare("halfYear", "\u8FD1\u534A\u5E74", history.length > 0 ? history : annual, 6),
    compare("year", "\u8FD1\u4E00\u5E74", history.length > 0 ? history : annual, 12)
  ];
}

// server/discovery-newness.mjs
var DAY2 = 864e5;
function validDiscoveryDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
    return void 0;
  if (value.length > 10 && !Number.isFinite(Date.parse(value)))
    return void 0;
  const date2 = value.slice(0, 10);
  const time = Date.parse(`${date2}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date2 ? time : void 0;
}
function discoveryDecision(item, kind, now = Date.now()) {
  const first = item.discovery?.firstSeenAt || item.firstSeenAt;
  const observed = validDiscoveryDate(first);
  const recentDiscovery = observed !== void 0 && Date.parse(first) <= now && now - observed < 8 * DAY2;
  const listing = item.decisionData?.listing;
  const isProduct = kind === "product";
  const date2 = isProduct ? listing?.date : item.startDate;
  const source = isProduct ? listing?.provider : item.source;
  const collectedAt = isProduct ? listing?.collectedAt : item.lastCollectedAt;
  const evidenceUrl = isProduct ? listing?.evidenceUrl : item.evidenceUrl;
  const time = validDiscoveryDate(date2);
  const collected = Date.parse(collectedAt || "");
  let publicEvidence = false;
  try {
    const url = new URL(evidenceUrl);
    publicEvidence = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
  }
  const supported = Boolean(
    source && publicEvidence && Number.isFinite(collected) && collected <= now && (!isProduct || listing.platform && listing.market === item.market)
  );
  const windowDays = isProduct ? 90 : 7;
  const known = supported && time !== void 0 && Date.parse(date2) <= Math.min(now, collected);
  const isNew = known ? Math.floor((now - time) / DAY2) <= windowDays : null;
  let label = isProduct ? "\u65B0\u54C1\u5F85\u6838\u9A8C" : "\u65B0\u5E7F\u544A\u5F85\u6838\u9A8C";
  if (isNew === true) label = isProduct ? "\u65B0\u54C1\uFF0890\u5929\u5185\uFF09" : "\u65B0\u5E7F\u544A\uFF087\u5929\u5185\uFF09";
  if (isNew === false) label = isProduct ? "\u975E\u8FD1\u671F\u65B0\u54C1" : "\u975E\u8FD1\u671F\u65B0\u5E7F\u544A";
  return {
    version: "discovery-v1",
    isNew,
    label,
    recentDiscovery,
    windowDays,
    reason: known ? `${isProduct ? "\u6765\u6E90\u4E0A\u67B6" : "\u5E73\u53F0\u6295\u653E\u5F00\u59CB"}\u65E5\u671F ${date2.slice(0, 10)}\uFF0C${isNew ? "\u5728" : "\u8D85\u8FC7"}${windowDays}\u5929\u7A97\u53E3\uFF1B${isProduct ? "\u4E0D\u7B49\u540C\u4E8E\u54C1\u724C\u9996\u53D1" : "\u6309\u5E7F\u544AID\u5224\u65AD\uFF0C\u4E0D\u5C06\u540C\u7D20\u6750\u590D\u7528\u5408\u5E76"}\u3002` : "\u7F3A\u5C11\u53EF\u6838\u9A8C\u7684\u6765\u6E90\u65E5\u671F\u6216\u6765\u6E90\u4F9D\u636E\uFF1B\u7CFB\u7EDF\u9996\u6B21\u53D1\u73B0\u4E0D\u80FD\u8BC1\u660E\u521A\u4E0A\u5E02\u6216\u521A\u5F00\u59CB\u6295\u653E\u3002",
    source: source || "",
    evidenceDate: known ? date2.slice(0, 10) : "",
    evidenceUrl: evidenceUrl || "",
    evaluatedAt: new Date(now).toISOString()
  };
}

// apps/web-antd/src/views/intelligence/product-decisions.ts
function productDataSource(product) {
  if (product.sourceProvider)
    return `${product.sourceProvider} \xB7 ${product.sourcePlatform || "\u5E73\u53F0\u5546\u54C1"}`;
  if (product.dataNature === "demo") return "\u6F14\u793A\u6837\u672C";
  return product.siteId ? "\u5B98\u7F51\u5B9E\u91C7" : "\u4EBA\u5DE5\u5BFC\u5165 / \u6765\u6E90\u5F85\u786E\u8BA4";
}
var DAY3 = 864e5;
var day2 = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : Number.NaN;
};
var sourceOf = (value) => `${value.provider} \xB7 ${value.platform} \xB7 ${value.market}`;
var periodName = { day: "\u65E5", week: "\u5468", month: "\u6708" };
function validPoint(point, period, now) {
  const start = day2(point.start), end = day2(point.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end + DAY3 > now || point.partial || typeof point.value !== "number" || !Number.isFinite(point.value) || point.value < 0)
    return false;
  if (period === "day") return start === end;
  if (period === "week") return end - start === 6 * DAY3;
  const date2 = new Date(start);
  return date2.getUTCDate() === 1 && end === Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth() + 1, 0);
}
function productDecisions(product, now = Date.now()) {
  if (product.listSummary && product.decisionTags) return product.decisionTags;
  const result = [];
  const data = product.decisionData;
  const listing = data?.listing;
  if (listing && discoveryDecision(product, "product", now).isNew === true) {
    result.push({
      key: "new_product",
      label: "\u65B0\u54C1",
      color: "purple",
      reason: `\u5E73\u53F0\u4E0A\u67B6\u65E5\u671F ${listing.date}\uFF0C\u8DDD\u89C2\u5BDF\u65E5\u4E0D\u8D85\u8FC790\u5929\uFF1B\u4E0D\u4EE3\u8868\u54C1\u724C\u9996\u6B21\u63A8\u51FA\u3002`,
      source: sourceOf(listing),
      date: listing.collectedAt,
      evidenceUrl: listing.evidenceUrl
    });
  }
  let hasTrend = false, stale = false;
  const seen = /* @__PURE__ */ new Set();
  for (const series of [...data?.series || []].toSorted(
    (a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt)
  )) {
    if (!series.provider || !series.platform || !series.productId || series.market !== product.market || ![
      "sales_volume",
      "sales_rank",
      "shopping_rank",
      "keywords_count",
      "review_count"
    ].includes(series.metric) || !["day", "week", "month"].includes(series.period) || !Array.isArray(series.points) || !Number.isFinite(Date.parse(series.collectedAt)) || Date.parse(series.collectedAt) > now)
      continue;
    const identity = [
      series.provider,
      series.platform,
      series.market,
      series.productId,
      series.metric,
      series.period
    ].join(":");
    if (seen.has(identity)) continue;
    seen.add(identity);
    const duplicates = /* @__PURE__ */ new Map();
    for (const point of series.points)
      duplicates.set(point.start, (duplicates.get(point.start) || 0) + 1);
    const points = series.points.filter(
      (p) => duplicates.get(p.start) === 1 && validPoint(p, series.period, now)
    ).toSorted((a, b) => day2(a.start) - day2(b.start));
    const current = points.at(-1), previous = points.at(-2);
    if (!current || !previous || day2(current.start) !== day2(previous.end) + DAY3)
      continue;
    if (now - day2(current.end) > { day: 7, week: 21, month: 45 }[series.period] * DAY3) {
      stale = true;
      continue;
    }
    if (["sales_rank", "shopping_rank"].includes(series.metric) && (!current.value || !previous.value))
      continue;
    hasTrend = true;
    const suffix = `${series.platform}${periodName[series.period]}`;
    const detail = `${previous.start}\uFF5E${previous.end}\uFF1A${previous.value}\uFF1B${current.start}\uFF5E${current.end}\uFF1A${current.value}\u3002`;
    const add = (key, label, color, reason, change) => result.push({
      key,
      label,
      color,
      reason: `${detail}${reason}`,
      source: sourceOf(series),
      date: series.collectedAt,
      evidenceUrl: series.evidenceUrl,
      change
    });
    const tail = [current];
    for (let i = points.length - 2; i >= 0 && tail.length < 12; i--) {
      const point = points[i];
      const firstPoint = tail[0];
      if (!point || !firstPoint || day2(firstPoint.start) !== day2(point.end) + DAY3)
        break;
      tail.unshift(point);
    }
    if (series.metric === "sales_volume" && tail.length >= 4 && tail.slice(0, -1).every((p) => p.value === 0) && current.value > 0) {
      add(
        "emerging",
        `${suffix}\u9500\u91CF\u65B0\u51FA\u73B0\u4FE1\u53F7`,
        "cyan",
        "\u6B64\u524D\u81F3\u5C11\u4E09\u4E2A\u5B8C\u6574\u5468\u671F\u9500\u91CF\u6307\u6807\u4E3A0\uFF0C\u6700\u8FD1\u51FA\u73B0\u6B63\u503C\uFF1B\u4E0D\u8BA1\u7B97\u96F6\u57FA\u6570\u589E\u957F\u7387\uFF0C\u4E5F\u4E0D\u636E\u6B64\u8BA4\u5B9A\u65B0\u54C1\u3002"
      );
      continue;
    }
    const growth = previous.value > 0 ? (current.value - previous.value) / previous.value * 100 : void 0;
    if (growth === void 0 || !Number.isFinite(growth)) {
      add(
        "low_base",
        `${suffix}\u96F6\u57FA\u6570`,
        "orange",
        "\u524D\u671F\u57FA\u6570\u4E3A0\uFF0C\u4E0D\u80FD\u8BA1\u7B97\u767E\u5206\u6BD4\uFF1B\u5F53\u524D\u6570\u636E\u4E0D\u7B49\u540C\u4E8E\u8FDE\u7EED\u589E\u957F\u3002"
      );
      continue;
    }
    if (series.metric === "sales_rank" || series.metric === "shopping_rank") {
      if (growth <= -20)
        add(
          "rank_improving",
          `${suffix}${series.metric === "shopping_rank" ? "Shopping" : "\u9500\u91CF"}\u6392\u540D\u6539\u5584`,
          "blue",
          "\u6392\u540D\u6570\u5B57\u964D\u4F4E\u8868\u793A\u4F4D\u7F6E\u6539\u5584\uFF0C\u4E0D\u7B49\u4E8E\u9500\u91CF\u589E\u957F\u3002",
          growth
        );
      else if (growth >= 20)
        add(
          "rank_declining",
          `${suffix}\u6392\u540D\u56DE\u843D`,
          "orange",
          "\u6392\u540D\u6570\u5B57\u589E\u52A0\u8868\u793A\u4F4D\u7F6E\u56DE\u843D\u3002",
          growth
        );
      else
        add(
          "rank_stable",
          `${suffix}\u6392\u540D\u53D8\u5316\u6709\u9650`,
          "default",
          "\u6392\u540D\u53D8\u5316\u672A\u8FBE\u523020%\u7684\u63D0\u793A\u9608\u503C\u3002",
          growth
        );
      continue;
    }
    if (series.metric === "review_count") {
      add(
        "review_activity",
        `${suffix}\u8BC4\u8BBA\u6570${growth > 0 ? "\u589E\u52A0" : growth < 0 ? "\u51CF\u5C11" : "\u4E0D\u53D8"}`,
        "blue",
        `\u8BC4\u8BBA\u6570\u7531${previous.value}\u53D8\u4E3A${current.value}\uFF0C\u53D8\u5316${growth.toFixed(1)}%\uFF1B\u8BC4\u8BBA\u6307\u6807\u4E0D\u7B49\u4E8E\u9500\u91CF\u3002`,
        growth
      );
      continue;
    }
    if (series.metric === "keywords_count") {
      if (growth >= 20)
        add(
          "coverage_growing",
          `${suffix}\u641C\u7D22\u8986\u76D6\u6269\u5927`,
          "blue",
          "\u5546\u54C1\u8986\u76D6\u5173\u952E\u8BCD\u6570\u589E\u52A0\uFF0C\u4E0D\u7B49\u4E8E\u9500\u91CF\u6216\u70B9\u51FB\u589E\u957F\u3002",
          growth
        );
      else if (growth <= -20)
        add(
          "coverage_declining",
          `${suffix}\u641C\u7D22\u8986\u76D6\u7F29\u5C0F`,
          "orange",
          "\u5546\u54C1\u8986\u76D6\u5173\u952E\u8BCD\u6570\u51CF\u5C11\u3002",
          growth
        );
      else
        add(
          "coverage_stable",
          `${suffix}\u641C\u7D22\u8986\u76D6\u53D8\u5316\u6709\u9650`,
          "default",
          "\u8986\u76D6\u53D8\u5316\u672A\u8FBE\u523020%\u7684\u63D0\u793A\u9608\u503C\u3002",
          growth
        );
      continue;
    }
    const peakIndex = tail.length - 3;
    const baseline = tail.slice(0, peakIndex);
    const baselineValues = baseline.map((p) => p.value).toSorted((a, b) => a - b);
    const median = baselineValues[Math.floor(baselineValues.length / 2)] || 0;
    const peak = tail[peakIndex];
    if (peak && baseline.length >= 3 && median >= 20 && peak.value >= median * 3 && tail.slice(peakIndex + 1).every((p) => p.value <= median * 1.5)) {
      add(
        "spike",
        `${suffix}\u9500\u91CF\u5076\u53D1\u5C16\u5CF0`,
        "orange",
        `\u5CF0\u503C\u5468\u671F ${peak.start} \u6307\u6807${peak.value}\uFF0C\u81F3\u5C11\u662F\u524D\u671F\u4E2D\u4F4D\u6570${median}\u76843\u500D\uFF0C\u540E\u4E24\u4E2A\u5468\u671F\u5DF2\u56DE\u843D\u81F3\u4E2D\u4F4D\u65701.5\u500D\u4EE5\u5185\u3002`
      );
      continue;
    }
    const sign = growth >= 0 ? "+" : "";
    if (growth >= 20 && previous.value < 20)
      add(
        "low_base",
        `${suffix}\u9500\u91CF\u4F4E\u57FA\u6570\u589E\u957F`,
        "orange",
        `\u53D8\u5316${sign}${growth.toFixed(1)}%\uFF0C\u524D\u671F\u6307\u6807\u4E0D\u8DB320\uFF0C\u4E0D\u6807\u8BB0\u6301\u7EED\u589E\u957F\u3002`,
        growth
      );
    else if (growth >= 20) {
      add(
        "growing",
        `${suffix}\u9500\u91CF\u8FD1\u671F\u589E\u957F`,
        "green",
        `\u53D8\u5316${sign}${growth.toFixed(1)}%\uFF0C\u8FBE\u523020%\u7684\u63D0\u793A\u9608\u503C\u3002\u9500\u91CF\u53E3\u5F84\u4EE5\u5E73\u53F0\u4E3A\u51C6\u3002`,
        growth
      );
      const last = tail.slice(-4);
      if (last.length === 4 && (last[0]?.value ?? 0) >= 20 && last.slice(1).every((p, i) => last[i] !== void 0 && p.value > last[i].value))
        add(
          "sustained",
          `${suffix}\u9500\u91CF\u6301\u7EED\u589E\u957F`,
          "green",
          "\u6700\u8FD1\u56DB\u4E2A\u5B8C\u6574\u89C2\u6D4B\u503C\u8FDE\u7EED\u4E0A\u5347\uFF0C\u5F62\u6210\u4E09\u4E2A\u8FDE\u7EED\u589E\u957F\u5468\u671F\u3002"
        );
    } else if (growth <= -20)
      add(
        "declining",
        `${suffix}\u9500\u91CF\u8FD1\u671F\u56DE\u843D`,
        "orange",
        `\u53D8\u5316${growth.toFixed(1)}%\uFF0C\u8FBE\u5230-20%\u7684\u63D0\u793A\u9608\u503C\u3002`,
        growth
      );
    else
      add(
        "stable",
        `${suffix}\u9500\u91CF\u53D8\u5316\u6709\u9650`,
        "default",
        `\u53D8\u5316${sign}${growth.toFixed(1)}%\uFF0C\u672A\u8FBE\u5230\u589E\u957F\u6216\u56DE\u843D\u9608\u503C\u3002`,
        growth
      );
  }
  const first = Date.parse(product.firstSeenAt || "");
  if (Number.isFinite(first) && first <= now && now - first < 14 * DAY3)
    result.push({
      key: "first_seen",
      label: "\u9996\u6B21\u53D1\u73B0",
      color: "default",
      reason: "\u7CFB\u7EDF\u5728\u6700\u8FD114\u5929\u9996\u6B21\u91C7\u96C6\u5230\u8BE5\u5546\u54C1\uFF0C\u4E0D\u8868\u793A\u5546\u54C1\u521A\u4E0A\u67B6\u3002",
      source: "\u7CFB\u7EDF\u91C7\u96C6\u8BB0\u5F55",
      date: new Date(first).toISOString()
    });
  if (!hasTrend) {
    const steps = Object.entries(product.dataCompletion || {}).filter(
      ([key]) => key.startsWith("trend")
    );
    const states = steps.map(([, value]) => value);
    let label = stale ? "\u8D8B\u52BF\u6570\u636E\u8FC7\u65E7" : "\u8D8B\u52BF\u672A\u8BF7\u6C42";
    let reason = stale ? "\u5386\u53F2\u6570\u636E\u5DF2\u8D85\u8FC7\u65F6\u6548\u7A97\u53E3\uFF0C\u6682\u4E0D\u7528\u4E8E\u5F53\u524D\u8D8B\u52BF\u5224\u65AD\u3002" : "\u8BE5\u5546\u54C1\u5C1A\u672A\u5B8C\u6210\u5386\u53F2\u8BF7\u6C42\uFF1B\u53EF\u5728\u5546\u54C1\u5E93\u70B9\u51FB\u8865\u5168\u5546\u54C1\u6570\u636E\u3002";
    if (states.some((s) => ["queued", "running"].includes(s.status))) {
      label = "\u8D8B\u52BF\u8865\u5168\u4E2D";
      reason = "\u5DF2\u8FDB\u5165\u540E\u53F0\u8865\u5168\u961F\u5217\uFF0C\u5173\u95ED\u9875\u9762\u540E\u7EE7\u7EED\u6267\u884C\u3002";
    } else if (states.some((s) => ["failed", "unknown", "cancelled"].includes(s.status))) {
      label = "\u8D8B\u52BF\u91C7\u96C6\u672A\u5B8C\u6210";
      reason = states.filter((s) => ["failed", "unknown", "cancelled"].includes(s.status)).map((s) => s.message).join("\uFF1B");
    } else if (states.length > 0 && states.every((s) => s.status === "unsupported")) {
      label = "\u6765\u6E90\u4E0D\u63D0\u4F9B\u5386\u53F2";
      reason = states.map((s) => s.message).join("\uFF1B");
    } else if (states.length > 0 && states.every((s) => s.status === "empty")) {
      label = "\u5E73\u53F0\u6682\u65E0\u6709\u6548\u5386\u53F2";
      reason = states.map((s) => s.message).join("\uFF1B");
    } else if ((data?.series?.length || 0) > 0 && !stale) {
      label = "\u5386\u53F2\u5468\u671F\u4E0D\u8DB3";
      reason = "\u5DF2\u6709\u5386\u53F2\uFF0C\u4F46\u7F3A\u5C11\u540C\u5546\u54C1\u3001\u540C\u5E02\u573A\u3001\u540C\u6307\u6807\u7684\u76F8\u90BB\u5B8C\u6574\u5468\u671F\uFF1B\u53EF\u5728\u8BE6\u60C5\u67E5\u770B\u5B9E\u9645\u8FD4\u56DE\u503C\u3002";
    }
    result.push({
      key: stale ? "stale" : "insufficient",
      label,
      color: "default",
      reason,
      source: "\u7CFB\u7EDF\u89C4\u5219",
      date: new Date(now).toISOString()
    });
  }
  return result;
}

// apps/web-antd/src/views/intelligence/advertisers.ts
function groupAdvertisers(ads, sites) {
  const groups = /* @__PURE__ */ new Map();
  const knownSites = new Map(sites.map((s) => [s.id, s]));
  const sorted = [...ads].toSorted(
    (a, b) => (b.lastCollectedAt || "").localeCompare(a.lastCollectedAt || "")
  );
  for (const ad of sorted) {
    if (!/^\d{1,40}$/.test(String(ad.pageId || ""))) continue;
    const id = `${ad.market}:${ad.pageId}`;
    const row = groups.get(id) || {
      id,
      pageId: String(ad.pageId),
      market: ad.market,
      name: ad.brand || `\u5E7F\u544A\u4E3B ${ad.pageId}`,
      adId: ad.id,
      adIds: [],
      active: 0,
      stopped: 0,
      siteIds: [],
      domains: [],
      collectedAt: void 0,
      dataNature: ad.dataNature
    };
    if (row.adIds.includes(ad.id)) continue;
    if (row.dataNature === "demo" && ad.dataNature !== "demo") {
      row.adId = ad.id;
      row.dataNature = ad.dataNature;
      row.name = ad.brand || row.name;
    }
    row.adIds.push(ad.id);
    if (ad.status === "\u6295\u653E\u4E2D") row.active++;
    if (ad.status === "\u5DF2\u505C\u6B62") row.stopped++;
    for (const siteId of ad.siteIds || []) {
      const site = knownSites.get(siteId);
      if (site?.market === ad.market && !row.siteIds.includes(siteId)) {
        row.siteIds.push(siteId);
        row.domains.push(site.domain);
      }
    }
    if (ad.lastCollectedAt && Number.isFinite(Date.parse(ad.lastCollectedAt)) && (!row.collectedAt || Date.parse(ad.lastCollectedAt) > Date.parse(row.collectedAt)))
      row.collectedAt = ad.lastCollectedAt;
    groups.set(id, row);
  }
  return [...groups.values()];
}

// apps/web-antd/src/views/intelligence/site-discovery.ts
function trendRecordFields(trend) {
  return {
    growth: trend.growth,
    series: trend.series,
    trendPoints: trend.points,
    trendDailyPoints: trend.dailyPoints || [],
    trendDailyCollectedAt: trend.dailyCollectedAt,
    trendHistoryPoints: trend.historyPoints || [],
    trendHistoryResolution: trend.resolution,
    trendHistoryCollectedAt: trend.historyPoints?.length ? trend.collectedAt : void 0,
    trendHistorySourceUrl: trend.historyPoints?.length ? trend.sourceUrl : void 0,
    trendResolution: trend.resolution || "unknown",
    trendPeriod: trend.period,
    trendSourceUrl: trend.sourceUrl,
    trendCollectedAt: trend.collectedAt,
    trendDailyMessage: trend.dailyMessage,
    trendStatus: trend.series.length > 0 ? "collected" : "failed",
    trendMessage: trend.message || trend.dailyMessage || "\u5DF2\u91C7\u96C6\u4E00\u5E74\u8D8B\u52BF",
    trendRegions: trend.regions || [],
    trendRelatedTop: trend.relatedTop || [],
    trendRelatedRising: trend.relatedRising || [],
    trendInsightsStatus: trend.insightsStatus,
    trendInsightsMessage: trend.insightsMessage,
    trendInsightsPeriod: trend.insightsPeriod
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
  groupAdvertisers,
  productDataSource,
  productDecisions,
  trendComparisons,
  trendRecordFields
};

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
function rollingTrendComparison(record, days) {
  const daily = intervals(record.trendDailyPoints, "day", record.trendDailyCollectedAt);
  const history = intervals(record.trendHistoryPoints, record.trendHistoryResolution, record.trendHistoryCollectedAt);
  const annual = intervals(record.trendPoints, record.trendResolution, record.trendCollectedAt);
  const series = days === 30 && daily.length ? daily : history.length ? history : annual;
  const captured = days === 30 && daily.length ? record.trendDailyCollectedAt : history.length ? record.trendHistoryCollectedAt : record.trendCollectedAt;
  const end = day(Date.parse(captured || ""));
  if (!Number.isFinite(end)) return compare("month", `\u8FD1${days}\u5929`, []);
  return { ...compare("month", `\u8FD1${days}\u5929`, series, 0, { start: end - days * DAY, end, previousStart: end - 2 * days * DAY, previousEnd: end - days * DAY }), collectedAt: captured };
}

// apps/web-antd/src/views/intelligence/core-list-metrics.ts
var DAY2 = 864e5;
var validNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
var zones = {
  VN: "Asia/Ho_Chi_Minh",
  US: "America/New_York",
  MX: "America/Mexico_City"
};
var meaningful = (v) => !!v && !/^(平台未返回|未识别|待识别|待补充|未知|暂无|未采集|待核验)/.test(v);
var isoDay = (v) => new Date(v).toISOString().slice(0, 10);
function marketDay(at, market) {
  if (!Number.isFinite(Date.parse(at))) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zones[market] || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(at));
}
function rollingWindow(at, market, days) {
  const end = marketDay(at, market);
  const n = Date.parse(`${end}T00:00:00Z`);
  return {
    start: Number.isFinite(n) ? isoDay(n - days * DAY2) : "",
    end,
    timezone: zones[market] || "UTC"
  };
}
function missingStatus(status, message = "") {
  const s = `${status || ""} ${message}`;
  if (/budget|limit|截断|预算|上限/i.test(s)) return "budget_limited";
  if (/unsupported|不支持|未开放/i.test(s)) return "unsupported";
  if (/failed|error|失败|错误/i.test(s)) return "failed";
  if (/empty|not.indexed|未收录|无数据/i.test(s)) return "not_indexed";
  if (/pending|queued|running|积累|等待/i.test(s)) return "accumulating";
  return "unverified";
}
function metric(record, key, label, value, unit, meta = {}) {
  const available = value !== null && value !== void 0 && value !== "";
  return {
    key,
    label,
    value: available ? value : null,
    unit,
    market: record.market,
    source: "\u6765\u6E90\u672A\u8BB0\u5F55",
    platform: "",
    period: "\u6765\u6E90\u672A\u63D0\u4F9B\u7EDF\u8BA1\u5468\u671F",
    timezone: zones[record.market] || "UTC",
    collectedAt: "",
    evidenceUrl: "",
    nature: "unknown",
    status: available ? "available" : "unverified",
    reason: available ? "" : "\u6765\u6E90\u672A\u63D0\u4F9B\u8BE5\u5B57\u6BB5",
    ...meta
  };
}
function productMeta(p) {
  return {
    source: p.sourceProvider || (p.siteId ? "\u5B98\u7F51\u516C\u5F00\u8BE6\u60C5" : "\u6765\u6E90\u672A\u8BB0\u5F55"),
    platform: p.sourcePlatform || "",
    collectedAt: p.sourceMetrics?.collectedAt || p.sourceContent?.collectedAt || p.lastCollectedAt || "",
    evidenceUrl: p.evidenceUrl || p.sourceUrl || "",
    nature: p.sourceProvider === "Sorftime" ? "third_party_estimate" : "platform_display"
  };
}
function productSales(p, days) {
  const meta = productMeta(p);
  const anchor = meta.collectedAt || "";
  const bounds = rollingWindow(anchor, p.market, days);
  let sales = metric(p, "sales", `\u8FD1${days}\u5929\u552E\u51FA\u4EF6\u6570`, null, "\u4EF6", {
    ...meta,
    ...bounds,
    period: `${days}\u4E2A\u5B8C\u6574\u5E02\u573A\u65E5 [\u8D77,\u6B62)`,
    status: "accumulating",
    reason: "\u6CA1\u6709\u8986\u76D6\u5B8C\u6574\u7A97\u53E3\u7684\u540C\u53E3\u5F84\u9500\u91CF\uFF1B\u5386\u53F2\u9700\u79EF\u7D2F\u6216\u6765\u6E90\u63D0\u4F9B"
  });
  for (const s of p.decisionData?.series || []) {
    if (s.metric !== "sales_volume" || s.market !== p.market || s.productId !== p.sourceProductId || s.platform !== p.sourcePlatform)
      continue;
    const points = s.points.filter(
      (v) => !v.partial && validNumber(v.value) && Number.isFinite(Date.parse(v.start)) && Number.isFinite(Date.parse(v.end)) && v.end >= v.start
    ).toSorted((a, b) => a.start.localeCompare(b.start));
    let cursor = bounds.start, total = 0;
    for (const point of points) {
      const next = isoDay(Date.parse(`${point.end}T00:00:00Z`) + DAY2);
      if (point.start !== cursor || next > bounds.end) continue;
      total += point.value;
      cursor = next;
    }
    if (cursor === bounds.end && bounds.start) {
      sales = {
        ...sales,
        value: total,
        status: "available",
        reason: s.basis || "\u5B8C\u6574\u6765\u6E90\u533A\u95F4\u76F8\u52A0\uFF1B\u4E0D\u662F\u8BA2\u5355\u6570",
        source: s.provider,
        platform: s.platform,
        nature: "third_party_estimate",
        collectedAt: s.collectedAt,
        evidenceUrl: s.evidenceUrl || ""
      };
      break;
    }
  }
  if (sales.value === null) {
    const history = p.coreEvidence?.history || [];
    const sameScope = history.filter(
      (s) => s.market === p.market && s.scope === p.sourceProductId && s.source === meta.source && s.platform === meta.platform && validNumber(s.sold) && s.soldPrecision === "exact"
    );
    const midnight = (at) => new Intl.DateTimeFormat("en-GB", {
      timeZone: zones[p.market] || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).format(new Date(at)) === "00:00:00";
    const first = sameScope.find(
      (s) => marketDay(s.at, p.market) === bounds.start && midnight(s.at)
    );
    const last = sameScope.findLast(
      (s) => marketDay(s.at, p.market) === bounds.end && midnight(s.at)
    );
    if (first && last) {
      const between = sameScope.filter(
        (s) => s.at >= first.at && s.at <= last.at
      );
      const reset = between.some(
        (s, i) => s.sold < (between[i - 1]?.sold ?? s.sold)
      );
      const dates = { start: first.at, end: last.at, collectedAt: last.at };
      sales = reset ? { ...sales, reason: "\u7D2F\u8BA1\u8BA1\u6570\u53D1\u751F\u56DE\u9000\u6216\u91CD\u7F6E\uFF0C\u4E0D\u80FD\u8BA1\u7B97\u9500\u91CF" } : {
        ...sales,
        ...dates,
        label: `\u8FD1${days}\u5929\u5C55\u793A\u5DF2\u552E\u589E\u91CF`,
        value: last.sold - first.sold,
        status: "available",
        nature: "snapshot_delta",
        period: `${days}\u4E2A\u5B8C\u6574\u5E02\u573A\u65E5\u7684\u5348\u591C\u8FB9\u754C\u5FEB\u7167`,
        reason: "\u540C\u5546\u54C1\u540C\u6765\u6E90\u7D2F\u8BA1\u5C55\u793A\u5DEE\u503C\uFF1B\u672A\u89C2\u5BDF\u5230\u56DE\u9000\uFF0C\u975E\u51C0\u6210\u4EA4\uFF0C\u65E0\u8BA2\u5355\u6570\u636E"
      };
    }
  }
  const completion = p.dataCompletion?.trend_AsinSalesVolume;
  if (sales.value === null && completion)
    sales = {
      ...sales,
      status: ["done", "completed", "collected"].includes(completion.status) ? "accumulating" : missingStatus(completion.status, completion.message),
      reason: `${completion.message}\uFF1B${sales.reason}`
    };
  const daily = metric(
    p,
    "dailySales",
    `\u65E5\u5747\u4EF6\u6570\uFF08${days}\u5929\uFF09`,
    typeof sales.value === "number" ? Math.round(sales.value / days * 100) / 100 : null,
    "\u4EF6/\u5929",
    {
      ...sales,
      key: "dailySales",
      label: `\u65E5\u5747\u4EF6\u6570\uFF08${days}\u5929\uFF09`,
      unit: "\u4EF6/\u5929",
      value: typeof sales.value === "number" ? Math.round(sales.value / days * 100) / 100 : null
    }
  );
  return [sales, daily];
}
function productMetrics(p, days, context = {}) {
  const meta = productMeta(p), sm = p.sourceMetrics;
  const fieldTime = (key) => p.coreEvidence?.fieldUpdatedAt?.[key] || meta.collectedAt;
  const fx = context.fx || p.coreEvidence?.fx;
  const price = p.price > 0 || p.collectionFields?.includes("price") ? p.price : null;
  const rate = p.currency === "USD" ? 1 : fx?.rates[p.currency];
  const usd = price !== null && rate && rate > 0 ? Math.round(price / rate * 100) / 100 : null;
  let usdReason = `\u539F\u5E01\u4FDD\u7559\uFF1B\u6C47\u7387\u65E5 ${fx?.date || "USD\u540C\u5E01\u79CD"}\uFF0C\u975E\u5386\u53F2\u4EF7\u683C\u6362\u7B97`;
  if (usd === null)
    usdReason = price === null ? "\u672A\u83B7\u53D6\u539F\u5E01\u4EF7\u683C" : "\u672A\u83B7\u53D6\u6709\u6765\u6E90\u4E0E\u65E5\u671F\u7684\u6C47\u7387";
  let sellingNature = p.benefitEvidence ? "ai_summary" : "unknown";
  if (p.sourceContent?.sellingPoints?.length) sellingNature = "brand_claim";
  const sold = sm?.soldCount;
  const raw = sm?.soldRaw;
  const result = [
    ...productSales(p, days),
    metric(
      p,
      "cumulativeSold",
      "\u5E73\u53F0\u7D2F\u8BA1\u5C55\u793A\u5DF2\u552E",
      raw || (validNumber(sold) ? sold : null),
      "\u4EF6",
      {
        ...meta,
        collectedAt: sm?.soldCollectedAt || meta.collectedAt,
        period: "\u7D2F\u8BA1\u8D77\u7B97\u65E5\u672A\u77E5\uFF1B\u5F53\u524D\u5FEB\u7167",
        precision: sm?.soldPrecision || "\u672A\u77E5",
        reason: raw || validNumber(sold) ? "\u7D2F\u8BA1\u5C55\u793A\u4E0D\u7B49\u4E8E\u5468\u671F\u9500\u91CF\u6216\u51C0\u6210\u4EA4" : "\u6765\u6E90\u672A\u8FD4\u56DE\u660E\u786E\u7684\u7D2F\u8BA1\u552E\u51FA\u4EF6\u6570"
      }
    ),
    metric(
      p,
      "reportedOrders",
      "\u6765\u6E90\u62A5\u544A\u8BA2\u5355\u6570",
      validNumber(sm?.orderCount) ? sm.orderCount : null,
      "\u8BA2\u5355",
      {
        ...meta,
        collectedAt: fieldTime("orderCount"),
        period: "\u6765\u6E90\u672A\u63D0\u4F9B\u7EDF\u8BA1\u5468\u671F\uFF1B\u4E0D\u8BA1\u7B97\u65E5\u5747",
        reason: "\u4EC5\u660E\u786E\u7684\u8BA2\u5355\u5B57\u6BB5\uFF0C\u4E0D\u7528\u552E\u51FA\u4EF6\u6570\u66FF\u4EE3"
      }
    ),
    metric(p, "priceUsd", "\u7F8E\u5143\u5BF9\u6BD4\u4EF7", usd, "USD", {
      ...meta,
      collectedAt: fieldTime("price"),
      nature: p.currency === "USD" ? meta.nature : "third_party_estimate",
      period: "\u5F53\u524D\u62A5\u4EF7\uFF1B\u672A\u7EDF\u4E00\u7A0E\u8D39/\u8FD0\u8D39\u53CA\u53D8\u4F53",
      source: p.currency === "USD" ? meta.source : `${meta.source}\uFF1B\u6C47\u7387 ${fx?.source || "\u672A\u83B7\u53D6"}`,
      reason: usdReason,
      precision: fx ? `1 USD = ${rate} ${p.currency}` : void 0
    }),
    metric(p, "priceOriginal", "\u539F\u5E01\u4EF7\u683C", price, p.currency, {
      ...meta,
      collectedAt: fieldTime("price"),
      period: "\u5F53\u524D\u62A5\u4EF7\uFF1B\u7A0E\u8D39/\u8FD0\u8D39\u662F\u5426\u5305\u542B\u672A\u77E5"
    }),
    metric(
      p,
      "spec",
      "\u89C4\u683C / \u5242\u578B",
      meaningful(p.size) ? `${p.size} / ${p.form}` : null,
      "\u539F\u6587",
      {
        ...meta,
        collectedAt: fieldTime("size"),
        nature: "platform_display",
        period: "\u5F53\u524D\u5546\u54C1\u6807\u7B7E"
      }
    ),
    metric(
      p,
      "ingredients",
      "\u6210\u5206\u4E0E\u6BCF\u4EFD\u5242\u91CF",
      meaningful(p.ingredient) ? `${p.ingredient}\uFF1B${p.dose || "\u5242\u91CF\u672A\u77E5"}` : null,
      "\u539F\u6587",
      {
        ...meta,
        collectedAt: fieldTime("ingredient"),
        reason: p.coreEvidence?.fieldUpdatedAt?.dose ? `\u5242\u91CF\u5B57\u6BB5\u91C7\u96C6\u65F6\u95F4 ${p.coreEvidence.fieldUpdatedAt.dose}` : "\u5242\u91CF\u5B57\u6BB5\u91C7\u96C6\u65F6\u95F4\u672A\u5355\u72EC\u8BB0\u5F55",
        nature: p.collectionFields?.includes("ingredients") || p.formula?.status === "verified" ? "platform_display" : "unknown",
        period: "\u5F53\u524D\u5546\u54C1\u6807\u7B7E"
      }
    ),
    metric(p, "claim", "\u54C1\u724C\u529F\u6548\u5BA3\u79F0", p.claim || null, "\u539F\u6587", {
      ...meta,
      collectedAt: fieldTime("claim"),
      nature: "brand_claim",
      period: "\u5F53\u524D\u54C1\u724C\u63CF\u8FF0",
      reason: p.claim ? "\u54C1\u724C\u8868\u8FF0\uFF0C\u4E0D\u4EE3\u8868\u5DF2\u9A8C\u8BC1\u7597\u6548" : "\u672A\u83B7\u53D6\u54C1\u724C\u5BA3\u79F0"
    }),
    metric(
      p,
      "sellingPoints",
      "\u5356\u70B9",
      p.sourceContent?.sellingPoints?.join("\uFF1B") || p.benefits?.join("\uFF1B") || null,
      "\u6587\u672C",
      {
        ...meta,
        collectedAt: fieldTime("benefits"),
        nature: sellingNature,
        period: "\u5F53\u524D\u5546\u54C1\u63CF\u8FF0",
        reason: p.sourceContent?.sellingPoints?.length ? "\u6765\u6E90\u660E\u786E\u8FD4\u56DE\u7684\u5356\u70B9\u539F\u6587\uFF0C\u4E0D\u4EE3\u8868\u7597\u6548\u9A8C\u8BC1" : p.benefitEvidence || "\u672A\u8BB0\u5F55\u5F52\u7EB3\u4F9D\u636E"
      }
    )
  ];
  for (const s of p.decisionData?.series || []) {
    if (s.metric !== "sales_volume" || s.market !== p.market) continue;
    const v = s.points.findLast((v2) => !v2.partial);
    if (v)
      result.push(
        metric(p, "sourceSales", "\u6765\u6E90\u539F\u59CB\u5468\u671F\u9500\u91CF", v.value, "\u4EF6", {
          ...meta,
          source: s.provider,
          nature: "third_party_estimate",
          start: v.start,
          end: v.end,
          period: s.period,
          collectedAt: s.collectedAt,
          reason: s.basis || "\u4FDD\u7559\u539F\u59CB\u7A97\u53E3\uFF0C\u4E0D\u7B49\u540C\u8FD130\u5929"
        })
      );
  }
  const snapshots = (p.coreEvidence?.history || []).filter(
    (s) => s.market === p.market && s.scope === p.sourceProductId && s.source === meta.source && s.soldPrecision === "exact" && validNumber(s.sold)
  );
  const a = snapshots[0], b = snapshots.at(-1);
  if (a && b && a.at !== b.at) {
    const reset = snapshots.some(
      (s, i) => s.sold < (snapshots[i - 1]?.sold ?? s.sold)
    );
    const elapsed = (Date.parse(b.at) - Date.parse(a.at)) / DAY2;
    result.push(
      metric(
        p,
        "observedDelta",
        "\u5B9E\u9645\u89C2\u5BDF\u533A\u95F4\u5C55\u793A\u5DF2\u552E\u589E\u91CF",
        reset ? null : b.sold - a.sold,
        "\u4EF6",
        {
          ...meta,
          nature: "snapshot_delta",
          start: a.at,
          end: b.at,
          period: `\u5B9E\u9645\u89C2\u5BDF${Math.round(elapsed * 100) / 100}\u5929`,
          status: reset ? "unverified" : "available",
          reason: reset ? "\u8BA1\u6570\u56DE\u9000/\u91CD\u7F6E\uFF0C\u589E\u91CF\u65E0\u6548" : "\u9996\u5C3E\u5C55\u793A\u5DEE\u503C\uFF0C\u975E\u51C0\u6210\u4EA4\uFF0C\u4E0D\u5916\u63A8\u4E3A30/90/365\u5929\u9500\u91CF"
        }
      )
    );
  }
  if (validNumber(sm?.monthlySales))
    result.push(
      metric(
        p,
        "reportedMonthlySales",
        "\u6765\u6E90\u62A5\u544A\u6708\u9500\u91CF",
        sm.monthlySales,
        "\u4EF6",
        {
          ...meta,
          nature: "third_party_estimate",
          period: "\u6765\u6E90\u6708\u5EA6\u53E3\u5F84\uFF1B\u8D77\u6B62\u65E5\u672A\u63D0\u4F9B",
          reason: "\u4E0D\u80FD\u76F4\u63A5\u5F53\u4F5C\u8FD130\u5929\u9500\u91CF"
        }
      )
    );
  const unclassifiedSales = sm?.unclassifiedSales || (p.sourcePlatform === "TikTok Shop" && validNumber(sm?.reportedSales) && !validNumber(sm?.soldCount) ? String(sm.reportedSales) : "");
  if (unclassifiedSales)
    result.push(
      metric(
        p,
        "unclassifiedSales",
        "\u6765\u6E90\u9500\u552E\u5B57\u6BB5\uFF08\u53E3\u5F84\u672A\u77E5\uFF09",
        unclassifiedSales,
        "\u672A\u786E\u8BA4",
        {
          ...meta,
          nature: "unknown",
          period: "\u7EDF\u8BA1\u7A97\u53E3\u672A\u77E5",
          reason: "\u4E0A\u6E38sales\u6216\u65E7reportedSales\u672A\u4FDD\u7559\u53EF\u6838\u9A8C\u7684\u7D2F\u8BA1/\u5468\u671F/\u4EF6\u6570/\u8BA2\u5355\u53E3\u5F84\uFF0C\u672A\u53C2\u4E0E\u8BA1\u7B97"
        }
      )
    );
  return result;
}
function siteMetrics(s, context = {}) {
  const m = s.metrics?.market === s.market ? s.metrics : void 0;
  const meta = {
    source: m?.source || "Semrush MCP",
    collectedAt: m?.collectedAt || "",
    evidenceUrl: s.evidenceUrl || `https://${s.domain}`,
    nature: "third_party_estimate",
    platform: "Google\u641C\u7D22",
    period: m?.period || "\u6765\u6E90\u6708\u5EA6\u641C\u7D22\u4F30\u7B97\uFF1B\u8D77\u6B62\u65E5\u672A\u63D0\u4F9B",
    status: missingStatus(s.metricsStatus, s.metricsMessage),
    reason: s.metricsMessage || "\u5C1A\u672A\u83B7\u53D6\u8BE5\u5E02\u573A\u7684\u6765\u6E90\u6307\u6807"
  };
  const entries = [
    ["organicTraffic", "\u81EA\u7136\u641C\u7D22\u6D41\u91CF\u4F30\u7B97", m?.organicTraffic, "\u6B21/\u6708\uFF08\u4F30\u7B97\uFF09"],
    ["paidTraffic", "\u4ED8\u8D39\u641C\u7D22\u6D41\u91CF\u4F30\u7B97", m?.paidTraffic, "\u6B21/\u6708\uFF08\u4F30\u7B97\uFF09"],
    ["organicKeywords", "\u81EA\u7136\u641C\u7D22\u5173\u952E\u8BCD\u8986\u76D6", m?.organicKeywords, "\u8BCD"],
    ["paidKeywords", "\u4ED8\u8D39\u641C\u7D22\u5173\u952E\u8BCD\u8986\u76D6", m?.paidKeywords, "\u8BCD"]
  ];
  const result = entries.map(
    ([key, label, v, unit]) => metric(s, key, label, validNumber(v) ? v : null, unit, {
      ...meta,
      ...validNumber(v) ? {
        status: "available",
        reason: key === "paidTraffic" ? "\u4ED8\u8D39\u641C\u7D22\uFF0C\u4E0D\u662FFB/TK\u5E7F\u544A\u6D41\u91CF" : "\u76EE\u6807\u5E02\u573A\u641C\u7D22\u4F30\u7B97\uFF0C\u4E0D\u662F\u5168\u7AD9\u8BBF\u95EE\u91CF"
      } : {}
    })
  );
  const history = s.coreEvidence?.history || [];
  const comparable = history.filter(
    (h) => h.market === s.market && h.source === m?.source && validNumber(h.organicTraffic)
  );
  const a = comparable.at(-2), b = comparable.at(-1);
  result.push(
    metric(
      s,
      "trafficChange",
      "\u81EA\u7136\u641C\u7D22\u6D41\u91CF\u5FEB\u7167\u53D8\u5316",
      a && b ? b.organicTraffic - a.organicTraffic : null,
      "\u4F30\u7B97\u6B21\u6570\u5DEE",
      {
        ...meta,
        status: a && b ? "available" : "accumulating",
        nature: "snapshot_delta",
        start: a?.at,
        end: b?.at,
        period: a && b ? "\u76F8\u90BB\u6765\u6E90\u5FEB\u7167\uFF0C\u975E\u56FA\u5B9A\u5468\u671F\u589E\u957F\u7387" : "\u5F85\u79EF\u7D2F\u53EF\u6BD4\u5FEB\u7167",
        reason: a && b ? "\u540C\u6765\u6E90\u540C\u5E02\u573A\u641C\u7D22\u4F30\u7B97\u53D8\u5316\uFF0C\u975E\u5B9E\u9645\u8BBF\u95EE\u91CF\u589E\u957F" : "\u7F3A\u5C11\u4E24\u4E2A\u540C\u5E02\u573A\u540C\u6765\u6E90\u5FEB\u7167"
      }
    )
  );
  const ads = (context.complete === false ? void 0 : context.ads)?.filter(
    (a2) => a2.market === s.market && a2.siteIds?.includes(s.id)
  );
  const products = (context.complete === false ? void 0 : context.products)?.filter(
    (p) => p.market === s.market && p.siteId === s.id
  );
  const observed = {
    ...meta,
    source: "\u7CFB\u7EDF\u5173\u8054\u8BB0\u5F55",
    nature: "system_observation",
    period: "\u5F53\u524D\u5DF2\u4FDD\u5B58\u8BB0\u5F55",
    collectedAt: s.lastCollectedAt || m?.collectedAt || ""
  };
  const related = s.coreSummary?.related;
  const adCount = related?.ads ?? ads?.length;
  const productCount = related?.products ?? products?.length;
  result.push(
    metric(s, "linkedAds", "\u5173\u8054\u5E7F\u544A", adCount ?? null, "\u6761\u5DF2\u4FDD\u5B58", {
      ...observed,
      status: adCount !== void 0 ? "available" : "unverified",
      reason: "\u89C2\u5BDF\u6570\u91CF\u4E0D\u4EE3\u8868\u76C8\u5229\u6216\u5168\u91CF\u6295\u653E"
    }),
    metric(
      s,
      "linkedProducts",
      "\u5546\u54C1\u8986\u76D6",
      productCount ?? null,
      "\u4EF6\u5DF2\u4FDD\u5B58",
      {
        ...observed,
        status: productCount !== void 0 ? "available" : "unverified",
        reason: "\u5DF2\u4FDD\u5B58\u5546\u54C1\u8986\u76D6\uFF0C\u4E0D\u662F\u5168\u7AD9\u5546\u54C1\u603B\u6570"
      }
    )
  );
  const uses = [];
  if (related?.hasIngredients ?? products?.some((p) => meaningful(p.ingredient)))
    uses.push("\u914D\u65B9\u53C2\u8003\uFF1A\u6709\u5173\u8054\u5546\u54C1\u6210\u5206\u539F\u6587");
  if (related?.hasPrices ?? products?.some((p) => p.price > 0)) uses.push("\u4EF7\u683C\u53C2\u8003\uFF1A\u6709\u516C\u5F00\u5546\u54C1\u62A5\u4EF7");
  if (related?.hasCreatives ?? ads?.some((a2) => a2.imageUrls?.length || a2.videoUrls?.length))
    uses.push("\u7D20\u6750\u53C2\u8003\uFF1A\u6709\u53EF\u56DE\u67E5\u5173\u8054\u5E7F\u544A");
  if (s.evidenceUrl || s.domain) uses.push("\u843D\u5730\u9875\u53C2\u8003\uFF1A\u6709\u516C\u5F00\u7AD9\u70B9\u94FE\u63A5");
  uses.push("\u9500\u552E\u53C2\u8003\u5F85\u8BC1\u5B9E\uFF1A\u65E0\u6388\u6743\u7ECF\u8425\u6570\u636E");
  result.push(
    metric(s, "referenceUse", "\u53C2\u8003\u7528\u9014\u53CA\u4F9D\u636E", uses.join("\uFF1B"), "\u7528\u9014", {
      ...observed,
      status: "available",
      reason: "\u7528\u9014\u4E0D\u4EE3\u8868\u7ECF\u8425\u7EE9\u6548\u6216\u5229\u6DA6"
    })
  );
  for (const [key, label, unit] of [
    ["visits", "\u5168\u7AD9\u8BBF\u95EE\u91CF", "\u6B21"],
    ["revenue", "\u5B9E\u9645\u8425\u6536", "\u91D1\u989D"],
    ["conversion", "\u5B9E\u9645\u8F6C\u5316\u7387", "%"],
    ["roas", "\u5B9E\u9645ROAS", "\u500D"]
  ])
    result.push(
      metric(s, key, label, null, unit, {
        ...meta,
        status: "unsupported",
        reason: "\u5F53\u524D\u6765\u6E90\u672A\u63D0\u4F9B\u6388\u6743\u7684\u5168\u7AD9\u5206\u6790\u6216\u7ECF\u8425\u6570\u636E"
      })
    );
  return result;
}
function adMetrics(a, context = {}) {
  const meta = {
    source: a.source || "\u6765\u6E90\u672A\u8BB0\u5F55",
    platform: a.platform,
    collectedAt: a.lastCollectedAt || "",
    evidenceUrl: a.evidenceUrl || "",
    nature: "platform_display",
    period: "\u5F53\u524D\u6765\u6E90\u8BB0\u5F55"
  };
  const result = [
    metric(
      a,
      "status",
      "\u5E7F\u544A\u72B6\u6001",
      a.status === "\u672A\u77E5" ? null : a.status,
      "\u72B6\u6001",
      meta
    ),
    metric(a, "startDate", "\u5E73\u53F0\u5F00\u59CB\u65E5\u671F", a.startDate || null, "\u65E5\u671F", meta),
    metric(a, "firstObserved", "\u7CFB\u7EDF\u9996\u6B21\u89C2\u5BDF", a.firstSeenAt || null, "\u65F6\u95F4", {
      ...meta,
      source: "\u7CFB\u7EDF\u91C7\u96C6\u65E5\u5FD7",
      nature: "system_observation"
    }),
    metric(
      a,
      "lastObserved",
      "\u7CFB\u7EDF\u6700\u8FD1\u89C2\u5BDF",
      a.lastCollectedAt || null,
      "\u65F6\u95F4",
      {
        ...meta,
        source: "\u7CFB\u7EDF\u91C7\u96C6\u65E5\u5FD7",
        nature: "system_observation",
        reason: "\u9996\u5C3E\u8DE8\u5EA6\u4E0D\u4EE3\u8868\u8FDE\u7EED\u5728\u6295"
      }
    ),
    metric(
      a,
      "creative",
      "\u7D20\u6750\u4E0E\u5F62\u5F0F",
      [a.format, ...a.imageUrls || [], ...a.videoUrls || []].filter(Boolean).join("\uFF1B") || null,
      "\u7D20\u6750\u94FE\u63A5",
      meta
    ),
    metric(
      a,
      "sellingPoints",
      "\u7D20\u6750\u5356\u70B9\u539F\u6587",
      a.headline || a.copy || null,
      "\u539F\u6587",
      { ...meta, nature: "brand_claim" }
    ),
    metric(
      a,
      "advertiser",
      "\u5E7F\u544A\u4E3B",
      [a.brand, a.pageId].filter(Boolean).join(" / ") || null,
      "\u540D\u79F0 / ID",
      meta
    ),
    metric(
      a,
      "linkedProducts",
      "\u5173\u8054\u5546\u54C1",
      a.productId ? context.products?.find((p) => p.id === a.productId)?.title || a.productId : null,
      "\u5546\u54C1",
      {
        ...meta,
        nature: "system_observation",
        reason: a.productId ? "\u4FDD\u5B58\u7684\u5546\u54C1\u5173\u8054\uFF1B\u9700\u56DE\u67E5\u843D\u5730\u8BC1\u636E" : "\u6CA1\u6709\u7CBE\u786E\u5546\u54C1\u843D\u5730\u94FE\u63A5\uFF0C\u4E0D\u6309\u540C\u6807\u9898\u81EA\u52A8\u5173\u8054"
      }
    ),
    metric(
      a,
      "landingPages",
      "\u843D\u5730\u9875",
      a.landingUrls?.join("\uFF1B") || null,
      "URL",
      meta
    ),
    metric(
      a,
      "linkedSites",
      "\u5173\u8054\u7AD9\u70B9",
      a.siteIds?.map((id) => context.sites?.find((s) => s.id === id)?.domain || id).join("\uFF1B") || null,
      "\u7AD9\u70B9",
      { ...meta, nature: "system_observation" }
    )
  ];
  for (const [key, label, unit] of [
    ["spend", "\u5E7F\u544A\u82B1\u8D39", "\u539F\u5E01"],
    ["impressions", "\u66DD\u5149", "\u6B21"],
    ["clicks", "\u70B9\u51FB", "\u6B21"],
    ["purchases", "\u8D2D\u4E70", "\u8BA2\u5355"],
    ["roas", "ROAS", "\u500D"]
  ]) {
    const supported = a.coreEvidence?.metrics?.find(
      (v) => v.key === key && v.market === a.market && v.source && v.nature !== "unknown"
    );
    result.push(
      supported || metric(a, key, label, null, unit, {
        ...meta,
        status: "unsupported",
        reason: "\u5F53\u524D\u516C\u5F00\u6765\u6E90\u672A\u63D0\u4F9B\u53EF\u6838\u9A8C\u7ECF\u8425\u6307\u6807"
      })
    );
  }
  const history = a.coreEvidence?.history || [];
  result.push(
    metric(
      a,
      "observations",
      "\u6709\u6548\u89C2\u5BDF\u6B21\u6570",
      a.coreEvidence?.historyCount ?? (history.length > 0 ? history.length : null),
      "\u6B21",
      {
        ...meta,
        source: "\u7CFB\u7EDF\u4FDD\u5B58\u5FEB\u7167",
        nature: "system_observation",
        period: "\u5DF2\u91C7\u96C6\u65F6\u70B9\uFF1B\u95F4\u9694\u5185\u72B6\u6001\u672A\u77E5",
        reason: "\u591A\u6B21\u89C2\u5BDF\u4E0D\u8BC1\u660E\u8FDE\u7EED\u6295\u653E\u6216\u76C8\u5229"
      }
    )
  );
  return result;
}
function normalizedTerm(v) {
  return v.normalize("NFKC").trim().toLowerCase().replaceAll(/\s+/g, " ");
}
var aiSource = /\bAI\b|OpenAI|模型|人工智能/i;
function keywordMetrics(k, days, context = {}) {
  const m = k.metrics?.market === k.market ? k.metrics : void 0;
  const trend = rollingTrendComparison(k, days);
  const meta = {
    source: "Google Trends",
    platform: "Google",
    collectedAt: trend.collectedAt || "",
    evidenceUrl: k.trendSourceUrl || "",
    period: `\u8FD1${days}\u5929\uFF1BGoogle\u76F8\u5BF9\u5C3A\u5EA6`,
    nature: "third_party_estimate",
    start: trend.start,
    end: trend.end,
    timezone: "UTC",
    reason: trend.reason
  };
  const result = [
    metric(
      k,
      "searchVolume",
      "\u76EE\u6807\u5E02\u573A\u6708\u641C\u7D22\u91CF\u4F30\u7B97",
      validNumber(m?.monthlySearchVolume) ? m.monthlySearchVolume : null,
      "\u6B21/\u6708\uFF08\u4F30\u7B97\uFF09",
      {
        source: m?.source || "Semrush MCP",
        platform: "Google\u641C\u7D22",
        collectedAt: m?.collectedAt || "",
        period: "\u6765\u6E90\u6708\u5EA6\u4F30\u7B97\uFF1B\u8D77\u6B62\u65E5\u672A\u63D0\u4F9B",
        nature: "third_party_estimate",
        status: validNumber(m?.monthlySearchVolume) ? "available" : missingStatus(
          k.semrushCollection?.status,
          k.semrushCollection?.message
        ),
        reason: m ? "\u76EE\u6807\u5E02\u573A\u6765\u6E90\u4F30\u7B97\uFF0C\u4E0D\u662F\u5B9E\u9645\u641C\u7D22\u65E5\u5FD7" : k.semrushCollection?.message || "\u672A\u83B7\u53D6\u8BE5\u5E02\u573A\u641C\u7D22\u91CF\uFF0C\u4E0D\u4F7F\u7528US\u4EE3\u66FF"
      }
    ),
    metric(k, "relativeHeat", "Google\u76F8\u5BF9\u70ED\u5EA6", trend.heat, "0-100", {
      ...meta,
      status: trend.heat === null ? missingStatus(k.trendStatus, k.trendMessage) : "available"
    }),
    metric(k, "trendChange", `\u8FD1${days}\u5929\u76F8\u5BF9\u70ED\u5EA6\u53D8\u5316`, trend.change, "%", {
      ...meta,
      status: trend.change === null ? "accumulating" : "available"
    })
  ];
  const top = k.trendRelatedTop, rising = k.trendRelatedRising;
  for (const [key, label, list] of [
    ["relatedTop", "\u70ED\u95E8\u76F8\u5173\u67E5\u8BE2", top],
    ["relatedRising", "\u4E0A\u5347\u76F8\u5173\u67E5\u8BE2", rising]
  ])
    result.push(
      metric(
        k,
        key,
        label,
        list?.map((v) => `${v.query} (${v.formattedValue})`).join("\uFF1B") || null,
        "\u67E5\u8BE2\u8BCD",
        {
          ...meta,
          collectedAt: k.trendCollectedAt || "",
          period: k.trendInsightsPeriod || "\u6765\u6E90\u76F8\u5173\u67E5\u8BE2\u7A97\u53E3",
          status: list?.length ? "available" : missingStatus(k.trendInsightsStatus, k.trendInsightsMessage),
          reason: list?.length ? "\u6765\u6E90\u76F8\u5173\u67E5\u8BE2\uFF0C\u4E0D\u662F\u5B9E\u9645\u641C\u7D22\u6B21\u6570" : k.trendInsightsMessage || "\u6765\u6E90\u672A\u63D0\u4F9B\u76F8\u5173\u67E5\u8BE2"
        }
      )
    );
  const expanded = k.coreSummary?.related?.expansions ?? (context.complete === false ? void 0 : context.keywords)?.filter(
    (v) => v.market === k.market && normalizedTerm(v.seedTerm || "") === normalizedTerm(k.term) && normalizedTerm(v.term) !== normalizedTerm(k.term)
  );
  const groups = [
    [
      "autocomplete",
      "\u641C\u7D22\u8054\u60F3",
      expanded?.filter((v) => /联想|autocomplete/i.test(v.source)).map((v) => v.term)
    ],
    [
      "aiSuggestions",
      "AI\u5EFA\u8BAE",
      expanded?.filter((v) => aiSource.test(v.source)).map((v) => v.term)
    ],
    [
      "otherExpansion",
      "\u5176\u4ED6\u6765\u6E90\u6269\u8BCD",
      expanded?.filter(
        (v) => !/联想|autocomplete/i.test(v.source) && !aiSource.test(v.source)
      ).map((v) => v.term)
    ]
  ];
  for (const [key, label, list] of groups)
    result.push(
      metric(
        k,
        key,
        label,
        list ? new Set(list.map((v) => normalizedTerm(v))).size : null,
        "\u4E2A\u53BB\u91CD\u8BCD",
        {
          source: "\u7CFB\u7EDF\u5DF2\u4FDD\u5B58\u6269\u8BCD\u53CA\u6765\u6E90\u6807\u7B7E",
          platform: "\u591A\u6765\u6E90",
          collectedAt: k.updatedAt || k.collectedAt || "",
          nature: key === "aiSuggestions" ? "ai_summary" : "system_observation",
          period: "\u5F53\u524D\u4FDD\u5B58\u7684\u540C\u5E02\u573A\u79CD\u5B50\u5173\u7CFB",
          reason: "\u6269\u8BCD\u6570\u91CF\u4E0D\u662F\u641C\u7D22\u6B21\u6570\uFF1B\u6765\u6E90\u7C7B\u578B\u5206\u522B\u4FDD\u7559"
        }
      )
    );
  const all = [
    ...(top || []).map((v) => v.query),
    ...(rising || []).map((v) => v.query),
    ...(expanded || []).map((v) => v.term)
  ];
  result.push(
    metric(
      k,
      "expansionCount",
      "\u53BB\u91CD\u6269\u8BCD\u6570\u91CF",
      expanded || top || rising ? new Set(
        all.map((v) => normalizedTerm(v)).filter((v) => v !== normalizedTerm(k.term))
      ).size : null,
      "\u4E2A\u53BB\u91CD\u8BCD",
      {
        source: "\u7CFB\u7EDF\u4FDD\u5B58\u7684\u76F8\u5173\u67E5\u8BE2/\u8054\u60F3/\u5EFA\u8BAE",
        collectedAt: k.updatedAt || k.collectedAt || "",
        nature: "system_observation",
        period: "\u5F53\u524D\u4FDD\u5B58\u8BB0\u5F55",
        reason: "\u8DE8\u7C7B\u578B\u53BB\u91CD\u8BA1\u6570\uFF0C\u4E0D\u662F\u641C\u7D22\u6B21\u6570\u6216\u5B8C\u6574\u9700\u6C42\u89C4\u6A21"
      }
    )
  );
  for (const [key, label, ids] of [
    ["linkedProducts", "\u5173\u8054\u5546\u54C1", k.productIds],
    ["linkedSites", "\u5173\u8054\u7AD9\u70B9", k.siteIds]
  ])
    result.push(
      metric(k, key, label, ids?.length ?? null, "\u6761\u5DF2\u4FDD\u5B58", {
        source: "\u7CFB\u7EDF\u4FDD\u5B58\u7684\u5173\u8054",
        collectedAt: k.updatedAt || "",
        nature: "system_observation",
        period: "\u5F53\u524D\u5173\u8054\u8BB0\u5F55"
      })
    );
  return result;
}
function coreMetrics(kind, record, days = 30, context = {}) {
  let metrics;
  switch (kind) {
    case "products": {
      metrics = productMetrics(record, days, context);
      break;
    }
    case "sites": {
      metrics = siteMetrics(record, context);
      break;
    }
    case "ads": {
      metrics = adMetrics(record, context);
      break;
    }
    default: {
      metrics = keywordMetrics(record, days, context);
    }
  }
  for (const summary of record.coreSummary?.periods?.[days] || []) {
    const index = metrics.findIndex((item) => item.key === summary.key);
    if (index < 0) metrics.push(summary);
    else metrics[index] = summary;
  }
  const collectedAt = metrics.map((m) => m.collectedAt).filter((v) => Number.isFinite(Date.parse(v))).toSorted().at(-1) || "";
  const sources = [
    ...new Set(
      metrics.filter((m) => m.value !== null && m.source !== "\u6765\u6E90\u672A\u8BB0\u5F55").map((m) => m.source)
    )
  ].slice(0, 3);
  return [
    ...metrics,
    metric(
      record,
      "sourceContext",
      "\u6765\u6E90 / \u66F4\u65B0\u65F6\u95F4",
      `${sources.join("\uFF1B") || "\u6765\u6E90\u5F85\u6838\u5BF9"} \xB7 ${collectedAt || "\u65F6\u95F4\u672A\u8BB0\u5F55"}`,
      "\u6765\u6E90 / \u65F6\u95F4",
      {
        source: sources.join("\uFF1B") || "\u6765\u6E90\u672A\u8BB0\u5F55",
        collectedAt,
        period: "\u5404\u6307\u6807\u4FDD\u7559\u72EC\u7ACB\u91C7\u96C6\u65F6\u95F4\uFF1B\u6B64\u5904\u5217\u6700\u8FD1\u65F6\u95F4",
        nature: "system_observation",
        reason: "\u9010\u9879\u53E3\u5F84\u53CA\u7F3A\u5931\u539F\u56E0\u89C1\u6307\u6807\u8BC1\u636E"
      }
    )
  ];
}

// server/discovery-newness.mjs
var DAY3 = 864e5;
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
  const recentDiscovery = observed !== void 0 && Date.parse(first) <= now && now - observed < 8 * DAY3;
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
  const isNew = known ? Math.floor((now - time) / DAY3) <= windowDays : null;
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

// apps/web-antd/src/views/intelligence/radar-engine.ts
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
function clamp2(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function daysSince(value) {
  const time = validDiscoveryDate(value);
  return time === void 0 || Date.parse(value || "") > Date.now() ? Infinity : Math.floor((Date.now() - time) / 864e5);
}
function withinWindow(value, windowDays) {
  return daysSince(value) <= windowDays;
}
function keywordGrowth(keywords, category, market) {
  const values = keywords.filter(
    (item) => item.market === market && item.category === category && item.growth !== null
  ).map((item) => item.growth);
  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length * 10
  ) / 10;
}
function productEvidence(product, ads, keywords) {
  const relatedAds = ads.filter((ad) => ad.productId === product.id);
  const relatedKeywords = keywords.filter(
    (keyword) => keyword.productIds.includes(product.id)
  );
  const observedAt = product.firstSeenAt || today();
  const evidence = [
    {
      id: `product-${product.id}`,
      kind: "product",
      source: product.sourceProvider ? `${product.sourceProvider} \xB7 ${product.sourcePlatform || "\u5E73\u53F0\u5546\u54C1"}` : product.dataNature === "imported" ? "\u4EBA\u5DE5\u5BFC\u5165\u5546\u54C1\u8D44\u6599" : "\u5B98\u7F51\u5546\u54C1\u9875",
      detail: `${product.title} \xB7 ${product.ingredient} \xB7 ${product.dose}`,
      observedAt,
      url: product.evidenceUrl
    }
  ];
  for (const ad of relatedAds) {
    evidence.push({
      id: `ad-${ad.id}`,
      kind: "ad",
      source: ad.platform,
      detail: `${ad.headline}\uFF1B${ad.copy}`,
      observedAt: ad.firstSeenAt || observedAt,
      url: ad.evidenceUrl
    });
  }
  for (const keyword of relatedKeywords.slice(0, 2)) {
    evidence.push({
      id: `keyword-${keyword.id}`,
      kind: keyword.series.length > 0 ? "trend" : "keyword",
      source: keyword.source,
      detail: keyword.growth === null ? `${keyword.term}\uFF1A\u7F3A\u5C11\u53EF\u6BD4\u8F83\u8D8B\u52BF` : `${keyword.term}\uFF1A30\u5929\u53D8\u5316 ${keyword.growth > 0 ? "+" : ""}${keyword.growth}%`,
      observedAt: keyword.updatedAt || observedAt
    });
  }
  return evidence;
}
function productFindings(state, windowDays, includeDemo) {
  return state.products.filter((product) => includeDemo || product.dataNature !== "demo").filter((product) => withinWindow(product.firstSeenAt, windowDays)).filter((product) => discoveryDecision(product, "product").isNew !== false).map((product) => {
    const decision = discoveryDecision(product, "product");
    const evidence = productEvidence(product, state.ads, state.keywords);
    const growth = keywordGrowth(
      state.keywords,
      product.category,
      product.market
    );
    const relatedAds = state.ads.filter(
      (ad) => ad.productId === product.id
    ).length;
    const factualEvidence = product.evidenceUrl ? 35 : 20;
    const confidence = clamp2(
      factualEvidence + 25 + Math.max(5, 20 - daysSince(product.firstSeenAt)) + Math.min(20, Math.max(0, evidence.length - 1) * 8)
    );
    const gaps = [
      decision.isNew === true ? "" : "\u7F3A\u5C11\u6709\u6765\u6E90\u7684\u6709\u6548\u4E0A\u67B6\u65E5\u671F\uFF0C\u53EA\u80FD\u8BA4\u5B9A\u4E3A\u8FD1\u671F\u65B0\u53D1\u73B0",
      "\u5C1A\u672A\u63A5\u5165MOQ\u3001\u6210\u672C\u3001\u4EA4\u671F\u548C\u76EE\u6807\u5E02\u573A\u5408\u89C4\u7ED3\u8BBA"
    ].filter(Boolean);
    const businessScore = clamp2(
      24 + Math.max(0, Math.min(25, (growth || 0) / 2)) + Math.min(20, relatedAds * 12) + (product.reviewed ? 14 : 7)
    );
    return {
      id: `radar-product-${product.id}`,
      type: "product",
      title: product.title,
      subtitle: `${product.brand} \xB7 ${product.form} \xB7 ${product.ingredient}`,
      category: product.category,
      market: product.market,
      firstSeenAt: product.firstSeenAt.slice(0, 10),
      status: product.dataNature === "demo" ? "demo" : decision.isNew === true ? "confirmed" : "newly-discovered",
      confidenceScore: confidence,
      businessScore,
      trendGrowth: growth,
      adoptionCount: 1,
      evidence,
      rationale: [
        decision.reason,
        `\u6700\u8FD1 ${daysSince(product.firstSeenAt)} \u5929\u9996\u6B21\u8FDB\u5165\u7CFB\u7EDF\uFF1B\u6700\u8FD1\u53D1\u73B0 ${product.discovery?.lastSeenAt?.slice(0, 10) || "\u672A\u77E5"}`,
        relatedAds ? `\u5173\u8054 ${relatedAds} \u6761\u8FD1\u671F\u5E7F\u544A\u4FE1\u53F7` : "\u6682\u672A\u53D1\u73B0\u5173\u8054\u5E7F\u544A\u4FE1\u53F7",
        growth === null ? "\u7F3A\u5C11\u540C\u54C1\u7C7B\u53EF\u6BD4\u8F83\u8D8B\u52BF" : `\u540C\u54C1\u7C7B\u5173\u952E\u8BCD30\u5929\u5E73\u5747\u53D8\u5316 ${growth > 0 ? "+" : ""}${growth}%`
      ],
      gaps
    };
  });
}
function conceptFindings(state, windowDays, includeDemo) {
  const groups = /* @__PURE__ */ new Map();
  for (const product of state.products) {
    if (!includeDemo && product.dataNature === "demo") continue;
    if (!withinWindow(product.firstSeenAt, windowDays)) continue;
    for (const benefit of product.benefits) {
      const key = `${product.market}:${benefit}`;
      groups.set(key, [...groups.get(key) || [], product]);
    }
  }
  return [...groups.entries()].map(([key, products]) => {
    const concept = key.split(":").slice(1).join(":");
    const product = products[0];
    const brandCount = new Set(products.map((item) => item.brand)).size;
    const ads = state.ads.filter(
      (ad) => products.some((item) => item.id === ad.productId)
    );
    const keywords = state.keywords.filter(
      (keyword) => keyword.market === product.market && keyword.category === product.category
    );
    const growth = keywordGrowth(
      state.keywords,
      product.category,
      product.market
    );
    const evidence = [
      ...products.slice(0, 3).map((item) => ({
        id: `concept-product-${item.id}-${concept}`,
        kind: "product",
        source: "\u5B98\u7F51\u5546\u54C1\u5356\u70B9",
        detail: `${item.brand} \xB7 ${item.title}\uFF1A${item.benefitEvidence}`,
        observedAt: item.firstSeenAt || today(),
        url: item.evidenceUrl
      })),
      ...ads.slice(0, 2).map((ad) => ({
        id: `concept-ad-${ad.id}-${concept}`,
        kind: "ad",
        source: ad.platform,
        detail: `${ad.headline}\uFF1B${ad.copy}`,
        observedAt: ad.firstSeenAt || today(),
        url: ad.evidenceUrl
      })),
      ...keywords.slice(0, 1).map((keyword) => ({
        id: `concept-keyword-${keyword.id}-${concept}`,
        kind: "trend",
        source: keyword.source,
        detail: `${keyword.term} \xB7 30\u5929\u53D8\u5316 ${keyword.growth ?? "\u6570\u636E\u4E0D\u8DB3"}${keyword.growth === null ? "" : "%"}`,
        observedAt: keyword.updatedAt || today()
      }))
    ];
    const sourceKinds = new Set(evidence.map((item) => item.kind)).size;
    const confidence = clamp2(
      20 + brandCount * 12 + sourceKinds * 12 + Math.max(0, (growth || 0) / 4)
    );
    return {
      id: `radar-concept-${product.market}-${concept}`,
      type: "concept",
      title: concept,
      subtitle: `${product.category} \xB7 ${brandCount} \u4E2A\u54C1\u724C\u91C7\u7528`,
      category: product.category,
      market: product.market,
      firstSeenAt: products.map((item) => item.firstSeenAt || today()).sort().reverse()[0],
      status: products.every((item) => item.dataNature === "demo") ? "demo" : "pending",
      confidenceScore: confidence,
      businessScore: clamp2(
        20 + brandCount * 12 + ads.length * 8 + Math.max(0, (growth || 0) / 2)
      ),
      trendGrowth: growth,
      adoptionCount: brandCount,
      evidence,
      rationale: [
        `${products.length} \u4E2A\u5546\u54C1\u3001${brandCount} \u4E2A\u54C1\u724C\u91C7\u7528\u8BE5\u8868\u8FBE`,
        `${ads.length} \u6761\u5173\u8054\u5E7F\u544A\uFF0C${sourceKinds} \u7C7B\u72EC\u7ACB\u8BC1\u636E`,
        growth === null ? "\u6682\u7F3A\u8D8B\u52BF\u9A8C\u8BC1" : `\u540C\u54C1\u7C7B\u5173\u952E\u8BCD30\u5929\u5E73\u5747\u53D8\u5316 ${growth > 0 ? "+" : ""}${growth}%`
      ],
      gaps: [
        brandCount < 2 ? "\u5C1A\u672A\u8FBE\u5230\u201C\u81F3\u5C112\u4E2A\u54C1\u724C\u91C7\u7528\u201D\u7684\u786E\u8BA4\u95E8\u69DB" : "",
        sourceKinds < 2 ? "\u5C1A\u672A\u8FBE\u5230\u4E24\u7C7B\u72EC\u7ACB\u6765\u6E90\u4EA4\u53C9\u9A8C\u8BC1\u95E8\u69DB" : ""
      ].filter(Boolean)
    };
  });
}
function ingredientFindings(state, windowDays, includeDemo) {
  const groups = /* @__PURE__ */ new Map();
  for (const product of state.products) {
    if (!includeDemo && product.dataNature === "demo") continue;
    if (!withinWindow(product.firstSeenAt, windowDays)) continue;
    for (const insight of product.ingredientInsights) {
      const key = `${product.market}:${insight.name.toLowerCase()}`;
      groups.set(key, [...groups.get(key) || [], product]);
    }
  }
  return [...groups.entries()].map(([key, products]) => {
    const ingredientKey = key.split(":").slice(1).join(":");
    const product = products[0];
    const insight = product.ingredientInsights.find(
      (item) => item.name.toLowerCase() === ingredientKey
    );
    const brandCount = new Set(products.map((item) => item.brand)).size;
    const growth = keywordGrowth(
      state.keywords,
      product.category,
      product.market
    );
    const evidence = products.slice(0, 3).map((item) => {
      const itemInsight = item.ingredientInsights.find(
        (entry) => entry.name.toLowerCase() === ingredientKey
      );
      return {
        id: `ingredient-${item.id}-${ingredientKey}`,
        kind: "product",
        source: "\u5B98\u7F51\u6210\u5206\u8868 / \u5546\u54C1\u6807\u7B7E",
        detail: `${item.brand} \xB7 ${item.title}\uFF1A${itemInsight.amount}\uFF1B${itemInsight.evidence}`,
        observedAt: item.firstSeenAt || today(),
        url: item.evidenceUrl
      };
    });
    const confidence = clamp2(
      45 + Math.min(25, brandCount * 10) + (product.reviewed ? 20 : 5)
    );
    return {
      id: `radar-ingredient-${product.market}-${ingredientKey}`,
      type: "ingredient",
      title: insight.name,
      subtitle: `${insight.amount} \xB7 ${product.form}`,
      category: product.category,
      market: product.market,
      firstSeenAt: products.map((item) => item.firstSeenAt || today()).sort().reverse()[0],
      status: products.every((item) => item.dataNature === "demo") ? "demo" : "pending",
      confidenceScore: confidence,
      businessScore: clamp2(
        25 + brandCount * 12 + Math.max(0, (growth || 0) / 2)
      ),
      trendGrowth: growth,
      adoptionCount: brandCount,
      evidence,
      rationale: [
        `${products.length} \u4E2A\u5546\u54C1\u6807\u7B7E\u51FA\u73B0\uFF0C\u6D89\u53CA ${brandCount} \u4E2A\u54C1\u724C`,
        `\u8BB0\u5F55\u5242\u91CF\u53E3\u5F84\uFF1A${insight.amount}`,
        growth === null ? "\u6682\u7F3A\u76F8\u5173\u9700\u6C42\u8D8B\u52BF" : `\u5173\u8054\u54C1\u7C7B\u5173\u952E\u8BCD30\u5929\u5E73\u5747\u53D8\u5316 ${growth > 0 ? "+" : ""}${growth}%`
      ],
      gaps: [
        brandCount < 2 ? "\u76EE\u524D\u53EA\u6709\u5355\u4E00\u54C1\u724C\u8BC1\u636E\uFF0C\u4ECD\u5C5E\u4E8E\u6210\u5206\u5019\u9009" : "",
        "\u7F3A\u5C11\u4F9B\u5E94\u5546\u3001MOQ\u3001\u6210\u672C\u3001\u4EA4\u671F\u53CA\u76EE\u6807\u5E02\u573A\u5408\u89C4\u8D44\u6599"
      ].filter(Boolean)
    };
  });
}
function buildRadarFindings(state, windowDays, includeDemo = true) {
  const compared = { ...state, keywords: state.keywords.map((k) => ({ ...k, growth: trendComparisons(k)[0].change })) };
  return [
    ...adFindings(compared, windowDays, includeDemo),
    ...productFindings(compared, windowDays, includeDemo),
    ...conceptFindings(compared, windowDays, includeDemo),
    ...ingredientFindings(compared, windowDays, includeDemo)
  ].sort(
    (a, b) => (b.businessScore ?? -1) - (a.businessScore ?? -1) || b.confidenceScore - a.confidenceScore
  );
}
function adFindings(state, windowDays, includeDemo) {
  return state.ads.filter((ad) => (includeDemo || ad.dataNature !== "demo") && withinWindow(ad.firstSeenAt, windowDays)).filter((ad) => discoveryDecision(ad, "ad").isNew !== false).map((ad) => {
    const decision = discoveryDecision(ad, "ad");
    const keywords = state.keywords.filter((k) => ad.keywordIds?.includes(k.id));
    return {
      id: `radar-ad-${ad.id}`,
      type: "ad",
      title: ad.headline || ad.brand,
      subtitle: `${ad.brand} \xB7 ${ad.platform} \xB7 ${decision.label}`,
      category: keywords[0]?.category || "\u5F85\u5206\u7C7B",
      market: ad.market,
      firstSeenAt: ad.firstSeenAt.slice(0, 10),
      status: ad.dataNature === "demo" ? "demo" : decision.isNew === true ? "confirmed" : "newly-discovered",
      confidenceScore: decision.isNew === true ? 80 : 45,
      businessScore: null,
      trendGrowth: null,
      adoptionCount: keywords.length,
      evidence: [{
        id: `ad-evidence-${ad.id}`,
        kind: "ad",
        source: ad.source || ad.platform,
        detail: ad.copy || ad.headline,
        observedAt: ad.lastCollectedAt || ad.firstSeenAt,
        url: ad.evidenceUrl
      }],
      rationale: [decision.reason, `\u5165\u9009\u5173\u952E\u8BCD\uFF1A${keywords.map((k) => k.term).join("\u3001") || ad.query || "\u5C1A\u672A\u5173\u8054"}`],
      gaps: [decision.isNew === null ? "\u7F3A\u5C11\u53EF\u6838\u9A8C\u7684\u6295\u653E\u5F00\u59CB\u65E5\u671F" : "", "\u5E7F\u544A\u4F20\u64AD\u4E0D\u5355\u72EC\u8BC1\u660E\u6240\u552E\u5546\u54C1\u662F\u65B0\u54C1"].filter(Boolean)
    };
  });
}
function buildCollectedRadarFindings(collector, windowDays) {
  if (!collector) return [];
  return collector.observations.filter((item) => withinWindow(item.firstSeenAt, windowDays)).map((item) => ({ item, decision: discoveryDecision({
    market: item.market,
    firstSeenAt: item.firstSeenAt,
    decisionData: { listing: {
      date: item.publishedAt?.slice(0, 10),
      provider: "\u54C1\u724C\u5B98\u7F51",
      platform: "\u5B98\u7F51\u5546\u54C1\u9875",
      market: item.market,
      collectedAt: item.capturedAt,
      evidenceUrl: item.url
    } }
  }, "product") })).filter(({ decision }) => decision.isNew !== false).map(({ item, decision }) => {
    const observed = item.firstSeenAt.slice(0, 10);
    const confidence = clamp2(
      35 + 25 + Math.max(5, 20 - daysSince(observed)) + (decision.isNew === true ? 20 : 8)
    );
    return {
      id: `collector-${item.id}`,
      type: "product",
      title: item.title,
      subtitle: `${item.brand} \xB7 \u516C\u5F00\u5B98\u7F51\u81EA\u52A8\u91C7\u96C6`,
      category: "\u5F85\u5206\u7C7B",
      market: item.market,
      firstSeenAt: observed,
      status: decision.isNew === true ? "confirmed" : "newly-discovered",
      confidenceScore: confidence,
      businessScore: null,
      trendGrowth: null,
      adoptionCount: 1,
      evidence: [
        {
          id: `collector-evidence-${item.id}`,
          kind: "product",
          source: "\u54C1\u724C\u5B98\u7F51\u81EA\u52A8\u91C7\u96C6",
          detail: [
            item.description,
            item.price === null ? "" : `\u6807\u4EF7 ${item.price} ${item.currency || ""}`.trim()
          ].filter(Boolean).join("\uFF1B"),
          observedAt: item.capturedAt.slice(0, 10),
          url: item.url
        }
      ],
      rationale: [
        decision.reason,
        item.changeType === "changed" ? "\u672C\u6B21\u91C7\u96C6\u68C0\u6D4B\u5230\u9875\u9762\u5185\u5BB9\u53D8\u5316" : "\u8FC7\u53BB180\u5929\u91C7\u96C6\u57FA\u7EBF\u4E2D\u6CA1\u6709\u76F8\u540C\u5546\u54C1\u6307\u7EB9"
      ],
      gaps: [
        decision.isNew === true ? "" : "\u7F3A\u5C11\u5B98\u7F51\u786E\u8BA4\u53D1\u5E03\u65F6\u95F4\uFF0C\u6682\u6309\u8FD1\u671F\u65B0\u53D1\u73B0\u5904\u7406",
        "\u5C1A\u672A\u5173\u8054\u5E7F\u544A\u3001\u5173\u952E\u8BCD\u3001\u8D8B\u52BF\u548C\u4F9B\u5E94\u94FE\u6570\u636E\uFF0C\u56E0\u6B64\u4E0D\u8BA1\u7B97\u5546\u4E1A\u673A\u4F1A\u5206"
      ].filter(Boolean)
    };
  });
}
function freeSignalEvidence(signal) {
  let kind = "research";
  if (signal.kind === "product") kind = "product";
  if (signal.kind === "content" || signal.kind === "news") kind = "content";
  if (signal.kind === "regulatory" || signal.kind === "safety_aggregate")
    kind = "regulatory";
  return {
    id: `public-${signal.id}`,
    kind,
    source: signal.source,
    detail: `${signal.title}\uFF1B${signal.summary}`,
    observedAt: signal.observedAt,
    url: signal.url
  };
}
function buildFreeSourceRadarFindings(data, windowDays) {
  if (!data) return [];
  const findings = [];
  const products = data.signals.filter(
    (signal) => signal.kind === "product" && signal.market === "US" && withinWindow(signal.observedAt, windowDays)
  );
  for (const signal of products) {
    findings.push({
      id: `public-product-${signal.id}`,
      type: "product",
      title: signal.title,
      subtitle: `${signal.brand || "\u54C1\u724C\u5F85\u6838"} \xB7 NIH DSLD\u516C\u5F00\u6807\u7B7E`,
      category: signal.category,
      market: "US",
      firstSeenAt: signal.observedAt,
      status: "pending",
      confidenceScore: clamp2(
        62 + Math.max(0, 14 - daysSince(signal.observedAt))
      ),
      businessScore: null,
      trendGrowth: null,
      adoptionCount: 1,
      evidence: [freeSignalEvidence(signal)],
      rationale: [
        `DSLD\u4E8E ${signal.observedAt} \u6536\u5F55\u8BE5\u5728\u552E\u6807\u7B7E`,
        `\u516C\u5F00\u6807\u7B7E\u5305\u542B ${signal.ingredients?.length || 0} \u4E2A\u5DF2\u63D0\u53D6\u6210\u5206\u540D\u79F0`
      ],
      gaps: [
        "DSLD\u6536\u5F55\u65E5\u671F\u4E0D\u7B49\u4E8E\u9996\u6B21\u4E0A\u5E02\u65E5\u671F",
        "\u5C1A\u672A\u5173\u8054\u5B98\u7F51\u9996\u53D1\u3001\u8D8B\u52BF\u3001\u5E7F\u544A\u548C\u4F9B\u5E94\u94FE\u6570\u636E\uFF0C\u56E0\u6B64\u4E0D\u8BA1\u7B97\u5546\u4E1A\u673A\u4F1A\u5206"
      ]
    });
  }
  const contentGroups = /* @__PURE__ */ new Map();
  for (const signal of data.signals) {
    if (signal.kind !== "content" || signal.market === "GLOBAL") continue;
    if (!withinWindow(signal.observedAt, windowDays)) continue;
    const key = `${signal.market}:${signal.query}`;
    contentGroups.set(key, [...contentGroups.get(key) || [], signal]);
  }
  for (const [key, signals] of contentGroups) {
    const market = key.split(":")[0];
    const first = signals[0];
    findings.push({
      id: `public-content-${key}`,
      type: "concept",
      title: first.query,
      subtitle: `${signals.length} \u6761\u8FD1\u671F\u516C\u5F00\u89C6\u9891\u5185\u5BB9`,
      category: first.category,
      market,
      firstSeenAt: signals.map((item) => item.observedAt).toSorted().at(-1),
      status: "pending",
      confidenceScore: clamp2(28 + Math.min(32, signals.length * 5)),
      businessScore: null,
      trendGrowth: null,
      adoptionCount: signals.length,
      evidence: signals.slice(0, 5).map(freeSignalEvidence),
      rationale: [
        `\u6700\u8FD1\u89C2\u5BDF\u7A97\u53E3\u5185\u51FA\u73B0 ${signals.length} \u6761\u76F8\u5173\u89C6\u9891`,
        "\u5185\u5BB9\u6570\u91CF\u7528\u4E8E\u5224\u65AD\u4F20\u64AD\u6D3B\u8DC3\u5EA6\uFF0C\u4E0D\u4EE3\u8868\u641C\u7D22\u9700\u6C42\u6216\u9500\u552E\u589E\u957F"
      ],
      gaps: ["\u5C1A\u672A\u4E0E\u5B98\u7F51\u5546\u54C1\u3001\u5173\u952E\u8BCD\u8D8B\u52BF\u548C\u5E7F\u544A\u6570\u636E\u4EA4\u53C9\u9A8C\u8BC1"]
    });
  }
  const regulatoryGroups = /* @__PURE__ */ new Map();
  for (const signal of data.signals) {
    if (signal.kind !== "regulatory" || signal.market !== "US") continue;
    if (!withinWindow(signal.observedAt, windowDays)) continue;
    regulatoryGroups.set(signal.query, [
      ...regulatoryGroups.get(signal.query) || [],
      signal
    ]);
  }
  for (const [query, signals] of regulatoryGroups) {
    const first = signals[0];
    findings.push({
      id: `public-regulatory-US-${query}`,
      type: "ingredient",
      title: `${query} \xB7 \u76D1\u7BA1\u4FE1\u53F7`,
      subtitle: `${signals.length} \u6761openFDA\u8FD1\u671F\u53EC\u56DE\u8BB0\u5F55`,
      category: first.category,
      market: "US",
      firstSeenAt: signals.map((item) => item.observedAt).toSorted().at(-1),
      status: "pending",
      confidenceScore: 72,
      businessScore: null,
      trendGrowth: null,
      adoptionCount: signals.length,
      evidence: signals.slice(0, 5).map(freeSignalEvidence),
      rationale: [
        `\u89C2\u5BDF\u7A97\u53E3\u5185\u5339\u914D ${signals.length} \u6761FDA\u53EC\u56DE\u8BB0\u5F55`,
        "\u8BE5\u4FE1\u53F7\u7528\u4E8E\u98CE\u9669\u590D\u6838\uFF0C\u4E0D\u7528\u4E8E\u5224\u65AD\u5E02\u573A\u673A\u4F1A\u5927\u5C0F"
      ],
      gaps: ["\u9700\u8981\u6838\u5BF9\u5177\u4F53\u4EA7\u54C1\u3001\u6279\u6B21\u3001\u53EC\u56DE\u539F\u56E0\u4EE5\u53CA\u4E0E\u62DF\u5F00\u53D1\u914D\u65B9\u7684\u5173\u8054"]
    });
  }
  return findings;
}
function buildSourceCoverage(state, collector = null, freeData = null) {
  const latest = (values) => values.filter(Boolean).map((value) => value.slice(0, 10)).sort().reverse()[0] || "\u5C1A\u65E0\u6570\u636E";
  const collectedProducts = collector?.observations || [];
  const realProducts = state.products.filter(
    (item) => item.dataNature !== "demo"
  );
  const realAds = state.ads.filter((item) => item.dataNature !== "demo");
  const realKeywords = state.keywords.filter(
    (item) => item.dataNature !== "demo"
  );
  const trendKeywords = realKeywords.filter((item) => item.series.length >= 2);
  const publicProducts = freeData?.signals.filter((item) => item.kind === "product").length || 0;
  const publicScience = freeData?.signals.filter(
    (item) => ["ingredient_profile", "research", "trial"].includes(item.kind)
  ).length || 0;
  const publicRegulatory = freeData?.signals.filter(
    (item) => ["regulatory", "safety_aggregate"].includes(item.kind)
  ).length || 0;
  const publicContent = freeData?.signals.filter((item) => ["content", "news"].includes(item.kind)).length || 0;
  return [
    {
      key: "products",
      label: "\u5546\u54C1\u4E0E\u516C\u5F00\u6807\u7B7E",
      count: realProducts.length + collectedProducts.length + publicProducts,
      lastUpdated: collectedProducts.length && collector?.generatedAt?.slice(0, 10) || latest(realProducts.map((item) => item.firstSeenAt)),
      status: realProducts.length + collectedProducts.length + publicProducts ? "partial" : "missing",
      automated: realProducts.some((item) => Boolean(item.sourceProvider)) || !!collector?.configuredSites || state.sites.some((site) => site.collectorMode === "automatic"),
      note: "\u5E73\u53F0\u5546\u54C1\u3001\u5B98\u7F51\u4E8B\u5B9E\u4E0ENIH DSLD\u516C\u5F00\u6807\u7B7E\uFF1B\u652F\u6301\u6BCF\u65E5\u5165\u9009\u8BCD\u53D1\u73B0"
    },
    {
      key: "ads",
      label: "\u5E7F\u544A\u4E0E\u843D\u5730\u9875",
      count: realAds.length,
      lastUpdated: latest(realAds.map((item) => item.firstSeenAt)),
      status: realAds.length > 0 ? "partial" : "missing",
      automated: realAds.some((item) => item.dataNature === "collected"),
      note: "\u652F\u6301\u6BCF\u65E5\u5165\u9009\u8BCD\u53D1\u73B0\uFF1B\u5E7F\u544A\u4E0D\u5355\u72EC\u8BC1\u660E\u65B0\u54C1"
    },
    {
      key: "keywords",
      label: "\u5173\u952E\u8BCD",
      count: realKeywords.length,
      lastUpdated: latest(realKeywords.map((item) => item.updatedAt)),
      status: realKeywords.length > 0 ? "partial" : "missing",
      automated: false,
      note: "\u7528\u6237\u8868\u8FBE\u3001\u5173\u8054\u5546\u54C1\u548C\u7AD9\u70B9\u8986\u76D6"
    },
    {
      key: "trends",
      label: "\u8D8B\u52BF\u65F6\u5E8F",
      count: trendKeywords.length,
      lastUpdated: latest(trendKeywords.map((item) => item.updatedAt)),
      status: trendKeywords.length > 0 ? "partial" : "missing",
      automated: false,
      note: "\u9700\u6C42\u53D8\u5316\u9A8C\u8BC1\uFF1B\u7F51\u9875\u7AEF\u6570\u636E\u6309\u67E5\u8BE2\u6279\u6B21\u89E3\u91CA"
    },
    {
      key: "science",
      label: "\u79D1\u7814\u4E0E\u6210\u5206\u6863\u6848",
      count: publicScience,
      lastUpdated: freeData?.generatedAt?.slice(0, 10) || "\u5C1A\u65E0\u6570\u636E",
      status: publicScience > 0 ? "available" : "missing",
      automated: true,
      note: "PubMed\u3001ClinicalTrials.gov\u4E0EPubChem"
    },
    {
      key: "regulatory",
      label: "\u76D1\u7BA1\u4E0E\u5B89\u5168\u7EBF\u7D22",
      count: publicRegulatory,
      lastUpdated: freeData?.generatedAt?.slice(0, 10) || "\u5C1A\u65E0\u6570\u636E",
      status: publicRegulatory > 0 ? "available" : "missing",
      automated: true,
      note: "openFDA\u53EC\u56DE\u4E0ECAERS\u6C47\u603B"
    },
    {
      key: "content",
      label: "\u65B0\u95FB\u4E0E\u5185\u5BB9\u4FE1\u53F7",
      count: publicContent,
      lastUpdated: freeData?.generatedAt?.slice(0, 10) || "\u5C1A\u65E0\u6570\u636E",
      status: publicContent > 0 ? "partial" : "missing",
      automated: true,
      note: "GDELT\u4E0E\u53EF\u9009YouTube\u514D\u8D39\u914D\u989D"
    },
    {
      key: "supply",
      label: "\u4F9B\u5E94\u94FE\u53EF\u884C\u6027",
      count: 0,
      lastUpdated: "\u5C1A\u672A\u63A5\u5165",
      status: "missing",
      automated: false,
      note: "MOQ\u3001\u6210\u672C\u3001\u4EA4\u671F\u3001\u539F\u6599\u3001\u8BA4\u8BC1\u548C\u5408\u89C4"
    }
  ];
}
function buildRadarReport(findings, windowDays, marketLabel, appName = "\u60C5\u62A5\u5DE5\u4F5C\u533A") {
  const products = findings.filter((item) => item.type === "product");
  const concepts = findings.filter((item) => item.type === "concept");
  const ingredients2 = findings.filter((item) => item.type === "ingredient");
  const ads = findings.filter((item) => item.type === "ad");
  const strongest = [...findings].filter((item) => item.businessScore !== null).sort((a, b) => (b.businessScore || 0) - (a.businessScore || 0))[0];
  return [
    `${appName} \xB7 \u65B0\u54C1\u96F7\u8FBE${windowDays}\u5929\u5206\u6790\u62A5\u544A`,
    `\u5E02\u573A\uFF1A${marketLabel}`,
    `\u751F\u6210\u65F6\u95F4\uFF1A${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`,
    "",
    `\u53D1\u73B0\u6982\u51B5\uFF1A${products.length}\u4E2A\u65B0\u54C1/\u65B0\u53D1\u73B0\u5546\u54C1\u5019\u9009\uFF0C${ads.length}\u6761\u65B0\u5E7F\u544A\u7EBF\u7D22\uFF0C${concepts.length}\u4E2A\u6982\u5FF5\u5019\u9009\uFF0C${ingredients2.length}\u4E2A\u6210\u5206\u5019\u9009\u3002`,
    strongest ? `\u5F53\u524D\u7EFC\u5408\u4F18\u5148\u9879\uFF1A${strongest.title}\uFF08\u65B0\u9C9C\u5EA6\u53EF\u4FE1\u5EA6${strongest.confidenceScore}\uFF0C\u5546\u4E1A\u673A\u4F1A\u5206${strongest.businessScore}\uFF09\u3002` : "\u5F53\u524D\u6CA1\u6709\u8FBE\u5230\u89C2\u5BDF\u7A97\u53E3\u548C\u5E02\u573A\u6761\u4EF6\u7684\u5019\u9009\u3002",
    "",
    "\u5224\u65AD\u53E3\u5F84\uFF1A\u5546\u54C1\u4E8B\u5B9E\u3001\u5E7F\u544A\u4F20\u64AD\u3001\u5173\u952E\u8BCD\u4E0E\u8D8B\u52BF\u5206\u522B\u8BB0\u5F55\uFF1B\u5E7F\u544A\u4E0D\u5355\u72EC\u8BC1\u660E\u65B0\u54C1\uFF1B\u7F3A\u5931\u6570\u636E\u6807\u4E3A\u4E0D\u8DB3\uFF0C\u4E0D\u6309\u96F6\u5206\u5904\u7406\u3002",
    "",
    ...findings.slice(0, 10).flatMap((item, index) => [
      `${index + 1}. [${item.type === "ad" ? "\u5E7F\u544A" : item.type === "product" ? "\u5546\u54C1" : item.type === "concept" ? "\u6982\u5FF5" : "\u6210\u5206"}] ${item.title}`,
      `   ${item.subtitle}\uFF5C\u53EF\u4FE1\u5EA6 ${item.confidenceScore}\uFF5C\u673A\u4F1A\u5206 ${item.businessScore ?? "\u6570\u636E\u4E0D\u8DB3"}`,
      `   \u4F9D\u636E\uFF1A${item.rationale.join("\uFF1B")}`,
      item.gaps.length > 0 ? `   \u6570\u636E\u7F3A\u53E3\uFF1A${item.gaps.join("\uFF1B")}` : "   \u6570\u636E\u7F3A\u53E3\uFF1A\u65E0\u5173\u952E\u7F3A\u53E3"
    ]),
    "",
    "\u8BF4\u660E\uFF1A\u6F14\u793A\u6837\u672C\u53EA\u7528\u4E8E\u9A8C\u8BC1\u4EA4\u4E92\u548C\u8BA1\u7B97\u89C4\u5219\uFF0C\u4E0D\u6784\u6210\u771F\u5B9E\u5E02\u573A\u7ED3\u8BBA\u3002\u6B63\u5F0F\u62A5\u544A\u5E94\u5173\u95ED\u201C\u5305\u542B\u6F14\u793A\u6837\u672C\u201D\u3002"
  ].join("\n");
}

// apps/web-antd/src/views/intelligence/statistics-engine.ts
var marketName = (market) => ({ US: "\u7F8E\u56FD", MX: "\u58A8\u897F\u54E5", VN: "\u8D8A\u5357" })[market] || market;
function opportunityRows(state, tab) {
  const counts = /* @__PURE__ */ new Map();
  for (const p of state.products) counts.set(p.siteId, (counts.get(p.siteId) || 0) + 1);
  if (tab === "keyword") return state.keywords.filter((k) => (k.growth || 0) > 20).map((k) => ({ id: k.id, title: `${k.term} \xB7 ${k.market}`, count: 1, description: `${k.category} \xB7 \u540C\u5E02\u573A\u8D8B\u52BF\u4E0A\u5347\u4FE1\u53F7\uFF0C\u4ECD\u9700\u72EC\u7ACB\u6765\u6E90\u9A8C\u8BC1\u3002` }));
  if (tab === "site") return state.sites.map((s) => ({ id: s.id, title: s.brand, count: counts.get(s.id) || 0, description: `${marketName(s.market)} \xB7 \u76EE\u524D\u53EA\u6709\u9996\u6B21\u6837\u672C\uFF0C\u5C1A\u4E0D\u80FD\u786E\u8BA4\u6301\u7EED\u6210\u957F\u3002` }));
  if (tab === "new") return state.products.map((p) => ({ id: p.id, title: p.title, count: 1, description: `${p.brand} \xB7 ${marketName(p.market)} \xB7 \u65B0\u53D1\u73B0\u4E0D\u7B49\u4E8E\u65B0\u4E0A\u5E02\u3002` }));
  const groups = /* @__PURE__ */ new Map();
  for (const p of state.products) {
    const key = (tab === "ingredient" ? p.ingredient : tab === "claim" ? p.claim : p.category) || "\u5F85\u8865\u5145";
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups].map(([title, count]) => ({ id: title, title, count, description: tab === "claim" ? "\u7ADE\u54C1\u6587\u6848\u8868\u8FBE\uFF0C\u4E0D\u80FD\u636E\u6B64\u8BA4\u5B9A\u79D1\u5B66\u529F\u6548\u3002" : "\u5DF2\u6574\u7406\u5173\u8054\u5546\u54C1\u6837\u672C\uFF0C\u5EFA\u8BAE\u8865\u5145\u8D8B\u52BF\u3001\u914D\u65B9\u4E0E\u5E02\u573A\u53CD\u9988\u3002" })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}
function formulaOf(product) {
  if (product.formula?.fingerprint) return product.formula;
  const ingredients2 = (product.ingredientInsights || []).map((item) => item.name.trim()).filter(Boolean).map((name) => ({ name, amount: "", raw: name }));
  return { status: ingredients2.length ? product.reviewed ? "verified" : "observed" : "unknown", fingerprint: [...new Set(ingredients2.map((item) => item.name.toLowerCase()))].sort().join("|"), ingredients: ingredients2 };
}
function formulaStatistics(products) {
  const groups = /* @__PURE__ */ new Map();
  let observed = 0, verified = 0;
  for (const product of products) {
    const formula = formulaOf(product);
    if (!formula.fingerprint || formula.status === "unknown") continue;
    observed++;
    if (formula.status === "verified") verified++;
    const item = groups.get(formula.fingerprint) || { ingredients: formula.ingredients.map((i) => i.name), products: 0, brands: /* @__PURE__ */ new Set(), markets: /* @__PURE__ */ new Set(), verified: 0, signal: 0 };
    item.products++;
    item.brands.add(product.brand);
    item.markets.add(product.market);
    if (formula.status === "verified") item.verified++;
    item.signal += Math.log10(1 + Math.max(0, Number(product.sourceMetrics?.reviewCount) || 0)) * 10;
    groups.set(formula.fingerprint, item);
  }
  const rows = [...groups].map(([key, item]) => ({ id: key, key, ingredients: item.ingredients, brands: [...item.brands], markets: [...item.markets], products: item.products, verified: item.verified, score: Math.round(item.products * 20 + item.brands.size * 10 + Math.min(50, Math.log10(1 + item.signal) * 15)) })).sort((a, b) => b.score - a.score || b.products - a.products || a.id.localeCompare(b.id));
  return { rows, coverage: { total: products.length, observed, verified, percent: products.length ? Math.round(observed / products.length * 100) : 0 } };
}
function radarStatistics(findings) {
  const counts = { ad: 0, product: 0, concept: 0, ingredient: 0, verified: 0 };
  const activity = {};
  let sum = 0, scored = 0;
  for (const item of findings) {
    counts[item.type]++;
    if (item.confidenceScore >= 70) counts.verified++;
    if (item.businessScore !== null) {
      sum += item.businessScore;
      scored++;
    }
    const day3 = item.firstSeenAt.slice(0, 10);
    activity[day3] ||= {};
    activity[day3][item.type] = (activity[day3][item.type] || 0) + 1;
  }
  return { counts, averageScore: scored ? Math.round(sum / scored) : null, activity };
}

// apps/web-antd/src/views/intelligence/product-decisions.ts
function productDataSource(product) {
  if (product.sourceProvider)
    return `${product.sourceProvider} \xB7 ${product.sourcePlatform || "\u5E73\u53F0\u5546\u54C1"}`;
  if (product.dataNature === "demo") return "\u6F14\u793A\u6837\u672C";
  return product.siteId ? "\u5B98\u7F51\u5B9E\u91C7" : "\u4EBA\u5DE5\u5BFC\u5165 / \u6765\u6E90\u5F85\u786E\u8BA4";
}
var DAY4 = 864e5;
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
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end + DAY4 > now || point.partial || typeof point.value !== "number" || !Number.isFinite(point.value) || point.value < 0)
    return false;
  if (period === "day") return start === end;
  if (period === "week") return end - start === 6 * DAY4;
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
    if (!current || !previous || day2(current.start) !== day2(previous.end) + DAY4)
      continue;
    if (now - day2(current.end) > { day: 7, week: 21, month: 45 }[series.period] * DAY4) {
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
      if (!point || !firstPoint || day2(firstPoint.start) !== day2(point.end) + DAY4)
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
  if (Number.isFinite(first) && first <= now && now - first < 14 * DAY4)
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
  buildCollectedRadarFindings,
  buildFreeSourceRadarFindings,
  buildRadarFindings,
  buildRadarReport,
  buildSourceCoverage,
  classifyKeyword,
  coreMetrics,
  formulaStatistics,
  groupAdvertisers,
  opportunityRows,
  productDataSource,
  productDecisions,
  radarStatistics,
  trendComparisons,
  trendRecordFields
};

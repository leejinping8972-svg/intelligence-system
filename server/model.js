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
var KEYWORD_MODEL_VERSION = "keyword-research-v3.0";
var clamp = (value) => Math.round(Math.max(0, Math.min(100, value)));
function gradeForScore(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}
function assessKeyword(keyword) {
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

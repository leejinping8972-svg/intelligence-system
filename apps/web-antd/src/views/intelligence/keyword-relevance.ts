import type { Keyword } from './data';

// Match the expression itself. A discovery seed or an inherited category is not
// evidence that a homonym belongs to the supplement business.
export function normalizeKeywordText(value: string) {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('đ', 'd')
    .replaceAll(/[‐‑‒–—−]/g, '-')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

const families: Array<[string, RegExp]> = [
  [
    'ghk-cu',
    /\b(?:ghk\s*-?\s*cu|ghkcu|ghk[ -]copper[ -]peptides?|copper[ -]tripeptide\s*-?\s*1)\b|蓝铜肽|藍銅肽|蓝铜胜肽|铜三肽[ -]?1|三肽[ -]?1[ -]?铜/,
  ],
  ['copper-peptide', /\bcopper[ -]peptides?\b|铜肽|銅肽/],
  [
    'modified-peptide',
    /\b(?:(?:palmitoyl|biotinoyl|myristoyl)[ -]tripeptide[ -]?1|tripeptide[ -]?10)\b/,
  ],
  ['ghk', /\b(?:ghk|tripeptide[ -]?1)\b/],
  ['omega', /\b(?:omega\s*-?\s*[369]|dha|epa)\b|欧米伽\s*[369]|欧米茄\s*[369]/],
  ['fish-oil', /\b(?:fish[ -]oil|aceite de pescado|dau ca)\b|鱼油|魚油/],
  ['magnesium', /\b(?:magnesium|magnesio|magie)\b|镁|鎂/],
  ['collagen', /\b(?:collagen|colageno|collagene)\b|胶原|膠原/],
  ['creatine', /\b(?:creatine|creatina)\b|肌酸/],
  ['probiotic', /\b(?:probiotics?|probioticos?|men vi sinh)\b|益生菌/],
  [
    'prebiotic',
    /\b(?:prebiotics?|prebioticos?|inulin|inulina|psyllium)\b|益生元|菊粉|车前子/,
  ],
  ['inositol', /\b(?:inositol|myo inositol)\b|肌醇/],
  ['ashwagandha', /\bashwagandha\b|南非醉茄/],
  ['berberine', /\b(?:berberine|berberina)\b|小檗碱/],
  ['melatonin', /\b(?:melatonin|melatonina)\b|褪黑素/],
  [
    'vitamin',
    /\b(?:multi\s*-?\s*vitamins?|vitamins?|vitaminas?)\b|维生素|維生素/,
  ],
  ['protein', /\b(?:protein|proteina|whey)\b|蛋白/],
  ['electrolyte', /\b(?:electrolytes?|electrolitos?|dien giai)\b|电解质/],
  ['fiber', /\b(?:fibers?|fibres?|fibra|chat xo)\b|膳食纤维/],
  ['zinc', /\b(?:zinc|kem)\b|锌|鋅/],
  ['calcium', /\b(?:calcium|calcio|canxi)\b|钙|鈣/],
  ['iron', /\b(?:iron|hierro|sat)\b|补铁|補鐵/],
  ['coq10', /\b(?:coq\s*-?\s*10|coenzyme q10|ubiquinol)\b|辅酶Q10/i],
];
const formPattern =
  /\b(?:gumm(?:y|ies)|capsules?|capsulas?|powders?|polvo|softgels?|tablets?|liquid|liquido|bot|vien)\b|软糖|軟糖|胶囊|膠囊|粉剂|片剂|滴剂/;
const supplementPattern =
  /\b(?:supplements?|suplementos?|complementos? alimenticios?|thuc pham (?:bo sung|chuc nang)|bo sung|health products?)\b|保健品|膳食补充剂|营养补充剂|營養補充劑/;
const purchasePattern =
  /\b(?:buy|price|shop|comprar|precio|mua|gia)\b|购买|價格|价格/;
const audiencePattern =
  /\b(?:women|female|menopause|prenatal|pregnancy|kids|children|seniors|phu nu|mujeres?|ninos)\b|女性|孕妇|儿童|老年/;
const informationPattern =
  /\b(?:how|what|benefits?|side effects?|cach|la gi|como|para que)\b|功效|副作用|是什么/;
const brandPattern =
  /\b(?:amazon|walmart|iherb|now foods|nature made|garden of life|lemme|goli)\b/;
// Explicit incompatible objects win even when the expression also says omega-3.
const excludedPattern =
  /\b(?:watch(?:es)?|watchbands?|watchstraps?|seamaster|speedmaster|swatch|rolex|reloj(?:es)?|dong ho|cars?|car parts?|motor oil|engine oil|pet food|dog food|cat food|dogs?|cats?|puppies|pets?|veterinary|perros?|gatos?|thu cung|cho meo|shampoos?|serums?|creams?|topical|balms?|tallow|scalp complex|inject(?:ions?|ables?|ed|ing)?|vials?|syringes?|research use only|laboratory use|not for human consumption|niod|the ordinary|ordinary copper|geek (?:and|&) gorgeous|remedy copper)\b|手表|腕表|欧米茄手表|汽车|机油|宠物|猫粮|狗粮|洗发水|面霜|精华液|外用|注射|仅供科研/;
const servicePattern =
  /\b(?:hospitals?|clinics?|doctors?|jobs?|salary|magazine|badge reel|services?|partners|specialists?|environmental protection agency)\b|benh vien|tuyen dung|招聘|医院/;

function ingredients(text: string) {
  const found = families
    .filter(([, pattern]) => pattern.test(text))
    .map(([key]) => key);
  // A metal complex, an unbound peptide and a modified peptide are distinct.
  return found.filter(
    (key) =>
      !(
        key === 'ghk' &&
        (found.includes('ghk-cu') || found.includes('modified-peptide'))
      ) && !(key === 'copper-peptide' && found.includes('ghk-cu')),
  );
}

export function hasOralProductContext(value: string) {
  const text = normalizeKeywordText(value);
  return (
    !excludedPattern.test(text) &&
    !/\b(?:not for oral|not (?:an? )?(?:oral|dietary) supplement|do not (?:swallow|ingest)|for external use|external use only|not intended for ingestion)\b|非口服|禁止口服|不可口服/.test(
      text,
    ) &&
    (supplementPattern.test(text) ||
      /\b(?:oral|by mouth|swallow|capsules?|tablets?|softgels?|gummies)\b|口服|胶囊|片剂|软胶囊/.test(
        text,
      ))
  );
}

export function assessSupplementRelevance(
  keyword: Pick<Keyword, 'batch' | 'seedTerm' | 'term'>,
) {
  const text = normalizeKeywordText(keyword.term);
  const found = ingredients(text);
  const topic = ingredients(normalizeKeywordText(keyword.batch || ''));
  const seeds =
    topic.length > 0
      ? topic
      : ingredients(normalizeKeywordText(keyword.seedTerm || ''));
  // Fish oil and omega-3 are related discovery expressions, not separate scopes.
  const scope = (key: string) => (key === 'fish-oil' ? 'omega' : key);
  const seedMatch = found.some((key) =>
    seeds.some((seed) => scope(key) === scope(seed)),
  );
  const adjacentCopper =
    found.includes('copper-peptide') && seeds.includes('ghk-cu');
  const seedMismatch =
    found.length > 0 && seeds.length > 0 && !seedMatch && !adjacentCopper;
  const ingredient = found.some(
    (key) => !['ghk', 'modified-peptide'].includes(key),
  );
  const form = formPattern.test(text);
  const commercial = supplementPattern.test(text) || purchasePattern.test(text);
  const information = informationPattern.test(text);
  const brand = brandPattern.test(text);
  const audience = audiencePattern.test(text);
  const excluded =
    excludedPattern.test(text) ||
    /\bomega\b.*\b(?:constellation|de ville|planet ocean)\b/.test(text);
  const service = servicePattern.test(text);
  const offTopic = excluded || service;
  const ambiguous = /\bomega\b/.test(text) && !ingredient;
  const broadCategory = !ingredient && supplementPattern.test(text);
  const tags: string[] = [];
  if (ingredient && !offTopic) tags.push('成分词');
  if (form && ingredient && !offTopic) tags.push('剂型词');
  if ((ingredient || broadCategory) && !offTopic) tags.push('商品需求词');
  if (audience) tags.push('人群词');
  if (brand) tags.push('品牌导航词');
  if (information) tags.push('内容研究词');
  if (seedMatch && !offTopic) tags.push('种子成分匹配');
  if (seedMismatch && !offTopic) tags.push('偏离种子成分');
  if (adjacentCopper && !offTopic) tags.push('铜肽范围待核验');

  let relevance = 20;
  let scoreCap = 49;
  let evidence =
    '关键词自身缺少可识别的保健品成分依据，分类标签与种子词不作为相关性证明；总分最高49';
  if (ingredient) {
    relevance = seedMatch ? 95 : 85;
    scoreCap = adjacentCopper ? 74 : 100;
    evidence = `关键词自身识别到成分${seedMatch ? '，与研究主题成分匹配' : ''}；剂型、剂量和人群不机械加分，成分主词不因简短限分${adjacentCopper ? '；泛铜肽不等于GHK-Cu，最高74' : ''}；口服产品仍需来源核验`;
  }
  if (broadCategory) {
    relevance = 40;
    scoreCap = 49;
    tags.push('泛词降权');
    evidence = '保健品类目泛词，未明确具体成分；总分最高49';
  }
  if (seedMismatch) {
    relevance = Math.min(relevance, 45);
    scoreCap = Math.min(scoreCap, 39);
    evidence +=
      '；成分偏离研究主题，不能把其他肽或其他成分当成同一市场，最高39';
  }
  if (information && !offTopic) {
    scoreCap = Math.min(scoreCap, 64);
    evidence += '；信息查询用于内容研究，总分最高64';
  }
  if (ambiguous && !offTopic) {
    relevance = 15;
    scoreCap = 39;
    tags.push('同名歧义待核验');
    evidence = '单独Omega不能证明是Omega-3保健品；需明确成分表达，总分最高39';
  }
  if (offTopic) {
    relevance = excluded ? 0 : 10;
    scoreCap = excluded ? 19 : 39;
    tags.push('非商品需求', ...(excluded ? ['非保健品类目'] : []));
    evidence = `${excluded ? '命中手表、汽车、宠物或外用护肤等非目标类目' : '命中医疗服务、招聘或媒体等非商品表达'}；种子与分类不能抵消，总分最高${scoreCap}`;
  }
  return {
    relevance,
    scoreCap,
    evidence,
    tags,
    offTopic,
    brand,
    ingredient,
    commercial,
    seedMismatch,
  };
}

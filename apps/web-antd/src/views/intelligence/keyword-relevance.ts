import type { Keyword } from './data';

// Match the expression itself. A discovery seed or an inherited category is not
// evidence that a homonym belongs to the supplement business.
function normalize(value: string) {
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
const dosePattern =
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|iu|cfu|ui)\b|\d+\s*(?:毫克|微克|亿菌|%)/;
const audiencePattern =
  /\b(?:women|female|menopause|prenatal|pregnancy|kids|children|seniors|phu nu|mujeres?|ninos)\b|女性|孕妇|儿童|老年/;
const informationPattern =
  /\b(?:how|what|benefits?|side effects?|cach|la gi|como|para que)\b|功效|副作用|是什么/;
const brandPattern =
  /\b(?:amazon|walmart|iherb|now foods|nature made|garden of life|lemme|goli)\b/;
// Explicit incompatible objects win even when the expression also says omega-3.
const excludedPattern =
  /\b(?:watch(?:es)?|watchbands?|watchstraps?|seamaster|speedmaster|swatch|rolex|reloj(?:es)?|dong ho|cars?|car parts?|motor oil|engine oil|pet food|dog food|cat food|dogs?|cats?|puppies|pets?|veterinary|perros?|gatos?|thu cung|cho meo|shampoo|serum|face cream)\b|手表|腕表|欧米茄手表|汽车|机油|宠物|猫粮|狗粮|洗发水|面霜/;
const servicePattern =
  /\b(?:hospitals?|clinics?|doctors?|jobs?|salary|magazine|badge reel|services?|partners|specialists?|environmental protection agency)\b|benh vien|tuyen dung|招聘|医院/;

function ingredients(text: string) {
  return families
    .filter(([, pattern]) => pattern.test(text))
    .map(([key]) => key);
}

export function assessSupplementRelevance(
  keyword: Pick<Keyword, 'seedTerm' | 'term'>,
) {
  const text = normalize(keyword.term);
  const found = ingredients(text);
  const seeds = ingredients(normalize(keyword.seedTerm || ''));
  // Fish oil and omega-3 are related discovery expressions, not separate scopes.
  const scope = (key: string) => (key === 'fish-oil' ? 'omega' : key);
  const seedMatch = found.some((key) =>
    seeds.some((seed) => scope(key) === scope(seed)),
  );
  const seedMismatch = found.length > 0 && seeds.length > 0 && !seedMatch;
  const ingredient = found.length > 0;
  const form = formPattern.test(text);
  const commercial = supplementPattern.test(text) || purchasePattern.test(text);
  const information = informationPattern.test(text);
  const brand = brandPattern.test(text);
  const audience = audiencePattern.test(text);
  const dose = dosePattern.test(text);
  const excluded =
    excludedPattern.test(text) ||
    /\bomega\b.*\b(?:constellation|de ville|planet ocean)\b/.test(text);
  const service = servicePattern.test(text);
  const offTopic = excluded || service;
  const ambiguous = /\bomega\b/.test(text) && !ingredient;
  const broadFishOil =
    found.length === 1 && found.includes('fish-oil') && !(form && dose);
  const broadCategory = !ingredient && supplementPattern.test(text);
  const bareIngredient = ingredient && !form && !dose && !audience;
  const tags: string[] = [];
  if (ingredient && !offTopic) tags.push('成分词');
  if (form && ingredient && !offTopic) tags.push('剂型词');
  if ((ingredient || broadCategory) && !offTopic) tags.push('商品需求词');
  if (audience) tags.push('人群词');
  if (brand) tags.push('品牌导航词');
  if (information) tags.push('内容研究词');
  if (seedMatch && !offTopic) tags.push('种子成分匹配');
  if (seedMismatch && !offTopic) tags.push('偏离种子成分');

  let relevance = 20;
  let product = 10;
  let scoreCap = 49;
  let evidence =
    '关键词自身缺少可识别的保健品成分依据，分类标签与种子词不作为相关性证明；总分最高49';
  if (ingredient) {
    relevance = Math.min(
      100,
      75 +
        (form ? 15 : 0) +
        (dose ? 5 : 0) +
        (audience ? 5 : 0) +
        (seedMatch ? 5 : 0),
    );
    product = Math.min(
      100,
      55 +
        (form ? 25 : 0) +
        (commercial ? 10 : 0) +
        (dose ? 10 : 0) +
        (audience ? 5 : 0),
    );
    scoreCap = bareIngredient ? 69 : 100;
    evidence = `关键词自身识别到保健品成分${form ? '、剂型' : ''}${dose ? '、剂量' : ''}${audience ? '、适用人群' : ''}${seedMatch ? '；与种子成分匹配' : ''}${bareIngredient ? '；成分短词缺少具体商品限定，总分最高69' : ''}`;
  }
  if (broadFishOil || broadCategory) {
    relevance = broadFishOil ? 55 : 40;
    product = broadFishOil ? 40 : 25;
    scoreCap = broadFishOil ? 59 : 49;
    tags.push('泛词降权');
    evidence = `${broadFishOil ? '鱼油类泛词，未明确Omega-3/EPA/DHA或剂型与剂量组合' : '保健品类目泛词，未明确具体成分'}；总分最高${scoreCap}`;
  }
  if (seedMismatch) {
    relevance = Math.min(relevance, 45);
    scoreCap = Math.min(scoreCap, 59);
    evidence += '；关键词成分与种子成分不匹配，总分最高59';
  }
  if (information && !offTopic) {
    scoreCap = Math.min(scoreCap, 64);
    evidence += '；信息查询用于内容研究，总分最高64';
  }
  if (ambiguous && !offTopic) {
    relevance = 15;
    product = 10;
    scoreCap = 39;
    tags.push('同名歧义待核验');
    evidence = '单独Omega不能证明是Omega-3保健品；需明确成分表达，总分最高39';
  }
  if (offTopic) {
    relevance = excluded ? 0 : 10;
    product = excluded ? 0 : 10;
    scoreCap = excluded ? 19 : 39;
    tags.push('非商品需求', ...(excluded ? ['非保健品类目'] : []));
    evidence = `${excluded ? '命中手表、汽车、宠物或外用护肤等非目标类目' : '命中医疗服务、招聘或媒体等非商品表达'}；种子与分类不能抵消，总分最高${scoreCap}`;
  }
  return { relevance, product, scoreCap, evidence, tags, offTopic, brand };
}

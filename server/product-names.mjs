// Local reading references only. Saved names win and unknown proper nouns stay intact.
const ingredients = {
  'dihydromyricetin (dhm)': '二氢杨梅素 (DHM)',
  'dihydromyricetin dhm': '二氢杨梅素 (DHM)',
  dihydromyricetin: '二氢杨梅素',
  'cissus quadrangularis': '四棱白粉藤',
  'huperzine a': '石杉碱甲',
  'nootropic stack': '促智配方组合',
  'alpha gpc': '甘油磷酸胆碱',
  'alpha-gpc': '甘油磷酸胆碱',
  uridine: '尿苷',
  dhea: '脱氢表雄酮',
  dhm: '二氢杨梅素 (DHM)',
  'magnesium glycinate': '甘氨酸镁',
  'magnesium citrate': '柠檬酸镁',
  'creatine monohydrate': '一水肌酸',
  'apple cider vinegar': '苹果醋',
  'fish oil': '鱼油',
  'omega 3': 'Omega-3脂肪酸',
  'omega-3': 'Omega-3脂肪酸',
  'vitamin d3': '维生素D3',
  'vitamin b12': '维生素B12',
  'vitamin c': '维生素C',
  'vitamin d': '维生素D',
  'protein powder': '蛋白粉',
  'whey protein': '乳清蛋白',
  'l-theanine': 'L-茶氨酸',
  'n-acetyl cysteine': 'N-乙酰半胱氨酸',
  'n-acetyl-l-cysteine': 'N-乙酰半胱氨酸',
  creatine: '肌酸',
  magnesium: '镁',
  collagen: '胶原蛋白',
  probiotics: '益生菌',
  prebiotics: '益生元',
  melatonin: '褪黑素',
  ashwagandha: '南非醉茄',
  berberine: '小檗碱',
  turmeric: '姜黄',
  curcumin: '姜黄素',
  multivitamins: '复合维生素',
  multivitamin: '复合维生素',
  electrolytes: '电解质',
  electrolyte: '电解质',
  protein: '蛋白质',
  zinc: '锌',
  iron: '铁',
  calcium: '钙',
  fiber: '膳食纤维',
  psyllium: '洋车前子',
  coq10: '辅酶Q10',
};
const descriptors = {
  'dietary supplements': '膳食补充剂',
  'dietary supplement': '膳食补充剂',
  supplements: '补充剂',
  supplement: '补充剂',
  extracts: '提取物',
  extract: '提取物',
  softgels: '软胶囊',
  capsules: '胶囊',
  capsule: '胶囊',
  tablets: '片剂',
  tablet: '片剂',
  gummies: '软糖',
  gummy: '软糖',
  powder: '粉剂',
  drops: '滴剂',
  liquid: '液体',
};
const escape = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
function glossaryPattern(glossary) {
  const terms = Object.keys(glossary)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms})(?![\\p{L}\\p{N}])`, 'giu');
}
const ingredientPattern = glossaryPattern(ingredients);
const descriptorPattern = glossaryPattern(descriptors);

export function productChineseName(record) {
  if (typeof record?.titleZh === 'string' && record.titleZh.trim())
    return record.titleZh.trim();
  if (typeof record?.title !== 'string' || !record.title.trim()) return '';
  const title = record.title.trim();
  const brand = typeof record.brand === 'string' ? record.brand.trim() : '';
  const parts = brand ? title.split(new RegExp(`(${escape(brand)})`, 'giu')) : [title];
  let matched = false;
  const translated = parts.map((part, index) => {
    if (brand && index % 2) return part;
    return part.replace(ingredientPattern, (word) => {
      matched = true;
      return ingredients[word.toLowerCase()];
    });
  });
  // A generic word such as "Supplement" does not translate an unknown ingredient.
  if (!matched) return /\p{Script=Han}/u.test(title) ? title : '';
  return translated
    .map((part, index) => brand && index % 2 ? part : part.replace(descriptorPattern, (word) => descriptors[word.toLowerCase()]))
    .join('')
    .replaceAll(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1');
}

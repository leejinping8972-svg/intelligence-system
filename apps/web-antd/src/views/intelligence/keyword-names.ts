import type { Keyword } from './data';

// A local reading aid, not a claim that an unknown brand/proper noun was translated.
// Explicit saved translations take precedence; browsing never calls a paid model.
const glossary: Record<string, string> = {
  'magnesium glycinate': '甘氨酸镁',
  'magnesium citrate': '柠檬酸镁',
  'creatine monohydrate': '一水肌酸',
  'fish oil': '鱼油',
  'omega 3': 'Omega-3',
  'omega-3': 'Omega-3',
  'side effects': '副作用',
  'sugar free': '无糖',
  'sugar-free': '无糖',
  'no sugar': '无糖',
  'weight loss': '体重管理',
  'apple cider vinegar': '苹果醋',
  'vitamin d3': '维生素D3',
  'vitamin c': '维生素C',
  'vitamin d': '维生素D',
  'vitamin b12': '维生素B12',
  'for women': '适用于女性',
  'for men': '适用于男性',
  'for kids': '适用于儿童',
  'for sleep': '用于睡眠',
  'for anxiety': '用于焦虑相关搜索',
  'gut health': '肠道健康',
  'protein powder': '蛋白粉',
  electrolyte: '电解质',
  electrolytes: '电解质',
  'dietary supplement': '膳食补充剂',
  'dietary supplements': '膳食补充剂',
  'nsf certified': 'NSF认证',
  'third party tested': '第三方检测',
  creatine: '肌酸',
  creatina: '肌酸',
  magnesium: '镁',
  magnesio: '镁',
  magie: '镁',
  gummies: '软糖',
  gummy: '软糖',
  gomitas: '软糖',
  'kẹo dẻo': '软糖',
  capsules: '胶囊',
  capsule: '胶囊',
  tablets: '片剂',
  tablet: '片剂',
  powder: '粉剂',
  pills: '丸剂',
  liquid: '液体',
  drops: '滴剂',
  collagen: '胶原蛋白',
  colágeno: '胶原蛋白',
  probiotics: '益生菌',
  prebiotics: '益生元',
  melatonin: '褪黑素',
  ashwagandha: '南非醉茄',
  berberine: '小檗碱',
  turmeric: '姜黄',
  curcumin: '姜黄素',
  multivitamin: '复合维生素',
  multivitamins: '复合维生素',
  protein: '蛋白质',
  whey: '乳清',
  zinc: '锌',
  iron: '铁',
  calcium: '钙',
  fiber: '膳食纤维',
  psyllium: '洋车前子',
  coq10: '辅酶Q10',
  vegan: '纯素',
  organic: '有机',
  benefits: '作用相关信息',
  dosage: '用量',
  reviews: '评价',
  review: '评价',
  best: '最佳',
  vs: '对比',
  versus: '对比',
  sleep: '睡眠',
  women: '女性',
  men: '男性',
  kids: '儿童',
};
const escape = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const patterns = Object.entries(glossary)
  .toSorted((a, b) => b[0].length - a[0].length)
  .map(
    ([word, name]) =>
      [
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`,
          'giu',
        ),
        name,
      ] as const,
  );
export function keywordChineseName(record: Pick<Keyword, 'term' | 'termZh'>) {
  if (record.termZh?.trim()) return record.termZh.trim();
  let text = record.term.normalize('NFKC').trim();
  if (/^what is (.+) good for\??$/i.test(text))
    text = text.replace(/^what is (.+) good for\??$/i, '$1 有什么作用');
  else if (/^how much (.+) should i take\??$/i.test(text))
    text = text.replace(/^how much (.+) should i take\??$/i, '$1 应摄入多少');
  for (const [pattern, name] of patterns) text = text.replace(pattern, name);
  return /[\p{Script=Han}]/u.test(text)
    ? text.replaceAll(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    : '';
}

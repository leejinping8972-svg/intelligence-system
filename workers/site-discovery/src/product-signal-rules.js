export function signalText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

export function signalKey(value) {
  return signalText(value)
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const BOILERPLATE =
  /not (?:been )?evaluated|food and drug administration|not intended to diagnose|diagnose.{0,30}treat.{0,30}cure|consult (?:your |a )?(?:physician|doctor|healthcare)|keep out of reach|if you are (?:pregnant|nursing)|all rights reserved|privacy policy|shipping|add to cart|subscribe|suggested (?:use|usage)|directions for use|daily value|servings? (?:size|per)|warning|disclaimer|advertencia|no (?:ha sido|está) evaluad|no est[aá] destinado|consulte.{0,25}(?:m[eé]dico|profesional)|không phải là thuốc|không có tác dụng thay thế thuốc|tham khảo ý kiến|免责声明|未经.{0,12}(?:评估|评价)|不用于.{0,12}(?:诊断|治疗)|请咨询|注意事项|用法用量|每日参考值/i;

export function benefitSignal(value) {
  const text = signalText(value);
  const minimum = /[\p{Script=Han}]/u.test(text) ? 2 : 4;
  if (text.length < minimum || text.length > 240 || BOILERPLATE.test(text)) return '';
  if (
    /^(?:ingredients?|supplement facts?|nutrition facts?|benefits?|description|product details?|learn more|shop now|成分|营养成分表|商品详情)[\s:：.!*]*$/i.test(
      text,
    )
  )
    return '';
  return text;
}

// Allergen exclusions and marketing badges are not positive formula entries.
export function ingredientSection(value) {
  return signalText(value)
    .split(
      /\b(?:free (?:of|from)|does not contain|contains no|allergen(?:s| information)?|warnings?|suggested (?:use|usage))\s*[:：]?|不含[:：]?|无添加[:：]?/i,
    )[0]
    .trim();
}

export function ingredientSignal(value, context = '') {
  const text = signalText(value);
  const key = signalKey(text);
  if (text.length < 2 || text.length > 120 || BOILERPLATE.test(text)) return '';
  if (
    /\b(?:non[ -]?gmo|gmo[ -]?free|(?:gluten|dairy|sugar|soy|wheat|lactose|allergen)[ -]?free|free (?:from|of)|no added|without|does not contain|contains no|certified|vegan|vegetarian|kosher|halal)\b|非转基因|不含|无麸质|无乳糖|无添加|纯素/i.test(
      text,
    )
  )
    return '';
  if (
    /\b(?:non gmo|gmo free|(?:gluten|dairy|sugar|soy|wheat|lactose|allergen) free)\b/.test(
      key,
    )
  )
    return '';
  if (
    /^(?:ingredients?|other ingredients?|supplement facts?|nutrition facts?|未知|待识别|官网未公开|平台未返回|n\/?a|none)$/i.test(
      text,
    )
  )
    return '';
  if (
    /\b(?:supports?|promotes?|helps?|take|capsules? daily|tablets? daily)\b/i.test(
      text,
    )
  )
    return '';
  const source = signalText(context);
  const positive = ingredientSection(source);
  if (positive !== source && !signalKey(positive).includes(key)) return '';
  const sourceParts = source
    .split(/[,;:.。；\n]/)
    .map((part) => ` ${signalKey(part)} `);
  if (
    sourceParts.some(
      (part) =>
        part.includes(` ${key} free `) ||
        part.includes(` without ${key} `) ||
        part.includes(` no ${key} `),
    )
  )
    return '';
  return text;
}

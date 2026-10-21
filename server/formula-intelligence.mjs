import { createHash } from 'node:crypto';

const UNKNOWN = /^(?:未知|待识别|官网未公开|平台未返回|n\/?a|none)/i;
const ALIASES = new Map([
  ['ascorbic acid', 'Vitamin C'],
  ['ashwagandha', 'Ashwagandha'],
  ['coenzyme q10', 'CoQ10'],
  ['coq10', 'CoQ10'],
  ['creatine', 'Creatine'],
  ['creatine monohydrate', 'Creatine Monohydrate'],
  ['l-ascorbic acid', 'Vitamin C'],
  ['magnesium glycinate', 'Magnesium Glycinate'],
  ['omega 3', 'Omega-3'],
  ['omega-3', 'Omega-3'],
  ['vitamin c', 'Vitamin C'],
  ['withania somnifera', 'Ashwagandha'],
]);

function clean(value) {
  return String(value || '')
    .normalize('NFKC')
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

export function normalizeIngredientName(value) {
  const raw = clean(value)
    .replace(/^(?:ingredients?|ingredientes|成分|配方)\s*[:：]\s*/i, '')
    .replace(/^\d+(?:\.\d+)?\s*(?:mg|g|mcg|µg|ug|iu|ml)\b\s*/i, '')
    .replaceAll(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s*[-–—:]\s*\d+(?:\.\d+)?\s*(?:mg|g|mcg|µg|ug|iu|ml).*$/i, '')
    .replaceAll(/\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|µg|ug|iu|ml)\b/gi, '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[.\-–—:]+$/g, '')
    .trim();
  if (!raw || UNKNOWN.test(raw)) return '';
  const key = raw
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return ALIASES.get(key) || raw.slice(0, 120);
}

export function parseFormulaIngredients(product) {
  const source = [
    ...(product.ingredientInsights || []).map((item) =>
      [item.name, item.amount].filter(Boolean).join(' '),
    ),
    product.ingredient,
  ]
    .map((value) => clean(value))
    .filter((value) => value && !UNKNOWN.test(value));
  const entries = [];
  for (const part of source.flatMap((value) =>
    value.split(/\r?\n|[,;；•·|]/).map((part) => clean(part)),
  )) {
    const amount = part.match(
      /(?:^|\s)(\d+(?:\.\d+)?)\s*(mg|g|mcg|µg|ug|iu|ml)\b/i,
    );
    const name = normalizeIngredientName(part);
    if (!name) continue;
    const key = name.toLowerCase();
    if (entries.some((item) => item.name.toLowerCase() === key)) continue;
    entries.push({
      name,
      amount: amount ? `${amount[1]} ${amount[2].replace('ug', 'µg')}` : '',
      raw: part.slice(0, 300),
    });
    if (entries.length >= 30) break;
  }
  return entries;
}

export function withFormulaIntelligence(product) {
  const ingredients = parseFormulaIngredients(product);
  const normalizedNames = ingredients
    .map((item) => item.name.toLowerCase())
    .toSorted();
  const fingerprint =
    normalizedNames.length > 0
      ? createHash('sha256')
          .update(normalizedNames.join('|'))
          .digest('hex')
          .slice(0, 20)
      : '';
  let status = 'unknown';
  if (ingredients.length > 0) status = product.reviewed ? 'verified' : 'observed';
  return {
    ...product,
    formula: {
      status,
      ingredients,
      fingerprint,
      evidenceUrl: product.evidenceUrl || product.sourceUrl || '',
      collectedAt: product.lastCollectedAt || new Date().toISOString(),
    },
  };
}

export function summarizeFormulas(products) {
  const groups = new Map();
  for (const product of products) {
    const formula = product.formula || withFormulaIntelligence(product).formula;
    if (!formula.fingerprint || formula.ingredients.length === 0) continue;
    const current = groups.get(formula.fingerprint) || {
      fingerprint: formula.fingerprint,
      ingredients: formula.ingredients.map((item) => item.name),
      productIds: [],
      brands: new Set(),
      markets: new Set(),
      verified: 0,
      demandSignals: 0,
    };
    current.productIds.push(product.id);
    current.brands.add(product.brand);
    current.markets.add(product.market);
    if (formula.status === 'verified') current.verified++;
    current.demandSignals +=
      Number(product.sourceMetrics?.monthlySales || 0) +
      Number(product.sourceMetrics?.reportedSales || 0) +
      Math.log10(1 + Number(product.sourceMetrics?.reviewCount || 0)) * 10;
    groups.set(formula.fingerprint, current);
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      brands: [...item.brands],
      markets: [...item.markets],
      productCount: item.productIds.length,
      hotScore: Math.round(
        item.productIds.length * 20 +
          item.brands.size * 10 +
          Math.min(50, Math.log10(1 + item.demandSignals) * 15),
      ),
    }))
    .toSorted(
      (a, b) => b.hotScore - a.hotScore || b.productCount - a.productCount,
    );
}

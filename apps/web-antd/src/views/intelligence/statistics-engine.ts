import type { DemoState, Product } from './data';
import type { RadarFinding } from './radar-engine';

const marketName = (market: string) => ({ US: '美国', MX: '墨西哥', VN: '越南' } as Record<string, string>)[market] || market;
export interface OpportunityRow { id: string; title: string; count: number; description: string }
export function opportunityRows(state: Pick<DemoState, 'keywords' | 'products' | 'sites'>, tab: string): OpportunityRow[] {
  const counts = new Map<string, number>();
  for (const p of state.products) counts.set(p.siteId, (counts.get(p.siteId) || 0) + 1);
  if (tab === 'keyword') return state.keywords.filter(k => (k.growth || 0) > 20).map(k => ({ id: k.id, title: `${k.term} · ${k.market}`, count: 1, description: `${k.category} · 同市场趋势上升信号，仍需独立来源验证。` }));
  if (tab === 'site') return state.sites.map(s => ({ id: s.id, title: s.brand, count: counts.get(s.id) || 0, description: `${marketName(s.market)} · 目前只有首次样本，尚不能确认持续成长。` }));
  if (tab === 'new') return state.products.map(p => ({ id: p.id, title: p.title, count: 1, description: `${p.brand} · ${marketName(p.market)} · 新发现不等于新上市。` }));
  const groups = new Map<string, number>();
  for (const p of state.products) {
    const key = (tab === 'ingredient' ? p.ingredient : tab === 'claim' ? p.claim : p.category) || '待补充';
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups].map(([title, count]) => ({ id: title, title, count, description: tab === 'claim' ? '竞品文案表达，不能据此认定科学功效。' : '已整理关联商品样本，建议补充趋势、配方与市场反馈。' })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

export function formulaOf(product: Product) {
  if (product.formula?.fingerprint) return product.formula;
  const ingredients = (product.ingredientInsights || []).map(item => item.name.trim()).filter(Boolean).map(name => ({ name, amount: '', raw: name }));
  return { status: ingredients.length ? product.reviewed ? 'verified' : 'observed' : 'unknown', fingerprint: [...new Set(ingredients.map(item => item.name.toLowerCase()))].sort().join('|'), ingredients };
}
export interface FormulaRow { id: string; key: string; ingredients: string[]; brands: string[]; markets: string[]; products: number; verified: number; score: number }
export function formulaStatistics(products: Product[]) {
  const groups = new Map<string, { ingredients: string[]; products: number; brands: Set<string>; markets: Set<string>; verified: number; signal: number }>();
  let observed = 0;
  let verified = 0;
  for (const product of products) {
    const formula = formulaOf(product);
    if (!formula.fingerprint || formula.status === 'unknown') continue;
    observed++;
    if (formula.status === 'verified') verified++;
    const item = groups.get(formula.fingerprint) || { ingredients: formula.ingredients.map(i => i.name), products: 0, brands: new Set<string>(), markets: new Set<string>(), verified: 0, signal: 0 };
    item.products++;
    item.brands.add(product.brand);
    item.markets.add(product.market);
    if (formula.status === 'verified') item.verified++;
    // Sales with unknown periods are not comparable; use review counts as a secondary signal.
    item.signal += Math.log10(1 + Math.max(0, Number(product.sourceMetrics?.reviewCount) || 0)) * 10;
    groups.set(formula.fingerprint, item);
  }
  const rows: FormulaRow[] = [...groups].map(([key, item]) => ({ id: key, key, ingredients: item.ingredients, brands: [...item.brands], markets: [...item.markets], products: item.products, verified: item.verified, score: Math.round(item.products * 20 + item.brands.size * 10 + Math.min(50, Math.log10(1 + item.signal) * 15)) })).sort((a, b) => b.score - a.score || b.products - a.products || a.id.localeCompare(b.id));
  return { rows, coverage: { total: products.length, observed, verified, percent: products.length ? Math.round(observed / products.length * 100) : 0 } };
}

export function radarStatistics(findings: RadarFinding[]) {
  const counts = { ad: 0, product: 0, concept: 0, ingredient: 0, verified: 0 };
  const activity: Record<string, Record<string, number>> = {};
  let confirmedProducts = 0;
  let scored = 0;
  let sum = 0;
  for (const item of findings) {
    counts[item.type]++;
    if (item.type === 'product' && item.status === 'confirmed') confirmedProducts++;
    if (item.confidenceScore >= 70) counts.verified++;
    if (item.businessScore !== null) { sum += item.businessScore; scored++; }
    const day = item.firstSeenAt.slice(0, 10);
    activity[day] ||= {};
    activity[day][item.type] = (activity[day][item.type] || 0) + 1;
  }
  return { counts, confirmedProducts, scored, averageScore: scored ? Math.round(sum / scored) : null, activity };
}

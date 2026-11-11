import { createApp } from 'vue';
import { describe, expect, it } from 'vitest';

import ProductText from '../components/ProductText.vue';
import { opportunityChineseName, opportunityOriginalNote } from '../opportunity-text';

describe('opportunity bilingual source handling', () => {
  it('fills old snapshots locally, prioritizes saved names and preserves unknown brands', () => {
    expect(opportunityChineseName('l theanine supplement · US', undefined, 'keyword')).toBe('L-茶氨酸补充剂 · 美国');
    expect(opportunityChineseName('dầu cá omega 3 · VN', '人工译名', 'keyword')).toBe('人工译名');
    expect(opportunityChineseName('Protein Powder', undefined, 'concept')).toBe('蛋白粉');
    expect(opportunityChineseName('Fish Oil', undefined, 'site')).toBe('');
    expect(opportunityChineseName('UnknownProperName', undefined, 'concept')).toBe('');
    expect(opportunityChineseName('平台未返回可核验配方（待AI分析）', undefined, 'ingredient')).toBe('');
  });
  it('labels Chinese source text and missing evidence without inventing English originals', () => {
    expect(opportunityOriginalNote('胶原蛋白', '胶原蛋白')).toBe('来源原文（中文）：胶原蛋白');
    expect(opportunityOriginalNote('胶原蛋白')).toBe('来源原文（中文）：胶原蛋白');
    expect(opportunityOriginalNote('Collagen', '胶原蛋白')).toBeUndefined();
    for (const title of ['待补充', '平台未返回可核验配方（待AI分析）', '官网未公开可验证配方'])
      expect(opportunityOriginalNote(title, title)).toBe('暂无来源原文');
  });
  it('renders the explicit source line as text and keeps other ProductText uses unchanged', () => {
    for (const [props, expected] of [
      [{ text: '胶原蛋白', translated: '胶原蛋白', originalNote: opportunityOriginalNote('胶原蛋白', '胶原蛋白') }, '来源原文（中文）：胶原蛋白'],
      [{ text: '胶原蛋白', translated: '胶原蛋白' }, undefined],
      [{ text: '<img src=x>', translated: '中文', originalNote: '<script>来源</script>' }, '<script>来源</script>'],
    ] as const) {
      const host = document.createElement('div');
      const app = createApp(ProductText, props);
      app.mount(host);
      expect(host.querySelector('.product-text-original')?.textContent).toBe(expected);
      expect(host.querySelector('script, img')).toBeNull();
      app.unmount();
    }
  });
});

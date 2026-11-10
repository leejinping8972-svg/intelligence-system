import { createApp, h, nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import ProductAsin from '../components/ProductAsin.vue';
import ProductMerchant from '../components/ProductMerchant.vue';
import ProductWatchChart from '../components/ProductWatchChart.vue';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  document.body.replaceChildren();
});
async function mount(
  component: Parameters<typeof createApp>[0],
  props: Record<string, unknown>,
) {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(component, props);
  apps.push(app);
  app.mount(host);
  await nextTick();
  return host;
}

describe('product seller and Amazon links', () => {
  it('separates seller and brand, escapes names and labels missing seller', async () => {
    const host = await mount(ProductMerchant, {
      product: {
        sourcePlatform: 'Amazon',
        brand: 'Brand A',
        sellerName: '<img src=x> Seller B',
      },
    });
    expect(host.textContent).toContain('卖家：<img src=x> Seller B');
    expect(host.textContent).toContain('品牌：Brand A');
    expect(host.querySelector('img')).toBeNull();
    const missing = await mount(ProductMerchant, {
      product: { sourcePlatform: 'Amazon', brand: 'Brand A' },
    });
    expect(missing.textContent).toContain('卖家：未返回');
  });
  it('opens source-market Amazon ASIN in a new tab without bubbling row clicks', async () => {
    const host = await mount(ProductAsin, {
      product: {
        sourcePlatform: 'Amazon',
        sourceProductId: 'B000000001',
        market: 'VN',
        sourceMarket: 'MX',
      },
    });
    let rowClicks = 0;
    host.addEventListener('click', () => {
      rowClicks += 1;
    });
    const link = host.querySelector('a');
    if (!link) throw new Error('Expected ASIN link');
    expect(link.href).toBe('https://www.amazon.com.mx/dp/B000000001');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rowClicks).toBe(0);
    const missing = await mount(ProductAsin, {
      product: { sourcePlatform: 'Amazon' },
    });
    expect(missing.querySelector('a')).toBeNull();
  });
});

describe('watch chart point tooltip', () => {
  it('immediately shows date and exact value on hover, including zero and partial state', async () => {
    const host = await mount(ProductWatchChart, {
      metricLabel: 'Sorftime每日销量',
      points: [
        { date: '2026-11-01', value: 0 },
        { date: '2026-11-02', value: null },
        { date: '2026-11-03', value: 6, partial: true },
      ],
    });
    const dots = host.querySelectorAll('.trend-point');
    expect(dots).toHaveLength(2);
    expect(host.querySelectorAll('line')).toHaveLength(0);
    dots[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      '2026-11-01Sorftime每日销量：0',
    );
    dots[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    const tooltipText = host.querySelector('[role="tooltip"]')?.textContent;
    expect(tooltipText).toContain('2026-11-03');
    expect(tooltipText).toContain('Sorftime每日销量：6');
    expect(tooltipText).toContain('可能未完整');
    dots[1]?.dispatchEvent(new MouseEvent('mouseleave'));
    await nextTick();
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });
  it('shows price currency and decimals on keyboard focus, and clears when metric changes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const props = reactive({
      metricLabel: '价格（USD）',
      points: [{ date: '2026-11-10', value: 35.99 }],
    });
    const app = createApp({ render: () => h(ProductWatchChart, props) });
    apps.push(app);
    app.mount(host);
    host.querySelector('.trend-point')?.dispatchEvent(new FocusEvent('focus'));
    await nextTick();
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      '价格（USD）：35.99',
    );
    props.metricLabel = '来源月销量快照';
    await nextTick();
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });
});

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
  it('opens seller business details with line breaks and a safe source-market profile link', async () => {
    const host = await mount(ProductMerchant, {
      product: {
        sourcePlatform: 'Amazon',
        sourceProductId: 'B000000001',
        market: 'MX',
        sourceMarket: 'US',
        brand: 'Brand A',
        sellerName: 'Store B',
        sellerId: 'A1234567890123',
        sellerDetails: {
          status: 'available',
          sellerName: 'Store B',
          sellerId: 'A1234567890123',
          market: 'US',
          businessName: '<img src=x> 佛山市示例商贸有限公司',
          businessAddress: ['文昌路118号', '佛山市', '广东省', '528000', 'CN'],
          collectedAt: '2026-11-10T03:00:00Z',
          provider: 'Sorftime',
          lookup: 'id',
        },
      },
    });
    let rowClicks = 0;
    host.addEventListener('click', () => {
      rowClicks += 1;
    });
    host.querySelector('button')?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rowClicks).toBe(0);
    const details = document.body.querySelector('.seller-details');
    expect(details?.textContent).toContain('<img src=x> 佛山市示例商贸有限公司');
    expect(details?.querySelector('img')).toBeNull();
    expect(details?.querySelector('.seller-address')?.textContent).toBe(
      '文昌路118号\n佛山市\n广东省\n528000\nCN',
    );
    const link = details?.querySelector('a');
    expect(link?.href).toBe('https://www.amazon.com/sp?seller=A1234567890123');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
  });
  it('shows honest missing seller details without making a source request on click', async () => {
    const host = await mount(ProductMerchant, {
      product: {
        sourcePlatform: 'Amazon',
        sellerName: 'Store C',
        brand: 'Brand A',
      },
    });
    host.querySelector('button')?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const details = document.body.querySelector('.seller-details');
    expect(details?.textContent).toContain('尚未获取企业资料');
    expect(details?.querySelector('a')).toBeNull();
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

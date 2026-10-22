/* eslint-disable vue/one-component-per-file -- Multiple small app fixtures exercise the shared control. */
import type { PropType } from 'vue';

import type { Keyword, Product, Site } from '../data';
import type { ContentItem } from '../public-content';

import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MarketSwitcher from '../components/MarketSwitcher.vue';
import PageHeader from '../components/PageHeader.vue';
import { filteredKeywords, filteredProducts, filteredSites, inMarket, state } from '../data';
import { contentInMarket } from '../public-content';

// Keep the actual shared state and router. A native select only replaces AntD's
// popup rendering so these tests exercise the user's market/navigation action.
vi.mock('ant-design-vue', () => ({
  Select: defineComponent({
    props: {
      value: { type: String, default: '' },
      options: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
    },
    emits: ['change'],
    setup(props, { emit }) {
      return () => h('select', {
        value: props.value,
        onChange: (event: Event) => emit('change', (event.target as HTMLSelectElement).value),
      }, props.options.map((option: { label: string; value: string }) =>
        h('option', { value: option.value }, option.label)));
    },
  }),
}));
vi.mock('../cloud-workspace', () => ({
  cloudWorkspace: { error: '' },
  setWorkspaceReadMode: vi.fn(),
  startCloudSync: vi.fn(),
}));

const apps: ReturnType<typeof createApp>[] = [];
beforeEach(() => {
  state.market = 'US';
  state.keywords = ['US', 'MX', 'VN'].map((market) => ({ id: market, market }) as Keyword);
  state.products = ['US', 'MX', 'VN'].map((market) => ({ id: market, market }) as Product);
  state.sites = ['US', 'MX', 'VN'].map((market) => ({ id: market, market }) as Site);
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

async function mount(path = '/research', header = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  });
  await router.push(path);
  const host = document.createElement('div');
  document.body.append(host);
  const app = header
    ? createApp(PageHeader, { title: '资源市场', description: '' })
    : createApp(MarketSwitcher);
  apps.push(app);
  app.use(router).mount(host);
  const picker = host.querySelector('select');
  if (!picker) throw new Error('Missing market picker');
  const select: HTMLSelectElement = picker;
  async function choose(value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(state.market).toBe(value));
    await nextTick();
  }
  return { router, select, choose };
}

describe('resource markets', () => {
  it('shows the common market picker when showMarket is omitted', async () => {
    const { select, choose } = await mount('/research', true);
    expect(select.options).toHaveLength(4);
    await choose('MX');
    expect(filteredKeywords.value.map((item) => item.id)).toEqual(['MX']);
  });

  it('can explicitly hide market controls on non-resource pages', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(PageHeader, { title: '代码提交日志', description: '', showMarket: false });
    apps.push(app);
    app.use(router).mount(host);
    expect(host.querySelector('select')).toBeNull();
  });
  it('switches all shared resource scopes and keeps the choice across navigation', async () => {
    const { router, choose } = await mount();
    for (const market of ['MX', 'VN', 'US', 'ALL']) {
      await choose(market);
      const expected = market === 'ALL' ? ['US', 'MX', 'VN'] : [market];
      expect(filteredKeywords.value.map((item) => item.id)).toEqual(expected);
      expect(filteredProducts.value.map((item) => item.id)).toEqual(expected);
      expect(filteredSites.value.map((item) => item.id)).toEqual(expected);
      expect(['US', 'MX', 'VN'].filter((code) => inMarket(code as 'US'))).toEqual(expected);
    }
    await choose('MX');
    await router.push('/products');
    expect(state.market).toBe('MX');
  });

  it.each([
    ['/sites?keywordId=old&keyword=old&site=old&view=list#details'],
    ['/products?keyword=old&site=old&product=old&view=list#details'],
    ['/ads?keywordId=old&site=old&report=old&view=list#details'],
    ['/trends?keyword=old&term=old&market=US&view=list#details'],
    ['/consumer-insights?keywordId=old&site=old&product=old&report=old&view=list#details'],
  ])('clears old context before changing market: %s', async (path) => {
    const { router, choose } = await mount(path);
    await choose('VN');
    expect(router.currentRoute.value.query).toEqual({ view: 'list' });
    expect(router.currentRoute.value.hash).toBe('#details');
  });

  it('does not discard a valid deep link when selecting the current market', async () => {
    const { router, select } = await mount('/products?site=us-site');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(router.currentRoute.value.query.site).toBe('us-site');
  });

  it('keeps public content tied to its research context, not author origin', () => {
    const item = { searchMarket: 'US', authorCountry: 'MX' } as ContentItem;
    expect(contentInMarket(item, 'US')).toBe(true);
    expect(contentInMarket(item, 'MX')).toBe(false);
    item.searchContexts = [
      { market: 'US', scope: 'global', language: 'en', query: 'fiber' },
      { market: 'VN', scope: 'local', language: 'vi', query: 'fiber' },
    ];
    expect(contentInMarket(item, 'VN')).toBe(true);
    expect(contentInMarket(item, 'MX')).toBe(false);
    expect(contentInMarket(item, 'ALL')).toBe(true);
  });
});

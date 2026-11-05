/* eslint-disable vue/one-component-per-file -- Mount both related query views. */
import type { Keyword } from '../data';

import { createApp, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import KeywordRelatedQueries from '../components/KeywordRelatedQueries.vue';

vi.mock('ant-design-vue', () => ({
  Popover: { template: '<div><slot /><slot name="content" /></div>' },
}));

const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

describe('collected related query translations', () => {
  it('renders saved Chinese top and rising queries with source text without requesting translation', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const keyword = {
      id: 'synthetic',
      term: 'maltitol',
      market: 'US',
      trendRelatedTop: [
        {
          query: 'maltitol powder',
          queryZh: '麦芽糖醇粉',
          value: 100,
          formattedValue: '100',
        },
      ],
      trendRelatedRising: [
        {
          query: '<img src=x>',
          queryZh: '麦芽糖醇软糖',
          value: null,
          formattedValue: '',
          breakout: true,
        },
      ],
    } as Keyword;
    const fallback = vi.fn((text: string) => text);
    const app = createApp(KeywordRelatedQueries, {
      keyword,
      kind: 'relatedTop',
      translate: fallback,
    });
    apps.push(app);
    app.mount(host);
    await nextTick();
    expect(host.textContent).toContain('麦芽糖醇粉');
    expect(host.textContent).toContain('maltitol powder');
    expect(fallback).not.toHaveBeenCalled();
    const risingHost = document.createElement('div');
    document.body.append(risingHost);
    const rising = createApp(KeywordRelatedQueries, {
      keyword,
      kind: 'relatedRising',
      translate: fallback,
    });
    apps.push(rising);
    rising.mount(risingHost);
    await nextTick();
    expect(risingHost.textContent).toContain('麦芽糖醇软糖');
    expect(risingHost.textContent).toContain('飙升');
    expect(risingHost.textContent).toContain('<img src=x>');
    expect(risingHost.querySelector('img')).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
  });
});

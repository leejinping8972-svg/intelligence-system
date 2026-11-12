import type { Ref } from 'vue';

import { createApp, defineComponent, h, nextTick, ref, watch } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { afterEach, describe, expect, it } from 'vitest';

import { useSiteKeywordFilter } from '../site-keyword-filter';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

async function mount(
  start = '/sites?keywordId=rescue&site=buoy&keep=1',
  remembered?: Ref<string>,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/sites', '/other'].map((path) => ({
      path,
      component: { render: () => null },
    })),
  });
  await router.push(start);
  const requests: (string | undefined)[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(
    defineComponent({
      setup() {
        const filter = useSiteKeywordFilter(remembered);
        watch(filter, (value) => requests.push(value || undefined), {
          immediate: true,
        });
        return () =>
          h('div', [
            h(
              'select',
              {
                'aria-label': '关键词',
                value: filter.value,
                onChange: (event: Event) => {
                  filter.value =
                    (event.target as HTMLSelectElement).value || undefined;
                },
              },
              ['', 'rescue', 'other'].map((value) =>
                h('option', { value }, value || '全部关联关键词'),
              ),
            ),
            h(
              'button',
              {
                onClick: () => {
                  filter.value = '';
                },
              },
              '清除关联筛选',
            ),
          ]);
      },
    }),
  );
  apps.push(app);
  app.use(router).mount(host);
  await nextTick();
  return { router, host, requests };
}

describe('site keyword route filter', () => {
  it('restores a remembered dropdown and prioritizes explicit links without clearing it on leaving', async () => {
    const remembered = ref('saved-keyword');
    const { router, host, requests } = await mount('/sites', remembered);
    expect(requests.at(-1)).toBe('saved-keyword');
    await router.push('/sites?keywordId=other');
    await nextTick();
    expect(remembered.value).toBe('other');
    await router.push('/other');
    expect(remembered.value).toBe('other');
    await router.push('/sites');
    await nextTick();
    expect(requests.at(-1)).toBe('other');
    host.querySelector('button')!.click();
    await expect.poll(() => requests.at(-1)).toBeUndefined();
    expect(remembered.value).toBe('');
  });

  it('clears a linked keyword from the dropdown without reviving the URL filter', async () => {
    const { router, host, requests } = await mount();
    const select = host.querySelector('select')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await expect
      .poll(() => router.currentRoute.value.query.keywordId)
      .toBeUndefined();
    expect(requests.at(-1)).toBeUndefined();
    expect(router.currentRoute.value.query).toEqual({
      site: 'buoy',
      keep: '1',
    });
    select.value = 'other';
    select.dispatchEvent(new Event('change'));
    await expect.poll(() => requests.at(-1)).toBe('other');
    expect(router.currentRoute.value.query.keywordId).toBe('other');
  });
  it('clear button and navigation use the same selected filter', async () => {
    const { router, host, requests } = await mount();
    host.querySelector('button')!.click();
    await expect.poll(() => requests.at(-1)).toBeUndefined();
    expect(host.querySelector('select')!.value).toBe('');
    await router.push('/sites?keywordId=other');
    await nextTick();
    expect(host.querySelector('select')!.value).toBe('other');
    router.back();
    await expect.poll(() => host.querySelector('select')!.value).toBe('');
  });
});

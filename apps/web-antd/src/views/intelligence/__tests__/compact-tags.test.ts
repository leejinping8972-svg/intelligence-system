/* eslint-disable vue/one-component-per-file -- Multiple component fixtures test disclosure behavior. */
import { createApp, defineComponent, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import CompactTags from '../components/CompactTags.vue';

vi.mock('ant-design-vue', () => ({
  Tag: defineComponent({
    setup(_props, { slots }) {
      return () => h('span', { class: 'ant-tag' }, slots.default?.());
    },
  }),
}));
const apps: ReturnType<typeof createApp>[] = [];
let resize: (() => void) | undefined;
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: () => void) {
      resize = callback;
    }
    disconnect() {}
    observe() {}
  },
);
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});
async function mount(items: string[]) {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(CompactTags, { items, label: '商品标签' });
  apps.push(app);
  app.mount(host);
  await nextTick();
  return host;
}
describe('compact tags disclosure', () => {
  it('reveals and collapses all overflowing labels through a keyboard-operable button', async () => {
    const labels = Array.from({ length: 30 }, (_, index) => `产品 ${index}`);
    const host = await mount(labels);
    const content = host.querySelector('.hci-tag-summary-content');
    if (!content) throw new Error('missing tags');
    Object.defineProperties(content, {
      scrollHeight: { value: 300 },
      clientHeight: { value: 48 },
    });
    resize?.();
    await nextTick();
    const button = host.querySelector('button');
    if (!button) throw new Error('missing disclosure');
    expect(button.textContent).toContain('30');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    await nextTick();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.is-expanded')).not.toBeNull();
    expect(content.textContent).toContain('产品 29');
    button.click();
    await nextTick();
    expect(host.querySelector('.is-expanded')).toBeNull();
  });
  it('provides disclosure for a single label that is wider than the column', async () => {
    const host = await mount(['完整的长产品名称']);
    const tag = host.querySelector('.ant-tag');
    if (!tag) throw new Error('missing tag');
    Object.defineProperties(tag, {
      scrollWidth: { value: 600 },
      clientWidth: { value: 200 },
    });
    resize?.();
    await nextTick();
    expect(host.querySelector('button')?.textContent).toContain('展开全部');
  });
  it('does not show unnecessary disclosure for short labels', async () => {
    const host = await mount(['软糖', '粉剂']);
    expect(host.querySelector('button')).toBeNull();
  });
});

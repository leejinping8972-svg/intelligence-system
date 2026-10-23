import { createApp, nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import ProductChineseName from '../components/ProductChineseName.vue';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});
async function mount(product: { title: string; titleZh?: string; brand?: string }) {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(ProductChineseName, { product });
  apps.push(app);
  app.mount(host);
  await nextTick();
  return host;
}

describe('product Chinese reference', () => {
  it('labels local references and retains Latin dosage and packaging text', async () => {
    const host = await mount({ title: 'Huperzine A Supplement 200 mcg / 120 Capsules' });
    expect(host.textContent).toBe('中文参考：石杉碱甲补充剂 200 mcg / 120 胶囊');
    expect(host.querySelector('.is-pending')).toBeNull();
  });
  it('shows an explicit pending state for unknown proper names', async () => {
    const host = await mount({ title: 'Mystery Supplement' });
    expect(host.textContent).toBe('中文参考待补充');
    expect(host.querySelector('.is-pending')).not.toBeNull();
  });
  it('honors a saved Chinese reference and treats external titles as text', async () => {
    const host = await mount({ title: '<img src=x onerror=alert(1)>', titleZh: '<script>参考</script>' });
    expect(host.textContent).toBe('中文参考：<script>参考</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
  });
});

<script setup lang="ts">
import type { Ad } from './data';

import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Button,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Select,
  Tag,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import ProductDrawer from './components/ProductDrawer.vue';
import { audit, inMarket, marketName, state } from './data';
const router = useRouter();
const search = ref('');
const platform = ref('ALL');
const selected = ref<Ad>();
const product = ref<string>();
const linkId = ref('');
watch(
  () => state.market,
  () => {
    selected.value = undefined;
    product.value = undefined;
  },
);
const rows = computed(() =>
  state.ads.filter(
    (a) =>
      inMarket(a.market) &&
      `${a.brand} ${a.headline} ${a.copy}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (platform.value === 'ALL' || a.platform === platform.value),
  ),
);
function editLink(a: Ad) {
  selected.value = a;
  linkId.value = a.productId;
}
function save() {
  if (!selected.value) return;
  const p = state.products.find((p) => p.id === linkId.value);
  if (!p) {
    message.error('请选择关联商品');
    return;
  }
  selected.value.productId = p.id;
  audit('修改广告关联', `${selected.value.brand} → ${p.title}`, p.market);
  selected.value = undefined;
  message.success('关联已保存到当前工作区');
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="广告观察"
      description="观察竞品如何表达卖点，将素材线索关联到具体商品。"
    >
      <Button type="primary" @click="router.push('/imports')">
        导入广告资料
      </Button>
    </PageHeader>
    <div class="hci-demo-note">
      <b>导入优先</b>Meta / TikTok
      自动接口尚未接入。当前不预置广告样本，可通过数据导入建立真实广告记录。
    </div>
    <section class="hci-panel">
      <div class="hci-toolbar" style="margin: 0">
        <Input.Search
          v-model:value="search"
          placeholder="搜索品牌、广告文案"
          allow-clear
        /><Select
          v-model:value="platform"
          :options="[
            { label: '全部平台', value: 'ALL' },
            { label: 'Meta', value: 'Meta' },
            { label: 'TikTok', value: 'TikTok' },
          ]"
        /><span class="hci-toolbar-end hci-subtle">{{ rows.length }} 条广告观察</span>
      </div>
    </section>
    <Empty v-if="!rows.length" description="没有符合条件的广告" />
    <div class="hci-product-grid">
      <article v-for="ad in rows" :key="ad.id" class="hci-product-card">
        <div class="hci-ad-creative" :class="[ad.color]">
          <small>{{ ad.brand.toUpperCase() }}</small>
          <h3>{{ ad.headline }}</h3>
          <span class="hci-subtle">{{ ad.format }}素材示意 · DEMO</span>
        </div>
        <div class="hci-product-content">
          <div class="hci-panel-head" style="margin-bottom: 10px">
            <h3>{{ ad.brand }}</h3>
            <Tag>{{ ad.platform }}</Tag>
          </div>
          <p class="hci-subtle">
            {{ marketName(ad.market) }} · {{ ad.status }}
          </p>
          <p style="margin: 15px 0">{{ ad.copy }}</p>
          <div class="hci-product-bottom">
            <button class="hci-link" @click="product = ad.productId">
              {{
                state.products.find((p) => p.id === ad.productId)?.title ||
                '未关联商品'
              }}
</button><button class="hci-link" @click="editLink(ad)">关联</button>
          </div>
        </div>
      </article>
    </div>
    <ProductDrawer :id="product" @close="product = undefined" /><Modal
      :open="!!selected"
      title="关联广告与商品"
      ok-text="保存关联"
      cancel-text="取消"
      @cancel="selected = undefined"
      @ok="save"
    >
      <Form layout="vertical">
        <Form.Item label="关联商品">
          <Select
            v-model:value="linkId"
            show-search
            option-filter-prop="label"
            :options="
              state.products
                .filter((p) => p.market === selected?.market)
                .map((p) => ({ label: `${p.brand} · ${p.title}`, value: p.id }))
            "
          />
        </Form.Item>
      </Form>
      <p class="hci-subtle">
        当前仅展示同市场商品。关联操作将保存到当前工作区。
      </p>
    </Modal>
  </main>
</template>

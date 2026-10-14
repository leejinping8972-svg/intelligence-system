<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Button,
  Checkbox,
  Empty,
  Input,
  message,
  Modal,
  Select,
  Tag,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import ProductArt from './components/ProductArt.vue';
import ProductDrawer from './components/ProductDrawer.vue';
import {
  categories,
  exportCsv,
  filteredProducts,
  marketName,
  money,
  state,
  toggleFavorite,
} from './data';
const route = useRoute();
const router = useRouter();
const search = ref('');
const category = ref('ALL');
const favorites = ref(false);
const benefitFilter = ref('ALL');
const ingredientFilter = ref('ALL');
const selected = ref<string>();
const compareIds = ref<string[]>([]);
const compareOpen = ref(false);
const siteFilter = ref('');
const availableSites = computed(() =>
  state.sites.filter(
    (site) => state.market === 'ALL' || site.market === state.market,
  ),
);
const siteOptions = computed(() => [
  { label: '全部独立站', value: '' },
  ...availableSites.value.map((site) => ({
    label: `${site.brand} · ${site.domain}`,
    value: site.id,
  })),
]);
const linkedKeyword = computed(() =>
  state.keywords.find((item) => item.id === route.query.keyword),
);
const benefitOptions = computed(() => [
  { label: '全部功效卖点', value: 'ALL' },
  ...[
    ...new Set(filteredProducts.value.flatMap((product) => product.benefits)),
  ].map((value) => ({ label: value, value })),
]);
const ingredientOptions = computed(() => [
  { label: '全部成分', value: 'ALL' },
  ...[
    ...new Set(
      filteredProducts.value.flatMap((product) =>
        product.ingredientInsights.map((item) => item.name),
      ),
    ),
  ].map((value) => ({ label: value, value })),
]);
watch(
  () => route.query.site,
  (v) => {
    siteFilter.value = String(v || '');
    const site = state.sites.find((s) => s.id === v);
    if (site) state.market = site.market;
  },
  { immediate: true },
);
watch(
  () => state.market,
  () => {
    selected.value = undefined;
    compareIds.value = [];
    compareOpen.value = false;
    if (
      siteFilter.value &&
      !state.sites.some(
        (s) =>
          s.id === siteFilter.value &&
          (state.market === 'ALL' || s.market === state.market),
      )
    )
      siteFilter.value = '';
  },
);
const rows = computed(() =>
  filteredProducts.value.filter(
    (p) =>
      `${p.title} ${p.brand} ${p.size} ${p.form} ${p.claim} ${p.ingredient} ${p.benefits.join(' ')} ${p.ingredientInsights.map((item) => `${item.name} ${item.role}`).join(' ')} ${state.sites.find((site) => site.id === p.siteId)?.domain || ''} ${state.keywords
        .filter((keyword) => keyword.productIds.includes(p.id))
        .map((keyword) => keyword.term)
        .join(' ')}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (category.value === 'ALL' || p.category === category.value) &&
      (benefitFilter.value === 'ALL' ||
        p.benefits.includes(benefitFilter.value)) &&
      (ingredientFilter.value === 'ALL' ||
        p.ingredientInsights.some(
          (item) => item.name === ingredientFilter.value,
        )) &&
      (!favorites.value || p.favorite) &&
      (!siteFilter.value || p.siteId === siteFilter.value) &&
      (!linkedKeyword.value || linkedKeyword.value.productIds.includes(p.id)),
  ),
);
const comparison = computed(() =>
  state.products.filter((p) => compareIds.value.includes(p.id)),
);
function toggleCompare(id: string) {
  if (compareIds.value.includes(id))
    compareIds.value = compareIds.value.filter((x) => x !== id);
  else if (compareIds.value.length < 3) compareIds.value.push(id);
  else message.info('最多同时对比3个商品');
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="商品情报库"
      description="从配方、规格到市场定位，建立可追溯的商品认知。"
    >
      <Button
        :disabled="!rows.length"
        @click="
          exportCsv(
            '商品库.csv',
            rows.map((p) => ({
              商品: p.title,
              品牌: p.brand,
              国家: p.market,
              规格: p.size,
              价格: p.price,
              币种: p.currency,
              成分: p.ingredient,
              剂量: p.dose,
              功效卖点: p.benefits.join('、'),
              卖点依据: p.benefitEvidence,
              成分分析: p.ingredientInsights
                .map((item) => `${item.name}｜${item.amount}｜${item.role}`)
                .join('；'),
              商品图片: p.imageUrl || '',
              已采集字段: p.collectionFields?.join('、') || '',
              独立站品牌:
                state.sites.find((site) => site.id === p.siteId)?.brand || '',
              独立站域名:
                state.sites.find((site) => site.id === p.siteId)?.domain || '',
              证据网址: p.evidenceUrl || '',
              性质: p.dataNature === 'collected' ? '官网实采' : '演示',
            })),
          )
        "
      >
        导出商品
</Button><Button
        type="primary"
        :disabled="comparison.length < 2"
        @click="compareOpen = true"
      >
        对比商品（{{ comparison.length }}/3）
      </Button>
    </PageHeader>
    <div v-if="linkedKeyword" class="hci-demo-note">
      <b>关键词关联筛选</b>{{ linkedKeyword.term }} · 当前显示
      {{ linkedKeyword.productIds.length }} 个已关联商品。
      <button
        class="hci-link"
        style="margin-left: 12px"
        @click="router.replace('/products')"
      >
        清除关联筛选
      </button>
    </div>
    <section class="hci-panel" style="margin-bottom: 22px">
      <div class="hci-toolbar" style="margin-bottom: 0">
        <Input.Search
          v-model:value="search"
          placeholder="搜索关键词、商品、站点、配方、规格或卖点"
          allow-clear
        /><Select
          v-model:value="category"
          :options="[
            { label: '全部品类', value: 'ALL' },
            ...categories.map((c) => ({ label: c, value: c })),
          ]"
        /><Select
          v-model:value="benefitFilter"
          :options="benefitOptions"
          aria-label="按功效卖点筛选商品"
          style="min-width: 170px"
        /><Select
          v-model:value="ingredientFilter"
          :options="ingredientOptions"
          aria-label="按成分分析筛选商品"
          style="min-width: 190px"
        /><Select
          v-model:value="siteFilter"
          :options="siteOptions"
          aria-label="按独立站筛选商品"
          style="min-width: 230px"
        /><Checkbox v-model:checked="favorites">仅看收藏</Checkbox><span class="hci-toolbar-end hci-subtle">{{ rows.length }} 个商品 · 关联
          {{ new Set(rows.map((p) => p.siteId)).size }} 家独立站</span>
      </div>
    </section>
    <Empty v-if="!rows.length" description="没有符合条件的商品，请调整筛选" />
    <div class="hci-product-grid">
      <article
        v-for="product in rows"
        :key="product.id"
        class="hci-product-card"
      >
        <button
          style="width: 100%"
          @click="selected = product.id"
          :aria-label="`查看${product.title}`"
        >
          <ProductArt
            :color="product.color"
            :brand="product.brand"
            :image-url="product.imageUrl"
            :label="
              product.form === '粉剂'
                ? 'FIBER\nBLEND'
                : product.category === '女性健康'
                  ? 'DAILY\nPROBIOTIC'
                  : 'MINERAL\nBALANCE'
            "
          />
        </button>
        <div class="hci-product-content">
          <div class="hci-product-brand">
            {{ product.brand }} · {{ product.market }}
          </div>
          <button class="hci-product-title" @click="selected = product.id">
            {{ product.title }}
          </button>
          <p class="hci-subtle">{{ product.size }} · {{ product.form }}</p>
          <div class="hci-product-meta">
            <Tag>{{ product.category }}</Tag><Tag :color="product.reviewed ? 'green' : 'orange'">
              {{
                product.reviewed
                  ? '已核验示例'
                  : product.dataNature === 'collected'
                    ? '官网实采 · 待审核'
                    : '待审核'
              }}
            </Tag>
            <Tag v-if="product.collectionFields?.length" color="blue">
              已采集 {{ product.collectionFields.length }}/7 项
            </Tag>
          </div>
          <div class="hci-product-insights">
            <div>
              <span>功效卖点</span>
              <div class="hci-compact-tags">
                <Tag
                  v-for="benefit in product.benefits"
                  :key="benefit"
                  color="green"
                >
                  {{ benefit }}
                </Tag>
                <span v-if="!product.benefits.length" class="hci-subtle">待提取</span>
              </div>
            </div>
            <div>
              <span>成分分析</span>
              <b>{{
                product.ingredientInsights.map((item) => item.name).join(' · ')
              }}</b>
            </div>
          </div>
          <button
            class="hci-product-site"
            @click="
              router.push({ path: '/sites', query: { site: product.siteId } })
            "
          >
            <span>关联独立站</span>
            <b>{{
              state.sites.find((site) => site.id === product.siteId)?.domain
            }}</b>
            <span>查看档案 →</span>
          </button>
          <div class="hci-product-bottom">
            <span class="hci-price">{{
              product.price > 0
                ? money(product.price, product.currency)
                : '价格待获取'
            }}</span><button
              class="hci-favorite"
              :class="[{ active: product.favorite }]"
              :aria-label="`${product.favorite ? '取消收藏' : '收藏'}${product.title}`"
              @click="toggleFavorite(product)"
            >
              {{ product.favorite ? '★' : '☆' }}
            </button>
          </div>
          <div style="margin-top: 14px">
            <Checkbox
              :checked="compareIds.includes(product.id)"
              @change="toggleCompare(product.id)"
            >
              加入对比
            </Checkbox>
          </div>
        </div>
      </article>
    </div>
    <div class="hci-demo-footer">
      <span>原币种价格 · 不同包装与币种不直接排名</span><span>官网实采记录保留证据网址，演示记录继续标注为样本</span>
    </div>
    <ProductDrawer :id="selected" @close="selected = undefined" /><Modal
      v-model:open="compareOpen"
      title="商品对比"
      :width="980"
      :footer="null"
    >
      <div class="hci-demo-note">
        保留原币种与规格；未接入汇率，不计算跨币种价格高低。
      </div>
      <div class="hci-comparison">
        <div v-for="p in comparison" :key="p.id">
          <h3>{{ p.title }}</h3>
          <p>{{ p.brand }} · {{ marketName(p.market) }}</p>
          <p class="hci-price">
            {{ p.price > 0 ? money(p.price, p.currency) : '价格待获取' }}
          </p>
          <p>{{ p.size }}</p>
          <p>{{ p.ingredient }}</p>
          <p>{{ p.dose }}</p>
          <p>{{ p.claim }}（竞品宣称示例）</p>
          <Button size="small" @click="toggleCompare(p.id)">移除对比</Button>
        </div>
      </div>
    </Modal>
  </main>
</template>

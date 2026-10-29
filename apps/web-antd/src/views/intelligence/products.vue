<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  message,
  Modal,
  Pagination,
  Segmented,
  Table,
  Select,
  Tag,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import CollectionTime from './components/CollectionTime.vue';
import { productCollectedAt } from './resource-metadata';
import { compareProductValues, productSortKeys, productSortValue } from '../../../../../server/product-list-sort.mjs';
import CompactTags from './components/CompactTags.vue';
import SelectionBar from './components/SelectionBar.vue';
import { useFilteredSelection } from './resource-list';
import ProductArt from './components/ProductArt.vue';
import ProductDrawer from './components/ProductDrawer.vue';
import ProductChineseName from './components/ProductChineseName.vue';
import ProductResourceEvidence from './components/ProductResourceEvidence.vue';
import { resourceExportRecord } from './product-resources';
import CoreListControls from './components/CoreListControls.vue';
import EvidenceMetric from './components/EvidenceMetric.vue';
import { useCoreList } from './use-core-list';
import { matchesListingRange, recentListingRange } from '../../../../../server/product-listing.mjs';
import { productChineseName } from '../../../../../server/product-names.mjs';
const core = useCoreList('products');
const { preset: corePreset, period: corePeriod } = core;
import ProductDecisionTags from './components/ProductDecisionTags.vue';
import { discoveryDecision, discoveryFilters } from './discovery';
import PlatformProductsDialog from './components/PlatformProductsDialog.vue';
import ProductCompletionDialog from './components/ProductCompletionDialog.vue';
import FormulaInsights from './components/FormulaInsights.vue';
import {
  productDecisions,
  productDecisionFilters,
  PRODUCT_DECISION_RULES,
  productDataSource,
} from './product-decisions';
import type { Product } from './data';
import { serverMode } from './session';
import { useWorkspaceList } from './workspace-queries';
import WorkspaceReadStatus from './components/WorkspaceReadStatus.vue';
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
const listedRange = ref<[string, string] | []>([]);
const listedQuick = ref(0);
function setListedQuick(days: number) {
  listedQuick.value = days;
  listedRange.value = days ? recentListingRange(days) : [];
}
const viewMode = ref<'cards' | 'list'>('list');
const page = ref(1),
  pageSize = ref(20);
const tableSort = ref<{ key: string; order?: 'ascend' | 'descend' }>({ key: '' });
function tableChange(pagination: unknown, filters: unknown, sorter: any) {
  const value = Array.isArray(sorter) ? sorter[0] || {} : sorter;
  tableSort.value = value.order ? { key: String(value.columnKey), order: value.order } : { key: '' };
  page.value = 1;
  remote.tableChange(pagination, filters, value.order ? value : {});
}
const failedImages = ref(new Set<string>());
const category = ref('ALL');
const favorites = ref(false);
const benefitFilter = ref('ALL');
const ingredientFilter = ref('ALL');
const decisionFilter = ref('ALL');
const newness = ref('ALL');
const decisionRulesOpen = ref(false);
const sourceFilter = ref('ALL');
const sourceOptions = computed(() => [
  { label: '全部数据来源', value: 'ALL' },
  ...(serverMode ? remote.facets.value.source || [] : [...new Set(filteredProducts.value.map(productDataSource))]).map(
    (value) => ({ label: value, value }),
  ),
]);
const selected = ref<string>();
const compareIds = ref<string[]>([]);
const compareOpen = ref(false);
const siteFilter = ref('');
const keywordFilter = ref('');
const remote = useWorkspaceList<Product>('products', computed(() => ({
  market: state.market, search: search.value, category: category.value, favorite: favorites.value,
  benefit: benefitFilter.value, ingredient: ingredientFilter.value, decision: decisionFilter.value,
  newness: newness.value, source: sourceFilter.value, siteId: siteFilter.value,
  keywordId: keywordFilter.value || route.query.keyword,
  listedFrom: listedRange.value[0], listedTo: listedRange.value[1],
})), page, pageSize);
const availableSites = computed(() =>
  state.sites.filter(
    (site) => state.market === 'ALL' || site.market === state.market,
  ),
);
const siteOptions = computed(() => [
  { label: '全部独立站', value: '' },
  ...(serverMode ? remote.facets.value.sites || [] : availableSites.value.map((site) => ({
    label: `${site.brand} · ${site.domain}`,
    value: site.id,
  }))),
]);
const keywordOptions = computed(() => [
  { label: '全部关联关键词', value: '' },
  ...(serverMode ? remote.facets.value.keywords || [] : state.keywords
    .filter(
      (keyword) =>
        keyword.productIds.length > 0 &&
        (state.market === 'ALL' || keyword.market === state.market),
    )
    .map((keyword) => ({
      label: `${keyword.term} · ${keyword.market}`,
      value: keyword.id,
    }))),
]);
const linkedKeyword = computed(() =>
  state.keywords.find((item) => item.id === route.query.keyword),
);
const benefitOptions = computed(() => [
  { label: '全部功效卖点', value: 'ALL' },
  ...(serverMode ? remote.facets.value.benefit || [] : [
    ...new Set(filteredProducts.value.flatMap((product) => product.benefits)),
  ]).map((value) => ({ label: value, value })),
]);
const ingredientOptions = computed(() => [
  { label: '全部成分', value: 'ALL' },
  ...(serverMode ? remote.facets.value.ingredient || [] : [
    ...new Set(
      filteredProducts.value.flatMap((product) =>
        product.ingredientInsights.map((item) => item.name),
      ),
    ),
  ]).map((value) => ({ label: value, value })),
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
    category.value = 'ALL';
    benefitFilter.value = 'ALL';
    ingredientFilter.value = 'ALL';
    sourceFilter.value = 'ALL';
    search.value = '';
    setListedQuick(0);
    if (
      !serverMode && siteFilter.value &&
      !state.sites.some(
        (s) =>
          s.id === siteFilter.value &&
          (state.market === 'ALL' || s.market === state.market),
      )
    )
      siteFilter.value = '';
    if (
      !serverMode && keywordFilter.value &&
      !state.keywords.some(
        (keyword) =>
          keyword.id === keywordFilter.value &&
          (state.market === 'ALL' || keyword.market === state.market),
      )
    )
      keywordFilter.value = '';
  },
);
const rows = computed(() => serverMode ? remote.rows.value :
  filteredProducts.value.filter(
    (p) =>
      `${p.title} ${productChineseName(p)} ${p.brand} ${p.size} ${p.form} ${p.claim} ${p.ingredient} ${p.benefits.join(' ')} ${p.ingredientInsights.map((item) => `${item.name} ${item.role}`).join(' ')} ${state.sites.find((site) => site.id === p.siteId)?.domain || ''} ${state.keywords
        .filter((keyword) => keyword.productIds.includes(p.id))
        .map((keyword) => `${keyword.term} ${keyword.termZh || ''}`)
        .join(' ')}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      matchesListingRange(p, listedRange.value[0], listedRange.value[1]) &&
      (category.value === 'ALL' || p.category === category.value) &&
      (benefitFilter.value === 'ALL' ||
        p.benefits.includes(benefitFilter.value)) &&
      (ingredientFilter.value === 'ALL' ||
        p.ingredientInsights.some(
          (item) => item.name === ingredientFilter.value,
        )) &&
      (!favorites.value || p.favorite) &&
      (sourceFilter.value === 'ALL' ||
        productDataSource(p) === sourceFilter.value) &&
      (decisionFilter.value === 'ALL' ||
        productDecisions(p).some((tag) => tag.key === decisionFilter.value)) &&
      (newness.value === 'ALL' || (newness.value === 'discovered' ? discoveryDecision(p, 'product').recentDiscovery
        : (discoveryDecision(p, 'product').isNew === null ? 'unknown' : discoveryDecision(p, 'product').isNew ? 'yes' : 'no') === newness.value)) &&
      (!siteFilter.value || p.siteId === siteFilter.value) &&
      (!keywordFilter.value ||
        state.keywords
          .find((keyword) => keyword.id === keywordFilter.value)
          ?.productIds.includes(p.id)) &&
      (!linkedKeyword.value || linkedKeyword.value.productIds.includes(p.id)),
  ),
);
const { ids: bulkIds, selected: bulkSelected, selectable, selectAll, clear, rowSelection } = useFilteredSelection(rows, undefined, serverMode ? remote.selectAll : undefined);
const pagedRows = computed(() =>
  serverMode ? rows.value : sortedRows.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
const sortedRows = computed(() => {
  const { key, order } = tableSort.value;
  if (!order || !productSortKeys.includes(key)) return rows.value;
  return [...rows.value].sort((a, b) => compareProductValues(productSortValue(a, key), productSortValue(b, key), order) || a.id.localeCompare(b.id));
});
const tableColumns = computed(() => core.columns([
  { title: '商品', key: 'product', width: 280, fixed: 'left' as const },
  { title: '市场 / 品类', key: 'category', width: 100 },
  { title: '采集时间（北京时间）', key: 'collectedAt', width: 158 },
  { title: '展示销量', key: 'core:cumulativeSold', width: 100 },
  { title: '上架时间', key: 'core:listingDate', width: 112 },
  { title: '决策标签', key: 'decisions', width: 210 },
  { title: '原币价格', key: 'core:priceOriginal', width: 116 },
  { title: '美元对比价', key: 'core:priceUsd', width: 116 },
  { title: '规格 / 剂型', key: 'spec', width: 125 },
  { title: '配方与成分', key: 'ingredient', width: 190 },
  { title: '数据来源 / 独立站', key: 'source', width: 185 },
  { title: '资源口径 / 覆盖', key: 'resourceEvidence', width: 220 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' as const },
]).map((column) => productSortKeys.includes(column.key || '') ? {
  ...column, sorter: true, sortOrder: tableSort.value.key === column.key ? tableSort.value.order : null,
} : column));
watch(
  [
    search,
    listedRange,
    category,
    favorites,
    benefitFilter,
    ingredientFilter,
    decisionFilter,
    newness,
    sourceFilter,
    siteFilter,
    keywordFilter,
    () => state.market,
    () => route.query.keyword,
  ],
  () => {
    page.value = 1;
    clear();
  },
);
watch(
  () => rows.value.length,
  (n) => {
    if (serverMode) return;
    page.value = Math.min(
      page.value,
      Math.max(1, Math.ceil(n / pageSize.value)),
    );
  },
);
function changePage(current: number, size: number) {
  pageSize.value = size;
  page.value = Math.min(
    current,
    Math.max(1, Math.ceil((serverMode ? remote.total.value : rows.value.length) / size)),
  );
}
const comparison = computed(() =>
  state.products.filter((p) => compareIds.value.includes(p.id)),
);
function toggleCompare(id: string) {
  if (compareIds.value.includes(id))
    compareIds.value = compareIds.value.filter((x) => x !== id);
  else if (compareIds.value.length < 3) compareIds.value.push(id);
  else message.info('最多同时对比3个商品');
}
function siteField(id: string, field: 'brand' | 'domain') {
  return state.sites.find((row) => row.id === id)?.[field] || remote.facets.value.sites?.find((row) => row.value === id)?.[field] || '';
}
async function exportProducts() {
  try {
    const records = serverMode ? await remote.exportRows(bulkIds.value) : bulkIds.value.length ? bulkSelected.value : rows.value;
    exportCsv('商品库.csv', records.map((p) => ({
      ...core.exportRecord(p),
      ...resourceExportRecord(p),
      商品: p.title, 中文参考: productChineseName(p) || '中文参考待补充', 品牌: p.brand, 国家: p.market, 规格: p.size, 价格: p.price, 币种: p.currency,
      成分: p.ingredient, 剂量: p.dose, 功效卖点: p.benefits.join('、'), 卖点依据: p.benefitEvidence,
      成分分析: p.ingredientInsights.map((item) => `${item.name}｜${item.amount}｜${item.role}`).join('；'),
      商品图片: p.imageUrl || '', 数据来源: [p.sourceProvider, p.sourcePlatform].filter(Boolean).join(' · '),
      采集时间: productCollectedAt(p) || '', 决策标签: productDecisions(p).map((item) => item.label).join('、'),
      决策依据: productDecisions(p).map((item) => `${item.label}：${item.reason} 来源：${item.source} 日期：${item.date}`).join('；'),
      已采集字段: p.collectionFields?.join('、') || '', 独立站品牌: siteField(p.siteId, 'brand'),
      独立站域名: siteField(p.siteId, 'domain'), 证据网址: p.evidenceUrl || '', 性质: productDataSource(p),
    })));
  } catch (cause) { message.error((cause as Error).message); }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="商品情报库"
      description="从配方、规格到市场定位，建立可追溯的商品认知。"
    >
      <FormulaInsights />
      <PlatformProductsDialog />
      <ProductCompletionDialog :product-ids="rows.map((p) => p.id)" :total="serverMode ? remote.total.value : undefined" :resolve-product-ids="serverMode ? async () => (await remote.selectAll()).map((p) => p.id) : undefined" />
      <Button
        :disabled="!rows.length"
        @click="exportProducts"
      >
        {{ bulkIds.length ? `导出所选（${bulkIds.length}）` : '导出商品' }} </Button
      ><Button
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
      <div class="hci-toolbar hci-filter-toolbar" style="margin-bottom: 0">
        <Input.Search
          v-model:value="search"
          placeholder="搜索中英文关键词、商品、站点、配方或卖点"
          allow-clear
        /><Select
          v-model:value="keywordFilter"
          :options="keywordOptions"
          show-search
          option-filter-prop="label"
          aria-label="按关联关键词筛选商品"
          style="min-width: 240px"
        /><Select
          v-model:value="category"
          show-search
          option-filter-prop="label"
          aria-label="按品类筛选商品"
          :options="[
            { label: '全部品类', value: 'ALL' },
            ...categories.map((c) => ({ label: c, value: c })),
          ]"
        /><Select
          v-model:value="benefitFilter"
          show-search
          option-filter-prop="label"
          :options="benefitOptions"
          aria-label="按功效卖点筛选商品"
          style="min-width: 170px"
        /><Select
          v-model:value="ingredientFilter"
          show-search
          option-filter-prop="label"
          :options="ingredientOptions"
          aria-label="按成分分析筛选商品"
          style="min-width: 190px"
        /><Select
          v-model:value="siteFilter"
          show-search
          option-filter-prop="label"
          :options="siteOptions"
          aria-label="按独立站筛选商品"
          style="min-width: 230px"
        /><Select id="product-newness" aria-label="商品新旧标签" v-model:value="newness" show-search option-filter-prop="label" :options="discoveryFilters" style="min-width: 180px" /><Select
          v-model:value="decisionFilter"
          show-search
          option-filter-prop="label"
          :options="productDecisionFilters"
          aria-label="按商品决策标签筛选"
          style="min-width: 200px"
        /><Select
          v-model:value="sourceFilter"
          show-search
          option-filter-prop="label"
          :options="sourceOptions"
          aria-label="按商品数据来源筛选"
          style="min-width: 210px"
        /><Checkbox v-model:checked="favorites">仅看收藏</Checkbox
        ><span class="hci-toolbar-end hci-subtle"
          >{{ rows.length }} 个商品 · 关联
          {{ new Set(rows.map((p) => p.siteId).filter(Boolean)).size }}
          家独立站</span
        >
      </div>
    </section>
    <div class="hci-toolbar product-listing-filter">
      <span>上架时间</span>
      <DatePicker.RangePicker :value="listedRange.length === 2 ? listedRange : undefined" value-format="YYYY-MM-DD" :placeholder="['开始日期', '结束日期']" @change="(_dates, values) => { listedRange = values?.[0] && values?.[1] ? [values[0], values[1]] : []; listedQuick = 0; }" />
      <Segmented :value="listedQuick" aria-label="上架时间快捷筛选" :options="[{ value: 0, label: '全部' }, ...[7, 30, 90].map((value) => ({ value, label: `近${value}天` }))]" @change="(value) => setListedQuick(Number(value))" />
    </div>
    <Empty v-if="!rows.length" description="没有符合条件的商品，请调整筛选" />
    <div class="hci-toolbar product-view-toolbar">
      <Segmented
        v-model:value="viewMode"
        aria-label="商品展示方式"
        :options="[
          { label: '卡片视图', value: 'cards' },
          { label: '列表视图', value: 'list' },
        ]"
      />
      <span class="hci-subtle"
        >{{ serverMode ? remote.total.value : rows.length }} 个商品 · 当前第 {{ page }} 页</span
      >
      <Button @click="decisionRulesOpen = true">决策标签规则</Button>
    </div>
    <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
    <SelectionBar :count="bulkIds.length" :total="serverMode ? remote.total.value : selectable.length" @all="selectAll" @clear="clear"><ProductCompletionDialog v-if="bulkIds.length" :product-ids="bulkIds" :compact="bulkIds.length === 1" /></SelectionBar>
    <div v-if="viewMode === 'cards'" class="hci-product-grid">
      <article
        v-for="product in pagedRows"
        :key="product.id"
        class="hci-product-card"
      >
        <div class="hci-card-select"><Checkbox :checked="bulkIds.includes(product.id)" :disabled="product.dataNature === 'demo'" :aria-label="`选择商品 ${product.title}`" @change="bulkIds = $event.target.checked ? [...bulkIds, product.id] : bulkIds.filter((id) => id !== product.id)" /></div>
        <button
          style="width: 100%"
          @click="selected = product.id"
          :aria-label="`查看${product.title}`"
        >
          <ProductArt
            :color="product.color"
            :brand="product.brand"
            :image-url="product.imageUrl"
            :source-label="productDataSource(product)"
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
          <button class="hci-product-title hci-clamp-2" @click="selected = product.id">
            {{ product.title }}
          </button>
          <ProductChineseName :product="product" />
          <p class="hci-subtle">{{ product.size }} · {{ product.form }}</p>
          <p class="hci-subtle">采集：<CollectionTime :at="productCollectedAt(product)" /></p>
          <ProductDecisionTags :product="product" />
          <ProductResourceEvidence v-if="product.resourceEvidence" :evidence="product.resourceEvidence" compact />
          <div class="hci-product-meta">
            <Tag>{{ product.category }}</Tag
            ><Tag :color="product.reviewed ? 'green' : 'orange'">
              {{
                product.reviewed
                  ? '已核验示例'
                  : product.dataNature === 'collected'
                    ? `${productDataSource(product)} · 待审核`
                    : '待审核'
              }}
            </Tag>
            <Tag v-if="product.collectionFields?.length" color="blue">
              已采集 {{ product.collectionFields.length }}/7 项
            </Tag>
          </div>
          <div class="hci-product-insights">
            <div><span>展示销量</span><EvidenceMetric :metric="core.metric(product, 'core:cumulativeSold')" /></div>
            <div><span>上架时间</span><EvidenceMetric :metric="core.metric(product, 'core:listingDate')" /></div>
            <div>
              <span>功效卖点</span>
              <CompactTags :items="product.benefits" label="商品功效卖点" color="green" />
            </div>
            <div>
              <span>成分分析</span>
              <b v-if="product.ingredientInsights.length">{{
                product.ingredientInsights.map((item) => item.name).join(' · ')
              }}</b>
              <span v-else class="hci-subtle">来源未提供明确配方，待补充</span>
            </div>
          </div>
          <button
            v-if="product.siteId"
            class="hci-product-site"
            @click="
              router.push({ path: '/sites', query: { site: product.siteId } })
            "
          >
            <span>关联独立站</span>
            <b>{{
              siteField(product.siteId, 'domain')
            }}</b>
            <span>查看档案 →</span>
          </button>
          <a
            v-else-if="product.sourceUrl"
            class="hci-product-site"
            :href="product.sourceUrl"
            target="_blank"
            rel="noreferrer"
            ><span>商品来源</span><b>{{ productDataSource(product) }}</b
            ><span>原始商品 ↗</span></a
          >
          <div class="hci-product-bottom">
            <span class="hci-price">{{
              product.price > 0
                ? money(product.price, product.currency)
                : '价格待获取'
            }}</span
            ><button
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
    <CoreListControls v-model:preset="corePreset" v-model:period="corePeriod" kind="products" />
    <Table
      v-if="viewMode === 'list'"
      :loading="remote.loading.value"
      @change="tableChange"
      class="hci-resource-table product-compact-table"
      :row-selection="rowSelection"
      :data-source="pagedRows"
      row-key="id"
      size="small"
      table-layout="fixed"
      :pagination="false"
      :scroll="{ x: tableColumns.reduce((total, column) => total + (column.width || 0), 32) }"
      :columns="tableColumns"
    >
      <template #bodyCell="{ column, record }">
        <EvidenceMetric v-if="String(column.key).startsWith('core:')" :metric="core.metric(record as Product, column.key)" />
        <template v-else-if="column.key === 'product'"
          ><div class="product-list-name">
            <button
              class="product-list-thumb"
              :aria-label="`查看${record.title}`"
              @click="selected = record.id"
            >
              <img
                v-if="record.imageUrl && !failedImages.has(record.id)"
                :src="record.imageUrl"
                :alt="record.title"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="failedImages.add(record.id)"
              /><span v-else>暂无图片</span>
            </button>
            <div>
              <Button
                type="link"
                class="product-name-link"
                @click="selected = record.id"
                >{{ record.title }}</Button
              >
              <ProductChineseName :product="record as Product" />
              <p class="hci-subtle">{{ record.brand }}</p>
            </div>
          </div></template
        >
        <template v-else-if="column.key === 'collectedAt'">
          <CollectionTime :at="productCollectedAt(record)" />
        </template>
        <template v-else-if="column.key === 'decisions'">
          <ProductDecisionTags :product="record as Product" />
        </template>
        <template v-else-if="column.key === 'category'"
          >{{ marketName(record.market) }}
          <p>
            <Tag>{{ record.category }}</Tag>
          </p></template
        >
        <template v-else-if="column.key === 'spec'"
          >{{ record.size }}
          <p class="hci-subtle">{{ record.form }}</p></template
        >
        <template v-else-if="column.key === 'ingredient'"
          ><p class="product-list-ingredient">{{ record.ingredient }}</p>
          <Tag :color="record.reviewed ? 'green' : 'orange'">{{
            record.reviewed ? '已核验' : '待审核'
          }}</Tag></template
        >
        <template v-else-if="column.key === 'source'"
          ><Tag>{{ productDataSource(record) }}</Tag
          ><Button
            v-if="record.siteId"
            type="link"
            @click="
              router.push({ path: '/sites', query: { site: record.siteId } })
            "
            >{{
              siteField(record.siteId, 'domain') ||
              '未关联站点'
            }}</Button
          >
          <p class="hci-subtle">
            已采集 {{ record.collectionFields?.length || 0 }}/7 项
          </p></template
        >
        <template v-else-if="column.key === 'resourceEvidence'">
          <ProductResourceEvidence v-if="record.resourceEvidence" :evidence="record.resourceEvidence" compact />
          <span v-else class="hci-subtle">未记录资源排名证据</span>
        </template>
        <template v-else-if="column.key === 'actions'"
          ><Button size="small" @click="selected = record.id">详情</Button
          ><Button type="link" @click="toggleFavorite(record as Product)">{{
            record.favorite ? '取消收藏' : '收藏'
          }}</Button
          ><Checkbox
            :checked="compareIds.includes(record.id)"
            @change="toggleCompare(record.id)"
            >对比</Checkbox
          ></template
        >
      </template>
    </Table>
    <div v-if="rows.length" class="product-pagination">
      <Pagination
        :current="page"
        :page-size="pageSize"
        :total="serverMode ? remote.total.value : rows.length"
        show-size-changer
        :page-size-options="['10', '20', '50', '100']"
        :show-total="(total) => `共 ${total} 个商品`"
        @change="changePage"
      />
    </div>
    <div class="hci-demo-footer">
      <span>原币种价格 · 不同包装与币种不直接排名</span
      ><span
        >平台与官网数据分别保留来源；首次发现不等于新品，缺历史不推测增长</span
      >
    </div>
    <Modal
      v-model:open="decisionRulesOpen"
      title="商品决策标签规则"
      :footer="null"
    >
      <p>{{ PRODUCT_DECISION_RULES }}</p>
      <p style="margin-top: 12px">
        新品需要平台上架日期，首次发现不等于新品。销量、排名、关键词覆盖分别判断；不会用关键词搜索热度代替商品销量。历史不足或数据过旧时保留待补充状态。
      </p>
      <p style="margin-top: 12px">
        偶发尖峰要求至少三个前期完整周期、一个明显峰值和两个后续回落周期。数据缺失不按0处理，未结束的周期不参与比较。
      </p>
    </Modal>
    <ProductDrawer :id="selected" @close="selected = undefined" /><Modal
      v-model:open="compareOpen"
      title="商品对比"
      :width="980"
      :footer="null"
    >
      <div class="hci-demo-note">
        {{ core.metric(comparison[0]!, 'core:priceUsd').reason }}
      </div>
      <div class="hci-comparison">
        <div v-for="p in comparison" :key="p.id">
          <h3>{{ p.title }}</h3>
          <ProductChineseName :product="p" />
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

<style scoped>
.product-view-toolbar {
  justify-content: space-between;
  margin: 12px 0;
}
.product-pagination {
  display: flex;
  justify-content: flex-end;
  margin: 20px 0;
}
.product-list-name {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.product-list-name > div {
  min-width: 0;
  flex: 1;
}
.product-list-thumb {
  width: 48px;
  height: 48px;
  background: #f5f7fb;
  flex-shrink: 0;
  border-radius: 5px;
  overflow: hidden;
  font-size: 11px;
  color: #7b8794;
}
.product-list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.product-name-link {
  white-space: normal;
  text-align: left;
  height: auto;
  padding: 0;
}
.product-list-ingredient {
  max-width: 240px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.product-compact-table :deep(.ant-table-cell) {
  padding: 8px 6px;
  overflow-wrap: anywhere;
}
.product-compact-table :deep(.ant-table-selection-column) {
  width: 32px;
}
.product-compact-table :deep(.ant-btn-link) {
  padding-inline: 6px;
}
.product-compact-table :deep(.product-name-link) {
  padding: 0;
}
</style>

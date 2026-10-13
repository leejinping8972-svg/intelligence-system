<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Input, Select, Table, Tag, Drawer } from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import { filteredSites, state, marketName, exportCsv } from './data';
import type { Site } from './data';
const router = useRouter();
const route = useRoute();
const search = ref('');
const platform = ref('ALL');
const category = ref('ALL');
const ownership = ref('ALL');
const selected = ref<Site>();
const linkedKeyword = computed(() =>
  state.keywords.find((item) => item.id === route.query.keywordId),
);
const categoryOptions = computed(() => [
  { label: '全部类别', value: 'ALL' },
  ...[...new Set(filteredSites.value.map((site) => site.category))].map(
    (value) => ({ label: value, value }),
  ),
]);
const ownershipOptions = computed(() => [
  { label: '全部股权背景', value: 'ALL' },
  ...[
    ...new Set(filteredSites.value.map((site) => site.ownershipBackground)),
  ].map((value) => ({ label: value, value })),
]);
watch(
  () => route.query.site,
  async (siteId) => {
    const site = state.sites.find((item) => item.id === siteId);
    if (!site) return;
    if (state.market !== site.market) {
      state.market = site.market;
      await nextTick();
    }
    selected.value = site;
  },
  { immediate: true },
);
watch(
  () => state.market,
  () => {
    selected.value = undefined;
  },
);
const rows = computed(() =>
  filteredSites.value.filter(
    (s) =>
      `${s.brand} ${s.domain} ${s.keyword} ${s.mainProducts.join(' ')} ${s.category} ${s.ownershipBackground}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (platform.value === 'ALL' || s.platform === platform.value) &&
      (category.value === 'ALL' || s.category === category.value) &&
      (ownership.value === 'ALL' ||
        s.ownershipBackground === ownership.value) &&
      (!linkedKeyword.value || linkedKeyword.value.siteIds.includes(s.id)),
  ),
);
const columns = [
  { title: '品牌 / 独立站', key: 'brand', width: 220 },
  { title: '市场', key: 'market', width: 90 },
  { title: '类别', dataIndex: 'category', width: 150 },
  { title: '主要产品', key: 'mainProducts', width: 250 },
  { title: '股权背景（官网）', key: 'ownership', width: 220 },
  { title: '关联商品', key: 'products' },
  { title: '操作', key: 'actions' },
];
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="竞品独立站"
      description="把搜索线索整理成品牌档案，保留每一次发现的来源。"
      ><Button @click="router.push('/imports')">导入站点</Button
      ><Button
        @click="
          exportCsv(
            '独立站-演示.csv',
            rows.map((s) => ({
              品牌: s.brand,
              域名: s.domain,
              市场: s.market,
              类别: s.category,
              主要产品: s.mainProducts.join('、'),
              股权背景: s.ownershipBackground,
              官网依据: s.ownershipEvidence,
              性质: '演示',
            })),
          )
        "
        :disabled="!rows.length"
        >导出</Button
      ></PageHeader
    >
    <div v-if="route.query.keyword || linkedKeyword" class="hci-demo-note">
      <b>研究上下文</b>{{ linkedKeyword?.term || route.query.keyword }} ·
      {{ linkedKeyword ? '仅显示已关联站点。' : '当前展示候选站点，具体关联需人工核验。' }}
      <button
        v-if="linkedKeyword"
        class="hci-link"
        style="margin-left: 12px"
        @click="router.replace('/sites')"
      >清除关联筛选</button>
    </div>
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索品牌、网址、主要产品"
          allow-clear
        /><Select
          v-model:value="platform"
          :options="[
            { label: '全部平台', value: 'ALL' },
            { label: 'Shopify', value: 'Shopify' },
            { label: 'WooCommerce', value: 'WooCommerce' },
          ]"
        /><Select
          v-model:value="category"
          :options="categoryOptions"
          aria-label="按站点类别筛选"
        /><Select
          v-model:value="ownership"
          :options="ownershipOptions"
          aria-label="按股权背景筛选"
          style="min-width: 200px"
        /><span class="hci-toolbar-end hci-subtle"
          >{{ rows.length }} 家演示站点</span
        >
      </div>
      <Table
        :columns="columns"
        :data-source="rows"
        row-key="id"
        :scroll="{ x: 1250 }"
        :pagination="{ pageSize: 8 }"
        ><template #bodyCell="{ column, record }"
          ><template v-if="column.key === 'brand'"
            ><button
              class="hci-link"
              @click="selected = state.sites.find((s) => s.id === record.id)"
            >
              {{ record.brand }}
            </button>
            <div class="hci-subtle">{{ record.domain }}</div></template
          ><template v-if="column.key === 'market'"
            ><Tag>{{ marketName(record.market) }}</Tag></template
          ><template v-if="column.key === 'mainProducts'"
            ><div class="hci-compact-tags">
              <Tag v-for="item in record.mainProducts" :key="item">{{ item }}</Tag>
            </div></template
          ><template v-if="column.key === 'ownership'"
            ><Tag :color="record.ownershipBackground === '待核验' ? 'orange' : 'blue'">
              {{ record.ownershipBackground }}
            </Tag>
            <div class="hci-subtle">{{ record.ownershipSource }}</div></template
          ><template v-if="column.key === 'products'">{{
            state.products.filter((p) => p.siteId === record.id).length
          }}</template
          ><template v-if="column.key === 'actions'"
            ><button
              class="hci-link"
              @click="selected = state.sites.find((s) => s.id === record.id)"
            >
              查看档案 →
            </button></template
          ></template
        ></Table
      >
    </section>
    <Drawer
      :open="!!selected"
      :width="560"
      title="品牌与站点档案"
      @close="selected = undefined"
      ><template v-if="selected"
        ><h2 style="font-size: 25px">{{ selected.brand }}</h2>
        <p class="hci-subtle">{{ selected.domain }} · 虚构示例域名</p>
        <dl class="hci-detail-grid">
          <dt>销售市场</dt>
          <dd>{{ marketName(selected.market) }}</dd>
          <dt>电商平台</dt>
          <dd>{{ selected.platform }}</dd>
          <dt>网站类型</dt>
          <dd>{{ selected.type }}</dd>
          <dt>站点类别</dt>
          <dd>{{ selected.category }}</dd>
          <dt>主要产品</dt>
          <dd>{{ selected.mainProducts.join('、') || '待提取' }}</dd>
          <dt>发现关键词</dt>
          <dd>{{ selected.keyword }}</dd>
          <dt>来源</dt>
          <dd>演示 SERP / Store Leads 样本</dd>
          <dt>首次观察</dt>
          <dd>2026-10-13（不等于品牌成立日期）</dd>
        </dl>
        <h3 class="hci-section-heading">官网股权与运营背景</h3>
        <dl class="hci-detail-grid">
          <dt>股权背景</dt>
          <dd><Tag color="blue">{{ selected.ownershipBackground }}</Tag></dd>
          <dt>运营主体</dt>
          <dd>{{ selected.ownershipOperations }}</dd>
          <dt>官网来源</dt>
          <dd>{{ selected.ownershipSource }}</dd>
        </dl>
        <div class="hci-evidence">
          <b>官网信息摘录</b><br />{{ selected.ownershipEvidence }}<br />
          <span class="hci-subtle">演示数据仅说明字段结构，真实结论需保留官网 URL、原文与采集时间。</span>
        </div>
        <div class="hci-evidence">
          此处将展示原始搜索命中、自然排名和采集批次。目前没有真实网页证据。
        </div>
        <Button
          type="primary"
          @click="
            router.push({ path: '/products', query: { site: selected.id } })
          "
          >查看该站商品</Button
        ></template
      ></Drawer
    >
  </main>
</template>

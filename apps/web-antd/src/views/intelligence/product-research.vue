<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Alert, Button, Empty, Input, Table, Tabs, Tag } from 'ant-design-vue';
import type { Product } from './data';
import type { ResearchReport } from './research-reports';
import { state, marketName, money, filteredProducts } from './data';
import { cloudRequest, loadWorkspaceDetail } from './cloud-workspace';
import { serverMode } from './session';
import { useWorkspaceList } from './workspace-queries';
import { productDataSource } from './product-decisions';
import { reportStatus } from './consumer-reports';
import PageHeader from './components/PageHeader.vue';
import PlatformProductsDialog from './components/PlatformProductsDialog.vue';
import ProductCompletionDialog from './components/ProductCompletionDialog.vue';
import ConsumerReportDialog from './components/ConsumerReportDialog.vue';
import CoreMetricsPanel from './components/CoreMetricsPanel.vue';
import ProductDecisionTags from './components/ProductDecisionTags.vue';
import ProductDrawer from './components/ProductDrawer.vue';
const route = useRoute(), router = useRouter();
const query = ref(typeof route.query.q === 'string' ? route.query.q : '');
const page = ref(1), pageSize = ref(20);
const selectedId = ref('');
const detailsOpen = ref(false);
const busy = ref(false), error = ref('');
const reports = ref<ResearchReport[]>([]);
let selectionRevision = 0;
const remote = useWorkspaceList<Product>('products', computed(() => ({ market: state.market, search: query.value })), page, pageSize);
const rows = computed(() => serverMode ? remote.rows.value : filteredProducts.value.filter(p => (p.title + p.brand + p.ingredient).toLowerCase().includes(query.value.toLowerCase())));
const product = computed(() => state.products.find(p => p.id === selectedId.value));
async function select(id: string) {
  const revision = ++selectionRevision;
  selectedId.value = id;
  error.value = ''; reports.value = [];
  busy.value = true;
  try {
    if (serverMode) {
      await loadWorkspaceDetail('products', id);
      if (revision !== selectionRevision) return;
      const relatedSiteId = product.value?.siteId;
      if (relatedSiteId) await loadWorkspaceDetail('sites', relatedSiteId);
      if (revision !== selectionRevision) return;
      const result = await cloudRequest<{ reports: ResearchReport[] }>('server_insight_snapshot', { kind: 'consumer', productId: id, summary: true });
      if (revision === selectionRevision) reports.value = result.reports;
    }
  } catch (cause) { if (revision === selectionRevision) error.value = cause instanceof Error ? cause.message : '商品详情读取失败'; }
  finally { if (revision === selectionRevision) busy.value = false; }
}
function choose(id: string) { void router.replace({ path: '/product-research', query: { ...route.query, product: id, q: query.value || undefined } }); }
watch(() => route.query.product, id => { if (typeof id === 'string') void select(id); else { selectionRevision++; selectedId.value = ''; busy.value = false; reports.value = []; } }, { immediate: true });
watch(query, () => { page.value = 1; });
const site = computed(() => state.sites.find(s => s.id === product.value?.siteId));
</script>
<template>
  <main class="hci-page">
    <PageHeader title="商品研究" description="查询各市场候选商品，对照销售证据并研究消费者需求。" mode="paged"><PlatformProductsDialog /></PageHeader>
    <section class="hci-panel"><div class="hci-toolbar"><Input.Search v-model:value="query" placeholder="输入商品、品牌、成分或检索词" aria-label="检索研究商品" allow-clear style="width: 360px" /><span class="hci-subtle">先选市场，再查看候选；同词结果需人工确认是否同款。</span><RouterLink to="/products">进入完整商品库</RouterLink></div></section>
    <div class="product-research-layout">
      <section class="hci-panel">
        <div class="hci-panel-head"><h2>市场候选商品</h2><span class="hci-subtle">{{ serverMode ? remote.total.value : rows.length }} 条</span></div>
        <Alert v-if="remote.error.value" type="error" :message="remote.error.value" />
        <Table size="small" row-key="id" :loading="remote.loading.value" :data-source="rows" :scroll="{ x: 610 }" :columns="[{ title: '商品 / 市场', key: 'product', width: 250 }, { title: '平台', dataIndex: 'sourcePlatform', width: 100 }, { title: '价格', key: 'price', width: 100 }, { title: '操作', key: 'actions', width: 90 }]" :pagination="{ current: page, pageSize, total: serverMode ? remote.total.value : rows.length, onChange: p => page = p }">
          <template #bodyCell="{ column, record }"><template v-if="column.key === 'product'"><strong>{{ record.title }}</strong><p class="hci-subtle">{{ marketName(record.market) }} · {{ record.brand }}</p></template><span v-else-if="column.key === 'price'">{{ money(record.price, record.currency) }}</span><Button v-else-if="column.key === 'actions'" size="small" :type="selectedId === record.id ? 'primary' : 'default'" @click="choose(record.id)">{{ selectedId === record.id ? '研究中' : '研究此品' }}</Button></template>
        </Table>
      </section>
      <section class="hci-panel product-research-detail">
        <Alert v-if="error" type="error" :message="error" show-icon />
        <Empty v-if="!product" description="选择左侧商品，查看价格、销量、证据和关联报告" />
        <template v-else>
          <div class="hci-panel-head"><div><h2>{{ product.title }}</h2><p>{{ product.brand }} · {{ marketName(product.market) }} · {{ product.sourcePlatform || '平台未记录' }} · {{ product.sourceProvider || productDataSource(product) }}</p></div><Button @click="detailsOpen = true">完整详情</Button></div>
          <ProductDecisionTags :product="product" />
          <div class="hci-toolbar"><ProductCompletionDialog :product-ids="[product.id]" /><ConsumerReportDialog :product-ids="[product.id]" :site-ids="product.siteId ? [product.siteId] : []" :initial-market="product.market" :initial-query="query || product.title" label="研究消费者需求" @submitted="select(product.id)" /><RouterLink :to="{ path: '/monitor', query: { tab: 'monitors' } }">跟踪计划</RouterLink></div>
          <Tabs><Tabs.TabPane key="metrics" tab="销售与价格证据"><CoreMetricsPanel v-if="!busy" kind="products" :record="product" /></Tabs.TabPane><Tabs.TabPane key="reports" tab="消费者报告与审核"><Empty v-if="!reports.length" description="暂无关联报告，可发起消费者需求研究" /><div v-for="report in reports" :key="report.id" class="research-report-row"><RouterLink :to="'/consumer-insights/reports/' + report.id">{{ report.title }}</RouterLink><Tag>{{ reportStatus(report.status) }}</Tag></div></Tabs.TabPane><Tabs.TabPane key="resources" tab="关联资料"><p>独立站：{{ site?.domain || product.siteId || '未关联' }}</p><RouterLink v-if="product.siteId" :to="{ path: '/sites', query: { site: product.siteId } }">查看关联独立站</RouterLink><p class="hci-subtle">候选检索结果不自动归为同款，来源未提供的数据保持未知。</p></Tabs.TabPane></Tabs>
        </template>
      </section>
    </div>
    <ProductDrawer :id="detailsOpen ? selectedId : undefined" @close="detailsOpen = false" />
  </main>
</template>

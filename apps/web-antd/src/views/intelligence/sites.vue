<script setup lang="ts">
import CollectionTimeFilter from './components/CollectionTimeFilter.vue';
import { matchesCollectionRange } from '../../../../../server/collection-time.mjs';
import type { Site } from './data';
import { siteKeywordProvenance, sourceSiteDomain } from '../../../../../server/site-keyword-provenance.mjs';
import { useSiteKeywordFilter } from './site-keyword-filter';

import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Input,
  message,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import ProductText from './components/ProductText.vue';
import SourceFieldsButton from './components/SourceFieldsButton.vue';
import CollectionTime from './components/CollectionTime.vue';
import { collectionTimeOrder, siteCollectedAt } from './resource-metadata';
import CompactTags from './components/CompactTags.vue';
import ScoreRangeFilter from './components/ScoreRangeFilter.vue';
import SemrushSitesDialog from './components/SemrushSitesDialog.vue';
import ManualSiteDialog from './components/ManualSiteDialog.vue';
import SelectionBar from './components/SelectionBar.vue';
import SiteDrawer from './components/SiteDrawer.vue';
import EvidenceMetric from './components/EvidenceMetric.vue';
import { useCoreList } from './use-core-list';
import { useListFilterMemory } from './list-filter-memory';
const listMemory = useListFilterMemory('sites');
const core = useCoreList('sites');
listMemory.bind('period', core.period);
import BulkSiteWatch from './components/BulkSiteWatch.vue';
import { emptyScoreFilter, matchesScore, useFilteredSelection } from './resource-list';
import ProductCollectDialog from './components/ProductCollectDialog.vue';
import CompetitorWatchPanel from './components/CompetitorWatchPanel.vue';
import { exportCsv, filteredSites, marketName, state } from './data';
import { cloudRequest, syncCloudWorkspace } from './cloud-workspace';
import { loadWorkspaceDetail } from './cloud-workspace';
import { serverMode } from './session';
import { useWorkspaceList } from './workspace-queries';
import WorkspaceReadStatus from './components/WorkspaceReadStatus.vue';
const router = useRouter();
const ids = ref<string[]>([]),
  scoring = ref(false),
  scoreError = ref('');
const sources = (s: Site) =>
  s.sources?.length
    ? s.sources
    : [s.dataNature === 'imported' ? '人工导入' : '历史采集 · 来源待核对'];
const source = listMemory.field('source', 'ALL');
const scoreFilter = listMemory.field('scoreFilter', emptyScoreFilter());
const sourceOptions = computed(() => [
  { label: '全部数据来源', value: 'ALL' },
  ...(serverMode ? remote.facets.value.source || [] : [...new Set(filteredSites.value.flatMap(sources))]).map((value) => ({
    label: value,
    value,
  })),
]);
let scoreRequest = '';
async function scoreSelected() {
  if (!ids.value.length || scoring.value) return;
  scoring.value = true;
  scoreError.value = '';
  try {
    await syncCloudWorkspace();
    scoreRequest ||= crypto.randomUUID();
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_market',
      { kind: 'site_metrics', siteIds: ids.value, requestId: scoreRequest },
    );
    scoreRequest = '';
    message.success('站点指标与评分已提交后台');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (e) {
    scoreError.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    scoring.value = false;
  }
}

const route = useRoute();
const sourceSiteFilter = listMemory.field('sourceSiteFilter', '');
watch(() => route.query.sourceSite, (value, previous) => {
  if (route.path !== '/sites' || (value === undefined && previous === undefined)) return;
  sourceSiteFilter.value = sourceSiteDomain(value);
}, { immediate: true });
const collectedRange = listMemory.field<string[]>('collectedRange', []);
const search = listMemory.field('search', '');
const platform = listMemory.field('platform', 'ALL');
const category = listMemory.field('category', 'ALL');
const ownership = listMemory.field('ownership', 'ALL');
const keywordFilter = useSiteKeywordFilter(listMemory.field('keywordFilter', ''));
const selected = ref<Site>();
const page = listMemory.field('page', 1);
const pageSize = listMemory.field('pageSize', 8);
const remote = useWorkspaceList<Site>('sites', computed(() => ({ market: state.market,
  search: search.value, platform: platform.value, category: category.value, ownership: ownership.value,
    collectedFrom: collectedRange.value[0], collectedTo: collectedRange.value[1],
  keywordId: keywordFilter.value || undefined, source: source.value, score: scoreFilter.value,
  siteDomain: sourceSiteFilter.value || undefined,
})), page, pageSize);
remote.sort.value = 'score';
listMemory.bind('sort', remote.sort);
listMemory.bind('order', remote.order);
const linkedKeyword = computed(() =>
  state.keywords.find((item) => item.id === route.query.keywordId),
);
const categoryOptions = computed(() => [
  { label: '全部类别', value: 'ALL' },
  ...(serverMode ? remote.facets.value.category || [] : [...new Set(filteredSites.value.map((site) => site.category))]).map(
    (value) => ({ label: value, value }),
  ),
]);
const ownershipOptions = computed(() => [
  { label: '全部股权背景', value: 'ALL' },
  ...(serverMode ? remote.facets.value.ownership || [] : [
    ...new Set(filteredSites.value.map((site) => site.ownershipBackground)),
  ]).map((value) => ({ label: value, value })),
]);
const platformOptions = computed(() => [
  { label: '全部平台', value: 'ALL' },
  ...(serverMode ? remote.facets.value.platform || [] : [...new Set(filteredSites.value.map((site) => site.platform))]).map(
    (value) => ({ label: value, value }),
  ),
]);
const keywordOptions = computed(() => [
  { label: '全部关联关键词', value: '' },
  ...(serverMode ? remote.facets.value.keywords || [] : state.keywords
    .filter(
      (keyword) =>
        keyword.siteIds.length > 0 &&
        (state.market === 'ALL' || keyword.market === state.market),
    )
    .map((keyword) => ({
      label: `${keyword.term} · ${keyword.market}`,
      value: keyword.id,
    }))),
]);
function keywordLabel(id: string) {
  const option = keywordOptions.value.find((item) => item.value === id);
  return option?.label?.split(' · ')[0] || id;
}
function siteKeywords(site: Site) {
  return (site.keywordIds || []).map((id) => {
    const inherited = site.sourceKeywordLinks?.find((item) => item.keywordIds.includes(id));
    const index = inherited?.keywordIds.indexOf(id) ?? -1;
    return { id, label: inherited?.terms[index] || keywordLabel(id), source: inherited?.domain || '' };
  });
}
async function filterSourceSite(domain: string, site: Site) {
  state.market = site.market;
  await nextTick();
  search.value = '';
  platform.value = category.value = ownership.value = source.value = 'ALL';
  collectedRange.value = [];
  scoreFilter.value = emptyScoreFilter();
  selected.value = undefined;
  await router.push({ path: '/sites', query: { sourceSite: domain } });
}
function clearSourceSite() {
  sourceSiteFilter.value = '';
  const { sourceSite: _sourceSite, ...query } = route.query;
  void router.replace({ path: route.path, query });
}
function openKeyword(id: string) {
  void router.push({ path: '/research', query: { keywordId: id } });
}
async function openRelated(collection: 'products' | 'ads', site: Site) {
  state.market = site.market;
  await nextTick();
  await router.push({ path: `/${collection}`, query: { site: site.id } });
}
function relatedCount(site: Site, collection: 'products' | 'ads') {
  if (serverMode) return collection === 'products' ? site.productCount : site.adCount;
  return collection === 'products'
    ? state.products.filter((item) => item.siteId === site.id && item.market === site.market).length
    : state.ads.filter((item) => item.siteIds?.includes(site.id) && item.market === site.market).length;
}
const collectedCount = computed(
  () => rows.value.filter((site) => site.dataNature === 'collected').length,
);
watch(
  () => route.query.site,
  async (siteId) => {
    if (serverMode && typeof siteId === 'string') {
      try { await loadWorkspaceDetail('sites', siteId); }
      catch (error) { message.error((error as Error).message); return; }
    }
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
    ids.value = [];
    scoreRequest = '';
    source.value = 'ALL';
    platform.value = 'ALL';
    category.value = 'ALL';
    ownership.value = 'ALL';
    search.value = '';
    page.value = 1;
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
  filteredSites.value.filter(
    (s) =>
      (!sourceSiteFilter.value || sourceSiteDomain(s.domain) === sourceSiteFilter.value) &&
      `${s.brand} ${s.domain} ${s.keyword} ${s.mainProducts.join(' ')} ${s.category} ${s.ownershipBackground} ${state.products
        .filter((product) => product.siteId === s.id)
        .map(
          (product) =>
            `${product.title} ${product.ingredient} ${product.benefits.join(' ')}`,
        )
        .join(' ')} ${state.keywords
        .filter((keyword) => keyword.siteIds.includes(s.id))
        .map((keyword) => keyword.term)
        .join(' ')}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      matchesCollectionRange('sites', s, collectedRange.value[0], collectedRange.value[1]) &&
      matchesScore(s.assessment?.score, scoreFilter.value) &&
      (source.value === 'ALL' || sources(s).includes(source.value)) &&
      (platform.value === 'ALL' || s.platform === platform.value) &&
      (category.value === 'ALL' || s.category === category.value) &&
      (ownership.value === 'ALL' ||
        s.ownershipBackground === ownership.value) &&
      (!keywordFilter.value ||
        state.keywords
          .find((keyword) => keyword.id === keywordFilter.value)
          ?.siteIds.includes(s.id)),
  ),
);
const { selectAll, clear, selectable, rowSelection } = useFilteredSelection(rows, ids, serverMode ? remote.selectAll : undefined);
const exporting = ref(false);
async function exportSites() {
  exporting.value = true;
  try {
    const records = serverMode ? await remote.exportRows(ids.value) : rows.value;
    exportCsv('独立站.csv', records.filter((site) => !ids.value.length || ids.value.includes(site.id)).map((s) => ({
      ...core.exportRecord(s),
      品牌: s.brand, 域名: s.domain, 市场: s.market, 类别: s.category,
      主要产品: s.mainProducts.join('、'), 股权背景: s.ownershipBackground,
      官网依据: s.ownershipEvidence, 采集时间: siteCollectedAt(s) || '',
      证据网址: s.evidenceUrl || '', 验证置信度: s.confidence ?? '',
      验证信号: s.signals?.join('、') || '', 性质: s.dataNature === 'collected' ? '官网实采' : '演示',
    })));
  } catch (cause) { message.error((cause as Error).message); }
  finally { exporting.value = false; }
}
watch([search, platform, category, ownership, keywordFilter, source, scoreFilter, sourceSiteFilter], () => {
  page.value = 1;
  ids.value = [];
  scoreRequest = '';
});
const columns = [
  { title: '品牌 / 独立站', key: 'brand', width: 220 },
  { title: '关联关键词', key: 'keywords', width: 190 },
  { title: '关联商品', key: 'products', width: 105 },
  { title: '关联广告', key: 'ads', width: 105 },
  { title: '发现来源', key: 'discoverySources', width: 250 },
  { title: '采集证据', key: 'collectionEvidence', width: 280 },
  { title: '市场', key: 'market', width: 90 },
  { title: '采集时间（北京时间）', key: 'collectedAt', width: 170, sortDirections: ['descend', 'ascend'] as ('descend' | 'ascend')[], sorter: serverMode ? true : (a: Site, b: Site) => collectionTimeOrder(siteCollectedAt(a)) - collectionTimeOrder(siteCollectedAt(b)) },
  {
    title: '站点评分',
    key: 'assessment',
    width: 120,
    sortDirections: ['descend', 'ascend'] as ('descend' | 'ascend')[],
    sorter: serverMode ? true : (a: Site, b: Site) =>
      (a.assessment?.score ?? -1) - (b.assessment?.score ?? -1),
  },
  { title: '类别', dataIndex: 'category', width: 150 },
  { title: '主要产品', key: 'mainProducts', width: 250 },
  { title: '股权背景（官网）', key: 'ownership', width: 220 },
  { title: '操作', key: 'actions', width: 190, fixed: 'right' as const },
];
const displayColumns = computed(() => core.columns(columns).map((column) => ({
  ...column,
  ...('sorter' in column ? {
    sortOrder: remote.sort.value === (column.key === 'assessment' ? 'score' : column.key)
      ? remote.order.value as 'ascend' | 'descend' : null,
  } : {}),
})));
watch(collectedRange, () => { page.value = 1; ids.value = []; });
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="竞品独立站"
      description="把搜索线索整理成品牌档案，保留每一次发现的来源。"
    >
      <ManualSiteDialog @saved="remote.reload(true)" />
      <SourceFieldsButton kind="sites" :ids="ids" />
      <ProductCollectDialog :site-ids="ids" />
      <BulkSiteWatch :site-ids="ids" />
      <SemrushSitesDialog />
      <CompetitorWatchPanel kind="site" :site-id="ids.length === 1 ? ids[0] : undefined" />
      <Button
        type="primary"
        :disabled="!ids.length || ids.length > 100"
        :loading="scoring"
        @click="scoreSelected"
        >补齐指标与站点评分（{{ ids.length }}）</Button
      ><Button @click="router.push('/imports')">导入站点</Button
      ><Button
        @click="exportSites"
        :loading="exporting"
        :disabled="!rows.length"
      >
        导出
      </Button>
    </PageHeader>
    <div v-if="sourceSiteFilter" class="hci-demo-note">
      <b>站点筛选</b>{{ sourceSiteFilter }}
      <button class="hci-link" style="margin-left: 12px" @click="clearSourceSite">清除站点筛选</button>
    </div>
    <div v-if="route.query.keywordId || linkedKeyword" class="hci-demo-note">
      <b>关键词关联筛选</b>{{ linkedKeyword?.term || keywordLabel(String(route.query.keywordId || '')) }} ·
      {{
        '仅显示已关联站点。'
      }}
      <button
        v-if="route.query.keywordId || linkedKeyword"
        class="hci-link"
        style="margin-left: 12px"
        @click="keywordFilter = ''"
      >
        清除关联筛选
      </button>
    </div>
    <section class="hci-panel hci-resource-list">
      <CollectionTimeFilter v-model="collectedRange" />

      <div class="hci-toolbar hci-filter-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索中英文关键词、品牌、网址、商品或成分"
          allow-clear
        /><Select
          v-model:value="keywordFilter"
          allow-clear
          :options="keywordOptions"
          show-search
          option-filter-prop="label"
          aria-label="按关联关键词筛选独立站"
          style="min-width: 240px"
        /><Select v-model:value="platform" :options="platformOptions" /><Select
          v-model:value="category"
          :options="categoryOptions"
          aria-label="按站点类别筛选"
        /><Select
          v-model:value="ownership"
          :options="ownershipOptions"
          aria-label="按股权背景筛选"
          style="min-width: 200px"
        /><Select
          v-model:value="source"
          :options="sourceOptions"
          aria-label="数据来源"
        /><ScoreRangeFilter v-model="scoreFilter" label="独立站" /><span class="hci-toolbar-end hci-subtle"
          >{{ serverMode ? remote.total.value : rows.length }} 家站点<span v-if="!serverMode"> · {{ collectedCount }} 家实采</span></span
        >
      </div>
      <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
      <SelectionBar :count="ids.length" :total="serverMode ? remote.total.value : selectable.length" :busy="scoring" @all="selectAll" @clear="clear" />
      <Alert
        v-if="scoreError"
        :message="scoreError"
        type="error"
        show-icon
      /><Table
        :loading="remote.loading.value"
        @change="remote.tableChange"
        class="hci-resource-table"
        size="small"
        :row-selection="rowSelection"
        :columns="displayColumns"
        :data-source="rows"
        row-key="id"
        :scroll="{ x: 'max-content' }"
        :pagination="{
          total: serverMode ? remote.total.value : rows.length,
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['8', '20', '50', '100'],
          onChange: (current: number, size: number) => {
            page = current;
            pageSize = size;
          },
        }"
      >
        <template #bodyCell="{ column, record }">
          <EvidenceMetric v-if="String(column.key).startsWith('core:')" :metric="core.metric(record as Site, column.key)" />
          <template v-if="column.key === 'brand'">
            <button
              class="hci-link"
              @click="selected = state.sites.find((s) => s.id === record.id)"
            >
              <ProductText :text="record.brand" :translated="record.brandZh" />
            </button>
            <div class="hci-subtle">
              {{ record.domain }}
              <CompactTags :items="sources(record as Site)" label="数据来源" color="blue" />
            </div> </template
          ><template v-if="column.key === 'assessment'"
            ><button class="hci-link" @click="selected = record as Site">
              {{ record.assessment?.score ?? '—'
              }}<span
                v-if="
                  record.assessment?.score !== null &&
                  record.assessment?.score !== undefined
                "
              >
                /100</span
              >
            </button>
            <div>
              <Tag>{{ record.assessment?.grade || '待评分' }}</Tag
              ><small>覆盖{{ record.assessment?.coverage ?? 0 }}%</small>
            </div> </template
          ><template v-if="column.key === 'market'">
            <Tag>{{ marketName(record.market) }}</Tag> </template
          ><template v-if="column.key === 'keywords'">
            <div class="hci-site-keywords">
            <Button
              v-for="item in siteKeywords(record as Site)"
              :key="item.id"
              type="link"
              size="small"
              :title="item.source ? `来源站点 ${item.source} 的关键词` : '已关联关键词'"
              @click="openKeyword(item.id)"
            >{{ item.label }}</Button>
            <span v-if="!record.keywordIds?.length" class="hci-subtle">未关联实际检索词</span>
            <small v-if="record.sourceKeywordLinks?.some((item: NonNullable<Site['sourceKeywordLinks']>[number]) => item.keywordIds.length)" class="hci-subtle">含来源站点关键词</small>
            </div>
          </template>
          <template v-if="column.key === 'discoverySources'">
            <div v-for="(item, index) in siteKeywordProvenance(record as Site).discoveries" :key="index" class="hci-source-summary">
              <template v-if="item.domain">与 <button class="hci-link" :aria-label="`筛选站点 ${item.domain}`" @click="filterSourceSite(item.domain, record as Site)">{{ item.domain }}</button> 竞争搜索广告关键词的站点</template>
              <template v-else>{{ item.text }}</template>
              <small class="hci-subtle">{{ item.source }}</small>
              <small v-if="record.sourceKeywordLinks?.find((link: NonNullable<Site['sourceKeywordLinks']>[number]) => link.domain === item.domain)?.keywordIds.length" class="hci-subtle">已记录来源站点关键词</small>
              <small v-else-if="!siteKeywordProvenance(record as Site).queryTerms.length && item.domain" class="hci-subtle">来源站点暂无已记录关键词</small>
            </div>
            <span v-if="!siteKeywordProvenance(record as Site).discoveries.length" class="hci-subtle">{{ sources(record as Site).join('；') || '未记录' }}</span>
          </template>
          <template v-if="column.key === 'collectionEvidence'">
            <div v-for="(item, index) in siteKeywordProvenance(record as Site).evidence.slice(0, 2)" :key="index" class="hci-source-summary hci-clamp-2" :title="item.text">
              {{ item.source }}：{{ item.text || '已保存来源网址' }}
            </div>
            <button class="hci-link" @click="selected = record as Site">查看采集证据</button>
          </template
          ><template v-if="column.key === 'collectedAt'">
              <CollectionTime :at="siteCollectedAt(record)" />
          </template><template v-if="column.key === 'mainProducts'">
            <ProductText :text="record.mainProducts.join('；')" :translated="record.mainProductsZh?.join('；')" /> </template
          ><template v-if="column.key === 'ownership'">
            <Tag
              :color="
                record.ownershipBackground.includes('待') ? 'orange' : 'blue'
              "
            >
              {{ record.ownershipBackground }}
            </Tag>
            <div class="hci-subtle">
              <span class="hci-clamp-2">{{ record.ownershipSource }}</span>
            </div> </template
          ><template v-if="column.key === 'products'">
            <Button type="link" size="small"
              :disabled="!relatedCount(record as Site, 'products')"
              :aria-label="`查看 ${record.domain} 的关联商品`"
              @click="openRelated('products', record as Site)"
            >{{ relatedCount(record as Site, 'products') ?? '—' }} 条</Button>
            <p v-if="record.productCollection" class="hci-subtle">
              {{
                record.productCollection.status === 'running'
                  ? '采集中'
                  : record.productCollection.status === 'partial'
                    ? '部分完成'
                    : record.productCollection.status === 'empty'
                      ? '未提取到商品'
                      : '目录采集结束'
              }}
              · {{ record.productCollection.count || 0 }} 件
            </p> </template>
          <template v-if="column.key === 'ads'">
            <Button type="link" size="small"
              :disabled="!relatedCount(record as Site, 'ads')"
              :aria-label="`查看 ${record.domain} 的关联广告`"
              @click="openRelated('ads', record as Site)"
            >{{ relatedCount(record as Site, 'ads') ?? '—' }} 条</Button>
          </template
          ><template v-if="column.key === 'actions'">
            <ProductCollectDialog :site-ids="[record.id]" />
            <CompetitorWatchPanel kind="site" :site-id="record.id" />
            <button
              class="hci-link"
              @click="selected = state.sites.find((s) => s.id === record.id)"
            >
              查看档案 →
            </button>
          </template>
        </template>
      </Table>
    </section>
    <SiteDrawer :id="selected?.id" @close="selected = undefined" />
  </main>
</template>
<style scoped>
.hci-site-keywords { display: flex; flex-wrap: wrap; gap: 4px; max-width: 240px; }
.hci-site-keywords :deep(.ant-btn) { height: auto; max-width: 100%; white-space: normal; text-align: left; overflow-wrap: anywhere; }
.hci-source-summary { max-width: 280px; white-space: normal; overflow-wrap: anywhere; margin-bottom: 4px; }
.hci-source-summary small { display: block; }
</style>

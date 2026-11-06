<script setup lang="ts">
import type { Ad, Product, Site } from './data';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Checkbox,
  Pagination,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Tag,
  Segmented,
  Table,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import SourceFieldsButton from './components/SourceFieldsButton.vue';
import CoreMetricsPanel from './components/CoreMetricsPanel.vue';
import EvidenceMetric from './components/EvidenceMetric.vue';
import { useCoreList } from './use-core-list';
const core = useCoreList('ads');
const displayMode = ref('list');
const adColumns = [{ title: '广告主 / 素材', key: 'brand', width: 290, fixed: 'left' as const }, { title: '关联关键词', key: 'keywords', width: 190 }, { title: '抓取批次', key: 'batch', width: 140 }, { title: '市场', key: 'market', width: 90 }, { title: '平台', key: 'platform', dataIndex: 'platform', width: 100 }, { title: '数据来源', key: 'source', dataIndex: 'source', width: 150 }, { title: '操作', key: 'actions', width: 100, fixed: 'right' as const }];
import SelectionBar from './components/SelectionBar.vue';
import { useFilteredSelection } from './resource-list';
import AdsResearchPanel from './components/AdsResearchPanel.vue';
import AdMedia from './components/AdMedia.vue';
import CompetitorWatchPanel from './components/CompetitorWatchPanel.vue';
import DiscoveryTag from './components/DiscoveryTag.vue';
import DailyDiscoveryPlan from './components/DailyDiscoveryPlan.vue';
import AdvertiserList from './components/AdvertiserList.vue';
import { discoveryDecision, discoveryFilters } from './discovery';
import { exportCsv, inMarket, marketName, state } from './data';
import { cloudRequest, syncCloudWorkspace } from './cloud-workspace';
import { loadWorkspaceDetail } from './cloud-workspace';
import { serverMode } from './session';
import { useWorkspaceList } from './workspace-queries';
import WorkspaceReadStatus from './components/WorkspaceReadStatus.vue';
const route = useRoute(),
  router = useRouter();
const search = ref(''),
  newness = ref('ALL'),
  status = ref('ALL'),
  selected = ref<Ad>(),
  open = ref(false),
  busy = ref(false),
  error = ref('');
const platformFilter = ref('ALL'), sourceFilter = ref('ALL'), batchFilter = ref('');
const linkedProduct = ref<string>(), linkedSite = ref<string>();
const keywordFilter = ref<string>();
const productSearch = ref(''), siteSearch = ref('');
const platformOptions = computed(() => [{ label: '全部平台', value: 'ALL' }, ...(serverMode ? remote.facets.value.platform || [] : [...new Set(state.ads.map(a => a.platform))]).map(value => ({label: value, value}))]);
const sourceOptions = computed(() => [{ label: '全部数据来源', value: 'ALL' }, ...(serverMode ? remote.facets.value.source || [] : [...new Set(state.ads.map(a => a.source).filter(Boolean))]).map(value => ({label: value, value}))]);
const keywordIds = ref<string[]>([]);
const keywordInput = ref('');
const parsedTerms = computed(() => [...new Map(keywordInput.value.split(/[\n,，;；]+/u).map((term) => term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim()).filter(Boolean).map((term) => [term.toLocaleLowerCase(), term])).values()]);
const viewTab = computed(() => route.path === '/advertisers' ? 'advertisers' : route.path === '/ad-reports' ? 'reports' : 'ads');
watch(() => [route.query.tab, route.query.report], () => {
  if (route.path !== '/ads') return;
  if (route.query.tab === 'advertisers' || route.query.report) {
    const { tab: _tab, ...query } = route.query;
    void router.replace({ path: route.query.report ? '/ad-reports' : '/advertisers', query });
  }
}, { immediate: true });
watch(() => route.query.site, value => { linkedSite.value = typeof value === 'string' ? value : undefined; }, { immediate: true });
watch(() => route.query.keywordId, value => { keywordFilter.value = typeof value === 'string' ? value : undefined; }, { immediate: true });
watch(() => route.query.pageId, (value) => {
  if (value) { search.value = String(value); status.value = 'ALL'; newness.value = 'ALL'; }
}, { immediate: true });
const advertiser = ref<Ad>();
const form = reactive({
  market: (state.market === 'ALL' ? 'US' : state.market) as 'US' | 'MX' | 'VN',
  batch: '',
  maxPages: 3,
  maxAds: 100,
  maxSites: 10,
  adStatus: 'ACTIVE',
});
const keywordOptions = computed(() => serverMode ? (remote.facets.value.keywords || []).map((k) => ({ ...k, id: k.value })) :
  state.keywords.map((k) => ({ ...k, value: k.id, label: `${k.term} · ${k.market}` })));
const keywords = computed(() => keywordOptions.value.filter((k) => k.reviewStatus === 'selected'));
const allKeywords = computed(() => serverMode ? keywordOptions.value : state.keywords.map((k) => ({ ...k, id: k.id, value: k.id, label: `${k.term} · ${k.market}` })));
const rows = computed(() => serverMode ? remote.rows.value :
  state.ads
    .filter(
      (a) =>
        inMarket(a.market) &&
        `${a.brand} ${a.brandZh || ''} ${a.headline} ${a.headlineZh || ''} ${a.copy} ${a.copyZh || ''} ${a.query || ''} ${a.pageId || ''}`
          .toLowerCase()
          .includes(search.value.toLowerCase()) &&
        (!batchFilter.value || a.collectionBatches?.some((batch) => batch.toLocaleLowerCase().includes(batchFilter.value.toLocaleLowerCase()))) &&
        (platformFilter.value === 'ALL' || a.platform === platformFilter.value) &&
        (sourceFilter.value === 'ALL' || a.source === sourceFilter.value) &&
        (status.value === 'ALL' || a.status === status.value) &&
        (newness.value === 'ALL' ||
          (newness.value === 'discovered' ? discoveryDecision(a, 'ad').recentDiscovery
            : String(discoveryDecision(a, 'ad').isNew === null ? 'unknown' : discoveryDecision(a, 'ad').isNew ? 'yes' : 'no') === newness.value)) &&
        (!keywordFilter.value || a.keywordIds?.includes(keywordFilter.value)) &&
        (!linkedSite.value || a.siteIds?.includes(linkedSite.value)) &&
        (!linkedProduct.value || a.productId === linkedProduct.value),
    )
    .toSorted((a, b) =>
      (b.lastCollectedAt || b.firstSeenAt || '').localeCompare(
        a.lastCollectedAt || a.firstSeenAt || '',
      ),
    ),
);
const page = ref(1);
const pageSize = ref(20);
const remote = useWorkspaceList<Ad>('ads', computed(() => ({ market: state.market, search: search.value,
  enabled: viewTab.value !== 'advertisers', platform: platformFilter.value, source: sourceFilter.value, batch: batchFilter.value, status: status.value, newness: newness.value, keywordId: keywordFilter.value || route.query.keywordId, linkedSite: linkedSite.value, linkedProduct: linkedProduct.value,
})), page, pageSize);
const productLookup = useWorkspaceList<Product>('products', computed(() => ({ enabled: viewTab.value === 'ads', market: state.market, search: productSearch.value })), ref(1), ref(50));
const siteLookup = useWorkspaceList<Site>('sites', computed(() => ({ enabled: viewTab.value === 'ads', market: state.market, search: siteSearch.value })), ref(1), ref(50));
const productOptions = computed(() => (serverMode ? productLookup.rows.value : state.products.filter(p => inMarket(p.market))).map(p => ({ value: p.id, label: `${p.titleZh || p.title} · ${p.market} · ${p.sourcePlatform || '未记录平台'} · ${p.sourceProductId || p.id}` })));
const siteOptions = computed(() => (serverMode ? siteLookup.rows.value : state.sites.filter(s => inMarket(s.market))).map(s => ({ value: s.id, label: `${s.brand} · ${s.domain}` })));
const { ids: bulkIds, selectable, selectAll, clear } = useFilteredSelection(rows, undefined, serverMode ? remote.selectAll : undefined);
const pagedRows = computed(() => serverMode ? rows.value : rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch(() => selected.value?.id, async (id) => {
  if (!id || !serverMode) return;
  try {
    await loadWorkspaceDetail('ads', id);
    if (selected.value?.id === id) selected.value = state.ads.find((row) => row.id === id);
  } catch (cause) { message.error((cause as Error).message); }
});
const adResearch = ref<InstanceType<typeof AdsResearchPanel>>();
watch([search, status, newness, platformFilter, sourceFilter, batchFilter, linkedProduct, linkedSite, keywordFilter, () => state.market, () => route.query], () => { page.value = 1; clear(); });
watch([keywordInput, () => form.market, () => form.batch, () => form.maxPages, () => form.maxAds, () => form.maxSites, () => form.adStatus], () => {
  pendingRequest = '';
});
function keywordLabel(id: string) {
  const value = allKeywords.value.find((item) => item.id === id || item.value === id);
  return value?.term || value?.label || id;
}
function adKeywords(ad: Ad) {
  return (ad.keywordIds || []).map((id) => ({ id, label: keywordLabel(id) }));
}
function openKeyword(id: string) {
  void router.push({ path: '/research', query: { keywordId: id } });
}
function fillLinkedTerms() {
  if (!keywordIds.value.length || keywordInput.value.trim()) return;
  const linked = keywordIds.value.map((id) => keywords.value.find((keyword) => keyword.id === id)).filter((keyword) => !!keyword);
  if (linked[0]) form.market = linked[0].market;
  keywordInput.value = linked.map((keyword) => keyword.term).join('\n');
}
watch(keywords, fillLinkedTerms);
function begin() {
  advertiser.value = undefined;
  keywordIds.value = route.query.keywordId
    ? [String(route.query.keywordId)]
    : [];
  keywordInput.value = '';
  form.market = state.market === 'ALL' ? 'US' : state.market;
  fillLinkedTerms();
  error.value = '';
  open.value = true;
}
let pendingRequest = '';
watch(() => state.market, () => {
  selected.value = undefined;
  advertiser.value = undefined;
  keywordIds.value = [];
  keywordInput.value = '';
  pendingRequest = '';
  open.value = false;
  search.value = '';
  linkedProduct.value = undefined;
  linkedSite.value = undefined;
});
async function submit() {
  if (busy.value) return;
  if (!parsedTerms.value.length || parsedTerms.value.length > 100 || parsedTerms.value.some((term) => term.length > 120)) {
    error.value = '请输入1～100个不重复关键词，每词最多120字';
    return;
  }
  const selectedTerms = parsedTerms.value.map((term) => ({ term, keyword: keywords.value.find((keyword) => keyword.market === form.market && keyword.term.normalize('NFKC').toLocaleLowerCase() === term.toLocaleLowerCase() && (!advertiser.value || advertiser.value.keywordIds?.includes(keyword.id))) }));
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    pendingRequest ||= crypto.randomUUID();
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_market',
      {
        requestId: pendingRequest,
        kind: 'ads',
        adId: advertiser.value?.id,
        keywordIds: selectedTerms.flatMap(({ keyword }) => keyword ? [keyword.id] : []),
        terms: selectedTerms.flatMap(({ term, keyword }) => keyword ? [] : [term]),
        ...form,
      },
    );
    pendingRequest = '';
    open.value = false;
    message.success('广告与官网采集已提交后台，关闭页面也会继续');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '任务提交失败';
  } finally {
    busy.value = false;
  }
}
const time = (v?: string) => (v ? new Date(v).toLocaleString('zh-CN') : '—');
const chineseFirst = (translated?: string, original?: string, missing = '来源未提供') =>
  translated || (original ? /\p{Script=Han}/u.test(original) ? original : '中文待翻译' : missing);
const showOriginal = (translated?: string, original?: string) => !!original && translated !== original && (!/\p{Script=Han}/u.test(original) || !!translated);
watch([() => route.query.ad], async () => {
  if (route.query.ad) {
    if (serverMode) try { await loadWorkspaceDetail('ads', String(route.query.ad)); } catch (cause) { message.error((cause as Error).message); return; }
    selected.value = state.ads.find((ad) => ad.id === String(route.query.ad));
  }
}, { immediate: true });
async function exportAds() {
  try {
    const records = serverMode ? await remote.exportRows(bulkIds.value) : rows.value.filter((row) => !bulkIds.value.length || bulkIds.value.includes(row.id));
    exportCsv('广告完整数据.csv', records.map((row) => ({ 广告主中文: row.brandZh || '', 广告主原文: row.brand, 素材标题中文: row.headlineZh || '', 素材标题原文: row.headline, 广告文案中文: row.copyZh || '', 广告文案原文: row.copy, 抓取批次: row.collectionBatches?.join('；') || '', 广告ID: row.archiveId || row.id, ...core.exportRecord(row) })));
  } catch (cause) { message.error((cause as Error).message); }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader title="广告观察" description=""
      ><Button @click="router.push('/imports')">导入资料</Button
      ><Button :disabled="!rows.length" @click="exportAds">完整导出</Button><Button type="primary" @click="begin"
        >采集广告与独立站</Button
      ><SourceFieldsButton kind="ads" :ids="bulkIds" /></PageHeader
    >
    <AdsResearchPanel v-if="viewTab !== 'advertisers'" ref="adResearch" :ads="serverMode ? state.ads : rows" :show-list="viewTab === 'reports'" />
    <section v-if="viewTab === 'ads'" class="hci-panel">
      <div class="hci-toolbar hci-filter-toolbar ad-filters">
        <Input.Search
          v-model:value="search"
          placeholder="搜索关键词、品牌或广告文案"
          aria-label="检索广告"
          allow-clear
        /><Input v-model:value="batchFilter" class="ad-batch-filter" placeholder="检索抓取批次" allow-clear aria-label="按抓取批次筛选广告" /><Select
          v-model:value="status"
          aria-label="广告状态"
          :options="[
            { label: '全部广告状态', value: 'ALL' },
            { label: '投放中', value: '投放中' },
            { label: '已停止', value: '已停止' },
          ]"
        />
        <Select v-model:value="platformFilter" :options="platformOptions" show-search option-filter-prop="label" aria-label="按广告平台筛选" />
        <Select v-model:value="sourceFilter" :options="sourceOptions" show-search option-filter-prop="label" aria-label="按广告数据来源筛选" />
        <Select v-model:value="keywordFilter" :options="allKeywords" :loading="remote.loading.value" show-search option-filter-prop="label" allow-clear placeholder="关联关键词" aria-label="按关联关键词筛选广告" />
        <Select v-model:value="linkedProduct" :options="productOptions" :loading="productLookup.loading.value" show-search :filter-option="serverMode ? false : undefined" option-filter-prop="label" allow-clear placeholder="关联商品" aria-label="检索关联商品" @search="value => productSearch = value" />
        <Select v-model:value="linkedSite" :options="siteOptions" :loading="siteLookup.loading.value" show-search :filter-option="serverMode ? false : undefined" option-filter-prop="label" allow-clear placeholder="关联独立站" aria-label="检索关联独立站" @search="value => siteSearch = value" />
        <Select v-model:value="newness" :options="discoveryFilters" aria-label="广告新旧标签" />
        <span class="hci-toolbar-end hci-subtle"
          >{{ serverMode ? remote.total.value : rows.length }} 条广告</span
        >
      </div>
      <div class="hci-toolbar"><CompetitorWatchPanel kind="advertiser" /><DailyDiscoveryPlan /><Segmented v-model:value="displayMode" :options="[{ label: '素材视图', value: 'cards' }, { label: '列表', value: 'list' }]" aria-label="广告显示方式" /></div>
      <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
      <SelectionBar :count="bulkIds.length" :total="serverMode ? remote.total.value : selectable.length" @all="selectAll" @clear="clear"><Button size="small" :disabled="!bulkIds.length || bulkIds.length > 100" @click="adResearch?.begin(bulkIds)">分析所选广告</Button><span v-if="bulkIds.length > 100" class="hci-subtle">每份报告最多100条，请缩小筛选</span></SelectionBar>
      <Empty
        v-if="!rows.length"
        description="暂无广告；输入关键词采集，或导入真实广告资料"
      />
      <Table v-if="displayMode === 'list' && rows.length" size="small" row-key="id" :columns="core.columns(adColumns)" :data-source="pagedRows" :pagination="false" :scroll="{ x: 'max-content' }" :row-selection="{ selectedRowKeys: bulkIds, onChange: (keys) => bulkIds = keys.map(String), getCheckboxProps: (a) => ({disabled:a.dataNature === 'demo'}) }">
        <template #bodyCell="{column,record}">
          <EvidenceMetric v-if="String(column.key).startsWith('core:')" :metric="core.metric(record as Ad,column.key)" />
          <template v-else-if="column.key === 'brand'"><Button type="link" class="ad-brand-link" @click="selected = record as Ad">{{ chineseFirst(record.brandZh, record.brand, '广告主待识别') }}</Button><p v-if="showOriginal(record.brandZh, record.brand)" class="hci-subtle hci-clamp-2">{{ record.brand }}</p><p class="hci-clamp-2">{{ chineseFirst(record.headlineZh, record.headline, '来源未提供素材标题') }}</p><p v-if="showOriginal(record.headlineZh, record.headline)" class="hci-subtle hci-clamp-2">{{ record.headline }}</p></template>
          <template v-else-if="column.key === 'keywords'"><Button v-for="item in adKeywords(record as Ad)" :key="item.id" type="link" size="small" @click="openKeyword(item.id)">{{ item.label }}</Button><span v-if="!record.keywordIds?.length" class="hci-subtle">未关联</span></template>
          <template v-else-if="column.key === 'batch'">{{ record.collectionBatches?.join('；') || '未标记' }}</template>
          <template v-else-if="column.key === 'market'">{{ marketName(record.market) }}</template>
          <Button v-else-if="column.key === 'actions'" size="small" @click="selected = record as Ad">详情</Button>
        </template>
      </Table>
      <div v-else-if="rows.length" class="hci-ad-grid">
        <article v-for="ad in pagedRows" :key="ad.id" class="hci-ad-card">
          <div class="hci-card-select"><Checkbox :checked="bulkIds.includes(ad.id)" :disabled="ad.dataNature === 'demo'" :aria-label="`选择广告 ${ad.headline || ad.id}`" @change="bulkIds = $event.target.checked ? [...bulkIds, ad.id] : bulkIds.filter((id) => id !== ad.id)" /></div>
          <AdMedia :ad="ad" />
          <div class="hci-ad-content">
            <div class="hci-panel-head">
              <strong>{{ chineseFirst(ad.brandZh, ad.brand, '广告主待识别') }}</strong
              ><Tag :color="ad.status === '投放中' ? 'green' : 'default'">{{
                ad.status
              }}</Tag>
            </div>
            <p v-if="showOriginal(ad.brandZh, ad.brand)" class="hci-subtle">{{ ad.brand }}</p>
            <p>{{ chineseFirst(ad.headlineZh, ad.headline, '来源未提供素材标题') }}</p>
            <p v-if="showOriginal(ad.headlineZh, ad.headline)" class="hci-subtle">{{ ad.headline }}</p>
            <DiscoveryTag :item="ad" kind="ad" />
            <p class="hci-ad-copy">{{ chineseFirst(ad.copyZh, ad.copy, '未返回广告文案') }}</p>
            <p v-if="showOriginal(ad.copyZh, ad.copy)" class="hci-subtle hci-clamp-2">{{ ad.copy }}</p>
            <p class="hci-subtle">
              {{ marketName(ad.market) }} · 平台：{{ ad.platform || '未记录' }} · 来源：{{ ad.source || '人工导入' }} ·
              {{ time(ad.lastCollectedAt || ad.firstSeenAt) }} · 批次：{{ ad.collectionBatches?.join('、') || '未标记' }}
            </p>
             <div class="hci-subtle">关联关键词：<Button v-for="item in adKeywords(ad)" :key="item.id" type="link" size="small" @click="openKeyword(item.id)">{{ item.label }}</Button><span v-if="!ad.keywordIds?.length">未关联</span></div>
            <div class="hci-toolbar">
              <Button size="small" @click="selected = ad">查看详情</Button
              ><a
                v-if="ad.evidenceUrl"
                :href="ad.evidenceUrl"
                target="_blank"
                rel="noreferrer"
                >广告原文</a
              ><span>{{ ad.siteIds?.length || 0 }} 家关联站点</span>
            </div>
          </div>
        </article>
      </div>
      <div v-if="rows.length" class="hci-list-pagination"><Pagination :current="page" :page-size="pageSize" :total="serverMode ? remote.total.value : rows.length" :show-size-changer="true" :page-size-options="['10','20','50','100']" @change="(current: number, size: number) => { page = current; pageSize = size; }" /></div>
    </section>
    <AdvertiserList v-else-if="viewTab === 'advertisers'" :ads="rows" :page-id="typeof route.query.pageId === 'string' ? route.query.pageId : undefined" @ads="(pageId) => { search=pageId; router.push({ path: '/ads', query: { pageId } }); }" />
    <Drawer
      :open="!!selected"
      title="广告详情与来源"
      root-class-name="hci-resource-drawer"
      width="min(940px, 100vw)"
      @close="selected = undefined"
    >
      <template v-if="selected"
        ><header class="hci-resource-hero"><div class="hci-resource-heading"><p class="hci-eyebrow">{{ marketName(selected.market) }} · {{ selected.platform }}</p><h2>{{ chineseFirst(selected.brandZh, selected.brand, '广告主待识别') }}</h2><p v-if="showOriginal(selected.brandZh, selected.brand)" class="hci-subtle">原文：{{ selected.brand }}</p><p>{{ chineseFirst(selected.headlineZh, selected.headline, '来源未提供素材标题') }}</p><p v-if="showOriginal(selected.headlineZh, selected.headline)" class="hci-subtle">原文：{{ selected.headline }}</p></div><Tag>{{ selected.status }}</Tag></header>
        <div class="hci-ad-detail-layout"><div><AdMedia :ad="selected" expanded />
        <DiscoveryTag :item="selected" kind="ad" details />
        <CompetitorWatchPanel v-if="selected.pageId" kind="advertiser" :ad-id="selected.id" />
        </div><section class="hci-detail-section"><h3>广告文案</h3><p class="hci-resource-copy">{{ chineseFirst(selected.copyZh, selected.copy, '来源未提供文案') }}</p><p v-if="showOriginal(selected.copyZh, selected.copy)" class="hci-subtle">原文：{{ selected.copy }}</p></section></div>
        <CoreMetricsPanel kind="ads" :record="selected" />
        <dl class="hci-detail-grid">
          <dt>广告 ID</dt>
          <dd>{{ selected.archiveId || '—' }}</dd>
          <dt>广告主 Page ID</dt>
          <dd>{{ selected.pageId || '来源未提供' }}</dd>
          <dt>查询关键词</dt>
          <dd>{{ selected.query || '—' }}</dd>
          <dt>抓取批次</dt>
          <dd>{{ selected.collectionBatches?.join('；') || '未标记' }}</dd>
          <dt>平台记录开始日期</dt>
          <dd>{{ time(selected.startDate) }}</dd>
          <dt>本系统首次观察</dt>
          <dd>{{ time(selected.firstSeenAt) }}</dd>
          <dt>采集时间</dt>
          <dd>{{ time(selected.lastCollectedAt) }}</dd>
          <dt>数据来源</dt>
          <dd>{{ selected.source || '人工导入' }}</dd>
        </dl>
        <Button
          v-if="selected.pageId"
          @click="
            advertiser = selected;
            keywordIds = (selected.keywordIds || []).filter((id) =>
              keywords.some((k) => k.id === id),
            );
            keywordInput = selected.query || '';
            form.market = selected.market;
            open = true;
            selected = undefined;
          "
          >采集该广告主更多广告</Button
        >
        <h3>落地页与官网验证</h3>
        <p v-for="v in selected.verification" :key="v.url">
          <a :href="v.url" target="_blank" rel="noreferrer">{{ v.url }}</a
          ><br /><Tag :color="v.status === 'verified' ? 'green' : 'orange'">{{
            v.status === 'verified' ? '已通过官网验证' : '未通过验证'
          }}</Tag
          >{{ v.reason
          }}<Button
            v-if="v.siteId"
            size="small"
            @click="router.push({ path: '/sites', query: { site: v.siteId } })"
            >查看独立站</Button
          >
        </p>
        <p class="hci-subtle">
          公开广告库仅提供素材与投放观察信息，不含花费、曝光、点击或成交指标。素材仅保存来源链接，可能过期。
        </p></template
      >
    </Drawer>
    <Modal
      v-model:open="open"
      :title="
        advertiser ? `采集广告主 · ${chineseFirst(advertiser.brandZh, advertiser.brand, '广告主待识别')}` : '采集广告与关联独立站'
      "
      :confirm-loading="busy"
      :closable="!busy"
      :mask-closable="!busy"
      ok-text="提交后台采集"
      cancel-text="取消"
      @ok="submit"
    >
      <Form layout="vertical">
        <Form.Item label="检索关键词">
          <Input.TextArea v-model:value="keywordInput" :rows="3" :maxlength="12100" placeholder="输入关键词，多个词用换行或逗号分隔" aria-label="广告检索关键词" />
        </Form.Item>
        <div class="hci-form-grid">
          <Form.Item label="目标市场"><Select v-model:value="form.market" :options="[{ label: '美国', value: 'US' }, { label: '墨西哥', value: 'MX' }, { label: '越南', value: 'VN' }]" /></Form.Item>
          <Form.Item label="抓取批次（可选）"><Input v-model:value="form.batch" :maxlength="100" placeholder="例如：11月新品观察" /></Form.Item>
        </div>
        <div class="hci-form-grid">
          <Form.Item label="每词最多查询页数"
            ><InputNumber
              v-model:value="form.maxPages"
              :min="1"
              :max="10" /></Form.Item
          ><Form.Item label="每词广告数量上限"
            ><InputNumber
              v-model:value="form.maxAds"
              :min="1"
              :max="100" /></Form.Item
          ><Form.Item label="每词验证站点上限"
            ><InputNumber
              v-model:value="form.maxSites"
              :min="1"
              :max="20" /></Form.Item
          >
        </div>
        <Form.Item label="广告状态"
          ><Select
            v-model:value="form.adStatus"
            :options="[
              { label: '正在投放', value: 'ACTIVE' },
              { label: '全部', value: 'ALL' },
              { label: '已停止', value: 'INACTIVE' },
            ]"
        /></Form.Item>
        <Alert
          type="info"
          show-icon
          :message="`已输入 ${parsedTerms.length} 个词；广告最多请求 ${parsedTerms.length * form.maxPages} 次，按服务商额度计费。`"
        />
        <p class="hci-subtle">
          每页通常计 1
          credit，以接口回报为准。按所选页数与广告数采集。站点评分另外使用现有
          Semrush 额度并优先复用30天缓存。不会自动购买额度。
        </p>
        <Alert v-if="error" type="error" :message="error" show-icon />
      </Form>
    </Modal>
  </main>
</template>
<style scoped>
.ad-brand-link {
  display: block;
  width: 100%;
  height: auto;
  padding: 0;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}
:deep(.hci-toolbar.ad-filters > .ad-batch-filter) {
  flex: 0 1 160px;
  width: 160px;
  min-width: 140px;
}
@media (max-width: 767px) {
  :deep(.hci-toolbar.ad-filters > .ad-batch-filter) {
    flex: 1 1 calc(50% - 6px);
  }
}
</style>

<script setup lang="ts">
import type { Ad } from './data';
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
  Tabs,
  Table,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import CoreListControls from './components/CoreListControls.vue';
import CoreMetricsPanel from './components/CoreMetricsPanel.vue';
import EvidenceMetric from './components/EvidenceMetric.vue';
import { useCoreList } from './use-core-list';
const core = useCoreList('ads');
const { preset: corePreset, period: corePeriod } = core;
const adColumns = [{ title: '广告主 / 素材', key: 'brand', width: 270, fixed: 'left' as const }, { title: '市场', key: 'market', width: 90 }, { title: '操作', key: 'actions', width: 100, fixed: 'right' as const }];
import SelectionBar from './components/SelectionBar.vue';
import { useFilteredSelection } from './resource-list';
import AdsResearchPanel from './components/AdsResearchPanel.vue';
import AdMedia from './components/AdMedia.vue';
import CompetitorWatchPanel from './components/CompetitorWatchPanel.vue';
import DiscoveryTag from './components/DiscoveryTag.vue';
import DailyDiscoveryPlan from './components/DailyDiscoveryPlan.vue';
import AdvertiserList from './components/AdvertiserList.vue';
import { groupAdvertisers } from './advertisers';
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
const keywordIds = ref<string[]>([]);
const viewTab = ref('ads');
watch(() => route.query.tab, (value) => { if (value === 'advertisers' || value === 'ads') viewTab.value = value; }, { immediate: true });
const advertiserCount = computed(() => groupAdvertisers(rows.value, state.sites).length);
watch(() => route.query.pageId, (value) => {
  if (value) { search.value = ''; status.value = 'ALL'; newness.value = 'ALL'; }
}, { immediate: true });
const advertiser = ref<Ad>();
const form = reactive({
  maxPages: 3,
  maxAds: 100,
  maxSites: 10,
  maxRequests: 3,
  adStatus: 'ACTIVE',
});
const keywords = computed(() => serverMode ? (remote.facets.value.keywords || []).filter((k) => k.reviewStatus === 'selected').map((k) => ({ ...k, id: k.value })) :
  state.keywords.filter(
    (k) => k.reviewStatus === 'selected' && inMarket(k.market),
  ),
);
const rows = computed(() => serverMode ? remote.rows.value :
  state.ads
    .filter(
      (a) =>
        inMarket(a.market) &&
        `${a.brand} ${a.headline} ${a.copy} ${a.query || ''} ${a.pageId || ''}`
          .toLowerCase()
          .includes(search.value.toLowerCase()) &&
        (status.value === 'ALL' || a.status === status.value) &&
        (newness.value === 'ALL' ||
          (newness.value === 'discovered' ? discoveryDecision(a, 'ad').recentDiscovery
            : String(discoveryDecision(a, 'ad').isNew === null ? 'unknown' : discoveryDecision(a, 'ad').isNew ? 'yes' : 'no') === newness.value)) &&
        (!route.query.keywordId ||
          a.keywordIds?.includes(String(route.query.keywordId))) &&
        (!route.query.site || a.siteIds?.includes(String(route.query.site))),
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
  status: status.value, newness: newness.value, keywordId: route.query.keywordId, linkedSite: route.query.site,
})), page, pageSize);
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
watch([search, status, newness, () => state.market, () => route.query], () => { page.value = 1; clear(); });
watch([() => keywordIds.value.length, () => form.maxPages], () => {
  form.maxRequests = Math.max(
    1,
    Math.min(1000, keywordIds.value.length * form.maxPages),
  );
  pendingRequest = '';
});
function begin() {
  advertiser.value = undefined;
  keywordIds.value = route.query.keywordId
    ? [String(route.query.keywordId)]
    : [];
  error.value = '';
  open.value = true;
}
let pendingRequest = '';
watch(() => state.market, () => {
  selected.value = undefined;
  advertiser.value = undefined;
  keywordIds.value = [];
  pendingRequest = '';
  open.value = false;
  search.value = '';
});
async function submit() {
  if (busy.value) return;
  if (!keywordIds.value.length) {
    error.value = '请选择已入选关键词';
    return;
  }
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
        keywordIds: keywordIds.value,
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
watch([() => route.query.ad], async () => {
  if (route.query.ad) {
    if (serverMode) try { await loadWorkspaceDetail('ads', String(route.query.ad)); } catch (cause) { message.error((cause as Error).message); return; }
    selected.value = state.ads.find((ad) => ad.id === String(route.query.ad));
  }
}, { immediate: true });
async function exportAds() {
  try {
    const records = serverMode ? await remote.exportRows(bulkIds.value) : rows.value.filter((row) => !bulkIds.value.length || bulkIds.value.includes(row.id));
    exportCsv('广告完整数据.csv', records.map((row) => ({ 广告主: row.brand, 广告ID: row.archiveId || row.id, ...core.exportRecord(row) })));
  } catch (cause) { message.error((cause as Error).message); }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader title="广告观察" description=""
      ><Button @click="router.push('/imports')">导入资料</Button
      ><Button :disabled="!rows.length" @click="exportAds">完整导出</Button><Button type="primary" @click="begin"
        >采集广告与独立站</Button
      ></PageHeader
    >
    <div class="hci-toolbar" style="margin-bottom: 16px"><CompetitorWatchPanel kind="advertiser" /><DailyDiscoveryPlan /><label for="ad-newness">广告新旧标签</label><Select id="ad-newness" v-model:value="newness" :options="discoveryFilters" style="min-width: 180px" /></div>
    <Tabs v-model:active-key="viewTab">
    <Tabs.TabPane key="ads" :tab="`广告素材（${serverMode ? remote.total.value : rows.length}）`">
    <AdsResearchPanel ref="adResearch" :ads="serverMode ? state.ads : rows" />
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索关键词、品牌或广告文案"
          allow-clear
        /><Select
          v-model:value="status"
          :options="[
            { label: '全部广告状态', value: 'ALL' },
            { label: '投放中', value: '投放中' },
            { label: '已停止', value: '已停止' },
          ]"
        /><Button v-if="route.query.site" @click="router.replace('/ads')"
          >清除站点筛选</Button
        ><span class="hci-toolbar-end hci-subtle"
          >{{ serverMode ? remote.total.value : rows.length }} 条广告</span
        >
      </div>
      <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
      <SelectionBar :count="bulkIds.length" :total="serverMode ? remote.total.value : selectable.length" @all="selectAll" @clear="clear"><Button size="small" :disabled="!bulkIds.length || bulkIds.length > 100" @click="adResearch?.begin(bulkIds)">分析所选广告</Button><span v-if="bulkIds.length > 100" class="hci-subtle">每份报告最多100条，请缩小筛选</span></SelectionBar>
      <Empty
        v-if="!rows.length"
        description="暂无广告；选择已入选关键词采集，或导入真实广告资料"
      />
      <CoreListControls v-model:preset="corePreset" v-model:period="corePeriod" kind="ads" />
      <Table v-if="corePreset !== 'original'" size="small" row-key="id" :columns="core.columns(adColumns)" :data-source="pagedRows" :pagination="false" :scroll="{ x: 'max-content' }" :row-selection="{ selectedRowKeys: bulkIds, onChange: (keys) => bulkIds = keys.map(String), getCheckboxProps: (a) => ({disabled:a.dataNature === 'demo'}) }">
        <template #bodyCell="{column,record}">
          <EvidenceMetric v-if="String(column.key).startsWith('core:')" :metric="core.metric(record as Ad,column.key)" />
          <template v-else-if="column.key === 'brand'"><Button type="link" @click="selected = record as Ad">{{ record.brand }}</Button><p class="hci-clamp-2">{{ record.headline }}</p></template>
          <template v-else-if="column.key === 'market'">{{ marketName(record.market) }}</template>
          <Button v-else-if="column.key === 'actions'" size="small" @click="selected = record as Ad">详情</Button>
        </template>
      </Table>
      <div v-else class="hci-ad-grid">
        <article v-for="ad in pagedRows" :key="ad.id" class="hci-ad-card">
          <div class="hci-card-select"><Checkbox :checked="bulkIds.includes(ad.id)" :disabled="ad.dataNature === 'demo'" :aria-label="`选择广告 ${ad.headline || ad.id}`" @change="bulkIds = $event.target.checked ? [...bulkIds, ad.id] : bulkIds.filter((id) => id !== ad.id)" /></div>
          <AdMedia :ad="ad" />
          <div class="hci-ad-content">
            <div class="hci-panel-head">
              <strong>{{ ad.brand || '广告主待识别' }}</strong
              ><Tag :color="ad.status === '投放中' ? 'green' : 'default'">{{
                ad.status
              }}</Tag>
            </div>
            <p>{{ ad.headline }}</p>
            <DiscoveryTag :item="ad" kind="ad" />
            <p class="hci-ad-copy">{{ ad.copy || '未返回广告文案' }}</p>
            <p class="hci-subtle">
              {{ marketName(ad.market) }} · {{ ad.source || '人工导入' }} ·
              {{ time(ad.lastCollectedAt || ad.firstSeenAt) }}
            </p>
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
    </Tabs.TabPane>
    <Tabs.TabPane key="advertisers" :tab="serverMode ? '广告主' : `广告主（${advertiserCount}）`">
      <AdvertiserList :ads="rows" :page-id="typeof route.query.pageId === 'string' ? route.query.pageId : undefined" @ads="(pageId) => { search=pageId; viewTab='ads'; }" />
    </Tabs.TabPane>
    </Tabs>
    <Drawer
      :open="!!selected"
      title="广告详情与来源"
      root-class-name="hci-resource-drawer"
      width="min(940px, 100vw)"
      @close="selected = undefined"
    >
      <template v-if="selected"
        ><header class="hci-resource-hero"><div class="hci-resource-heading"><p class="hci-eyebrow">{{ marketName(selected.market) }} · {{ selected.platform }}</p><h2>{{ selected.brand }}</h2><p>{{ selected.headline }}</p></div><Tag>{{ selected.status }}</Tag></header>
        <div class="hci-ad-detail-layout"><div><AdMedia :ad="selected" expanded />
        <DiscoveryTag :item="selected" kind="ad" details />
        <CompetitorWatchPanel v-if="selected.pageId" kind="advertiser" :ad-id="selected.id" />
        </div><section class="hci-detail-section"><h3>广告文案</h3><p class="hci-resource-copy">{{ selected.copy || '来源未提供文案' }}</p></section></div>
        <CoreMetricsPanel kind="ads" :record="selected" />
        <dl class="hci-detail-grid">
          <dt>广告 ID</dt>
          <dd>{{ selected.archiveId || '—' }}</dd>
          <dt>广告主 Page ID</dt>
          <dd>{{ selected.pageId || '来源未提供' }}</dd>
          <dt>查询关键词</dt>
          <dd>{{ selected.query || '—' }}</dd>
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
          投放状态和持续时间不代表真实销量、利润或
          ROAS。素材仅保存来源链接，可能过期。
        </p></template
      >
    </Drawer>
    <Modal
      v-model:open="open"
      :title="
        advertiser ? `采集广告主 · ${advertiser.brand}` : '采集广告与关联独立站'
      "
      :confirm-loading="busy"
      :closable="!busy"
      :mask-closable="!busy"
      ok-text="提交后台采集"
      cancel-text="取消"
      @ok="submit"
    >
      <Form layout="vertical">
        <Form.Item label="已入选关键词"
          ><Select
            v-model:value="keywordIds"
            mode="multiple"
            show-search
            option-filter-prop="label"
            :max-tag-count="3"
            :options="
              keywords.map((k) => ({
                label: `${k.term} · ${k.market}`,
                value: k.id,
              }))
            "
            @change="pendingRequest = ''"
        /></Form.Item>
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
          ><Form.Item label="本任务广告请求上限"
            ><InputNumber v-model:value="form.maxRequests" :min="1" :max="1000"
          /></Form.Item>
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
          :message="`已选 ${keywordIds.length} 个词；广告最多请求 ${Math.min(form.maxRequests, keywordIds.length * form.maxPages)} 次，按服务商额度计费。`"
        />
        <p class="hci-subtle">
          每页通常计 1
          credit，以接口回报为准。达到请求上限会停止并标记未完成。站点评分另外使用现有
          Semrush 额度并优先复用30天缓存。不会自动购买额度。
        </p>
        <Alert v-if="error" type="error" :message="error" show-icon />
      </Form>
    </Modal>
  </main>
</template>

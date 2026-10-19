<script setup lang="ts">
import type { Site } from './data';

import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Drawer,
  Input,
  message,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import ProductCollectDialog from './components/ProductCollectDialog.vue';
import { exportCsv, filteredSites, marketName, state } from './data';
import { cloudRequest, syncCloudWorkspace } from './cloud-workspace';
const router = useRouter();
const ids = ref<string[]>([]),
  scoring = ref(false),
  scoreError = ref('');
const sources = (s: Site) =>
  s.sources?.length
    ? s.sources
    : [s.dataNature === 'imported' ? '人工导入' : '历史采集 · 来源待核对'];
const source = ref('ALL');
const sourceOptions = computed(() => [
  { label: '全部数据来源', value: 'ALL' },
  ...[...new Set(filteredSites.value.flatMap(sources))].map((value) => ({
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
const search = ref('');
const platform = ref('ALL');
const category = ref('ALL');
const ownership = ref('ALL');
const keywordFilter = ref('');
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
const platformOptions = computed(() => [
  { label: '全部平台', value: 'ALL' },
  ...[...new Set(filteredSites.value.map((site) => site.platform))].map(
    (value) => ({ label: value, value }),
  ),
]);
const keywordOptions = computed(() => [
  { label: '全部关联关键词', value: '' },
  ...state.keywords
    .filter(
      (keyword) =>
        keyword.siteIds.length > 0 &&
        (state.market === 'ALL' || keyword.market === state.market),
    )
    .map((keyword) => ({
      label: `${keyword.term} · ${keyword.market}`,
      value: keyword.id,
    })),
]);
const collectedCount = computed(
  () => rows.value.filter((site) => site.dataNature === 'collected').length,
);
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
    if (
      keywordFilter.value &&
      !state.keywords.some(
        (keyword) =>
          keyword.id === keywordFilter.value &&
          (state.market === 'ALL' || keyword.market === state.market),
      )
    )
      keywordFilter.value = '';
  },
);
const rows = computed(() =>
  filteredSites.value.filter(
    (s) =>
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
      (source.value === 'ALL' || sources(s).includes(source.value)) &&
      (platform.value === 'ALL' || s.platform === platform.value) &&
      (category.value === 'ALL' || s.category === category.value) &&
      (ownership.value === 'ALL' ||
        s.ownershipBackground === ownership.value) &&
      (!keywordFilter.value ||
        state.keywords
          .find((keyword) => keyword.id === keywordFilter.value)
          ?.siteIds.includes(s.id)) &&
      (!linkedKeyword.value || linkedKeyword.value.siteIds.includes(s.id)),
  ),
);
const columns = [
  { title: '品牌 / 独立站', key: 'brand', width: 220 },
  { title: '市场', key: 'market', width: 90 },
  {
    title: '站点评分',
    key: 'assessment',
    width: 120,
    defaultSortOrder: 'descend' as const,
    sorter: (a: Site, b: Site) =>
      (a.assessment?.score ?? -1) - (b.assessment?.score ?? -1),
  },
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
    >
      <ProductCollectDialog :site-ids="ids" />
      <Button
        type="primary"
        :disabled="!ids.length || ids.length > 100"
        :loading="scoring"
        @click="scoreSelected"
        >补齐指标与站点评分（{{ ids.length }}）</Button
      ><Button @click="router.push('/imports')">导入站点</Button
      ><Button
        @click="
          exportCsv(
            '独立站.csv',
            rows.map((s) => ({
              品牌: s.brand,
              域名: s.domain,
              市场: s.market,
              类别: s.category,
              主要产品: s.mainProducts.join('、'),
              股权背景: s.ownershipBackground,
              官网依据: s.ownershipEvidence,
              证据网址: s.evidenceUrl || '',
              验证置信度: s.confidence ?? '',
              验证信号: s.signals?.join('、') || '',
              性质: s.dataNature === 'collected' ? '官网实采' : '演示',
            })),
          )
        "
        :disabled="!rows.length"
      >
        导出
      </Button>
    </PageHeader>
    <div v-if="route.query.keyword || linkedKeyword" class="hci-demo-note">
      <b>研究上下文</b>{{ linkedKeyword?.term || route.query.keyword }} ·
      {{
        linkedKeyword
          ? '仅显示已关联站点。'
          : '当前展示候选站点，具体关联需人工核验。'
      }}
      <button
        v-if="linkedKeyword"
        class="hci-link"
        style="margin-left: 12px"
        @click="router.replace('/sites')"
      >
        清除关联筛选
      </button>
    </div>
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索关键词、品牌、网址、商品或成分"
          allow-clear
        /><Select
          v-model:value="keywordFilter"
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
        /><span class="hci-toolbar-end hci-subtle"
          >{{ rows.length }} 家站点 · {{ collectedCount }} 家实采</span
        >
      </div>
      <Alert
        v-if="scoreError"
        :message="scoreError"
        type="error"
        show-icon
      /><Table
        :row-selection="{
          preserveSelectedRowKeys: true,
          selectedRowKeys: ids,
          onChange: (keys: any[]) => {
            ids = keys.map(String);
            scoreRequest = '';
          },
        }"
        :columns="columns"
        :data-source="rows"
        row-key="id"
        :scroll="{ x: 1250 }"
        :pagination="{ pageSize: 8 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'brand'">
            <button
              class="hci-link"
              @click="selected = state.sites.find((s) => s.id === record.id)"
            >
              {{ record.brand }}
            </button>
            <div class="hci-subtle">
              {{ record.domain }}
              <Tag
                v-for="label in sources(record as Site)"
                :key="label"
                color="blue"
                >{{ label }}</Tag
              >
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
          ><template v-if="column.key === 'mainProducts'">
            <div class="hci-compact-tags">
              <Tag v-for="item in record.mainProducts" :key="item">
                {{ item }}
              </Tag>
            </div> </template
          ><template v-if="column.key === 'ownership'">
            <Tag
              :color="
                record.ownershipBackground.includes('待') ? 'orange' : 'blue'
              "
            >
              {{ record.ownershipBackground }}
            </Tag>
            <div class="hci-subtle">
              {{ record.ownershipSource }}
            </div> </template
          ><template v-if="column.key === 'products'">
            {{ state.products.filter((p) => p.siteId === record.id).length }}
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
            </p> </template
          ><template v-if="column.key === 'actions'">
            <ProductCollectDialog :site-ids="[record.id]" />
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
    <Drawer
      :open="!!selected"
      :width="560"
      title="品牌与站点档案"
      @close="selected = undefined"
    >
      <template v-if="selected">
        <h2 style="font-size: 25px">{{ selected.brand }}</h2>
        <p class="hci-subtle">
          {{ selected.domain }} ·
          {{
            selected.dataNature === 'collected'
              ? '官网实采记录'
              : '虚构示例域名'
          }}
        </p>
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
          <dd>
            {{ sources(selected).join(' / ') }}
          </dd>
          <dt>首次观察</dt>
          <dd>
            {{ selected.lastCollectedAt || '未记录' }}（不等于品牌成立日期）
          </dd>
          <template v-if="selected.dataNature === 'collected'">
            <dt>验证置信度</dt>
            <dd>{{ selected.confidence ?? 0 }} / 100</dd>
            <dt>验证信号</dt>
            <dd>{{ selected.signals?.join('、') || '待补充' }}</dd>
          </template>
        </dl>
        <h3 class="hci-section-heading">
          站点评分 · {{ selected.assessment?.grade || '待评分' }} ·
          {{ selected.assessment?.score ?? '—' }} / 100
        </h3>
        <p class="hci-subtle">
          研究优先级，不是营收或盈利预测；{{
            selected.metricsStatus || '第三方指标待补充'
          }}。{{ selected.metricsMessage }}
        </p>
        <dl class="hci-detail-grid">
          <dt>自然搜索流量估算</dt>
          <dd>{{ selected.metrics?.organicTraffic ?? '—' }}</dd>
          <dt>自然关键词数</dt>
          <dd>{{ selected.metrics?.organicKeywords ?? '—' }}</dd>
          <dt>指标来源 / 市场 / 日期</dt>
          <dd>
            {{ selected.metrics?.source || '—' }} ·
            {{ selected.metrics?.market || '—' }} ·
            {{ selected.metrics?.collectedAt || '—' }}
          </dd>
        </dl>
        <div
          v-for="d in selected.assessment?.dimensions"
          :key="d.key"
          class="hci-evidence"
        >
          <strong
            >{{ d.label }} · 权重{{ d.weight }}% ·
            {{ d.value ?? '待补充' }}</strong
          >
          <p>{{ d.evidence }}</p>
        </div>
        <h3 class="hci-section-heading">发现来源与证据</h3>
        <p v-for="(e, i) in selected.sourceEvidence" :key="i">
          <Tag>{{ e.source }}</Tag
          >{{ e.keyword
          }}<a v-if="e.url" :href="e.url" target="_blank" rel="noreferrer">
            原始证据</a
          >
          {{ e.collectedAt }}
        </p>
        <Button
          @click="router.push({ path: '/ads', query: { site: selected.id } })"
          >查看关联广告</Button
        >
        <h3 class="hci-section-heading">官网股权与运营背景</h3>
        <dl class="hci-detail-grid">
          <dt>股权背景</dt>
          <dd>
            <Tag color="blue">{{ selected.ownershipBackground }}</Tag>
          </dd>
          <dt>运营主体</dt>
          <dd>{{ selected.ownershipOperations }}</dd>
          <dt>官网来源</dt>
          <dd>{{ selected.ownershipSource }}</dd>
        </dl>
        <div class="hci-evidence">
          <b>官网信息摘录</b><br />{{ selected.ownershipEvidence }}<br />
          <span class="hci-subtle">
            {{
              selected.dataNature === 'collected'
                ? '股权背景仍需继续采集 About、页脚及隐私政策后人工核验。'
                : '演示数据仅说明字段结构，真实结论需保留官网 URL、原文与采集时间。'
            }}
          </span>
        </div>
        <div class="hci-evidence">
          <template v-if="selected.evidenceUrl">
            已保留官网验证页面：
            <a :href="selected.evidenceUrl" target="_blank" rel="noreferrer"
              >打开官网证据</a
            >
          </template>
          <template v-else>
            此处将展示原始搜索命中、自然排名和采集批次。目前没有真实网页证据。
          </template>
        </div>
        <Button
          type="primary"
          @click="
            router.push({ path: '/products', query: { site: selected.id } })
          "
        >
          查看该站商品
        </Button>
        <ProductCollectDialog :site-ids="[selected.id]" />
        <Button
          @click="
            router.push({
              path: '/consumer-insights',
              query: { site: selected.id },
            })
          "
          >研究该品牌消费者需求</Button
        >
      </template>
    </Drawer>
  </main>
</template>

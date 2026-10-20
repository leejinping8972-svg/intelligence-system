<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -- Template wrapping is owned by oxfmt. */
import type {
  ContentCategory,
  ContentItem,
  ContentJob,
  ContentScope,
  ContentSnapshot,
  ContentStatus,
} from '../public-content';

import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  useId,
  watch,
} from 'vue';

import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Pagination,
  Progress,
  Radio,
  Select,
  Table,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { canReadArticle } from '../article-details';
import { download, marketOptions, state } from '../data';
import {
  contentCategories,
  contentCsv,
  contentDate,
  contentRequest,
  contentScopes,
  contentStates,
  contentTypes,
  filterContent,
  itemScopes,
} from '../public-content';
import { serverMode } from '../session';
import PublicContentDrawer from './PublicContentDrawer.vue';
import PublicContentHistory from './PublicContentHistory.vue';
const props = defineProps<{
  initialQuery?: string;
  initialMarket?: string;
  keywordIds?: string[];
  productIds?: string[];
  openSearchOnMount?: boolean;
}>();
const detailStepLabels: Record<string, string> = {
  article_fulltext: '文章正文与图表',
  youtube_metadata: '视频完整描述',
  europepmc_metadata: '研究摘要',
  reddit_details: '帖子原文',
  youtube_transcript: '视频字幕',
};

const requestedMarket = props.initialMarket || state.market;
const startingMarket = requestedMarket === 'ALL' ? 'US' : requestedMarket;
const languageForMarket = (market: string) =>
  ({ MX: 'es', VN: 'vi', US: 'en' })[market as 'MX' | 'US' | 'VN'] || 'en';
const form = reactive({
  query: props.initialQuery || '',
  market: startingMarket,
  language: languageForMarket(startingMarket),
  sources: [
    'youtube',
    'reddit',
    'local_health',
    'global_health',
    'medlineplus',
    'europepmc',
  ],
  scopes: ['local', 'global'] as ContentScope[],
  referenceQuery: '',
  referenceLanguage: 'en',
  limit: 30,
  fetchDetails: true,
  includeRelated: true,
  related: '',
  organize: false,
  keywordIds: props.keywordIds || [],
  productIds: props.productIds || [],
});
const sourceStatus = ref<ContentStatus>();
const searchOpen = ref(props.openSearchOnMount === true);
const searchFormId = useId();
const errorMessage = ref('');
const loading = ref(false);
const submitting = ref(false);
const saving = ref('');
const jobs = ref<ContentJob[]>([]);
const job = ref<ContentJob | null>(null);
const items = ref<ContentItem[]>([]);
const activeJob = ref('');
const showFavorites = ref(false);
const detailId = ref('');
const layout = ref('cards');
const page = ref(1);
const pageSize = ref(10);
const filter = reactive({
  category: 'ALL',
  type: 'ALL',
  source: 'ALL',
  language: 'ALL',
  since: 'ALL',
  search: '',
  favorites: false,
  scope: 'ALL',
});
const detail = computed(() => items.value.find((i) => i.id === detailId.value));
const result = computed(() => filterContent(items.value, filter));
const paged = computed(() =>
  result.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
const languageOptions = [
  { value: 'en', label: '英语' },
  { value: 'es', label: '西班牙语' },
  { value: 'vi', label: '越南语' },
];
const languages = computed(() => [
  { value: 'ALL', label: '全部来源语言' },
  ...[...new Set(items.value.map((i) => i.language))].map((value) => ({
    value,
    label: value === 'unknown' ? '来源未提供语言' : value,
  })),
]);
const sources = computed(() => [
  { value: 'ALL', label: '全部来源' },
  ...[...new Map(items.value.map((i) => [i.source, i.sourceLabel]))].map(
    ([value, label]) => ({ value, label }),
  ),
]);
const sourceOptions = computed(() =>
  (sourceStatus.value?.sources || [])
    .filter((s) => s.scopes.some((scope) => form.scopes.includes(scope)))
    .map((s) => ({
      value: s.id,
      label: `${s.label}${s.configured ? '' : '（未配置）'}`,
    })),
);
const selectedSources = computed(() =>
  (sourceStatus.value?.sources || []).filter(
    (source) =>
      form.sources.includes(source.id) &&
      source.scopes.some((scope) => form.scopes.includes(scope)),
  ),
);
const missingScope = computed(() =>
  form.scopes.some(
    (scope) =>
      !selectedSources.value.some((source) => source.scopes.includes(scope)),
  ),
);
watch(
  () => [...form.scopes],
  (scopes, previous) => {
    const available = sourceStatus.value?.sources || [];
    form.sources = form.sources.filter((id) =>
      available.some(
        (source) =>
          source.id === id &&
          source.scopes.some((scope) => scopes.includes(scope)),
      ),
    );
    for (const scope of scopes.filter((scope) => !previous.includes(scope))) {
      const defaults =
        scope === 'local'
          ? ['youtube', 'reddit', 'local_health']
          : ['global_health', 'medlineplus', 'europepmc'];
      form.sources = [...new Set([...form.sources, ...defaults])];
    }
  },
);
const productOptions = computed(() =>
  state.products
    .filter((p) => p.dataNature !== 'demo')
    .map((p) => ({ value: p.id, label: `${p.brand} · ${p.title}` })),
);
const keywordOptions = computed(() =>
  state.keywords
    .filter((k) => k.dataNature !== 'demo')
    .map((k) => ({ value: k.id, label: `${k.term} · ${k.market}` })),
);
const isRunning = computed(
  () => job.value && ['queued', 'running'].includes(job.value.status),
);
const progress = computed(() =>
  job.value
    ? Math.round(
        (job.value.steps.filter(
          (s) => !['pending', 'running'].includes(s.status),
        ).length /
          Math.max(1, job.value.steps.length)) *
          100,
      )
    : 0,
);
const categoryTabs = computed(() => [
  { key: 'ALL', tab: `全部内容（${items.value.length}）` },
  ...Object.entries(contentCategories).map(([key, name]) => ({
    key,
    tab: `${name}（${items.value.filter((i) => i.category === key).length}）`,
  })),
]);
const columns = [
  { title: '内容 / 摘要', key: 'content', width: 380 },
  { title: '分类 / 类型', key: 'kind', width: 155 },
  { title: '来源 / 日期', key: 'source', width: 180 },
  { title: '操作', key: 'action', width: 160 },
];
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let sequence = 0;
let pendingSubmit: undefined | { signature: string; requestId: string };
watch(filter, () => {
  page.value = 1;
});

watch([activeJob, showFavorites], () => {
  page.value = 1;
  void refresh();
});
watch(
  () => result.value.length,
  (n) => {
    if ((page.value - 1) * pageSize.value >= n) page.value = 1;
  },
);
watch(
  () => form.market,
  (value) => {
    form.language = languageForMarket(value);
  },
);
function chooseProduct(ids: unknown) {
  const p = state.products.find((p) => Array.isArray(ids) && p.id === ids[0]);
  if (p && !form.query) {
    form.query = `${p.brand} ${p.title}`.slice(0, 200);
    form.market = p.market;
  }
}
async function refresh() {
  if (!serverMode || disposed) return;
  const call = ++sequence;
  if (timer) clearTimeout(timer);
  loading.value = true;
  try {
    const data = await contentRequest<ContentSnapshot>(
      'server_content_snapshot',
      {
        ...(activeJob.value ? { jobId: activeJob.value } : {}),
        favorites: showFavorites.value,
      },
    );
    if (disposed || call !== sequence) return;
    jobs.value = data.jobs;
    job.value = data.job;
    items.value = data.items;
    errorMessage.value = '';
    if (!activeJob.value && data.job) activeJob.value = data.job.id;
  } catch (error) {
    if (call === sequence)
      errorMessage.value =
        error instanceof Error ? error.message : '读取搜索结果失败';
  } finally {
    if (call === sequence) {
      loading.value = false;
      if (
        !disposed &&
        (isRunning.value ||
          jobs.value.some((j) => ['queued', 'running'].includes(j.status)))
      )
        timer = setTimeout(() => void refresh(), 3500);
    }
  }
}
async function submit() {
  if (submitting.value) return;
  if (
    form.query.trim().length < 2 ||
    form.scopes.length === 0 ||
    missingScope.value
  ) {
    errorMessage.value =
      '请填写关键词、勾选检索范围，并为每个范围选择至少一个来源';
    return;
  }
  submitting.value = true;
  errorMessage.value = '';
  const input = {
    ...form,
    relatedTerms: form.related
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const signature = JSON.stringify(input);
  if (pendingSubmit?.signature !== signature)
    pendingSubmit = { signature, requestId: crypto.randomUUID() };
  try {
    const data = await contentRequest<{ job: ContentJob }>(
      'server_content_submit',
      { requestId: pendingSubmit.requestId, input },
    );
    activeJob.value = data.job.id;
    showFavorites.value = false;
    filter.scope = 'ALL';
    pendingSubmit = undefined;
    searchOpen.value = false;
    message.success('搜索已提交，关闭页面后仍会在后台继续');
    await refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}
async function save(item: ContentItem, values: Record<string, unknown>) {
  if (saving.value) return;
  saving.value = item.id;
  try {
    const data = await contentRequest<{ item: ContentItem }>(
      'server_content_save',
      { itemId: item.id, ...values },
    );
    items.value = items.value.map((i) => (i.id === item.id ? data.item : i));
    message.success('已保存');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存未完成';
  } finally {
    saving.value = '';
  }
}
async function transcript(item: ContentItem) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const data = await contentRequest<{ job: ContentJob }>(
      'server_content_transcript',
      { requestId: crypto.randomUUID(), itemId: item.id },
    );
    activeJob.value = data.job.id;
    showFavorites.value = false;
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '字幕任务提交失败';
  } finally {
    submitting.value = false;
  }
}
async function comments(item: ContentItem) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const data = await contentRequest<{ job: ContentJob }>(
      'server_content_comments',
      { requestId: crypto.randomUUID(), itemId: item.id },
    );
    activeJob.value = data.job.id;
    showFavorites.value = false;
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '评论取样提交失败';
  } finally {
    submitting.value = false;
  }
}
async function cancel() {
  if (!job.value) return;
  try {
    await contentRequest('server_content_cancel', { jobId: job.value.id });
    await refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '取消未完成';
  }
}
function exportResults() {
  download(
    `公共内容-${new Date().toISOString().slice(0, 10)}.csv`,
    contentCsv(result.value),
    'text/csv;charset=utf-8',
  );
}
onMounted(async () => {
  if (!serverMode) return;
  try {
    sourceStatus.value = await contentRequest<ContentStatus>(
      'server_content_status',
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '读取来源配置失败';
  }
  await refresh();
});
onUnmounted(() => {
  disposed = true;
  sequence++;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div class="pc-panel">
    <Alert
      v-if="!serverMode"
      type="info"
      show-icon
      message="公共内容搜索需服务器版或隔离测试服务"
      description="演示版不会连接正式数据库或启动正式采集任务。"
    />
    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>公共内容搜索</h2>
          <p>查找目标市场本地素材与全球参考证据，保留原文、来源和地域依据。</p>
        </div>
        <Button
          type="primary"
          :disabled="!serverMode"
          @click="searchOpen = true"
          >搜索视频与文章</Button
        >
      </div>
    </section>
    <Modal
      v-model:open="searchOpen"
      title="搜索视频与文章"
      :mask-closable="false"
      width="min(1000px, 96vw)"
      :style="{ top: '32px' }"
      :body-style="{
        maxHeight: 'calc(100dvh - 210px)',
        overflowY: 'auto',
        paddingTop: '12px',
      }"
    >
      <Alert
        v-if="errorMessage"
        type="error"
        show-icon
        :message="errorMessage"
        role="alert"
        style="margin-bottom: 16px"
      />
      <Form :id="searchFormId" :model="form" layout="vertical" @finish="submit">
        <Form.Item label="检索范围（可同时勾选）" required>
          <Checkbox.Group v-model:value="form.scopes" class="pc-scope-options">
            <Checkbox value="local">目标市场本地素材</Checkbox>
            <Checkbox value="global">全球参考证据</Checkbox>
          </Checkbox.Group>
          <p class="hci-subtle">
            本地素材使用目标市场与语言线索检索，结果不保证来自当地作者；全球参考证据独立检索，不按目标国家限制。
          </p>
        </Form.Item>
        <div class="pc-form-grid">
          <Form.Item label="关键词 / 产品名称" required class="pc-query">
            <Input
              v-model:value="form.query"
              aria-label="公共内容搜索词"
              autofocus
              :maxlength="200"
              placeholder="例如 creatine gummies、品牌或成分"
            />
          </Form.Item>
          <Form.Item label="目标市场">
            <Select
              v-model:value="form.market"
              :options="marketOptions.filter((m) => m.value !== 'ALL')"
              aria-label="公共内容目标市场"
            />
          </Form.Item>
          <Form.Item label="本地素材检索语言">
            <Select
              v-model:value="form.language"
              :options="languageOptions"
              aria-label="公共内容检索语言"
            />
          </Form.Item>
          <Form.Item label="结果总数上限">
            <InputNumber
              v-model:value="form.limit"
              :min="5"
              :max="100"
              :precision="0"
              aria-label="公共内容结果上限"
            />
          </Form.Item>
        </div>
        <div v-if="form.scopes.includes('global')" class="pc-reference-fields">
          <Form.Item label="全球参考检索词（可选）" class="pc-query">
            <Input
              v-model:value="form.referenceQuery"
              aria-label="全球参考检索词"
              :maxlength="200"
              placeholder="建议填写英文成分名；留空使用原关键词"
            />
          </Form.Item>
          <Form.Item label="全球参考检索语言">
            <Select
              v-model:value="form.referenceLanguage"
              :options="
                languageOptions.filter((option) => option.value !== 'vi')
              "
              aria-label="全球参考检索语言"
            />
          </Form.Item>
        </div>
        <Form.Item label="数据来源">
          <Select
            v-model:value="form.sources"
            mode="multiple"
            :options="sourceOptions"
            aria-label="公共内容数据来源"
            placeholder="选择来源"
          />
        </Form.Item>
        <Alert
          v-if="missingScope && form.scopes.length"
          type="warning"
          show-icon
          message="每个已勾选范围至少选择一个适用来源"
          style="margin-bottom: 12px"
        />
        <p class="hci-subtle">
          本地渠道：YouTube、TikTok、Reddit 帖子、Facebook
          视频/索引帖子、Instagram
          Reels、当地卫生机构/医院、网页文章。全球渠道：NIH ODS / NCCIH / NHS /
          WHO 机构文章、MedlinePlus、Europe
          PMC、网页文章；普通网页不自动视为权威证据。
        </p>
        <div class="pc-form-grid">
          <Form.Item label="关联产品（可选）" class="pc-query">
            <Select
              v-model:value="form.productIds"
              mode="multiple"
              :max-count="20"
              :options="productOptions"
              show-search
              option-filter-prop="label"
              aria-label="搜索关联产品"
              placeholder="可从产品名称带入搜索"
              @change="chooseProduct"
            />
          </Form.Item>
          <Form.Item label="补充相关词（最多2个）" class="pc-query">
            <Input
              v-model:value="form.related"
              aria-label="补充相关搜索词"
              placeholder="逗号分隔；勾选包含相关词后生效"
              :maxlength="210"
            />
          </Form.Item>
        </div>
        <div class="hci-toolbar">
          <Checkbox v-model:checked="form.includeRelated">
            包含相关词（每个范围最多3组词）
          </Checkbox>
          <Checkbox v-model:checked="form.fetchDetails"
            >补采文章正文与图表（公开可读内容）</Checkbox
          >
          <Checkbox
            v-model:checked="form.organize"
            :disabled="!sourceStatus?.modelConfigured"
          >
            AI翻译与摘要（最多10条，一次模型调用）
          </Checkbox>
        </div>
        <p class="hci-subtle">
          按需搜索，不创建定时监测。社媒和网页索引可能扣除 ScrapeCreators
          credits，YouTube 消耗 API
          配额；每个来源每组词只请求一页，按任务总上限分摊、每组最多20条；三组词每渠道通常最多60条候选，最终入库仍受任务总上限约束。网页文章同时勾选两个范围时分别检索。24小时内相同请求优先复用结果。国家与语言用于检索，不代表作者所在地或内容语言已核实。
        </p>
        <p
          v-if="sourceStatus && !sourceStatus.modelConfigured"
          class="hci-subtle"
        >
          尚未配置语义分析模型，仍可搜索并查看来源原文。
        </p>
      </Form>
      <template #footer>
        <Button :disabled="submitting" @click="searchOpen = false">取消</Button>
        <Button
          type="primary"
          html-type="submit"
          :form="searchFormId"
          :loading="submitting"
          :disabled="!serverMode || !form.scopes.length || missingScope"
          >搜索公共内容</Button
        >
      </template>
    </Modal>
    <Alert
      v-if="errorMessage"
      type="error"
      show-icon
      :message="errorMessage"
      role="alert"
    />
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Select
          v-model:value="activeJob"
          :options="
            jobs.map((j) => ({
              value: j.id,
              label: `${j.input.query} · ${contentStates[j.status]} · ${contentDate(j.submittedAt)}`,
            }))
          "
          placeholder="搜索任务与历史"
          aria-label="公共内容搜索历史"
          style="min-width: 260px; max-width: 100%"
        />
        <Checkbox v-model:checked="showFavorites">查看全部收藏</Checkbox>
        <Button :loading="loading" @click="refresh">刷新结果</Button>
        <PublicContentHistory
          @submitted="
            activeJob = $event;
            showFavorites = false;
            void refresh();
          "
        />
        <Button :disabled="!result.length" @click="exportResults">
          导出当前链接清单
        </Button>
      </div>
      <div v-if="job" class="pc-job" aria-live="polite">
        <div class="hci-toolbar">
          <b>{{ job.input.query }}</b
          ><Tag
            :color="
              isRunning
                ? 'blue'
                : job.status === 'completed'
                  ? 'green'
                  : 'orange'
            "
          >
            {{ contentStates[job.status] }} </Tag
          ><span
            >已保存 {{ job.itemIds.length }} 条 · 来源请求 {{ job.requests }} 次
            · 已确认扣费 {{ job.creditsCharged }} credits</span
          ><Button v-if="isRunning" size="small" @click="cancel">
            取消后续请求
          </Button>
        </div>
        <p class="hci-subtle">
          检索范围：{{
            job.input.scopes
              ?.map((scope) => contentScopes[scope])
              .join(' / ') || '历史任务未区分'
          }}<span v-if="job.input.referenceQuery">
            · 全球参考词：{{ job.input.referenceQuery }}</span
          >
        </p>
        <Progress
          :percent="progress"
          :status="isRunning ? 'active' : 'normal'"
        />
        <p v-if="job.unknownChargeRequests" class="hci-subtle">
          {{ job.unknownChargeRequests }}
          次请求的扣费结果未确认，未计入已确认扣费。
        </p>
        <details>
          <summary>查看各来源执行记录</summary>
          <ul class="pc-step-list">
            <li v-for="(step, i) in job.steps" :key="i">
              <b>{{
                sourceStatus?.sources.find((s) => s.id === step.source)
                  ?.label ||
                detailStepLabels[step.source] ||
                step.source
              }}</b>
              · {{ step.query }} · {{ contentStates[step.status] }} ·
              {{ step.scope ? contentScopes[step.scope] : '历史步骤' }} ·
              {{ step.message || '等待后台处理' }}
            </li>
          </ul>
        </details>
        <p v-if="job.aiStatus !== 'disabled'" class="hci-subtle">
          AI整理：{{
            job.aiStatus === 'completed'
              ? `已整理${job.aiCount}条 · ${job.aiModel} · ${job.aiUsage?.total_tokens ?? '未知'} tokens`
              : contentStates[job.aiStatus] || job.aiStatus
          }}
          {{ job.aiMessage }}
        </p>
      </div>
      <Tabs v-model:active-key="filter.category">
        <Tabs.TabPane
          v-for="tab in categoryTabs"
          :key="tab.key"
          :tab="tab.tab"
        />
      </Tabs>
      <div class="hci-toolbar pc-filters">
        <Select
          v-model:value="filter.scope"
          aria-label="公共内容检索范围筛选"
          :options="[
            { value: 'ALL', label: '全部检索范围' },
            ...Object.entries(contentScopes).map(([value, label]) => ({
              value,
              label,
            })),
          ]"
        />
        <Input
          v-model:value="filter.search"
          aria-label="筛选内容标题或摘要"
          placeholder="筛选标题、摘要或作者"
          allow-clear
        />
        <Select
          v-model:value="filter.type"
          aria-label="公共内容类型"
          :options="[
            { value: 'ALL', label: '全部内容类型' },
            ...Object.entries(contentTypes).map(([value, label]) => ({
              value,
              label,
            })),
          ]"
        />
        <Select
          v-model:value="filter.source"
          :options="sources"
          aria-label="公共内容来源筛选"
        />
        <Select
          v-model:value="filter.language"
          :options="languages"
          aria-label="公共内容来源语言筛选"
        />
        <Select
          v-model:value="filter.since"
          aria-label="公共内容发布时间"
          :options="[
            { value: 'ALL', label: '全部发布时间' },
            { value: '30', label: '近30天' },
            { value: '365', label: '近一年' },
          ]"
        />
        <Radio.Group v-model:value="layout" aria-label="公共内容展示方式">
          <Radio.Button value="cards">卡片</Radio.Button
          ><Radio.Button value="list">列表</Radio.Button>
        </Radio.Group>
      </div>
      <p class="hci-subtle" aria-live="polite">
        {{ result.length }} 条筛选结果 · 原始内容已保存，生成摘要不会重新采集。
      </p>
      <Empty
        v-if="!result.length"
        :description="
          loading
            ? '正在读取已保存内容'
            : job
              ? '当前没有匹配结果，可调整筛选或查看来源执行记录'
              : '输入关键词，开始搜索公开视频和文章'
        "
      />
      <div v-else-if="layout === 'cards'" class="pc-grid">
        <article v-for="item in paged" :key="item.id" class="pc-card">
          <button
            type="button"
            class="pc-cover"
            :aria-label="`查看${item.title}`"
            @click="detailId = item.id"
          >
            <img
              v-if="item.thumbnail"
              :src="item.thumbnail"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            /><span v-else>{{ contentTypes[item.type] }}</span
            ><Tag>{{ contentTypes[item.type] }}</Tag>
          </button>
          <div class="pc-card-body">
            <div>
              <Tag>{{ contentCategories[item.category] }}</Tag
              ><Tag v-for="scope in itemScopes(item)" :key="scope">{{
                contentScopes[scope]
              }}</Tag
              ><Tag v-if="item.ai?.duplicateOf">AI标记相似内容</Tag>
            </div>
            <h3>
              <button type="button" @click="detailId = item.id">
                {{ item.ai?.titleZh || item.title }}
              </button>
            </h3>
            <p class="pc-summary">
              {{
                item.ai?.summaryZh ||
                item.summary ||
                (canReadArticle(item)
                  ? '来源未提供摘要，查看详情读取正文。'
                  : '来源未提供摘要，请查看原文。')
              }}
            </p>
            <p class="hci-subtle">
              {{ item.sourceLabel }} · {{ contentDate(item.publishedAt) }}
            </p>
            <p class="hci-subtle">{{ item.matchReason }}</p>
            <p class="hci-subtle">
              {{ item.marketBasis || '历史记录：来源地区未核实' }}
            </p>
            <div class="hci-toolbar">
              <Button size="small" @click="detailId = item.id">查看详情</Button
              ><a :href="item.url" target="_blank" rel="noopener noreferrer">{{
                item.type === 'video' ? '原平台观看' : '查看原文'
              }}</a
              ><Button
                size="small"
                :loading="saving === item.id"
                @click="save(item, { favorite: !item.favorite })"
              >
                {{ item.favorite ? '取消收藏' : '收藏' }}
              </Button>
            </div>
          </div>
        </article>
      </div>
      <Table
        v-else
        :columns="columns"
        :data-source="paged"
        row-key="id"
        :pagination="false"
        :scroll="{ x: 900 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'content'">
            <Button
              type="link"
              class="pc-title-link"
              @click="detailId = record.id"
            >
              {{ record.ai?.titleZh || record.title }}
            </Button>
            <p class="pc-summary">
              {{ record.ai?.summaryZh || record.summary || '来源未提供摘要' }}
            </p>
          </template>
          <template v-else-if="column.key === 'kind'">
            <Tag>
              {{ contentCategories[record.category as ContentCategory] }} </Tag
            ><Tag>{{ contentTypes[record.type] }}</Tag>
            <Tag
              v-for="scope in itemScopes(record as ContentItem)"
              :key="scope"
              >{{ contentScopes[scope] }}</Tag
            >
          </template>
          <template v-else-if="column.key === 'source'">
            {{ record.sourceLabel }}
            <p class="hci-subtle">
              {{ contentDate(record.publishedAt) }}
            </p>
          </template>
          <template v-else-if="column.key === 'action'">
            <Button size="small" @click="detailId = record.id">详情</Button
            ><Button
              size="small"
              @click="
                save(record as ContentItem, { favorite: !record.favorite })
              "
            >
              {{ record.favorite ? '取消收藏' : '收藏' }}
            </Button>
          </template>
        </template>
      </Table>
      <Pagination
        v-if="result.length"
        v-model:current="page"
        v-model:page-size="pageSize"
        :total="result.length"
        :page-size-options="['10', '20', '50', '100']"
        :show-total="(n) => `共 ${n} 条`"
        show-size-changer
        class="pc-pagination"
        @show-size-change="page = 1"
      />
    </section>
    <PublicContentDrawer
      :item="detail"
      :saving="saving === detail?.id"
      :submitting="submitting"
      :keyword-options="keywordOptions"
      :product-options="productOptions"
      @close="detailId = ''"
      @save="detail && save(detail, $event)"
      @transcript="detail && transcript(detail)"
      @comments="detail && comments(detail)"
    />
  </div>
</template>

<style scoped>
.pc-panel {
  display: grid;
  gap: 16px;
}

.pc-form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.pc-query {
  grid-column: span 2;
}

.pc-reference-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.pc-scope-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.pc-filters > .ant-input-affix-wrapper,
.pc-filters > .ant-input {
  max-width: 240px;
}

.pc-filters > .ant-select {
  min-width: 145px;
}

.pc-job {
  padding: 14px;
  margin-top: 16px;
  background: var(--hci-bg, #f5f7fa);
  border-radius: 8px;
}

.pc-step-list {
  padding-left: 20px;
  line-height: 1.9;
}

.pc-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.pc-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--hci-border, #e3e7ed);
  border-radius: 9px;
}

.pc-cover {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 170px;
  cursor: pointer;
  background: var(--hci-bg, #f5f7fa);
}

.pc-cover img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pc-cover .ant-tag {
  position: absolute;
  right: 8px;
  bottom: 8px;
}

.pc-card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.pc-card-body h3 {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}

.pc-card-body h3 button {
  text-align: left;
  cursor: pointer;
}

.pc-card-body .hci-toolbar {
  margin-top: auto;
}

.pc-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  line-height: 1.7;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
}

.pc-title-link {
  height: auto;
  padding-left: 0;
  text-align: left;
  white-space: normal;
}

.pc-pagination {
  margin-top: 20px;
  text-align: right;
}

.pc-video {
  width: 100%;
  aspect-ratio: 16 / 9;
  margin-top: 16px;
  border: 0;
}

.pc-full-text {
  margin: 12px 0;
  line-height: 1.8;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

:is(button, a):focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 3px;
}

@media (max-width: 1100px) {
  .pc-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .pc-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pc-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .pc-reference-fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .pc-reference-fields .pc-query {
    grid-column: auto;
  }
}
</style>

<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -- Template wrapping is owned by oxfmt. */
import type {
  ContentCategory,
  ContentItem,
  ContentJob,
  ContentSnapshot,
  ContentStatus,
} from '../public-content';

import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Pagination,
  Progress,
  Radio,
  Select,
  Table,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { download, marketOptions, state } from '../data';
import {
  contentCategories,
  contentCsv,
  contentDate,
  contentRequest,
  contentStates,
  contentTypes,
  filterContent,
} from '../public-content';
import { serverMode } from '../session';

const props = defineProps<{
  initialQuery?: string;
  initialMarket?: string;
  keywordIds?: string[];
  productIds?: string[];
}>();
const requestedMarket = props.initialMarket || state.market;
const startingMarket = requestedMarket === 'ALL' ? 'US' : requestedMarket;
const languageForMarket = (market: string) =>
  ({ MX: 'es', VN: 'vi', US: 'en' })[market as 'MX' | 'US' | 'VN'] || 'en';
const form = reactive({
  query: props.initialQuery || '',
  market: startingMarket,
  language: languageForMarket(startingMarket),
  sources: ['youtube', 'reddit', 'medlineplus', 'europepmc'],
  limit: 30,
  includeRelated: true,
  related: '',
  organize: false,
  keywordIds: props.keywordIds || [],
  productIds: props.productIds || [],
});
const sourceStatus = ref<ContentStatus>();
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
const relationDraft = reactive({
  keywordIds: [] as string[],
  productIds: [] as string[],
});
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
  (sourceStatus.value?.sources || []).map((s) => ({
    value: s.id,
    label: `${s.label}${s.configured ? '' : '（未配置）'}`,
  })),
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
watch(detailId, () => {
  relationDraft.keywordIds = [...(detail.value?.keywordIds || [])];
  relationDraft.productIds = [...(detail.value?.productIds || [])];
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
  if (form.query.trim().length < 2 || form.sources.length === 0) {
    errorMessage.value = '请填写关键词并选择至少一个来源';
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
    pendingSubmit = undefined;
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
          <h2>搜索视频与文章</h2>
          <p>按关键词或相关产品查找公开内容，保留原文、来源和命中依据。</p>
        </div>
      </div>
      <Form :model="form" layout="vertical" @finish="submit">
        <div class="pc-form-grid">
          <Form.Item label="关键词 / 产品名称" required class="pc-query">
            <Input
              v-model:value="form.query"
              aria-label="公共内容搜索词"
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
          <Form.Item label="检索语言">
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
        <Form.Item label="数据来源">
          <Select
            v-model:value="form.sources"
            mode="multiple"
            :options="sourceOptions"
            aria-label="公共内容数据来源"
            placeholder="选择来源"
          />
        </Form.Item>
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
            包含相关词（最多3组搜索词）
          </Checkbox>
          <Checkbox
            v-model:checked="form.organize"
            :disabled="!sourceStatus?.modelConfigured"
          >
            AI翻译与摘要（最多10条，一次模型调用）
          </Checkbox>
          <Button
            type="primary"
            html-type="submit"
            :loading="submitting"
            :disabled="!serverMode || !form.sources.length"
          >
            搜索公共内容
          </Button>
        </div>
        <p class="hci-subtle">
          按需搜索，不创建定时监测。社媒接口可能扣除 ScrapeCreators
          credits，YouTube 消耗 API
          配额；24小时内相同请求优先复用结果。国家与语言用于检索，不代表作者所在地或内容语言已核实。
        </p>
        <p
          v-if="sourceStatus && !sourceStatus.modelConfigured"
          class="hci-subtle"
        >
          尚未配置语义分析模型，仍可搜索并查看来源原文。
        </p>
      </Form>
    </section>
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
                  ?.label || step.source
              }}</b>
              · {{ step.query }} · {{ contentStates[step.status] }} ·
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
                '来源未提供摘要，请查看原文。'
              }}
            </p>
            <p class="hci-subtle">
              {{ item.sourceLabel }} · {{ contentDate(item.publishedAt) }}
            </p>
            <p class="hci-subtle">{{ item.matchReason }}</p>
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
    <Drawer
      :open="!!detail"
      title="公共内容详情"
      width="min(780px, 96vw)"
      destroy-on-close
      @close="detailId = ''"
    >
      <template v-if="detail">
        <h2>{{ detail.ai?.titleZh || detail.title }}</h2>
        <p>{{ detail.title }}</p>
        <p class="hci-subtle">
          {{ detail.sourceLabel }} · {{ detail.author || '来源未提供作者' }} ·
          {{ contentDate(detail.publishedAt) }}
        </p>
        <div class="hci-toolbar">
          <Tag>{{ contentCategories[detail.category] }}</Tag
          ><Tag>{{ contentTypes[detail.type] }}</Tag
          ><Tag>来源语言：{{ detail.language }}</Tag
          ><Tag>
            作者国家：{{
              detail.authorCountry === 'unknown'
                ? '未核实'
                : detail.authorCountry
            }}
          </Tag>
        </div>
        <iframe
          v-if="detail.source === 'youtube' && detail.videoId"
          class="pc-video"
          :src="`https://www.youtube-nocookie.com/embed/${detail.videoId}`"
          title="YouTube 视频预览"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
        <p>
          <a :href="detail.url" target="_blank" rel="noopener noreferrer">{{
            detail.type === 'video' ? '在原平台观看视频' : '打开来源原文'
          }}</a
          ><span v-if="detail.fullTextUrl">
            ·
            <a
              :href="detail.fullTextUrl"
              target="_blank"
              rel="noopener noreferrer"
              >来源提供的开放全文</a
            ></span
          >
        </p>
        <p class="hci-subtle">
          内容覆盖：{{ detail.textAvailability }} · 采集于
          {{ contentDate(detail.collectedAt) }} · 命中：{{
            detail.matchedQueries.join(' / ')
          }}
        </p>
        <h3>来源摘要 / 描述</h3>
        <p class="pc-full-text">
          {{ detail.summary || '来源未提供正文或摘要，仅保存索引和链接。' }}
        </p>
        <section v-if="detail.ai" class="hci-evidence">
          <h3>AI中文整理</h3>
          <p>{{ detail.ai.summaryZh }}</p>
          <p>{{ detail.ai.reason }}</p>
          <blockquote>{{ detail.ai.quote }}</blockquote>
          <p v-if="detail.ai.duplicateOf" class="hci-subtle">
            AI标记为相似内容，原始记录与来源均保留。
          </p>
        </section>
        <section v-if="detail.source === 'youtube'">
          <h3>已有视频字幕</h3>
          <p class="hci-subtle">
            按需读取来源已有字幕，可能消耗1次 ScrapeCreators
            请求；不会生成音频转写。
          </p>
          <Button
            :loading="submitting"
            :disabled="isRunning || !!detail.transcript"
            @click="transcript(detail)"
          >
            {{ detail.transcript ? '已检查来源字幕' : '获取已有字幕' }}
          </Button>
          <p v-if="detail.transcript" class="pc-full-text">
            {{ detail.transcript.text || '来源没有可用的原语言字幕。' }}
          </p>
        </section>
        <Form layout="vertical" style="margin-top: 20px">
          <Form.Item label="关联关键词">
            <Select
              v-model:value="relationDraft.keywordIds"
              mode="multiple"
              :options="keywordOptions"
              show-search
              option-filter-prop="label"
              aria-label="内容关联关键词"
            /> </Form.Item
          ><Form.Item label="关联产品">
            <Select
              v-model:value="relationDraft.productIds"
              mode="multiple"
              :options="productOptions"
              show-search
              option-filter-prop="label"
              aria-label="内容关联产品"
            />
          </Form.Item>
        </Form>
        <Button
          :loading="saving === detail.id"
          style="margin-right: 8px"
          @click="
            save(detail, {
              keywordIds: relationDraft.keywordIds,
              productIds: relationDraft.productIds,
            })
          "
        >
          保存关联
        </Button>
        <Button
          :loading="saving === detail.id"
          @click="save(detail, { favorite: !detail.favorite })"
        >
          {{ detail.favorite ? '取消收藏' : '收藏此内容' }}
        </Button>
      </template>
    </Drawer>
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
}
</style>

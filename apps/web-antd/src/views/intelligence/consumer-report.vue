<script setup lang="ts">
import type { ConsumerTopic } from './consumer-reports';
import type { ResearchEvidence, ResearchReport } from './research-reports';

import {
  computed,
  onActivated,
  onDeactivated,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Empty,
  Input,
  message,
  Table,
  Tag,
} from 'ant-design-vue';

import { cloudRequest } from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import {
  publicEvidenceUrl,
  reportStatus,
  reportTopics,
} from './consumer-reports';
import { marketName, state } from './data';
import { readReport, saveReport } from './report-details';
const route = useRoute();
  const router = useRouter();
const actionBusy = ref(false);
  const busy = ref(false);
  const error = ref('');
  const evidence = ref<ResearchEvidence[]>([]);
  const modelReady = ref(false);
  const note = ref('');
  const report = ref<ResearchReport>();
  const topic = ref<ConsumerTopic>();
const downloading = ref(false);
async function download() {
  if (!report.value) return;
  downloading.value = true;
  try {
    const { downloadReport } = await import('./report-docx');
    await downloadReport(report.value, evidence.value);
  } catch { message.error('文档生成失败，报告数据已保留'); }
  finally { downloading.value = false; }
}
function exportRaw() {
  if (!report.value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({report:report.value,evidence:evidence.value},null,2)],{type:'application/json;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `consumer-report-${report.value.id}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const evidenceOpen = ref(false);
const topics = computed(() => (report.value ? reportTopics(report.value) : []));
const sourceRows = computed(() => {
  const map = new Map<
    string,
    { url: string; platform: string; posts: number; comments: number }
  >();
  for (const r of evidence.value) {
    const url = publicEvidenceUrl(r.sourceUrl || r.url);
    if (!url) continue;
    const item = map.get(url) || {
      url,
      platform: r.platform,
      posts: 0,
      comments: 0,
    };
    if (r.kind === 'comment') item.comments++;
    else item.posts++;
    map.set(url, item);
  }
  return [...map.values()];
});
const rawRows = computed(() =>
  topic.value
    ? evidence.value.filter((e) => topic.value!.evidenceIds.includes(e.id))
    : evidence.value,
);
let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
function stop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
async function load(force = false) {
  stop();
  const id = String(route.params.id || '');
    const t = ++token;
  if (!id) return;
  busy.value = true;
  try {
    const data = await readReport({ id } as ResearchReport, force);
    if (t !== token) return;
    if (data.report.reportType === 'ad' || data.report.kind === 'ad_analysis')
      throw new Error('此链接对应广告报告，请在广告观察中查看');
    report.value = data.report;
    evidence.value = data.evidence;
    error.value = '';
    if (!force) note.value = data.report.reviewNote || '';
    if (active && ['queued', 'running'].includes(data.report.status))
      timer = setTimeout(() => void load(true), 10000);
  } catch (e) {
    if (t === token) error.value = e instanceof Error ? e.message : '读取失败';
  } finally {
    if (t === token) busy.value = false;
  }
}
watch(
  () => route.params.id,
  () => {
    report.value = undefined;
    evidence.value = [];
    topic.value = undefined;
    note.value = '';
    void load();
  },
  { immediate: true },
);
onActivated(() => {
  active = true;
  if (report.value) void load();
});
onDeactivated(() => {
  active = false;
  token++;
  stop();
});
onUnmounted(() => {
  active = false;
  token++;
  stop();
});
void cloudRequest<{ configured: boolean }>('server_analysis_status')
  .then((s) => {
    modelReady.value = s.configured;
  })
  .catch(() => {});
async function analyze() {
  if (!report.value || actionBusy.value) return;
  actionBusy.value = true;
  try {
    const r = await cloudRequest<{ jobId: string }>('server_submit_insight', {
      kind: 'evidence_analysis',
      reportId: report.value.id,
      market: report.value.market,
      requestId: crypto.randomUUID(),
    });
    await router.push(`/consumer-insights/reports/${r.jobId}`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    actionBusy.value = false;
  }
}
async function review(status: string) {
  if (!report.value) return;
  actionBusy.value = true;
  try {
    const r = await cloudRequest<{ report: ResearchReport }>(
      'server_review_insight',
      { reportId: report.value.id, status, note: note.value },
    );
    report.value = r.report;
    saveReport({ report: r.report, evidence: evidence.value });
    message.success('已保存审阅');
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    actionBusy.value = false;
  }
}
const time = (v: string) =>
  new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
</script>
<template>
  <main class="hci-page consumer-report">
    <PageHeader
      :title="report?.title || '消费者洞察报告'"
      description="看清消费者关注的话题、样本热度与原始来源。"
    >
      <Button @click="router.push('/consumer-insights')">返回洞察列表</Button><Button :loading="busy" @click="load(true)">刷新报告</Button>
      <Button
        :disabled="
          !modelReady ||
          report?.reportType === 'market' ||
          !evidence.length ||
          actionBusy ||
          ['queued', 'running'].includes(report?.status || '')
        "
        :loading="actionBusy"
        @click="analyze"
        >
对已有证据生成 AI 报告
</Button>
    </PageHeader>
    <Alert v-if="error" type="error" :message="error" show-icon />
    <p v-if="busy && !report" role="status">正在读取报告…</p>
    <template v-if="report">
      <section class="hci-panel">
        <div class="report-strip">
          <Tag>{{ reportStatus(report.status) }}</Tag><Tag v-if="report.reportType === 'market'" color="blue">
国家市场{{
              report.period === 'week'
                ? '周报'
                : report.period === 'quarter'
                  ? '季报'
                  : '月报'
            }}
</Tag><span>{{ marketName(report.market) }}</span><span>{{ evidence.length }} 条证据 ·
            {{ sourceRows.length }} 个来源页面</span><span>{{ time(report.createdAt) }}</span><Tag>{{ report.modelAnalysis ? 'AI归纳' : '规则统计' }}</Tag>
        </div>
        <p class="hci-subtle">
          关联词：{{
            (report.keywordIds || [])
              .map((id) => state.keywords.find((k) => k.id === id)?.term || id)
              .join('、') || '未关联'
          }}
        </p>
        <p v-if="report.modelAnalysis?.summary">
          {{ report.modelAnalysis.summary.slice(0, 140) }}
        </p>
        <Alert
          v-if="report.modelError"
          type="warning"
          :message="`AI分析未完成：${report.modelError}；已保留采集结果。`"
        />
        <p v-if="report.message" class="hci-subtle">{{ report.message }}</p>
      </section>
      <section
        v-if="report.reportType === 'market' && report.marketSnapshot"
        class="hci-panel"
      >
        <h2>市场覆盖与冻结口径</h2>
        <p class="hci-subtle">
          {{ report.marketSnapshot.startAt.slice(0, 10) }} 至
          {{ report.marketSnapshot.endAt.slice(0, 10) }} · 快照冻结于
          {{ time(report.marketSnapshot.frozenAt) }}
        </p>
        <div class="market-metrics">
          <div>
            <b>{{ report.marketSnapshot.coverage.products }}</b><span>商品总数</span>
          </div>
          <div>
            <b>{{ report.marketSnapshot.coverage.tiktokShopProducts }}</b><span>TikTok Shop商品</span>
          </div>
          <div>
            <b>{{ report.marketSnapshot.coverage.activeMetaAds }}</b><span>Meta在投广告</span>
          </div>
          <div>
            <b>{{ report.marketSnapshot.coverage.independentSites }}</b><span>独立站</span>
          </div>
          <div>
            <b>{{ report.marketSnapshot.coverage.tiktokContent }}</b><span>TikTok内容</span>
          </div>
          <div>
            <b>{{ report.marketSnapshot.coverage.consumerComments }}</b><span>消费者评论</span>
          </div>
        </div>
        <h2>高信号商品</h2>
        <Table
          size="small"
          row-key="id"
          :data-source="report.marketSnapshot.topProducts.slice(0, 10)"
          :pagination="false"
          :scroll="{ x: 760 }"
          :columns="[
            { title: '商品', dataIndex: 'title' },
            { title: '品牌/店铺', dataIndex: 'brand', width: 150 },
            { title: '来源', dataIndex: 'source', width: 130 },
            { title: '平台展示销量', dataIndex: 'reportedSales', width: 130 },
            { title: '评论数', dataIndex: 'reviewCount', width: 90 },
          ]"
        />
        <div class="market-two-columns">
          <div>
            <h2>常见配方信号</h2>
            <p
              v-for="item in report.marketSnapshot.topIngredients.slice(0, 10)"
              :key="item.name"
            >
              {{ item.name }} · {{ item.count }}个商品
            </p>
          </div>
          <div>
            <h2>活跃广告主</h2>
            <p
              v-for="item in report.marketSnapshot.topAdvertisers.slice(0, 10)"
              :key="item.name"
            >
              {{ item.name }} · {{ item.ads }}条在投广告 ·
              {{ item.landingSites }}个落地站
            </p>
          </div>
        </div>
      </section>
      <section class="hci-panel">
        <h2>
          {{
            report.reportType === 'market' ? '跨来源市场结论' : '话题方向与热度'
          }}
        </h2>
        <p class="hci-subtle">
          {{
            report.reportType === 'market'
              ? '每条结论必须引用本次冻结快照中的证据；置信度仍受采集覆盖限制。'
              : '热度 = 该话题引用文本数 /'
          }}
          <template v-if="report.reportType !== 'market'">
            {{
              report.modelAnalysis ? 'AI实际分析' : '已采样'
            }}文本数；话题可重叠，比例不必合计100%。
          </template>
        </p>
        <Table
          size="small"
          row-key="key"
          :data-source="topics"
          :pagination="false"
          :scroll="{ x: 850 }"
          :columns="[
            { title: '话题方向', key: 'topic', width: 210 },
            { title: '消费者关注什么', dataIndex: 'direction' },
            { title: '样本热度', key: 'heat', width: 165 },
            { title: '来源', key: 'source', width: 180 },
            { title: '原文', key: 'evidence', width: 90 },
          ]"
        >
          <template #bodyCell="{ column, record }">
            <b v-if="column.key === 'topic'">{{ record.label }}</b>
            <template v-else-if="column.key === 'heat'">
<b>{{ record.count }} / {{ record.sampleSize }} 条</b>
              <p>
                {{ record.share === null ? '占比未记录' : `${record.share}%` }}
              </p>
</template>
            <template v-else-if="column.key === 'source'">
{{ record.platforms.join('、') || '见来源表' }}
              <p class="hci-subtle">
                {{ record.sourceCount ?? '未记录' }} 个页面
              </p>
</template>
            <Button
              v-else-if="column.key === 'evidence'"
              type="link"
              @click="topic = record as ConsumerTopic; evidenceOpen = true"
              >
筛原文
</Button>
            <span v-else-if="column.dataIndex === 'direction'">{{
              record.direction || '按原文中的相关词归类，可进一步使用AI归纳。'
            }}</span>
          </template>
        </Table>
        <Empty
          v-if="!topics.length"
          description="暂无可归纳话题；等待采集完成或补充有效评论。"
        />
      </section>
      <section class="hci-panel">
        <h2>
          {{
            report.reportType === 'market'
              ? '选品与渠道验证动作'
              : '跨境保健品建议 · 待验证动作'
          }}
        </h2>
        <Table
          size="small"
          row-key="key"
          :data-source="topics"
          :pagination="false"
          :columns="[
            { title: '关注方向', dataIndex: 'label', width: 220 },
            { title: '建议下一步', dataIndex: 'suggestion' },
          ]"
        />
      </section>
      <section class="hci-panel">
        <h2>来源页面</h2>
        <Table
          size="small"
          row-key="url"
          :data-source="sourceRows"
          :pagination="{ pageSize: 5, showSizeChanger: true }"
          :scroll="{ x: 650 }"
          :columns="[
            { title: '平台', dataIndex: 'platform', width: 120 },
            { title: '原始讨论链接', key: 'url' },
            { title: '帖子', dataIndex: 'posts', width: 80 },
            { title: '评论', dataIndex: 'comments', width: 80 },
          ]"
          >
<template #bodyCell="{ column, record }">
<a
              v-if="column.key === 'url'"
              :href="record.url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ record.url }}</a>
</template>
</Table>
      </section>
      <details class="hci-panel" :open="evidenceOpen" @toggle="evidenceOpen = ($event.target as HTMLDetailsElement).open">
<summary>讨论原文 · 按需展开查看</summary>
        <div class="report-strip">
          <h2>讨论原文</h2>
          <Tag v-if="topic" closable @close="topic = undefined">
{{
            topic.label
          }}
</Tag><Button v-if="topic" size="small" @click="topic = undefined">
全部原文
</Button>
        </div>
        <Table
          size="small"
          row-key="id"
          :data-source="rawRows"
          :pagination="{ defaultPageSize: 5, showSizeChanger: true }"
          :scroll="{ x: 750 }"
          :columns="[
            { title: '平台 / 类型', key: 'platform', width: 140 },
            { title: '原文', dataIndex: 'text' },
            { title: '点赞 / 得分', dataIndex: 'likes', width: 110 },
            { title: '来源', key: 'url', width: 90 },
          ]"
          >
<template #bodyCell="{ column, record }">
<template v-if="column.key === 'platform'">
{{ record.platform }}
              <p class="hci-subtle">
                {{ record.kind === 'comment' ? '用户评论' : '讨论帖' }}
              </p>
</template><a
              v-if="column.key === 'url' && publicEvidenceUrl(record.url)"
              :href="publicEvidenceUrl(record.url)"
              target="_blank"
              rel="noopener noreferrer"
              >原文</a>
</template>
</Table>
      </details>
      <section class="hci-panel">
        <h2>人工审阅</h2>
        <Input.TextArea
          v-model:value="note"
          :rows="2"
          :maxlength="2000"
          placeholder="简要记录采纳方向或待验证问题"
        />
        <div class="report-strip">
          <Tag>
{{
            report.reviewStatus === 'selected'
              ? '已入选'
              : report.reviewStatus === 'excluded'
                ? '已排除'
                : '待审阅'
          }}
</Tag><Button
            :disabled="
              actionBusy || ['queued', 'running'].includes(report.status)
            "
            @click="review('selected')"
            >
入选
</Button><Button
            :disabled="
              actionBusy || ['queued', 'running'].includes(report.status)
            "
            @click="review('excluded')"
            >
排除
</Button><Button
            :disabled="
              actionBusy || ['queued', 'running'].includes(report.status)
            "
            @click="review('pending')"
            >
保存为待审阅
</Button>
        </div>
      </section>
      <details class="hci-panel">
        <summary>样本口径、生成信息与导出</summary><div class="report-strip"><Button :loading="downloading" @click="download">下载 Word 文档</Button><Button @click="exportRaw">导出原始数据</Button></div>
        <p>
          {{
            report.reportType === 'market'
              ? '报告覆盖系统在选定时间窗内实际采集的数据，不代表国家市场全量。平台展示销量不是本周期新增销量，广告在投不代表投放效果。'
              : '抽样讨论反映个人体验；研究市场不代表评论者实际所在地。建议用于业务验证，个体反馈不作为疗效或医学结论。'
          }}
        </p>
        <p>
          {{ report.statistics?.method }}；{{ report.statistics?.confidence }}
        </p>
        <p>
          模型：{{ report.modelAnalysis?.model || '未使用' }} · 输入
          {{ report.modelAnalysis?.inputEvidenceCount ?? 0 }} 条 · tokens
          {{ report.modelAnalysis?.usage?.total_tokens ?? '未记录' }} ·
          提示词版本
          {{
            report.modelAnalysis?.prompt?.version ||
            report.prompt?.version ||
            '未记录'
          }}
        </p>
        <p v-for="line in report.statistics?.limitations || []" :key="line">
          {{ line }}
        </p>
      </details>
    </template>
  </main>
</template>
<style scoped>
.report-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}

.consumer-report a {
  overflow-wrap: anywhere;
}

.consumer-report :deep(.ant-table-cell) {
  overflow-wrap: anywhere;
  white-space: normal;
}

.consumer-report h2 {
  margin-bottom: 12px;
  font-size: 17px;
}

.market-metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(100px, 1fr));
  gap: 10px;
  margin: 16px 0 24px;
}

.market-metrics div {
  padding: 14px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
}

.market-metrics b,
.market-metrics span {
  display: block;
}

.market-metrics b {
  font-size: 24px;
}

.market-two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 22px;
}

@media (max-width: 900px) {
  .market-metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .market-two-columns {
    grid-template-columns: 1fr;
  }
}
</style>

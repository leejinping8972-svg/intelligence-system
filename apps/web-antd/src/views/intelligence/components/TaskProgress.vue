<script setup lang="ts">
import type { Task } from '../data';

import { computed, onUnmounted, ref } from 'vue';

import { Alert, Progress, Table, Tag } from 'ant-design-vue';

import { marketName } from '../data';
import { resourceBudgetRows, resourceHasUnknownCharge, resourceModeLabels, resourceRankingLabels } from '../product-resources';

const props = defineProps<{ task: Task; detail?: boolean }>();
const p = computed(() => props.task.progress);
const resource = computed(() => props.task.researchProgress?.resource);
const resourceBudgets = computed(() => resource.value ? resourceBudgetRows(resource.value) : []);
const resourceUnknownCharge = computed(() => !!resource.value && (resourceHasUnknownCharge(resource.value) || Number(props.task.researchProgress?.unknownCharges) > 0));
const now = ref(Date.now());
const timer = setInterval(() => (now.value = Date.now()), 1000);
onUnmounted(() => clearInterval(timer));
const remaining = computed(
  () =>
    Math.max(
      0,
      Math.ceil((Date.parse(p.value?.nextRunAt || '') - now.value) / 1000),
    ) || 0,
);
const time = (value?: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const phaseLabel = computed(() => {
  const value = p.value;
  if (!value) return '';
  if (props.task.status === 'cancelled') return '任务已取消，已获取结果保留';
  if (value.terminal)
    return value.failed || props.task.status === 'partial'
      ? '任务已结束 · 部分完成'
      : '采集已完成 · 等待人工筛选';
  if (value.phase === 'waiting')
    return value.waitReason === 'rate_limit'
      ? 'Google Trends 限流冷却 · 其他业务继续执行'
      : value.waitReason === 'retry_queue'
        ? '首轮处理已结束 · 等待补齐失败步骤'
        : '控制请求频率 · 等待继续';
  return value.phase === 'queued'
    ? '已入队 · 等待后台执行'
    : value.phase === 'discovery'
      ? '正在发现关键词'
      : value.phase === 'metrics'
        ? '正在补充 Semrush 搜索量、KD 与意图'
        : '正在采集趋势并计算评分';
});
const channelLabels: Record<string, string> = {
  queued: '等待执行',
  running: '采集中',
  completed: '已结束',
  partial: '部分完成',
  cancelled: '已取消',
};
const rowLabels: Record<string, string> = {
  pending: '尚未执行',
  running: '采集中',
  retrying: '延迟队列 · 待重试',
  in_progress: '部分已采集 · 待继续',
  collected: '已取得趋势',
  no_signal: '已返回 · 热度均为0',
  limited: '限流未完成',
  failed: '需人工处理',
  not_started: '任务停止 · 未执行',
};
const productLabels: Record<string, string> = {
  pending: '待采集',
  running: '采集中',
  retry_wait: '等待重试',
  completed: '本次目标完成',
  empty: '未发现商品',
  partial: '部分完成',
  blocked: '需人工处理',
  failed: '采集失败',
};
function productRowLabel(record: {
  status?: string;
  lastHttpStatus?: number;
  errorKind?: string;
  message?: string;
}) {
  if (record.status !== 'retry_wait')
    return productLabels[record.status || ''] || record.status || '状态未知';
  if (
    record.lastHttpStatus === 429 ||
    record.errorKind === 'rate_limit' ||
    /429|限流/.test(record.message || '')
  )
    return '站点限流 · 冷却中';
  if (record.errorKind === 'network') return '网络故障 · 等待重试';
  if (record.lastHttpStatus && record.lastHttpStatus >= 500)
    return '官网服务异常 · 等待重试';
  return '延迟队列 · 等待执行';
}
const rowFilter = ref('all');
const visibleRows = computed(() =>
  (p.value?.rows || []).filter(
    (row) =>
      rowFilter.value === 'all' ||
      row.failed ||
      ['pending', 'retrying', 'running', 'in_progress'].includes(row.status),
  ),
);
</script>

<template>
  <div v-if="task.researchProgress" class="task-progress">
    <strong>{{
      task.status === 'queued'
        ? '等待后台执行'
        : task.status === 'running'
          ? '后台采集 / 分析中'
          : task.status === 'partial'
            ? '部分完成，请查看任务日志'
            : task.status === 'cancelled'
              ? '已取消，已有证据保留'
              : '已完成，等待人工审阅'
    }}</strong>
    <div class="hci-toolbar">
      <span
        >对象 {{ task.researchProgress.done }} /
        {{ task.researchProgress.total }}</span
      ><span
        v-if="
          ['products', 'platform_products'].includes(task.researchProgress.kind)
        "
        >商品 {{ task.researchProgress.products }} 件</span
      ><span v-else>原文 {{ task.researchProgress.evidence }} 条</span
      ><span
        >{{ resource ? '物理HTTP请求' : '请求' }} {{ task.researchProgress.requests }} 次</span
      ><span v-if="!resource && task.researchProgress.credits !== undefined"
        >确认扣除 {{ task.researchProgress.credits }} credits</span
      >
    </div>
    <p v-if="task.researchProgress.completion" class="hci-subtle">
      商品补全：已处理 {{ task.researchProgress.completion.done }}/{{
        task.researchProgress.completion.total
      }}
      件；有历史 {{ task.researchProgress.completion.withHistory }} 件，等待
      {{ task.researchProgress.completion.pending }} 件，未完成
      {{ task.researchProgress.completion.failed }} 件，来源不支持
      {{ task.researchProgress.completion.unsupported }}
      件。逐项原因与历史曲线请到商品详情查看。
    </p>
    <p
      v-if="task.researchProgress.kind === 'platform_products' && !resource"
      class="hci-subtle"
    >
      当前：{{ task.researchProgress.current || '等待处理' }}。Semrush 已确认
      {{ task.researchProgress.semrushUnits || 0 }} API units，保守预留
      {{ task.researchProgress.semrushReserved || 0 }} /
      {{
        task.researchProgress.semrushUnitLimit || '开放请求'
      }}；报告返回未知时不自动重放收费请求。结果到商品情报库按数据来源查看。
    </p>
    <template v-if="resource">
      <p class="hci-subtle">
        {{ resource.routeId || '资源路径未记录' }} · {{ resource.mode ? resourceModeLabels[resource.mode] : '方式未记录' }} ·
        {{ resource.requestedWindowDays ? `请求近${resource.requestedWindowDays}天销量统计` : '销量窗口未记录' }} ·
        目标 {{ resource.requestedQuantity ?? '未记录' }} 件 · {{ resource.ranking ? resourceRankingLabels[resource.ranking] : '排名口径未记录' }}。
        当前仅覆盖已采集样本，不能声称全平台或全类目前100。
      </p>
      <p v-if="resource.completedSteps !== undefined" class="hci-subtle">
        已处理步骤 {{ resource.completedSteps }} / {{ resource.plannedSteps ?? '未记录' }}；接口发现页 {{ resource.discoveryPages ?? '未记录' }} / {{ resource.budget?.maxPages ?? '未记录' }}；公开落地页 {{ resource.publicPages ?? '未记录' }}（每个入口最多 {{ resource.budget?.maxPages ?? '未记录' }} 页）。
      </p>
      <p v-if="resource.contents" class="hci-subtle">已保存公开内容线索 {{ resource.contents }} 条；内容线索不计为已验证商品。</p>
      <p v-if="resource.rankingSummary?.message" class="hci-subtle">{{ resource.rankingSummary.message }}</p>
      <Alert v-if="resourceUnknownCharge" type="warning" show-icon message="来源扣费或请求结果未知，已停止该来源；需人工查账，不能自动重放。" style="margin: 12px 0" />
      <Table
        :data-source="resourceBudgets" row-key="key" size="small" :pagination="false" :scroll="{ x: 520 }"
        :columns="[
          { title: '用量单位', dataIndex: 'label', width: 200 },
          { title: '已确认使用', key: 'confirmed', width: 110 },
          { title: '累计预留', key: 'reserved', width: 110 },
        ]"
      ><template #bodyCell="{ column, record }">
        <template v-if="column.key === 'confirmed'">{{ record.confirmed ?? '未确认' }}</template>
        <template v-else-if="column.key === 'reserved'">{{ record.reserved ?? '未记录' }}</template>
        <template v-else-if="column.key === 'limit'">{{ record.limit === 0 ? '关闭' : record.limit ?? '未记录' }}</template>
      </template></Table>
      <p class="hci-subtle">累计预留包含已确认部分，不是额外扣费；缺回执不按0处理。不同单位不能相加作为费用。</p>
      <div v-for="(stop, index) in resource.stopReasons || []" :key="stop.key || `${stop.reason}:${index}`" class="resource-stop-reason">
        <Tag :color="stop.status === 'unknown' ? 'orange' : 'default'">{{ stop.status === 'budget_truncated' ? '预算截断' : stop.status === 'unknown' ? '结果未知' : stop.status === 'quantity_reached' ? '目标数量达到' : stop.status === 'not_found' ? '未收录' : stop.status === 'unsupported' ? '不支持' : stop.status === 'failed' ? '失败' : stop.status === 'not_executed' ? '未执行' : stop.status }}</Tag>
        <span>{{ [stop.provider, stop.op, stop.message].filter(Boolean).join(' · ') }}</span>
      </div>
      <p v-for="(source, key) in resource.sourceStates || {}" :key="key" class="hci-subtle">
        {{ key }}：{{ source.blocked ? '来源已停止' : '按来源独立限速' }}<span v-if="source.reason"> · {{ source.reason }}</span><span v-if="source.nextAllowedAt && !source.blocked"> · 下次可请求 {{ time(new Date(source.nextAllowedAt).toISOString()) }}</span>
      </p>
    </template>
    <p v-if="task.researchProgress.transcriptSummary" class="hci-subtle">
      视频转录：成功 {{ task.researchProgress.transcriptSummary.collected }} 条
      · 暂无文本 {{ task.researchProgress.transcriptSummary.unavailable }} 条 ·
      超出默认时长 {{ task.researchProgress.transcriptSummary.limited }} 条 ·
      接口失败 {{ task.researchProgress.transcriptSummary.failed }} 条 · 无视频
      {{ task.researchProgress.transcriptSummary.notVideo }} 条 · 未请求
      {{ task.researchProgress.transcriptSummary.skipped }}
      条。广告文案与视频素材分别保留。
    </p>
    <template
      v-if="
        task.researchProgress.kind === 'products' && task.researchProgress.rows
      "
    >
      <div class="hci-toolbar">
        <span>模式 {{ task.researchProgress.profile === 'deep' ? '深度采集' : '探索采集' }}</span>
        <span>详情 {{ task.researchProgress.detailCompleted || 0 }}/{{ task.researchProgress.detailTarget || 0 }}</span>
        <span>有成分 {{ task.researchProgress.ingredientProducts || 0 }} 件</span>
        <span>有剂量 {{ task.researchProgress.doseProducts || 0 }} 件</span>
      </div>
      <Alert
        v-for="warning in task.researchProgress.policyWarnings || []"
        :key="warning"
        type="warning"
        show-icon
        :message="warning"
        style="margin: 8px 0"
      />
      <p class="hci-subtle">
        各站点轮流执行；单个站点限流时进入延迟队列，其余站点继续。等待重试
        {{ task.researchProgress.waiting || 0 }} 家<span
          v-if="task.researchProgress.nextRunAt"
        >
          · 下次调度 {{ time(task.researchProgress.nextRunAt) }}</span
        >。
      </p>
      <p v-if="task.researchProgress.browserPageLimit !== undefined" class="hci-subtle">
        浏览器渲染 {{ task.researchProgress.browserPages || 0 }}/{{ task.researchProgress.browserPageLimit }} 页；托管备用尝试 {{ task.researchProgress.paidRequests || 0 }} 次（含结果未知的已预留次数，非积分账单）。
      </p>
      <p v-if="task.researchProgress.previousRequests" class="hci-subtle">
        修复前历史网页请求
        {{ task.researchProgress.previousRequests }}
        次；上方计数为本次恢复额度。
      </p>
      <Table
        :data-source="task.researchProgress.rows"
        row-key="id"
        size="small"
        :pagination="false"
        :scroll="{ x: 780 }"
        :columns="[
          { title: '站点', key: 'site', width: 180 },
          { title: '状态', key: 'state', width: 150 },
          { title: '商品 / 详情 / 请求', key: 'counts', width: 180 },
          { title: '下次执行', key: 'next', width: 180 },
          { title: '结果与原因', dataIndex: 'message', width: 250 },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'site'"
            ><b>{{ record.brand }}</b>
            <p class="hci-subtle">{{ record.domain }}</p></template
          >
          <template v-else-if="column.key === 'state'"
            ><Tag
              :color="
                record.status === 'completed'
                  ? 'green'
                  : ['partial', 'blocked', 'retry_wait'].includes(record.status)
                    ? 'orange'
                    : 'default'
              "
              >{{ productRowLabel(record) }}</Tag
            ></template
          >
          <template v-else-if="column.key === 'counts'"
            >{{ record.products }}件 / {{ record.detailCompleted || 0 }} of {{ record.detailTarget || 0 }}详情 / {{ record.requests }}次
            <p class="hci-subtle">成分 {{ record.ingredients || 0 }} · 剂量 {{ record.doses || 0 }}</p></template
          >
          <template v-else-if="column.key === 'next'">{{
            time(record.nextRunAt)
          }}</template>
        </template>
      </Table>
      <template v-if="detail && task.researchProgress.requestLog?.length">
        <h3 class="mt-4">逐页请求记录（最近200次）</h3>
        <Table
          :data-source="task.researchProgress.requestLog"
          row-key="at"
          size="small"
          :pagination="{ pageSize: 10 }"
          :scroll="{ x: 850 }"
          :columns="[
            { title: '时间', key: 'time', width: 170 },
            { title: '地址', dataIndex: 'url', width: 300 },
            { title: '状态', key: 'result', width: 100 },
            { title: '新增商品', dataIndex: 'products', width: 90 },
            { title: '原因', dataIndex: 'message', width: 220 },
          ]"
          ><template #bodyCell="{ column, record }"
            ><template v-if="column.key === 'time'">{{
              time(record.at)
            }}</template
            ><template v-else-if="column.key === 'result'">{{
              record.httpStatus ||
              (record.status === 'success'
                ? '成功'
                : record.status === 'unknown'
                  ? '结果未知'
                  : '失败')
            }}</template></template
          ></Table
        >
      </template>
    </template>
    <p v-if="task.researchProgress.reportId" class="hci-subtle">
      结果请到{{
        task.researchProgress.kind === 'ad_analysis'
          ? '广告观察 → 历史分析'
          : '消费者需求洞察'
      }}查看；生成报告不会自动启动商品采集。
    </p>
  </div>
  <div v-if="task.collectionProgress" class="task-progress">
    <strong>{{
      task.status === 'queued'
        ? '等待后台执行'
        : task.status === 'running'
          ? '后台采集中'
          : task.status === 'partial'
            ? '任务已结束 · 部分完成'
            : task.status === 'cancelled'
              ? '任务已取消'
              : '采集已完成'
    }}</strong>
    <Progress
      :percent="
        Math.round(
          (task.collectionProgress.done /
            Math.max(1, task.collectionProgress.total)) *
            100,
        )
      "
      :status="task.status === 'running' ? 'active' : 'normal'"
    />
    <div class="hci-toolbar">
      <span
        >对象 {{ task.collectionProgress.done }} /
        {{ task.collectionProgress.total }}</span
      ><span v-if="!['site_metrics', 'semrush_sites'].includes(task.collectionProgress.kind || '')"
        >广告 {{ task.collectionProgress.ads }} 条</span
      ><span v-if="task.collectionProgress.kind !== 'site_metrics'"
        >官网 {{ task.collectionProgress.sites }} 家</span
      ><span v-if="task.collectionProgress.kind !== 'site_metrics'"
        >{{ task.collectionProgress.kind === 'semrush_sites' ? 'Semrush报告' : '广告请求' }} {{ task.collectionProgress.requests }} 次</span
      >
    </div>
    <div v-if="task.collectionProgress.channels" class="hci-toolbar">
      <span
        v-for="channel in task.collectionProgress.channels"
        :key="channel.source"
      >
        {{ channel.source }}：{{ channel.done }}/{{ channel.total }}
        <Tag
          :color="
            channel.status === 'completed'
              ? 'green'
              : channel.status === 'partial'
                ? 'orange'
                : 'blue'
          "
        >
          {{ channelLabels[channel.status] || channel.status }}
        </Tag>
      </span>
    </div>
    <p class="hci-subtle">
      {{ task.collectionProgress.current
      }}<span v-if="['site_metrics', 'semrush_sites'].includes(task.collectionProgress.kind || '')">
        · Semrush 已确认 {{ task.collectionProgress.semrushUnits || 0 }} API
        units</span
      >
      <span v-if="task.collectionProgress.credits !== undefined">
        · 已确认扣除 {{ task.collectionProgress.credits }} credits</span
      ><span v-if="task.collectionProgress.unknownCharges">
        ·
        {{ task.collectionProgress.unknownCharges }}
        次扣费未知，以服务商账单为准</span
      >
    </p>
  </div>
  <div v-if="p" class="task-progress">
    <div class="progress-heading">
      <strong :role="detail ? 'status' : undefined">{{ phaseLabel }}</strong>
      <span class="hci-subtle">流程进度 {{ p.percent }}%</span>
    </div>
    <Progress
      :percent="p.percent"
      :show-info="false"
      :status="
        task.status === 'cancelled'
          ? 'normal'
          : p.terminal
            ? 'normal'
            : 'active'
      "
      :stroke-color="
        p.failed || p.waitReason === 'rate_limit' ? '#c48532' : '#408979'
      "
      aria-label="任务流程进度"
    />
    <p v-if="p.semrushEnabled" class="hci-subtle">
      Semrush 指标进度 {{ p.metricProcessed || 0 }} / {{ p.total }} ·
      报告累计返回扣用 {{ p.semrushUnits || 0 }} API
      units（不含扣费结果未知的调用）；缺失或失败原因保留在任务日志
    </p>
    <div class="stage-grid">
      <div>
        <span>{{
          p.discoveryTotal === 0 ? '本次补齐关键词' : '关键词发现'
        }}</span
        ><b>{{ p.discovered }} / {{ p.target }}</b
        ><small v-if="p.discoveryTotal > 0"
          >{{ p.discoveryDone }} /
          {{ p.discoveryTotal }} 组种子词与市场已处理</small
        ><small v-else>后台已接收 {{ p.target }} 个词，逐项补齐数据</small>
      </div>
      <div>
        <span>趋势处理</span><b>{{ p.processed }} / {{ p.total }}</b
        ><small
          >一年趋势 {{ p.annualAvailable }} · 日趋势
          {{ p.dailyAvailable }}</small
        >
      </div>
      <div>
        <span>研究评级（含暂评）</span><b>{{ p.rated }} / {{ p.total }}</b
        ><small>其余 {{ p.total - p.rated }} 个证据不足，待评级</small>
      </div>
      <div>
        <span>未完成采集</span><b>{{ p.failed }}</b
        ><small>其中限流 {{ p.limited }} · 零热度 {{ p.noSignal }}</small>
      </div>
    </div>
    <div v-if="p.asyncRetries" class="retry-summary" aria-label="趋势补齐状态">
      <span
        >已完成 <b>{{ p.succeeded || 0 }}</b></span
      >
      <span
        >等待重试 <b>{{ p.retryPending || 0 }}</b></span
      >
      <span
        >尚未开始 <b>{{ p.notStarted || 0 }}</b></span
      >
      <span
        >需人工处理 <b>{{ p.needsAttention || 0 }}</b></span
      >
      <small
        >一年与日趋势分步保存，仅重试失败步骤；最多自动重试5次，最长补齐24小时。</small
      >
    </div>
    <p v-if="!p.terminal && p.currentTerm" class="hci-subtle">
      当前关键词：{{ p.currentTerm }}
    </p>
    <Alert
      v-if="p.phase === 'waiting'"
      :type="p.waitReason === 'rate_limit' ? 'warning' : 'info'"
      show-icon
    >
      <template #message>
        {{
          p.waitReason === 'rate_limit'
            ? p.asyncRetries
              ? 'Google Trends 返回429，仅此数据源进入冷却；Semrush、广告和站点任务可继续执行。'
              : `Google Trends 返回429，等待共享限流恢复`
            : p.waitReason === 'retry_queue'
              ? '失败步骤已进入延迟队列，到期后自动重试。'
              : '后台按请求间隔继续采集'
        }}
      </template>
      <template #description>
        下次调度：{{ time(p.nextRunAt) }}（{{ remaining }}
        秒）。关闭页面不影响后台任务。
      </template>
    </Alert>
    <p v-if="p.terminal" class="completion-note">
      {{
        task.status === 'cancelled'
          ? '任务已停止。'
          : '流程已结束，不再继续后台采集。'
      }}
      {{
        p.failed
          ? `${p.failed} 个词的采集仍有缺项，可仅重试未完成趋势。`
          : '各关键词已处理完毕；零热度、零基数或证据不足仍会如实保留。'
      }}
      <span v-if="p.shortfall"
        >目标为最多 {{ p.target }} 个词，来源实际返回
        {{ p.discovered }} 个；未补造不足数量。</span
      >
    </p>
    <div class="time-row hci-subtle">
      <span>开始：{{ time(p.startedAt) }}</span
      ><span v-if="p.terminal">结束：{{ time(p.finishedAt) }}</span
      ><span>更新：{{ time(p.updatedAt) }}</span>
    </div>
    <template v-if="detail">
      <p class="hci-subtle">
        以上为整项任务、所有市场合计。流程进度表示处理进度，不等于数据完整率；评级允许暂评，不代表已有全部第三方指标。
      </p>
      <div class="row-controls">
        <strong>逐词进度与结果</strong
        ><label
          >显示
          <select v-model="rowFilter" aria-label="筛选逐词采集状态">
            <option value="all">全部关键词</option>
            <option value="incomplete">仅未完成</option>
          </select></label
        >
      </div>
      <Table
        :data-source="visibleRows"
        row-key="id"
        size="small"
        :scroll="{ x: p.asyncRetries ? 1000 : 720 }"
        :pagination="{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
        }"
        :columns="[
          { title: '关键词 / 市场', key: 'term', width: 220 },
          { title: '状态', key: 'status', width: 140 },
          { title: '一年 / 日趋势时点', key: 'points', width: 135 },
          { title: '30天变化', key: 'growth', width: 110 },
          ...(p.asyncRetries
            ? [{ title: '自动重试 / 下次执行', key: 'retry', width: 190 }]
            : []),
          {
            title: '结果与原因',
            dataIndex: 'message',
            key: 'message',
            width: 300,
          },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'term'">
            <b>{{ record.term }}</b>
            <p class="hci-subtle">{{ marketName(record.market) }}</p>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag
              :color="
                ['failed', 'limited', 'retrying'].includes(record.status)
                  ? 'orange'
                  : record.status === 'collected'
                    ? 'green'
                    : 'default'
              "
            >
              {{ rowLabels[record.status] || record.status }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'points'">
            {{ record.annualPoints }} / {{ record.dailyPoints }}
          </template>
          <template v-else-if="column.key === 'retry'">
            已重试 {{ record.retryAttempts || 0 }} / {{ p.retryLimit || 5 }} 次
            <p class="hci-subtle">
              {{ record.nextRetryAt ? time(record.nextRetryAt) : '—' }}
            </p>
          </template>
          <template v-else-if="column.key === 'growth'">
            {{
              record.growth === null
                ? '暂不可计算'
                : `${record.growth > 0 ? '+' : ''}${record.growth}%`
            }}
          </template>
        </template>
      </Table>
    </template>
  </div>
</template>

<style scoped>
.task-progress {
  width: 100%;
  min-width: 0;
  margin-top: 16px;
}
.progress-heading,
.row-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.resource-stop-reason {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.stage-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 12px 0 16px;
}
.stage-grid > div {
  padding: 12px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
}
.stage-grid span,
.stage-grid b,
.stage-grid small {
  display: block;
}
.stage-grid b {
  font-size: 22px;
  margin: 6px 0;
}
.stage-grid small {
  color: #667085;
  font-size: 12px;
}
.time-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  font-size: 12px;
  margin: 12px 0;
}
.retry-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 24px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--background, #f6f8fc);
  border-radius: 8px;
}
.retry-summary small {
  flex-basis: 100%;
  color: #667085;
}
.completion-note {
  padding: 12px;
  background: #4089790c;
  border-left: 3px solid #408979;
  line-height: 1.8;
}
.completion-note span {
  display: block;
}
.row-controls {
  margin: 24px 0 12px;
}
select {
  padding: 4px 8px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: transparent;
}
@media (max-width: 800px) {
  .stage-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

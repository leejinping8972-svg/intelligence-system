<script setup lang="ts">
import type { TaskGroup } from '../task-list';

import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Button, message, Progress, Tag } from 'ant-design-vue';

import { marketName } from '../data';
import { taskObjectSummary, taskTime } from '../task-context';
import { taskStatusInfo, taskSummary, taskTitle } from '../task-list';
import ProductDrawer from './ProductDrawer.vue';
import TaskCollections from './TaskCollections.vue';
import TaskProgress from './TaskProgress.vue';

const props = defineProps<{ task: TaskGroup }>();
const router = useRouter();
const productId = ref<string>();
const context = computed(() => props.task.context);
const expanded = ref(false);
const targets = computed(() => expanded.value ? context.value?.objects || [] : (context.value?.objects || []).slice(0, 3));
const status = computed(() => taskStatusInfo(props.task));
const summary = computed(() => taskSummary(props.task));
const warning = computed(() => props.task.overview?.reason || (
  (props.task.researchProgress?.unknownCharges || props.task.collectionProgress?.unknownCharges)
    ? '来源扣费或请求结果未确认，已有记录保留，请先核实后续操作。' : ''
));
const progressLabel = computed(() => {
  const overview = props.task.overview;
  if (overview?.ingredientTrend || overview?.healthDiscovery) return summary.value.label;
  if (overview) return `已处理 ${overview.processed} / ${overview.total} 个目标`;
  return summary.value.label;
});
async function copyId() {
  try {
    await navigator.clipboard.writeText(props.task.cloudJobId || props.task.id);
    message.success('已复制任务编号');
  } catch { message.info('请选中任务编号复制'); }
}
</script>

<template>
  <article class="task-detail">
    <header class="task-detail-heading">
      <div class="task-detail-title-row">
        <h1>{{ taskTitle(task) }}</h1>
        <Tag :color="status?.color">{{ status?.label || task.status }}</Tag>
      </div>
      <p class="task-purpose">{{ context?.purpose || '此历史任务未保存具体用途，可查看下方已有执行记录。' }}</p>
      <div class="task-metadata">
        <span>{{ task.markets.map(market => market === 'ALL' ? '市场未记录' : marketName(market)).join(' / ') }}</span>
        <span>创建于 {{ taskTime(task.created) }} <span class="time-zone">北京时间</span></span>
      </div>
    </header>

    <section class="task-targets" aria-label="任务对象">
      <div class="section-heading">
        <h2>{{ context?.objectLabel || '任务对象' }}</h2>
        <span v-if="context?.objectCount !== null && context?.objectCount !== undefined">共 {{ context.objectCount }} 项</span>
      </div>
      <div v-for="(target, index) in targets" :key="`${target.kind}:${target.id}:${index}`" class="task-target">
        <img v-if="target.imageUrl" :src="target.imageUrl" alt="" class="target-image" @error="($event.target as HTMLImageElement).style.display = 'none'" />
        <div class="target-content">
          <h3>{{ target.label || target.sourceId || target.id || '名称未记录' }}</h3>
          <p v-if="target.original" class="target-original">{{ target.original }}</p>
          <div class="target-meta">
            <span v-if="target.sourceId">{{ target.identifierLabel || '来源编号' }} <b>{{ target.sourceId }}</b></span>
            <span v-if="target.platform">{{ target.platform }}</span>
            <span v-if="target.market && target.market !== 'ALL'">{{ marketName(target.market as 'US' | 'MX' | 'VN') }}</span>
            <span v-if="!target.sourceId && target.id" class="target-id">对象编号 {{ target.id }}</span>
          </div>
        </div>
        <Button v-if="target.kind === 'products' && target.id" size="small" @click="productId = target.id">查看商品</Button>
      </div>
      <p v-if="!targets.length" class="task-empty-context">{{ taskObjectSummary(task) }}</p>
      <Button v-if="(context?.objects.length || 0) > 3" type="link" class="expand-targets" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起对象' : `展开已记录的 ${context?.objects.length} 项对象` }}</Button>
      <p v-if="context?.hasMore" class="task-secondary">当前展示前 {{ context.objects.length }} 项，更多对象请查看原任务记录。</p>
      <p v-if="context?.scope" class="task-scope">{{ context.scope }}</p>
      <Button v-if="context?.destination && !(context.objects.length === 1 && context.objects[0]?.kind === 'products' && context.objects[0]?.id)" type="link" class="library-link" @click="router.push(context.destination.path)">{{ context.destination.label }}</Button>
    </section>

    <Alert v-if="warning" type="warning" show-icon :message="warning" class="task-warning" />

    <section class="task-outcome" aria-label="本次结果">
      <h2>{{ ['queued', 'running'].includes(task.status) ? '执行进展' : '本次结果' }}</h2>
      <template v-if="context?.result">
        <p class="result-summary">{{ context.result.summary }}</p>
        <div v-for="metric in context.result.metrics" :key="metric.label" class="result-comparison">
          <div class="metric-label">{{ metric.label }}</div>
          <div v-if="metric.previous !== undefined"><span class="task-secondary">原保存值</span><strong class="previous-value">{{ metric.previous }}</strong></div>
          <div><span class="task-secondary">本次核对值</span><strong class="fresh-value">{{ metric.value }}</strong></div>
        </div>
        <p class="task-secondary">来源 {{ context.result.provider || '未记录' }} · 采集于 {{ taskTime(context.result.at) }}（北京时间）</p>
        <p class="result-notice">{{ context.result.notice }}</p>
      </template>
      <template v-else>
        <p class="result-summary">{{ task.overview?.outcome || status?.label || task.status }}</p>
        <p v-if="context?.verificationOnly" class="task-secondary">{{ ['completed', 'awaiting_review'].includes(task.status) ? '本任务未保存可展示的核对回执，请展开执行记录查看。' : '本任务仅核对并保存记录，不更新商品库。' }}</p>
        <p v-else class="task-secondary task-result-text">{{ summary.result }}</p>
      </template>
      <div class="task-progress-summary"><span>{{ progressLabel }}</span><span v-if="task.overview?.elapsedSeconds !== null && task.overview?.elapsedSeconds !== undefined">耗时 {{ task.overview.elapsedSeconds }} 秒</span></div>
      <Progress v-if="summary.percent !== null" :percent="summary.percent" :stroke-color="summary.color" :status="['partial', 'failed', 'cancelled'].includes(task.status) ? 'exception' : 'normal'" size="small" />
      <div class="task-detail-actions"><slot name="actions" /></div>
    </section>

    <details class="task-records">
      <summary>处理步骤与执行记录 <span>{{ task.collections?.length || task.steps.length }} 项记录</span></summary>
      <TaskCollections v-if="task.collections?.length" :task="task" />
      <p v-if="!task.steps.length && !task.collections?.length" class="task-secondary">该任务未保存执行记录。</p>
      <ol v-else-if="task.steps.length" class="task-log"><li v-for="(step, index) in task.steps" :key="index">{{ step }}</li></ol>
    </details>
    <details class="task-records">
      <summary>请求与资源用量</summary>
      <dl v-if="context?.result" class="task-usage"><template v-for="usage in context.result.usage" :key="usage.label"><dt>{{ usage.label }}</dt><dd>{{ usage.value }} 次</dd></template></dl>
      <p v-else-if="context?.verificationOnly" class="task-secondary">本任务未保存可展示的用量回执。</p>
      <TaskProgress v-else :task="task" />
      <p class="task-secondary">以实际来源回执为准；结果未知的请求需先核实。</p>
    </details>
    <footer class="task-detail-footer"><span>任务编号 <code>{{ task.cloudJobId || task.id }}</code></span><Button size="small" type="text" @click="copyId">复制编号</Button></footer>
    <ProductDrawer :id="productId" @close="productId = undefined" />
  </article>
</template>

<style scoped>
.task-detail { color: var(--hci-ink, #25323b); font-size: 14px; line-height: 1.65; }
.task-result-text { white-space: pre-line; }
.task-detail h1, .task-detail h2, .task-detail h3, .task-detail p { margin: 0; }
.task-detail-heading { padding: 2px 0 26px; }
.task-detail-title-row { display: flex; gap: 16px; align-items: center; justify-content: space-between; }
.task-detail h1 { font-size: 24px; line-height: 1.4; font-weight: 650; }
.task-detail h2 { font-size: 15px; font-weight: 600; }
.task-purpose { max-width: 64ch; margin-top: 12px !important; color: var(--hci-muted, #667085); }
.task-metadata, .target-meta { display: flex; flex-wrap: wrap; gap: 6px 20px; color: var(--hci-muted, #667085); font-size: 12px; }
.task-metadata { margin-top: 14px; }
.time-zone { font-size: 11px; }
.task-targets { padding: 22px 0; border-top: 1px solid var(--hci-border, #e2e6ed); border-bottom: 1px solid var(--hci-border, #e2e6ed); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.section-heading > span, .task-secondary, .target-original { color: var(--hci-muted, #667085); font-size: 13px; }
.task-target { display: flex; align-items: flex-start; gap: 16px; padding: 12px 0; }
.task-target + .task-target { border-top: 1px solid var(--hci-border, #e2e6ed); }
.target-image { width: 60px; height: 70px; flex-shrink: 0; object-fit: contain; }
.target-content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.task-target h3 { font-size: 18px; line-height: 1.5; font-weight: 600; }
.target-original { margin-top: 5px !important; line-height: 1.5; }
.target-meta { margin-top: 9px; }
.target-meta b { color: var(--hci-ink, #25323b); font-weight: 500; font-family: ui-monospace, monospace; }
.target-id { overflow-wrap: anywhere; }
.task-scope { margin-top: 14px !important; padding: 9px 12px; background: var(--hci-subtle, #f6f8f9); font-size: 13px; }
.expand-targets, .library-link { padding-left: 0; margin-top: 10px; }
.task-empty-context { color: var(--hci-muted, #667085); }
.task-warning { margin-top: 22px; }
.task-outcome { padding: 26px 0 22px; }
.result-summary { margin-top: 12px !important; font-size: 16px; font-weight: 500; }
.result-comparison { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 20px; align-items: center; margin: 18px 0; padding: 18px 20px; background: var(--hci-subtle, #f6f8f9); }
.result-comparison > div:not(.metric-label) { display: flex; flex-direction: column; gap: 4px; }
.previous-value { color: var(--hci-muted, #667085); font-size: 26px; font-weight: 500; }
.fresh-value { color: var(--hci-accent, #2563ff); font-size: 30px; font-weight: 600; }
.result-notice { margin-top: 8px !important; }
.task-progress-summary { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 20px; font-size: 13px; }
.task-detail-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.task-detail-actions:empty { display: none; }
.task-records { border-top: 1px solid var(--hci-border, #e2e6ed); padding: 18px 0; }
.task-records > summary { cursor: pointer; font-weight: 500; }
.task-records > summary span { float: right; font-size: 12px; font-weight: 400; color: var(--hci-muted, #667085); }
.task-records[open] > summary { margin-bottom: 18px; }
.task-log { padding-left: 22px; margin: 16px 0 0; color: var(--hci-muted, #667085); font-size: 13px; overflow-wrap: anywhere; }
.task-log li + li { margin-top: 10px; }
.task-usage { display: grid; grid-template-columns: 1fr 1fr; max-width: 340px; gap: 8px; }
.task-usage dd { margin: 0; text-align: right; }
.task-detail-footer { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding-top: 18px; border-top: 1px solid var(--hci-border, #e2e6ed); color: var(--hci-muted, #667085); font-size: 12px; }
.task-detail-footer code { overflow-wrap: anywhere; font-size: 11px; }
@media (max-width: 600px) {
  .task-detail h1 { font-size: 21px; }
  .task-detail-title-row { gap: 8px; align-items: flex-start; }
  .task-target { gap: 10px; flex-wrap: wrap; }
  .target-content { flex-basis: 65%; }
  .task-target h3 { font-size: 16px; }
  .target-image { width: 44px; height: 54px; }
  .result-comparison { grid-template-columns: 1fr 1fr; gap: 12px; padding: 14px; }
  .metric-label { grid-column: 1 / -1; }
  .task-records > summary span { float: none; margin-left: 10px; }
}
</style>

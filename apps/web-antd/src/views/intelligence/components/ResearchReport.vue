<script setup lang="ts">
import type { ResearchEvidence, ResearchReport } from '../research-reports';
import { computed, ref, watch } from 'vue';
import { Alert, Button, Input, Tag, message } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import {
  reportDocument,
  reportFilename,
  reportStatus,
} from '../report-document';
const props = defineProps<{
  report: ResearchReport;
  evidence: ResearchEvidence[];
  refreshing?: boolean;
}>();
const emit = defineEmits<{ refresh: []; reviewed: [report: ResearchReport] }>();
const note = ref(''),
  busy = ref(false),
  downloading = ref(false);
const blocks = computed(() => reportDocument(props.report, props.evidence));
const body = computed(() => blocks.value.filter((b) => !b.appendix));
const appendix = computed(() => blocks.value.filter((b) => b.appendix));
watch(
  () => props.report.id,
  () => {
    note.value = props.report.reviewNote || '';
  },
  { immediate: true },
);
async function review(status: string) {
  busy.value = true;
  try {
    const result = await cloudRequest<{ report: ResearchReport }>(
      'server_review_insight',
      {
        reportId: props.report.id,
        status,
        note: note.value,
      },
    );
    message.success('审阅状态已保存');
    emit('reviewed', result.report);
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    busy.value = false;
  }
}
async function download() {
  downloading.value = true;
  try {
    const { downloadReport } = await import('../report-docx');
    await downloadReport(props.report, props.evidence);
  } catch {
    message.error('文档生成失败，请稍后重试；报告数据已保留');
  } finally {
    downloading.value = false;
  }
}
function raw() {
  const blob = new Blob(
      [
        JSON.stringify(
          { report: props.report, evidence: props.evidence },
          null,
          2,
        ),
      ],
      { type: 'application/json;charset=utf-8' },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(props.report, 'json');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const unfinished = computed(() =>
  ['queued', 'running'].includes(props.report.status),
);
</script>
<template>
  <div class="research-report">
    <div class="hci-panel-head">
      <div>
        <Tag>{{ reportStatus(report.status) }}</Tag
        ><Tag>{{ report.modelAnalysis ? '模型策略报告' : '证据统计' }}</Tag>
      </div>
      <div class="hci-toolbar">
        <Button :loading="refreshing" @click="emit('refresh')">刷新报告</Button>
        <Button
          type="primary"
          :loading="downloading"
          :disabled="unfinished"
          @click="download"
          >下载 Word 文档</Button
        ><Button @click="raw">原始 JSON</Button>
      </div>
    </div>
    <Alert
      v-if="unfinished"
      type="info"
      show-icon
      message="报告正在后台生成，当前内容为阶段结果；完成后可下载完整文档。"
    />
    <Alert
      v-else-if="report.modelError"
      type="warning"
      show-icon
      :message="report.modelError"
    />
    <article class="report-document" aria-label="完整研究报告">
      <template v-for="(block, i) in body" :key="i">
        <h2 v-if="block.kind === 'title'" class="document-title">
          {{ block.text }}
        </h2>
        <h3 v-else-if="block.kind === 'heading'">{{ block.text }}</h3>
        <h4 v-else-if="block.kind === 'subheading'">{{ block.text }}</h4>
        <p v-else-if="block.kind === 'link'">
          <a :href="block.url" target="_blank" rel="noreferrer"
            >{{ block.text }}：{{ block.url }}</a
          >
        </p>
        <p v-else>{{ block.text }}</p>
      </template>
      <details class="report-appendix">
        <summary>
          查看完整证据与提示词附录（{{ evidence.length }}
          条证据，下载时全部包含）
        </summary>
        <template v-for="(block, i) in appendix" :key="i">
          <h3 v-if="block.kind === 'heading'">{{ block.text }}</h3>
          <h4 v-else-if="block.kind === 'subheading'">{{ block.text }}</h4>
          <p v-else-if="block.kind === 'link'">
            <a :href="block.url" target="_blank" rel="noreferrer"
              >{{ block.text }}：{{ block.url }}</a
            >
          </p>
          <p v-else>{{ block.text }}</p>
        </template>
      </details>
    </article>
    <section class="report-review">
      <h3>人工判断</h3>
      <Input.TextArea
        v-model:value="note"
        placeholder="记录采纳原因、待验证假设或排除原因"
        :maxlength="2000"
        :rows="3"
      />
      <div class="hci-toolbar">
        <Button
          :disabled="unfinished"
          type="primary"
          :loading="busy"
          @click="review('selected')"
          >标为入选</Button
        ><Button
          :disabled="unfinished"
          :loading="busy"
          @click="review('excluded')"
          >标为排除</Button
        ><Button
          :disabled="unfinished"
          :loading="busy"
          @click="review('pending')"
          >保留观察</Button
        >
      </div>
    </section>
  </div>
</template>
<style scoped>
.report-document {
  padding: 24px 4px;
  line-height: 1.85;
  max-width: 900px;
  margin: auto;
  color: var(--hci-text, #24313b);
}
.report-document p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 8px 0 14px;
}
.report-document h3 {
  font-size: 18px;
  margin: 30px 0 12px;
  font-weight: 650;
  border-bottom: 1px solid var(--hci-border, #e5e7eb);
  padding-bottom: 10px;
}
.report-document h4 {
  font-size: 15px;
  margin: 20px 0 8px;
  font-weight: 650;
}
.document-title {
  font-size: 25px;
  font-weight: 700;
  margin: 12px 0 24px;
}
.report-appendix {
  margin-top: 28px;
}
.report-appendix summary {
  cursor: pointer;
  color: var(--hci-accent, #365bdb);
  padding: 12px 0;
  font-weight: 600;
}
.report-review {
  border-top: 1px solid var(--hci-border, #e5e7eb);
  padding-top: 20px;
}
.report-review h3 {
  margin-bottom: 12px;
}
</style>

<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -- Template wrapping is owned by oxfmt. */
import { computed, onUnmounted, ref, watch } from 'vue';

import { Alert, Button, Checkbox, message, Modal } from 'ant-design-vue';

import { contentRequest } from '../public-content';
const emit = defineEmits<{ submitted: [jobId: string] }>();
interface Plan {
  total: number;
  paidRequests: number;
  publicRequests: number;
  inProgress: number;
  retained: number;
  steps: unknown[];
}
const open = ref(false);
const includePaid = ref(false);
const loading = ref(false);
const submitting = ref(false);
const plan = ref<Plan>();
const errorMessage = ref('');
let sequence = 0;
let disposed = false;
let pending: undefined | { id: string; paid: boolean };
const nothing = computed(() => !plan.value?.steps.length);
async function preview() {
  const current = ++sequence;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await contentRequest<Plan>(
      'server_content_history_preview',
      { includePaid: includePaid.value },
    );
    if (current === sequence && !disposed) plan.value = result;
  } catch (error) {
    if (current === sequence && !disposed)
      errorMessage.value =
        error instanceof Error ? error.message : '历史内容读取失败';
  } finally {
    if (current === sequence && !disposed) loading.value = false;
  }
}
function show() {
  open.value = true;
  void preview();
}
watch(includePaid, () => {
  plan.value = undefined;
  if (open.value) void preview();
});
async function submit() {
  if (submitting.value || loading.value || nothing.value) return;
  submitting.value = true;
  errorMessage.value = '';
  pending =
    pending?.paid === includePaid.value
      ? pending
      : { id: crypto.randomUUID(), paid: includePaid.value };
  try {
    const result = await contentRequest<{ job: null | { id: string } }>(
      'server_content_history_submit',
      { requestId: pending.id, includePaid: includePaid.value },
    );
    pending = undefined;
    open.value = false;
    if (result.job) {
      emit('submitted', result.job.id);
      message.success('历史详情补全已提交，关闭页面后后台继续');
    } else message.info('没有需要重复补采的内容');
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '补全任务未提交';
  } finally {
    submitting.value = false;
  }
}
onUnmounted(() => {
  disposed = true;
  sequence++;
});
</script>
<template>
  <Button @click="show">补全历史详情</Button>
  <Modal
    v-model:open="open"
    title="补全历史内容详情"
    :width="600"
    :mask-closable="!submitting"
    :closable="!submitting"
    :keyboard="!submitting"
  >
    <div class="history-detail-plan">
      <p>
        检查全部已保存的公共内容，只读取缺少的详情，不重新搜索关键词。已有正文、字幕和已检查结果会保留。
      </p>
      <Checkbox v-model:checked="includePaid" :disabled="submitting"
        >同时补采视频字幕与帖子原文（可能收费）</Checkbox
      >
      <p class="history-plan-note">
        公开摘要、视频描述和开放正文不使用付费模型；字幕及帖子原文使用已配置的
        ScrapeCreators 额度，不自动购买额度。
      </p>
      <Alert
        v-if="errorMessage"
        type="error"
        show-icon
        :message="errorMessage"
      />
      <p v-if="loading" role="status">正在核对历史内容与已有任务…</p>
      <dl v-else-if="plan">
        <div>
          <dt>历史内容</dt>
          <dd>{{ plan.total }} 条</dd>
        </div>
        <div>
          <dt>公开补全步骤</dt>
          <dd>{{ plan.publicRequests }} 项</dd>
        </div>
        <div>
          <dt>可能收费请求</dt>
          <dd>{{ plan.paidRequests }} 次</dd>
        </div>
        <div>
          <dt>复用或已检查</dt>
          <dd>{{ plan.retained }} 项</dd>
        </div>
        <div>
          <dt>已有在途步骤</dt>
          <dd>{{ plan.inProgress }} 项</dd>
        </div>
      </dl>
      <Alert
        v-if="plan && nothing"
        type="info"
        show-icon
        message="当前范围没有新的补全步骤。已检查无数据或结果未确认的请求不会自动重复。"
      />
      <p class="history-plan-note">
        来源没有全文、描述或字幕时，将记录缺失原因，不用 AI
        编写替代原文。进度与执行结果保留在公共内容搜索历史。
      </p>
    </div>
    <template #footer
      ><Button :disabled="submitting" @click="open = false">关闭</Button
      ><Button
        type="primary"
        :disabled="loading || nothing || !!errorMessage"
        :loading="submitting"
        @click="submit"
        >开始补全</Button
      ></template
    >
  </Modal>
</template>
<style scoped>
.history-detail-plan {
  font-size: 14px;
  line-height: 1.85;
  color: var(--hci-ink);
}

.history-detail-plan > p {
  margin: 0 0 20px;
}

.history-detail-plan :deep(.ant-checkbox-wrapper) {
  margin-bottom: 12px;
}

.history-detail-plan .history-plan-note {
  margin: 12px 0 20px;
  font-size: 12px;
  color: var(--hci-muted);
}

.history-detail-plan dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  padding: 20px;
  margin: 20px 0;
  background: var(--hci-subtle);
  border: 1px solid var(--hci-border);
  border-radius: 8px;
}

.history-detail-plan dt {
  font-size: 12px;
  color: var(--hci-muted);
}

.history-detail-plan dd {
  margin: 4px 0 0;
  font-weight: 600;
}
</style>

<script setup lang="ts">
import type { DiscoveryPlan } from '../discovery-monitors';
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Switch,
} from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { state } from '../data';
import { defaultDiscoveryPlan } from '../discovery-monitors';
import { serverMode, session } from '../session';

const props = defineProps<{ plan?: DiscoveryPlan; scheduled?: boolean }>();
const emit = defineEmits<{ saved: []; submitted: [id: string] }>();
const router = useRouter();
const initial = defaultDiscoveryPlan(
  'ingredients',
  state.market === 'ALL' ? 'US' : state.market,
);
const form = reactive({
  ...initial,
  communityText: (initial.communities || []).join('\n'),
});
const busy = ref(false),
  error = ref('');
const canEdit = computed(() => serverMode && session.user?.role === 'admin');
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map(
  (label, value) => ({ label, value }),
);
let signature = '',
  requestId = '';
watch(
  () => props.plan,
  (plan) => {
    if (plan)
      Object.assign(form, initial, plan, {
        communityText: (plan.communities || initial.communities || []).join(
          '\n',
        ),
      });
  },
  { immediate: true },
);
async function submit(operation: 'analyze' | 'collect' | 'save') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const {
      communityText,
      maxProducts: _posts,
      maxPages: _pages,
      maxDetails: _details,
      maxRequests: _requests,
      maxCommentRequests: _commentRequests,
      analysisMaxRecords: _analysis,
      ...values
    } = form;
    const plan = {
      ...values,
      collectionLimitsVersion: 2,
      kind: 'ingredients',
      sourceMode: 'ingredient_trends',
      channels: ['reddit'],
      days: 7,
      frequency: 'daily',
      communities: communityText
        .split(/[\n,，]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (operation === 'save') {
      await cloudRequest('server_discovery_save', { id: form.id, plan });
      message.success('成分风向监控已保存');
      emit('saved');
      return;
    }
    const next = JSON.stringify([plan, operation]);
    if (next !== signature) {
      signature = next;
      requestId = crypto.randomUUID();
    }
    const result = await cloudRequest<{ jobId: string }>(
      'server_discovery_submit',
      { requestId, plan, monitorId: form.id, trendOperation: operation },
    );
    requestId = '';
    signature = '';
    emit('submitted', result.jobId);
    message.success(
      operation === 'collect' ? '采集任务已进入队列' : '周分析已进入队列',
    );
    await router.push({
      path: '/monitor',
      query: { tab: 'tasks', job: result.jobId },
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Form
    :model="form"
    layout="vertical"
    class="ingredient-trend-form"
    @finish="submit(scheduled ? 'save' : 'collect')"
  >
    <Alert v-if="error" :message="error" type="error" show-icon />
    <Alert
      type="info"
      show-icon
      message="每天补充帖子与评论，每周分批分析累计内容。"
      description="渠道为ScrapeCreators / Reddit。首次回溯7天；后续补新帖并回访近期讨论。评论可能存在来源缺口，达到上限会保留待续内容。"
    />
    <Form.Item label="研究归属市场">
      <Select
        v-model:value="form.market"
        :options="[
          { value: 'US', label: '美国' },
          { value: 'MX', label: '墨西哥' },
          { value: 'VN', label: '越南' },
        ]"
      />
      <p class="hci-subtle">
        用于归档研究结果；Reddit社区讨论不代表作者来自该市场。
      </p>
    </Form.Item>
    <Form.Item label="监控社区（每行一个，最多10个）">
      <Input.TextArea
        v-model:value="form.communityText"
        :rows="3"
        :maxlength="300"
        placeholder="Supplements&#10;Nootropics&#10;Biohackers"
      />
    </Form.Item>
    <Form.Item label="分析关注方向（选填）">
      <Input.TextArea
        v-model:value="form.focus"
        :rows="2"
        :maxlength="1000"
        placeholder="例如：睡眠、运动恢复、使用体验与负面反馈"
      />
      <p class="hci-subtle">
        用于周分析，不将社区采集限制在几个已有成分关键词内。
      </p>
    </Form.Item>
    <div class="trend-form-grid">
      <Form.Item label="每天采集时间（北京时间）"
        ><Input v-model:value="form.time" type="time"
      /></Form.Item>
      <Form.Item label="每周分析日期"
        ><Select v-model:value="form.analysisWeekday" :options="weekdays"
      /></Form.Item>
      <Form.Item label="每周分析时间（北京时间）"
        ><Input v-model:value="form.analysisTime" type="time"
      /></Form.Item>
      <Form.Item label="每社区每次最多帖子数"
        ><InputNumber
          id="ingredient-max-posts"
          v-model:value="form.maxPostsPerCommunity"
          :min="1"
          :max="5000"
      /></Form.Item>
      <Form.Item label="每帖每次最多评论数（含回复）"
        ><InputNumber
          id="ingredient-max-comments"
          v-model:value="form.maxCommentsPerPost"
          :min="0"
          :max="1000"
      /></Form.Item>
    </div>
    <p class="hci-subtle">
      帖子按社区分别计数，评论按每帖每次去重计数（含回复），设为0则不采评论。系统自动翻页并保存待续内容，近期帖子轮换回访。周分析分批处理两周窗口内全部归档资料，不再按2000段截断。来源与模型调用仍会消耗费用；后台保护触发或来源缺口会明确显示为部分覆盖。
    </p>
    <Form.Item v-if="scheduled" label="启用每日采集及每周分析"
      ><Switch v-model:checked="form.enabled"
    /></Form.Item>
    <div class="hci-toolbar">
      <Button
        v-if="scheduled"
        type="primary"
        html-type="submit"
        :loading="busy"
        :disabled="!canEdit"
        >保存监控</Button
      >
      <Button
        :type="scheduled ? 'default' : 'primary'"
        :loading="busy"
        :disabled="!canEdit"
        @click="submit('collect')"
        >立即采集</Button
      >
      <Button :loading="busy" :disabled="!canEdit" @click="submit('analyze')"
        >分析最近一周</Button
      >
    </div>
  </Form>
</template>
<style scoped>
.trend-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.ingredient-trend-form :deep(.ant-input-number) {
  width: 100%;
}
.ingredient-trend-form :deep(.ant-alert) {
  margin-bottom: 16px;
}
@media (max-width: 600px) {
  .trend-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

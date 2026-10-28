<script setup lang="ts">
import type { Keyword, Market } from '../data';

import { computed, reactive, ref } from 'vue';

import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Table,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { marketName, state } from '../data';
import { serverMode } from '../session';
const props = withDefaults(
  defineProps<{
    keywords?: Keyword[];
    siteIds?: string[];
    productIds?: string[];
    compact?: boolean;
    label?: string;
    disabled?: boolean;
  }>(),
  {
    keywords: () => [],
    siteIds: () => [],
    productIds: () => [],
    label: '生成消费者洞察报告',
  },
);
const emit = defineEmits<{ submitted: [] }>();
const preparing = ref(false);
const busy = ref(false);
const error = ref('');
const modelReady = ref(false);
const open = ref(false);
const form = reactive({
  query: '',
  market: 'US' as Market,
  sourceKind: 'reddit_search',
  urls: '',
  autoComments: true,
  maxDiscussionPosts: 3,
  maxPages: 1,
  maxRequests: 5,
  limit: 200,
  analyze: false,
});
interface Item {
  id: string;
  term: string;
  market: Market;
  requestId: string;
  jobId?: string;
  error?: string;
}
const attempted = ref(false);
const batch = ref<Item[]>([]);
const multiple = computed(() => batch.value.length > 1);
const total = computed(() => Math.max(1, batch.value.length));
async function begin() {
  error.value = '';
  attempted.value = false;
  if (props.keywords.length > 20) {
    message.warning('每批最多20个关键词，请缩小勾选范围');
    return;
  }
  batch.value = props.keywords.map((k) => ({
    id: k.id,
    term: k.term,
    market: k.market,
    requestId: crypto.randomUUID(),
  }));
  Object.assign(form, {
    query: batch.value[0]?.term || '',
    market:
      batch.value[0]?.market || (state.market === 'ALL' ? 'US' : state.market),
    sourceKind: 'reddit_search',
    urls: '',
    autoComments: true,
  });
  open.value = true;
  preparing.value = true;
  modelReady.value = false;
  try {
    modelReady.value = (
      await cloudRequest<{ configured: boolean }>('server_analysis_status')
    ).configured;
  } catch {
    /* Sampling works without a model. */
  }
  form.analyze = modelReady.value;
  preparing.value = false;
}
async function submit() {
  if (busy.value || preparing.value) return;
  if (
    !attempted.value &&
    form.sourceKind === 'reddit_search' &&
    !form.query.trim()
  ) {
    error.value = '请输入研究关键词';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    if (!batch.value.length)
      batch.value = [
        {
          id: '',
          term: form.query.trim(),
          market: form.market,
          requestId: crypto.randomUUID(),
        },
      ];
    attempted.value = true;
    for (const item of batch.value.filter((r) => !r.jobId)) {
      item.error = '';
      try {
        const result = await cloudRequest<{ jobId: string }>(
          'server_submit_insight',
          {
            ...form,
            query: multiple.value ? item.term : form.query,
            market: item.market,
            title: `${multiple.value ? item.term : form.query || '公开评论'} · 消费者洞察`,
            keywordIds: item.id ? [item.id] : [],
            siteIds: props.siteIds,
            productIds: props.productIds,
            kind: 'consumer_research',
            requestId: item.requestId,
          },
        );
        item.jobId = result.jobId;
      } catch (e) {
        item.error = e instanceof Error ? e.message : '提交失败';
      }
    }
    emit('submitted');
    if (batch.value.every((r) => r.jobId)) {
      open.value = false;
      message.success(`已提交${total.value}份消费者洞察报告，后台继续生成`);
    } else
      error.value =
        '部分提交未确认，可点击重试；已提交项会保留，重试复用原提交编号。';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
import CollectionEstimate from './CollectionEstimate.vue';
</script>
<template>
  <Button
    :type="compact ? 'link' : 'primary'"
    :size="compact ? 'small' : 'middle'"
    :disabled="disabled || !serverMode"
    @click="begin"
  >
    {{ label }}
  </Button>
  <Modal
    v-model:open="open"
    title="生成消费者洞察报告"
    :width="760"
    :confirm-loading="busy"
    :ok-button-props="{ disabled: preparing }"
    :closable="!busy"
    :mask-closable="false"
    :keyboard="!busy"
    :cancel-button-props="{ disabled: busy }"
    :ok-text="attempted ? '重试未确认项' : '提交生成'"
    @ok="submit"
  >
    <p>
      按词生成 {{ total }} 份报告 · 每份最多
      {{ form.maxRequests }} 次采集请求<span v-if="form.analyze">
        + 1 次 AI 分析</span
      >
    </p>
    <Form layout="vertical" :disabled="busy || preparing || attempted">
      <div class="hci-form-grid">
        <Form.Item label="研究市场">
          <Select
            v-model:value="form.market"
            :disabled="!!batch.length"
            :options="
              ['US', 'MX', 'VN'].map((value) => ({
                value,
                label: marketName(value as Market),
              }))
            "
          />
        </Form.Item>
        <Form.Item label="公开讨论来源">
          <Select
            v-model:value="form.sourceKind"
            :disabled="multiple"
            :options="[
              { value: 'reddit_search', label: 'Reddit · 按关键词发现讨论' },
              { value: 'reddit_comments', label: 'Reddit · 指定帖子评论' },
              { value: 'youtube_comments', label: 'YouTube · 视频评论' },
              { value: 'tiktok_comments', label: 'TikTok · 视频评论' },
              {
                value: 'facebook_comments',
                label: 'Facebook · 公开原帖 / Reels 评论',
              },
            ]"
          />
        </Form.Item>
      </div>
      <Form.Item
        :label="multiple ? '所选关键词（每词一份报告）' : '研究关键词'"
      >
        <Input
          v-if="!multiple"
          v-model:value="form.query"
          :maxlength="300"
          placeholder="例如 creatine gummies"
        /><span v-else>{{
          batch.map((k) => `${k.term} (${k.market})`).join('、')
        }}</span>
      </Form.Item>
      <Form.Item
        v-if="form.sourceKind !== 'reddit_search'"
        label="公开帖子或视频链接 · 每行一条，最多20条"
      >
        <Input.TextArea
          v-model:value="form.urls"
          :rows="3"
          placeholder="使用所选平台原帖链接；广告需公开原帖，文章可用其公开讨论 / 分享帖链接"
        />
      </Form.Item>
      <Form.Item v-if="form.sourceKind === 'reddit_search'">
        <Checkbox v-model:checked="form.autoComments">
          同时取样讨论帖内评论
        </Checkbox>
      </Form.Item>
      <div class="hci-form-grid">
        <Form.Item
          v-if="form.sourceKind === 'reddit_search' && form.autoComments"
          label="评论取样帖子数"
        >
          <InputNumber
            v-model:value="form.maxDiscussionPosts"
            :min="1"
            :max="5"
          />
        </Form.Item>
        <Form.Item label="每来源最多页数">
          <InputNumber v-model:value="form.maxPages" :min="1" :max="10" />
        </Form.Item>
        <Form.Item label="每词采集请求上限">
          <InputNumber v-model:value="form.maxRequests" :min="1" :max="100" />
        </Form.Item>
        <Form.Item label="每词文本样本上限">
          <InputNumber v-model:value="form.limit" :min="1" :max="1000" />
        </Form.Item>
      </div>
      <Checkbox v-model:checked="form.analyze" :disabled="!modelReady">
        AI 归纳话题与跨境保健品建议（模型费用另计）
      </Checkbox>
    </Form>
    <p class="hci-subtle">
      热度为采样讨论中的占比。视频、广告或文章正文不替代用户评论；文章评论需提供受支持平台的公开讨论链接。混合市场会按各词市场分别提交。
    </p>
    <Alert
      v-if="!modelReady"
      type="info"
      message="未配置模型：先生成规则话题统计，之后可对已有证据补做AI分析。"
    />
    <Table
      v-if="attempted"
      size="small"
      row-key="requestId"
      :data-source="batch"
      :pagination="false"
      :columns="[
        { title: '关键词', dataIndex: 'term' },
        { title: '提交结果', key: 'result' },
      ]"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'result'">
          {{ record.jobId ? '已提交' : record.error || '等待提交' }}
        </template>
      </template>
    </Table>
    <Alert v-if="error" type="error" :message="error" show-icon />
    <CollectionEstimate
      v-if="open"
      :input="{
        kind: 'consumer_research',
        ...form,
        maxRequests: form.maxRequests * total,
      }"
    />
  </Modal>
</template>

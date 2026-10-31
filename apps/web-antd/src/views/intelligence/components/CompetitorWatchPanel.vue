<script setup lang="ts">
import type { WatchConfig, WatchSnapshot } from '../competitor-monitor';

import { computed, onUnmounted, reactive, ref, watch } from 'vue';

import {
  Alert,
  AutoComplete,
  Button,
  Empty,
  Form,
  InputNumber,
  message,
  Select,
  Switch,
  Tag,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { watchStatus } from '../competitor-monitor';
import { state } from '../data';
import { serverMode, session } from '../session';
import MonitorConfigPanel from './MonitorConfigPanel.vue';

const props = defineProps<{
  kind: 'advertiser' | 'site';
  siteId?: string;
  adId?: string;
  embedded?: boolean;
}>();
const emit = defineEmits<{ saved: [] }>();
const busy = ref(false);
const error = ref('');
const loading = ref(false);
const open = ref(Boolean(props.embedded));
const snapshot = ref<WatchSnapshot>();
const canEdit = computed(() => !serverMode || session.user?.role === 'admin');
const form = reactive({
  siteId: '',
  adId: '',
  pageId: '',
  enabled: true,
  hour: 8,
  maxPages: 10,
});
const sites = computed(() =>
  state.sites
    .filter((s) => state.market === 'ALL' || s.market === state.market)
    .map((s) => ({ label: `${s.domain} · ${s.market}`, value: s.id })),
);
const advertisers = computed(() =>
  [
    ...new Map(
      state.ads
        .filter(
          (a) =>
            a.pageId && (state.market === 'ALL' || a.market === state.market),
        )
        .map((a) => [`${a.market}:${a.pageId}`, a]),
    ).values(),
  ].map((a) => ({
    label: `${a.brand} · ${a.market} · ${a.pageId}`,
    value: a.id,
  })),
);
const advertiserPages = computed(() =>
  advertisers.value.map((a) => ({
    label: a.label,
    value: state.ads.find((ad) => ad.id === a.value)?.pageId || '',
  })),
);
const targets = computed(
  () =>
    snapshot.value?.targets.filter(
      (t) =>
        t.kind === props.kind &&
        (state.market === 'ALL' || t.market === state.market),
    ) || [],
);
const events = computed(
  () =>
    snapshot.value?.events.filter((e) =>
      targets.value.some((t) => t.id === e.targetId),
    ) || [],
);
const run = (id: string) => snapshot.value?.runs.find((r) => r.id === id);
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    snapshot.value = await cloudRequest<WatchSnapshot>(
      'server_competitor_snapshot',
    );
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '监控读取失败';
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  open,
  async (value, _old, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
      if (timer) clearInterval(timer);
    });
    if (timer) clearInterval(timer);
    if (value) {
      form.siteId = props.siteId || '';
      form.adId = props.adId || '';
      if (props.adId)
        form.siteId =
          state.ads.find((a) => a.id === props.adId)?.siteIds?.[0] || '';
      await refresh();
      if (cancelled) return;
      const existing = targets.value.find((t) =>
        props.siteId
          ? t.siteId === props.siteId
          : props.adId &&
            t.pageId === state.ads.find((a) => a.id === props.adId)?.pageId,
      );
      if (existing) edit(existing);
      timer = setInterval(() => void refresh(), 15_000);
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
async function action(name: string, input: Record<string, unknown>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await cloudRequest(name, input);
    message.success('监控设置已保存');
    await refresh();
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (busy.value) return;
  try {
    await syncCloudWorkspace();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '业务数据同步失败';
    return;
  }
  if (await action('server_competitor_save', { ...form, kind: props.kind }))
    emit('saved');
}
function edit(t: WatchConfig) {
  Object.assign(form, t, {
    adId:
      state.ads.find((a) => a.pageId === t.pageId && a.market === t.market)
        ?.id || '',
  });
}
</script>
<template>
  <Button v-if="!embedded" size="small" @click="open = true">
    {{ siteId || adId ? '加入上新监控' : '上新监控' }}
  </Button>
  <MonitorConfigPanel
    v-model:open="open"
    :embedded="embedded"
    drawer
    :title="kind === 'site' ? '独立站上新监控' : '广告主上新监控'"
    width="min(760px, 100vw)"
  >
    <p v-if="!embedded">
      每天按北京时间检查。首次完整扫描建立基线，以后首次发现的商品、广告入库并提取候选词，标记“竞品上新”。首次发现时间不代表实际发布日期。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon role="alert" />
    <Form v-if="canEdit" layout="vertical" @submit.prevent="save">
      <Form.Item v-if="kind === 'site'" label="监控站点">
        <Select
          v-model:value="form.siteId"
          show-search
          option-filter-prop="label"
          :options="sites"
          placeholder="选择独立站"
        />
      </Form.Item>
      <Form.Item v-else label="监控广告主">
        <Select
          v-model:value="form.adId"
          show-search
          option-filter-prop="label"
          :options="advertisers"
          placeholder="选择含Page ID的广告主"
        />
      </Form.Item>
      <Form.Item label="每渠道页面上限">
        <InputNumber
          v-model:value="form.maxPages"
          :min="1"
          :max="100"
          :precision="0"
        />
      </Form.Item>
      <Form.Item
        v-if="kind === 'site'"
        label="关联广告主Page ID（可选，用于同时检查新广告）"
      >
        <AutoComplete
          v-model:value="form.pageId"
          :options="advertiserPages"
          placeholder="填写数字Page ID；留空只检查新品"
        />
      </Form.Item>
      <Form.Item v-else label="关联独立站（可选，用于同时检查新品）">
        <Select
          v-model:value="form.siteId"
          allow-clear
          show-search
          option-filter-prop="label"
          :options="sites"
          placeholder="留空只检查新广告"
        />
      </Form.Item>
      <div class="watch-fields">
        <Form.Item label="每日更新小时（北京时间）">
          <InputNumber
            v-model:value="form.hour"
            :min="0"
            :max="23"
            :precision="0"
          />
        </Form.Item>

        <Form.Item label="每日自动检查">
          <Switch
            v-model:checked="form.enabled"
            checked-children="启用"
            un-checked-children="暂停"
          />
        </Form.Item>
      </div>
      <p class="hci-subtle">
        官网和广告分别按页面上限扫描；不完整扫描会标为部分完成。
      </p>
      <Button type="primary" :loading="busy" html-type="submit">
        保存监控
      </Button>
    </Form>
    <template v-if="!embedded">
      <h3>已监控对象</h3>
      <Button :loading="loading" @click="refresh">刷新状态</Button>
      <Empty v-if="!targets.length" description="尚未添加监控" />
      <article v-for="target in targets" :key="target.id" class="watch-row">
        <b>{{ target.label }} · {{ target.market }}</b>
        <Tag>{{ target.enabled ? '每日检查' : '已暂停' }}</Tag>
        <p>
          {{ target.hour }}:00 · 最多{{ target.maxPages }}页/渠道 ·
          {{ target.siteId ? '新品' : '' }} {{ target.pageId ? '新广告' : '' }}
        </p>
        <template v-if="run(target.id)">
          <p>
            {{ run(target.id)?.day }} ·
            {{ watchStatus[run(target.id)?.status || ''] }} ·
            {{ run(target.id)?.requests }}次请求 ·
            {{ run(target.id)?.added || 0 }}项上新
          </p>
          <p v-for="channel in run(target.id)?.channels" :key="channel.kind">
            {{ channel.kind === 'products' ? '商品' : '广告' }}：{{
              channel.baseline ? '建立首次基线' : '增量检查'
            }}
            · {{ channel.observed || 0 }}项 · {{ watchStatus[channel.status] }}
          </p>
          <p v-for="text in run(target.id)?.errors" :key="text" role="alert">
            {{ text }}
          </p>
        </template>
        <div v-if="canEdit" class="watch-actions">
          <Button size="small" @click="edit(target)">编辑</Button>
          <Button
            size="small"
            :loading="busy"
            @click="action('server_competitor_check', { id: target.id })"
          >
            本日立即检查
          </Button>
          <Button
            size="small"
            :disabled="!target.enabled"
            @click="action('server_competitor_pause', { id: target.id })"
          >
            暂停
          </Button>
          <Button
            size="small"
            danger
            @click="action('server_competitor_remove', { id: target.id })"
          >
            移除监控
          </Button>
        </div>
      </article>
      <h3>最近上新与提取词</h3>
      <Empty
        v-if="!events.length"
        description="完成基线后，新的发现会显示在这里"
      />
      <article v-for="event in events" :key="event.id" class="watch-row">
        <Tag color="orange">
          竞品上新 · {{ event.kind === 'ads' ? '广告' : '商品' }}
        </Tag>
        <a :href="event.url" target="_blank" rel="noreferrer">{{
          event.title
        }}</a>
        <p>{{ new Date(event.detectedAt).toLocaleString('zh-CN') }}</p>
        <Tag v-for="term in event.terms" :key="term">{{ term }}</Tag>
        <p v-if="!event.terms.length" class="hci-subtle">
          文案不足，未提取到可信候选词；请查看来源。
        </p>
      </article>
    </template>
  </MonitorConfigPanel>
</template>
<style scoped>
.watch-fields,
.watch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.watch-row {
  padding: 16px 0;
  overflow-wrap: anywhere;
  border-bottom: 1px solid #e2e8f0;
}

h3 {
  margin-top: 24px;
}
</style>

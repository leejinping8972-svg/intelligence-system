<script setup lang="ts">
import type { WatchSnapshot } from '../competitor-monitor';
import type { Market } from '../data';

import { computed, onUnmounted, reactive, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Switch,
  Tag,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { watchStatus } from '../competitor-monitor';
import { marketName, state } from '../data';
import { serverMode, session } from '../session';

const busy = ref(false);
const error = ref('');
const loading = ref(false);
const open = ref(false);
const settings = ref(false);
const snapshot = ref<WatchSnapshot>();
const market = ref<Market>(state.market === 'ALL' ? 'US' : state.market);
const form = reactive({
  seeds: 'supplements\ncreatine\ncollagen\nprobiotics\nmagnesium',
  enabled: false,
  hour: 8,
});
const canEdit = computed(() => !serverMode || session.user?.role === 'admin');
const ranking = computed(() =>
  snapshot.value?.rankings.find((r) => r.market === market.value),
);
const run = computed(() =>
  snapshot.value?.runs.find((r) => r.id === `hot-${market.value}`),
);
const config = computed(() =>
  snapshot.value?.configs.find((r) => r.market === market.value),
);
const seeds = computed(() => [
  ...new Set(
    form.seeds
      .split(/[\n,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]);
function loadForm() {
  const saved = config.value;
  if (saved) Object.assign(form, { ...saved, seeds: saved.seeds.join('\n') });
  else
    Object.assign(form, {
      seeds:
        market.value === 'MX'
          ? 'suplementos\ncreatina\ncolágeno\nprobióticos\nmagnesio'
          : market.value === 'VN'
            ? 'thực phẩm bổ sung\ncollagen\nvitamin\nprobiotics'
            : 'supplements\ncreatine\ncollagen\nprobiotics\nmagnesium',
      enabled: false,
      hour: 8,
    });
}
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    snapshot.value = await cloudRequest<WatchSnapshot>(
      'server_competitor_snapshot',
    );
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '热词榜读取失败';
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
watch(open, async (value, _old, onCleanup) => {
  let cancelled = false;
  onCleanup(() => {
    cancelled = true;
    if (timer) clearInterval(timer);
  });
  if (timer) clearInterval(timer);
  if (value) {
    await refresh();
    if (cancelled) return;
    loadForm();
    timer = setInterval(() => void refresh(), 15000);
  }
});
watch(market, loadForm);
watch(
  () => state.market,
  (value) => {
    if (value !== 'ALL') market.value = value;
  },
);
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
async function action(name: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await cloudRequest(name, {
      ...form,
      seeds: seeds.value,
      market: market.value,
      kind: 'hotwords',
    });
    message.success(
      name.endsWith('check') ? '已排队，本日只执行一次' : '热词榜配置已保存',
    );
    await refresh();
    await syncCloudWorkspace();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button @click="open = true">Semrush 热词榜</Button>
  <Drawer
    v-model:open="open"
    title="保健品热词 TOP 100"
    width="min(440px, 100vw)"
  >
    <Select
      v-model:value="market"
      aria-label="热词榜市场"
      :options="
        (['US', 'MX', 'VN'] as const).map((value) => ({
          value,
          label: marketName(value),
        }))
      "
      style="width: 100%"
    />
    <p class="hot-explanation">
      Semrush保健品种子词汇总，按月搜索量排序，每日刷新。每个种子取搜索量最高的100词，合并去重后取前100；属于种子覆盖范围内的榜单。
    </p>
    <div class="hot-actions">
      <Button size="small" :loading="loading" @click="refresh">刷新状态</Button>
      <Button v-if="canEdit" size="small" @click="settings = !settings">
        {{ settings ? '收起设置' : '每日更新设置' }}
      </Button>
    </div>
    <Alert v-if="error" type="error" :message="error" role="alert" show-icon />
    <Form
      v-if="settings && canEdit"
      layout="vertical"
      class="hot-settings"
      @submit.prevent="action('server_competitor_hot_save')"
    >
      <Form.Item label="保健品种子词（1～10个，每行一个）">
        <Input.TextArea v-model:value="form.seeds" :rows="5" />
      </Form.Item>
      <Form.Item label="每日更新时间（北京时间，0～23点）">
        <InputNumber
          v-model:value="form.hour"
          :min="0"
          :max="23"
          :precision="0"
        />
      </Form.Item>
      <Form.Item label="每日自动更新">
        <Switch
          v-model:checked="form.enabled"
          checked-children="启用"
          un-checked-children="暂停"
        />
      </Form.Item>
      <p>
        每日最多{{ seeds.length }}个报告，预留上限{{ seeds.length * 2000 }} API
        units（每个种子100行×20
        units）。使用现有Semrush额度；失败或扣费未知后停止后续请求。
      </p>
      <Button type="primary" :loading="busy" html-type="submit">
        保存设置
      </Button>
      <Button
        v-if="config"
        :loading="busy"
        @click="action('server_competitor_check')"
      >
        本日立即更新
      </Button>
    </Form>
    <p>
      {{ config?.enabled ? `每日${config.hour}:00更新` : '自动更新未启用' }} ·
      {{ run ? `${run.day} ${watchStatus[run.status]}` : '尚未抓取' }}
    </p>
    <p v-if="run">
      {{ run.requests }}个报告 · 已确认{{ run.confirmedUnits || 0 }} units ·
      预留{{ run.reservedUnits || 0 }} units<span v-if="run.unknownCharges">
        · {{ run.unknownCharges }}个请求扣费未确认</span>
    </p>
    <p v-for="text in run?.errors" :key="text" role="alert">{{ text }}</p>
    <template v-if="ranking">
      <p>
        采集：{{ new Date(ranking.collectedAt).toLocaleString('zh-CN') }} ·
        实际{{ ranking.rows.length }}词<Tag
          v-if="!ranking.complete"
          color="orange"
        >
          部分结果
        </Tag>
      </p>
      <p class="hot-explanation">
        种子：{{
          ranking.seeds.join('、')
        }}。搜索量沿用Semrush当前数据库口径，采集时间与数据统计期不同。结果已同步关键词研究，保留原收藏和入选状态。
      </p>
      <div class="hot-heading">
        <span>名次 / 关键词</span><span>月搜索量 · 较上次</span>
      </div>
      <ol class="hot-ranking">
        <li v-for="row in ranking.rows" :key="row.term">
          <span class="hot-rank">{{ row.rank }}</span><span class="hot-term">{{ row.term }}</span>
          <span class="hot-values"><b>{{ row.volume.toLocaleString() }}</b><small>{{
              row.change === null
                ? '新入榜'
                : row.change > 0
                  ? `↑ ${row.change}`
                  : row.change < 0
                    ? `↓ ${-row.change}`
                    : '—'
            }}</small></span>
        </li>
      </ol>
    </template>
    <Empty
      v-else
      description="暂无榜单；管理员保存种子词并启用每日更新后生成"
    />
  </Drawer>
</template>
<style scoped>
.hot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}

.hot-explanation {
  margin: 12px 0;
  font-size: 12px;
  color: #64748b;
  overflow-wrap: anywhere;
}

.hot-settings {
  padding: 12px;
  margin: 16px 0;
  background: #f8fafc;
}

.hot-heading {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  font-size: 12px;
  color: #64748b;
}

.hot-ranking {
  padding: 0;
  margin: 0;
  list-style: none;
}

.hot-ranking li {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #e2e8f0;
}

.hot-rank {
  width: 24px;
  font-variant-numeric: tabular-nums;
  color: #64748b;
}

.hot-term {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.hot-values {
  display: grid;
  gap: 4px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.hot-values small {
  color: #64748b;
}
</style>

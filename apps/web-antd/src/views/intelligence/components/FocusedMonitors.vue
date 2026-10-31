<script setup lang="ts">
import type { FocusedMonitorRow } from '../focused-monitors';

import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
} from 'ant-design-vue';

import { cloudRequest } from '../cloud-workspace';
import { watchStatus } from '../competitor-monitor';
import {
  competitorWorkspace,
  refreshCompetitorWorkspace,
  useCompetitorWorkspace,
} from '../competitor-workspace';
import { audit, marketName, state } from '../data';
import { focusedMonitorRows } from '../focused-monitors';
import { collectionTimeLabel } from '../resource-metadata';
import { serverMode, session } from '../session';
import ProductDrawer from './ProductDrawer.vue';

const router = useRouter();
useCompetitorWorkspace();
const busy = ref('');
const kind = ref('ALL');
const page = ref(1);
const search = ref('');
const status = ref('ALL');
const editor = ref<FocusedMonitorRow>();
const productId = ref<string>();
const form = reactive({ hour: 8, maxPages: 10, enabled: false });
const canEdit = computed(() => !serverMode || session.user?.role === 'admin');
const rows = computed(() =>
  focusedMonitorRows(
    state.products,
    state.monitors,
    competitorWorkspace.targets,
    competitorWorkspace.runs,
    state.market,
  ).filter(
    (row) =>
      (kind.value === 'ALL' || row.kind === kind.value) &&
      (status.value === 'ALL' || String(row.enabled) === status.value) &&
      `${row.title} ${row.subtitle}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
watch([search, kind, status, () => state.market], () => {
  page.value = 1;
  editor.value = undefined;
  productId.value = undefined;
});
const labels = { product: '商品', site: '独立站', advertiser: '广告主' };
async function change(row: FocusedMonitorRow, enabled: boolean) {
  if (row.legacy) {
    row.legacy.enabled = enabled;
    audit(
      '调整商品监控配置',
      row.legacy.productId,
      state.products.find((p) => p.id === row.legacy?.productId)?.market,
    );
    return;
  }
  if (!row.target || busy.value) return;
  busy.value = row.id;
  try {
    await cloudRequest('server_competitor_update', {
      id: row.target.id,
      enabled,
    });
    await refreshCompetitorWorkspace(true);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '状态更新失败');
  } finally {
    busy.value = '';
  }
}
function edit(row: FocusedMonitorRow) {
  if (!row.target) return;
  editor.value = row;
  Object.assign(form, row.target);
}
async function save() {
  const row = editor.value;
  if (!row?.target || busy.value) return;
  busy.value = row.id;
  try {
    await cloudRequest('server_competitor_update', {
      id: row.target.id,
      ...form,
    });
    await refreshCompetitorWorkspace(true);
    editor.value = undefined;
    message.success('监控设置已保存');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    busy.value = '';
  }
}
async function remove(row: FocusedMonitorRow) {
  if (!row.target || busy.value) return;
  busy.value = row.id;
  try {
    await cloudRequest('server_competitor_remove', { id: row.target.id });
    await refreshCompetitorWorkspace(true);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '移除失败');
  } finally {
    busy.value = '';
  }
}
async function retryPublic(row: FocusedMonitorRow) {
  if (!row.target || busy.value) return;
  busy.value = row.id;
  try {
    await cloudRequest('server_competitor_retry_site', { id: row.target.id });
    await refreshCompetitorWorkspace(true);
    message.success('已排队，仅恢复官网；不会重跑广告或Semrush');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '恢复提交失败');
  } finally {
    busy.value = '';
  }
}
async function check(row: FocusedMonitorRow) {
  if (!row.target || busy.value) return;
  busy.value = row.id;
  try {
    await cloudRequest('server_competitor_check', { id: row.target.id });
    await refreshCompetitorWorkspace(true);
    message.success('已提交本日检查');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '检查提交失败');
  } finally {
    busy.value = '';
  }
}
function view(row: FocusedMonitorRow) {
  if (row.legacy) {
    productId.value = row.legacy.productId;
    return;
  }
  if (!row.target) return;
  state.market = row.target.market;
  void router.push(
    row.kind === 'site'
      ? { path: '/sites', query: { site: row.target.siteId } }
      : {
          path: '/ads',
          query: { tab: 'advertisers', pageId: row.target.pageId },
        },
  );
}
</script>
<template>
  <Alert
    v-if="competitorWorkspace.error"
    :message="`独立站/广告主监控读取失败：${competitorWorkspace.error}，已显示的缓存保留`"
    type="error"
    show-icon
    role="alert"
  />
  <div class="hci-toolbar" style="margin-bottom: 12px">
    <Input.Search
      v-model:value="search"
      placeholder="搜索监控对象或Page ID"
      allow-clear
    />
    <Select
      v-model:value="kind"
      aria-label="监控对象类型"
      :options="[
        { label: '全部监控类型', value: 'ALL' },
        ...Object.entries(labels).map(([value, label]) => ({ value, label })),
      ]"
      style="min-width: 150px"
    />
    <Select
      v-model:value="status"
      aria-label="监控启停状态"
      :options="[
        { label: '全部状态', value: 'ALL' },
        { label: '已开启', value: 'true' },
        { label: '已暂停', value: 'false' },
      ]"
      style="min-width: 130px"
    />
    <Button
      :loading="competitorWorkspace.loading"
      @click="refreshCompetitorWorkspace()"
    >
      刷新监控
    </Button>
    <span class="hci-subtle">{{ rows.length }}个对象 · 时间为北京时间</span>
  </div>
  <Table
    :data-source="rows"
    row-key="id"
    :loading="competitorWorkspace.loading && !competitorWorkspace.loaded"
    :pagination="{
      current: page,
      pageSize: 10,
      showSizeChanger: false,
      onChange: (value: number) => (page = value),
    }"
    :scroll="{ x: 1100 }"
    :columns="[
      { title: '监控对象', key: 'object', width: 300 },
      { title: '周期', key: 'schedule', width: 170 },
      { title: '监控内容', dataIndex: 'fields', width: 180 },
      { title: '最近执行', key: 'run', width: 240 },
      { title: '状态', key: 'status', width: 100 },
      { title: '操作', key: 'actions', width: 170 },
    ]"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'object'">
        <Tag>{{ labels[record.kind as keyof typeof labels] }}</Tag><b>{{ record.title }}</b>
        <p class="hci-subtle">
          {{ marketName(record.market) }} · {{ record.subtitle }}
        </p>
      </template>
      <template v-else-if="column.key === 'schedule'">
        <Select
          v-if="record.legacy"
          v-model:value="record.legacy.frequency"
          :options="
            ['每天', '每两天', '每周'].map((value) => ({ label: value, value }))
          "
          style="width: 110px"
          @change="
            audit('修改商品监控配置', record.legacy.productId, record.market)
          "
        />
        <template v-else>
          {{ record.schedule }}
          <p class="hci-subtle">最多{{ record.target.maxPages }}页/渠道</p>
        </template>
      </template>
      <template v-else-if="column.key === 'run'">
        <template v-if="record.run">
          <Tag :color="record.run.status === 'failed' ? 'red' : 'blue'">
            {{ watchStatus[record.run.status] || record.run.status }}
</Tag>{{ record.run.day }}
          <p class="hci-subtle">
            {{ record.run.requests }}次请求 · {{ record.run.added || 0 }}项上新
          </p>
          <p v-for="text in record.run.errors" :key="text" class="hci-subtle">
            {{ text }}
          </p>
          <p
            v-if="
              record.run.publicRecovery?.eligible &&
              !record.run.publicRecovery?.ready
            "
            class="hci-subtle"
          >
            官网冷却至{{
              collectionTimeLabel(
                new Date(record.run.publicRecovery.nextRunAt).toISOString(),
              )
            }}
          </p>
          <p
            v-if="record.target?.siteId && record.run.publicRecovery?.reason"
            class="hci-subtle"
          >
            {{ record.run.publicRecovery.reason }} · 今日剩余{{
              record.run.publicRecovery.remaining
            }}次
          </p>
        </template>
        <span v-else class="hci-subtle">{{
          record.legacy ? '商品监控配置' : '尚未执行'
        }}</span>
      </template>
      <template v-else-if="column.key === 'status'">
        <Switch
          :checked="record.enabled"
          :disabled="(!record.legacy && !canEdit) || !!busy"
          :loading="busy === record.id"
          checked-children="开启"
          un-checked-children="暂停"
          :aria-label="`启停监控 ${record.title}`"
          @change="change(record as FocusedMonitorRow, $event === true)"
        />
      </template>
      <template v-else-if="column.key === 'actions'">
        <div class="focused-actions">
          <Button size="small" @click="view(record as FocusedMonitorRow)">
            查看对象
</Button><template v-if="record.target && canEdit">
            <Button
              size="small"
              :disabled="!!busy"
              @click="check(record as FocusedMonitorRow)"
              >
本日立即检查
</Button>
            <Button
              v-if="record.run?.publicRecovery?.eligible"
              size="small"
              :disabled="!!busy || !record.run.publicRecovery.ready"
              @click="retryPublic(record as FocusedMonitorRow)"
            >
              仅恢复官网
            </Button>
            <Button
              size="small"
              :disabled="!!busy"
              @click="edit(record as FocusedMonitorRow)"
            >
              设置
</Button><Popconfirm
              title="移除此监控？已采集结果和历史记录保留。"
              @confirm="remove(record as FocusedMonitorRow)"
            >
              <Button size="small" danger :disabled="!!busy"> 移除 </Button>
            </Popconfirm>
          </template>
        </div>
      </template>
    </template>
  </Table>
  <Modal
    :open="!!editor"
    title="监控设置"
    width="min(520px, 100vw)"
    :confirm-loading="!!busy"
    ok-text="保存设置"
    @ok="save"
    @cancel="editor = undefined"
  >
    <p>{{ editor?.title }} · {{ editor ? marketName(editor.market) : '' }}</p>
    <Form layout="vertical">
      <Form.Item label="每日更新时间（北京时间0～23点）">
        <InputNumber
          v-model:value="form.hour"
          :min="0"
          :max="23"
          :precision="0"
        />
      </Form.Item>
      <Form.Item label="每渠道页面上限">
<InputNumber
          v-model:value="form.maxPages"
          :min="1"
          :max="100"
          :precision="0"
/>
</Form.Item><Form.Item label="启用自动检查">
        <Switch v-model:checked="form.enabled" />
      </Form.Item>
    </Form>
    <p class="hci-subtle">
      启用后按每日计划执行，消耗已配置数据源额度；本日已尝试的请求不会因切换状态而重放。
    </p>
  </Modal>
  <ProductDrawer :id="productId" @close="productId = undefined" />
</template>
<style scoped>
.focused-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>

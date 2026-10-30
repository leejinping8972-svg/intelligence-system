<script setup lang="ts">
import type { DiscoveryPlan } from '../discovery-monitors';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createIconifyIcon } from '@vben/icons';
import {
  Alert,
  Button,
  Empty,
  Modal,
  Popconfirm,
  Switch,
  Table,
  Tooltip,
} from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { state } from '../data';
import { discoveryLabels } from '../discovery-monitors';
import { session } from '../session';
import DiscoveryPlanForm from './DiscoveryPlanForm.vue';
const router = useRouter();
const Trash = createIconifyIcon('lucide:trash-2');
const plans = ref<DiscoveryPlan[]>([]),
  busy = ref(false),
  error = ref(''),
  editor = ref<DiscoveryPlan>();
const rows = computed(() =>
  plans.value.filter(
    (p) => state.market === 'ALL' || p.market === state.market,
  ),
);
async function load() {
  busy.value = true;
  try {
    plans.value = (
      await cloudRequest<{ plans: DiscoveryPlan[] }>(
        'server_discovery_snapshot',
      )
    ).plans;
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  } finally {
    busy.value = false;
  }
}
async function toggle(plan: DiscoveryPlan, enabled: boolean) {
  try {
    await cloudRequest('server_discovery_toggle', { id: plan.id, enabled });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  }
}
async function remove(plan: DiscoveryPlan) {
  try {
    await cloudRequest('server_discovery_delete', { id: plan.id });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败';
  }
}
onMounted(() => void load());
defineExpose({ refresh: load });
</script>
<template>
  <div class="hci-toolbar">
    <h3>新品与成分研究</h3>
    <Button :loading="busy" @click="load">刷新</Button>
  </div>
  <Alert v-if="error" type="error" :message="error" show-icon />
  <Table
    size="small"
    row-key="id"
    :loading="busy"
    :data-source="rows"
    :pagination="{ pageSize: 10 }"
    :scroll="{ x: 760 }"
    :columns="[
      { key: 'kind', title: '监控' },
      { dataIndex: 'market', title: '市场', width: 80 },
      { key: 'scope', title: '渠道与范围' },
      { key: 'schedule', title: '执行周期' },
      { key: 'enabled', title: '状态', width: 90 },
      { key: 'actions', title: '操作', width: 170 },
    ]"
  >
    <template #emptyText
      ><Empty description="暂无新品或成分研究监控"
    /></template>
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'kind'">{{
        discoveryLabels[record.kind as keyof typeof discoveryLabels]
      }}</template>
      <template v-else-if="column.key === 'scope'"
        >{{ record.channels.join(' / ') }}
        <p class="hci-subtle">近{{ record.days }}天 · 保健品</p></template
      >
      <template v-else-if="column.key === 'schedule'"
        >{{
          record.frequency === 'daily'
            ? '每天'
            : record.frequency === 'weekly'
              ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
                  record.weekday
                ]
              : `每月${record.monthDay}日`
        }}
        {{ record.time }}
        <p class="hci-subtle">北京时间</p></template
      >
      <template v-else-if="column.key === 'enabled'"
        ><Switch
          :checked="record.enabled"
          :disabled="session.user?.role !== 'admin'"
          @change="toggle(record as DiscoveryPlan, Boolean($event))"
      /></template>
      <template v-else-if="column.key === 'actions'"
        ><Button size="small" @click="editor = record as DiscoveryPlan"
          >编辑</Button
        ><Button
          v-if="record.lastJobId"
          type="link"
          size="small"
          @click="
            router.push({
              path: '/monitor',
              query: { tab: 'tasks', job: record.lastJobId },
            })
          "
          >最近任务</Button
        ><Popconfirm
          title="删除此监控？已保存的任务和结果将保留。"
          @confirm="remove(record as DiscoveryPlan)"
          ><Tooltip title="删除监控"
            ><Button
              size="small"
              danger
              aria-label="删除监控"
              :disabled="session.user?.role !== 'admin'"
              ><template #icon
                ><Trash /></template></Button></Tooltip></Popconfirm
      ></template>
    </template>
  </Table>
  <Modal
    :open="Boolean(editor)"
    title="编辑监控"
    :width="720"
    :footer="null"
    @cancel="editor = undefined"
    ><DiscoveryPlanForm
      v-if="editor"
      :key="editor.id"
      :kind="editor.kind"
      :plan="editor"
      scheduled
      @saved="
        editor = undefined;
        load();
      "
  /></Modal>
</template>

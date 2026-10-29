<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { Alert, Button, Input, Modal, Table, Tag } from 'ant-design-vue';
import { adminRequest } from '../session';
import { connectionFields } from '../source-connections';
import type { SourceUsageSnapshot, UsageSource } from '../source-usage';
import SourceConfiguration from './SourceConfiguration.vue';
const sources = ref<UsageSource[]>([]);
const busy = ref(false);
const error = ref('');
const search = ref('');
const selected = ref<UsageSource>();
const unknownSources = ref<string[]>([]);
let disposed = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => { disposed = true; clearTimeout(retryTimer); });
const rows = computed(() => sources.value.filter(source => (source.name + source.description + (connectionFields[source.id]?.fields || '')).toLowerCase().includes(search.value.toLowerCase())));
async function load() {
  clearTimeout(retryTimer);
  busy.value = true;
  error.value = '';
  try {
    const [snapshot, westmonth] = await Promise.all([
      adminRequest<SourceUsageSnapshot | { loading: true }>('server_source_usage', { days: 1, page: 1 }),
      adminRequest<{ configured: boolean }>('server_westmonth_session_status').catch(() => null),
    ]);
    if ('loading' in snapshot) { error.value = '来源状态正在整理，将自动刷新'; if (!disposed) retryTimer = setTimeout(load, 2000); return; }
    if (disposed) return;
    unknownSources.value = westmonth === null ? ['westmonth'] : [];
    sources.value = [...snapshot.sources, ...(snapshot.sources.some(source => source.id === 'westmonth') ? [] : [{ id: 'westmonth', name: '西之月', description: '商品折后价采集使用的登录会话', configured: westmonth?.configured ?? false, unit: '', records: 0 } as UsageSource])];
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取来源失败'; }
  finally { busy.value = false; }
}
async function close() { selected.value = undefined; await load(); }
onMounted(load);
</script>
<template>
  <section class="hci-panel source-connections">
    <div class="hci-panel-head"><div><h2>数据源连接</h2><p>配置采集与分析所需的 Key、Token 和连接参数。已保存状态不代表连接检测通过。</p></div><Button :loading="busy" @click="load">刷新状态</Button></div>
    <div class="hci-toolbar"><Input.Search v-model:value="search" placeholder="搜索来源或配置字段" aria-label="搜索数据源连接" allow-clear /><Tag>{{ sources.filter(source => source.configured).length }} 个来源已配置</Tag><RouterLink to="/usage">查看额度与消耗</RouterLink></div>
    <Alert v-if="error" type="error" show-icon :message="error" />
    <Table size="small" row-key="id" :data-source="rows" :loading="busy" :pagination="false" :scroll="{ x: 900 }" :columns="[
      { title: '数据来源', key: 'name', width: 170 }, { title: '用途 / 覆盖', dataIndex: 'description', width: 290 },
      { title: '实际配置字段', key: 'fields', width: 270 }, { title: '配置状态', key: 'status', width: 140 }, { title: '操作', key: 'actions', width: 120 },
    ]">
      <template #bodyCell="{ column, record }">
        <strong v-if="column.key === 'name'">{{ record.name }}</strong>
        <template v-else-if="column.key === 'fields'"><span>{{ connectionFields[record.id]?.fields || (record.free ? '公开接口，无需 Key' : '暂未开放自动接入') }}</span></template>
        <template v-else-if="column.key === 'status'"><Tag :color="record.configured ? 'blue' : 'default'">{{ unknownSources.includes(record.id) ? '状态读取失败' : record.free ? '公开来源' : record.inactive ? '导入 / 待接入' : record.configured ? '已保存配置' : '待配置' }}</Tag></template>
        <Button v-else-if="column.key === 'actions'" size="small" :type="connectionFields[record.id] ? 'primary' : 'default'" @click="selected = record as UsageSource">{{ connectionFields[record.id] ? '配置连接' : '接入说明' }}</Button>
      </template>
    </Table>
  </section>
  <Modal :open="!!selected" :title="selected?.name + ' · 连接配置'" :width="760" :footer="null" destroy-on-close @cancel="close">
    <template v-if="selected"><p class="hci-subtle">{{ selected.description }}</p><SourceConfiguration :key="selected.id" :source-id="selected.id" /></template>
  </Modal>
</template>

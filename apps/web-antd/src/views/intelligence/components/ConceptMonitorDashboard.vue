<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {RouterLink} from 'vue-router';

import { Alert, AutoComplete, Button, Input, message, Modal, Spin, Table, Tooltip } from 'ant-design-vue';

import { state } from '../data';
import {adminRequest, serverMode, session} from '../session';
import { useStatistics } from '../statistics-queries';
import CollectionTime from './CollectionTime.vue';

interface ConceptRow {
  id: string;
  batch: string;
  markets: string[];
  collectedAt: string;
  keywords: number;
  keywordsToday: number;
  ads: number;
  adsToday: number;
  sites: number;
  sitesToday: number;
  products: number;
  productsToday: number;
}
const search = ref('');
const page = ref(1);
const pageSize = ref(20);
const sort = ref('collectedAt');
const order = ref<'ascend' | 'descend'>('descend');
const query = computed(() => ({
  kind: 'concept-monitor',
  market: state.market,
  search: search.value,
  page: page.value,
  pageSize: pageSize.value,
  sort: sort.value,
  order: order.value,
}));
const remote = useStatistics<ConceptRow>(query);
const canMerge=computed(()=>serverMode && session.user?.role==='admin');
const selectedBatches=ref<string[]>([]);
const mergeError=ref(''); const mergeOpen=ref(false); const mergeTarget=ref(''); const merging=ref(false);
const mergeOptions=computed(()=>remote.rows.value.filter(row=>row.batch.toLocaleLowerCase().includes(mergeTarget.value.toLocaleLowerCase())).map(row=>({value:row.batch})));
const selectedRevision=ref(0);
function selectBatches(keys: (number | string)[]) {
  if(keys.length>50) { message.warning('每次最多合并50个批次'); return; }
  selectedBatches.value=keys.map(String);
}
function openMerge() {
  mergeTarget.value=selectedBatches.value[0]||'';
  mergeError.value=''; selectedRevision.value=remote.snapshot.value?.batchRevision||0;
  mergeOpen.value=true;
}
async function mergeBatches() {
  if(merging.value) return;
  merging.value=true; mergeError.value='';
  try {
    const result=await adminRequest<{target:string}>('server_collection_batches_merge',{batches:selectedBatches.value,target:mergeTarget.value,expectedRevision:selectedRevision.value},120_000);
    selectedBatches.value=[]; mergeOpen.value=false;
    message.success(`已合并到“${result.target}”，后台正在更新汇总`);
    await remote.reload(true);
  } catch(error) { mergeError.value=error instanceof Error?error.message:'合并失败，请重试'; }
  finally {merging.value=false;}
}
const destinations:Record<string,string>={keywords:'/research',ads:'/ads',sites:'/sites',products:'/products'};
function destination(batch:string,key:string) {
  const kind=key.replace(/Today$/,'');
  return {path:destinations[kind]!,query:{conceptBatch:batch,market:state.market,...(key.endsWith('Today')?{conceptDay:remote.snapshot.value?.day}:{})}};
}
const preparing = computed(
  () => !remote.error.value && (
    !remote.snapshot.value || (
      remote.snapshot.value.indexing === true &&
      remote.total.value === 0 &&
      !search.value.trim()
    )
  ),
);
const busy = computed(() => remote.loading.value || preparing.value);
watch([search, () => state.market], () => {
  page.value = 1;
  selectedBatches.value=[];
});
const fields = [
  { title: '采集批次', key: 'batch', width: 200, fixed: 'left' as const },
  { title: '市场', key: 'markets', width: 110 },
  { title: '关联关键词', key: 'keywords', width: 110 },
  { title: '今日新增关键词', key: 'keywordsToday', width: 135 },
  { title: '关联广告', key: 'ads', width: 100 },
  { title: '今日新增广告', key: 'adsToday', width: 125 },
  { title: '关联独立站', key: 'sites', width: 110 },
  { title: '今日新增独立站', key: 'sitesToday', width: 135 },
  { title: '关联商品', key: 'products', width: 100 },
  { title: '今日新增商品', key: 'productsToday', width: 125 },
  { title: '采集时间（北京时间）', key: 'collectedAt', width: 180 },
];
const columns = computed(() =>
  fields.map((field) => ({
    ...field,
    dataIndex: field.key,
    sorter: true,
    sortDirections: ['descend', 'ascend'] as ('ascend' | 'descend')[],
    sortOrder: sort.value === field.key ? order.value : null,
  })),
);
function change(
  pagination: { current?: number; pageSize?: number },
  _filters: unknown,
  sorter: any,
) {
  const selected = Array.isArray(sorter) ? sorter[0] : sorter;
  const nextSort = selected?.order ? String(selected.columnKey) : 'collectedAt';
  const nextOrder = selected?.order || 'descend';
  const changed =
    nextSort !== sort.value ||
    nextOrder !== order.value ||
    pageSize.value !== pagination.pageSize;
  sort.value = nextSort;
  order.value = nextOrder;
  page.value = changed ? 1 : pagination.current || 1;
  pageSize.value = pagination.pageSize || 20;
}
</script>

<template>
  <section
    class="hci-panel concept-monitor"
    aria-labelledby="concept-monitor-title"
    :aria-busy="busy"
  >
    <div class="hci-panel-head concept-monitor-head">
      <div>
        <h2 id="concept-monitor-title">概念监控看板</h2>
        <p>按采集批次汇总关联数据 · 每日北京时间 09:00 更新</p>
      </div>
      <div class="concept-monitor-tools">
        <Button v-if="canMerge" :disabled="selectedBatches.length < 2 || merging" @click="openMerge">合并批次<span v-if="selectedBatches.length">（{{ selectedBatches.length }}）</span></Button>
        <Input
          v-model:value="search"
          aria-label="搜索采集批次"
          placeholder="搜索采集批次"
          allow-clear
        />
        <Button :loading="remote.loading.value" @click="remote.reload(true)">
刷新
</Button>
      </div>
    </div>
    <Alert
      v-if="remote.error.value"
      type="error"
      :message="remote.error.value"
      show-icon
    />
    <p v-if="remote.snapshot.value" class="hci-subtle concept-monitor-note">
      汇总更新于 <CollectionTime :at="remote.snapshot.value.generatedAt" /> ·
      今日新增统计日期：{{ remote.snapshot.value.day }}（北京时间）
      <span v-if="remote.snapshot.value.indexing">
        · 后台数据更新中，汇总每 5 分钟自动补充
      </span>
    </p>
    <Table
      row-key="batch"
      size="small"
      :columns="columns"
      :data-source="remote.rows.value"
      :row-selection="canMerge ? {selectedRowKeys:selectedBatches,preserveSelectedRowKeys:true,onChange:selectBatches,getCheckboxProps:()=>({disabled:merging})} : undefined"
      :loading="remote.loading.value"
      :scroll="{ x: 1530 }"
      :pagination="{
        total: remote.total.value,
        current: remote.pagination.value.page,
        pageSize,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50', '100'],
        showTotal: (total: number) => `共 ${total} 个采集批次`,
      }"
      @change="change"
    >
      <template #emptyText>
        <div class="concept-monitor-empty" role="status" aria-live="polite">
          <Spin v-if="preparing && !remote.loading.value" size="small" />
          <span>{{
            remote.snapshot.value
              ? remote.snapshot.value.indexing && !search.trim()
                ? '后台数据更新中，汇总信息将自动补充。'
                : '暂无符合条件的采集批次'
              : remote.error.value
                ? '批次汇总读取失败，请点击刷新重试'
                : '正在生成汇总信息，完成后自动显示。'
          }}</span>
        </div>
      </template>
      <template #bodyCell="{ column, record }">
        <Tooltip v-if="column.key === 'batch'" :title="record.batch">
<span class="concept-batch">{{ record.batch }}</span>
</Tooltip>
        <span v-else-if="column.key === 'markets'">{{
          record.markets.join(' / ') || '—'
        }}</span>
        <CollectionTime
          v-else-if="column.key === 'collectedAt'"
          :at="record.collectedAt"
        />
        <RouterLink v-else :to="destination(record.batch,String(column.key))" class="concept-count" :class="{'concept-new':String(column.key).endsWith('Today') && record[String(column.key)] > 0}" :aria-label="`${record.batch} · ${column.title} ${record[String(column.key)]}，查看列表`">{{ record[String(column.key)] }}</RouterLink>
      </template>
    </Table>
    <p class="hci-subtle">
      同一批次内按记录去重；关联数据以已保存的关系为准。采集时间取关联记录最近采集时间，今日新增按首次发现时间统计，缺少该时间时使用已有采集时间。
    </p>
    <Modal v-model:open="mergeOpen" title="合并采集批次" ok-text="确认合并" :ok-button-props="{disabled:!mergeTarget.trim() || selectedBatches.length < 2}" :confirm-loading="merging" :cancel-button-props="{disabled:merging}" :closable="!merging" :keyboard="!merging" :mask-closable="false" @ok="mergeBatches">
      <p>将以下 {{ selectedBatches.length }} 个批次统一合并到目标批次：</p>
      <p class="concept-merge-names">{{ selectedBatches.join('、') }}</p>
      <label for="concept-merge-target">目标批次（选择已有名称或输入新名称）</label>
      <AutoComplete id="concept-merge-target" v-model:value="mergeTarget" :options="mergeOptions" :maxlength="100" :disabled="merging" style="width:100%;margin:8px 0 16px" aria-label="目标采集批次" />
      <Alert type="warning" show-icon message="所有市场的同名批次会一起合并。关联数据保留并去重，关键词和广告统一使用目标批次；原始采集历史保留。此操作不会重新采集数据。" />
      <Alert v-if="mergeError" type="error" show-icon :message="mergeError" style="margin-top:12px" />
    </Modal>
  </section>
</template>

<style scoped>
.concept-monitor {
  min-width: 0;
  margin-bottom: 20px;
}
.concept-monitor-tools {
  display: flex;
  gap: 8px;
  width: 480px;
  max-width: 100%;
}
.concept-monitor-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
}
.concept-monitor-empty {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.concept-batch {
  display: block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.concept-count.concept-new {
  color: var(--hci-green, #176b54);
  font-weight: 600;
}
.concept-count { color:var(--hci-blue,#1677ff); text-decoration:underline; text-underline-offset:3px; }
.concept-count:hover { text-decoration-thickness:2px; }
.concept-count:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
.concept-merge-names { overflow-wrap:anywhere; margin:12px 0; }
@media (max-width: 640px) {
  .concept-monitor-head {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .concept-monitor-tools {
    width: 100%;
  }
}
</style>

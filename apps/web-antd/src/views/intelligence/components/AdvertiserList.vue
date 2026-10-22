<script setup lang="ts">
import type { Ad } from '../data';

import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Button, Input, Table, Tag } from 'ant-design-vue';

import { groupAdvertisers } from '../advertisers';
import { useCompetitorWorkspace } from '../competitor-workspace';
import { marketName, state } from '../data';
import { useFilteredSelection } from '../resource-list';
import { collectionTimeLabel } from '../resource-metadata';
import BulkAdvertiserWatch from './BulkAdvertiserWatch.vue';
import CompactTags from './CompactTags.vue';
import SelectionBar from './SelectionBar.vue';
import type { AdvertiserRow } from '../advertisers';
import { serverMode } from '../session';
import { useWorkspaceList } from '../workspace-queries';
import WorkspaceReadStatus from './WorkspaceReadStatus.vue';

const props = defineProps<{ ads: Ad[]; pageId?: string }>();
const emit = defineEmits<{ ads: [pageId: string] }>();
const router = useRouter();
const workspace = useCompetitorWorkspace();
const page = ref(1);
  const search = ref('');
const pageSize = ref(10);
const remote = useWorkspaceList<AdvertiserRow>('advertisers', computed(() => ({ market: state.market, search: search.value })), page, pageSize);
watch(
  () => props.pageId,
  (value) => {
    search.value = value || '';
  },
  { immediate: true },
);
watch(
  () => state.market,
  () => {
    search.value = '';
  },
);
const grouped = computed(() => groupAdvertisers(props.ads, state.sites));
const rows = computed(() => serverMode ? remote.rows.value :
  grouped.value.filter((a) =>
    `${a.name} ${a.pageId} ${a.domains.join(' ')}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
const { ids, selected, selectable, selectAll, clear, rowSelection } =
  useFilteredSelection(rows, undefined, serverMode ? remote.selectAll : undefined);
watch([search, () => state.market, () => props.ads], () => {
  page.value = 1;
  clear();
});
const missing = computed(
  () => props.ads.filter((a) => !/^\d{1,40}$/.test(a.pageId || '')).length,
);
const known = computed(
  () =>
    new Set(
      workspace.targets
        .filter((t) => t.kind === 'advertiser')
        .map((t) => `${t.market}:${t.pageId}`),
    ),
);
function site(id: string) {
  void router.push({ path: '/sites', query: { site: id } });
}
</script>
<template>
  <section class="hci-panel">
    <div class="hci-toolbar">
      <Input.Search
        v-model:value="search"
        placeholder="搜索广告主、Page ID或关联域名"
        allow-clear
      /><span>{{ serverMode ? remote.total.value : grouped.length }}个广告主</span>
    </div>
    <p v-if="missing" class="hci-subtle">
      {{ missing }}条广告未提供有效Page
      ID，保留在广告素材列表，未按品牌名称合并为可监控广告主。
    </p>
    <SelectionBar
      :count="ids.length"
      :total="serverMode ? remote.total.value : selectable.length"
      @all="selectAll"
      @clear="clear"
      >
<BulkAdvertiserWatch :advertisers="selected" />
</SelectionBar>
    <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
    <Table
      :loading="remote.loading.value"
      row-key="id"
      :data-source="rows"
      :row-selection="rowSelection"
      :pagination="{
        total: serverMode ? remote.total.value : rows.length,
        current: page,
        pageSize: 10,
        showSizeChanger: false,
        onChange: (value: number) => (page = value),
      }"
      :scroll="{ x: 1050 }"
      :columns="[
        { title: '广告主', key: 'name', width: 260 },
        { title: '市场', key: 'market', width: 100 },
        { title: '本系统广告', key: 'counts', width: 160 },
        { title: '关联独立站', key: 'sites', width: 220 },
        { title: '最近采集', key: 'collectedAt', width: 180 },
        { title: '操作', key: 'actions', width: 150 },
      ]"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
<b>{{ record.name }}</b>
          <p class="hci-subtle">Page ID {{ record.pageId }}</p>
          <Tag v-if="known.has(record.id)" color="blue">
已加入监控
</Tag>
</template>
        <template v-else-if="column.key === 'market'">
{{
          marketName(record.market)
        }}
</template>
        <template v-else-if="column.key === 'counts'">
<b>{{ record.adCount ?? record.adIds.length }}条</b>
          <p class="hci-subtle">
            投放中{{ record.active }} · 已停止{{ record.stopped }}
          </p>
</template>
        <template v-else-if="column.key === 'sites'">
<CompactTags
            v-if="record.domains.length"
            :items="record.domains"
            label="关联站点"
          /><span v-else class="hci-subtle">未关联</span><Button
            v-for="id in record.siteIds"
            :key="id"
            type="link"
            size="small"
            @click="site(id)"
            >
查看站点
</Button>
</template>
        <template v-else-if="column.key === 'collectedAt'">
{{
          collectionTimeLabel(record.collectedAt)
        }}
</template>
        <template v-else-if="column.key === 'actions'">
<Button size="small" @click="emit('ads', record.pageId)">
查看广告
</Button><a
            :href="`https://www.facebook.com/${record.pageId}`"
            target="_blank"
            rel="noreferrer"
            >广告主页</a>
</template>
      </template>
    </Table>
  </section>
</template>

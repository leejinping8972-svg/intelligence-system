<script setup lang="ts">
import type { DiscoveryPlan, IngredientFinding } from './discovery-monitors';
import { computed, onMounted, ref, watch } from 'vue';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Table,
  Tag,
} from 'ant-design-vue';
import { cloudRequest } from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import DiscoveryPlanForm from './components/DiscoveryPlanForm.vue';
import { state } from './data';
const findings = ref<IngredientFinding[]>([]),
  busy = ref(false),
  error = ref(''),
  search = ref(''),
  open = ref(false),
  selected = ref<IngredientFinding>();
const plan = ref<DiscoveryPlan>();
const rows = computed(() =>
  findings.value
    .filter(
      (r) =>
        (state.market === 'ALL' || r.market === state.market) &&
        `${r.name} ${r.summary}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .toSorted((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
);
async function load() {
  busy.value = true;
  try {
    const snapshot = await cloudRequest<{
      ingredients: IngredientFinding[];
      plans: DiscoveryPlan[];
    }>('server_discovery_snapshot');
    findings.value = snapshot.ingredients;
    plan.value = snapshot.plans.find(
      (p) =>
        p.kind === 'ingredients' &&
        p.market === (state.market === 'ALL' ? 'US' : state.market),
    );
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '成分研究读取失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => void load());
watch(
  () => state.market,
  () => void load(),
);
</script>
<template>
  <main class="hci-page">
    <PageHeader title="成分研究" description=""
      ><Button :loading="busy" @click="load">刷新</Button
      ><Button type="primary" @click="open = true">研究设置</Button></PageHeader
    >
    <Alert v-if="error" :message="error" type="error" show-icon />
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索成分或讨论"
          style="max-width: 320px"
        />
      </div>
      <Table
        size="small"
        row-key="id"
        :data-source="rows"
        :loading="busy"
        :pagination="{ pageSize: 20 }"
        :scroll="{ x: 850 }"
        :columns="[
          { key: 'name', title: '成分', width: 200 },
          { dataIndex: 'summary', title: '讨论摘要' },
          { dataIndex: 'mentionCount', title: '原文数', width: 90 },
          { key: 'platforms', title: '平台', width: 150 },
          { key: 'first', title: '系统首次发现', width: 140 },
          { key: 'actions', title: '证据', width: 90 },
        ]"
      >
        <template #emptyText><Empty description="暂无成分研究结果" /></template>
        <template #bodyCell="{ column, record }"
          ><template v-if="column.key === 'name'"
            ><strong>{{ record.name }}</strong>
            <div>
              <Tag v-if="record.firstSeenInSystem" color="green"
                >本系统首次发现</Tag
              >
            </div></template
          ><template v-else-if="column.key === 'platforms'">{{
            record.platforms.join(' / ')
          }}</template
          ><template v-else-if="column.key === 'first'">{{
            record.firstSeenAt.slice(0, 10)
          }}</template
          ><Button
            v-else-if="column.key === 'actions'"
            size="small"
            @click="selected = record as IngredientFinding"
            >原文</Button
          ></template
        >
      </Table>
    </section>
    <Modal v-model:open="open" title="成分研究设置" :width="720" :footer="null"
      ><DiscoveryPlanForm
        v-if="open"
        kind="ingredients"
        :plan="plan"
        scheduled
        @saved="
          open = false;
          load();
        "
        @submitted="open = false"
    /></Modal>
    <Drawer
      :open="Boolean(selected)"
      :title="selected?.name"
      width="min(640px,100vw)"
      @close="selected = undefined"
      ><p>{{ selected?.summary }}</p>
      <article
        v-for="mention in selected?.mentions"
        :key="mention.id"
        class="ingredient-mention"
      >
        <a :href="mention.url" target="_blank" rel="noopener noreferrer"
          >{{ mention.platform }} · {{ mention.publishedAt }}</a
        >
        <blockquote>{{ mention.quote }}</blockquote>
        <p class="hci-subtle">{{ mention.topic }}</p>
      </article></Drawer
    >
  </main>
</template>
<style scoped>
.ingredient-mention {
  padding: 16px 0;
  border-bottom: 1px solid #e5e7eb;
  overflow-wrap: anywhere;
}
.ingredient-mention blockquote {
  margin: 10px 0;
  white-space: pre-wrap;
}
</style>

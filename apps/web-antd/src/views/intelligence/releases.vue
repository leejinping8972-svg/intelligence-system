<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Alert,
  Button,
  Drawer,
  Input,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import { adminRequest } from './session';
type Release = {
  id: string;
  title: string;
  builtAt: string;
  startedAt: string;
  sourceDigest: string;
  gitCommit?: string;
  current: boolean;
  changes: string[];
  files: string[];
  validation: string[];
  operator: string;
};
const records = ref<Release[]>([]),
  selected = ref<Release>(),
  search = ref(''),
  filter = ref('all'),
  busy = ref(false),
  error = ref('');
const rows = computed(() =>
  records.value.filter(
    (r) =>
      (filter.value === 'all' || r.current) &&
      `${r.id} ${r.title} ${r.changes.join(' ')} ${r.files.join(' ')}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
async function load() {
  busy.value = true;
  error.value = '';
  try {
    records.value = (
      await adminRequest<{ entries: Release[] }>('server_release_history')
    ).entries;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '日志加载失败';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
const columns = [
  { title: '版本 / 提交标识', key: 'version', width: 240 },
  { title: '发布时间', key: 'time', width: 170 },
  { title: '更新内容', key: 'changes' },
  { title: '提交者', dataIndex: 'operator', width: 90 },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'actions', width: 80 },
];
const time = (v: string) =>
  v
    ? new Date(v).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '—';
</script>
<template>
  <main class="hci-page">
    <PageHeader title="代码提交日志" description="" :show-market="false"
      ><Button :loading="busy" @click="load">刷新</Button></PageHeader
    ><Alert v-if="error" type="error" :message="error" show-icon />
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索版本、更新内容或文件"
          allow-clear
        /><Select
          v-model:value="filter"
          :options="[
            { label: '全部发布记录', value: 'all' },
            { label: '当前运行版本', value: 'current' },
          ]"
        /><span class="hci-subtle"
          >北京时间 · 最近 {{ records.length }} 次发布</span
        >
      </div>
      <Table
        :columns="columns"
        :data-source="rows"
        :loading="busy"
        row-key="id"
        :scroll="{ x: 1000 }"
        :pagination="{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
        }"
        :locale="{ emptyText: '尚无发布记录；从本版本起自动记录每次发布' }"
      >
        <template #bodyCell="{ column, record }"
          ><template v-if="column.key === 'version'"
            ><strong>{{ record.id }}</strong>
            <div class="hci-subtle">
              {{
                record.gitCommit
                  ? 'Git ' + record.gitCommit.slice(0, 12)
                  : '发布快照 ' + record.sourceDigest.slice(0, 12)
              }}
            </div></template
          ><template v-else-if="column.key === 'time'">{{
            time(record.startedAt)
          }}</template
          ><template v-else-if="column.key === 'changes'"
            ><strong>{{ record.title }}</strong>
            <div v-for="c in record.changes" :key="c">{{ c }}</div></template
          ><template v-else-if="column.key === 'status'"
            ><Tag :color="record.current ? 'green' : 'default'">{{
              record.current ? '运行中' : '历史版本'
            }}</Tag></template
          ><template v-else-if="column.key === 'actions'"
            ><Button size="small" @click="selected = record as Release"
              >详情</Button
            ></template
          ></template
        >
      </Table>
      <p class="hci-subtle">
        服务器自动保存发布快照与校验标识；未产生 Git
        提交的更新不显示虚构的提交号，历史记录从本次版本开始保留。
      </p>
    </section>
    <Drawer
      :open="!!selected"
      title="代码更新详情"
      :width="720"
      @close="selected = undefined"
      ><template v-if="selected"
        ><h2>{{ selected.title }}</h2>
        <p>{{ selected.id }} · {{ time(selected.startedAt) }}</p>
        <h3>本次更新</h3>
        <p v-for="c in selected.changes" :key="c">{{ c }}</p>
        <h3>验证结果</h3>
        <p v-for="c in selected.validation" :key="c">{{ c }}</p>
        <h3>变更文件（{{ selected.files.length }}）</h3>
        <p
          v-for="f in selected.files"
          :key="f"
          style="font-size: 12px; overflow-wrap: anywhere"
        >
          {{ f }}
        </p>
        <h3>源码校验 SHA-256</h3>
        <p style="overflow-wrap: anywhere">
          {{ selected.sourceDigest }}
        </p></template
      ></Drawer
    >
  </main>
</template>

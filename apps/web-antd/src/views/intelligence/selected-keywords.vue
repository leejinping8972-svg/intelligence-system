<script setup lang="ts">
import type { Keyword } from './data';

import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  cancelCloudJob,
  cloudWorkspace,
  submitCloudEnrichment,
  syncCloudWorkspace,
} from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import AdsCollectDialog from './components/AdsCollectDialog.vue';
import { audit, filteredKeywords, marketName, state } from './data';
import { assessKeyword } from './keyword-scoring';

const router = useRouter();
const error = ref('');
const ids = ref<string[]>([]);
const open = ref(false);
const search = ref('');
const status = ref('ALL');
const submitting = ref(false);
const page = ref(1);
const pageSize = ref(20);
const pendingIds = ref<string[]>([]);
const target = ref(10);
const labels: Record<string, string> = {
  pending: '尚未采集',
  queued: '等待采集',
  running: '采集中',
  completed: '已完成',
  partial: '部分完成',
  empty: '未找到站点',
  failed: '采集失败',
  cancelled: '已取消',
};
const colors: Record<string, string> = {
  queued: 'blue',
  running: 'processing',
  completed: 'green',
  partial: 'gold',
  empty: 'default',
  failed: 'red',
  cancelled: 'default',
};
const selected = computed(() =>
  filteredKeywords.value.filter((k) => k.reviewStatus === 'selected'),
);
const rows = computed(() =>
  selected.value
    .filter(
      (k) =>
        (status.value === 'ALL' ||
          (k.siteCollection?.status || 'pending') === status.value) &&
        `${k.term} ${k.seedTerm || ''} ${k.category}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .map((k) => ({ ...k, score: assessKeyword(k).score }))
    .toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1)),
);
const active = (r: Keyword) =>
  ['queued', 'running'].includes(r.siteCollection?.status || '');
const adActive = (r: Keyword) =>
  ['queued', 'running'].includes(r.adCollection?.status || '');
const adSelectable = computed(() =>
  selected.value.filter((k) => ids.value.includes(k.id) && !adActive(k)),
);
const selectable = computed(() =>
  selected.value.filter((k) => ids.value.includes(k.id) && !active(k)),
);
const completed = computed(
  () =>
    selected.value.filter((k) => k.siteCollection?.status === 'completed')
      .length,
);
watch([search, status, () => state.market], () => {
  page.value = 1;
  ids.value = [];
});
watch(selected, () => {
  ids.value = ids.value.filter((id) => selected.value.some((k) => k.id === id));
});
const columns = [
  { title: '关键词 / 种子词', key: 'term', width: 220, fixed: 'left' as const },
  { title: '市场 / 品类', key: 'market', width: 115 },
  {
    title: '研究评分',
    key: 'score',
    width: 105,
    defaultSortOrder: 'descend' as const,
    sorter: (a: { score: null | number }, b: { score: null | number }) =>
      (a.score ?? -1) - (b.score ?? -1),
  },
  { title: '站点采集状态', key: 'status', width: 145 },
  { title: '广告采集状态', key: 'ads', width: 145 },
  { title: '关联站点', key: 'sites', width: 100 },
  { title: '采集时间 / 说明', key: 'time', width: 260 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' as const },
];
function prepare(records: Keyword[]) {
  if (!records.length || records.length > 100) {
    message.warning('每次请选择1～100个尚未在采集中的入选关键词');
    return;
  }
  pendingIds.value = records.map((k) => k.id);
  error.value = '';
  open.value = true;
}
async function submit() {
  submitting.value = true;
  error.value = '';
  try {
    await submitCloudEnrichment('sites', pendingIds.value, target.value);
    open.value = false;
    ids.value = [];
    message.success('已提交后台采集，关闭页面后继续执行');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}
async function remove(r: Keyword) {
  r.reviewStatus = 'pending';
  audit('移出入选关键词', r.term);
  try {
    await syncCloudWorkspace();
    message.success('已移出入选列表，采集结果保留');
  } catch (e) {
    message.error((e as Error).message);
  }
}
async function cancel(r: Keyword) {
  try {
    if (r.siteCollection?.jobId) await cancelCloudJob(r.siteCollection.jobId);
    message.success('已取消该批次未完成任务');
  } catch (e) {
    message.error((e as Error).message);
  }
}
const time = (r: Keyword) =>
  r.siteCollection?.finishedAt ||
  r.siteCollection?.startedAt ||
  r.siteCollection?.submittedAt;
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="已入选关键词"
      description="第二步：从人工入选的关键词出发，采集并核验独立站，查看进度与结果。"
    >
      <Button @click="router.push('/research')">返回关键词研究</Button>
      <Button @click="router.push('/monitor')">查看后台任务</Button>
    </PageHeader>
    <Alert
      type="info"
      show-icon
      message="站点采集在服务器后台执行，关闭浏览器后继续。本站点阶段只验证官网与商品目录，商品详细采集在后续商品研究中执行。"
      style="margin-bottom: 20px"
    />
    <section class="hci-panel">
      <div class="selected-summary">
        <b>当前市场入选 {{ selected.length }} 个词</b
        ><span
          >已完成 {{ completed }} 个 · 等待或采集中
          {{ selected.filter(active).length }} 个</span
        >
      </div>
      <div class="selected-toolbar">
        <AdsCollectDialog
          :keyword-ids="adSelectable.map((k) => k.id)"
          :disabled="!cloudWorkspace.ready"
        />
        <Input
          v-model:value="search"
          placeholder="搜索入选关键词、种子词或品类"
          aria-label="搜索入选关键词"
          allow-clear
          style="width: 310px"
        />
        <Select
          v-model:value="status"
          aria-label="站点采集状态"
          style="width: 170px"
          :options="[
            { label: '全部采集状态', value: 'ALL' },
            ...Object.entries(labels).map(([value, label]) => ({
              value,
              label,
            })),
          ]"
        />
        <Button
          type="primary"
          :disabled="
            !cloudWorkspace.ready ||
            !selectable.length ||
            selectable.length > 100
          "
          @click="prepare(selectable)"
        >
          批量采集独立站（{{ selectable.length }}/100）
        </Button>
      </div>
      <Table
        :columns="columns"
        :data-source="rows"
        row-key="id"
        :scroll="{ x: 1300 }"
        :row-selection="{
          selectedRowKeys: ids,
          onChange: (keys) => (ids = keys as string[]),
          getCheckboxProps: (r) => ({ disabled: active(r) && adActive(r) }),
        }"
        :pagination="{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 个入选关键词`,
          onChange: (current, size) => {
            page = current;
            pageSize = size;
          },
        }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'term'">
            <b>{{ record.term }}</b>
            <p class="hci-subtle">种子：{{ record.seedTerm || '—' }}</p>
          </template>
          <template v-else-if="column.key === 'market'">
            {{ marketName(record.market) }}
            <p class="hci-subtle">{{ record.category }}</p>
          </template>
          <template v-else-if="column.key === 'score'">
            {{ record.score === null ? '待评级' : `${record.score} / 100` }}
            <p class="hci-subtle">
              {{
                assessKeyword(record as Keyword).status === 'rated'
                  ? '证据完整'
                  : '含缺项，仅供筛选'
              }}
            </p>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="colors[record.siteCollection?.status || 'pending']">
              {{ labels[record.siteCollection?.status || 'pending'] }}
            </Tag>
            <p v-if="record.siteCollection?.target" class="hci-subtle">
              本次 {{ record.siteCollection.count || 0 }}/{{
                record.siteCollection.target
              }}
              家
            </p>
          </template>
          <template v-else-if="column.key === 'sites'">
            <Button
              type="link"
              :disabled="!record.siteIds?.length"
              @click="
                router.push({ path: '/sites', query: { keywordId: record.id } })
              "
            >
              {{ record.siteIds?.length || 0 }} 家站点
            </Button>
          </template>
          <template v-else-if="column.key === 'ads'"
            ><Tag :color="colors[record.adCollection?.status || 'pending']">{{
              labels[record.adCollection?.status || 'pending']
            }}</Tag
            ><Button
              type="link"
              @click="
                router.push({ path: '/ads', query: { keywordId: record.id } })
              "
              >{{
                state.ads.filter((ad) => ad.keywordIds?.includes(record.id))
                  .length
              }}
              条广告</Button
            ></template
          >
          <template v-else-if="column.key === 'time'">
            <span>{{
              time(record as Keyword)
                ? new Date(time(record as Keyword)!).toLocaleString('zh-CN')
                : '—'
            }}</span>
            <p class="hci-subtle">
              {{
                record.siteCollection?.message || '人工入选后尚未提交站点采集'
              }}
            </p>
          </template>
          <template v-else-if="column.key === 'actions'">
            <AdsCollectDialog
              compact
              :keyword-ids="[record.id]"
              :disabled="!cloudWorkspace.ready || adActive(record as Keyword)"
            />
            <Button
              v-if="!active(record as Keyword)"
              type="link"
              :disabled="!cloudWorkspace.ready"
              @click="prepare([record as Keyword])"
            >
              {{ record.siteCollection ? '重新采集独立站' : '采集独立站' }}
            </Button>
            <Tooltip v-else title="将取消同一批次中所有尚未完成的关键词采集">
              <Button type="link" @click="cancel(record as Keyword)">
                取消该批次
              </Button>
            </Tooltip>
            <Button
              type="link"
              @click="
                router.push({ path: '/sites', query: { keywordId: record.id } })
              "
            >
              查看站点
            </Button>
            <Button
              type="link"
              :disabled="active(record as Keyword)"
              @click="remove(record as Keyword)"
            >
              移出入选
            </Button>
          </template>
        </template>
      </Table>
    </section>
    <Modal
      v-model:open="open"
      title="采集入选关键词的独立站"
      ok-text="提交后台采集"
      :confirm-loading="submitting"
      :cancel-button-props="{ disabled: submitting }"
      :closable="!submitting"
      :mask-closable="!submitting"
      @ok="submit"
    >
      <p>
        已选择 {{ pendingIds.length }} 个关键词。使用已配置的 Brave Search
        与官网验证。
      </p>
      <label for="selected-site-target">每个关键词目标站点数（1～10）</label>
      <InputNumber
        id="selected-site-target"
        v-model:value="target"
        :min="1"
        :max="10"
        :precision="0"
        style="display: block; margin: 12px 0"
      />
      <p class="hci-subtle">
        数量是采集目标，受搜索命中、官网可访问性与电商验证影响。未达到目标会标记部分完成或未找到站点，并记录实际数量；不自动购买任何额度。
      </p>
      <Alert v-if="error" type="error" :message="error" show-icon />
    </Modal>
  </main>
</template>
<style scoped>
.selected-summary,
.selected-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.selected-summary {
  justify-content: space-between;
}
.selected-summary span {
  color: #7b8794;
}
</style>

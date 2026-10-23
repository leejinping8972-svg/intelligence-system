<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Alert, Button } from 'ant-design-vue';
import type { ResourceProductEvidence } from '../product-resources';
import {
  resourceMetricLabels,
  resourceMetricValue,
  resourceModeLabels,
  resourceOriginalWindow,
  resourceRankingSummary,
  resourceStatusLabels,
} from '../product-resources';
import CollectionTime from './CollectionTime.vue';
import { cloudRequest } from '../cloud-workspace';
import { serverMode } from '../session';

const props = defineProps<{
  evidence: ResourceProductEvidence;
  compact?: boolean;
  history?: ResourceProductEvidence[];
  productId?: string;
}>();
const status = computed(
  () =>
    resourceStatusLabels[props.evidence.metric.status] ||
    props.evidence.metric.status,
);
const metricName = computed(
  () =>
    resourceMetricLabels[props.evidence.metric.kind] ||
    props.evidence.metric.kind,
);
const archiveRows = ref<ResourceProductEvidence[]>([]);
const archivePage = ref(1);
const archiveHasMore = ref(true);
const archiveLoading = ref(false);
const archiveError = ref('');
let archiveSequence = 0;
watch(
  () => props.productId,
  () => {
    archiveSequence++;
    archiveRows.value = [];
    archivePage.value = 1;
    archiveHasMore.value = true;
    archiveLoading.value = false;
    archiveError.value = '';
  },
);
const observations = computed(() =>
  [
    ...new Map(
      [...(props.history || []), ...archiveRows.value].map((snapshot) => [
        JSON.stringify(snapshot),
        snapshot,
      ]),
    ).values(),
  ].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)),
);
async function loadObservations() {
  if (!props.productId || archiveLoading.value || !archiveHasMore.value) return;
  archiveLoading.value = true;
  archiveError.value = '';
  const sequence = ++archiveSequence;
  try {
    const result = await cloudRequest<{
      observations: ResourceProductEvidence[];
      page: number;
      pageSize: number;
      hasMore: boolean;
    }>('server_product_resource_observations', {
      productId: props.productId,
      page: archivePage.value,
    });
    if (sequence !== archiveSequence) return;
    archiveRows.value.push(...result.observations);
    archiveHasMore.value = result.hasMore;
    archivePage.value = result.page + 1;
  } catch (cause) {
    if (sequence === archiveSequence)
      archiveError.value =
        cause instanceof Error ? cause.message : '观察归档读取失败';
  } finally {
    if (sequence === archiveSequence) archiveLoading.value = false;
  }
}
function stateLabel(value?: string | { status?: string; message?: string }) {
  if (!value) return '未执行';
  if (typeof value === 'string') return resourceStatusLabels[value] || value;
  return (
    [resourceStatusLabels[value.status || ''] || value.status, value.message]
      .filter(Boolean)
      .join(' · ') || '来源未返回状态'
  );
}
function sourcePrice(evidence: ResourceProductEvidence) {
  return (
    [
      evidence.price?.raw ||
        (Number.isFinite(evidence.price?.amount)
          ? String(evidence.price?.amount)
          : ''),
      evidence.price?.currency,
    ]
      .filter(Boolean)
      .join(' ') || '来源未返回'
  );
}
</script>
<template>
  <div v-if="compact" class="resource-evidence-compact">
    <p>{{ resourceRankingSummary(evidence) }}</p>
    <p class="hci-subtle">
      {{ metricName }}：{{ resourceMetricValue(evidence) }}
    </p>
    <p class="hci-subtle">
      请求近{{ evidence.requestedWindow.days }}天 ·
      {{ resourceOriginalWindow(evidence) }}
    </p>
    <p v-if="evidence.coverage.reason" class="hci-subtle">
      {{ evidence.coverage.reason }}
    </p>
  </div>
  <section v-else class="resource-product-evidence">
    <h3 class="hci-section-heading">资源路径与统计口径</h3>
    <dl class="hci-detail-grid">
      <dt>获取来源</dt>
      <dd>
        {{ evidence.provider }} · {{ evidence.platform }} ·
        {{ evidence.market }}
      </dd>
      <dt>获取方式</dt>
      <dd>{{ resourceModeLabels[evidence.mode] }} · {{ evidence.routeId }}</dd>
      <dt>平台类目</dt>
      <dd>
        {{
          evidence.category
            ? `${evidence.category.path.join(' > ')} · ${evidence.category.id}`
            : '未使用平台类目'
        }}
      </dd>
      <dt>统一研究类目</dt>
      <dd>{{ evidence.researchCategory || '未映射' }}</dd>
      <dt>关键词</dt>
      <dd>{{ evidence.queryTerms?.join('；') || '未使用关键词' }}</dd>
      <dt>请求销量窗口</dt>
      <dd>
        近{{ evidence.requestedWindow.days }}天
        <p class="hci-subtle">
          {{
            [evidence.requestedWindow.start, evidence.requestedWindow.end]
              .filter(Boolean)
              .join(' 至 ') || '窗口日期未记录'
          }}
          · 销量统计，非上架时间
        </p>
      </dd>
      <dt>原始销量口径</dt>
      <dd>
        {{ metricName }} · {{ resourceMetricValue(evidence) }}
        <p class="hci-subtle">
          {{ status }} · {{ evidence.metric.precision || '来源未说明精度' }}
        </p>
      </dd>
      <dt>来源统计区间</dt>
      <dd>
        {{ resourceOriginalWindow(evidence) }}
        <p v-if="evidence.metric.message" class="hci-subtle">
          {{ evidence.metric.message }}
        </p>
      </dd>
      <dt>排名与范围</dt>
      <dd>
        {{ resourceRankingSummary(evidence) }}
        <p v-if="evidence.ranking.sourceRank !== undefined" class="hci-subtle">
          来源榜单原名次：{{ evidence.ranking.sourceRank }}
        </p>
        <p v-if="evidence.ranking.eligible !== undefined" class="hci-subtle">
          可比样本 {{ evidence.ranking.eligible }} 件{{
            evidence.ranking.total !== undefined
              ? ` / 已采集 ${evidence.ranking.total} 件`
              : ''
          }}
        </p>
        <p v-if="evidence.ranking.message" class="hci-subtle">
          {{ evidence.ranking.message }}
        </p>
      </dd>
      <dt>覆盖证据</dt>
      <dd>
        {{ evidence.coverage.reason || '采集范围未完整验证' }}
        <p class="hci-subtle">
          {{
            evidence.coverage.complete
              ? '按来源记录的覆盖范围'
              : '覆盖不完整，不代表全平台或全类目前100'
          }}
        </p>
      </dd>
      <dt>详情 / 历史</dt>
      <dd>
        {{ stateLabel(evidence.states?.detail) }} /
        {{ stateLabel(evidence.states?.history) }}
      </dd>
      <dt>原币标价</dt>
      <dd>
        {{ sourcePrice(evidence) }}
        <p class="hci-subtle">
          {{
            evidence.price?.precision === 'source_decimal'
              ? '保留来源小数精度'
              : '来源精度未知'
          }}
        </p>
      </dd>
      <dt>来源商品ID</dt>
      <dd>{{ evidence.identity?.sourceProductId || '未返回' }}</dd>
      <dt>店铺</dt>
      <dd>
        {{
          [evidence.identity?.shopName, evidence.identity?.shopId]
            .filter(Boolean)
            .join(' · ') || '未返回'
        }}
      </dd>
      <dt>变体ID</dt>
      <dd>{{ evidence.identity?.variantId || '未返回' }}</dd>
      <dt>规格 / 配方原文</dt>
      <dd>
        {{ evidence.identity?.specification || '规格未返回' }}
        <p>{{ evidence.identity?.formula || '配方未返回' }}</p>
      </dd>
      <dt>采集时间</dt>
      <dd><CollectionTime :at="evidence.collectedAt" /></dd>
      <dt>来源页面</dt>
      <dd>
        <a
          v-if="evidence.evidenceUrl"
          :href="evidence.evidenceUrl"
          target="_blank"
          rel="noreferrer"
          >打开原始来源</a
        ><span v-else>来源未提供网址</span>
      </dd>
    </dl>
    <template v-if="evidence.identity?.variants?.length">
      <h3 class="hci-section-heading">来源变体证据</h3>
      <pre class="resource-variant-evidence">{{
        JSON.stringify(evidence.identity.variants, null, 2)
      }}</pre>
    </template>
    <h3
      v-if="observations.length || (serverMode && productId)"
      class="hci-section-heading"
    >
      已保存历史观察{{
        observations.length ? `（已载入${observations.length}条）` : ''
      }}
    </h3>
    <Alert
      v-if="archiveError"
      :message="archiveError"
      type="error"
      show-icon
      style="margin: 12px 0"
    />
    <template v-if="observations.length">
      <div class="resource-observation-scroll">
        <table class="resource-observation-table">
          <thead>
            <tr>
              <th>采集时间</th>
              <th>来源 / 国家</th>
              <th>原始指标</th>
              <th>统计区间</th>
              <th>排名范围</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(snapshot, index) in observations"
              :key="`${snapshot.jobId}:${snapshot.collectedAt}:${index}`"
            >
              <td><CollectionTime :at="snapshot.collectedAt" /></td>
              <td>{{ snapshot.provider }} · {{ snapshot.market }}</td>
              <td>
                {{
                  resourceMetricLabels[snapshot.metric.kind] ||
                  snapshot.metric.kind
                }}
                <p>{{ resourceMetricValue(snapshot) }}</p>
              </td>
              <td>{{ resourceOriginalWindow(snapshot) }}</td>
              <td>{{ resourceRankingSummary(snapshot) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <Button
      v-if="serverMode && productId && archiveHasMore"
      :loading="archiveLoading"
      style="margin-top: 12px"
      @click="loadObservations"
      >{{
        archivePage === 1 ? '读取归档观察（每次50条）' : '继续读取50条归档观察'
      }}</Button
    >
    <p v-if="serverMode && productId && !archiveHasMore" class="hci-subtle">
      观察归档已全部载入。
    </p>
  </section>
</template>
<style scoped>
.resource-evidence-compact {
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.resource-evidence-compact p {
  margin: 0 0 4px;
}
.resource-product-evidence :deep(dd) {
  overflow-wrap: anywhere;
}
.resource-variant-evidence {
  margin: 12px 0;
  padding: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f6f7f8;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  font-size: 12px;
}
.resource-observation-scroll {
  overflow-x: auto;
}
.resource-observation-table {
  width: 100%;
  min-width: 650px;
  border-collapse: collapse;
  font-size: 12px;
}
.resource-observation-table th,
.resource-observation-table td {
  padding: 10px 8px;
  border-bottom: 1px solid #e8e8e8;
  vertical-align: top;
  text-align: left;
}
.resource-observation-table p {
  margin: 4px 0 0;
}
</style>

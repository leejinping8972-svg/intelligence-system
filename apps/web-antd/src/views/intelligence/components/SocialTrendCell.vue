<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Tooltip } from 'ant-design-vue';

import { socialTrends } from '../keyword-social-trends';

const props = defineProps<{ keyword: Keyword; source: string }>();
const summary = computed(() =>
  socialTrends.summaries.find(
    (s) =>
      s.keywordId === props.keyword.id &&
      s.term === props.keyword.term &&
      s.market === props.keyword.market &&
      s.source === props.source,
  ),
);
const periods = computed(() =>
  summary.value?.periods?.length
    ? summary.value.periods
    : ['本周', '本月', '近3个月', '近6个月'].map((label) => ({
        key: label,
        label,
        count: null,
        change: null,
        matchedCount: 0,
        reason: summary.value?.attemptMessage || '尚未采集此来源',
        start: '',
        end: '',
        baselineAt: '',
      })),
);
</script>
<template>
  <div class="social-trend-cell">
    <Tooltip
      :title="
        summary
          ? `${summary.attemptMessage || ''}；${summary.coverage || ''}；${summary.collectedAt ? `截至${summary.collectedAt}，未提供有效发布时间${summary.undatedCount}条` : '尚无成功采集'}。条数为采集样本；百分比为共同样本累计播放增长，不是平台搜索量或前期环比。`
          : socialTrends.error || '使用趋势采集按钮选择来源并提交'
      "
    >
      <span class="hci-subtle">{{
        summary?.attemptMessage
          ? summary.collectedAt
            ? '更新未完成，保留已采集值'
            : '未完成采集'
          : summary
            ? '内容样本 / 播放增长'
            : socialTrends.error
              ? '读取失败，可刷新'
              : '等待采集'
      }}</span>
    </Tooltip>
    <Tooltip
      v-for="p in periods"
      :key="p.key"
      :title="`${p.start ? `${p.start} 至 ${p.end}（北京时间）` : ''}；${p.reason}；可比${p.matchedCount}条${p.baselineAt ? `，起点快照${p.baselineAt}` : ''}${'collectedAt' in p ? `；更新于${p.collectedAt}` : ''}${'stale' in p && p.stale ? '；本次尚未更新，保留上次结果' : ''}`"
    >
      <p
        :class="
          ('stale' in p && p.stale) || p.change === null
            ? 'hci-subtle'
            : p.change >= 0
              ? 'hci-positive'
              : 'hci-negative'
        "
      >
        {{ p.label }}：{{ p.count === null ? '—（待采集）' : `${p.count}条`
        }}<template v-if="p.count !== null">
          {{
            'stale' in p && p.stale
              ? '（上次）'
              : p.change === null
                ? '（待积累）'
                : `(${p.change > 0 ? '+' : ''}${p.change}%)`
          }}
        </template>
      </p>
    </Tooltip>
    <span v-if="summary?.collectedAt" class="hci-subtle">
      截至
      {{
        new Date(summary.collectedAt).toLocaleDateString('zh-CN', {
          timeZone: 'Asia/Shanghai',
        })
      }}
    </span>
  </div>
</template>
<style scoped>
.social-trend-cell {
  font-variant-numeric: tabular-nums;
}

.social-trend-cell p {
  margin: 2px 0;
  white-space: nowrap;
}
</style>

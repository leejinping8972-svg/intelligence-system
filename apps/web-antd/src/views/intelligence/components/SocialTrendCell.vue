<script setup lang="ts">
import type { Keyword } from '../data';
import type { SocialPeriod } from '../keyword-social-trends';

import { computed } from 'vue';

import { Tooltip } from 'ant-design-vue';

import { socialTrends } from '../keyword-social-trends';
import { formatSocialPeriod, socialPeriodTitle } from '../social-trend-format';

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
const periods = computed<SocialPeriod[]>(() =>
  summary.value?.periods?.length
    ? summary.value.periods.map((p) =>
        summary.value?.comparisonVersion === 2
          ? p
          : {
              ...p,
              change: null,
              state: 'legacy',
              reason: '旧版播放结果，需重新回查历史内容',
            },
      )
    : ['本周', '本月', '近3个月', '近6个月'].map((label) => ({
        key: label,
        label,
        count: null,
        change: null,
        reason: summary.value?.attemptMessage || '尚未采集此来源',
        start: '',
        end: '',
      })),
);
</script>
<template>
  <div class="social-trend-cell">
    <Tooltip
      :title="
        summary
          ? `${summary.attemptMessage || ''}；${summary.coverage || ''}；${summary.collectedAt ? `截至${summary.collectedAt}，未提供有效发布时间${summary.undatedCount}条` : '尚无成功采集'}。按发布时间回查两期内容样本，以日均发布量计算环比；不把累计播放量当历史热度或平台搜索量。`
          : socialTrends.error || '使用趋势采集按钮选择来源并提交'
      "
    >
      <span class="hci-subtle">{{
        summary?.attemptMessage
          ? summary.collectedAt
            ? '更新未完成，保留已采集值'
            : '未完成采集'
          : summary
            ? summary.comparisonVersion === 2
              ? '内容样本 / 发布量环比'
              : '旧版数据，需回查'
            : socialTrends.error
              ? '读取失败，可刷新'
              : '等待采集'
      }}</span>
    </Tooltip>
    <Tooltip v-for="p in periods" :key="p.key" :title="socialPeriodTitle(p)">
      <p
        :class="
          p.stale || p.change === null
            ? 'hci-subtle'
            : p.change >= 0
              ? 'hci-positive'
              : 'hci-negative'
        "
      >
        {{ formatSocialPeriod(p) }}
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

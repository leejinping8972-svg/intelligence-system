<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Popover } from 'ant-design-vue';

import { keywordMetrics } from '../core-list-metrics';
import EvidenceMetric from './EvidenceMetric.vue';

const props = defineProps<{
  keyword: Keyword;
  kind: 'relatedRising' | 'relatedTop';
  translate?: (text: string) => string;
}>();
const title = computed(() =>
  props.kind === 'relatedTop' ? '热门相关查询' : '上升相关查询',
);
const queries = computed(
  () =>
    (props.kind === 'relatedTop'
      ? props.keyword.trendRelatedTop
      : props.keyword.trendRelatedRising) || [],
);
const translated = (text: string) => queries.value.find((item) => item.query === text)?.queryZh || props.translate?.(text) || text;
const metric = computed(() => {
  const found = keywordMetrics(props.keyword, 30).find(
    (item) => item.key === props.kind,
  );
  if (!found) throw new Error(`缺少相关查询指标：${props.kind}`);
  return found;
});
</script>
<template>
  <Popover
    v-if="queries.length"
    trigger="click"
    placement="bottomLeft"
    :title="`${title} · 已获取 ${queries.length} 个词`"
  >
    <template #content>
      <div class="related-query-content">
        <p class="hci-subtle">
          {{ keyword.trendInsightsPeriod || '来源相关查询窗口' }} ·
          {{
            kind === 'relatedTop'
              ? '0–100 相对热度'
              : '增长比例；飙升表示来源标记'
          }}
        </p>
        <ol
          class="related-query-list"
          tabindex="0"
          :aria-label="`${title}完整已获取词表`"
        >
          <li v-for="(item, index) in queries" :key="index">
            <span><strong>{{ translated(item.query) }}</strong><small v-if="translated(item.query) !== item.query">{{
                item.query
              }}</small></span>
            <b>{{ item.breakout ? '飙升' : item.formattedValue }}</b>
          </li>
        </ol>
        <p class="hci-subtle">
          显示本次来源返回的全部
          {{ queries.length }} 个词，不代表所有搜索词或实际搜索次数。
        </p>
      </div>
    </template>
    <button
      type="button"
      class="related-query-trigger"
      :aria-label="`${title}，查看全部 ${queries.length} 个词`"
    >
      <span class="related-query-preview">
        <span
          v-for="(item, index) in queries.slice(0, 1)"
          :key="index"
          class="related-query-preview-item"
        >
          {{ translated(item.query)
          }}<small v-if="translated(item.query) !== item.query">{{
            item.query
          }}</small>
        </span>
      </span>
      <small>已获取 {{ queries.length }} 个词 · 查看全部</small>
    </button>
  </Popover>
  <EvidenceMetric v-else :metric="metric" />
</template>
<style scoped>
.related-query-trigger {
  width: 100%;
  padding: 3px 0;
  color: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.related-query-trigger:focus-visible {
  outline: 2px solid var(--ant-color-primary, #1677ff);
  outline-offset: 2px;
}

.related-query-trigger small {
  display: block;
  margin-top: 4px;
  color: var(--ant-color-primary, #1677ff);
}

.related-query-preview {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.related-query-content {
  width: min(520px, calc(100vw - 56px));
}

.related-query-content p {
  margin: 8px 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.related-query-list {
  max-height: min(420px, 55vh);
  padding: 0 8px 0 28px;
  margin: 12px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.related-query-list li {
  padding: 7px 0;
  border-bottom: 1px solid var(--ant-color-border-secondary, #eee);
}

.related-query-list li span {
  display: inline-block;
  width: calc(100% - 88px);
  vertical-align: top;
  overflow-wrap: anywhere;
}

.related-query-list li strong {
  display: block;
  font-weight: 600;
}

.related-query-list li small {
  display: block;
  margin-top: 1px;
  color: var(--hci-muted, #667085);
}

.related-query-list li b {
  display: inline-block;
  width: 80px;
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.related-query-preview-item {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-query-preview-item + .related-query-preview-item {
  margin-top: 2px;
}

.related-query-preview-item small {
  display: block;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--hci-muted, #667085);
  white-space: nowrap;
}
</style>

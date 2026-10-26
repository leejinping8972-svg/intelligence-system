<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Popover } from 'ant-design-vue';

import { keywordMetrics } from '../core-list-metrics';
import EvidenceMetric from './EvidenceMetric.vue';

const props = defineProps<{ keyword: Keyword; kind: 'relatedRising' | 'relatedTop' }>();
const title = computed(() => props.kind === 'relatedTop' ? '热门相关查询' : '上升相关查询');
const queries = computed(() => (props.kind === 'relatedTop' ? props.keyword.trendRelatedTop : props.keyword.trendRelatedRising) || []);
const preview = computed(() => queries.value.map((item) => `${item.query} (${item.formattedValue})`).join('；'));
const metric = computed(() => keywordMetrics(props.keyword, 30).find((item) => item.key === props.kind)!);
</script>
<template>
  <Popover v-if="queries.length" trigger="click" placement="bottomLeft" :title="`${title} · 已获取 ${queries.length} 个词`">
    <template #content>
      <div class="related-query-content">
        <p class="hci-subtle">{{ keyword.trendInsightsPeriod || '来源相关查询窗口' }} · {{ kind === 'relatedTop' ? '0–100 相对热度' : '增长比例；飙升表示来源标记' }}</p>
        <ol class="related-query-list" tabindex="0" :aria-label="`${title}完整已获取词表`">
          <li v-for="(item, index) in queries" :key="index"><span>{{ item.query }}</span><b>{{ item.breakout ? '飙升' : item.formattedValue }}</b></li>
        </ol>
        <p class="hci-subtle">显示本次来源返回的全部 {{ queries.length }} 个词，不代表所有搜索词或实际搜索次数。</p>
      </div>
    </template>
    <button type="button" class="related-query-trigger" :aria-label="`${title}，查看全部 ${queries.length} 个词`">
      <span class="related-query-preview">{{ preview }}</span>
      <small>已获取 {{ queries.length }} 个词 · 点击查看全部</small>
    </button>
  </Popover>
  <EvidenceMetric v-else :metric="metric" />
</template>
<style scoped>
.related-query-trigger { width: 100%; padding: 3px 0; text-align: left; background: transparent; border: 0; color: inherit; cursor: pointer; overflow-wrap: anywhere; }
.related-query-trigger:focus-visible { outline: 2px solid var(--ant-color-primary, #1677ff); outline-offset: 2px; }
.related-query-trigger small { display: block; margin-top: 4px; color: var(--ant-color-primary, #1677ff); }
.related-query-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.related-query-content { width: min(520px, calc(100vw - 56px)); }
.related-query-content p { margin: 8px 0; font-size: 12px; overflow-wrap: anywhere; }
.related-query-list { max-height: min(420px, 55vh); padding: 0 8px 0 28px; margin: 12px 0; overflow-y: auto; overscroll-behavior: contain; }
.related-query-list li { padding: 7px 0; border-bottom: 1px solid var(--ant-color-border-secondary, #eee); }
.related-query-list li span { display: inline-block; width: calc(100% - 88px); vertical-align: top; overflow-wrap: anywhere; }
.related-query-list li b { display: inline-block; width: 80px; margin-left: 8px; text-align: right; font-variant-numeric: tabular-nums; }
</style>

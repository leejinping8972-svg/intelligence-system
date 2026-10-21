<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Alert, Empty, Progress, Tag } from 'ant-design-vue';

const props = defineProps<{ keyword: Keyword }>();
const regions = computed(() => (props.keyword.trendRegions || []).slice(0, 10));
const top = computed(() => (props.keyword.trendRelatedTop || []).slice(0, 10));
const rising = computed(() =>
  (props.keyword.trendRelatedRising || []).slice(0, 10),
);
const hasInsights = computed(
  () =>
    regions.value.length > 0 || top.value.length > 0 || rising.value.length > 0,
);
const periodLabel = computed(() => {
  const value = props.keyword.trendInsightsPeriod || props.keyword.trendPeriod;
  if (!value || value === 'today 12-m') return '过去一年';
  if (value === 'today 3-m') return '过去3个月';
  const [start, end] = value.split(' ');
  return start && end ? `${start} 至 ${end}` : value;
});
</script>

<template>
  <div class="google-trend-insights">
    <Alert
      v-if="keyword.trendInsightsMessage"
      :type="keyword.trendInsightsStatus === 'failed' ? 'warning' : 'info'"
      show-icon
      :message="keyword.trendInsightsMessage"
    />
    <Empty
      v-if="!hasInsights"
      image="simple"
      description="这条历史趋势尚无区域热度和相关查询；重新采集一年趋势后可补充"
    />
    <template v-else>
      <section class="trend-insight-section">
        <div class="trend-insight-heading">
          <div>
            <h3>按区域显示的搜索热度</h3>
            <p>同一关键词在当前市场内的相对热度，100 为热度最高地区。</p>
          </div>
          <Tag>{{ keyword.market }} · {{ periodLabel }}</Tag>
        </div>
        <div v-if="regions.length" class="region-ranking">
          <div
            v-for="(region, index) in regions"
            :key="region.code"
            class="region-row"
          >
            <span class="region-rank">{{ index + 1 }}</span>
            <span class="region-name">{{ region.name }}</span>
            <Progress
              :percent="region.value"
              :show-info="false"
              size="small"
              class="region-progress"
            />
            <b>{{ region.formattedValue || region.value }}</b>
          </div>
        </div>
        <Empty
          v-else
          image="simple"
          description="Google 本次未返回可用地区数据"
        />
      </section>

      <section class="trend-insight-section">
        <div class="trend-insight-heading">
          <div>
            <h3>相关查询</h3>
            <p>搜索该关键词的用户还搜索了这些内容。</p>
          </div>
          <Tag>{{ keyword.market }} · {{ periodLabel }}</Tag>
        </div>
        <div class="related-grid">
          <div class="related-panel">
            <h4>热门查询</h4>
            <div v-if="top.length" class="related-list">
              <div
                v-for="(item, index) in top"
                :key="item.query"
                class="related-row"
              >
                <span>{{ index + 1 }}</span><b>{{ item.query }}</b><span>{{ item.formattedValue }}</span>
              </div>
            </div>
            <Empty v-else image="simple" description="暂无热门查询" />
          </div>
          <div class="related-panel">
            <h4>热度上升的查询</h4>
            <div v-if="rising.length" class="related-list">
              <div
                v-for="(item, index) in rising"
                :key="item.query"
                class="related-row"
              >
                <span>{{ index + 1 }}</span><b>{{ item.query }}</b><Tag :color="item.breakout ? 'red' : 'blue'">
                  {{ item.formattedValue }}
                </Tag>
              </div>
            </div>
            <Empty v-else image="simple" description="暂无上升查询" />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.google-trend-insights {
  display: grid;
  gap: 16px;
}

.trend-insight-section,
.related-panel {
  background: var(--ant-color-bg-container, #fff);
  border: 1px solid var(--ant-color-border-secondary, #e6ebee);
  border-radius: 10px;
}

.trend-insight-section {
  padding: 20px;
}

.trend-insight-heading {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.trend-insight-heading h3,
.related-panel h4 {
  margin: 0;
}

.trend-insight-heading p {
  margin: 4px 0 0;
  color: var(--ant-color-text-secondary, #66737d);
}

.region-ranking,
.related-list {
  display: grid;
}

.region-row {
  display: grid;
  grid-template-columns: 28px minmax(120px, 1fr) minmax(120px, 2fr) 44px;
  gap: 12px;
  align-items: center;
  min-height: 40px;
  border-top: 1px solid var(--ant-color-border-secondary, #eef1f3);
}

.region-rank,
.related-row > span:first-child {
  color: var(--ant-color-text-tertiary, #87939c);
}

.region-progress {
  margin: 0;
}

.related-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.related-panel {
  padding: 16px;
}

.related-panel h4 {
  margin-bottom: 10px;
}

.related-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  border-top: 1px solid var(--ant-color-border-secondary, #eef1f3);
}

.related-row b {
  font-weight: 500;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .trend-insight-section {
    padding: 16px;
  }

  .related-grid {
    grid-template-columns: 1fr;
  }

  .region-row {
    grid-template-columns: 24px minmax(90px, 1fr) minmax(80px, 1fr) 38px;
    gap: 8px;
  }
}
</style>

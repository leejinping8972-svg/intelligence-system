<script setup lang="ts">
import type { KeywordAssessment } from '../keyword-scoring';

import { computed } from 'vue';

import { Popover } from 'ant-design-vue';

const props = defineProps<{ assessment: KeywordAssessment }>();
const scoreText = computed(() =>
  props.assessment.score === null
    ? '待评级'
    : `${props.assessment.score} / 100`,
);
const weightedScore = computed(() => {
  const { coverage, dimensions } = props.assessment;
  return coverage > 0
    ? Math.round(
        dimensions.reduce(
          (sum, dimension) =>
            sum + (dimension.score ?? 0) * dimension.coveredWeight,
          0,
        ) / coverage,
      )
    : null;
});
const limited = computed(
  () =>
    props.assessment.score !== null &&
    weightedScore.value !== null &&
    props.assessment.score < weightedScore.value,
);
const checks = computed(
  () => new Map(props.assessment.checks?.map((check) => [check.key, check])),
);
const statusLabels = {
  available: '已覆盖',
  failed: '采集失败',
  mismatch: '证据不匹配',
  missing: '待补证据',
  pending: '待采集',
  stale: '证据已过期',
  unavailable: '来源未收录或无有效数据',
};
</script>

<template>
  <Popover
    :trigger="['hover', 'focus']"
    placement="bottomLeft"
    :title="`评分依据 · ${scoreText}`"
  >
    <template #content>
      <section
        class="keyword-score-evidence"
        tabindex="0"
        aria-label="关键词评分依据"
      >
        <p v-if="assessment.decision" class="score-decision">
          <strong>{{ assessment.decision.label }}</strong>
          <span>{{ assessment.decision.reason }}</span>
        </p>
        <p v-else>{{ assessment.recommendation }}</p>
        <p class="score-note">
          输入覆盖 {{ assessment.coverage }}%。已覆盖项按权重归一化，缺失项不按
          0 分处理。
        </p>
        <p v-if="limited" class="score-limit">
          已覆盖项加权 {{ weightedScore }} 分，应用评分上限后为
          {{ assessment.score }} 分。用途、查询意图及缺项依据见下方。
        </p>
        <dl class="score-dimensions">
          <div v-for="dimension in assessment.dimensions" :key="dimension.key">
            <dt>
              <strong>{{ dimension.label }}</strong>
              <span>权重 {{ dimension.weight }}%</span>
              <b>{{
                dimension.score === null
                  ? '未参与评分'
                  : `${dimension.score} / 100`
              }}</b>
            </dt>
            <dd>
              <p>{{ dimension.evidence }}</p>
              <p v-if="dimension.score === null" class="score-note">
                {{
                  statusLabels[checks.get(dimension.key)?.status || 'missing']
                }}
                <template v-if="checks.get(dimension.key)?.message">
                  · {{ checks.get(dimension.key)?.message }}
                </template>
              </p>
            </dd>
          </div>
        </dl>
        <p class="score-note">评分用于研究排序，不代表备货建议。</p>
      </section>
    </template>
    <slot>
      <button
        type="button"
        class="keyword-score-trigger"
        :aria-label="`${scoreText}，查看评分依据`"
      >
        {{ scoreText }}
      </button>
    </slot>
  </Popover>
</template>

<style scoped>
.keyword-score-trigger {
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: help;
  background: transparent;
  border: 0;
  text-decoration: underline dotted;
  text-underline-offset: 4px;
}

.keyword-score-trigger:focus-visible {
  outline: 2px solid #1677ff;
  outline-offset: 4px;
}

.keyword-score-evidence {
  width: min(480px, calc(100vw - 56px));
  max-height: min(480px, calc(50vh - 80px));
  overflow: auto;
  overscroll-behavior: contain;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.keyword-score-evidence p {
  margin: 0 0 8px;
}

.score-decision strong {
  display: block;
  margin-bottom: 3px;
  font-size: 13px;
}

.score-note {
  color: #687385;
}

.score-limit {
  padding: 8px 10px;
  background: rgb(250 173 20 / 10%);
  border-radius: 6px;
}

.score-dimensions {
  margin: 12px 0;
}

.score-dimensions > div {
  padding: 9px 0;
  border-top: 1px solid rgb(128 128 128 / 18%);
}

.score-dimensions dt {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  margin-bottom: 4px;
}

.score-dimensions dt > span {
  color: #687385;
}

.score-dimensions dt > b {
  margin-left: auto;
}

.score-dimensions dd {
  margin: 0;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Modal, Tag } from 'ant-design-vue';
import type { Product } from '../data';
import ProductHistory from './ProductHistory.vue';
import DiscoveryTag from './DiscoveryTag.vue';
import ProductCompletionDialog from './ProductCompletionDialog.vue';
import {
  PRODUCT_DECISION_RULES,
  PRODUCT_DECISION_VERSION,
  productDecisions,
} from '../product-decisions';
const props = defineProps<{ product: Product; details?: boolean }>();
const open = ref(false);
const decisions = computed(() => productDecisions(props.product));
const visibleDecisions = computed(() => decisions.value.filter((item) => item.key !== 'new_product'));
const safeLink = (value?: string) => {
  try {
    const u = new URL(value || '');
    return ['https:', 'http:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
};
</script>
<template>
  <DiscoveryTag :item="product" kind="product" :details="details" />
  <div class="decision-tags" :aria-label="`${product.title}的决策标签`">
    <button
      v-for="item in visibleDecisions"
      :key="`${item.key}:${item.source}:${item.label}`"
      class="decision-tag"
      type="button"
      @click="open = true"
      :aria-label="`${item.label}，查看判断依据`"
    >
      <Tag :color="item.color">{{ item.label }}</Tag>
    </button>
  </div>
  <div v-if="details" class="decision-evidence">
    <p class="hci-subtle">{{ PRODUCT_DECISION_RULES }}</p>
    <article
      v-for="item in decisions"
      :key="`${item.key}:${item.source}:${item.label}`"
    >
      <b>{{ item.label }}</b>
      <p>{{ item.reason }}</p>
      <small
        >来源：{{ item.source }} · 数据采集日期：{{
          item.date.slice(0, 10)
        }}</small
      >
      <a
        v-if="safeLink(item.evidenceUrl)"
        :href="safeLink(item.evidenceUrl)"
        target="_blank"
        rel="noreferrer"
        >查看来源 ↗</a
      >
    </article>
  </div>
  <ProductHistory v-if="details" :product="product" />
  <Modal
    v-if="open"
    v-model:open="open"
    :title="`${product.title} · 决策依据`"
    :footer="null"
    :width="720"
  >
    <p class="hci-subtle">
      规则版本：{{
        PRODUCT_DECISION_VERSION
      }}。以下为系统按来源指标计算的标签，不代表平台推荐或未来销量预测。
    </p>
    <div class="decision-evidence">
      <article
        v-for="item in decisions"
        :key="`${item.key}:${item.source}:${item.label}`"
      >
        <Tag :color="item.color">{{ item.label }}</Tag>
        <p>{{ item.reason }}</p>
        <small
          >来源：{{ item.source }} · 数据采集日期：{{
            item.date.slice(0, 10)
          }}</small
        >
        <a
          v-if="safeLink(item.evidenceUrl)"
          :href="safeLink(item.evidenceUrl)"
          target="_blank"
          rel="noreferrer"
          >查看来源 ↗</a
        >
      </article>
    </div>
    <p class="hci-subtle" style="margin-top: 16px">
      {{ PRODUCT_DECISION_RULES }}
    </p>
    <ProductHistory :product="product" />
    <ProductCompletionDialog :product-ids="[product.id]" compact />
    <Button style="margin-top: 16px" @click="open = false">关闭</Button>
  </Modal>
</template>
<style scoped>
.decision-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}
.decision-tag {
  min-height: 28px;
  cursor: pointer;
  border-radius: 4px;
}
.decision-tag:focus-visible {
  outline: 2px solid #3b5bff;
  outline-offset: 2px;
}
.decision-tag :deep(.ant-tag) {
  margin: 0;
  white-space: nowrap;
}
.decision-evidence article {
  padding: 14px 0;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.decision-evidence p {
  margin: 8px 0;
  line-height: 1.7;
}
.decision-evidence small {
  display: block;
  color: #687385;
}
.decision-evidence a {
  display: inline-block;
  margin-top: 8px;
  color: #3b5bff;
}
</style>

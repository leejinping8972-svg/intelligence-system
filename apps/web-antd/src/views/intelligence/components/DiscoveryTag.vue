<script setup lang="ts">
import type { Ad, Product } from '../data';

import { computed } from 'vue';

import { Tag, Tooltip } from 'ant-design-vue';

import { discoveryDecision } from '../discovery';

const props = defineProps<{
  item: Ad | Product;
  kind: 'ad' | 'product';
  details?: boolean;
}>();
const decision = computed(() => discoveryDecision(props.item, props.kind));
</script>
<template>
  <div class="discovery-tags">
    <Tooltip :title="decision.reason">
      <Tag
        :color="
          decision.isNew === null
            ? 'orange'
            : decision.isNew
              ? 'purple'
              : 'default'
        "
      >
        {{ decision.label }}
      </Tag>
    </Tooltip>
    <Tooltip
      v-if="decision.recentDiscovery"
      title="系统在7天内首次发现，不代表刚上市或刚投放"
    >
      <Tag color="blue">近期新发现</Tag>
    </Tooltip>
  </div>
  <div v-if="details" class="discovery-detail">
    <p>{{ decision.reason }}</p>
    <p>
      首次发现：{{ item.discovery?.firstSeenAt || item.firstSeenAt || '未知' }}
    </p>
    <p>最近发现：{{ item.discovery?.lastSeenAt || '未知' }}</p>
  </div>
</template>
<style scoped>
.discovery-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0;
}

.discovery-tags :deep(.ant-tag) {
  margin: 0;
}

.discovery-detail {
  line-height: 1.7;
  color: #687385;
  overflow-wrap: anywhere;
}
</style>

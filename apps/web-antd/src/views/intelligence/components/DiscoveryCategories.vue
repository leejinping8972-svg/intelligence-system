<script setup lang="ts">
import { reactive } from 'vue';
import { Alert, Button, Input, Select } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import type { DiscoveryCategory } from '../discovery-monitors';
const props = defineProps<{
  channels: string[];
  sourceMarkets: Record<string, string>;
  market: string;
}>();
const selected = defineModel<Record<string, DiscoveryCategory[]>>({
  default: () => ({}),
});
const queries = reactive<Record<string, string>>({});
const options = reactive<Record<string, DiscoveryCategory[]>>({});
const loading = reactive<Record<string, boolean>>({});
const errors = reactive<Record<string, string>>({});
const requests = new Map<string, string>();
const labels: Record<string, string> = {
  amazon: 'Amazon',
  tiktok: 'TikTok Shop',
  shopee: 'Shopee',
  temu: 'Temu',
};
const key = (channel: string) =>
  `${channel}:${props.sourceMarkets[channel] || props.market}`;
async function load(channel: string) {
  const site = props.sourceMarkets[channel] || props.market;
  const scope = key(channel);
  const query =
    queries[scope] ||
    {
      amazon: 'Supplements',
      tiktok: 'Dietary Supplements',
      shopee: 'Food Supplement',
      temu: 'Dietary Supplements',
    }[channel as 'amazon'] ||
    'Supplements';
  const signature = `${scope}:${query}`;
  if (!requests.has(signature)) requests.set(signature, crypto.randomUUID());
  loading[scope] = true;
  errors[scope] = '';
  try {
    const result = await cloudRequest<{
      categories: DiscoveryCategory[];
      message?: string;
    }>('server_product_resource_categories', {
      routeId: `${channel}-sorftime`,
      market: site,
      query,
      requestId: requests.get(signature),
    });
    options[scope] = result.categories;
    if (!result.categories.length)
      errors[scope] = result.message || '来源未返回此类目，请调整类目名称';
  } catch (error) {
    errors[scope] = error instanceof Error ? error.message : '类目读取失败';
  } finally {
    loading[scope] = false;
  }
}
function choose(channel: string, ids: string[]) {
  const available = [
    ...(options[key(channel)] || []),
    ...(selected.value[channel] || []),
  ];
  selected.value = {
    ...selected.value,
    [channel]: ids
      .map((id) => available.find((c) => c.id === id)!)
      .filter(Boolean),
  };
}
</script>
<template>
  <div v-for="channel in channels" :key="key(channel)" class="category-source">
    <label :for="`source-category-${channel}`"
      >{{ labels[channel] || channel }} 来源类目</label
    >
    <div class="hci-toolbar">
      <Input
        v-model:value="queries[key(channel)]"
        placeholder="默认查找保健品；可输入英文类目名称"
        :aria-label="`${labels[channel]}类目名称`"
      />
      <Button :loading="loading[key(channel)]" @click="load(channel)"
        >获取Sorftime类目</Button
      >
    </div>
    <Select
      :id="`source-category-${channel}`"
      mode="multiple"
      :value="
        (selected[channel] || [])
          .filter((c) => c.market === (sourceMarkets[channel] || market))
          .map((c) => c.id)
      "
      :aria-label="`${labels[channel]}真实类目`"
      style="width: 100%"
      placeholder="未选时自动查询保健品类目"
      :options="[
        ...new Map(
          [
            ...(options[key(channel)] || []),
            ...(selected[channel] || []).filter(
              (c) => c.market === (sourceMarkets[channel] || market),
            ),
          ].map((c) => [c.id, { value: c.id, label: `${c.name} · ${c.id}` }]),
        ).values(),
      ]"
      @change="choose(channel, $event as string[])"
    />
    <Alert
      v-if="errors[key(channel)]"
      type="warning"
      :message="errors[key(channel)]"
      show-icon
    />
  </div>
  <p class="hci-subtle">
    类目来自所选平台和国家；点击获取会产生一次来源查询，实际费用以Sorftime为准。
  </p>
</template>
<style scoped>
.category-source {
  margin-bottom: 16px;
}
.category-source label {
  display: block;
  margin-bottom: 8px;
}
</style>

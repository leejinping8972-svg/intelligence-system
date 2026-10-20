<script setup lang="ts">
import type { MarketFilter } from '../data';

import { useRoute, useRouter } from 'vue-router';

import { Select } from 'ant-design-vue';

import { marketOptions, state } from '../data';
import { marketQuery } from '../market-navigation';

const route = useRoute();
const router = useRouter();
let changeId = 0;

async function change(value: unknown) {
  const id = ++changeId;
  const option = marketOptions.find((item) => item.value === value);
  if (!option || state.market === option.value) return;
  const query = marketQuery(route.path, route.query);
  // Remove old deep-link constraints before applying the new market, so route
  // watchers cannot restore the previous market from an old site/keyword ID.
  if (Object.keys(query).length !== Object.keys(route.query).length) {
    const failure = await router.replace({ query, hash: route.hash });
    if (failure || id !== changeId) return;
  }
  state.market = option.value as MarketFilter;
}
</script>

<template>
  <div class="hci-market-picker">
    <span>浏览市场</span>
    <Select
      :value="state.market"
      :options="marketOptions"
      aria-label="切换浏览市场"
      style="width: 165px"
      @change="change"
    />
  </div>
</template>

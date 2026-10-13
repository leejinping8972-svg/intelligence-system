<script setup lang="ts">
import { Select } from 'ant-design-vue';
import { state, marketName, marketOptions, storageError } from '../data';
defineProps<{ title: string; description: string }>();
</script>
<template>
  <div class="hci-page-head">
    <div>
      <div class="hci-eyebrow">
        {{ state.branding.businessName }} <span>/</span>
        {{ marketName(state.market) }}
      </div>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div class="hci-head-actions">
      <div class="hci-market-picker">
        <span>国家市场</span
        ><Select
          v-model:value="state.market"
          :options="marketOptions"
          aria-label="国家市场"
          style="width: 145px"
        />
      </div>
      <slot />
    </div>
  </div>
  <div v-if="storageError.value" class="hci-demo-note">
    {{ storageError.value }}
  </div>
</template>

<script setup lang="ts">
import type { ResearchSocialTrends } from '../keyword-research';

import { computed, watch } from 'vue';

import { Checkbox, Form, InputNumber } from 'ant-design-vue';

import { session } from '../session';
const model = defineModel<ResearchSocialTrends>({ required: true });
const admin = computed(() => session.user?.role === 'admin');
watch(admin, value => { if (!value) model.value.sources = []; }, { immediate: true });
</script>
<template>
  <Form.Item label="趋势来源">
    <Checkbox :checked="true" disabled>Google Trends</Checkbox>
    <Checkbox.Group
      v-model:value="model.sources"
      :disabled="!admin"
      :options="[
        { label: 'TK', value: 'tiktok' },
        { label: 'INS', value: 'instagram' },
        { label: 'FB', value: 'facebook' },
      ]"
    />
  </Form.Item>
  <template v-if="model.sources.length">
    <div class="hci-form-grid">

      <Form.Item label="每词每来源最多页数（INS最多11页）">
        <InputNumber v-model:value="model.maxPages" :min="1" :max="100" :precision="0" />
      </Form.Item>
    </div>
    <Form.Item>
      <Checkbox v-model:checked="model.budgetAcknowledged">确认使用已配置的 ScrapeCreators 额度</Checkbox>
    </Form.Item>
  </template>
</template>

<script setup lang="ts">
import { BasicLayout } from '@vben/layouts';
import { updatePreferences } from '@vben/preferences';
import { watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { Tag } from 'ant-design-vue';
import { state } from '#/views/intelligence/data';

const router = useRouter();

watchEffect(() => {
  updatePreferences({
    app: { name: state.branding.appName },
    logo: { source: state.branding.logo },
  });
});
</script>
<template>
  <BasicLayout
    :avatar="state.branding.logo"
    :logo-src="state.branding.logo"
    :logo-text="state.branding.appName"
    :text="state.branding.workspaceName"
  >
    <template #user-dropdown>
      <div class="hci-header-controls">
        <Tag color="gold">{{ state.branding.environmentLabel }}</Tag>
        <button
          class="hci-workspace-button"
          type="button"
          @click="router.push('/settings')"
        >
          {{ state.branding.workspaceName }}
        </button>
      </div>
    </template>
  </BasicLayout>
</template>

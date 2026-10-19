<script setup lang="ts">
import { watch, watchEffect } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { useRouter } from 'vue-router';

import { BasicLayout } from '@vben/layouts';
import { updatePreferences } from '@vben/preferences';

import { Tag } from 'ant-design-vue';

import { state } from '#/views/intelligence/data';
import { logout, serverMode, session } from '#/views/intelligence/session';

const router = useRouter();
const mobile = useMediaQuery('(max-width: 767px)');
watch(mobile, (value) => updatePreferences({ app: { isMobile: value } }), {
  immediate: true,
});

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
          @click="router.push(serverMode ? '/administration' : '/settings')"
        >
          {{
            serverMode
              ? session.user?.displayName
              : state.branding.workspaceName
          }}
        </button>
        <button
          v-if="serverMode"
          class="hci-workspace-button"
          type="button"
          @click="router.push('/administration?account=me')"
        >
          修改账号密码
        </button>
        <button
          v-if="serverMode"
          class="hci-workspace-button"
          type="button"
          @click="logout"
        >
          退出登录
        </button>
      </div>
    </template>
  </BasicLayout>
</template>

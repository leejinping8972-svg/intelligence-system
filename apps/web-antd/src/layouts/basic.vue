<script setup lang="ts">
import { watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';

import { BasicLayout } from '@vben/layouts';
import { updatePreferences } from '@vben/preferences';

import { useMediaQuery } from '@vueuse/core';
import { Button, Dropdown, Menu, Tag } from 'ant-design-vue';

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
        <a
          class="hci-platform-link"
          href="https://ai.chatviva.com/admin/"
        >
          全球电商AI经营平台
        </a>
        <Tag color="gold">{{ state.branding.environmentLabel }}</Tag>
        <button
          v-if="!mobile"
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
          v-if="serverMode && !mobile"
          class="hci-workspace-button"
          type="button"
          @click="router.push('/administration?account=me')"
        >
          修改账号密码
        </button>
        <button
          v-if="serverMode && !mobile"
          class="hci-workspace-button"
          type="button"
          @click="logout"
        >
          退出登录
        </button>
        <Dropdown v-if="serverMode && mobile" :trigger="['click']">
          <Button class="hci-mobile-account-button" size="small">账号</Button>
          <template #overlay>
            <Menu>
              <Menu.Item key="account" @click="router.push('/administration')">
                {{ session.user?.displayName || '账号与管理' }}
              </Menu.Item>
              <Menu.Item key="password" @click="router.push('/administration?account=me')">
                修改账号密码
              </Menu.Item>
              <Menu.Item key="logout" @click="logout">退出登录</Menu.Item>
            </Menu>
          </template>
        </Dropdown>
      </div>
    </template>
  </BasicLayout>
</template>

<style scoped>
.hci-platform-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: #1d4ed8;
  text-align: center;
  text-decoration: none;
  background: #f0f5ff;
  border: 1px solid #c7d7f5;
  border-radius: 6px;
}

.hci-platform-link:hover {
  background: #e0ebff;
  border-color: #93b4ed;
}

.hci-platform-link:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .hci-header-controls {
    flex-wrap: nowrap;
  }

  .hci-platform-link {
    max-width: 104px;
    min-height: 36px;
    padding: 2px 6px;
  }

  .hci-mobile-account-button {
    min-height: 36px;
  }
}
</style>

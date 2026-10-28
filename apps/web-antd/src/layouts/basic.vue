<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';

import { BasicLayout } from '@vben/layouts';
import { updatePreferences } from '@vben/preferences';

import { useMediaQuery } from '@vueuse/core';
import { Button, Dropdown, Menu, message, Tag } from 'ant-design-vue';

import { state } from '#/views/intelligence/data';
import {
  launchPlatformLink,
  PlatformLinkError,
} from '#/views/intelligence/platform-link';
import { logout, serverMode, session } from '#/views/intelligence/session';

const router = useRouter();
const platformLinkBusy = ref(false);
const platformLinkHref = computed(() => {
  if (serverMode && session.identityEnabled)
    return 'https://ai.chatviva.com/admin/?sso=1';
  if (serverMode && session.platformLinkEnabled)
    return router.resolve('/administration?platformLink=1').href;
  return 'https://ai.chatviva.com/admin/';
});
async function openPlatformLink(event: MouseEvent) {
  if (session.identityEnabled) return;
  if (!serverMode || !session.platformLinkEnabled) return;
  event.preventDefault();
  if (platformLinkBusy.value) return;
  const userId = session.user?.id;
  platformLinkBusy.value = true;
  try {
    const target = await launchPlatformLink();
    if (userId && userId === session.user?.id) location.assign(target);
  } catch (cause) {
    if (!userId || userId !== session.user?.id) return;
    if (
      cause instanceof PlatformLinkError &&
      cause.code === 'PEER_NOT_CONFIGURED'
    ) {
      await router.push('/administration?platformLink=1');
    } else {
      message.error(
        cause instanceof Error ? cause.message : '暂时无法进入 AI 平台',
      );
    }
  } finally {
    platformLinkBusy.value = false;
  }
}
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
          title="全球电商AI经营平台"
          aria-label="全球电商AI经营平台"
          :href="platformLinkHref"
          :aria-busy="platformLinkBusy"
          :aria-disabled="platformLinkBusy"
          @click="openPlatformLink"
        >
          <span class="hci-platform-link-full">全球电商AI经营平台</span>
          <span class="hci-platform-link-compact">AI 平台</span>
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

.hci-platform-link-compact {
  display: none;
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

@media (max-width: 359px) {
  .hci-platform-link-full {
    display: none;
  }

  .hci-platform-link-compact {
    display: inline;
    white-space: nowrap;
  }
}
</style>

<script setup lang="ts">
import type { PlatformLinkSettings } from '../platform-link';

import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';

import { Copy, ExternalLink, LockKeyhole, RotateCw, Unlink2 } from '@vben/icons';

import {
  Alert,
  Button,
  Form,
  Input,
  message,
  Modal,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  generatePlatformLinkKey,
  getPlatformLinkSettings,
  launchPlatformLink,
  removePlatformLinkPeer,
  revokePlatformLinkKey,
  savePlatformLinkPeer,
} from '../platform-link';
import { session } from '../session';

type Confirmation = '' | 'generate' | 'remove' | 'replace' | 'revoke';

const settings = ref<null | PlatformLinkSettings>(null);
const error = ref('');
const busy = ref(false);
const peerKey = ref('');
const revealedKey = ref('');
const confirmation = ref<Confirmation>('');
const confirmationLoading = ref(false);
let active = false;
let revision = 0;

const enabled = computed(() => Boolean(settings.value?.enabled && session.user));
const usableKey = computed(() => {
  const key = settings.value?.key;
  return Boolean(
    key &&
      !key.revoked_at &&
      (!key.expires_at || new Date(key.expires_at).getTime() > Date.now()),
  );
});
const confirmationTitle = computed(() => {
  if (confirmation.value === 'revoke') return '撤销我的选品登录 key';
  if (confirmation.value === 'remove') return '移除 AI 账号配置';
  if (confirmation.value === 'replace') return '更换 AI 账号配置';
  return usableKey.value ? '重新生成选品登录 key' : '生成选品登录 key';
});
const confirmationText = computed(() => {
  if (confirmation.value === 'revoke') {
    return '撤销后，持有原 key 的人将无法继续通过它登录当前选品账号，尚未完成的登录也会失效。';
  }
  if (confirmation.value === 'remove') {
    return '移除后，当前选品账号将停止使用已保存的 AI 登录授权。';
  }
  if (confirmation.value === 'replace') {
    return `验证通过后，将替换当前 AI 账号「${settings.value?.peer?.display_name || settings.value?.peer?.subject || ''}」的配置。`;
  }
  return `${usableKey.value ? '原 key 及尚未完成的登录会立即失效。' : ''}持有新 key 的人可以通过 AI 平台登录当前选品账号，请仅交给你授权的人。`;
});
const confirmationLabel = computed(() => {
  if (confirmation.value === 'revoke') return '确认撤销';
  if (confirmation.value === 'remove') return '确认移除';
  if (confirmation.value === 'replace') return '验证并更换';
  return '生成并授权';
});

function date(value: null | number | string | undefined) {
  if (!value) return '';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString('zh-CN');
}

function report(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : '操作未完成，请稍后重试';
}

function clear() {
  revision += 1;
  settings.value = null;
  peerKey.value = '';
  revealedKey.value = '';
  confirmation.value = '';
  error.value = '';
  busy.value = false;
  confirmationLoading.value = false;
}

async function refreshSettings(current = revision) {
  const result = await getPlatformLinkSettings();
  if (active && current === revision) settings.value = result;
}

async function load() {
  if (busy.value || !session.user || !active) return;
  const current = revision;
  busy.value = true;
  error.value = '';
  try {
    await refreshSettings(current);
  } catch (cause) {
    if (active && current === revision) report(cause);
  } finally {
    if (active && current === revision) busy.value = false;
  }
}

function activate() {
  if (active) return;
  active = true;
  void load();
}

function deactivate() {
  active = false;
  clear();
}

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
watch(
  () => session.user?.id,
  () => {
    clear();
    if (active) void load();
  },
);

function cancelConfirmation() {
  if (confirmationLoading.value) return;
  confirmation.value = '';
  peerKey.value = '';
  revealedKey.value = '';
}

async function confirm() {
  if (busy.value || !enabled.value || !confirmation.value) return;
  const action = confirmation.value;
  const input = peerKey.value.trim();
  peerKey.value = '';
  const current = revision;
  busy.value = true;
  confirmationLoading.value = true;
  error.value = '';
  try {
    if (action === 'generate') {
      const result = await generatePlatformLinkKey();
      if (active && current === revision) revealedKey.value = result.key;
    } else if (action === 'revoke') {
      await revokePlatformLinkKey();
    } else if (action === 'remove') {
      await removePlatformLinkPeer();
    } else {
      await savePlatformLinkPeer(input);
    }
    if (!active || current !== revision) return;
    confirmation.value = '';
    if (action !== 'generate') message.success('授权配置已更新');
    await refreshSettings(current);
  } catch (cause) {
    if (active && current === revision) {
      confirmation.value = '';
      report(cause);
    }
  } finally {
    if (active && current === revision) {
      busy.value = false;
      confirmationLoading.value = false;
    }
  }
}

async function savePeer() {
  if (busy.value || !enabled.value || !peerKey.value.trim()) return;
  if (settings.value?.peer) {
    confirmation.value = 'replace';
    return;
  }
  confirmation.value = 'replace';
  await confirm();
}

async function launch() {
  if (busy.value || !enabled.value || !settings.value?.peer) return;
  const current = revision;
  busy.value = true;
  error.value = '';
  try {
    const target = await launchPlatformLink();
    if (active && current === revision) location.assign(target);
  } catch (cause) {
    if (active && current === revision) report(cause);
  } finally {
    if (active && current === revision) busy.value = false;
  }
}

async function copyKey() {
  if (!revealedKey.value) return;
  const current = revision;
  try {
    await navigator.clipboard.writeText(revealedKey.value);
    if (active && current === revision && revealedKey.value) {
      message.success('key 已复制');
    }
  } catch {
    if (active && current === revision && revealedKey.value) {
      message.error('复制失败，请选中 key 后复制');
    }
  }
}
</script>

<template>
  <section id="platform-link" class="platform-link-settings" :aria-busy="busy">
    <div class="platform-link-heading">
      <h2>平台免登录授权</h2>
      <div class="platform-link-actions">
        <Tag v-if="settings && !settings.enabled">接入尚未启用</Tag>
        <Tooltip title="刷新授权状态">
          <Button
            class="platform-link-icon-button"
            aria-label="刷新授权状态"
            :loading="busy"
            @click="load()"
          >
            <template #icon><RotateCw :size="16" /></template>
          </Button>
        </Tooltip>
      </div>
    </div>
    <Alert
      v-if="error"
      type="error"
      :message="error"
      show-icon
      role="alert"
      class="platform-link-error"
    />
    <div class="platform-link-columns">
      <div class="platform-link-section">
        <h3>我的选品登录 key</h3>
        <p class="hci-subtle">对应当前账号：{{ session.user?.displayName }}</p>
        <div v-if="settings?.key" class="platform-link-key-state">
          <code>{{ settings.key.display_hint }}</code>
          <Tag :color="usableKey ? 'green' : 'default'">
            {{ usableKey ? '有效' : settings.key.revoked_at ? '已撤销' : '已过期' }}
          </Tag>
        </div>
        <p v-else class="hci-subtle">尚未生成</p>
        <p v-if="settings?.key" class="hci-subtle platform-link-date">
          生成于 {{ date(settings.key.created_at) }}
          <template v-if="settings.key.expires_at">
            · 到期时间 {{ date(settings.key.expires_at) }}
          </template>
        </p>
        <div class="platform-link-actions">
          <Button
            :disabled="!enabled || busy"
            @click="confirmation = 'generate'"
          >
            <template #icon><LockKeyhole :size="16" /></template>
            {{ usableKey ? '重新生成' : '生成 key' }}
          </Button>
          <Button
            v-if="usableKey"
            danger
            :disabled="!enabled || busy"
            @click="confirmation = 'revoke'"
          >
            <template #icon><Unlink2 :size="16" /></template>
            撤销
          </Button>
        </div>
      </div>
      <div class="platform-link-section">
        <h3>AI 账号授权</h3>
        <div v-if="settings?.peer" class="platform-link-peer" role="status">
          <strong>{{ settings.peer.display_name }}</strong>
          <span class="hci-subtle">{{ settings.peer.subject }}</span>
          <code>{{ settings.peer.display_hint }}</code>
        </div>
        <p v-else class="hci-subtle">尚未配置 AI 账号</p>
        <Form :model="{ key: peerKey }" layout="vertical" @finish="savePeer">
          <Form.Item label="AI 账号登录 key" class="platform-link-input">
            <Input.Password
              v-model:value="peerKey"
              autocomplete="off"
              :disabled="!enabled || busy"
              :maxlength="512"
              placeholder="填写 AI 账号的专用 key"
            />
          </Form.Item>
          <div class="platform-link-actions">
            <Button
              html-type="submit"
              :disabled="!enabled || busy || !peerKey.trim()"
            >
              验证并保存
            </Button>
            <Button
              v-if="settings?.peer"
              danger
              :disabled="!enabled || busy"
              @click="confirmation = 'remove'"
            >
              <template #icon><Unlink2 :size="16" /></template>
              移除配置
            </Button>
          </div>
        </Form>
        <Button
          type="primary"
          class="platform-link-launch"
          :disabled="!enabled || busy || !settings?.peer"
          @click="launch"
        >
          <template #icon><ExternalLink :size="16" /></template>
          进入 AI 经营平台
        </Button>
      </div>
    </div>
    <Modal
      :open="Boolean(confirmation || revealedKey)"
      :title="revealedKey ? '选品登录 key 已生成' : confirmationTitle"
      :footer="revealedKey ? null : undefined"
      :confirm-loading="confirmationLoading"
      :ok-text="confirmationLabel"
      :cancel-button-props="{ disabled: confirmationLoading }"
      :closable="!confirmationLoading"
      :mask-closable="false"
      :destroy-on-close="true"
      @ok="confirm"
      @cancel="cancelConfirmation"
    >
      <template v-if="revealedKey">
        <p>此 key 仅显示一次。持有它的人可登录当前选品账号，请妥善保管。</p>
        <code class="platform-link-revealed">{{ revealedKey }}</code>
        <div class="platform-link-actions">
          <Tooltip title="复制登录 key">
            <Button
              class="platform-link-icon-button"
              aria-label="复制登录 key"
              @click="copyKey"
            >
              <template #icon><Copy :size="16" /></template>
            </Button>
          </Tooltip>
          <Button type="primary" @click="revealedKey = ''">完成</Button>
        </div>
      </template>
      <p v-else class="platform-link-consent">{{ confirmationText }}</p>
    </Modal>
  </section>
</template>

<style scoped>
.platform-link-settings {
  min-width: 0;
  padding: 24px 0;
  margin-bottom: 24px;
  border-block: 1px solid var(--hci-border, #e5e7eb);
}

.platform-link-heading,
.platform-link-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.platform-link-heading {
  justify-content: space-between;
  margin-bottom: 20px;
}

.platform-link-heading h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.5;
}

.platform-link-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
}

.platform-link-section {
  min-width: 0;
}

.platform-link-section h3 {
  margin: 0 0 12px;
  font-size: 15px;
  line-height: 1.5;
}

.platform-link-key-state {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.platform-link-date {
  margin-block: 12px;
}

.platform-link-peer {
  display: grid;
  gap: 4px;
  margin-bottom: 16px;
}

.platform-link-peer > *,
.platform-link-consent,
.platform-link-key-state code,
.platform-link-date {
  overflow-wrap: anywhere;
}

.platform-link-input {
  max-width: 480px;
  margin-bottom: 12px;
}

.platform-link-launch {
  max-width: 100%;
  margin-top: 20px;
}

.platform-link-icon-button {
  display: inline-flex;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  width: 32px;
  padding: 0;
}

.platform-link-actions :deep(.ant-btn),
.platform-link-launch {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}

.platform-link-revealed {
  display: block;
  padding-block: 16px;
  margin-block: 12px;
  overflow-wrap: anywhere;
  user-select: all;
  border-block: 1px solid #e5e7eb;
}

.platform-link-error {
  margin-bottom: 20px;
}

@media (max-width: 767px) {
  .platform-link-columns {
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
  }

  .platform-link-actions :deep(.ant-btn),
  .platform-link-launch {
    min-height: 36px;
  }

  .platform-link-icon-button {
    flex-basis: 36px;
    width: 36px;
  }
}
</style>

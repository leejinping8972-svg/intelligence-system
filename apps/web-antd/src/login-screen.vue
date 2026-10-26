<script setup lang="ts">
import type { PublicBranding } from './public-branding';

import { computed, reactive, ref } from 'vue';

import { login, session, startSso } from './views/intelligence/session';

const props = defineProps<{
  branding: PublicBranding;
  enterWorkspace: () => Promise<unknown>;
  initialError?: string;
  statusError?: string;
}>();
defineEmits<{ retry: [] }>();
const heroImage = `${import.meta.env.BASE_URL}health-research.jpg`;
const busy = ref(false);
const error = ref(props.initialError || '');
const showPassword = ref(false);
const form = reactive({
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  setupCode: '',
});
const setup = computed(() => session.setupRequired);

async function submit() {
  if (busy.value || !session.checked) return;
  error.value = '';
  if (!session.user) {
    if (!form.username.trim()) error.value = '请填写账号';
    else if (!form.password) error.value = '请填写密码';
    else if (setup.value && !form.setupCode.trim())
      error.value = '请填写原研究访问码';
    else if (setup.value && !form.displayName.trim())
      error.value = '请填写姓名';
    else if (
      setup.value &&
      (form.password.length < 8 || form.password.length > 128)
    )
      error.value = '管理员密码需要8～128个字符';
    else if (setup.value && form.password !== form.confirmPassword)
      error.value = '两次输入的密码不一致';
    if (error.value) return;
  }
  busy.value = true;
  try {
    if (!session.user)
      await login(
        {
          username: form.username,
          displayName: form.displayName,
          password: form.password,
          setupCode: form.setupCode,
        },
        setup.value,
      );
    form.password = '';
    form.confirmPassword = '';
    form.setupCode = '';
    await props.enterWorkspace();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="admin-login">
    <aside class="admin-login-visual">
      <img :src="heroImage" alt="健康研究与医疗用品" />
      <div>
        <img :src="branding.logo" alt="" /><strong>{{
          branding.appName
        }}</strong>
      </div>
    </aside>
    <section class="admin-login-card">
      <h1>{{ setup ? '创建首位管理员' : '登录工作区' }}</h1>
      <p>
        {{
          setup
            ? '使用原研究访问码验证身份，设置你的管理员账号。'
            : '使用管理员或研究员账号，继续市场研究。'
        }}
      </p>
      <form class="admin-login-form" novalidate @submit.prevent="submit">
        <label v-if="setup">原研究访问码
          <input
            v-model="form.setupCode"
            type="password"
            name="setupCode"
            autocomplete="off"
            placeholder="仅用于首次创建管理员"
            required
          />
        </label>
        <label>账号
          <input
            v-model="form.username"
            name="username"
            autocomplete="username"
            placeholder="输入账号"
            maxlength="64"
            required
          />
        </label>
        <label v-if="setup">姓名
          <input
            v-model="form.displayName"
            name="displayName"
            autocomplete="name"
            placeholder="例如：系统管理员"
            maxlength="100"
            required
          />
        </label>
        <label>密码
          <input
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            name="password"
            :autocomplete="setup ? 'new-password' : 'current-password'"
            :placeholder="setup ? '8～128个字符，支持密码管理器' : '输入密码'"
            maxlength="128"
            required
          />
        </label>
        <label v-if="setup">确认密码
          <input
            v-model="form.confirmPassword"
            :type="showPassword ? 'text' : 'password'"
            name="confirmPassword"
            autocomplete="new-password"
            placeholder="再次输入密码"
            required
          />
        </label>
        <label class="admin-login-reveal"><input v-model="showPassword" type="checkbox" />显示密码</label>
        <div v-if="error || statusError" class="admin-login-error" role="alert">
          {{ error || statusError }}
        </div>
        <button
          v-if="statusError"
          type="button"
          class="admin-login-retry"
          @click="$emit('retry')"
        >
          重新连接
        </button>
        <button
          type="submit"
          class="admin-login-submit"
          :disabled="busy || !session.checked"
          :aria-busy="busy"
        >
          {{
            busy
              ? '正在进入…'
              : session.user
                ? '进入工作区'
                : setup
                  ? '创建管理员并进入'
                  : '登录'
          }}
        </button>
      </form>
      <button
        v-if="session.ssoEnabled && !setup"
        type="button"
        class="admin-login-sso"
        @click="startSso()"
      >
        使用全球电商AI经营平台登录
      </button>
      <div class="admin-login-foot">
        HTTPS 安全连接 · 登录有效期最长12小时 · 闲置30分钟自动退出
      </div>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
}
.admin-login,
.admin-login * {
  box-sizing: border-box;
  letter-spacing: 0;
}
.admin-login {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 480px);
  min-height: 100vh;
  background: #fff;
  color: #1d2939;
  font:
    13px/1.6 'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}
.admin-login-visual {
  position: relative;
  overflow: hidden;
  background: #173b70;
}
.admin-login-visual > img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.admin-login-visual::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #10264433, #102644b8);
}
.admin-login-visual > div {
  position: absolute;
  z-index: 1;
  left: 36px;
  right: 28px;
  bottom: 40px;
  display: flex;
  gap: 12px;
  align-items: center;
  color: white;
  font-size: 24px;
  overflow-wrap: anywhere;
}
.admin-login-visual > div img {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.admin-login-card {
  width: 100%;
  max-width: 440px;
  margin: auto;
  padding: 36px;
}
h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.4;
}
p {
  margin: 0 0 24px;
  color: #667085;
}
.admin-login-form > label:not(.admin-login-reveal) {
  display: grid;
  gap: 6px;
  margin-bottom: 20px;
}
input:not([type='checkbox']) {
  width: 100%;
  height: 38px;
  padding: 6px 11px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  color: #1d2939;
  font: inherit;
}
input:focus-visible,
button:focus-visible {
  outline: 2px solid #2563ff;
  outline-offset: 2px;
}
input::placeholder {
  color: #9298a3;
}
.admin-login-reveal {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: -6px 0 20px;
  color: #667085;
}
.admin-login-reveal input {
  margin: 0;
  accent-color: #2563ff;
}
button {
  font: inherit;
  cursor: pointer;
}
.admin-login-submit,
.admin-login-sso {
  width: 100%;
  min-height: 40px;
  padding: 7px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: white;
  color: #1d2939;
}
.admin-login-submit {
  border-color: #2563ff;
  background: #2563ff;
  color: white;
  font-size: 16px;
}
.admin-login-submit:disabled {
  opacity: 0.65;
  cursor: wait;
}
.admin-login-sso {
  margin-top: 12px;
}
.admin-login-error {
  margin: 0 0 16px;
  padding: 8px 12px;
  border: 1px solid #ffccc7;
  border-radius: 6px;
  background: #fff2f0;
  color: #a8071a;
  overflow-wrap: anywhere;
}
.admin-login-retry {
  margin-bottom: 12px;
  padding: 0;
  border: 0;
  background: none;
  color: #2563ff;
}
.admin-login-foot {
  margin-top: 18px;
  color: #667085;
  font-size: 12px;
}
@media (max-width: 768px) {
  .admin-login {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 180px 1fr;
  }
  .admin-login-visual {
    min-height: 180px;
  }
  .admin-login-visual > div {
    left: 20px;
    right: 20px;
    bottom: 20px;
    font-size: 18px;
  }
  .admin-login-card {
    padding: 24px;
  }
}
</style>

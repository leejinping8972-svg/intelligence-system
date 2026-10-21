<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Alert, Button, Form, Input } from 'ant-design-vue';

import { state } from './data';
import { adminRequest, refreshSession, session, startSso } from './session';

const router = useRouter();
const route = useRoute();
const heroImage=`${import.meta.env.BASE_URL}health-research.jpg`;
const busy = ref(false);
const error = ref(route.query.sso === 'failed'
  ? '单点登录未完成，请使用账号密码登录，或联系管理员检查账号绑定。'
  : '');
const form = reactive({
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  setupCode: '',
});
const setup = computed(() => session.setupRequired);
async function submit() {
  if (busy.value) return;
  error.value = '';
  if (setup.value && form.password !== form.confirmPassword) {
    error.value = '两次输入的密码不一致';
    return;
  }
  busy.value = true;
  try {
    await adminRequest(setup.value ? 'auth_setup' : 'auth_login', {
      username: form.username,
      displayName: form.displayName,
      password: form.password,
      setupCode: form.setupCode,
    });
    form.password = '';
    form.confirmPassword = '';
    form.setupCode = '';
    await refreshSession();
    await router.replace('/overview');
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
      <img
        :src="heroImage"
        alt="健康研究与医疗用品"
      />
      <div>
        <img :src="state.branding.logo" alt="" /><strong>{{
          state.branding.appName
        }}</strong>
      </div>
    </aside>
    <section class="admin-login-card">
      <div class="admin-login-brand">
        <img
          :src="state.branding.logo"
          alt="系统 Logo"
          style="
            width: 32px;
            height: 32px;
            object-fit: contain;
            vertical-align: middle;
            margin-right: 10px;
          "
        />{{ state.branding.appName }}
      </div>
      <h1>{{ setup ? '创建首位管理员' : '登录工作区' }}</h1>
      <p>
        {{
          setup
            ? '使用原研究访问码验证身份，设置你的管理员账号。'
            : '使用管理员或研究员账号，继续市场研究。'
        }}
      </p>
      <Form
        :model="form"
        layout="vertical"
        @finish="submit"
        class="admin-login-form"
      >
        <Form.Item
          v-if="setup"
          name="setupCode"
          label="原研究访问码"
          :rules="[{ required: true, message: '请填写原研究访问码' }]"
        >
          <Input.Password
            v-model:value="form.setupCode"
            autocomplete="off"
            placeholder="仅用于首次创建管理员"
          />
        </Form.Item>
        <Form.Item
          name="username"
          label="账号"
          :rules="[{ required: true, whitespace: true, message: '请填写账号' }]"
        >
          <Input
            v-model:value="form.username"
            autocomplete="username"
            placeholder="输入账号"
            :maxlength="64"
          />
        </Form.Item>
        <Form.Item
          v-if="setup"
          name="displayName"
          label="姓名"
          :rules="[{ required: true, whitespace: true, message: '请填写姓名' }]"
        >
          <Input
            v-model:value="form.displayName"
            autocomplete="name"
            :maxlength="100"
            placeholder="例如：系统管理员"
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          :rules="[
            { required: true, message: '请填写密码' },
            ...(setup
              ? [{ min: 8, max: 128, message: '管理员密码需要8～128个字符' }]
              : []),
          ]"
        >
          <Input.Password
            v-model:value="form.password"
            :autocomplete="setup ? 'new-password' : 'current-password'"
            :placeholder="setup ? '8～128个字符，支持密码管理器' : '输入密码'"
            :maxlength="128"
          />
        </Form.Item>
        <Form.Item
          v-if="setup"
          name="confirmPassword"
          label="确认密码"
          :rules="[{ required: true, message: '请再次输入密码' }]"
        >
          <Input.Password
            v-model:value="form.confirmPassword"
            autocomplete="new-password"
            placeholder="再次输入密码"
          />
        </Form.Item>
        <Alert
          v-if="error"
          :message="error"
          type="error"
          show-icon
          role="alert"
          style="margin-bottom: 16px"
        />
        <Button
          type="primary"
          html-type="submit"
          :loading="busy"
          block
          size="large"
        >
          {{ setup ? '创建管理员并进入' : '登录' }}
        </Button>
      </Form>
      <Button
        v-if="session.ssoEnabled && !setup"
        block
        size="large"
        style="margin-top: 12px"
        @click="startSso()"
      >
        使用全球电商AI经营平台登录
      </Button>
      <div class="admin-login-foot">
        HTTPS 安全连接 · 登录有效期最长12小时 · 闲置30分钟自动退出
      </div>
    </section>
  </main>
</template>
<style scoped>
.admin-login {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 480px);
  min-height: 100vh;
  background: #fff;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.admin-login-visual {
  position: relative;
  min-height: 100%;
  overflow: hidden;
  background: #173b70;
}
.admin-login-visual > img {
  width: 100%;
  height: 100%;
  position: absolute;
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
  bottom: 40px;
  color: white;
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 24px;
}
.admin-login-visual > div img {
  width: 40px;
  height: 40px;
}
.admin-login-card {
  width: 100%;
  max-width: 440px;
  margin: auto;
  padding: 36px;
}
.admin-login-brand {
  display: none;
}
h1 {
  font-size: 24px;
  margin: 0 0 8px;
  color: #1d2939;
}
p {
  font-size: 13px;
  line-height: 1.7;
  color: #667085;
  margin-bottom: 24px;
}
.admin-login-foot {
  margin-top: 18px;
  font-size: 12px;
  line-height: 1.6;
  color: #667085;
}
@media (max-width: 768px) {
  .admin-login {
    grid-template-columns: 1fr;
    grid-template-rows: 180px 1fr;
  }
  .admin-login-visual {
    min-height: 180px;
  }
  .admin-login-visual > div {
    left: 20px;
    bottom: 20px;
    font-size: 18px;
  }
  .admin-login-card {
    padding: 24px;
  }
}
</style>

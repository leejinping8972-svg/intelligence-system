<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';

import LoginScreen from '../../login-screen.vue';
import { state } from './data';

const router = useRouter();
const route = useRoute();
const initialError =
  route.query.sso === 'failed'
    ? '单点登录未完成，请使用账号密码登录，或联系管理员检查账号绑定。'
    : '';
const enterWorkspace = () => router.replace('/overview');
</script>

<template>
  <LoginScreen
    :branding="state.branding"
    :initial-error="initialError"
    :enter-workspace="enterWorkspace"
  />
</template>

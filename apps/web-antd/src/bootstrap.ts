import { createApp, watch, watchEffect } from 'vue';

import { registerAccessDirective } from '@vben/access';
import { registerLoadingDirective } from '@vben/common-ui/es/loading';
import { preferences, updatePreferences } from '@vben/preferences';
import { initStores } from '@vben/stores';
import '@vben/styles';
import '@vben/styles/antd';

import { useTitle } from '@vueuse/core';

import { $t, setupI18n } from '#/locales';

import { setupComponentAdapters } from './adapter/setup';
import App from './app.vue';
import { router } from './router';
import { state } from './views/intelligence/data';
import { serverMode } from './views/intelligence/session';

import './views/intelligence/intelligence.css';

async function bootstrap(namespace: string) {
  await setupComponentAdapters(router, serverMode);

  // // 设置弹窗的默认配置
  // setDefaultModalProps({
  //   fullscreenButton: false,
  // });
  // // 设置抽屉的默认配置
  // setDefaultDrawerProps({
  //   zIndex: 1020,
  // });

  const app = createApp(App);

  // 注册v-loading指令
  registerLoadingDirective(app, {
    loading: 'loading', // 在这里可以自定义指令名称，也可以明确提供false表示不注册这个指令
    spinning: 'spinning',
  });

  // Prepare independent dependencies together, before routing or mounting views.
  const [, , { initTippy }, { MotionPlugin }] = await Promise.all([
    setupI18n(app),
    initStores(app, { namespace }),
    import('@vben/common-ui/es/tippy'),
    import('@vben/plugins/motion'),
  ]);

  // 安装权限指令
  registerAccessDirective(app);

  // 初始化 tippy
  initTippy(app);

  // 配置路由及路由守卫
  app.use(router);

  // 配置Motion插件
  app.use(MotionPlugin);

  watch(
    () => [state.branding.appName, state.branding.logo],
    () => updatePreferences({
      app: { name: state.branding.appName },
      logo: { source: state.branding.logo },
    }),
    { immediate: true },
  );
  // Keep the configured brand in the title even when page prefixes are disabled.
  watchEffect(() => {
    const routeTitle = preferences.app.dynamicTitle
      ? router.currentRoute.value.meta?.title
      : undefined;
    const pageTitle =
      (routeTitle ? `${$t(routeTitle)} - ` : '') + preferences.app.name;
    useTitle(pageTitle);
  });

  await router.isReady();
  app.mount('#app');
}

export { bootstrap };

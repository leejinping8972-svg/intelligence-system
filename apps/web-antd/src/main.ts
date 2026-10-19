import { initPreferences, updatePreferences } from '@vben/preferences';
import { unmountGlobalLoading } from '@vben/utils';

import { overridesPreferences, preferencesExtension } from './preferences';

/**
 * 应用初始化完成之后再进行页面加载渲染
 */
async function initApplication() {
  await (window as Window & { __hciBrandingReady?: Promise<void> })
    .__hciBrandingReady;
  // name用于指定项目唯一标识
  // 用于区分不同项目的偏好设置以及存储数据的key前缀以及其他一些需要隔离的数据
  const env = import.meta.env.PROD ? 'prod' : 'dev';
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const namespace = `${import.meta.env.VITE_APP_NAMESPACE}-${appVersion}-${env}`;

  // app偏好设置初始化
  await initPreferences({
    extension: preferencesExtension,
    namespace,
    overrides: overridesPreferences,
  });
  // Apply the adopted admin density even when older preferences were cached.
  updatePreferences({
    theme: { colorPrimary: '#2563ff', fontSize: 13, radius: '0.375' },
    sidebar: { width: 188 },
    header: { height: 46 },
    tabbar: { height: 30 },
    navigation: { styleType: 'plain' },
  });
  const branding = (
    window as Window & { __hciBranding?: { appName: string; logo: string } }
  ).__hciBranding;
  if (branding)
    updatePreferences({
      app: { name: branding.appName },
      logo: { source: branding.logo },
    });

  // 启动应用并挂载
  // vue应用主要逻辑及视图
  const { bootstrap } = await import('./bootstrap');
  await bootstrap(namespace);

  // 移除并销毁loading
  unmountGlobalLoading();
}

initApplication();

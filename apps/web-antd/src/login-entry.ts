import { createApp, h, ref } from 'vue';

import LoginScreen from './login-screen.vue';
import { brandingEvent, type PublicBranding } from './public-branding';
import SessionEntryStatus from './session-entry-status.vue';
import {
  refreshSession,
  session,
  startSso,
} from './views/intelligence/session';
import { shouldStartSso } from './views/intelligence/sso-navigation';

export function startLoginEntry() {
  const base = import.meta.env.BASE_URL;
  const url = new URL(location.href);
  const route =
    import.meta.env.VITE_ROUTER_HISTORY === 'hash'
      ? new URL(url.hash.slice(1) || '/', url.origin)
      : url;
  const branding = ref<PublicBranding>(
    (window as Window & { __hciBranding?: PublicBranding }).__hciBranding ?? {
      appName: import.meta.env.VITE_APP_TITLE,
      logo: `${base}hci-logo.svg`,
    },
  );
  const statusError = ref('');
  const showLogin = ref(false);
  const updateBrand = (event: Event) => {
    branding.value = (event as CustomEvent<PublicBranding>).detail;
  };
  window.addEventListener(brandingEvent, updateBrand);
  const root = document.createElement('div');
  root.id = 'login-entry';
  document.body.append(root);
  let launch: Promise<void> | undefined;
  const enterWorkspace = () => {
    if (launch) return launch;
    launch = (async () => {
      const { initApplication } = await import('./application');
      await initApplication();
      dispose();
    })().catch((cause: unknown) => {
      launch = undefined;
      throw cause;
    });
    return launch;
  };
  const checkSession = async () => {
    statusError.value = '';
    showLogin.value = false;
    try {
      await refreshSession();
      if (session.user) {
        await enterWorkspace();
      } else if (
        shouldStartSso(
          session.ssoEnabled,
          session.setupRequired,
          route.searchParams.get('sso'),
        )
      ) {
        const path =
          route === url
            ? `/${url.pathname.slice(base.length)}${url.search}${url.hash}`
            : `${route.pathname}${route.search}${route.hash}`;
        startSso(path);
      } else {
        showLogin.value = true;
      }
    } catch (cause) {
      statusError.value =
        cause instanceof Error ? cause.message : '连接失败，请重试';
    }
  };
  const app = createApp({
    render: () => showLogin.value
      ? h(LoginScreen, {
        branding: branding.value,
        enterWorkspace: async () => {
          const destination = `${base}${import.meta.env.VITE_ROUTER_HISTORY === 'hash' ? '#/' : ''}overview`;
          history.replaceState(history.state, '', destination);
          await enterWorkspace();
        },
        initialError:
          route.searchParams.get('sso') === 'failed'
            ? '单点登录未完成，请使用账号密码登录，或联系管理员检查账号绑定。'
            : '',
      })
      : h(SessionEntryStatus, {
        error: statusError.value,
        onRetry: () => {
          void checkSession();
        },
      }),
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    app.unmount();
    root.remove();
    window.removeEventListener(brandingEvent, updateBrand);
  };
  // Wait for the cookie check before showing credentials or entering the app.
  app.mount(root);
  void checkSession();
  return dispose;
}

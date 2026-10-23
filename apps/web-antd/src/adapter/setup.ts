import type { Router } from 'vue-router';

let initialization: Promise<void> | undefined;

function initializeComponentAdapters() {
  if (initialization) return initialization;
  const request = Promise.all([
    import('./component'),
    import('./form'),
  ]).then(async ([component, form]) => {
    await component.initComponentAdapter();
    await form.initSetupVbenForm();
  });
  initialization = request;
  void request.catch(() => {
    if (initialization === request) initialization = undefined;
  });
  return request;
}

export function setupComponentAdapters(router: Router, serverMode: boolean) {
  if (!serverMode) return initializeComponentAdapters();
  // Only the native server login can render without the framework form adapters.
  router.beforeResolve((to) => {
    if (to.name !== 'Login') return initializeComponentAdapters();
  });
}

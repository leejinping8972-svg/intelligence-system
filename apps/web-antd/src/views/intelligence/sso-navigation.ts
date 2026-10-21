export function shouldStartSso(
  enabled: boolean,
  setupRequired: boolean,
  result: unknown,
) {
  return (
    enabled &&
    !setupRequired &&
    !['failed', 'skip', 'unavailable'].includes(String(result || ''))
  );
}

export function ssoStartUrl(routePath: string, base = '/admin/') {
  const path =
    routePath.startsWith('/') && !routePath.startsWith('//')
      ? routePath
      : '/overview';
  const returnTo = `${base.replace(/\/$/, '')}${path}`;
  return `/api/sso/start?${new URLSearchParams({ return_to: returnTo })}`;
}

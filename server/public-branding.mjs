export function publicBranding(value = {}) {
  const appName =
    typeof value?.appName === 'string' && value.appName.trim()
      ? value.appName.trim().slice(0, 80)
      : '知衡情报';
  let logo = '/admin/hci-logo.svg';
  const candidate = typeof value?.logo === 'string' ? value.logo : '';
  if (candidate.length <= 750_000) {
    if (/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(candidate))
      logo = candidate;
    else {
      try {
        const url = new URL(candidate, 'https://is.luckdate.com');
        if (
          candidate &&
          url.protocol === 'https:' &&
          !url.username &&
          !url.password
        )
          logo =
            candidate === '/hci-logo.svg' ? '/admin/hci-logo.svg' : url.href;
      } catch {
        /* Use the default image for invalid URLs. */
      }
    }
  }
  return { appName, logo };
}

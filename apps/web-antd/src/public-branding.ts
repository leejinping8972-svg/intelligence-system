export interface PublicBranding {
  appName: string;
  logo: string;
}

export const brandingEvent = 'hci:branding-changed';
const cacheKey = 'intelligence-public-branding-v1';

function apply(value: unknown, base: string) {
  const candidate = value as Partial<PublicBranding> | null;
  if (typeof candidate?.appName !== 'string' || !candidate.appName.trim()) return;
  const logo = typeof candidate.logo === 'string' ? candidate.logo : '';
  const branding: PublicBranding = {
    appName: candidate.appName.trim().slice(0, 80),
    logo: /^(?:https:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|webp);base64,)/i.test(logo)
      ? logo
      : `${base}hci-logo.svg`,
  };
  (window as Window & { __hciBranding?: PublicBranding }).__hciBranding = branding;
  document.title = branding.appName;
  const title = document.getElementById('loading-brand-title');
  if (title) {
    title.textContent = branding.appName;
    title.hidden = false;
  }
  const image = document.getElementById('loading-brand-logo') as HTMLImageElement | null;
  const spinner = document.getElementById('loading-brand-spinner');
  if (image) {
    image.onload = () => {
      image.hidden = false;
      if (spinner) spinner.hidden = true;
    };
    image.src = branding.logo;
  }
  try {
    localStorage.setItem(cacheKey, JSON.stringify(branding));
  } catch {
    // Branding still works when browser storage is disabled.
  }
  window.dispatchEvent(new CustomEvent(brandingEvent, { detail: branding }));
}

export async function initializePublicBranding(serverMode: boolean, base: string) {
  try {
    apply(JSON.parse(localStorage.getItem(cacheKey) || 'null'), base);
  } catch {
    // Ignore an unavailable or corrupt cache and fetch the server configuration.
  }
  if (!serverMode) return;
  const request = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch('/api', {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'public_branding' }),
          signal: AbortSignal.timeout(15_000),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Branding unavailable');
        const value = await response.json();
        if (!value?.appName?.trim()) throw new Error('Branding missing');
        apply(value, base);
        return;
      } catch {
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  })();
  // Slow public configuration must not block login, but still applies on arrival.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    request,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); }),
  ]);
  clearTimeout(timer);
}

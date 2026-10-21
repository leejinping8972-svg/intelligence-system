import { fetchPublicPage, landingUrl, publicAddress } from './safe-web.mjs';
import { lookup } from 'node:dns/promises';
import { siteHostAllowed } from './product-jobs.mjs';
import { fetchConfiguration } from './site-fetch-config.mjs';

export function renderedPageNeeded(page, url, products, links) {
  return (
    !/\.json$|\.xml$/i.test(new URL(url).pathname) &&
    /<script\b[^>]*src=|__NEXT_DATA__|id=["'](?:root|app)["']/i.test(
      page.html,
    ) &&
    ((products.length === 0 && links.length === 0) ||
      (/\/products?\//i.test(new URL(url).pathname) &&
        products.some((p) => !p.ingredients || !p.image)))
  );
}
export async function hostedProductPage(
  url,
  site,
  apiKey,
  fetcher = fetch,
  resolver = lookup,
) {
  const checked = landingUrl(url);
  if (!checked || !siteHostAllowed(new URL(checked).hostname, site.domain))
    throw new Error('备用采集只允许当前公开站点');
  const addresses = await resolver(
    new URL(checked).hostname.replaceAll(/^\[|\]$/g, ''),
    { all: true },
  );
  if (
    addresses.length === 0 ||
    addresses.some((v) => !publicAddress(v.address))
  )
    throw new Error('备用目标指向非公网地址，未发送给托管服务');
  let response;
  try {
    response = await fetcher('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: checked,
        formats: ['rawHtml'],
        onlyMainContent: false,
        timeout: 30_000,
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new Error('托管采集响应未知，本次已计入备用次数，不自动重放');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true)
    throw new Error(
      `托管采集 HTTP ${response.status}，请检查Key、额度或稍后手动重试`,
    );
  const status = Number(result.data?.metadata?.statusCode);
  if (!(status >= 200 && status < 300))
    throw Object.assign(
      new Error(`托管返回的目标页面 HTTP ${status || '未知'}，未当作成功`),
      { status: status || 0 },
    );
  const final = result.data?.metadata?.sourceURL || checked;
  if (
    !landingUrl(final) ||
    !siteHostAllowed(new URL(final).hostname, site.domain)
  )
    throw new Error('托管结果跳转至其他站点，未采集');
  const html = result.data?.rawHtml;
  if (
    typeof html !== 'string' ||
    !html.trim() ||
    Buffer.byteLength(html) > 2_000_000
  )
    throw new Error('托管结果无有效页面或超过大小上限');
  return { html, url: final, method: 'hosted' };
}

// All browser HTTP is fulfilled through the DNS-pinned public-page reader.
// No cookies, user sessions, POST, private networks, downloads or WebSockets.
export async function renderProductPage(url, site, overrides = {}) {
  const io = {
    fetchPage: fetchPublicPage,
    launch: async (options) => {
      const { chromium } = await import('playwright-core');
      return chromium.launch(options);
    },
    ...overrides,
  };
  if (!landingUrl(url) || !siteHostAllowed(new URL(url).hostname, site.domain))
    throw new Error('浏览器仅访问当前公开站点');
  let browser,
    fatal,
    count = 0,
    bytes = 0;
  try {
    browser = await io.launch({
      executablePath: process.env.PRODUCT_BROWSER_EXECUTABLE || undefined,
      chromiumSandbox: true,
      headless: true,
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.TMPDIR || process.env.TEMP || '/tmp',
        LANG: 'en_US.UTF-8',
      },
      proxy: { server: 'http://127.0.0.1:9' },
      args: [
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      ],
    });
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (
        fatal ||
        request.method() !== 'GET' ||
        !['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(
          request.resourceType(),
        ) ||
        count >= 24
      )
        return route.abort();
      if (
        request.isNavigationRequest() &&
        !siteHostAllowed(new URL(request.url()).hostname, site.domain)
      )
        return route.abort();
      count++;
      try {
        const page = await io.fetchPage(
          request.url(),
          0,
          [
            'text/html',
            'application/javascript',
            'text/javascript',
            'text/css',
            'application/json',
            'text/plain',
          ],
          request.isNavigationRequest()
            ? { allowedDomain: site.domain, manualRedirect: true }
            : { manualRedirect: true },
        );
        if (page.redirect)
          return route.fulfill({
            status: 302,
            headers: { location: page.redirect },
          });
        bytes += Buffer.byteLength(page.html);
        if (bytes > 10_000_000) throw new Error('渲染资源超过上限');
        await route.fulfill({
          status: 200,
          contentType: page.contentType || 'text/html',
          body: page.html,
        });
      } catch (error) {
        if (request.isNavigationRequest() || [403, 429].includes(error.status))
          fatal = error;
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    const timer = setTimeout(() => {
      fatal ||= new Error('浏览器渲染超时');
      void context.close().catch(() => {});
    }, 45_000);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(1200);
      if (fatal) throw fatal;
      const html = await page.content();
      if (Buffer.byteLength(html) > 2_000_000)
        throw new Error('渲染页面超过上限');
      return {
        html,
        url: page.url(),
        method: 'browser',
        resourceRequests: count,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    if (fatal) throw fatal;
    throw new Error('浏览器渲染不可用或页面加载失败；请检查Chromium运行环境');
  } finally {
    await browser?.close().catch(() => {});
  }
}
export async function fetchFallbackPage(url, site, mode) {
  const config = await fetchConfiguration(mode === 'hosted');
  if (mode === 'hosted') {
    if (!config.paidEnabled || !config.apiKey)
      throw new Error('托管备用未启用或未配置Key，未发起付费请求');
    return hostedProductPage(url, site, config.apiKey);
  }
  if (!config.browserEnabled)
    throw new Error('浏览器渲染已关闭，保留已采集结果');
  return renderProductPage(url, site);
}

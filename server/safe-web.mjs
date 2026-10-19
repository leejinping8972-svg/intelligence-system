import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import http from 'node:http';
export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Accept only global-unicast IPv6; rejects mapped IPv4 and local ranges.
  return (
    isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip)
  );
}
export function landingUrl(value) {
  try {
    const u = new URL(value);
    if (
      !['https:', 'http:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      (u.port && !['80', '443'].includes(u.port))
    )
      return null;
    if (/^(?:localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (
      [
        'facebook.com',
        'instagram.com',
        'fb.me',
        'tiktok.com',
        'amazon.com',
        'youtube.com',
      ].some((d) => host === d || host.endsWith(`.${d}`))
    )
      return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
export async function fetchPublicPage(value, depth = 0, types = ['text/html']) {
  const checked = landingUrl(value);
  if (!checked || depth > 5) throw new Error('落地页不是可验证的公开官网地址');
  const u = new URL(checked);
  const addresses = await lookup(u.hostname.replace(/^\[|\]$/g, ''), {
    all: true,
  });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error('落地页指向非公网地址，已停止访问');
  const pinned = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).get(
      u,
      {
        headers: {
          'user-agent': 'LuckdateResearch/1.0',
          accept: types.join(','),
        },
        lookup: (_host, options, cb) =>
          cb(null, options.all ? [pinned] : pinned.address, pinned.family),
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, u).toString() });
          return;
        }
        if (
          res.statusCode !== 200 ||
          !types.some((type) =>
            String(res.headers['content-type']).includes(type),
          )
        ) {
          res.resume();
          const retry = res.headers['retry-after'];
          const retryAfterSeconds = /^\d+(?:\.\d+)?$/.test(String(retry || ''))
            ? Number(retry)
            : Math.max(0, (Date.parse(retry || '') - Date.now()) / 1000) || 0;
          reject(
            Object.assign(
              new Error(
                `官网返回 HTTP ${res.statusCode}${res.statusCode === 200 ? '，内容类型不受支持' : ''}`,
              ),
              {
                status: res.statusCode,
                contentType: String(res.headers['content-type'] || ''),
                retryAfterSeconds,
              },
            ),
          );
          return;
        }
        let bytes = 0;
        const chunks = [];
        res.on('data', (b) => {
          bytes += b.length;
          if (bytes > 2_000_000) {
            res.destroy(new Error('官网内容超过采集上限'));
          } else chunks.push(b);
        });
        res.on('end', () =>
          resolve({
            html: Buffer.concat(chunks).toString('utf8'),
            url: u.toString(),
          }),
        );
        res.on('error', reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error('官网访问超时')),
      20000,
    );
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
  return result.redirect
    ? fetchPublicPage(result.redirect, depth + 1, types)
    : result;
}

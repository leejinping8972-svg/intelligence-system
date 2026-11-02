import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { publicAddress } from './safe-web.mjs';

const fault = (status, message) =>
  Object.assign(new Error(message), { status });
export function allowedAdMedia(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      (u.port && u.port !== '443') ||
      !['fbcdn.net', 'cdninstagram.com'].some((d) =>
        u.hostname.endsWith(`.${d}`),
      )
    )
      return null;
    return u;
  } catch {
    return null;
  }
}
export function mediaSelection(ad, kind, index) {
  const field = {
    video: 'videoUrls',
    image: 'imageUrls',
    poster: 'videoPosterUrls',
  }[kind];
  if (!field || !Number.isInteger(index) || index < 0 || index > 99)
    throw fault(400, '素材参数无效');
  const u = allowedAdMedia(ad?.[field]?.[index]);
  if (!u) throw fault(404, '没有可播放的已采集素材');
  return u;
}
export function mediaRange(value) {
  if (!value) return undefined;
  if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(value))
    throw fault(416, '不支持的素材范围请求');
  const [start, end] = value.slice(6).split('-');
  if (
    (start && Number(start) > 1e12) ||
    (end && Number(end) > 1e12) ||
    (start && end && Number(start) > Number(end)) ||
    (start === '' && Number(end) === 0)
  )
    throw fault(416, '素材范围无效');
  return value;
}
export async function openAdMedia(
  url,
  {
    method = 'GET',
    range,
    resolveDns = lookup,
    requester = https.request,
  } = {},
  depth = 0,
) {
  const u = allowedAdMedia(url);
  if (!u || depth > 3) throw fault(502, '素材地址不可用');
  const addresses = await resolveDns(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw fault(502, '素材地址不是公网服务');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = requester(
      u,
      {
        method,
        headers: {
          'user-agent': 'LuckdateResearch/1.0',
          ...(range ? { Range: range } : {}),
        },
        lookup: (_host, options, cb) =>
          cb(null, options.all ? [pinned] : pinned.address, pinned.family),
      },
      async (upstream) => {
        if (
          upstream.statusCode >= 300 &&
          upstream.statusCode < 400 &&
          upstream.headers.location
        ) {
          upstream.resume();
          try {
            resolve(
              await openAdMedia(
                new URL(upstream.headers.location, u),
                { method, range, resolveDns, requester },
                depth + 1,
              ),
            );
          } catch (e) {
            reject(e);
          }
          return;
        }
        resolve(upstream);
      },
    );
    req.setTimeout(30000, () => req.destroy(fault(504, '素材读取超时')));
    req.on('error', () => reject(fault(502, '素材读取失败，请稍后重试')));
    req.end();
  });
}
export async function serveAdMedia(
  request,
  response,
  ad,
  kind,
  index,
  opener = openAdMedia,
) {
  const url = mediaSelection(ad, kind, index),
    range = mediaRange(request.headers.range);
  const upstream = await opener(url, { method: request.method, range });
  const type = String(upstream.headers['content-type'] || '')
    .split(';')[0]
    .toLowerCase();
  if (![200, 206].includes(upstream.statusCode)) {
    upstream.destroy();
    throw fault(
      [403, 404, 410].includes(upstream.statusCode) ? 410 : 502,
      [403, 404, 410].includes(upstream.statusCode)
        ? '原始素材链接已失效，请更新广告来源'
        : '素材服务暂不可用',
    );
  }
  const valid =
    kind === 'video'
      ? ['video/mp4', 'video/webm', 'video/quicktime'].includes(type)
      : [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/avif',
          'image/gif',
        ].includes(type);
  const size = Number(upstream.headers['content-length']);
  if (
    !valid ||
    !Number.isFinite(size) ||
    size < 0 ||
    size > (kind === 'video' ? 200000000 : 10000000)
  ) {
    upstream.destroy();
    throw fault(502, '素材类型或大小不符合播放要求');
  }
  response.statusCode = upstream.statusCode;
  response.setHeader('content-type', type);
  response.setHeader('cache-control', 'private, no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('content-length', String(size));
  if (
    upstream.headers['content-range'] &&
    /^bytes \d+-\d+\/\d+$/.test(upstream.headers['content-range'])
  )
    response.setHeader('content-range', upstream.headers['content-range']);
  if (upstream.headers['accept-ranges'] === 'bytes')
    response.setHeader('accept-ranges', 'bytes');
  if (request.method === 'HEAD') {
    upstream.destroy();
    response.end();
    return;
  }
  await new Promise((resolve) => {
    let received = 0;
    upstream.on('data', (chunk) => {
      received += chunk.length;
      if (received > size) {
        upstream.destroy();
        response.destroy();
        resolve();
      }
    });
    const finish = () => {
      upstream.destroy();
      resolve();
    };
    response.once('close', finish);
    response.once('finish', finish);
    upstream.once('error', () => {
      response.destroy();
      resolve();
    });
    upstream.pipe(response);
  });
}

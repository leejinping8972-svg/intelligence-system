import { Buffer } from 'node:buffer';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(address, prefix, 'ipv4');
const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

export class ArticleError extends Error {
  constructor(message, state = 'failed') {
    super(message);
    this.state = state;
  }
}
export function articleHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      isIP(url.hostname) ||
      !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(url.hostname) ||
      /\.(?:local|localhost|internal|test|invalid)$/i.test(url.hostname)
    )
      throw new Error('url');
    url.hash = '';
    return url;
  } catch {
    throw new ArticleError(
      '原文链接不是可读取的公开 HTTPS 地址',
      'unsupported',
    );
  }
}
export function publicArticleAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return (
    family === 6 &&
    ipv6Global.check(address, 'ipv6') &&
    !blocked.check(address, 'ipv6')
  );
}
export async function articleDns(hostname, resolve = lookup) {
  let timer;
  try {
    const entries = await Promise.race([
      resolve(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new ArticleError('原文域名解析超时')),
          8000,
        );
      }),
    ]);
    if (
      entries.length === 0 ||
      entries.some((entry) => !publicArticleAddress(entry.address))
    )
      throw new ArticleError('原文域名解析到非公网地址，已停止读取', 'blocked');
    return entries;
  } finally {
    clearTimeout(timer);
  }
}
function readOnce(url, addresses) {
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(25_000);
    const req = request(
      url,
      {
        agent: false,
        rejectUnauthorized: true,
        signal,
        // Pin the checked addresses into this TLS connection. No second DNS lookup.
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, addresses)
            : callback(null, addresses[0].address, addresses[0].family),
        headers: {
          Accept: 'application/xml, text/xml, text/html, application/xhtml+xml',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Luckdate-PublicContent/1.0',
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location: response.headers.location });
          return;
        }
        if (status !== 200) {
          response.resume();
          const states = {
            401: 'blocked',
            403: 'blocked',
            404: 'unavailable',
            429: 'rate_limited',
          };
          reject(
            new ArticleError(
              `原文 HTTP ${status}，未绕过访问限制`,
              states[status] || 'failed',
            ),
          );
          return;
        }
        if (
          !/^(?:text\/(?:html|xml)|application\/(?:xml|xhtml\+xml))/i.test(
            response.headers['content-type'] || '',
          )
        ) {
          response.resume();
          reject(
            new ArticleError(
              '当前原文不是 HTML/XML；PDF 或附件请打开来源阅读',
              'unsupported',
            ),
          );
          return;
        }
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        ) {
          response.resume();
          reject(new ArticleError('原文压缩格式暂不支持', 'unsupported'));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('error', reject);
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 5_000_000) {
            req.destroy(new ArticleError('原文超过5MB读取上限', 'unsupported'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status,
            url: url.href,
            contentType: response.headers['content-type'],
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}
export async function fetchPublicArticle(value, io = {}) {
  let url = articleHttpsUrl(value);
  for (let redirect = 0; redirect <= 2; redirect++) {
    const addresses = await articleDns(url.hostname, io.resolve || lookup);
    const result = await (io.read || readOnce)(url, addresses);
    if (result.status === 200) return result;
    if (!result.location || redirect === 2)
      throw new ArticleError('原文重定向超过限制，未继续读取', 'blocked');
    url = articleHttpsUrl(new URL(result.location, url).href);
  }
  throw new ArticleError('原文读取未完成');
}

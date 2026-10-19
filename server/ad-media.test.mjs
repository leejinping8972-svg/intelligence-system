import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import {
  allowedAdMedia,
  mediaSelection,
  mediaRange,
  openAdMedia,
  serveAdMedia,
} from './ad-media.mjs';
import { normalizeAds } from './ads-provider.mjs';
const url = 'https://video-lga3-1.xx.fbcdn.net/v/video.mp4?signature=example';
test('media proxy accepts only HTTPS Meta CDN resources and bounded ranges', () => {
  assert.ok(allowedAdMedia(url));
  for (const bad of [
    'http://video.fbcdn.net/a',
    'https://fbcdn.net.evil.test/a',
    'https://127.0.0.1/a',
    'https://x:secret@video.fbcdn.net/a',
    'https://video.fbcdn.net:8443/a',
    'file:///tmp/file',
  ])
    assert.equal(allowedAdMedia(bad), null);
  assert.equal(mediaRange('bytes=0-1023'), 'bytes=0-1023');
  assert.equal(mediaRange('bytes=-100'), 'bytes=-100');
  for (const bad of [
    'bytes=1-0',
    'bytes=0-1,2-3',
    'bytes=-0',
    'bytes=99999999999999-',
    'hello',
  ])
    assert.throws(() => mediaRange(bad));
});
test('selection cannot proxy an arbitrary URL or unknown asset kind', () => {
  assert.equal(mediaSelection({ videoUrls: [url] }, 'video', 0).href, url);
  assert.throws(() => mediaSelection({ videoUrls: [url] }, 'anything', 0));
  assert.throws(() => mediaSelection({ videoUrls: [url] }, 'video', -1));
  assert.throws(() =>
    mediaSelection({ videoUrls: ['https://evil.test/a'] }, 'video', 0),
  );
});
test('mixed private/public DNS results are rejected before a socket is opened', async () => {
  let opened = false;
  await assert.rejects(
    () =>
      openAdMedia(url, {
        resolveDns: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
        requester: () => {
          opened = true;
        },
      }),
    /公网/,
  );
  assert.equal(opened, false);
});
test('redirects are revalidated and never follow an external or private host', async () => {
  let requests = 0;
  const requester = (_url, _opts, cb) => {
    requests++;
    const r = new EventEmitter();
    r.setTimeout = () => {};
    r.end = () =>
      queueMicrotask(() => {
        const up = Readable.from([]);
        up.statusCode = 302;
        up.headers = { location: 'https://127.0.0.1/' };
        cb(up);
      });
    return r;
  };
  await assert.rejects(
    () =>
      openAdMedia(url, {
        resolveDns: async () => [{ address: '8.8.8.8', family: 4 }],
        requester,
      }),
    /地址不可用/,
  );
  assert.equal(requests, 1);
});
function response() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, next) {
      chunks.push(chunk);
      next();
    },
  });
  res.headers = {};
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.chunks = chunks;
  return res;
}
function upstream(status = 206, type = 'video/mp4') {
  const r = Readable.from([Buffer.from('test')]);
  r.statusCode = status;
  r.headers = {
    'content-type': type,
    'content-length': '4',
    'content-range': 'bytes 0-3/100',
    'accept-ranges': 'bytes',
  };
  return r;
}
test('video byte ranges are streamed with the upstream range metadata', async () => {
  const res = response();
  let got;
  await serveAdMedia(
    { method: 'GET', headers: { range: 'bytes=0-3' } },
    res,
    { videoUrls: [url] },
    'video',
    0,
    async (u, opts) => {
      got = opts;
      return upstream();
    },
  );
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-3/100');
  assert.equal(res.headers['content-type'], 'video/mp4');
  assert.equal(Buffer.concat(res.chunks).toString(), 'test');
  assert.equal(got.range, 'bytes=0-3');
});
test('expired links and unexpected HTML return a clear failure instead of a broken video body', async () => {
  await assert.rejects(
    () =>
      serveAdMedia(
        { method: 'GET', headers: {} },
        response(),
        { videoUrls: [url] },
        'video',
        0,
        async () => upstream(403),
      ),
    /失效/,
  );
  await assert.rejects(
    () =>
      serveAdMedia(
        { method: 'GET', headers: {} },
        response(),
        { videoUrls: [url] },
        'video',
        0,
        async () => upstream(200, 'text/html'),
      ),
    /类型/,
  );
});
test('Meta preview images and SD fallback are preserved alongside video HD', () => {
  const sd = url.replace('video.mp4', 'video-sd.mp4'),
    poster = 'https://scontent.xx.fbcdn.net/poster.jpg';
  const { ads } = normalizeAds(
    {
      searchResults: [
        {
          ad_archive_id: '123',
          snapshot: {
            videos: [
              {
                video_hd_url: url,
                video_sd_url: sd,
                video_preview_image_url: poster,
              },
            ],
          },
        },
      ],
    },
    { id: 'kw', term: 'creatine', market: 'US' },
  );
  assert.deepEqual(ads[0].videoUrls, [url, sd]);
  assert.deepEqual(ads[0].videoPosterUrls, [poster]);
});

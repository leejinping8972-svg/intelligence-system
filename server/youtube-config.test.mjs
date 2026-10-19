import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  checkYoutubeKey,
  openYoutubeKey,
  sealYoutubeKey,
  validateYoutubeKey,
  youtubeAction,
} from './youtube-config.mjs';

const key = 'AIza-test-only-not-a-real-key-1234567890';
const secret = randomBytes(32).toString('base64');
const admin = { role: 'admin' };
function fixture() {
  let stored;
  return {
    io: {
      secret,
      envKey: '',
      read: async () => stored,
      write: async (v) => {
        stored = v;
      },
    },
    get: () => stored,
  };
}
test('encrypts key with authentication; never stores or returns plaintext', async () => {
  const f = fixture();
  const result = await youtubeAction(
    { action: 'server_youtube_config', apiKey: key },
    admin,
    f.io,
  );
  assert.equal(openYoutubeKey(f.get(), secret), key);
  assert.ok(!JSON.stringify([f.get(), result]).includes(key));
  const other = sealYoutubeKey(key, secret);
  assert.notEqual(other.ciphertext, f.get().ciphertext);
  assert.throws(() =>
    openYoutubeKey(
      { ...other, tag: randomBytes(16).toString('base64') },
      secret,
    ),
  );
  assert.throws(() =>
    openYoutubeKey(other, randomBytes(32).toString('base64')),
  );
});
test('read is passive; only admins can save or verify; blank never replaces key', async () => {
  const f = fixture();
  for (const input of [
    { action: 'server_youtube_config', apiKey: key },
    { action: 'server_youtube_status', verify: true },
  ])
    await assert.rejects(
      youtubeAction(input, { role: 'researcher' }, f.io),
      /仅管理员/,
    );
  await youtubeAction(
    { action: 'server_youtube_config', apiKey: key },
    admin,
    f.io,
  );
  await assert.rejects(
    youtubeAction({ action: 'server_youtube_config', apiKey: '' }, admin, f.io),
  );
  const result = await youtubeAction(
    { action: 'server_youtube_status' },
    { role: 'researcher' },
    {
      ...f.io,
      check: () => {
        throw new Error('must not call');
      },
    },
  );
  assert.equal(result.configured, true);
  assert.equal(openYoutubeKey(f.get(), secret), key);
  assert.throws(() => validateYoutubeKey('https://example.com/key'));
});
test('verification uses one fixed official request; safe messages for quota, restrictions, disabled API and network errors', async () => {
  let calls = 0;
  const ok = await checkYoutubeKey(key, async (url, init) => {
    calls++;
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(url.pathname, '/youtube/v3/videoCategories');
    assert.equal(init.redirect, 'manual');
    return Response.json({ items: [] });
  });
  assert.equal(calls, 1);
  assert.equal(ok.ready, true);
  for (const [reason, pattern] of [
    ['quotaExceeded', /配额/],
    ['accessNotConfigured', /启用/],
    ['ipRefererBlocked', /限制/],
    ['keyInvalid', /无效/],
  ]) {
    const result = await checkYoutubeKey(key, async () =>
      Response.json(
        { error: { message: key, errors: [{ reason }] } },
        { status: reason === 'keyInvalid' ? 400 : 403 },
      ),
    );
    assert.match(result.message, pattern);
    assert.ok(!JSON.stringify(result).includes(key));
  }
  const failed = await checkYoutubeKey(key, async () => {
    throw new Error(key);
  });
  assert.equal(failed.ready, false);
  assert.ok(!JSON.stringify(failed).includes(key));
});
test('check status persists and replacing a key resets previous check', async () => {
  const f = fixture();
  await youtubeAction(
    { action: 'server_youtube_config', apiKey: key },
    admin,
    f.io,
  );
  const checked = await youtubeAction(
    { action: 'server_youtube_status', verify: true },
    admin,
    {
      ...f.io,
      check: async (v) => {
        assert.equal(v, key);
        return { ready: false, message: '配额已用完' };
      },
    },
  );
  assert.ok(checked.checkedAt);
  assert.equal(f.get().lastCheck.ready, false);
  await youtubeAction(
    { action: 'server_youtube_config', apiKey: key + '1' },
    admin,
    f.io,
  );
  assert.equal(f.get().lastCheck, undefined);
});

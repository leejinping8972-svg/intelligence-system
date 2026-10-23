/* oxlint-disable vitest/no-import-node-test, unicorn/no-await-expression-member -- Native handler tests keep assertions next to requests. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  PLATFORM_LINK_BASE,
  platformLinkConfig,
} from './platform-link-config.mjs';
import { createPlatformLink } from './platform-link.mjs';

function proxyHarness(trustProxy) {
  const config = platformLinkConfig({
    PLATFORM_LINK_ENABLED: 'true',
    PLATFORM_LINK_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ...(trustProxy === undefined
      ? {}
      : { PLATFORM_LINK_TRUST_PROXY: trustProxy }),
  });
  let inspections = 0;
  const handler = createPlatformLink({
    config,
    now: () => 1_800_000_000_000,
    store: {
      cleanup: async () => 0,
      keyByHash: async () => {
        inspections += 1;
        return {
          user_id: 'synthetic-proxy-user',
          display_name: 'Synthetic proxy user',
          role: 'researcher',
          enabled: 1,
          revoked_at: null,
          expires_at: null,
        };
      },
    },
    sessionUser: async () => {
      throw new Error('No session access in proxy QA');
    },
    signIn: async () => {
      throw new Error('No sign-in in proxy QA');
    },
    fetchPeer: async () => {
      throw new Error('No network access in proxy QA');
    },
  });
  return {
    get inspections() {
      return inspections;
    },
    async inspect(socket = '10.0.0.9', headers = {}) {
      const request = Readable.from([Buffer.from('{}')]);
      request.method = 'POST';
      request.socket = { remoteAddress: socket };
      request.headers = {
        'content-type': 'application/json',
        authorization: 'Bearer synthetic-proxy-key-for-QA',
        ...headers,
      };
      const responseHeaders = new Map();
      let payload;
      const response = {
        statusCode: 200,
        getHeader: (name) => responseHeaders.get(name.toLowerCase()),
        setHeader: (name, value) =>
          responseHeaders.set(name.toLowerCase(), value),
        end: (text) => {
          payload = JSON.parse(text);
        },
      };
      await handler.handle(
        request,
        response,
        new URL(`${config.ownOrigin}${PLATFORM_LINK_BASE}/key/inspect`),
      );
      return { status: response.statusCode, payload, headers: responseHeaders };
    },
  };
}

test('untrusted proxy headers cannot rotate the socket rate limit', async () => {
  for (const trustProxy of [undefined, 'false']) {
    const harness = proxyHarness(trustProxy);
    for (let i = 0; i < 60; i++) {
      const result = await harness.inspect('10.0.0.9', {
        'x-platform-link-client-ip': `198.51.100.${i + 1}`,
        'x-forwarded-for': `203.0.113.${i + 1}`,
        'x-real-ip': `192.0.2.${i + 1}`,
      });
      assert.equal(result.status, 200);
    }
    const rejected = await harness.inspect('10.0.0.9', {
      'x-platform-link-client-ip': '198.51.100.200',
    });
    assert.equal(rejected.status, 429);
    assert.equal(rejected.payload.code, 'RATE_LIMITED');
    assert.equal(rejected.headers.get('retry-after'), '60');
    assert.equal(harness.inspections, 60);
    assert.equal(
      (
        await harness.inspect('10.0.0.10', {
          'x-platform-link-client-ip': '198.51.100.200',
        })
      ).status,
      200,
    );
  }
});

test('trusted single IP header gives each IPv4 and IPv6 client its own rate limit', async () => {
  const harness = proxyHarness('true');
  for (const client of ['198.51.100.1', '198.51.100.2', '2001:db8::1']) {
    for (let i = 0; i < 60; i++)
      assert.equal(
        (
          await harness.inspect('10.0.0.9', {
            'x-platform-link-client-ip': client,
          })
        ).status,
        200,
      );
    const rejected = await harness.inspect('10.0.0.9', {
      'x-platform-link-client-ip': client,
      'x-forwarded-for': '203.0.113.99',
      'x-real-ip': '203.0.113.99',
    });
    assert.equal(rejected.status, 429);
    assert.equal(rejected.payload.code, 'RATE_LIMITED');
  }
  assert.equal(harness.inspections, 180);
  assert.equal(
    (
      await harness.inspect('10.0.0.9', {
        'x-platform-link-client-ip': '2001:db8::2',
      })
    ).status,
    200,
  );
});

test('invalid trusted IP headers share the socket fallback and cannot bypass limits', async () => {
  const harness = proxyHarness('true');
  const invalidHeaders = [
    undefined,
    '',
    '198.51.100.1, 198.51.100.2',
    ['198.51.100.1', '198.51.100.2'],
    '198.51.100.1:443',
    '198.51.100.1/32',
    '198.51.100.999',
    ' 198.51.100.1',
    'example.test',
    'for=198.51.100.1',
  ];
  for (let i = 0; i < 60; i++)
    assert.equal(
      (
        await harness.inspect('10.0.0.9', {
          'x-platform-link-client-ip':
            invalidHeaders[i % invalidHeaders.length],
          'x-forwarded-for': `203.0.113.${i + 1}`,
        })
      ).status,
      200,
    );
  const rejected = await harness.inspect('10.0.0.9', {
    'x-platform-link-client-ip': 'not-an-IP',
  });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.payload.code, 'RATE_LIMITED');
  assert.equal(harness.inspections, 60);
  assert.equal(
    (
      await harness.inspect('10.0.0.10', {
        'x-platform-link-client-ip': 'not-an-IP',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await harness.inspect('10.0.0.9', {
        'x-platform-link-client-ip': '198.51.100.1',
      })
    ).status,
    200,
  );
});

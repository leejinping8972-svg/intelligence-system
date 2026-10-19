import assert from 'node:assert/strict';
import test from 'node:test';
import { publicBranding } from './public-branding.mjs';
test('public bootstrap returns only configured display name and safe logo', () => {
  const value = publicBranding({
    appName: 'Luckdate 情报系统',
    logo: 'data:image/png;base64,YWJj',
    workspaceName: 'private',
    researchAccessKey: 'secret',
    apiKey: 'private-key',
  });
  assert.deepEqual(value, {
    appName: 'Luckdate 情报系统',
    logo: 'data:image/png;base64,YWJj',
  });
  for (const logo of [
    'javascript:alert(1)',
    'data:text/html,secret',
    'https://user:password@example.com/logo.png',
  ])
    assert.equal(publicBranding({ logo }).logo, '/admin/hci-logo.svg');
  assert.equal(
    publicBranding({ logo: '/hci-logo.svg' }).logo,
    '/admin/hci-logo.svg',
  );
});

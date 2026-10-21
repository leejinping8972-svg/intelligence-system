import { describe, expect, it } from 'vitest';

import {
  shouldStartSso,
  ssoStartUrl,
} from '../apps/web-antd/src/views/intelligence/sso-navigation';

describe('automatic administrator SSO navigation', () => {
  it('runs only after configuration and bootstrap, and never loops after fallback or explicit logout', () => {
    expect(shouldStartSso(true, false, undefined)).toBe(true);
    expect(shouldStartSso(false, false, undefined)).toBe(false);
    expect(shouldStartSso(true, true, undefined)).toBe(false);
    for (const result of ['failed', 'unavailable', 'skip']) {
      expect(shouldStartSso(true, false, result)).toBe(false);
    }
  });
  it('preserves the requested local page and encodes query parameters without exposing passwords', () => {
    const target = new URL(
      ssoStartUrl('/research?market=US&term=test#keyword'),
      'https://is.luckdate.com',
    );
    expect(target.pathname).toBe('/api/sso/start');
    expect(target.searchParams.get('return_to')).toBe(
      '/admin/research?market=US&term=test#keyword',
    );
    for (const path of ['https://evil.test', '//evil.test']) {
      expect(
        new URL(ssoStartUrl(path), target.origin).searchParams.get('return_to'),
      ).toBe('/admin/overview');
    }
  });
});

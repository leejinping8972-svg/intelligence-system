import { describe, expect, it, vi } from 'vitest';

import { loadLocalesMapFromDir } from '../packages/locales/src/i18n';

vi.mock('@vben-core/composables', () => ({
  useSimpleLocale: () => ({ setSimpleLocale: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

describe('locale module loading', () => {
  it('starts every selected language file together and preserves keys regardless of completion order', async () => {
    const first = deferred<{ default: { title: string } }>();
    const second = deferred<{ default: { title: string } }>();
    const firstLoader = vi.fn(() => first.promise);
    const secondLoader = vi.fn(() => second.promise);
    const otherLanguage = vi.fn();
    const loaders = loadLocalesMapFromDir(
      /\.\/langs\/([^/]+)\/(.*)\.json$/,
      {
        './langs/en-US/page.json': otherLanguage,
        './langs/zh-CN/page.json': firstLoader,
        './langs/zh-CN/preferences/theme.json': secondLoader,
      },
    );
    const complete = vi.fn();
    const loading = loaders['zh-CN']!().then(complete);
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(secondLoader).toHaveBeenCalledTimes(1);
    expect(otherLanguage).not.toHaveBeenCalled();

    second.resolve({ default: { title: 'theme' } });
    await second.promise;
    expect(complete).not.toHaveBeenCalled();
    first.resolve({ default: { title: 'page' } });
    await loading;
    expect(complete).toHaveBeenCalledWith({
      default: {
        page: { title: 'page' },
        'preferences/theme': { title: 'theme' },
      },
    });
    expect(Object.keys(complete.mock.calls[0]![0].default)).toEqual([
      'page',
      'preferences/theme',
    ]);
  });

  it('rejects a failed batch without publishing partial messages and can retry', async () => {
    const blocked = deferred<{ default: { title: string } }>();
    const failed = deferred<{ default: { title: string } }>();
    const retryable = vi
      .fn()
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValue({ default: { title: 'recovered' } });
    const loaders = loadLocalesMapFromDir(
      /\.\/langs\/([^/]+)\/(.*)\.json$/,
      {
        './langs/zh-CN/first.json': () => blocked.promise,
        './langs/zh-CN/second.json': retryable,
      },
    );
    const loading = loaders['zh-CN']!();
    const rejection = expect(loading).rejects.toThrow('download failed');
    failed.reject(new Error('download failed'));
    await rejection;
    blocked.resolve({ default: { title: 'first' } });
    await expect(loaders['zh-CN']!()).resolves.toEqual({
      default: {
        first: { title: 'first' },
        second: { title: 'recovered' },
      },
    });
  });
});

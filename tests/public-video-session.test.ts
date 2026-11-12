import { beforeEach, describe, expect, it, vi } from 'vitest';

const youtube = {
  source: 'youtube',
  type: 'video',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  videoId: 'abcdefghijk',
};
const tiktok = {
  source: 'tiktok',
  type: 'video',
  url: 'https://www.tiktok.com/@creator/video/1234567890123456789',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  window.localStorage.clear();
});

describe('public video platform sessions', () => {
  it('uses the ordinary YouTube origin and canonical watch URL', async () => {
    const { publicVideo } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    expect(publicVideo(youtube)).toMatchObject({
      platform: 'youtube',
      url: youtube.url,
      embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
    });
    expect(
      publicVideo({
        ...youtube,
        videoId: undefined,
        url: 'https://youtu.be/abcdefghijk',
      })?.embedUrl,
    ).toBe('https://www.youtube.com/embed/abcdefghijk');
  });

  it.each([
    'javascript:alert(1)',
    'http://youtube.com/watch?v=abcdefghijk',
    'https://youtube.com.evil.example/watch?v=abcdefghijk',
    'https://youtube.com@evil.example/watch?v=abcdefghijk',
    'https://user:password@youtube.com/watch?v=abcdefghijk',
    'https://youtube.com:8443/watch?v=abcdefghijk',
  ])('rejects an unsafe or mismatched platform URL: %s', async (url) => {
    const { publicVideo } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    expect(publicVideo({ ...youtube, url })).toBeNull();
  });

  it('does not embed invalid IDs or treat article links as videos', async () => {
    const { publicVideo } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    expect(publicVideo({ ...youtube, videoId: '../login' })?.embedUrl).toBe('');
    expect(publicVideo({ ...youtube, type: 'article' })).toBeNull();
    expect(publicVideo({ ...youtube, source: 'unknown' })).toBeNull();
  });

  it('focuses the same video window and detaches its opener before navigation', async () => {
    const { openPublicVideo, videoWatchMode } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    const target = {
      closed: false,
      opener: window,
      location: { href: '' },
      focus: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockImplementation(() => {
      expect(target.location.href).toBe('');
      return target as unknown as Window;
    });
    expect(openPublicVideo(youtube)).toBe('opened');
    expect(target.opener).toBeNull();
    expect(target.location.href).toBe(youtube.url);
    expect(openPublicVideo(youtube)).toBe('opened');
    expect(target.location.href).toBe(youtube.url);
    expect(open).toHaveBeenCalledTimes(1);
    expect(target.focus).toHaveBeenCalledTimes(2);
    expect(videoWatchMode('youtube')).toBe('platform');
  });

  it('opens a different video without trying to navigate a detached cross-origin window', async () => {
    const { openPublicVideo } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    const first = {
      closed: false,
      opener: null,
      location: { href: '' },
      focus: vi.fn(),
    };
    const second = {
      closed: false,
      opener: null,
      location: { href: '' },
      focus: vi.fn(),
    };
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValueOnce(first as unknown as Window)
      .mockReturnValueOnce(second as unknown as Window);
    expect(openPublicVideo(youtube)).toBe('opened');
    Object.defineProperty(first.location, 'href', {
      set() {
        throw new Error('Cross-origin navigation denied after opener detach');
      },
    });
    expect(openPublicVideo({ ...youtube, videoId: 'zyxwvutsrqp' })).toBe(
      'opened',
    );
    expect(second.location.href).toBe(
      'https://www.youtube.com/watch?v=zyxwvutsrqp',
    );
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('isolates platforms and reopens a closed or COOP-detached window', async () => {
    const { openPublicVideo } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    const makeWindow = () => ({
      closed: false,
      opener: null,
      location: { href: '' },
      focus: vi.fn(),
    });
    const first = makeWindow();
    const other = makeWindow();
    const reopened = makeWindow();
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValueOnce(first as unknown as Window)
      .mockReturnValueOnce(other as unknown as Window)
      .mockReturnValueOnce(reopened as unknown as Window);
    openPublicVideo(youtube);
    openPublicVideo(tiktok);
    first.closed = true;
    openPublicVideo(youtube);
    expect(open.mock.calls.map((call) => call[1])).toEqual([
      '_blank',
      '_blank',
      '_blank',
    ]);
    expect(other.location.href).toBe(tiktok.url);
    expect(reopened.location.href).toBe(youtube.url);
  });

  it('keeps native link fallback and inline preference when a popup is blocked', async () => {
    const { followPublicVideo, videoWatchMode } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    vi.spyOn(window, 'open').mockReturnValue(null);
    const click = new MouseEvent('click', { cancelable: true });
    followPublicVideo(click, youtube);
    expect(click.defaultPrevented).toBe(false);
    expect(videoWatchMode('youtube')).toBe('inline');
  });

  it('preserves modified clicks and only prevents a successfully handled normal click', async () => {
    const { followPublicVideo } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    const target = {
      closed: false,
      opener: null,
      location: { href: '' },
      focus: vi.fn(),
    };
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(target as unknown as Window);
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const event = new MouseEvent('click', { ...init, cancelable: true });
      followPublicVideo(event, youtube);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
    const click = new MouseEvent('click', { cancelable: true });
    followPublicVideo(click, youtube);
    expect(click.defaultPrevented).toBe(true);
  });

  it('persists only platform viewing preferences across module reloads', async () => {
    const { setVideoWatchMode } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    setVideoWatchMode('youtube', 'platform');
    vi.resetModules();
    const { videoWatchMode } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    expect(videoWatchMode('youtube')).toBe('platform');
    expect(videoWatchMode('tiktok')).toBe('inline');
    expect(Object.keys(window.localStorage)).toEqual([
      'hci-public-video-mode:v1:youtube',
    ]);
    expect(
      window.localStorage.getItem('hci-public-video-mode:v1:youtube'),
    ).toBe('platform');
  });

  it('can view videos even when preference storage and programmatic focus fail', async () => {
    const { openPublicVideo, videoWatchMode } =
      await import('../apps/web-antd/src/views/intelligence/public-video-session');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('disabled');
    });
    const target = {
      closed: false,
      opener: null,
      location: { href: '' },
      focus: () => {
        throw new Error('focus blocked');
      },
    };
    vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window);
    expect(openPublicVideo(tiktok)).toBe('opened');
    expect(target.location.href).toBe(tiktok.url);
    expect(videoWatchMode('tiktok')).toBe('platform');
  });
});

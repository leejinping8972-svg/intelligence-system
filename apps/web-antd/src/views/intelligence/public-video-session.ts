import type { ContentItem } from './public-content';

type VideoItem = Pick<ContentItem, 'source' | 'type' | 'url' | 'videoId'>;
export type VideoWatchMode = 'inline' | 'platform';

const platforms = {
  youtube: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  tiktok: { label: 'TikTok', hosts: ['tiktok.com'] },
  instagram: { label: 'Instagram', hosts: ['instagram.com'] },
  facebook: { label: 'Facebook', hosts: ['facebook.com', 'fb.watch'] },
  reddit: { label: 'Reddit', hosts: ['reddit.com'] },
};
const windows = new Map<string, { url: string; window: Window }>();
const modes = new Map<string, VideoWatchMode>();
const modeKey = (platform: string) => `hci-public-video-mode:v1:${platform}`;

export function publicVideo(item?: VideoItem) {
  if (!item || item.type !== 'video') return null;
  const platform = item.source === 'facebook_posts' ? 'facebook' : item.source;
  const config = platforms[platform as keyof typeof platforms];
  if (!config) return null;
  try {
    const url = new URL(item.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !config.hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return null;
    const candidate =
      item.videoId ||
      url.searchParams.get('v') ||
      (url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1]);
    const videoId = /^[\w-]{11}$/.test(candidate || '') ? candidate : '';
    return {
      platform,
      label: config.label,
      url:
        platform === 'youtube' && videoId
          ? `https://www.youtube.com/watch?v=${videoId}`
          : url.href,
      // The ordinary YouTube origin can use the browser's platform cookies.
      // Third-party cookie restrictions can still require first-party viewing.
      embedUrl:
        platform === 'youtube' && videoId
          ? `https://www.youtube.com/embed/${videoId}`
          : '',
    };
  } catch {
    return null;
  }
}

export function videoWatchMode(platform: string): VideoWatchMode {
  try {
    const value = window.localStorage.getItem(modeKey(platform));
    return value === 'platform' ? 'platform' : 'inline';
  } catch {
    return modes.get(platform) || 'inline';
  }
}

export function setVideoWatchMode(platform: string, mode: VideoWatchMode) {
  modes.set(platform, mode);
  try {
    // This is only a viewing preference, never an authentication status/token.
    window.localStorage.setItem(modeKey(platform), mode);
  } catch {
    // Viewing remains available when browser storage is disabled.
  }
}

export function openPublicVideo(item: VideoItem) {
  const video = publicVideo(item);
  if (!video) return 'unsupported';
  const existing = windows.get(video.platform);
  try {
    if (existing?.url === video.url && !existing.window.closed) {
      existing.window.focus();
      setVideoWatchMode(video.platform, 'platform');
      return 'opened';
    }
  } catch {
    // A platform's COOP policy can sever an otherwise live window reference.
  }
  try {
    const target = window.open('', '_blank');
    if (!target) return 'blocked';
    // Detach before first-party navigation. Browsers then prevent this app from
    // navigating that cross-origin window again, so a different video needs a
    // new window. Its first-party platform session cookies are still reused.
    target.opener = null;
    target.location.href = video.url;
    windows.set(video.platform, { url: video.url, window: target });
    try {
      target.focus();
    } catch {
      // Programmatic focus can be disallowed after successful navigation.
    }
  } catch {
    return 'blocked';
  }
  setVideoWatchMode(video.platform, 'platform');
  return 'opened';
}

export function followPublicVideo(event: MouseEvent, item: VideoItem) {
  // Preserve the browser's explicit new-tab/window and download gestures.
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  if (openPublicVideo(item) === 'opened') event.preventDefault();
  // The native link remains the fallback if the popup is blocked/unsupported.
}

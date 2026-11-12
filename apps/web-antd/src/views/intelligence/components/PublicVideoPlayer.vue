<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -- Template wrapping is owned by oxfmt. */
import type { ContentItem } from '../public-content';

import { computed, onUnmounted, ref, watch } from 'vue';

import { Button, message } from 'ant-design-vue';

import {
  openPublicVideo,
  publicVideo,
  setVideoWatchMode,
  videoWatchMode,
} from '../public-video-session';

const props = defineProps<{ item: ContentItem }>();
const video = computed(() => publicVideo(props.item));
const platformMode = ref(false);
const preview = ref(false);
const waiting = ref(false);
const failed = ref(false);
const revision = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;

function stopTimer() {
  clearTimeout(timer);
}
function loadPreview() {
  if (!video.value?.embedUrl) return;
  setVideoWatchMode(video.value.platform, 'inline');
  platformMode.value = false;
  preview.value = true;
  waiting.value = true;
  failed.value = false;
  revision.value++;
  stopTimer();
  timer = setTimeout(() => {
    waiting.value = false;
    failed.value = true;
  }, 12_000);
}
function previewLoaded() {
  stopTimer();
  waiting.value = false;
  // An iframe load does not establish login or successful video playback.
}
function previewFailed() {
  previewLoaded();
  failed.value = true;
}
function openPlatform() {
  if (openPublicVideo(props.item) !== 'opened') {
    message.warning('观看窗口未打开，请允许本站打开新窗口，或使用原平台链接。');
    return;
  }
  platformMode.value = true;
  preview.value = false;
  waiting.value = false;
  failed.value = false;
  stopTimer();
}
watch(
  () => `${props.item.id}:${video.value?.url || ''}`,
  () => {
    platformMode.value = !!(
      video.value && videoWatchMode(video.value.platform) === 'platform'
    );
    preview.value = false;
    waiting.value = false;
    failed.value = false;
    stopTimer();
  },
  { immediate: true },
);
onUnmounted(stopTimer);
</script>

<template>
  <section v-if="video" class="public-video" aria-label="视频观看">
    <div class="video-heading">
      <h3>视频素材</h3>
      <span>{{ video.label }}</span>
    </div>
    <div v-if="preview" class="video-frame">
      <iframe
        :key="revision"
        :src="video.embedUrl"
        :title="`${video.label} 视频预览`"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; fullscreen; picture-in-picture"
        allowfullscreen
        @load="previewLoaded"
        @error="previewFailed"
      ></iframe>
      <span v-if="waiting" class="video-status" role="status"
        >正在连接视频来源…</span
      >
    </div>
    <button
      v-else
      type="button"
      class="video-poster"
      :class="{ 'no-cover': !item.thumbnail }"
      :aria-label="
        platformMode || !video.embedUrl
          ? `在 ${video.label} 观看`
          : '加载视频预览'
      "
      @click="platformMode || !video.embedUrl ? openPlatform() : loadPreview()"
    >
      <img
        v-if="item.thumbnail"
        :src="item.thumbnail"
        :alt="item.title"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <span class="video-cta">{{
        platformMode || !video.embedUrl
          ? `在 ${video.label} 观看 ↗`
          : '加载视频预览'
      }}</span>
    </button>
    <div class="video-actions">
      <Button type="primary" @click="openPlatform"
        >在 {{ video.label }} 观看 ↗</Button
      >
      <Button v-if="video.embedUrl" @click="loadPreview">{{
        preview ? '刷新预览' : '尝试内嵌预览'
      }}</Button>
    </div>
    <p class="video-help">
      首次在
      {{ video.label }}
      窗口完成登录后，同一浏览器会复用该平台的登录状态。登录过期或清除 Cookie
      后需重新登录。
    </p>
    <p v-if="platformMode" class="video-help" role="status">
      已记住优先使用 {{ video.label }} 窗口，其他视频也使用此方式观看。
    </p>
    <p v-else-if="failed" class="video-help" role="status">
      预览连接未确认，可在 {{ video.label }} 窗口观看。
    </p>
    <p v-else class="video-help">
      预览仍提示登录或无法播放时，请使用平台窗口；平台窗口会复用已有登录。
    </p>
  </section>
</template>

<style scoped>
.public-video {
  padding: 24px;
  background: var(--hci-paper);
  border: 1px solid var(--hci-border);
  border-radius: 8px;
}
.video-heading,
.video-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.video-heading {
  justify-content: space-between;
  margin-bottom: 18px;
}
.video-heading h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.video-heading > span,
.video-help {
  font-size: 12px;
  color: var(--hci-muted);
}
.video-poster,
.video-frame {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  background: #111;
  border: 0;
  border-radius: 6px;
}
.video-poster {
  padding: 0;
  cursor: pointer;
}
.video-poster.no-cover {
  min-height: 160px;
  aspect-ratio: auto;
}
.video-poster:focus-visible {
  outline: 3px solid var(--hci-accent);
  outline-offset: 3px;
}
.video-poster img,
.video-frame iframe {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: 0;
}
.video-cta,
.video-status {
  position: absolute;
  right: 12px;
  bottom: 12px;
  left: 12px;
  padding: 8px 12px;
  color: #fff;
  text-align: center;
  background: rgb(0 0 0 / 80%);
  border-radius: 4px;
}
.video-actions {
  margin-top: 16px;
}
.video-help {
  margin: 10px 0 0;
}
@media (max-width: 600px) {
  .public-video {
    padding: 18px;
  }
}
</style>

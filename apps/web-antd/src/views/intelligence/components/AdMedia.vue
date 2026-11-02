<script setup lang="ts">
import type { Ad } from '../data';
import { computed, ref, watch } from 'vue';
import { serverMode } from '../session';
const props = defineProps<{ ad: Ad; expanded?: boolean }>();
const active = ref(0),
  loading = ref(true),
  failed = ref(false),
  imageFailed = ref(false);
watch(
  () => props.ad.id,
  () => {
    active.value = 0;
    loading.value = true;
    failed.value = false;
    imageFailed.value = false;
  },
);
const videos = computed(() => props.ad.videoUrls || []);
function src(kind: 'video' | 'image' | 'poster', index = 0) {
  const values =
    kind === 'video'
      ? props.ad.videoUrls
      : kind === 'poster'
        ? props.ad.videoPosterUrls
        : props.ad.imageUrls;
  const raw = values?.[index];
  if (!raw) return undefined;
  let supported = false;
  try {
    supported = ['fbcdn.net', 'cdninstagram.com'].some((d) =>
      new URL(raw).hostname.endsWith(`.${d}`),
    );
  } catch {}
  return serverMode && supported && /^meta-[A-Z]{2}-\d+$/.test(props.ad.id)
    ? `/api/media?ad=${encodeURIComponent(props.ad.id)}&kind=${kind}&index=${index}`
    : raw;
}
const poster = computed(() => src('poster') || src('image'));
function videoError() {
  if (active.value + 1 < videos.value.length) {
    active.value++;
    loading.value = true;
  } else {
    failed.value = true;
    loading.value = false;
  }
}
</script>
<template>
  <div class="ad-media" :class="{ expanded }">
    <template v-if="videos.length && !failed">
      <video
        :key="`${ad.id}:${active}`"
        :src="src('video', active)"
        :poster="poster"
        controls
        playsinline
        preload="metadata"
        :aria-label="`${ad.brand}广告视频`"
        @loadedmetadata="loading = false"
        @loadeddata="loading = false"
        @error="videoError"
      />
      <span v-if="loading" class="media-loading" role="status"
        >正在读取视频信息…</span
      >
    </template>
    <div v-else-if="failed" class="media-fallback" role="status">
      <img
        v-if="poster && !imageFailed"
        :src="poster"
        alt="广告视频封面"
        @error="imageFailed = true"
      />
      <p>视频暂时无法播放，来源链接可能已失效</p>
      <button
        type="button"
        class="hci-link"
        @click="
          active = 0;
          failed = false;
          loading = true;
        "
      >
        重新加载
      </button>
      <a
        v-if="ad.evidenceUrl"
        :href="ad.evidenceUrl"
        target="_blank"
        rel="noreferrer"
        >查看广告原文</a
      >
    </div>
    <img
      v-else-if="src('image') && !imageFailed"
      :src="src('image')"
      alt="广告原始素材"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="imageFailed = true"
    />
    <div v-else class="media-fallback">
      {{ ad.format }} · 平台未返回可用素材链接
    </div>
  </div>
  <div
    v-if="expanded && ad.imageUrls?.length && videos.length"
    class="media-images"
  >
    <img
      v-for="(_url, i) in ad.imageUrls"
      :key="i"
      :src="src('image', i)"
      :alt="`广告图片素材${i + 1}`"
      loading="lazy"
      referrerpolicy="no-referrer"
    />
  </div>
</template>
<style scoped>
.ad-media {
  position: relative;
  min-height: 220px;
  background: #f3f5f8;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.ad-media > video,
.ad-media > img {
  width: 100%;
  height: 240px;
  object-fit: contain;
}
.ad-media.expanded > video,
.ad-media.expanded > img {
  height: 380px;
}
.media-loading {
  position: absolute;
  top: 12px;
  left: 12px;
  background: #0b122dcc;
  color: white;
  padding: 4px 9px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
}
.media-fallback {
  padding: 20px;
  text-align: center;
  color: #667085;
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}
.media-fallback img {
  width: 100%;
  max-height: 160px;
  object-fit: contain;
}
.media-fallback p {
  width: 100%;
  margin: 0;
}
.media-images {
  display: flex;
  gap: 8px;
  overflow: auto;
  margin: 12px 0;
}
.media-images img {
  height: 140px;
  max-width: 200px;
  object-fit: contain;
}
</style>

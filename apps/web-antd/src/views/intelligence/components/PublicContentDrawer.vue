<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -- Template wrapping is owned by oxfmt. */
/* Hallmark · component: content drawer · genre: research reading · theme: existing intelligence tokens
 * pre-emit critique: P4 H5 E4 S5 R5 V4
 * states: default · hover · focus · active · disabled · loading · error · success
 */
import type { ContentItem } from '../public-content';

import { computed, onUnmounted, reactive, ref, watch } from 'vue';

import { Button, Drawer, Form, Select, Tag } from 'ant-design-vue';

import { canReadArticle } from '../article-details';
import {
  contentCategories,
  contentDate,
  contentScopes,
  contentTypes,
  itemScopes,
} from '../public-content';
import PublicArticleDetails from './PublicArticleDetails.vue';

const props = defineProps<{
  item: ContentItem | undefined;
  saving: boolean;
  submitting: boolean;
  keywordOptions: { value: string; label: string }[];
  productOptions: { value: string; label: string }[];
}>();
const emit = defineEmits<{
  close: [];
  save: [values: Record<string, unknown>];
  transcript: [];
  comments: [];
}>();
const draft = reactive({
  keywordIds: [] as string[],
  productIds: [] as string[],
});
const preview = ref(false);
const previewWaiting = ref(false);
const previewError = ref(false);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
const title = computed(
  () => props.item?.ai?.titleZh || props.item?.title || '公共内容详情',
);
const originalTitle = computed(() =>
  props.item?.ai?.titleZh && props.item.ai.titleZh !== props.item.title
    ? props.item.title
    : '',
);
const sourceHost = computed(() => {
  try {
    return new URL(props.item?.url || '').hostname.replace(/^www\./, '');
  } catch {
    return '来源网站';
  }
});
const relationChanged = computed(
  () =>
    !!props.item &&
    (JSON.stringify(draft.keywordIds) !==
      JSON.stringify(props.item.keywordIds || []) ||
      JSON.stringify(draft.productIds) !==
        JSON.stringify(props.item.productIds || [])),
);
const paragraphs = (value?: string) =>
  (value || '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
function stopPreviewTimer() {
  if (previewTimer) clearTimeout(previewTimer);
}
function loadPreview() {
  preview.value = true;
  previewWaiting.value = true;
  previewError.value = false;
  stopPreviewTimer();
  previewTimer = setTimeout(() => {
    previewWaiting.value = false;
    previewError.value = true;
  }, 12_000);
}
function previewLoaded() {
  stopPreviewTimer();
  previewWaiting.value = false;
}
watch(
  () => props.item?.id,
  () => {
    draft.keywordIds = [...(props.item?.keywordIds || [])];
    draft.productIds = [...(props.item?.productIds || [])];
    preview.value = false;
    previewWaiting.value = false;
    previewError.value = false;
    stopPreviewTimer();
  },
  { immediate: true },
);
onUnmounted(stopPreviewTimer);
</script>

<template>
  <Drawer
    :open="!!item"
    title="公共内容详情"
    width="min(1120px, 100vw)"
    :body-style="{ padding: '0', background: 'var(--hci-subtle)' }"
    :header-style="{ padding: '18px 28px' }"
    :footer-style="{ padding: '16px 24px' }"
    destroy-on-close
    @close="emit('close')"
  >
    <article v-if="item" class="pc-detail">
      <header class="detail-heading">
        <div class="detail-kicker">
          <Tag>{{ contentCategories[item.category] }}</Tag
          ><span>{{ item.sourceLabel }}</span
          ><span class="detail-dot">·</span
          ><span>{{ contentTypes[item.type] }}</span>
        </div>
        <h2>{{ title }}</h2>
        <p v-if="originalTitle" class="detail-original">{{ originalTitle }}</p>
        <div class="detail-byline">
          <span>{{ item.author || '来源未提供作者' }}</span
          ><span>发布于 {{ contentDate(item.publishedAt) }}</span>
        </div>
        <div v-if="itemScopes(item).length" class="detail-scopes">
          <Tag v-for="scope in itemScopes(item)" :key="scope">{{
            contentScopes[scope]
          }}</Tag>
        </div>
      </header>
      <div class="detail-layout">
        <main class="detail-main">
          <section
            v-if="item.source === 'youtube' && item.videoId"
            class="detail-block detail-media"
            aria-label="视频预览"
          >
            <div class="detail-section-head">
              <h3>视频素材</h3>
              <a :href="item.url" target="_blank" rel="noopener noreferrer"
                >原平台观看 ↗</a
              >
            </div>
            <div v-if="preview" class="detail-player">
              <iframe
                :src="`https://www.youtube-nocookie.com/embed/${item.videoId}`"
                title="YouTube 视频预览"
                loading="lazy"
                referrerpolicy="strict-origin-when-cross-origin"
                allowfullscreen
                @load="previewLoaded"
                @error="
                  previewError = true;
                  previewLoaded();
                "
              ></iframe>
              <span v-if="previewWaiting" class="preview-status" role="status"
                >正在连接视频来源…</span
              >
            </div>
            <button
              v-else
              type="button"
              class="detail-poster"
              :class="{ 'no-cover': !item.thumbnail }"
              aria-label="加载视频预览"
              @click="loadPreview"
            >
              <img
                v-if="item.thumbnail"
                :src="item.thumbnail"
                :alt="item.title"
                loading="lazy"
                referrerpolicy="no-referrer"
              /><span class="preview-cta">加载视频预览</span>
            </button>
            <p class="detail-helper">
              {{
                previewError
                  ? '预览连接未确认，可在原平台观看；已保存的文字内容不受影响。'
                  : '视频由原平台提供。加载或播放受限时，可直接打开原平台。'
              }}
            </p>
          </section>
          <section
            v-if="item.summary || !canReadArticle(item)"
            class="detail-block"
          >
            <div class="detail-section-head">
              <h3>
                {{
                  item.type === 'paper'
                    ? '检索摘要'
                    : item.type === 'post'
                      ? '帖子原文'
                      : '来源描述'
                }}
              </h3>
              <span class="detail-label">原始内容</span>
            </div>
            <div v-if="item.summary" class="detail-prose">
              <p v-for="(text, i) in paragraphs(item.summary)" :key="i">
                {{ text }}
              </p>
            </div>
            <p v-else class="detail-empty">
              {{
                canReadArticle(item)
                  ? '检索来源未返回摘要，正文与图表会在下方单独补采。'
                  : '来源未提供描述。可通过下方字幕或原文查看已有内容。'
              }}
            </p>
          </section>
          <div v-if="canReadArticle(item)" class="detail-block detail-article">
            <PublicArticleDetails
              :key="item.id"
              :item="item"
              :show-abstract="!item.summary"
            />
          </div>
          <section v-if="item.source === 'youtube'" class="detail-block">
            <div class="detail-section-head">
              <div>
                <h3>视频字幕</h3>
                <p class="detail-helper">保存来源已有字幕，方便阅读与引用。</p>
              </div>
              <Tag v-if="item.transcript">{{
                item.transcript.text ? '已保存' : '无可用字幕'
              }}</Tag>
            </div>
            <div v-if="item.transcript?.text" class="detail-transcript">
              <p v-for="(text, i) in paragraphs(item.transcript.text)" :key="i">
                {{ text }}
              </p>
            </div>
            <div v-else class="detail-empty">
              <p>
                {{
                  item.transcript
                    ? '来源此次没有返回可用字幕，不等于视频没有声音。'
                    : '当前尚未保存字幕。读取一次可能消耗 ScrapeCreators 请求，不进行音频转写。'
                }}
              </p>
              <Button
                v-if="!item.transcript"
                :loading="submitting"
                @click="emit('transcript')"
                >获取已有字幕</Button
              >
            </div>
          </section>
          <section v-if="item.ai" class="detail-block detail-ai">
            <div class="detail-section-head">
              <h3>AI 中文整理</h3>
              <span class="detail-label">辅助阅读</span>
            </div>
            <div class="detail-prose">
              <p>{{ item.ai.summaryZh }}</p>
              <p>{{ item.ai.reason }}</p>
              <blockquote v-if="item.ai.quote">{{ item.ai.quote }}</blockquote>
            </div>
            <p v-if="item.ai.duplicateOf" class="detail-helper">
              已标记相似内容，原始记录仍保留。
            </p>
          </section>
          <section v-if="item.source === 'reddit'" class="detail-block">
            <div class="detail-section-head">
              <h3>讨论评论</h3>
              <Button
                :loading="submitting"
                :disabled="!!item.comments"
                @click="emit('comments')"
                >{{ item.comments ? '已保存取样' : '读取评论取样' }}</Button
              >
            </div>
            <p class="detail-helper">
              {{
                item.comments?.completeness ||
                '按需读取最多20条顶层评论，可能消耗 ScrapeCreators credits；不自动翻页。'
              }}
            </p>
            <blockquote
              v-for="comment in item.comments?.items || []"
              :key="comment.id"
              class="detail-comment"
            >
              <b>{{ comment.author || '匿名作者' }}</b>
              <p>{{ comment.text }}</p>
              <a
                v-if="comment.url"
                :href="comment.url"
                target="_blank"
                rel="noopener noreferrer"
                >评论原文 ↗</a
              >
            </blockquote>
          </section>
        </main>
        <aside class="detail-aside" aria-label="来源信息与内容关联">
          <section class="detail-block detail-metadata">
            <h3>来源信息</h3>
            <dl>
              <div>
                <dt>原始出处</dt>
                <dd>
                  <a :href="item.url" target="_blank" rel="noopener noreferrer"
                    >{{ sourceHost }} ↗</a
                  >
                </dd>
              </div>
              <div>
                <dt>来源语言</dt>
                <dd>
                  {{ item.language === 'unknown' ? '未提供' : item.language }}
                </dd>
              </div>
              <div>
                <dt>采集日期</dt>
                <dd>{{ contentDate(item.collectedAt) }}</dd>
              </div>
              <div>
                <dt>检索内容覆盖</dt>
                <dd>{{ item.textAvailability || '仅索引' }}</dd>
              </div>
              <div>
                <dt>命中关键词</dt>
                <dd>
                  {{ item.matchedQueries?.join(' / ') || '来源检索匹配' }}
                </dd>
              </div>
              <div v-if="item.doi">
                <dt>DOI</dt>
                <dd>{{ item.doi }}</dd>
              </div>
            </dl>
            <div v-if="item.detailEnrichment" class="detail-enrichment">
              <h4>详情补全记录</h4>
              <p v-for="(entry, kind) in item.detailEnrichment" :key="kind">
                <b>{{ kind === 'detail_transcript' ? '字幕' : '来源详情' }}</b>
                ·
                {{
                  entry.status === 'ready'
                    ? '已补全'
                    : entry.status === 'running'
                      ? '已发起读取'
                      : '未补齐'
                }}<span>{{ entry.reason }}</span>
              </p>
            </div>
            <details class="detail-context">
              <summary>市场与检索依据</summary>
              <p>{{ item.marketBasis || '历史记录的来源地区尚未核实' }}</p>
              <p>
                作者国家：{{
                  item.authorCountry && item.authorCountry !== 'unknown'
                    ? item.authorCountry
                    : '未核实'
                }}
              </p>
              <p>来源机构国家：{{ item.publisherCountry || '未知' }}</p>
              <ul>
                <li
                  v-for="(context, index) in item.searchContexts || []"
                  :key="index"
                >
                  {{ contentScopes[context.scope] }} · {{ context.market }} /
                  {{ context.language }}<br />{{ context.query }}
                </li>
              </ul>
            </details>
          </section>
          <section class="detail-block detail-associations">
            <h3>内容关联</h3>
            <p class="detail-helper">将这份素材整理到关键词或产品下。</p>
            <Form layout="vertical"
              ><Form.Item label="关联关键词"
                ><Select
                  v-model:value="draft.keywordIds"
                  mode="multiple"
                  :options="keywordOptions"
                  show-search
                  option-filter-prop="label"
                  aria-label="内容关联关键词"
                  placeholder="选择关键词" /></Form.Item
              ><Form.Item label="关联产品"
                ><Select
                  v-model:value="draft.productIds"
                  mode="multiple"
                  :options="productOptions"
                  show-search
                  option-filter-prop="label"
                  aria-label="内容关联产品"
                  placeholder="选择产品" /></Form.Item
            ></Form>
          </section>
        </aside>
      </div>
    </article>
    <template #footer
      ><div v-if="item" class="detail-footer">
        <a :href="item.url" target="_blank" rel="noopener noreferrer"
          >{{ item.type === 'video' ? '在原平台观看' : '核对来源原文' }} ↗</a
        >
        <div>
          <Button
            :loading="saving"
            @click="emit('save', { favorite: !item.favorite })"
            >{{ item.favorite ? '取消收藏' : '收藏素材' }}</Button
          ><Button
            type="primary"
            :disabled="!relationChanged"
            :loading="saving"
            @click="
              emit('save', {
                keywordIds: draft.keywordIds,
                productIds: draft.productIds,
              })
            "
            >保存关联</Button
          >
        </div>
      </div></template
    >
  </Drawer>
</template>

<style scoped>
.pc-detail {
  font-size: 14px;
  line-height: 1.65;
  color: var(--hci-ink);
}

.detail-heading {
  padding: 28px 32px 24px;
  background: var(--hci-paper);
  border-bottom: 1px solid var(--hci-border);
}

.detail-kicker,
.detail-byline,
.detail-scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.detail-kicker {
  font-size: 12px;
  color: var(--hci-muted);
}

.detail-kicker :deep(.ant-tag),
.detail-scopes :deep(.ant-tag) {
  margin: 0;
}

.detail-heading h2 {
  margin: 14px 0 12px;
  font-size: 24px;
  font-weight: 650;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.detail-original {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--hci-muted);
  overflow-wrap: anywhere;
}

.detail-byline {
  column-gap: 20px;
  font-size: 13px;
  color: var(--hci-muted);
}

.detail-scopes {
  margin-top: 14px;
}

.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  gap: 24px;
  align-items: start;
  padding: 24px;
}

.detail-main,
.detail-aside {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.detail-aside {
  position: sticky;
  top: 0;
}

.detail-block {
  min-width: 0;
  padding: 24px;
  background: var(--hci-paper);
  border: 1px solid var(--hci-border);
  border-radius: 10px;
}

.detail-block h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
}

.detail-article :deep(h3) {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
}

.detail-article :deep(.article-abstract) {
  font-size: 15px;
  line-height: 1.95;
  overflow-wrap: anywhere;
}

.detail-section-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}

.detail-section-head > * {
  min-width: 0;
}

.detail-section-head > a {
  font-size: 12px;
  white-space: nowrap;
}

.detail-label {
  font-size: 12px;
  color: var(--hci-muted);
  white-space: nowrap;
}

.detail-prose {
  font-size: 15px;
  line-height: 1.95;
  overflow-wrap: anywhere;
}

.detail-prose p {
  max-inline-size: 72ch;
  margin: 0 0 16px;
  white-space: pre-wrap;
}

.detail-prose p:last-child {
  margin-bottom: 0;
}

.detail-helper {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--hci-muted);
}

.detail-empty {
  padding: 16px;
  margin: 0;
  line-height: 1.85;
  color: var(--hci-muted);
  background: var(--hci-subtle);
  border-radius: 6px;
}

.detail-empty p {
  margin: 0 0 12px;
}

.detail-empty p:last-child {
  margin-bottom: 0;
}

.detail-player,
.detail-poster {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16/9;
  overflow: clip;
  background: var(--hci-subtle);
  border: 0;
  border-radius: 6px;
}

.detail-player iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.detail-poster {
  cursor: pointer;
}

.detail-poster.no-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  aspect-ratio: auto;
}

.detail-poster.no-cover .preview-cta {
  position: static;
}

.detail-poster img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.preview-cta,
.preview-status {
  position: absolute;
  bottom: 16px;
  left: 16px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--hci-ink);
  background: var(--hci-paper);
  border: 1px solid var(--hci-border);
  border-radius: 6px;
}

.detail-poster:hover .preview-cta {
  color: var(--hci-accent);
  border-color: var(--hci-accent);
}

.detail-poster:active .preview-cta {
  transform: translateY(1px);
}

.detail-poster:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--hci-accent);
  outline-offset: 4px;
}

.detail-transcript {
  max-height: 460px;
  padding: 18px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.95;
  background: var(--hci-subtle);
  border-radius: 6px;
}

.detail-transcript p {
  margin: 0 0 14px;
  overflow-wrap: anywhere;
}

.detail-prose blockquote,
.detail-comment {
  padding: 14px 18px;
  margin: 16px 0 0;
  overflow-wrap: anywhere;
  background: var(--hci-subtle);
  border-left: 3px solid var(--hci-border);
}

.detail-comment p {
  margin: 10px 0;
  white-space: pre-wrap;
}

.detail-comment a {
  font-size: 12px;
}

.detail-metadata,
.detail-associations {
  padding: 20px;
}

.detail-metadata dl {
  display: grid;
  gap: 18px;
  margin: 22px 0 0;
}

.detail-metadata dt {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--hci-muted);
}

.detail-metadata dd {
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.detail-context {
  padding-top: 16px;
  margin-top: 20px;
  font-size: 12px;
  border-top: 1px solid var(--hci-border);
}

.detail-context summary {
  font-weight: 600;
  cursor: pointer;
}

.detail-context p {
  margin: 12px 0;
  color: var(--hci-muted);
}

.detail-context ul {
  display: grid;
  gap: 10px;
  padding-left: 14px;
  margin: 12px 0 0;
}

.detail-associations :deep(.ant-form) {
  margin-top: 20px;
}

.detail-associations :deep(.ant-form-item) {
  margin-bottom: 18px;
}

.detail-associations :deep(.ant-form-item:last-child) {
  margin-bottom: 0;
}

.detail-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--hci-ink);
}

.detail-footer > div {
  display: flex;
  gap: 10px;
}

.detail-footer a {
  white-space: nowrap;
}

.detail-article {
  padding: 0 24px;
}

.detail-article :deep(.article-reader) {
  padding: 24px 0;
  margin: 0;
  border: 0;
}

.detail-article :deep(.hci-toolbar) {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
}

.detail-article :deep(.hci-subtle) {
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--hci-muted);
}

.detail-enrichment {
  padding-top: 16px;
  margin-top: 20px;
  font-size: 12px;
  border-top: 1px solid var(--hci-border);
}

.detail-enrichment h4 {
  margin: 0 0 12px;
  font-size: 12px;
}

.detail-enrichment p {
  margin: 12px 0;
}

.detail-enrichment span {
  display: block;
  margin-top: 5px;
  color: var(--hci-muted);
}

@media (max-width: 900px) {
  .detail-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail-aside {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 580px) {
  .detail-heading {
    padding: 22px 18px;
  }

  .detail-heading h2 {
    font-size: 20px;
  }

  .detail-layout {
    gap: 16px;
    padding: 16px 12px;
  }

  .detail-block {
    padding: 18px;
  }

  .detail-main,
  .detail-aside {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }

  .detail-footer {
    gap: 14px;
  }

  .detail-footer > div {
    gap: 8px;
  }

  .detail-prose {
    font-size: 14px;
  }

  .detail-article {
    padding: 0 18px;
  }
}
</style>

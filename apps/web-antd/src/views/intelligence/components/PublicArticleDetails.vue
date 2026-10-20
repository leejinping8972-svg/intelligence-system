<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -- Template wrapping is owned by oxfmt. */
import type { ArticleDocument, ArticleSnapshot } from '../article-details';

import { computed, onUnmounted, ref, useId, watch } from 'vue';

import { Alert, Button, Tag } from 'ant-design-vue';

import { articleCoverage } from '../article-details';
import { contentDate, contentRequest } from '../public-content';

const props = defineProps<{
  item: { id: string; title: string; source: string; type: string };
  showAbstract?: boolean;
}>();
const headingId = useId();
const document = ref<ArticleDocument | null>(null);
const state = ref('missing');
const reason = ref('');
const errorMessage = ref('');
const loading = ref(false);
const submitting = ref(false);
const openSections = ref<string[]>([]);
const failedImages = ref(new Set<string>());
const busy = computed(() => ['queued', 'running'].includes(state.value));
const allExpanded = computed(
  () =>
    !!document.value &&
    document.value.sections.every((section) =>
      openSections.value.includes(section.id),
    ),
);
const tables = computed(
  () => new Map(document.value?.tables.map((table) => [table.id, table]) || []),
);
const figures = computed(
  () =>
    new Map(document.value?.figures.map((figure) => [figure.id, figure]) || []),
);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let sequence = 0;
let pendingRequest = '';
const states: Record<string, string> = {
  missing: '尚未补采正文',
  running: '后台补采中',
  queued: '等待补采',
  ready: '正文已保存',
  unavailable: '来源未提供可读正文',
  blocked: '原文访问受限',
  unsupported: '当前格式不支持',
  failed: '本次补采未完成',
  rate_limited: '原文限流',
  interrupted: '补采已中断，可手动重试',
};
function schedule() {
  if (timer) clearTimeout(timer);
  if (busy.value && !disposed)
    timer = setTimeout(() => {
      void refresh();
    }, 1800);
}
async function refresh(auto = false) {
  const current = ++sequence;
  const itemId = props.item.id;
  loading.value = true;
  try {
    const data = await contentRequest<ArticleSnapshot>(
      'server_content_article_get',
      { itemId },
    );
    if (disposed || current !== sequence) return;
    if (data.article?.collectedAt !== document.value?.collectedAt)
      openSections.value =
        data.article?.sections.map((section) => section.id) || [];
    document.value = data.article;
    state.value = data.state;
    reason.value = data.reason;
    errorMessage.value = '';
    if (auto && data.state === 'missing') await collect();
  } catch (error) {
    if (current === sequence && !disposed)
      errorMessage.value =
        error instanceof Error ? error.message : '读取正文状态失败';
  } finally {
    if (current === sequence && !disposed) {
      loading.value = false;
      schedule();
    }
  }
}
async function collect() {
  if (submitting.value || busy.value || document.value) return;
  submitting.value = true;
  errorMessage.value = '';
  const itemId = props.item.id;
  pendingRequest ||= crypto.randomUUID();
  try {
    await contentRequest('server_content_article_submit', {
      itemId,
      requestId: pendingRequest,
    });
    if (disposed || itemId !== props.item.id) return;
    pendingRequest = '';
    await refresh();
  } catch (error) {
    if (!disposed && itemId === props.item.id)
      errorMessage.value =
        error instanceof Error ? error.message : '补采正文提交未完成';
  } finally {
    if (!disposed && itemId === props.item.id) submitting.value = false;
  }
}
function toggleSection(id: string, event: Event) {
  const opened = (event.target as HTMLDetailsElement).open;
  if (opened && !openSections.value.includes(id)) openSections.value.push(id);
  if (!opened)
    openSections.value = openSections.value.filter((value) => value !== id);
}
function toggleAll() {
  openSections.value = allExpanded.value
    ? []
    : document.value?.sections.map((section) => section.id) || [];
}
watch(
  () => props.item.id,
  () => {
    sequence++;
    if (timer) clearTimeout(timer);
    document.value = null;
    state.value = 'missing';
    reason.value = '';
    pendingRequest = '';
    submitting.value = false;
    failedImages.value = new Set();
    void refresh(true);
  },
  { immediate: true },
);
onUnmounted(() => {
  disposed = true;
  sequence++;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section class="article-reader" :aria-labelledby="headingId">
    <div class="hci-toolbar">
      <h3 :id="headingId">文章正文与图表</h3>
      <Tag :color="document ? 'green' : 'blue'">{{
        states[state] || state
      }}</Tag>
      <Button
        v-if="!document"
        size="small"
        :loading="submitting || busy"
        :disabled="busy"
        @click="collect"
        >补采公开正文</Button
      >
      <Button size="small" :loading="loading" @click="refresh(false)"
        >刷新正文状态</Button
      >
    </div>
    <Alert v-if="errorMessage" type="error" show-icon :message="errorMessage" />
    <p v-if="busy" class="hci-subtle" role="status">
      后台正在读取公开正文。无需在原网站点击展开，关闭详情后任务仍继续；不会调用付费模型或采集服务。
    </p>
    <p v-else-if="!document" class="hci-subtle">
      {{
        reason ||
        '新检索会自动补采文章正文；旧记录首次打开时尝试补采。未提供摘要不等于没有全文。'
      }}
    </p>
    <template v-if="document">
      <p class="hci-subtle">
        {{ articleCoverage(document) }} · {{ document.characters }} 字符 ·
        {{ document.sections.length }} 节 · {{ document.tables.length }} 表 ·
        {{ document.figures.length }} 图 · 采集
        {{ contentDate(document.collectedAt) }}
      </p>
      <p class="hci-subtle">{{ document.note }}</p>
      <Alert
        v-if="document.truncated"
        type="warning"
        show-icon
        message="正文或表格达到保留上限，请同时查看原文"
      />
      <p
        v-if="document.abstract && showAbstract !== false"
        class="article-abstract"
      >
        <b>来源摘要：</b>{{ document.abstract }}
      </p>
      <div class="hci-toolbar">
        <Button size="small" @click="toggleAll">{{
          allExpanded ? '全部收起' : '全部展开'
        }}</Button>
        <a :href="document.sourceUrl" target="_blank" rel="noopener noreferrer"
          >核对原文与完整附件</a
        >
      </div>
      <details
        v-for="section in document.sections"
        :key="section.id"
        :open="openSections.includes(section.id)"
        class="article-section"
        @toggle="toggleSection(section.id, $event)"
      >
        <summary>{{ section.heading }}</summary>
        <template v-for="(block, index) in section.blocks" :key="index">
          <p v-if="block.type === 'paragraph'" class="article-paragraph">
            {{ block.text }}
          </p>
          <figure
            v-else-if="block.type === 'figure' && figures.get(block.id || '')"
            class="article-figure"
          >
            <img
              v-if="
                figures.get(block.id || '')?.imageUrl &&
                !failedImages.has(block.id || '')
              "
              :src="figures.get(block.id || '')?.imageUrl"
              :alt="figures.get(block.id || '')?.label"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="failedImages.add(block.id || '')"
            />
            <figcaption>
              <b>{{ figures.get(block.id || '')?.label }}</b>
              {{ figures.get(block.id || '')?.caption }}
            </figcaption>
            <a
              :href="figures.get(block.id || '')?.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              >在原文查看图像</a
            >
          </figure>
          <figure
            v-else-if="block.type === 'table' && tables.get(block.id || '')"
            class="article-table"
          >
            <figcaption>
              <b>{{ tables.get(block.id || '')?.label }}</b>
              {{ tables.get(block.id || '')?.caption }}
            </figcaption>
            <div
              class="article-table-scroll"
              tabindex="0"
              :aria-label="tables.get(block.id || '')?.label"
            >
              <table>
                <tbody>
                  <tr
                    v-for="(row, rowIndex) in tables.get(block.id || '')
                      ?.rows || []"
                    :key="rowIndex"
                  >
                    <component
                      :is="cell.header ? 'th' : 'td'"
                      v-for="(cell, column) in row"
                      :key="column"
                      :colspan="cell.colspan"
                      :rowspan="cell.rowspan"
                      >{{ cell.text }}</component
                    >
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="tables.get(block.id || '')?.notes" class="hci-subtle">
              {{ tables.get(block.id || '')?.notes }}
            </p>
            <p v-if="tables.get(block.id || '')?.truncated" class="hci-subtle">
              此表已截断，请核对来源完整表格。
            </p>
          </figure>
        </template>
      </details>
      <p class="hci-subtle article-license">
        来源授权说明：{{ document.license }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.article-reader {
  padding: 16px 0;
  margin: 16px 0;
  border-top: 1px solid var(--hci-border, #e3e7ed);
  border-bottom: 1px solid var(--hci-border, #e3e7ed);
}

.article-reader h3 {
  margin: 0;
}

.article-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--hci-border, #e3e7ed);
}

.article-section summary {
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.article-paragraph {
  margin: 12px 0;
  font-size: 15px;
  line-height: 1.95;
  overflow-wrap: anywhere;
}

.article-figure,
.article-table {
  margin: 16px 0;
}

.article-figure img {
  max-width: 100%;
  height: auto;
  background: white;
}

.article-figure figcaption,
.article-table figcaption {
  margin: 8px 0;
  line-height: 1.7;
}

.article-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.article-table table {
  min-width: 100%;
  font-size: 13px;
  border-collapse: collapse;
}

.article-table :is(td, th) {
  min-width: 70px;
  padding: 7px;
  white-space: pre-wrap;
  border: 1px solid var(--hci-border, #d9dfe7);
}

.article-license {
  margin-top: 16px;
}

:is(summary, a, button, .article-table-scroll):focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 3px;
}
</style>

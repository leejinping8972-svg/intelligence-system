<script setup lang="ts">
import { ref } from 'vue';

import { Alert, Button, Input, message, Modal, Table } from 'ant-design-vue';

import { cloudRequest, cloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
import { keywordChineseName } from '../keyword-names';
import { adminRequest, serverMode, session } from '../session';

const props = defineProps<{ ids: string[] }>();
const open = ref(false);
const busy = ref(false);
const errorMessage = ref('');
const resultInfo = ref('');
const draft = ref<{ id: string; term: string; termZh: string }[]>([]);
function begin() {
  draft.value = props.ids.flatMap((id) => {
    const item = state.keywords.find((record) => record.id === id);
    return item && item.dataNature !== 'demo'
      ? [{ id: item.id, term: item.term, termZh: keywordChineseName(item) }]
      : [];
  });
  errorMessage.value = '';
  resultInfo.value = '';
  open.value = true;
}
async function translate() {
  busy.value = true;
  errorMessage.value = '';
  try {
    const result = await adminRequest<{
      items: { id: string; termZh: string }[];
      model: string;
      usage: { total_tokens?: number };
    }>(
      'server_keyword_names',
      { ids: draft.value.map((item) => item.id) },
      100_000,
    );
    for (const item of result.items) {
      const row = draft.value.find((entry) => entry.id === item.id);
      if (row) row.termZh = item.termZh;
    }
    resultInfo.value = `${result.model} · ${result.usage.total_tokens === undefined ? '服务商未返回用量' : `${result.usage.total_tokens} tokens`}，请校对后保存`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '翻译失败，未自动重试';
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (
    draft.value.some(
      (item) =>
        !state.keywords.some(
          (record) => record.id === item.id && record.term === item.term,
        ),
    )
  ) {
    errorMessage.value = '关键词已变化，请关闭后重新选择';
    return;
  }
  busy.value = true;
  errorMessage.value = '';
  try {
    const updates = draft.value.map((item) => ({
      id: item.id,
      patch: { termZh: item.termZh.trim() },
    }));
    await cloudRequest('server_patch_keywords', { updates });
    for (const item of updates) {
      const record = state.keywords.find((entry) => entry.id === item.id);
      if (record) record.termZh = item.patch.termZh;
    }
    message.success('中文名称已保存，原词与研究数据保持不变');
    open.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button
    :title="ids.length > 50 ? '每次最多50个，请缩小选择范围' : '校对并保存中文名称'"
    :disabled="
      !serverMode || !cloudWorkspace.ready || !ids.length || ids.length > 50
    "
    @click="begin"
    >
中文名称（{{ ids.length }}）
</Button>
  <Modal
    v-model:open="open"
    title="中文名称校对"
    width="min(820px, 100vw)"
    :confirm-loading="busy"
    :closable="!busy"
    :keyboard="!busy"
    :mask-closable="!busy"
    :cancel-button-props="{ disabled: busy }"
    :ok-button-props="{ disabled: busy || !draft.length }"
    ok-text="保存中文名称"
    @ok="save"
  >
    <p class="hci-subtle">
      原文保留。默认参考译名使用本地词表，未知品牌/专有词保留原文；可手动校对。每次最多50个，不截断筛选结果。
    </p>
    <Button
      :disabled="busy || session.user?.role !== 'admin'"
      :loading="busy"
      @click="translate"
      >
使用已配置模型翻译（按模型计费）
</Button>
    <p class="hci-subtle">
      仅点击此按钮才请求模型；一次请求、不自动重试。生成后需校对并保存。
    </p>
    <Alert v-if="errorMessage" :message="errorMessage" type="error" show-icon />
    <p v-if="resultInfo" role="status">{{ resultInfo }}</p>
    <Table
      size="small"
      :data-source="draft"
      row-key="id"
      :columns="[
        { title: '原关键词', key: 'term', width: '45%' },
        { title: '中文名称', key: 'termZh' },
      ]"
      :pagination="false"
      :scroll="{ y: 400 }"
    >
      <template #bodyCell="{ column, record }">
        <span v-if="column.key === 'term'">{{ record.term }}</span>
        <Input
          v-else
          v-model:value="record.termZh"
          :disabled="busy"
          :maxlength="255"
          :aria-label="`${record.term}的中文名称`"
          placeholder="填写中文名称，留空恢复本地参考译名"
        />
      </template>
    </Table>
  </Modal>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import {
  Alert,
  Button,
  Input,
  message,
  Modal,
  Table,
  Tag,
} from 'ant-design-vue';

import AnalysisSettings from './components/AnalysisSettings.vue';
import PageHeader from './components/PageHeader.vue';
import { adminRequest, serverMode } from './session';
interface Prompt {
  key: string;
  label: string;
  purpose: string;
  text: string;
  version: string;
  defaultText: string;
  systemContract: string;
  updatedAt?: string;
  updatedBy?: string;
}
const busy = ref(false);
  const error = ref('');
  const prompts = ref<Prompt[]>([]);
  const selected = ref<Prompt>();
  const text = ref('');
async function load() {
  try {
    prompts.value = (
      await adminRequest<{ prompts: Prompt[] }>('server_ai_prompts')
    ).prompts;
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  }
}
function edit(p: Prompt) {
  selected.value = p;
  text.value = p.text;
  error.value = '';
}
async function save() {
  if (!selected.value) return;
  busy.value = true;
  error.value = '';
  try {
    await adminRequest('server_ai_prompt_save', {
      key: selected.value.key,
      text: text.value,
      version: selected.value.version,
    });
    selected.value = undefined;
    await load();
    message.success('提示词已保存，后续新分析使用此版本');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  if (serverMode) void load();
});
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="AI 配置"
      description="统一配置模型接口及各类内容的生成提示词。保存配置不会发起模型调用。"
    />
    <AnalysisSettings v-if="serverMode" />
    <section class="hci-panel">
      <h2>内容提示词</h2>
      <p class="hci-subtle">
        修改影响后续新分析；已提交的消费者 /
        广告报告保留提交时版本。固定输出结构与证据校验规则由系统保留。
      </p>
      <Table
        size="small"
        row-key="key"
        :data-source="prompts"
        :pagination="false"
        :scroll="{ x: 720 }"
        :columns="[
          { title: '使用场景', dataIndex: 'label', width: 180 },
          { title: '生成内容', dataIndex: 'purpose' },
          { title: '版本 / 更新', key: 'version', width: 230 },
          { title: '操作', key: 'action', width: 120 },
        ]"
        >
<template #bodyCell="{ column, record }">
<template v-if="column.key === 'version'">
<Tag>{{ record.version }}</Tag>
            <p class="hci-subtle">
              {{
                record.updatedAt
                  ? new Date(record.updatedAt).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })
                  : '系统默认'
              }}
              · {{ record.updatedBy }}
            </p>
</template><Button
            v-else-if="column.key === 'action'"
            @click="edit(record as Prompt)"
            >
编辑提示词
</Button>
</template>
</Table>
    </section>
    <Alert v-if="error && !selected" type="error" :message="error" show-icon />
    <Modal
      :open="!!selected"
      :title="selected?.label"
      :width="860"
      :confirm-loading="busy"
      :closable="!busy"
      :mask-closable="false"
      ok-text="保存提示词"
      @cancel="selected = undefined"
      @ok="save"
      >
<template v-if="selected">
<p>配置生成内容和表达方式（广告100～12000字，其他20～12000字）</p>
        <Input.TextArea
          v-model:value="text"
          :rows="12"
          :maxlength="12000"
          :disabled="busy"
          aria-label="AI提示词"
/><Button
          :disabled="busy"
          @click="text = selected.defaultText"
          >
填入系统默认
</Button>
        <details>
          <summary>固定输出结构与证据规则</summary>
          <p class="contract">{{ selected.systemContract }}</p>
        </details>
        <Alert v-if="error" type="error" :message="error" show-icon />
</template>
</Modal>
  </main>
</template>
<style scoped>
.contract {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

details {
  margin-top: 16px;
}
</style>

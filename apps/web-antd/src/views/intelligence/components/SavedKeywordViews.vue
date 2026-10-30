<script setup lang="ts">
import type { KeywordViewFilters, SavedKeywordView } from '../keyword-views';
import { ref, watch } from 'vue';
import { IconifyIcon } from '@vben/icons';
import { Button, Input, message, Modal, Select, Tooltip } from 'ant-design-vue';
import { adminRequest, serverMode, session } from '../session';
const props = defineProps<{ filters: KeywordViewFilters }>();
const emit = defineEmits<{ apply: [filters: KeywordViewFilters] }>();
const views = ref<SavedKeywordView[]>([]);
const selected = ref<string>();
const busy = ref(false), open = ref(false), name = ref(''), error = ref('');
const editing = ref(false);
let ticket = 0;
async function load() {
  const token = ++ticket;
  const account = session.user?.id;
  if (!serverMode || !account) return;
  try {
    const result = await adminRequest<{ views: SavedKeywordView[] }>('server_keyword_views_list');
    if (token !== ticket || session.user?.id !== account) return;
    views.value = result.views;
    error.value = '';
    if (!views.value.some(view => view.id === selected.value)) selected.value = undefined;
  } catch (cause) {
    if (token === ticket) error.value = (cause as Error).message;
  }
}
watch(() => session.user?.id, () => {
  ticket++; views.value = []; selected.value = undefined; open.value = false; busy.value = false;
  void load();
}, { immediate: true });
function apply(value: unknown) {
  const id = typeof value === 'string' ? value : undefined;
  const view = views.value.find(view => view.id === id);
  if (view) emit('apply', JSON.parse(JSON.stringify(view.filters)));
}
function begin(update: boolean) {
  editing.value = update;
  name.value = update ? views.value.find(view => view.id === selected.value)?.name || '' : '';
  open.value = true;
}
async function save() {
  if (busy.value || !name.value.trim()) return;
  const account = session.user?.id;
  const view = views.value.find(view => view.id === selected.value);
  busy.value = true;
  try {
    const result = await adminRequest<{ view: SavedKeywordView }>('server_keyword_views_save', {
      ...(editing.value && view ? { id: view.id, revision: view.revision } : {}),
      name: name.value.trim(), filters: props.filters,
    });
    if (account !== session.user?.id) return;
    views.value = [result.view, ...views.value.filter(view => view.id !== result.view.id)];
    selected.value = result.view.id;
    open.value = false;
    message.success('视图已保存到当前账号');
  } catch (cause) {
    if (account === session.user?.id) { message.error((cause as Error).message); void load(); }
  } finally { if (account === session.user?.id) busy.value = false; }
}
function remove() {
  const view = views.value.find(view => view.id === selected.value);
  const account = session.user?.id;
  if (!view) return;
  Modal.confirm({
    title: `删除视图“${view.name}”？`, okText: '删除', cancelText: '取消',
    async onOk() {
      if (account !== session.user?.id) return;
      try {
        await adminRequest('server_keyword_views_delete', { id: view.id, revision: view.revision });
        if (account === session.user?.id) { selected.value = undefined; await load(); }
      } catch (cause) {
        if (account === session.user?.id) { message.error((cause as Error).message); await load(); }
      }
    },
  });
}
</script>
<template>
  <div class="hci-toolbar saved-keyword-views">
    <Select v-model:value="selected" placeholder="已保存视图" aria-label="已保存的关键词视图" :options="views.map(view => ({ label: view.name, value: view.id }))" style="width: 200px" allow-clear @change="apply" @dropdown-visible-change="value => { if (value) load(); }" />
    <Tooltip title="保存为新视图"><Button :disabled="!serverMode || !session.user" aria-label="保存为新视图" @click="begin(false)"><IconifyIcon icon="lucide:folder-plus" />保存新视图</Button></Tooltip>
    <Tooltip title="用当前筛选更新所选视图"><Button :disabled="!selected" aria-label="更新所选视图" @click="begin(true)"><IconifyIcon icon="lucide:save" /></Button></Tooltip>
    <Tooltip title="删除所选视图"><Button :disabled="!selected" aria-label="删除所选视图" @click="remove"><IconifyIcon icon="lucide:trash-2" /></Button></Tooltip>
    <span v-if="error" role="alert" class="hci-error">{{ error }}</span>
  </div>
  <Modal v-model:open="open" :title="editing ? '更新视图' : '保存新视图'" :confirm-loading="busy" :ok-button-props="{ disabled: !name.trim() }" ok-text="保存" cancel-text="取消" @ok="save">
    <Input v-model:value="name" placeholder="视图名称" aria-label="视图名称" :maxlength="60" @press-enter="save" />
  </Modal>
</template>

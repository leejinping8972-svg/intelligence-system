<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Select, Table } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { defaultPersonaPlan } from '../persona-research';
const emit = defineEmits<{ submitted: [id: string] }>();
const open = ref(false), busy = ref(false), error = ref('');
const plan = reactive(defaultPersonaPlan());
watch(plan, () => { preview.value = undefined; }, { deep: true });
watch(() => plan.market, () => { for (const g of plan.groups) g.localContext = ''; });
const preview = ref<{ queries: { id: string; topic: string; query: string; identityQuery: string }[]; configured: boolean; estimatedRequests: number }>();
async function check() {
  busy.value = true; error.value = '';
  try { preview.value = await cloudRequest('server_persona_preview', { plan }); }
  catch (e) { error.value = e instanceof Error ? e.message : '预览失败'; }
  finally { busy.value = false; }
}
const requestId = ref('');
async function submit() {
  busy.value = true; error.value = '';
  requestId.value ||= crypto.randomUUID();
  try { const r = await cloudRequest<{ id: string }>('server_persona_submit', { plan, requestId: requestId.value }); open.value = false; requestId.value = ''; emit('submitted', r.id); }
  catch (e) { error.value = e instanceof Error ? e.message : '提交失败'; }
  finally { busy.value = false; }
}
</script>
<template>
  <Button @click="open = true">从人群画像研究</Button>
  <Modal v-model:open="open" title="人群画像研究" :width="980" :footer="null" :mask-closable="false">
    <div class="persona-form" @input="preview = undefined">
      <Alert v-if="error" type="error" :message="error" show-icon />
      <label>报告名称<Input v-model:value="plan.title" /></label>
      <label>国家<Select v-model:value="plan.market" :options="[{label:'越南',value:'VN'},{label:'美国',value:'US'},{label:'墨西哥',value:'MX'}]" @change="preview = undefined" /></label>
      <div class="two"><label>开始日期<Input v-model:value="plan.startDate" type="date" /></label><label>结束日期<Input v-model:value="plan.endDate" type="date" /></label></div>
      <label>研究问题<Input.TextArea v-model:value="plan.researchQuestion" :rows="3" /></label>
      <fieldset v-for="(g,i) in plan.groups" :key="i"><legend>人群 {{ i + 1 }}</legend>
        <label>人群名称<Input v-model:value="g.label" /></label>
        <div class="two"><label>最低年龄<InputNumber v-model:value="g.minAge" :min="18" :max="90" /></label><label>最高年龄<InputNumber v-model:value="g.maxAge" :min="g.minAge" :max="90" /></label></div>
        <label>生命阶段<Input v-model:value="g.lifeStage" /></label><label>家庭角色<Input v-model:value="g.familyRole" /></label>
        <label>当地语言检索语境（留空按画像生成）<Input v-model:value="g.localContext" /></label>
        <Button v-if="plan.groups.length > 1" danger @click="plan.groups.splice(i,1); preview = undefined">移除此人群</Button>
      </fieldset>
      <Button :disabled="plan.groups.length >= 6" @click="plan.groups.push({label:'',minAge:28,maxAge:35,lifeStage:'',familyRole:'',localContext:''}); preview = undefined">增加人群</Button>
      <Checkbox.Group v-model:value="plan.sources" :options="[{label:'公开内容',value:'content'},{label:'公开视频评论',value:'comments'},{label:'TikTok Shop商品',value:'products'}]" @change="preview = undefined" />
      <div class="two"><label>补采请求上限<InputNumber v-model:value="plan.budget.requests" :min="0" :max="60" /></label><label>采集credits上限<InputNumber v-model:value="plan.budget.credits" :min="0" :max="60" /></label><label>评论视频上限<InputNumber v-model:value="plan.budget.commentVideos" :min="0" :max="10" /></label><label>每层保留上限<InputNumber v-model:value="plan.budget.perQuery" :min="1" :max="30" /></label></div>
      <Alert type="info" message="0次请求为仅复用。画像是招募条件；年龄、家庭身份及决策权须分别核实。单次补采仅取首页，无法确认扣费即停止。" />
      <Button :loading="busy" @click="check">核对采样计划</Button>
      <template v-if="preview">
        <p>计划请求最多 {{ preview.estimatedRequests }} 次 · 既有采集配置 {{ preview.configured ? '已配置' : '未配置' }}</p>
        <Table size="small" row-key="id" :data-source="preview.queries" :pagination="{pageSize:5}" :scroll="{x:700}" :columns="[{title:'层',dataIndex:'id',width:120},{title:'主题',dataIndex:'topic',width:140},{title:'当地语言关键词',dataIndex:'query'},{title:'年龄自述缺口词（人工定向使用）',dataIndex:'identityQuery'}]" />
        <Button type="primary" :loading="busy" @click="submit">保存并开始研究</Button>
      </template>
    </div>
  </Modal>
</template>
<style scoped>
.persona-form { display: grid; gap: 14px; }
label { display: grid; gap: 6px; min-width: 0; }
fieldset { display: grid; gap: 12px; padding: 14px; border: 1px solid #d9d9d9; }
.two { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
@media(max-width:600px) { .two { grid-template-columns: minmax(0,1fr); } }
</style>

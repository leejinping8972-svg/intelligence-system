<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Tooltip,
  message,
} from 'ant-design-vue';
import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { markets, state } from '../data';
import { serverMode } from '../session';
const props = defineProps<{
  terms?: string[];
  market?: string;
  disabled?: boolean;
  disabledReason?: string;
  label?: string;
}>();
const open = ref(false),
  busy = ref(false),
  errorMessage = ref('');
const router = useRouter();
const disabledMessage = computed(() =>
  !serverMode ? '请在服务器版使用平台商品采集' : props.disabledReason || '',
);
const form = reactive({
  terms: '',
  market: 'US',
  providers: ['sorftime', 'semrush', 'tiktok_shop'],
  maxProducts: 100,
  perKeyword: 20,
  maxRequests: 150,
  completeAll: false,
  maxDetailProducts: 20,
  maxDomains: 3,
  semrushUnitLimit: 2000,
  enrich: true,
  trend: true,
});
const parsedTerms = computed(() => [
  ...new Set(
    form.terms
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]);
const expected = computed(
  () =>
    parsedTerms.value.length *
    ((form.providers.includes('sorftime')
      ? Math.ceil(form.perKeyword / 20)
      : 0) +
      (form.providers.includes('semrush') ? 1 + form.maxDomains : 0) +
      (form.providers.includes('tiktok_shop') ? 1 : 0)),
);
let requestId = '',
  signature = '';
function show() {
  form.terms = (props.terms || []).join('\n');
  form.market = props.market || (state.market === 'ALL' ? 'US' : state.market);
  if (form.market === 'VN')
    form.providers = form.providers.filter((provider) => provider !== 'sorftime');
  open.value = true;
  errorMessage.value = '';
  requestId = '';
  signature = '';
}
async function submit() {
  errorMessage.value = '';
  if (parsedTerms.value.length === 0 || parsedTerms.value.length > 100) {
    errorMessage.value = '请输入1～100个关键词，每行一个';
    return;
  }
  if (form.providers.length === 0) {
    errorMessage.value = '请选择至少一个来源';
    return;
  }
  if (form.market === 'VN' && form.providers.includes('sorftime')) {
    errorMessage.value = 'Sorftime Amazon 不支持越南，请取消此来源';
    return;
  }
  if (
    form.maxRequests > 0 &&
    form.maxRequests < parsedTerms.value.length * form.providers.length
  ) {
    errorMessage.value = `本次有${parsedTerms.value.length}个词、${form.providers.length}个来源，基础发现至少需要${parsedTerms.value.length * form.providers.length}次处理额度；请调整上限或减少关键词。`;
    return;
  }
  busy.value = true;
  try {
    const current = JSON.stringify(form);
    const submitted = JSON.parse(current);
    if (current !== signature) {
      requestId = crypto.randomUUID();
      signature = current;
    }
    await syncCloudWorkspace();
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_platform_products',
      { ...submitted, requestId },
    );
    requestId = '';
    signature = '';
    open.value = false;
    message.success('平台商品任务已提交后台，关闭页面后继续执行');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '提交失败，表单已保留';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Tooltip :title="disabledMessage" :trigger="['hover', 'focus']">
    <span
      :tabindex="disabled || !serverMode ? 0 : undefined"
      :aria-label="disabledMessage || undefined"
      style="display: inline-flex"
    >
      <Button
        :disabled="disabled || !serverMode"
        type="primary"
        @click="show"
        >{{ label || '按词获取平台商品' }}</Button
      >
    </span>
  </Tooltip>
  <Modal
    v-model:open="open"
    title="从平台获取商品与决策指标"
    :width="760"
    :confirm-loading="busy"
    :closable="!busy"
    :mask-closable="!busy"
    :cancel-button-props="{ disabled: busy }"
    ok-text="提交后台采集"
    @ok="submit"
  >
    <Alert
      type="info"
      show-icon
      message="商品直接取自平台，不先抓整站。Sorftime 搜 Amazon，Semrush 查 Google Shopping，ScrapeCreators 搜 TikTok Shop；每条数据分别保留来源与采集时间。"
    />
    <Form layout="vertical" :disabled="busy" style="margin-top: 16px">
      <Form.Item label="关键词（每行一个，最多100个）"
        ><Input.TextArea
          v-model:value="form.terms"
          :rows="4"
          placeholder="creatine gummies"
      /></Form.Item>
      <Form.Item label="目标市场"
        ><Select
          v-model:value="form.market"
          :options="markets.map((m) => ({ label: m.name, value: m.code }))"
      /></Form.Item>
      <Form.Item label="数据来源"
        ><Checkbox.Group
          v-model:value="form.providers"
          :options="[
            {
              label: 'Sorftime · Amazon',
              value: 'sorftime',
              disabled: form.market === 'VN',
            },
            { label: 'Semrush · Google Shopping', value: 'semrush' },
            { label: 'ScrapeCreators · TikTok Shop', value: 'tiktok_shop' },
          ]"
      /></Form.Item>
      <div class="platform-form-grid">
        <Form.Item label="每词每来源商品上限"
          ><InputNumber v-model:value="form.perKeyword" :min="1" :max="100"
        /></Form.Item>
        <Form.Item label="整批商品总数上限"
          ><InputNumber v-model:value="form.maxProducts" :min="1" :max="1000"
        /></Form.Item>
        <Form.Item label="发现与补全共用请求上限"
          ><InputNumber v-model:value="form.maxRequests" :min="1" :max="100000"
        /></Form.Item>
        <Form.Item label="商品详情补全数量上限"
          ><InputNumber
            v-model:value="form.maxDetailProducts"
            :min="0"
            :max="1000"
          />
        </Form.Item>
        <Form.Item label="Semrush 每词商家数上限"
          ><InputNumber
            v-model:value="form.maxDomains"
            :min="1"
            :max="5"
            :disabled="!form.providers.includes('semrush')"
        /></Form.Item>
        <Form.Item label="Semrush API units 上限（0为关闭）"
          ><InputNumber
            v-model:value="form.semrushUnitLimit"
            :min="0"
            :max="100000"
            :disabled="!form.providers.includes('semrush')"
        /></Form.Item>
      </div>
      <Form.Item label="补全范围"
        ><Checkbox v-model:checked="form.completeAll"
          >补全全部已发现商品（会显著增加请求）</Checkbox
        >
        ><Checkbox v-model:checked="form.enrich">商品详情与图片/属性</Checkbox
        ><Checkbox v-model:checked="form.trend"
          >ASIN月销量、大类排名与评论数历史</Checkbox
        ></Form.Item
      >
    </Form>
    <p class="hci-subtle">
      {{ parsedTerms.length }} 个词；基础发现参考约
      {{ expected }}
      次数据请求；过滤不相关商品可能追加翻页。发现与补全共用 {{ form.maxRequests }} 次预算；默认最多补全 {{ form.maxDetailProducts }} 件，勾选“补全全部”后仍受共用预算约束。相同查询优先复用缓存。
    </p>
    <p class="hci-subtle">
      Sorftime 与 TikTok Shop 消耗现有平台额度，Semrush 按报告行消耗 API units；次数、credits 和 units 不是同一单位。TikTok 销量只保存为采集时点累计快照。不会购买额度；缺历史、配方或剂量时记录平台返回情况，可在商品库再次补全。
    </p>
    <Alert v-if="errorMessage" :message="errorMessage" type="error" show-icon />
  </Modal>
</template>
<style scoped>
.platform-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
@media (width < 600px) {
  .platform-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

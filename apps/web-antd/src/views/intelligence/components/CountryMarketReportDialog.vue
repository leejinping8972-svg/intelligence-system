<script setup lang="ts">
import { reactive, ref } from 'vue';

import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Select,
  Switch,
} from 'ant-design-vue';

import { cloudRequest } from '../cloud-workspace';
import { marketOptions } from '../data';

defineProps<{ hideTrigger?: boolean }>();
const emit = defineEmits<{ submitted: [id: string] }>();
const open = ref(false);
const busy = ref(false);
const form = reactive({
  market: 'VN',
  period: 'month',
  endDate: new Date().toISOString().slice(0, 10),
  title: '',
  researchFocus: '',
  analyze: true,
});

async function submit() {
  busy.value = true;
  try {
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_market_report',
      {
        ...form,
        requestId: crypto.randomUUID(),
      },
    );
    open.value = false;
    emit('submitted', result.jobId);
    message.success('国家市场报告已提交，系统正在冻结数据快照');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '提交失败');
  } finally {
    busy.value = false;
  }
}
defineExpose({ begin: () => { open.value = true; } });
import CollectionEstimate from './CollectionEstimate.vue';
</script>
<template>
  <Button v-if="!hideTrigger" type="primary" @click="open = true">生成国家市场报告</Button>
  <Modal
    v-model:open="open"
    title="生成国家市场商品与消费者报告"
    :confirm-loading="busy"
    width="680px"
    @ok="submit"
  >
    <Form layout="vertical">
      <div class="market-report-grid">
        <Form.Item label="国家市场" required>
          <Select
            v-model:value="form.market"
            :options="marketOptions.filter((item) => item.value !== 'ALL')"
          />
        </Form.Item>
        <Form.Item label="报告周期" required>
          <Select
            v-model:value="form.period"
            :options="[
              { label: '周报（最近7天）', value: 'week' },
              { label: '月报（最近31天）', value: 'month' },
              { label: '季报（最近92天）', value: 'quarter' },
            ]"
          />
        </Form.Item>
      </div>
      <Form.Item label="截止日期" required>
        <Input v-model:value="form.endDate" type="date" />
      </Form.Item>
      <Form.Item label="报告标题">
        <Input
          v-model:value="form.title"
          placeholder="留空时按国家和周期自动命名"
          :maxlength="160"
        />
      </Form.Item>
      <Form.Item label="本次重点关注">
        <Input.TextArea
          v-model:value="form.researchFocus"
          :rows="3"
          :maxlength="2000"
          placeholder="例如：女性睡眠补充剂、价格带、内容切入点与独立站承接"
        />
      </Form.Item>
      <Form.Item label="大模型分析">
        <Switch v-model:checked="form.analyze" />
        <span class="hci-subtle report-hint"
          >未配置模型时仍会生成冻结快照和确定性统计</span
        >
      </Form.Item>
    </Form>
    <CollectionEstimate
      v-if="open"
      :input="{ kind: 'market_analysis', ...form }"
    />
  </Modal>
</template>
<style scoped>
.market-report-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.report-hint {
  margin-left: 10px;
}

@media (max-width: 640px) {
  .market-report-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Button, Form, Input, message, Switch } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { state } from '../data';
import { serverMode, session } from '../session';
defineProps<{ embedded?: boolean }>();
const emit = defineEmits<{ saved: [] }>();
const market = computed(() => (state.market === 'ALL' ? 'US' : state.market));
const config = ref({
  market: market.value,
  enabled: false,
  monthlyHistory: true,
  time: '01:00',
  lastJobId: '',
});
const error = ref('');
const busy = ref(false);
const router = useRouter();
const editable = computed(() => serverMode && session.user?.role === 'admin');
async function load() {
  if (!serverMode) return;
  const current = market.value;
  try {
    const result = await cloudRequest<{ config: typeof config.value }>(
      'server_product_watch_config',
      { market: current },
    );
    if (current === market.value) {
      config.value = {
        ...result.config,
        monthlyHistory: true,
      };
      error.value = '';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  }
}
async function save() {
  busy.value = true;
  try {
    await cloudRequest('server_product_watch_save', {
      ...config.value,
      market: market.value,
    });
    message.success('商品持续监控已保存');
    emit('saved');
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
async function run() {
  busy.value = true;
  try {
    const result = await cloudRequest<{ jobId: string }>(
      'server_product_watch_run',
      { market: market.value },
    );
    await router.push({
      path: '/monitor',
      query: { tab: 'tasks', job: result.jobId },
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
watch(market, load, { immediate: true });
defineExpose({ refresh: load });
</script>
<template>
  <section class="watch-panel">
    <h3>商品持续监控</h3>
    <p>
      每天更新{{
        market
      }}新品池内全部可识别的平台商品（通过Sorftime更新），包括历史入池商品；新入池商品自动纳入下一轮。保存价格、来源销量及商品资料变化。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon />
    <Form layout="inline" :model="config" @finish="save">
      <Form.Item label="每天执行（北京时间）"
        ><Input
          v-model:value="config.time"
          type="time"
          :disabled="!editable || busy"
      /></Form.Item>
      <Form.Item label="启用"
        ><Switch v-model:checked="config.enabled" :disabled="!editable || busy"
      /></Form.Item>
      <Button
        html-type="submit"
        type="primary"
        :disabled="!editable"
        :loading="busy"
        >保存监控</Button
      >
      <Button :disabled="!editable" :loading="busy" @click="run"
        >立即运行今日任务</Button
      >
      <Button
        v-if="config.lastJobId"
        type="link"
        @click="
          router.push({
            path: '/monitor',
            query: { tab: 'tasks', job: config.lastJobId },
          })
        "
        >最近任务</Button
      >
    </Form>
    <p class="hci-subtle">
      默认01:00，可调整。每商品每日最多查询一次详情；Amazon额外查询一次每日销量。重复提交返回同一天任务，未知请求不会自动重放。趋势在商品详情的“持续观察趋势”查看。
      历史月销量与月销售额默认采集，无需单独开启；新品池内Amazon商品首次及每隔7天各查询一次，消耗Sorftime额度。现有监控从下一轮新建任务开始采集；已创建的当日任务不追加查询，打开详情仅查看已保存数据。
    </p>
  </section>
</template>
<style scoped>
.watch-panel {
  margin: 16px 0 24px;
  padding: 16px;
  border: 1px solid var(--hci-border, #e5e7eb);
  border-radius: 8px;
}
.watch-panel p {
  line-height: 1.7;
  margin: 8px 0 16px;
}
.watch-panel :deep(.ant-form) {
  gap: 12px;
}
@media (max-width: 600px) {
  .watch-panel :deep(.ant-form) {
    flex-direction: column;
    align-items: stretch;
  }
  .watch-panel :deep(.ant-form-item) {
    margin-inline-end: 0;
  }
}
</style>

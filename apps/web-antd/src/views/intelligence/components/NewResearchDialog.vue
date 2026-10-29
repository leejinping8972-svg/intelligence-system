<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Modal } from 'ant-design-vue';
import { serverMode, session } from '../session';
import type { Keyword } from '../data';
import ConsumerReportDialog from './ConsumerReportDialog.vue';
import CountryMarketReportDialog from './CountryMarketReportDialog.vue';
import PersonaResearchDialog from './PersonaResearchDialog.vue';
const props = defineProps<{ keywords?: Keyword[]; productIds?: string[]; siteIds?: string[] }>();
const emit = defineEmits<{ submitted: [] }>();
const router = useRouter();
const open = ref(false);
const consumer = ref<InstanceType<typeof ConsumerReportDialog>>();
const persona = ref<InstanceType<typeof PersonaResearchDialog>>();
const market = ref<InstanceType<typeof CountryMarketReportDialog>>();
function choose(type: string) {
  open.value = false;
  if (type === 'product') void router.push({ path: '/product-research', query: { product: props.productIds?.[0] } });
  if (type === 'consumer') void consumer.value?.begin();
  if (type === 'persona') persona.value?.begin();
  if (type === 'market') market.value?.begin();
}
function submitted(id?: string) { emit('submitted'); if (id) void router.push('/consumer-insights/reports/' + encodeURIComponent(id)); }
</script>
<template>
  <Button type="primary" @click="open = true">＋ 新建研究</Button>
  <Modal v-model:open="open" title="新建研究" :footer="null" :width="660">
    <p class="hci-subtle">选择研究对象，继续设置研究范围和采集计划。</p>
    <div class="research-type-grid">
      <button type="button" @click="choose('product')"><strong>商品研究</strong><span>从一个品出发，查询不同市场的候选商品、销售证据与消费者讨论。</span></button>
      <button type="button" :disabled="!serverMode || session.user?.role !== 'admin'" @click="choose('persona')"><strong>人群研究</strong><span>按年龄、家庭角色和生活场景配置人群画像与采样计划。</span><small v-if="session.user?.role !== 'admin'">管理员可发起画像采集</small></button>
      <button type="button" :disabled="!serverMode" @click="choose('market')"><strong>市场研究</strong><span>选国家和时间范围，生成市场商品与消费者报告。</span></button>
      <button type="button" :disabled="!serverMode" @click="choose('consumer')"><strong>消费者话题研究</strong><span>沿用关键词、商品和独立站关联，采集公开讨论。</span></button>
    </div>
  </Modal>
  <ConsumerReportDialog ref="consumer" hide-trigger :keywords="keywords" :product-ids="productIds" :site-ids="siteIds" @submitted="submitted()" />
  <PersonaResearchDialog v-if="session.user?.role === 'admin'" ref="persona" hide-trigger @submitted="submitted" />
  <CountryMarketReportDialog ref="market" hide-trigger @submitted="submitted" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Button, Empty, Input, message, Select, Tag } from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import { audit, inMarket, marketName, state } from './data';
const status = ref('pending');
const selectedId = ref('');
const value = ref('');
const reason = ref('');
const cases = computed(() =>
  state.reviews.filter((r) => {
    const product = state.products.find((p) => p.id === r.productId);
    return (
      Boolean(product && inMarket(product.market)) &&
      (status.value === 'ALL' || r.status === status.value)
    );
  }),
);
const selected = computed(
  () => cases.value.find((r) => r.id === selectedId.value) || cases.value[0],
);
const product = computed(() =>
  state.products.find((p) => p.id === selected.value?.productId),
);
watch(
  () => selected.value?.id,
  () => {
    value.value = selected.value?.proposed || '';
    reason.value = '';
  },
  { immediate: true },
);
function decide(decision: 'approved' | 'rejected') {
  const review = selected.value;
  const target = product.value;
  if (!review || !target) return;
  const reviewReason = reason.value.trim();
  const confirmedValue = value.value.trim();
  if (!reviewReason) {
    message.warning('请填写审核理由，便于后续追溯');
    return;
  }
  if (decision === 'approved' && !confirmedValue) {
    message.warning('请填写确认值，或选择驳回');
    return;
  }
  const before = target[review.field];
  if (decision === 'approved') {
    target[review.field] = confirmedValue;
    target.reviewed = true;
  }
  review.reason = reviewReason;
  review.status = decision;
  audit(
    decision === 'approved' ? '确认商品字段' : '驳回提取建议',
    `${target.title} / ${before} → ${decision === 'approved' ? confirmedValue : '保留原值'} / ${reviewReason}`,
    target.market,
  );
  message.success('审核结果已保存在本浏览器');
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="人工审核"
      description="让每一处修改有证据、有理由，也有迹可循。"
    >
      <Select
        v-model:value="status"
        :options="[
          { label: '待审核', value: 'pending' },
          { label: '已确认', value: 'approved' },
          { label: '已驳回', value: 'rejected' },
          { label: '全部状态', value: 'ALL' },
        ]"
        style="width: 140px"
      />
    </PageHeader>
    <div class="hci-review-layout">
      <aside>
        <p class="hci-subtle" style="margin-bottom: 12px">
          {{ cases.length }} 项审核记录
        </p>
        <button
          v-for="item in cases"
          :key="item.id"
          class="hci-review-item"
          :class="[{ selected: selected?.id === item.id }]"
          @click="selectedId = item.id"
        >
          <Tag :color="item.status === 'pending' ? 'orange' : 'green'">
            {{
              item.status === 'pending'
                ? '剂量待核验'
                : item.status === 'approved'
                  ? '已确认'
                  : '已驳回'
            }}
          </Tag>
          <h3 style="margin: 10px 0 5px">
            {{ state.products.find((p) => p.id === item.productId)?.title }}
          </h3>
          <p class="hci-subtle">
            {{
              marketName(
                state.products.find((p) => p.id === item.productId)!.market,
              )
            }}
            · 商品字段冲突
          </p>
        </button>
      </aside>
      <section class="hci-panel">
        <Empty v-if="!selected" description="当前没有待处理记录" /><template
          v-else-if="product"
        >
          <div class="hci-panel-head">
            <div>
              <h2>{{ product.title }}</h2>
              <p>{{ product.brand }} · 每份剂量 · 待审核证据</p>
            </div>
            <Tag color="orange">需要人工判断</Tag>
          </div>
          <div class="hci-diff">
            <div>
              <p class="hci-subtle">原记录值</p>
              <h3 style="margin-top: 8px">{{ selected.current }}</h3>
            </div>
            <div>
              <p class="hci-subtle">提取建议值</p>
              <h3 style="margin-top: 8px">{{ selected.proposed }}</h3>
            </div>
          </div>
          <h3>原文证据</h3>
          <div class="hci-evidence">
            {{ selected.quote }}<br /><span class="hci-subtle">来源摘录 · 请返回商品证据页核验</span>
          </div>
          <template v-if="selected.status === 'pending'">
            <label style="display: block; margin: 20px 0 8px">最终确认值</label><Input v-model:value="value" aria-label="最终确认值" /><label
              style="display: block; margin: 20px 0 8px"
              >审核理由 <span class="hci-negative">*</span></label><Input.TextArea
              v-model:value="reason"
              :rows="3"
              placeholder="例如：原记录将每2粒的剂量误写为每粒，按标签每份值修正。"
              aria-label="审核理由"
            />
            <div style="display: flex; gap: 12px; margin-top: 22px">
              <Button type="primary" @click="decide('approved')">
                确认并保存
</Button><Button danger @click="decide('rejected')">驳回建议</Button>
            </div>
</template><template v-else>
            <Tag color="green">此项已处理</Tag>
            <p style="margin-top: 15px">审核理由：{{ selected.reason }}</p>
          </template>
          <p class="hci-subtle" style="margin-top: 18px">
            当前审核结果保存在本浏览器。服务端权限、多人并发控制和历史恢复将在后端阶段实现。
          </p>
        </template>
      </section>
    </div>
  </main>
</template>

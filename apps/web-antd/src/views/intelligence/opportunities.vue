<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Button,
  Checkbox,
  Empty,
  message,
  Modal,
  Pagination,
  Alert,
  Tabs,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import ProductText from './components/ProductText.vue';
import {
  download,
  filteredKeywords,
  filteredProducts,
  filteredSites,
  marketName,
  state,
} from './data';
import { useStatistics } from './statistics-queries';
import { serverMode } from './session';
import { opportunityRows } from './statistics-engine';
import type { OpportunityRow } from './statistics-engine';
import { opportunityChineseName, opportunityOriginalNote } from './opportunity-text';
const router = useRouter();
const tab = ref('concept');
const savedOnly = ref(false);
const page = ref(1), pageSize = ref(20);
watch(() => [state.market, tab.value, savedOnly.value], () => { page.value = 1; });
const remote = useStatistics<OpportunityRow>(computed(() => ({ kind: 'opportunities', market: state.market, tab: tab.value, page: page.value, pageSize: pageSize.value, ...(savedOnly.value ? { saved: state.savedOpportunities } : {}) })));
watch(remote.pagination, value => { page.value = value.page; });
const selected = ref<OpportunityRow>();
watch(
  () => state.market,
  () => {
    selected.value = undefined;
  },
);
const tabs = [
  {
    key: 'concept', label: '产品概念',
    source: '来自商品库中已采集或人工导入的商品品类。',
    rule: '按品类字段的完整文本分组，统计每组商品数，按样本数从多到少排列；字段为空时归为“待补充”。',
    limit: '目前是品类样本归纳，不会自动生成新产品方案，也不代表需求或商业机会已验证。',
  },
  {
    key: 'keyword', label: '热门关键词',
    source: '来自关键词研究中已保存的关键词及其趋势增长值。',
    rule: '只展示增长值大于20的关键词；缺失增长值时不入选。沿用原记录的趋势来源和统计周期。',
    limit: '不是按搜索量排序的热搜榜，也不会在打开页签时补抓趋势。不同来源和周期的增长值需要分别核实。',
  },
  {
    key: 'ingredient', label: '成分观察',
    source: '来自商品库中已采集或人工整理的成分字段。',
    rule: '按成分字段的完整文本分组，统计每组商品数，按样本数从多到少排列；字段为空时归为“待补充”。',
    limit: '目前不会拆分复方成分或合并同义名称。样本数不代表成分热度、剂量有效性或科学功效。',
  },
  {
    key: 'claim', label: '营销卖点',
    source: '来自商品库中已采集或人工整理的卖点文案字段。',
    rule: '按卖点字段的完整文本分组，统计每组商品数，按样本数从多到少排列；字段为空时归为“待补充”。',
    limit: '文案相近但文字不同的记录不会自动合并。这里反映竞品表达，不代表宣传内容已获得科学或合规验证。',
  },
  {
    key: 'site', label: '成长型站点',
    source: '来自独立站库中已保存的站点，以及商品库中与这些站点关联的商品。',
    rule: '列出当前市场的站点，按站点ID统计关联商品数；没有关联商品的站点也会显示。',
    limit: '目前没有按流量、销售额或增长率筛选，也没有成长排名。“成长型”是研究方向名称，不能据此认定站点正在增长。',
  },
  {
    key: 'new', label: '新发现商品',
    source: '来自商品库中已采集或人工导入的商品记录。',
    rule: '目前列出当前市场的全部商品样本，每条记录算1项；未按首次发现时间、上架时间或“竞品上新”事件筛选。',
    limit: '可能包含历史商品和不同链接的同款记录。新发现不等于新上市，也不等同于新品池中的“新上架商品”。',
  },
];
const rows = computed(() => {
  const output = serverMode ? remote.rows.value : opportunityRows({ products: filteredProducts.value, keywords: filteredKeywords.value, sites: filteredSites.value }, tab.value);
  return output.filter(
    (r) => !savedOnly.value || state.savedOpportunities.includes(r.title),
  ).map(row => ({ ...row, titleZh: opportunityChineseName(row.title, row.titleZh, tab.value) || undefined }));
});
function save(title: string) {
  const index = state.savedOpportunities.indexOf(title);
  if (index === -1) state.savedOpportunities.push(title);
  else state.savedOpportunities.splice(index, 1);
}
function report() {
  if (!selected.value) return;
  const original = opportunityOriginalNote(selected.value.title, selected.value.titleZh)
    || (selected.value.titleZh && selected.value.titleZh !== selected.value.title ? `原文：${selected.value.title}` : '');
  download(
    `研究摘要-${tab.value}.txt`,
    `${state.branding.appName} · 研究摘要\n研究方向：${selected.value.titleZh || selected.value.title}${original ? `\n${original}` : ''}\n市场：${marketName(state.market)}\n关联记录：${selected.value.count}项\n状态：待验证\n\n观察：${selected.value.description}\n\n假设：这一方向可能值得进一步调研，尚未达到自动确认门槛。\n数据缺口：独立来源、真实配方、持续观察历史、广告或销售证据。\n后续动作：补充资料并完成人工审核。`,
  );
  message.success('研究摘要已导出');
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="机会研究"
      description="把零散信号整理成可讨论、可验证的研究方向。"
    >
      <Checkbox v-model:checked="savedOnly">仅看收藏</Checkbox>
    </PageHeader>
    <div class="hci-demo-note">
      <b>先看证据，再看结论</b>当前不预置机会结论。只有真实采集或人工导入的数据达到证据门槛后，才会形成候选方向。
    </div>
    <section class="hci-panel">
      <Tabs v-model:active-key="tab">
        <Tabs.TabPane
          v-for="item in tabs"
          :key="item.key"
        >
          <template #tab>
            <span class="opportunity-tab">
              {{ item.label }}
              <Tooltip :trigger="['hover', 'focus']" :overlay-style="{ maxWidth: 'min(380px, calc(100vw - 32px))' }">
                <template #title>
                  <div class="opportunity-help-text">
                    <p><b>数据来源：</b>{{ item.source }}</p>
                    <p><b>整理规则：</b>{{ item.rule }}</p>
                    <p><b>判断边界：</b>{{ item.limit }}</p>
                    <p>按所选市场读取已入库数据，服务端在每天北京时间09:00后更新统计快照；实际刷新可能延迟。查看说明不会触发额外采集。</p>
                  </div>
                </template>
                <button
                  type="button"
                  class="opportunity-help"
                  :aria-label="`${item.label}抓取逻辑说明`"
                  @click.stop
                  @keydown.stop
                >?</button>
              </Tooltip>
            </span>
          </template>
        </Tabs.TabPane>
</Tabs><Empty v-if="!rows.length" description="暂无符合条件的研究方向" />
      <Alert v-if="remote.error.value" type="error" :message="remote.error.value" show-icon />
      <p v-if="serverMode && remote.loading.value" role="status">正在加载研究方向…</p>
      <article
        v-for="(row, i) in rows"
        :key="row.id"
        class="hci-opportunity"
      >
        <div>
          <div style="display: flex; gap: 12px; align-items: center">
            <span class="hci-subtle">{{ String(i + 1).padStart(2, '0') }}</span>
            <h3><ProductText :text="row.title" :translated="row.titleZh" :original-note="opportunityOriginalNote(row.title, row.titleZh)" /></h3>
            <Tag color="orange">待验证</Tag>
          </div>
          <p class="hci-subtle" style="margin: 12px 0">{{ row.description }}</p>
          <span class="hci-subtle">{{ row.count }} 项关联样本 · 真实来源尚未接入</span>
        </div>
        <div style="display: flex; gap: 12px; align-items: center">
          <button
            class="hci-favorite"
            :aria-label="`收藏${row.titleZh || row.title}`"
            @click="save(row.title)"
          >
            {{
              state.savedOpportunities.includes(row.title) ? '★' : '☆'
            }}
</button><Button @click="selected = row">研究详情</Button>
        </div>
      </article>
      <Pagination v-if="serverMode" v-model:current="page" v-model:page-size="pageSize" :total="remote.total.value" show-size-changer :page-size-options="['20', '50', '100']" />
    </section>
    <Modal
      :open="!!selected"
      title="研究方向与证据缺口"
      :width="720"
      :footer="null"
      @cancel="selected = undefined"
    >
      <template v-if="selected">
        <h2 style="margin: 16px 0; font-size: 22px"><ProductText :text="selected.title" :translated="selected.titleZh" :original-note="opportunityOriginalNote(selected.title, selected.titleZh)" /></h2>
        <Tag color="orange">待验证 · 未参与机会排名</Tag>
        <div class="hci-evidence">
          <b>已整理的观察</b><br />{{ selected.description }}<br />关联
          {{ selected.count }} 项关联记录，仍需核对来源覆盖和反向证据。
        </div>
        <h3>研究假设</h3>
        <p style="margin: 10px 0 20px">
          这个方向是否存在持续的消费需求，以及差异化的配方或定位空间？
        </p>
        <h3>反向证据与缺口</h3>
        <p style="margin: 10px 0 20px">
          真实搜索趋势、独立来源、广告活跃历史均未接入；现有样本不足以支持增长、销量或盈利判断。
        </p>
        <div style="display: flex; gap: 12px">
          <Button
            type="primary"
            @click="
              router.push('/research?new=1');
              selected = undefined;
            "
          >
            继续研究
</Button><Button @click="report">导出研究摘要</Button>
        </div>
      </template>
    </Modal>
  </main>
</template>

<style scoped>
.opportunity-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.opportunity-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  cursor: help;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}
.opportunity-help:hover,
.opportunity-help:focus-visible {
  color: #2563eb;
}
.opportunity-help:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.opportunity-help-text {
  font-size: 13px;
  line-height: 1.7;
}
.opportunity-help-text p {
  margin: 0 0 8px;
}
.opportunity-help-text p:last-child {
  margin-bottom: 0;
}
</style>

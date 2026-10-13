<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Button,
  Tabs,
  Tag,
  Modal,
  Checkbox,
  Empty,
  message,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import {
  state,
  filteredProducts,
  filteredKeywords,
  filteredSites,
  download,
  marketName,
} from './data';
const router = useRouter();
const tab = ref('concept');
const savedOnly = ref(false);
const selected = ref<{ title: string; count: number; description: string }>();
watch(
  () => state.market,
  () => {
    selected.value = undefined;
  },
);
const tabs = [
  { key: 'concept', label: '产品概念' },
  { key: 'keyword', label: '热门关键词' },
  { key: 'ingredient', label: '成分观察' },
  { key: 'claim', label: '营销卖点' },
  { key: 'site', label: '成长型站点' },
  { key: 'new', label: '新发现商品' },
];
const rows = computed(() => {
  let output: { title: string; count: number; description: string }[] = [];
  if (tab.value === 'keyword')
    output = filteredKeywords.value
      .filter((k) => (k.growth || 0) > 20)
      .map((k) => ({
        title: `${k.term} · ${k.market}`,
        count: 1,
        description: `${k.category} · 同市场趋势上升示例，仍需独立来源验证。`,
      }));
  else if (tab.value === 'site')
    output = filteredSites.value.map((s) => ({
      title: s.brand,
      count: state.products.filter((p) => p.siteId === s.id).length,
      description: `${marketName(s.market)} · 目前只有首次样本，尚不能确认持续成长。`,
    }));
  else if (tab.value === 'new')
    output = filteredProducts.value.map((p) => ({
      title: p.title,
      count: 1,
      description: `${p.brand} · ${marketName(p.market)} · 新发现不等于新上市。`,
    }));
  else {
    const grouped = new Map<string, number>();
    for (const p of filteredProducts.value) {
      const key =
        tab.value === 'ingredient'
          ? p.ingredient
          : tab.value === 'claim'
            ? p.claim
            : p.category;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    output = [...grouped].map(([title, count]) => ({
      title,
      count,
      description:
        tab.value === 'claim'
          ? '竞品文案表达示例，不能据此认定科学功效。'
          : '已整理关联商品样本，建议补充趋势、配方与市场反馈。',
    }));
  }
  return output.filter(
    (r) => !savedOnly.value || state.savedOpportunities.includes(r.title),
  );
});
function save(title: string) {
  const index = state.savedOpportunities.indexOf(title);
  if (index >= 0) state.savedOpportunities.splice(index, 1);
  else state.savedOpportunities.push(title);
}
function report() {
  if (!selected.value) return;
  download(
    `研究摘要-${tab.value}-演示.txt`,
    `知衡情报 · 演示研究摘要\n研究方向：${selected.value.title}\n市场：${marketName(state.market)}\n样本：${selected.value.count}项演示记录\n状态：待验证\n\n观察：${selected.value.description}\n\n假设：这一方向可能值得进一步调研，尚未通过真实数据验证。\n反向证据：目前未接入真实趋势、广告和销售数据，不能确认需求增长。\n数据缺口：独立来源、真实配方、持续观察历史和来源许可。\n后续动作：补充资料，审核字段，再开展真实研究。\n\n全部内容来自虚构演示样本，不构成市场事实。`,
  );
  message.success('演示摘要已导出');
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="机会研究"
      description="把零散信号整理成可讨论、可验证的研究方向。"
      ><Checkbox v-model:checked="savedOnly">仅看收藏</Checkbox></PageHeader
    >
    <div class="hci-demo-note">
      <b>先看证据，再看结论</b
      >当前全部为演示样本，未达到真实评分门槛，统一显示“待验证”。
    </div>
    <section class="hci-panel">
      <Tabs v-model:active-key="tab"
        ><Tabs.TabPane
          v-for="item in tabs"
          :key="item.key"
          :tab="item.label" /></Tabs
      ><Empty v-if="!rows.length" description="暂无符合条件的研究方向" />
      <article
        v-for="(row, i) in rows"
        :key="row.title"
        class="hci-opportunity"
      >
        <div>
          <div style="display: flex; align-items: center; gap: 12px">
            <span class="hci-subtle">{{ String(i + 1).padStart(2, '0') }}</span>
            <h3>{{ row.title }}</h3>
            <Tag color="orange">待验证</Tag>
          </div>
          <p class="hci-subtle" style="margin: 12px 0">{{ row.description }}</p>
          <span class="hci-subtle"
            >{{ row.count }} 项关联样本 · 真实来源尚未接入</span
          >
        </div>
        <div style="display: flex; align-items: center; gap: 12px">
          <button
            class="hci-favorite"
            :aria-label="`收藏${row.title}`"
            @click="save(row.title)"
          >
            {{
              state.savedOpportunities.includes(row.title) ? '★' : '☆'
            }}</button
          ><Button @click="selected = row">研究详情</Button>
        </div>
      </article>
    </section>
    <Modal
      :open="!!selected"
      title="研究方向与证据缺口"
      :width="720"
      :footer="null"
      @cancel="selected = undefined"
      ><template v-if="selected"
        ><h2 style="font-size: 22px; margin: 16px 0">{{ selected.title }}</h2>
        <Tag color="orange">待验证 · 未参与机会排名</Tag>
        <div class="hci-evidence">
          <b>已整理的观察</b><br />{{ selected.description }}<br />关联
          {{ selected.count }} 项虚构样本，不能作为真实市场事实。
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
            >继续研究</Button
          ><Button @click="report">导出演示摘要</Button>
        </div></template
      ></Modal
    >
  </main>
</template>

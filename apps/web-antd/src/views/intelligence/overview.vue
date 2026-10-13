<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Tag, Select } from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import Chart from './components/Chart.vue';
import {
  state,
  markets,
  filteredProducts,
  filteredKeywords,
  filteredSites,
  pendingReviews,
  marketName,
} from './data';
import { trendOption } from './charts';
const router = useRouter();
const selectedTerm = ref('k1');
const keyword = computed(
  () =>
    filteredKeywords.value.find((k) => k.id === selectedTerm.value) ||
    filteredKeywords.value[0],
);
const stats = computed(() => [
  {
    title: '在研关键词',
    value: filteredKeywords.value.length,
    note: '按国家保留独立观察',
    icon: '⌕',
    route: '/research',
  },
  {
    title: '竞品独立站',
    value: filteredSites.value.length,
    note: '去重后的站点档案',
    icon: '◎',
    route: '/sites',
  },
  {
    title: '已发现商品',
    value: filteredProducts.value.length,
    note: '包含不同配方与规格',
    icon: '▦',
    route: '/products',
  },
  {
    title: '待审核事项',
    value: pendingReviews.value.length,
    note: '字段冲突与信息补证',
    icon: '☷',
    route: '/reviews',
  },
]);
const mapOptions = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (p: any) => {
      const m = markets.find((m) => m.english === p.name);
      return m
        ? `${m.name}：${state.products.filter((x) => x.market === m.code).length} 个演示商品`
        : '后续开放市场';
    },
  },
  geo: {
    map: 'hci-world',
    roam: false,
    top: 10,
    bottom: 0,
    left: 0,
    right: 0,
    silent: false,
    itemStyle: { areaColor: '#ecf0f0', borderColor: '#fff', borderWidth: 0.7 },
    emphasis: { label: { show: false }, itemStyle: { areaColor: '#cadfd8' } },
    regions: markets.map((m) => ({
      name: m.english,
      itemStyle: {
        areaColor:
          state.market === m.code || state.market === 'ALL'
            ? m.color
            : '#bfd5ce',
      },
    })),
  },
  series: [
    {
      type: 'scatter',
      coordinateSystem: 'geo',
      symbolSize: 9,
      itemStyle: { color: '#163d35', borderColor: '#fff', borderWidth: 2 },
      label: {
        show: true,
        position: 'right',
        formatter: '{b}',
        fontSize: 11,
        color: '#46665c',
      },
      data: [
        { name: '美国', value: [-100, 39] },
        { name: '墨西哥', value: [-102, 23] },
        { name: '越南', value: [106, 17] },
      ],
    },
  ],
}));
function selectMarket(name: string) {
  const m = markets.find((m) => m.name === name || m.english === name);
  if (m) state.market = m.code;
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="把市场信号，变成下一步行动"
      description="从需求变化到竞品动态，在一处完成你的选品研究。"
      ><Button @click="router.push('/imports')">导入数据</Button
      ><Button type="primary" @click="router.push('/research?new=1')"
        >＋ 新建研究</Button
      ></PageHeader
    >
    <div class="hci-demo-note">
      <b>演示工作区</b
      >以下品牌、商品、趋势与指标均为虚构样本，用于体验交互；尚未接入真实数据源。
    </div>
    <div class="hci-stats">
      <button
        v-for="s in stats"
        :key="s.title"
        class="hci-stat"
        @click="router.push(s.route)"
      >
        <div class="hci-stat-label">
          {{ s.title }}<span>{{ s.icon }}</span>
        </div>
        <div class="hci-stat-value">
          {{ s.value
          }}<span
            style="
              font-size: 12px;
              font-weight: 400;
              margin-left: 8px;
              color: var(--hci-muted);
            "
            >项</span
          >
        </div>
        <div class="hci-stat-foot">{{ s.note }}</div>
      </button>
    </div>
    <div class="hci-two-col">
      <section class="hci-panel">
        <div class="hci-panel-head">
          <div>
            <h2>市场版图</h2>
            <p>首批覆盖 3 个市场 · 点击地图切换国家</p>
          </div>
          <button class="hci-link" @click="state.market = 'ALL'">
            查看全部
          </button>
        </div>
        <Chart :options="mapOptions" map @select="selectMarket" />
        <div class="hci-map-legend">
          <span v-for="m in markets" :key="m.code"
            ><i class="hci-market-dot" :style="{ background: m.color }"></i
            >{{ m.name }}</span
          ><span>其他市场暂未开放</span>
        </div>
      </section>
      <section class="hci-panel">
        <div class="hci-panel-head">
          <div>
            <h2>市场研究概况</h2>
            <p>商品样本分布，不代表市场规模</p>
          </div>
          <Tag>演示</Tag>
        </div>
        <button
          v-for="m in markets"
          :key="m.code"
          class="hci-market-row"
          style="width: 100%; text-align: left"
          @click="state.market = m.code"
        >
          <span class="hci-market-code">{{ m.code }}</span>
          <div class="hci-market-detail">
            <b>{{ m.name }}</b>
            <div class="hci-subtle">{{ m.language }} · {{ m.currency }}</div>
          </div>
          <div>
            <b>{{ state.products.filter((p) => p.market === m.code).length }}</b
            ><span class="hci-subtle"> 个商品 →</span>
          </div>
        </button>
        <div
          style="
            margin-top: 22px;
            padding: 17px;
            background: var(--hci-green-soft);
            border-radius: 8px;
          "
        >
          <h3>从一个关键词开始</h3>
          <p class="hci-subtle" style="margin: 6px 0 12px">
            试试 probiotic、inositol 或你关注的成分。
          </p>
          <button class="hci-link" @click="router.push('/research?new=1')">
            开启一次研究 →
          </button>
        </div>
      </section>
    </div>
    <div class="hci-two-col">
      <section class="hci-panel">
        <div class="hci-panel-head">
          <div>
            <h2>需求趋势观察</h2>
            <p>同一关键词、同一国家的90天相对指数</p>
          </div>
          <Select
            :value="keyword?.id"
            :options="
              filteredKeywords.map((k) => ({
                label: `${k.term} · ${k.market}`,
                value: k.id,
              }))
            "
            style="width: 230px; max-width: 100%"
            @change="(value: any) => (selectedTerm = value)"
          />
        </div>
        <Chart v-if="keyword" :options="trendOption(keyword)" />
        <p class="hci-subtle">演示曲线 · 不跨国家或批次比较绝对需求</p>
      </section>
      <section class="hci-panel">
        <div class="hci-panel-head">
          <h2>值得继续研究</h2>
          <button class="hci-link" @click="router.push('/opportunities')">
            全部机会 →
          </button>
        </div>
        <div
          v-for="(k, i) in filteredKeywords
            .filter((k) => k.growth && k.growth > 25)
            .slice(0, 4)"
          :key="k.id"
          class="hci-market-row"
        >
          <span class="hci-subtle">0{{ i + 1 }}</span>
          <div class="hci-market-detail">
            <button
              class="hci-table-title"
              @click="
                router.push({ path: '/trends', query: { keyword: k.id } })
              "
            >
              {{ k.term }}
            </button>
            <div class="hci-subtle">
              {{ marketName(k.market) }} · {{ k.category }}
            </div>
          </div>
          <Tag color="orange">待验证</Tag>
        </div>
        <p class="hci-subtle" style="margin-top: 20px">
          补充广告和独立来源后，再判断是否形成机会。
        </p>
      </section>
    </div>
    <div class="hci-demo-footer">
      <span>知衡情报 · 用证据连接关键词、品牌与商品</span
      ><span>演示样本日期：2026-10-13</span>
    </div>
  </main>
</template>

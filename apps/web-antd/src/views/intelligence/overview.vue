<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Alert, Button, Select, Tag } from 'ant-design-vue';
import { serverMode } from './session';
import { useOverviewSnapshot } from './workspace-queries';

import { trendOption } from './charts';
import Chart from './components/Chart.vue';
import PageHeader from './components/PageHeader.vue';
import {
  filteredKeywords,
  filteredProducts,
  filteredSites,
  marketName,
  markets,
  pendingReviews,
  state,
} from './data';
const router = useRouter();
const overview = useOverviewSnapshot();
const overviewKeywords = computed(() => serverMode ? overview.snapshot.value?.topKeywords || [] : filteredKeywords.value);
const count = (key: 'keywords' | 'products' | 'reviews' | 'sites') => serverMode ? overview.snapshot.value?.counts[key] ?? '—' : ({ keywords: filteredKeywords.value.length, sites: filteredSites.value.length, products: filteredProducts.value.length, reviews: pendingReviews.value.length })[key];
const productCount = (market: string) => serverMode ? overview.snapshot.value?.productMarkets[market] ?? '—' : state.products.filter((p) => p.market === market).length;
const selectedTerm = ref('k1');
const keyword = computed(
  () =>
    overviewKeywords.value.find((k) => k.id === selectedTerm.value) ||
    overviewKeywords.value[0],
);
const stats = computed(() => [
  {
    title: '在研关键词',
    value: count('keywords'),
    note: '按国家保留独立观察',
    icon: '⌕',
    route: '/research',
  },
  {
    title: '竞品独立站',
    value: count('sites'),
    note: '去重后的站点档案',
    icon: '◎',
    route: '/sites',
  },
  {
    title: '已发现商品',
    value: count('products'),
    note: '包含不同配方与规格',
    icon: '▦',
    route: '/products',
  },
  {
    title: '待审核事项',
    value: count('reviews'),
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
        ? `${m.name}：${productCount(m.code)} 个商品`
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
    >
      <Button @click="router.push('/imports')">导入数据</Button><Button type="primary" @click="router.push('/research?new=1')">
        ＋ 新建研究
      </Button>
    </PageHeader>
    <Alert v-if="overview.error.value" type="error" :message="overview.error.value" show-icon />
    <div v-if="serverMode && overview.snapshot.value" class="hci-subtle" style="margin-bottom:12px">数据更新于 {{ new Date(overview.snapshot.value.generatedAt).toLocaleString('zh-CN') }}<span v-if="overview.indexing.value"> · 更新中</span></div>
    <div v-if="!serverMode || overview.snapshot.value?.counts.keywords === 0" class="hci-demo-note">
      <b>空白工作区</b>系统不再预置样本。请从关键词研究、公开数据采集或数据导入开始建立真实结果。
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
              margin-left: 8px;
              font-size: 12px;
              font-weight: 400;
              color: var(--hci-muted);
            "
            >项</span>
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
          <span v-for="m in markets" :key="m.code"><i class="hci-market-dot" :style="{ background: m.color }"></i>{{ m.name }}</span><span>其他市场暂未开放</span>
        </div>
      </section>
      <section class="hci-panel">
        <div class="hci-panel-head">
          <div>
            <h2>市场研究概况</h2>
            <p>当前工作区的商品记录分布，不代表市场规模</p>
          </div>
          <Tag>工作区数据</Tag>
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
            <b>{{ productCount(m.code) }}</b><span class="hci-subtle"> 个商品 →</span>
          </div>
        </button>
        <div
          style="
            padding: 17px;
            margin-top: 22px;
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
              overviewKeywords.map((k) => ({
                label: `${k.term} · ${k.market}`,
                value: k.id,
              }))
            "
            style="width: 230px; max-width: 100%"
            @change="(value: any) => (selectedTerm = value)"
          />
        </div>
        <Chart v-if="keyword" :options="trendOption(keyword)" />
        <p class="hci-subtle">相对趋势 · 不跨国家或批次比较绝对需求</p>
      </section>
      <section class="hci-panel">
        <div class="hci-panel-head">
          <h2>值得继续研究</h2>
          <button class="hci-link" @click="router.push('/opportunities')">
            全部机会 →
          </button>
        </div>
        <div
          v-for="(k, i) in overviewKeywords
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
      <span>{{ state.branding.appName }} · 用证据连接关键词、品牌与商品</span><span>工作区结果从真实采集或人工导入开始累计</span>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button,
  Input,
  Select,
  Table,
  Tag,
  Modal,
  Form,
  InputNumber,
  Checkbox,
  Radio,
  Alert,
  Tooltip,
  message,
} from 'ant-design-vue';
import { IconifyIcon } from '@vben/icons';
import PageHeader from './components/PageHeader.vue';
import {
  state,
  markets,
  categories,
  filteredKeywords,
  marketName,
  exportCsv,
  stamp,
  audit,
} from './data';
import type { Keyword, Market, Task } from './data';
import { discoverSites, productRecords, siteRecord } from './site-discovery';

const DISCOVERY_SOURCE = '独立站发现（Brave Search + 官网验证）';
const route = useRoute();
const router = useRouter();
const open = ref(false);
const researching = ref(false);
const search = ref('');
const category = ref('ALL');
const favoritesOnly = ref(false);
const error = ref('');
watch(
  () => route.query.new,
  (v) => {
    if (v === '1') open.value = true;
  },
  { immediate: true },
);
const form = reactive({
  entry: 'keyword',
  seeds: '',
  markets: (state.market === 'ALL'
    ? ['US', 'MX', 'VN']
    : [state.market]) as Market[],
  sources: [DISCOVERY_SOURCE],
  depth: 1,
  limit: state.settings.trendLimit,
  budget: state.settings.taskBudget,
});
const seedValues = computed(() =>
  form.seeds
    .split(/[\n,，]/)
    .map((value) => value.trim())
    .filter(Boolean),
);
const liveDiscoverySelected = computed(() =>
  form.sources.includes(DISCOVERY_SOURCE),
);
const costEstimate = computed(() => {
  const marketCount = form.markets.length;
  const baseQueries = seedValues.value.length * marketCount;
  const firstLevelCandidates = Math.min(form.limit, baseQueries * 20);
  const estimatedKeywords = Math.min(
    form.limit,
    baseQueries * (form.depth === 2 ? 400 : 20),
  );
  const expansionQueries =
    form.depth === 2 ? baseQueries + firstLevelCandidates : baseQueries;
  const lines: Array<{
    key: string;
    label: string;
    quantity: number;
    total: number;
    unit: number;
  }> = [];
  const add = (key: string, label: string, quantity: number, unit: number) =>
    lines.push({ key, label, quantity, unit, total: quantity * unit });

  if (form.sources.includes('Google 联想词'))
    add(
      'google-autocomplete',
      'Google 联想词',
      expansionQueries,
      state.settings.serpSearchCost,
    );
  if (form.sources.includes('Amazon 联想词'))
    add(
      'amazon-autocomplete',
      'Amazon 联想词',
      expansionQueries,
      state.settings.serpSearchCost,
    );
  if (form.sources.includes('Google Trends'))
    add(
      'trends',
      'Google Trends',
      Math.ceil(estimatedKeywords / state.settings.trendsKeywordsPerTask),
      state.settings.trendsTaskCost,
    );
  if (form.sources.includes('Google SERP'))
    add(
      'serp',
      'Google SERP',
      estimatedKeywords,
      state.settings.serpSearchCost,
    );
  if (form.sources.includes('Store Leads'))
    add(
      'store-leads',
      'Store Leads',
      marketCount,
      state.settings.storeLeadsMarketCost,
    );

  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const recommended =
    Math.ceil(total * (1 + state.settings.costBufferRate / 100) * 100) / 100;
  return {
    estimatedKeywords,
    lines,
    paidRequests: lines.reduce(
      (sum, line) => sum + (line.unit > 0 ? line.quantity : 0),
      0,
    ),
    recommended,
    total,
  };
});
const budgetStatus = computed(() => {
  if (!costEstimate.value.total)
    return { color: 'default', text: '暂无可计费用' };
  if (form.budget === 0)
    return { color: 'orange', text: '禁止付费，付费步骤将暂停' };
  if (form.budget < costEstimate.value.total)
    return { color: 'red', text: '预算低于预计成本' };
  if (form.budget < costEstimate.value.recommended)
    return { color: 'gold', text: '可覆盖估算，尚未覆盖全部预留' };
  return { color: 'green', text: '预算覆盖建议金额' };
});
function formatCost(value: number) {
  return value > 0 && value < 0.1 ? value.toFixed(4) : value.toFixed(2);
}
function sourceLabels(source: string) {
  const [labels = ''] = source.split(' · ');
  return labels.split(' / ');
}
watch(open, (value) => {
  if (value) {
    form.markets = state.market === 'ALL' ? ['US', 'MX', 'VN'] : [state.market];
    form.limit = state.settings.trendLimit;
    form.budget = state.settings.taskBudget;
  }
});
const rows = computed(() =>
  filteredKeywords.value.filter(
    (k) =>
      k.term.toLowerCase().includes(search.value.toLowerCase()) &&
      (category.value === 'ALL' || k.category === category.value) &&
      (!favoritesOnly.value || k.favorite),
  ),
);
const collectedCount = computed(
  () => rows.value.filter((item) => item.dataNature === 'collected').length,
);
const columns = [
  { title: '关键词', key: 'term', width: 250 },
  { title: '市场', key: 'market', width: 100 },
  { title: '研究品类', dataIndex: 'category' },
  { title: '来源', key: 'source', dataIndex: 'source' },
  { title: '关联商品', key: 'productLinks', width: 110 },
  { title: '关联站点', key: 'siteLinks', width: 110 },
  { title: '28天变化', key: 'growth' },
  { title: '操作', key: 'actions', width: 150 },
];
function createDemoResearch(seeds: string[]) {
  for (const market of form.markets) {
    state.tasks.unshift({
      id: crypto.randomUUID(),
      title: `${form.entry === 'asin' ? 'ASIN ' : ''}${seeds.join('、')} · ${marketName(market)}`,
      market,
      status: 'queued',
      created: stamp(),
      steps: [
        `入口：${form.entry}`,
        `来源：${form.sources.join(' / ')}`,
        `裂变：${form.depth}层`,
        `总查询上限：${form.limit}`,
        `预计外部成本：$${formatCost(costEstimate.value.total)}`,
        `预算：$${form.budget}`,
        `预算状态：${budgetStatus.value.text}`,
        '等待演示执行',
      ],
    });
    audit(
      '创建演示研究',
      `${seeds.join('、')} / ${marketName(market)}`,
      market,
    );
  }
  state.market = form.markets.length === 1 ? (form.markets[0] ?? 'US') : 'ALL';
  open.value = false;
  error.value = '';
  router.push('/monitor?tab=tasks');
  message.success('已创建演示任务，可在任务中心模拟运行');
}

function mergeById<T extends { id: string }>(target: T[], records: T[]) {
  for (const record of records) {
    const current = target.find((item) => item.id === record.id);
    if (current) Object.assign(current, record);
    else target.unshift(record);
  }
}

async function createResearch() {
  const seeds = form.seeds
    .split(/[\n,，]/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (
    seeds.length === 0 ||
    form.markets.length === 0 ||
    form.sources.length === 0
  ) {
    error.value = '请填写种子词，并至少选择一个市场和数据源。';
    return;
  }
  if (form.entry === 'asin' && seeds.some((s) => !/^[A-Z0-9]{10}$/i.test(s))) {
    error.value = 'ASIN 应为10位字母或数字。';
    return;
  }
  if (form.entry === 'asin' && form.markets.includes('VN')) {
    error.value =
      '越南不支持本地 Amazon ASIN 入口，请选择美国或墨西哥，或改用关键词。';
    return;
  }
  if (form.limit < 1 || form.limit > 100 || form.budget < 0) {
    error.value = '趋势查询项应为1～100，预算不能为负数。';
    return;
  }
  if (!liveDiscoverySelected.value) {
    createDemoResearch(seeds);
    return;
  }
  if (form.entry !== 'keyword') {
    error.value = '真实独立站发现目前仅支持关键词入口。';
    return;
  }
  if (!state.settings.researchApiUrl || !state.settings.researchAccessKey) {
    error.value = '请先到“数据源与设置”填写 Worker API 地址和研究访问码。';
    return;
  }
  if (seeds.length > 3 || seeds.length * form.markets.length > 3) {
    error.value = '真实研究单次最多执行3个“关键词 × 市场”组合。';
    return;
  }

  const tasks = new Map<string, Task>();
  for (const keyword of seeds) {
    for (const market of form.markets) {
      const task: Task = {
        id: crypto.randomUUID(),
        title: `${keyword} · ${marketName(market)} · 独立站发现`,
        market,
        status: 'queued',
        created: stamp(),
        steps: [
          'Brave Search发现候选域名',
          '官网商品、价格、购物车与平台验证',
          '不保存Brave搜索摘要与排名',
        ],
      };
      tasks.set(`${keyword}|${market}`, task);
      state.tasks.unshift(task);
    }
  }

  researching.value = true;
  error.value = '';
  try {
    const result = await discoverSites({
      accessKey: state.settings.researchAccessKey,
      apiUrl: state.settings.researchApiUrl,
      keywords: seeds,
      markets: form.markets,
      maxSites: state.settings.researchMaxSites,
    });
    let totalSites = 0;
    let totalProducts = 0;
    for (const group of result.groups) {
      const sites = group.sites.map(siteRecord);
      const products = group.sites.flatMap(productRecords);
      mergeById(state.sites, sites);
      mergeById(state.products, products);
      totalSites += sites.length;
      totalProducts += products.length;

      const siteIds = sites.map((site) => site.id);
      const productIds = products.map((product) => product.id);
      const keyword = state.keywords.find(
        (item) =>
          item.term.toLowerCase() === group.keyword.toLowerCase() &&
          item.market === group.market &&
          item.dataNature === 'collected',
      );
      const record: Keyword = {
        id: keyword?.id || crypto.randomUUID(),
        term: group.keyword,
        market: group.market,
        category: keyword?.category || '待分类',
        source: 'Brave Search / 官网验证 · 实采',
        growth: null,
        series: [],
        favorite: keyword?.favorite || false,
        productIds,
        siteIds,
        updatedAt: result.generatedAt,
        dataNature: 'collected',
      };
      if (keyword) Object.assign(keyword, record);
      else state.keywords.unshift(record);

      const task = tasks.get(`${group.keyword}|${group.market}`);
      if (task) {
        task.status = sites.length > 0 ? 'completed' : 'partial';
        task.steps.push(
          `搜索结果 ${group.coverage.searchResults} 条 / 候选域名 ${group.coverage.candidateDomains} 个`,
          `官网验证通过 ${group.coverage.validatedSites} 家 / 未通过或不可达 ${group.coverage.rejectedOrUnreachable} 家`,
          `提取结构化商品 ${products.length} 件`,
        );
      }
      audit(
        '完成独立站发现',
        `${group.keyword} / ${marketName(group.market)} / ${sites.length}家站点 / ${products.length}件商品`,
        group.market,
      );
    }
    state.market =
      form.markets.length === 1 ? (form.markets[0] ?? 'US') : 'ALL';
    open.value = false;
    if (totalSites) {
      message.success(
        `已验证 ${totalSites} 家独立站，提取 ${totalProducts} 件商品`,
      );
    } else {
      message.warning('本次未找到通过官网验证的独立站，可更换关键词重试');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '真实研究执行失败';
    for (const task of tasks.values()) {
      task.status = 'partial';
      task.steps.push(`执行失败：${detail}`);
    }
    error.value = detail;
    message.error(detail);
  } finally {
    researching.value = false;
  }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="关键词研究"
      description="从用户的搜索表达出发，发现需求与产品概念。"
      ><Button
        @click="
          exportCsv(
            '关键词研究.csv',
            rows.map((k) => ({
              关键词: k.term,
              市场: k.market,
              品类: k.category,
              来源: k.source,
              关联商品数: k.productIds.length,
              关联站点数: k.siteIds.length,
              数据性质: k.dataNature === 'collected' ? '官网实采' : '演示',
            })),
          )
        "
        :disabled="!rows.length"
        >导出结果</Button
      ><Button type="primary" @click="open = true"
        >＋ 新建研究</Button
      ></PageHeader
    >
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索关键词 / 原语言表达"
          allow-clear
        /><Select
          v-model:value="category"
          :options="[
            { label: '全部品类', value: 'ALL' },
            ...categories.map((c) => ({ label: c, value: c })),
          ]"
        /><Checkbox v-model:checked="favoritesOnly">仅看收藏</Checkbox
        ><span class="hci-toolbar-end hci-subtle"
          >{{ rows.length }} 个关键词 · {{ collectedCount }} 个实采</span
        >
      </div>
      <Table
        :data-source="rows"
        :columns="columns"
        row-key="id"
        :pagination="{ pageSize: 8, showSizeChanger: false }"
        :scroll="{ x: 1200 }"
        ><template #headerCell="{ column }"
          ><span v-if="column.key === 'source'" class="hci-field-title"
            >来源
            <Tooltip
              title="关键词的发现渠道。同一关键词可以有多个独立来源；“演示”表示当前记录来自虚构样本，并非真实接口返回。"
              ><button class="hci-help-button" aria-label="查看来源字段说明">
                <IconifyIcon
                  icon="lucide:circle-help"
                /></button></Tooltip></span
          ><span v-else-if="column.key === 'growth'" class="hci-field-title"
            >28天变化
            <Tooltip
              title="同一市场、同一查询批次内，最近28天相对热度与此前28天相比的变化率：(最近28天－此前28天)÷此前28天。它不是搜索量；基期为0或数据不足时不计算。"
              ><button
                class="hci-help-button"
                aria-label="查看28天变化字段说明"
              >
                <IconifyIcon
                  icon="lucide:circle-help"
                /></button></Tooltip></span
          ><span
            v-else-if="column.key === 'productLinks'"
            class="hci-field-title"
            >关联商品
            <Tooltip
              title="当前关键词已建立关联的商品记录数；点击数量可进入商品库查看。"
            >
              <button class="hci-help-button" aria-label="查看关联商品字段说明">
                <IconifyIcon icon="lucide:circle-help" />
              </button> </Tooltip></span
          ><span v-else-if="column.key === 'siteLinks'" class="hci-field-title"
            >关联站点
            <Tooltip
              title="由关联商品去重得到的独立站数量；点击数量可进入站点库查看。"
            >
              <button class="hci-help-button" aria-label="查看关联站点字段说明">
                <IconifyIcon icon="lucide:circle-help" />
              </button> </Tooltip></span
        ></template>
        <template #bodyCell="{ column, record }"
          ><template v-if="column.key === 'term'"
            ><button
              class="hci-link"
              @click="
                router.push({ path: '/trends', query: { keyword: record.id } })
              "
            >
              {{ record.term }}
            </button></template
          ><template v-if="column.key === 'market'"
            ><Tag>{{ marketName(record.market) }}</Tag></template
          ><template v-if="column.key === 'source'"
            ><div class="hci-source-tags">
              <Tag v-for="source in sourceLabels(record.source)" :key="source">
                {{ source }}
              </Tag>
              <span v-if="record.source.includes('演示')" class="hci-subtle"
                >演示样本</span
              >
            </div></template
          ><template v-if="column.key === 'growth'"
            ><span
              v-if="record.growth !== null"
              :class="record.growth > 0 ? 'hci-positive' : 'hci-negative'"
              >{{ record.growth > 0 ? '+' : '' }}{{ record.growth }}%</span
            ><Tag v-else>数据不足</Tag></template
          ><template v-if="column.key === 'productLinks'"
            ><button
              class="hci-count-link"
              :disabled="!record.productIds.length"
              :aria-label="`查看${record.term}关联商品`"
              @click="
                router.push({
                  path: '/products',
                  query: { keyword: record.id },
                })
              "
            >
              <b>{{ record.productIds.length }}</b
              ><span>件商品</span>
            </button></template
          ><template v-if="column.key === 'siteLinks'"
            ><button
              class="hci-count-link"
              :disabled="!record.siteIds.length"
              :aria-label="`查看${record.term}关联站点`"
              @click="
                router.push({ path: '/sites', query: { keywordId: record.id } })
              "
            >
              <b>{{ record.siteIds.length }}</b
              ><span>家站点</span>
            </button></template
          ><template v-if="column.key === 'actions'"
            ><button
              class="hci-link"
              @click="record.favorite = !record.favorite"
            >
              {{ record.favorite ? '★ 已收藏' : '☆ 收藏' }}</button
            ><button
              class="hci-link"
              style="margin-left: 14px"
              @click="
                router.push({ path: '/sites', query: { keyword: record.term } })
              "
            >
              找竞品
            </button></template
          ></template
        ></Table
      >
    </section>
    <div class="hci-field-notes">
      <div>
        <b>来源</b>
        <span>记录关键词从哪个渠道被发现；多来源保留为独立观察。</span>
      </div>
      <div>
        <b>28天变化</b>
        <span
          >最近28天与此前28天的同序列相对热度变化，不代表绝对搜索量，也不能跨批次比较。</span
        >
      </div>
    </div>
    <div class="hci-demo-note">
      <b>真实独立站发现</b>
      用 Brave Search
      发现候选域名，再以商品结构化数据、价格、购物车和建站平台信号验证官网。
      28天趋势暂不在这条链路中计算，所以实采关键词显示“数据不足”。
    </div>
    <Modal
      v-model:open="open"
      title="新建市场研究"
      :width="760"
      :ok-text="liveDiscoverySelected ? '开始真实研究' : '创建演示任务'"
      :confirm-loading="researching"
      cancel-text="取消"
      @ok="createResearch"
      @cancel="error = ''"
      ><Alert
        :message="
          liveDiscoverySelected
            ? '将调用Cloudflare Worker完成搜索发现与官网验证，结果保存在当前浏览器。'
            : '所选来源尚未接入，将只创建演示任务。'
        "
        :type="liveDiscoverySelected ? 'success' : 'info'"
        show-icon
        style="margin: 16px 0"
      /><Form layout="vertical"
        ><div class="hci-form-grid">
          <Form.Item label="研究入口" class="hci-full"
            ><Radio.Group v-model:value="form.entry"
              ><Radio.Button value="keyword">关键词研究</Radio.Button
              ><Radio.Button value="asin">ASIN 反查</Radio.Button></Radio.Group
            ></Form.Item
          ><Form.Item
            :label="
              form.entry === 'asin'
                ? 'ASIN（每行一个）'
                : '种子关键词（每行一个）'
            "
            class="hci-full"
            required
            ><Input.TextArea
              v-model:value="form.seeds"
              :rows="3"
              :placeholder="
                form.entry === 'asin'
                  ? '例如 B012345678'
                  : 'probiotic for women\ninositol'
              "
              :maxlength="1000" /></Form.Item
          ><Form.Item label="目标市场" class="hci-full" required
            ><Checkbox.Group
              v-model:value="form.markets"
              :options="
                markets.map((m) => ({ label: m.name, value: m.code }))
              " /></Form.Item
          ><Form.Item label="数据来源" class="hci-full" required
            ><Checkbox.Group
              v-model:value="form.sources"
              :options="[
                'Google 联想词',
                'Amazon 联想词',
                'Google Trends',
                'Google SERP',
                'Store Leads',
                DISCOVERY_SOURCE,
                '人工导入',
              ]" /></Form.Item
          ><Form.Item label="裂变深度"
            ><Select
              v-model:value="form.depth"
              :options="[
                { label: '一级裂变（推荐）', value: 1 },
                { label: '二级裂变', value: 2 },
              ]" /></Form.Item
          ><Form.Item label="趋势查询项上限（所有国家合计）"
            ><InputNumber
              v-model:value="form.limit"
              :min="1"
              :max="100" /></Form.Item
          ><Form.Item label="任务预算上限（USD，0代表禁止付费）"
            ><InputNumber
              v-model:value="form.budget"
              :min="0"
              :max="10000"
              :precision="2"
          /></Form.Item></div
      ></Form>
      <section class="hci-cost-estimate">
        <div class="hci-cost-estimate-head">
          <div>
            <span>预计外部调用成本</span>
            <strong>${{ formatCost(costEstimate.total) }}</strong>
          </div>
          <Tag :color="budgetStatus.color">{{ budgetStatus.text }}</Tag>
        </div>
        <div class="hci-cost-metrics">
          <span
            >预计进入查询 {{ costEstimate.estimatedKeywords }} 个关键词</span
          >
          <span>计费请求 {{ costEstimate.paidRequests }} 次</span>
          <span>预留 {{ state.settings.costBufferRate }}%</span>
        </div>
        <div v-if="costEstimate.lines.length" class="hci-cost-lines">
          <div v-for="line in costEstimate.lines" :key="line.key">
            <span
              >{{ line.label }} · {{ line.quantity }} × ${{
                formatCost(line.unit)
              }}</span
            >
            <b>${{ formatCost(line.total) }}</b>
          </div>
        </div>
        <div class="hci-cost-recommendation">
          <span>建议预算（含预留）</span>
          <b>${{ formatCost(costEstimate.recommended) }}</b>
          <Button
            size="small"
            :disabled="!costEstimate.recommended"
            @click="form.budget = costEstimate.recommended"
            >采用建议预算</Button
          >
        </div>
        <p
          v-if="
            form.sources.includes('Store Leads') &&
            state.settings.storeLeadsMarketCost === 0
          "
          class="hci-cost-warning"
        >
          Store Leads 为套餐制，当前未配置分摊成本，因此未计入金额。
        </p>
        <p class="hci-subtle" style="margin: 10px 0 0">
          估算规则：联想词按父词请求数、SERP按预计关键词数、Trends按每批最多
          {{ state.settings.trendsKeywordsPerTask }}
          词计算。税费、汇率和套餐基础费不在本次估算内。
        </p>
      </section>
      <Alert v-if="error" :message="error" type="error" show-icon />
      <p class="hci-subtle">
        计划生成
        {{ form.markets.length }}
        个国家子任务。{{
          liveDiscoverySelected
            ? '单次最多3个“关键词 × 市场”组合。'
            : '当前选择将以演示任务记录。'
        }}
      </p></Modal
    >
  </main>
</template>

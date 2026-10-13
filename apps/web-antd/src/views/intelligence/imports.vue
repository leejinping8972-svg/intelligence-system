<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import {
  Button,
  Select,
  Steps,
  Table,
  Tag,
  Alert,
  Input,
  message,
} from 'ant-design-vue';
import * as XLSX from 'xlsx';
import PageHeader from './components/PageHeader.vue';
import { parseCsv } from './import-utils';
import { state, stamp, marketName, audit, exportCsv } from './data';
import type { Market } from './data';
const step = ref(0);
const type = ref('keywords');
const source = ref('人工导入');
const fileName = ref('');
const raw = ref<Record<string, unknown>[]>([]);
const error = ref('');
const mapping = reactive<Record<string, string>>({});
const committed = ref(false);
const loading = ref(false);
const schemas: Record<
  string,
  { key: string; label: string; required?: boolean }[]
> = {
  keywords: [
    { key: 'term', label: '关键词', required: true },
    { key: 'market', label: '国家代码', required: true },
    { key: 'category', label: '品类' },
  ],
  sites: [
    { key: 'brand', label: '品牌', required: true },
    { key: 'domain', label: '域名', required: true },
    { key: 'market', label: '国家代码', required: true },
  ],
  products: [
    { key: 'title', label: '商品名称', required: true },
    { key: 'brand', label: '品牌', required: true },
    { key: 'market', label: '国家代码', required: true },
    { key: 'price', label: '标价', required: true },
    { key: 'currency', label: '币种', required: true },
    { key: 'ingredient', label: '成分' },
    { key: 'dose', label: '剂量' },
    { key: 'size', label: '规格' },
  ],
  ads: [
    { key: 'brand', label: '广告品牌', required: true },
    { key: 'headline', label: '广告标题', required: true },
    { key: 'market', label: '国家代码', required: true },
    { key: 'platform', label: '平台', required: true },
  ],
};
const fields = computed(() => schemas[type.value]!);
const headers = computed(() => Object.keys(raw.value[0] || {}));
const aliases: Record<string, string[]> = {
  term: ['term', 'keyword', 'raw_term', '关键词'],
  market: ['market', 'market_code', '国家', '国家代码', '市场'],
  brand: ['brand', '品牌', '广告品牌'],
  domain: ['domain', '域名'],
  category: ['category', '品类'],
  title: ['title', '商品', '商品名称'],
  price: ['price', '标价', '价格'],
  currency: ['currency', '币种'],
  ingredient: ['ingredient', '成分'],
  dose: ['dose', '剂量'],
  size: ['size', '规格'],
  headline: ['headline', '广告标题'],
  platform: ['platform', '平台'],
};
function clear() {
  step.value = 0;
  raw.value = [];
  fileName.value = '';
  error.value = '';
  committed.value = false;
  Object.keys(mapping).forEach((k) => delete mapping[k]);
}
async function load(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  loading.value = true;
  committed.value = false;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('前台演示单文件限制5MB');
    let rows: Record<string, unknown>[] = [];
    if (file.name.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(await file.text());
      rows = Array.isArray(parsed) ? parsed : parsed.items;
      if (
        !Array.isArray(rows) ||
        rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))
      )
        throw new Error('JSON应为对象数组，或含items数组的对象');
    } else if (file.name.toLowerCase().endsWith('.csv')) {
      rows = parseCsv(await file.text());
    } else if (file.name.toLowerCase().endsWith('.xlsx')) {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        sheetRows: 1002,
        cellFormula: false,
        cellHTML: false,
      });
      rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]!]!,
        { defval: '' },
      );
    } else throw new Error('请选择CSV、XLSX或JSON文件');
    if (!rows.length) throw new Error('文件没有数据行');
    if (rows.length > 1000)
      throw new Error('前台演示最多处理1000行，请拆分文件');
    raw.value = rows;
    fileName.value = file.name;
    for (const field of fields.value)
      mapping[field.key] =
        Object.keys(rows[0]!).find((h) => aliases[field.key]?.includes(h)) ||
        '';
    step.value = 1;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  } finally {
    loading.value = false;
    (event.target as HTMLInputElement).value = '';
  }
}
function rowKey(v: Record<string, string>) {
  return JSON.stringify(
    type.value === 'keywords'
      ? [v.term?.toLowerCase(), v.market]
      : type.value === 'sites'
        ? [v.domain?.toLowerCase(), v.market]
        : type.value === 'products'
          ? [v.title, v.brand, v.market, v.size || '未知']
          : [v.brand, v.headline, v.market],
  );
}
const normalized = computed(() => {
  const seen = new Set<string>();
  return raw.value.map((r, index) => {
    const values = Object.fromEntries(
      fields.value.map((f) => [
        f.key,
        String(r[mapping[f.key] || ''] ?? '').trim(),
      ]),
    );
    values.market =
      values.market?.toUpperCase() ||
      (state.market === 'ALL' ? '' : state.market);
    const errors = fields.value
      .filter((f) => f.required && !values[f.key])
      .map((f) => `缺少${f.label}`);
    if (!['US', 'MX', 'VN'].includes(values.market))
      errors.push('国家仅支持US/MX/VN');
    if (state.market !== 'ALL' && values.market !== state.market)
      errors.push('该行与当前选择市场不符，请切换全部市场或修正国家');
    if (type.value === 'products') {
      if (
        !values.price ||
        !Number.isFinite(Number(values.price)) ||
        Number(values.price) < 0
      )
        errors.push('标价须为非负数字');
      if (!['USD', 'MXN', 'VND'].includes(values.currency || ''))
        errors.push('币种须为USD/MXN/VND');
    }
    if (
      type.value === 'sites' &&
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(values.domain || '')
    )
      errors.push('请输入不含路径的域名');
    const duplicate =
      type.value === 'keywords'
        ? state.keywords.some(
            (k) =>
              k.term.toLowerCase() === values.term?.toLowerCase() &&
              k.market === values.market,
          )
        : type.value === 'sites'
          ? state.sites.some(
              (s) =>
                s.domain.toLowerCase() === values.domain?.toLowerCase() &&
                s.market === values.market,
            )
          : type.value === 'products'
            ? state.products.some(
                (p) =>
                  p.title === values.title &&
                  p.brand === values.brand &&
                  p.market === values.market &&
                  p.size === (values.size || '未知'),
              )
            : state.ads.some(
                (a) =>
                  a.brand === values.brand &&
                  a.headline === values.headline &&
                  a.market === values.market,
              );
    const key = rowKey(values);
    const repeated = seen.has(key);
    if (!errors.length) seen.add(key);
    return { id: index + 1, values, errors, duplicate: duplicate || repeated };
  });
});
const valid = computed(() =>
  normalized.value.filter((r) => !r.errors.length && !r.duplicate),
);
const previewColumns = computed(() => [
  { title: '行', dataIndex: 'id', width: 60 },
  ...fields.value.map((f) => ({ title: f.label, key: f.key, width: 160 })),
  { title: '校验结果', key: 'result', width: 220 },
]);
function template() {
  const market = state.market === 'ALL' ? 'US' : state.market;
  const currency = { US: 'USD', MX: 'MXN', VN: 'VND' }[market];
  const sample =
    type.value === 'keywords'
      ? { term: 'probiotic', market, category: '肠道与益生菌' }
      : type.value === 'sites'
        ? { brand: 'Example Brand', domain: 'brand.example', market }
        : type.value === 'products'
          ? {
              title: 'Example Product',
              brand: 'Example Brand',
              market,
              price: 29,
              currency,
              ingredient: 'Inulin',
              dose: '5 g / 份',
              size: '150g / 30份',
            }
          : {
              brand: 'Example Brand',
              headline: 'Daily care',
              market,
              platform: 'Meta',
            };
  exportCsv(`${type.value}-导入模板.csv`, [sample]);
}
function commit() {
  if (committed.value || !valid.value.length) return;
  if (!source.value.trim()) {
    error.value = '请填写原始数据来源';
    return;
  }
  const batchKeys = new Set<string>();
  let count = 0;
  let skipped = normalized.value.filter((r) => r.duplicate).length;
  for (const row of valid.value) {
    const v = row.values;
    const market = v.market as Market;
    const id = crypto.randomUUID();
    const key = JSON.stringify(
      type.value === 'keywords'
        ? [v.term?.toLowerCase(), market]
        : type.value === 'sites'
          ? [v.domain?.toLowerCase(), market]
          : type.value === 'products'
            ? [v.title, v.brand, market, v.size || '未知']
            : [v.brand, v.headline, market],
    );
    if (batchKeys.has(key)) {
      skipped++;
      continue;
    }
    batchKeys.add(key);
    if (type.value === 'keywords')
      state.keywords.push({
        id,
        term: v.term!,
        market,
        category: v.category || '未分类',
        source: `${source.value} / 本地导入`,
        growth: null,
        series: [],
        favorite: false,
        productIds: [],
        siteIds: [],
      });
    else if (type.value === 'sites')
      state.sites.push({
        id,
        brand: v.brand!,
        domain: v.domain!.toLowerCase(),
        market,
        platform: '未知',
        type: '待分类',
        keyword: '人工导入',
        category: '待分类',
        mainProducts: [],
        ownershipBackground: '待核验',
        ownershipOperations: '待核验',
        ownershipEvidence: '人工导入，尚未从官网提取股权背景。',
        ownershipSource: '官网待采集',
      });
    else if (type.value === 'products')
      state.products.push({
        id,
        title: v.title!,
        brand: v.brand!,
        market,
        category: '未分类',
        form: '未知',
        size: v.size || '未知',
        price: Number(v.price),
        currency: v.currency!,
        ingredient: v.ingredient || '未知',
        dose: v.dose || '未知',
        claim: '未知',
        benefits: [],
        benefitEvidence: '人工导入，待提取官网商品页卖点。',
        ingredientInsights: [
          {
            name: v.ingredient || '未知成分',
            amount: v.dose || '剂量未知',
            role: '待分析',
            evidence: '人工导入，待补充标签或官网依据',
          },
        ],
        siteId: '',
        color: 'sage',
        reviewed: false,
        favorite: false,
      });
    else
      state.ads.push({
        id,
        brand: v.brand!,
        market,
        platform: v.platform!,
        headline: v.headline!,
        copy: '人工导入，待核验',
        format: '未知',
        productId: '',
        status: '未知',
        color: 'sage',
      });
    count++;
  }
  state.imports.unshift({
    id: crypto.randomUUID(),
    name: fileName.value,
    count,
    skipped,
    errors: normalized.value.filter((r) => r.errors.length).length,
    at: stamp(),
    markets: [
      ...new Set(
        normalized.value
          .filter((r) => !r.errors.length)
          .map((r) => r.values.market as Market),
      ),
    ],
  });
  audit(
    '导入本地资料',
    `${fileName.value} / ${source.value} / 新增${count}条，跳过${skipped}条`,
  );
  committed.value = true;
  step.value = 2;
  message.success('已写入本浏览器的演示工作区');
}
const history = computed(() =>
  state.imports.filter(
    (b) => state.market === 'ALL' || b.markets?.includes(state.market),
  ),
);
function errorsFile() {
  exportCsv(
    '导入错误.csv',
    normalized.value
      .filter((r) => r.errors.length)
      .map((r) => ({ 行号: r.id + 1, ...r.values, 错误: r.errors.join('；') })),
  );
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="数据导入"
      description="把已有资料纳入同一研究流程，先预览，再确认。"
      ><Button @click="template">下载CSV模板</Button></PageHeader
    >
    <div class="hci-demo-note">
      <b>浏览器内处理</b>支持CSV / XLSX /
      JSON，文件不上传服务器；最多1000行、5MB。此为交互试用，原始证据归档与完整冲突审核将在后端实现。
    </div>
    <section class="hci-panel">
      <Steps
        :current="step"
        :items="[
          { title: '选择资料' },
          { title: '映射与预览' },
          { title: '导入完成' },
        ]"
        style="margin-bottom: 28px"
      />
      <div class="hci-toolbar">
        <Select
          v-model:value="type"
          :disabled="step === 1"
          :options="[
            { label: '关键词资料', value: 'keywords' },
            { label: '独立站名单', value: 'sites' },
            { label: '商品资料', value: 'products' },
            { label: '广告资料', value: 'ads' },
          ]"
          @change="clear"
        /><Input
          v-model:value="source"
          placeholder="填写原始来源"
          aria-label="原始数据来源"
          style="width: 220px"
        /><span class="hci-subtle"
          >当前：{{ marketName(state.market) }}；单国模式仅导入该国记录</span
        >
      </div>
      <Alert
        v-if="error"
        :message="error"
        type="error"
        show-icon
        style="margin-bottom: 16px"
      />
      <div v-if="step === 0" class="hci-dropzone">
        <h3>选择一份研究资料</h3>
        <p class="hci-subtle" style="margin: 12px 0 20px">
          XLSX读取第一张工作表；CSV请使用UTF-8编码。
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.json"
          aria-label="选择导入文件"
          :disabled="loading"
          @change="load"
        />
        <p v-if="loading">正在解析文件…</p>
      </div>
      <template v-if="step === 1"
        ><div class="hci-form-grid">
          <div
            v-for="field in fields"
            :key="field.key"
            style="margin-bottom: 16px"
          >
            <label style="display: block; margin-bottom: 6px"
              >{{ field.label }}{{ field.required ? ' *' : '' }}</label
            ><Select
              v-model:value="mapping[field.key]"
              style="width: 100%"
              :options="[
                { label: '不映射', value: '' },
                ...headers.map((h) => ({ label: h, value: h })),
              ]"
            />
          </div>
        </div>
        <div class="hci-demo-note">
          {{ fileName }} · 共{{ normalized.length }}行 · 可新增{{
            valid.length
          }}行 · 重复{{ normalized.filter((r) => r.duplicate).length }}行 ·
          错误{{
            normalized.filter((r) => r.errors.length).length
          }}行。批内重复也会跳过，现有值不会覆盖。
        </div>
        <Table
          :columns="previewColumns"
          :data-source="normalized.slice(0, 100)"
          row-key="id"
          size="small"
          :scroll="{ x: 900 }"
          :pagination="{ pageSize: 5 }"
          ><template #bodyCell="{ column, record }"
            ><template v-if="column.key === 'result'"
              ><Tag
                :color="
                  record.errors.length
                    ? 'red'
                    : record.duplicate
                      ? 'orange'
                      : 'green'
                "
                >{{
                  record.errors.length
                    ? record.errors.join('；')
                    : record.duplicate
                      ? '重复，将跳过'
                      : '校验通过'
                }}</Tag
              ></template
            ><template v-else-if="column.key">{{
              record.values[column.key]
            }}</template></template
          ></Table
        >
        <div
          style="display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap"
        >
          <Button
            type="primary"
            :disabled="!valid.length || committed"
            @click="commit"
            >确认导入有效行</Button
          ><Button @click="clear">重新选择</Button
          ><Button
            v-if="normalized.some((r) => r.errors.length)"
            @click="errorsFile"
            >下载错误报告</Button
          >
        </div></template
      >
      <div v-if="step === 2" class="hci-empty">
        <h2 style="color: var(--hci-accent)">资料已导入</h2>
        <p style="margin: 12px 0">
          新增{{ state.imports[0]?.count }}条，跳过{{
            state.imports[0]?.skipped
          }}条，错误{{ state.imports[0]?.errors }}条。可在对应列表查看。
        </p>
        <Button type="primary" @click="clear">继续导入</Button>
      </div>
    </section>
    <section class="hci-panel">
      <div class="hci-panel-head">
        <h2>导入历史</h2>
        <span class="hci-subtle">批次总计 · 仅当前浏览器</span>
      </div>
      <Table
        :data-source="history"
        :columns="[
          { title: '文件', dataIndex: 'name' },
          { title: '新增', dataIndex: 'count' },
          { title: '跳过', dataIndex: 'skipped' },
          { title: '错误', dataIndex: 'errors' },
          { title: '时间', dataIndex: 'at' },
        ]"
        row-key="id"
        :scroll="{ x: 600 }"
        :pagination="{ pageSize: 5 }"
      />
    </section>
  </main>
</template>

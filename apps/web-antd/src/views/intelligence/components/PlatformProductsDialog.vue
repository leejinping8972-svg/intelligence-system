<script setup lang="ts">
import type {
  ResourceCapabilities,
  ResourceCategory,
  ResourceDiscoveryInput,
  ResourceMode,
  ResourceRanking,
  ResourceWindowDays,
} from '../product-resources';

import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Segmented,
  Select,
  Spin,
  Tabs,
  Tooltip,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { markets, categories as researchCategories, state } from '../data';
import {
  resourceCostUnitLabels,
  resourceModeLabels,
  resourceRankingLabels,
  resourceRankingsForMode,
  resourceRouteAvailable,
  resourceSalesFieldDescription,
  resourceSupports,
  splitResourceLines,
  validateResourceInput,
} from '../product-resources';
import { serverMode } from '../session';
import CollectionEstimate from './CollectionEstimate.vue';
import DiscoveryPlanForm from './DiscoveryPlanForm.vue';
const props = defineProps<{
  terms?: string[];
  market?: string;
  disabled?: boolean;
  disabledReason?: string;
  label?: string;
}>();
const busy = ref(false);
const errorMessage = ref('');
const open = ref(false);
const router = useRouter();
const activeTab = ref('resources');
const capabilities = ref<ResourceCapabilities>();
const capabilitiesLoading = ref(false);
const capabilitiesError = ref('');
const categoryLoading = ref(false);
const categoryError = ref('');
const categoryNotice = ref('');
const categoryRows = ref<ResourceCategory[]>([]);
const categoryQuery = ref('');
const resourceForm = reactive({
  routeId: '',
  market: 'US',
  mode: 'keyword' as ResourceMode,
  terms: '',
  urls: '',
  categoryId: '',
  researchCategory: '',
  websiteDomain: '',
  salesWindowDays: 30 as ResourceWindowDays,
  ranking: 'sample' as ResourceRanking,
  maxProducts: 100,
  includeDetails: true,
  includeHistory: false,
  budget: {
    requests: 30,
    providerCalls: 30,
    sorftimeCalls: 20,
    scrapeCredits: 30,
    semrushUnits: 0,
    braveRequests: 10,
    browserPages: 0,
    modelTokens: 0,
    maxPages: 5,
    maxDetailProducts: 10,
  },
});
const marketRoutes = computed(
  () =>
    capabilities.value?.routes.filter((route) =>
      route.markets.includes(resourceForm.market),
    ) || [],
);
const resourceRoute = computed(() =>
  marketRoutes.value.find((route) => route.id === resourceForm.routeId),
);
const rankingOptions = computed(() =>
  resourceRoute.value
    ? resourceRankingsForMode(resourceRoute.value, resourceForm.mode).map(
        (value) => ({ value, label: resourceRankingLabels[value] }),
      )
    : [],
);
const routeOptions = computed(() =>
  marketRoutes.value.map((route) => ({
    value: route.id,
    label: `${route.label}${resourceRouteAvailable(route, capabilities.value?.configured || {}) ? '' : ' · 未配置'}`,
    disabled: !resourceRouteAvailable(
      route,
      capabilities.value?.configured || {},
    ),
  })),
);
const resourceInput = computed<ResourceDiscoveryInput>(() => ({
  resourceDiscovery: true,
  routeId: resourceForm.routeId,
  market: resourceForm.market,
  mode: resourceForm.mode,
  terms: splitResourceLines(resourceForm.terms).join('\n'),
  urls: splitResourceLines(resourceForm.urls).join('\n'),
  category:
    resourceForm.mode === 'category'
      ? categoryRows.value.find(
          (category) => category.id === resourceForm.categoryId,
        )
      : undefined,
  salesWindowDays: resourceForm.salesWindowDays,
  ranking: resourceForm.ranking,
  maxProducts: resourceForm.maxProducts,
  includeDetails: resourceForm.includeDetails,
  includeHistory: resourceForm.includeHistory,
  researchCategory: resourceForm.researchCategory,
  websiteDomain:
    resourceRoute.value?.platform === 'website'
      ? resourceForm.websiteDomain.trim()
      : undefined,
  budget: { ...resourceForm.budget },
}));
const submitDisabled = computed(
  () =>
    activeTab.value === 'resources' &&
    (capabilitiesLoading.value ||
      categoryLoading.value ||
      !resourceRoute.value ||
      !resourceRouteAvailable(
        resourceRoute.value,
        capabilities.value?.configured || {},
      )),
);
const unsupportedPlatforms = computed(
  () =>
    capabilities.value?.platforms.filter((platform) => platform.reason) || [],
);
watch(
  () => resourceForm.market,
  () => {
    categoryRows.value = [];
    resourceForm.categoryId = '';
    categoryNotice.value = '';
    categoryError.value = '';
    resourceForm.routeId =
      marketRoutes.value.find((route) =>
        resourceRouteAvailable(route, capabilities.value?.configured || {}),
      )?.id || '';
  },
);
watch(
  () => resourceForm.mode,
  () => {
    if (
      !rankingOptions.value.some(
        (option) => option.value === resourceForm.ranking,
      )
    )
      resourceForm.ranking = rankingOptions.value[0]?.value || 'sample';
  },
);
watch(
  () => resourceForm.routeId,
  () => {
    categoryRows.value = [];
    resourceForm.categoryId = '';
    categoryNotice.value = '';
    categoryError.value = '';
    const route = resourceRoute.value;
    if (!route) return;
    if (!route.modes.includes(resourceForm.mode))
      resourceForm.mode = route.modes[0] || 'keyword';
    const rankings = resourceRankingsForMode(route, resourceForm.mode);
    if (!rankings.includes(resourceForm.ranking))
      resourceForm.ranking = rankings[0] || 'sample';
    resourceForm.includeDetails = resourceSupports(route, 'detail');
    resourceForm.includeHistory = false;
    resourceForm.maxProducts = Math.min(
      resourceForm.maxProducts,
      route.limits.maxProducts || 100,
      100,
    );
    resourceForm.budget.maxPages = Math.min(
      resourceForm.budget.maxPages,
      route.limits.maxPages || 5,
    );
  },
);
async function loadCapabilities() {
  capabilitiesLoading.value = true;
  capabilitiesError.value = '';
  try {
    capabilities.value = await cloudRequest<ResourceCapabilities>(
      'server_product_resource_capabilities',
      {},
    );
    resourceForm.routeId =
      marketRoutes.value.find((route) =>
        resourceRouteAvailable(route, capabilities.value?.configured || {}),
      )?.id || '';
  } catch (cause) {
    capabilitiesError.value =
      cause instanceof Error ? cause.message : '资源路径读取失败';
  } finally {
    capabilitiesLoading.value = false;
  }
}
let categoryRequestId = '';
let categorySignature = '';
async function queryCategories(parentId?: string) {
  if (!resourceRoute.value?.modes.includes('category')) return;
  categoryError.value = '';
  categoryNotice.value = '';
  const input = {
    routeId: resourceForm.routeId,
    market: resourceForm.market,
    query: categoryQuery.value.trim(),
    parentId,
    parentReceiptId: parentId
      ? categoryRows.value.find((category) => category.id === parentId)
          ?.receiptId
      : undefined,
    budget: { requests: 5, sorftimeCalls: 1 },
  };
  if (input.query.length > 200) {
    categoryError.value = '类目查询不超过200字符';
    return;
  }
  const current = JSON.stringify(input);
  if (current !== categorySignature) {
    categorySignature = current;
    categoryRequestId = crypto.randomUUID();
  }
  categoryLoading.value = true;
  try {
    const result = await cloudRequest<{
      categories: ResourceCategory[];
      requests: number;
      stopReason?: string;
      message?: string;
    }>('server_product_resource_categories', {
      ...input,
      requestId: categoryRequestId,
    });
    if (
      resourceForm.routeId !== input.routeId ||
      resourceForm.market !== input.market
    )
      return;
    categoryRows.value = result.categories;
    resourceForm.categoryId = '';
    categoryNotice.value = [
      result.message || `返回${result.categories.length}个真实类目`,
      `本次请求${result.requests}次`,
      result.stopReason,
    ]
      .filter(Boolean)
      .join(' · ');
    categoryRequestId = '';
    categorySignature = '';
  } catch (cause) {
    categoryError.value =
      cause instanceof Error ? cause.message : '类目查询失败';
  } finally {
    categoryLoading.value = false;
  }
}
const disabledMessage = computed(() =>
  !serverMode ? '请在服务器版使用平台商品采集' : props.disabledReason || '',
);
const form = reactive({
  terms: '',
  market: 'US',
  providers: ['sorftime', 'semrush', 'tiktok_shop'],
  maxProducts: 100,
  perKeyword: 20,
  maxRequests: 150,
  completeAll: false,
  maxDetailProducts: 20,
  maxDomains: 3,
  enrich: true,
  trend: true,
});
const parsedTerms = computed(() => [
  ...new Set(
    form.terms
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]);
const expected = computed(
  () =>
    parsedTerms.value.length *
    ((form.providers.includes('sorftime')
      ? Math.ceil(form.perKeyword / 20)
      : 0) +
      (form.providers.includes('semrush') ? 1 + form.maxDomains : 0) +
      (form.providers.includes('tiktok_shop') ? 1 : 0)),
);
let requestId = '';
let signature = '';
function show() {
  form.terms = (props.terms || []).join('\n');
  form.market = props.market || (state.market === 'ALL' ? 'US' : state.market);
  if (form.market === 'VN')
    form.providers = form.providers.filter(
      (provider) => provider !== 'sorftime',
    );
  open.value = true;
  resourceForm.terms = form.terms;
  resourceForm.market = form.market;
  void loadCapabilities();
  errorMessage.value = '';
  requestId = '';
  signature = '';
}
async function submit() {
  errorMessage.value = '';
  if (activeTab.value === 'resources') {
    await submitResource();
    return;
  }
  if (parsedTerms.value.length === 0 || parsedTerms.value.length > 100) {
    errorMessage.value = '请输入1～100个关键词，每行一个';
    return;
  }
  if (form.providers.length === 0) {
    errorMessage.value = '请选择至少一个来源';
    return;
  }
  if (form.market === 'VN' && form.providers.includes('sorftime')) {
    errorMessage.value = 'Sorftime Amazon 不支持越南，请取消此来源';
    return;
  }
  if (
    form.maxRequests > 0 &&
    form.maxRequests < parsedTerms.value.length * form.providers.length
  ) {
    errorMessage.value = `本次有${parsedTerms.value.length}个词、${form.providers.length}个来源，基础发现至少需要${parsedTerms.value.length * form.providers.length}次处理额度；请调整上限或减少关键词。`;
    return;
  }
  busy.value = true;
  try {
    const current = JSON.stringify(form);
    const submitted = JSON.parse(current);
    if (current !== signature) {
      requestId = crypto.randomUUID();
      signature = current;
    }
    await syncCloudWorkspace();
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_platform_products',
      { ...submitted, requestId },
    );
    requestId = '';
    signature = '';
    open.value = false;
    message.success('平台商品任务已提交后台，关闭页面后继续执行');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '提交失败，表单已保留';
  } finally {
    busy.value = false;
  }
}
async function submitResource() {
  errorMessage.value = validateResourceInput(
    resourceInput.value,
    resourceRoute.value,
  );
  if (errorMessage.value) return;
  if (
    !resourceRoute.value ||
    !resourceRouteAvailable(
      resourceRoute.value,
      capabilities.value?.configured || {},
    )
  ) {
    errorMessage.value =
      '当前路径尚未配置，请选择可用路径或在设置中补充现有凭据';
    return;
  }
  busy.value = true;
  try {
    const current = JSON.stringify(resourceInput.value);
    if (current !== signature) {
      requestId = crypto.randomUUID();
      signature = current;
    }
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_platform_products',
      { ...resourceInput.value, requestId },
    );
    requestId = '';
    signature = '';
    open.value = false;
    message.success('资源采集任务已提交后台');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (cause) {
    errorMessage.value =
      cause instanceof Error ? cause.message : '提交失败，表单已保留';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Tooltip :title="disabledMessage" :trigger="['hover', 'focus']">
    <span
      :tabindex="disabled || !serverMode ? 0 : undefined"
      :aria-label="disabledMessage || undefined"
      style="display: inline-flex"
    >
      <Button
        :disabled="disabled || !serverMode"
        type="primary"
        @click="show"
        >{{ label || '从平台获取商品' }}</Button
      >
    </span>
  </Tooltip>
  <Modal
    v-model:open="open"
    title="从平台获取商品"
    :width="900"
    :footer="activeTab === 'new-listings' ? null : undefined"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    :confirm-loading="busy"
    :closable="!busy"
    :mask-closable="!busy"
    :cancel-button-props="{ disabled: busy }"
    :ok-button-props="{ disabled: activeTab === 'new-listings' || submitDisabled }"
    ok-text="提交后台采集"
    @ok="submit"
  >
    <Tabs v-model:active-key="activeTab">
      <Tabs.TabPane key="new-listings" tab="新上架保健品"><DiscoveryPlanForm v-if="activeTab === 'new-listings'" kind="regular_new" @submitted="open=false" /></Tabs.TabPane>
      <Tabs.TabPane key="resources" tab="资源路径">
        <Spin :spinning="capabilitiesLoading">
          <Alert
            v-if="capabilitiesError"
            type="error"
            :message="capabilitiesError"
            show-icon
          >
            <template #action>
              <Button size="small" @click="loadCapabilities"> 重新读取 </Button>
            </template>
          </Alert>
          <Form
            :model="resourceForm"
            name="resource-discovery"
            layout="vertical"
            :disabled="busy || categoryLoading"
            class="resource-discovery-form"
          >
            <div class="platform-form-grid">
              <Form.Item label="目标国家" name="market">
                <Select
                  v-model:value="resourceForm.market"
                  :options="
                    markets.map((market) => ({
                      value: market.code,
                      label: `${market.name} · ${market.code}`,
                    }))
                  "
                />
              </Form.Item>
              <Form.Item label="平台 / 获取路径" name="routeId">
                <Select
                  v-model:value="resourceForm.routeId"
                  :options="routeOptions"
                  placeholder="选择已配置的路径"
                  :show-search="true"
                  option-filter-prop="label"
                />
              </Form.Item>
            </div>
            <Empty
              v-if="!capabilitiesLoading && !resourceRoute"
              description="当前国家没有可用的已配置路径"
            >
              <span class="hci-subtle"
                >查看下方来源能力与替代路径，或在设置中配置已有渠道凭据。</span
              >
            </Empty>
            <template v-if="resourceRoute">
              <Alert
                v-if="resourceRoute.reason"
                :message="resourceRoute.reason"
                type="info"
                show-icon
                class="resource-discovery-notice"
              />
              <Form.Item label="获取方式" name="mode">
                <Segmented
                  v-model:value="resourceForm.mode"
                  :options="
                    resourceRoute.modes.map((value) => ({
                      value,
                      label: resourceModeLabels[value],
                    }))
                  "
                />
              </Form.Item>
              <Form.Item
                v-if="resourceRoute.platform === 'website'"
                label="目标站点域名"
                name="websiteDomain"
              >
                <Input
                  v-model:value="resourceForm.websiteDomain"
                  placeholder="brand.com"
                />
              </Form.Item>
              <Form.Item
                v-if="resourceForm.mode === 'keyword'"
                label="关键词（每行一个，最多20个）"
                name="terms"
              >
                <Input.TextArea
                  v-model:value="resourceForm.terms"
                  :rows="3"
                  placeholder="creatine gummies"
                />
              </Form.Item>
              <template v-else-if="resourceForm.mode === 'category'">
                <Form.Item label="查询平台真实类目">
                  <div class="resource-category-query">
                    <Input
                      v-model:value="categoryQuery"
                      aria-label="查询平台类目名称或路径"
                      :maxlength="200"
                      placeholder="类目名称或路径，可留空查询入口"
                      @press-enter="queryCategories()"
                    />
                    <Button
                      :loading="categoryLoading"
                      @click="queryCategories()"
                    >
                      查询类目
                    </Button>
                  </div>
                  <p class="hci-subtle">
                    由
                    {{ resourceRoute.provider }}
                    返回类目；每次查询最多5个物理HTTP请求、1次Sorftime调用（含最多4个工具控制请求），独立于采集任务预算。
                  </p>
                </Form.Item>
                <Alert
                  v-if="categoryError"
                  :message="categoryError"
                  type="error"
                  show-icon
                  class="resource-discovery-notice"
                />
                <p v-if="categoryNotice" class="hci-subtle" role="status">
                  {{ categoryNotice }}
                </p>
                <Form.Item label="平台类目 / ID" name="categoryId">
                  <Select
                    v-model:value="resourceForm.categoryId"
                    :disabled="!categoryRows.length"
                    :show-search="true"
                    option-filter-prop="label"
                    placeholder="先查询，再选择返回的真实类目"
                    :options="
                      categoryRows.map((category) => ({
                        value: category.id,
                        label: `${category.path.join(' > ')} · ${category.id}`,
                      }))
                    "
                  />
                  <Button
                    v-if="resourceForm.categoryId"
                    size="small"
                    style="margin-top: 8px"
                    :loading="categoryLoading"
                    @click="queryCategories(resourceForm.categoryId)"
                  >
                    查询所选类目的下级
                  </Button>
                </Form.Item>
              </template>
              <Form.Item
                v-else
                label="公开商品 / 类目 / 内容页面（每行一个，最多100个）"
                name="urls"
              >
                <Input.TextArea
                  v-model:value="resourceForm.urls"
                  :rows="3"
                  placeholder="https://…"
                />
              </Form.Item>
              <Form.Item label="统一研究类目映射" name="researchCategory">
                <Select
                  v-model:value="resourceForm.researchCategory"
                  allow-clear
                  placeholder="可选，保留平台类目原始ID与路径"
                  :options="
                    researchCategories.map((value) => ({ label: value, value }))
                  "
                />
              </Form.Item>
              <div class="platform-form-grid">
                <Form.Item label="销量统计窗口" name="salesWindowDays">
                  <Segmented
                    v-model:value="resourceForm.salesWindowDays"
                    :options="
                      [30, 90, 180].map((value) => ({
                        value,
                        label: `近${value}天`,
                      }))
                    "
                  />
                </Form.Item>
                <Form.Item label="排名口径" name="ranking">
                  <Select
                    v-model:value="resourceForm.ranking"
                    :options="rankingOptions"
                  />
                </Form.Item>
                <Form.Item label="目标商品数量（最多100件）" name="maxProducts">
                  <InputNumber
                    v-model:value="resourceForm.maxProducts"
                    :min="1"
                    :max="
                      Math.min(100, resourceRoute.limits.maxProducts || 100)
                    "
                    :precision="0"
                  />
                </Form.Item>
                <Form.Item
                  label="发现 / 翻页 / 补全物理HTTP请求总上限"
                  :name="['budget', 'requests']"
                >
                  <InputNumber
                    v-model:value="resourceForm.budget.requests"
                    :min="1"
                    :max="500"
                    :precision="0"
                  />
                </Form.Item>
              </div>
              <Alert type="info" show-icon class="resource-discovery-notice">
                <template #message>
                  近{{
                    resourceForm.salesWindowDays
                  }}天是销量统计窗口，非上架时间筛选。
                </template>
                <template #description>
                  {{
                    resourceForm.ranking === 'sample'
                      ? '仅对本次有限采集的可比样本排名，未覆盖完整类目或全平台。'
                      : resourceForm.ranking === 'platform_bestsellers'
                        ? '保留来源热销榜口径，榜单不等于所选窗口销量。'
                        : '仅使用覆盖完整窗口、范围一致的销量；不足时保留缺失状态与实际样本范围。'
                  }}
                  {{
                    resourceRoute.history.reason ||
                    '今天采集不能补造过去180天；自然月、累计已售、BSR和展示增量分别保留。'
                  }}
                </template>
              </Alert>
              <Form.Item label="可用补全">
                <div class="resource-completion-options">
                  <Checkbox
                    v-model:checked="resourceForm.includeDetails"
                    :disabled="!resourceSupports(resourceRoute, 'detail')"
                  >
                    商品详情
                  </Checkbox>
                  <Checkbox
                    v-model:checked="resourceForm.includeHistory"
                    :disabled="!resourceSupports(resourceRoute, 'history')"
                  >
                    来源历史
                  </Checkbox>
                </div>
                <p
                  v-if="
                    !resourceSupports(resourceRoute, 'detail') ||
                    !resourceSupports(resourceRoute, 'history')
                  "
                  class="hci-subtle"
                >
                  {{
                    !resourceSupports(resourceRoute, 'detail')
                      ? '此路径不提供详情接口。'
                      : ''
                  }}
                  {{
                    !resourceSupports(resourceRoute, 'history')
                      ? resourceRoute.history.reason ||
                        '此路径不提供历史，保留本次观察并逐次积累。'
                      : ''
                  }}
                </p>
              </Form.Item>
              <Collapse class="resource-budget-collapse">
                <Collapse.Panel key="budget" header="独立预算与翻页上限">
                  <div class="platform-form-grid">
                    <Form.Item
                      label="来源调用次数上限"
                      :name="['budget', 'providerCalls']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.providerCalls"
                        :min="0"
                        :max="200"
                        :precision="0"
                      />
                    </Form.Item>
                    <Form.Item
                      label="Sorftime 调用上限"
                      :name="['budget', 'sorftimeCalls']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.sorftimeCalls"
                        :min="0"
                        :max="100"
                        :precision="0"
                      />
                    </Form.Item>
                    <Form.Item
                      label="ScrapeCreators credits 上限"
                      :name="['budget', 'scrapeCredits']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.scrapeCredits"
                        :min="0"
                        :max="100"
                        :precision="0"
                      />
                    </Form.Item>
                    <Form.Item
                      label="Brave 请求上限"
                      :name="['budget', 'braveRequests']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.braveRequests"
                        :min="0"
                        :max="50"
                        :precision="0"
                      />
                    </Form.Item>
                    <Form.Item
                      label="受控浏览器页面上限"
                      :name="['budget', 'browserPages']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.browserPages"
                        :min="0"
                        :max="0"
                        disabled
                      />
                      <p class="hci-subtle">此路径未启用受控浏览器</p>
                    </Form.Item>
                    <Form.Item
                      label="模型 token 上限"
                      :name="['budget', 'modelTokens']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.modelTokens"
                        :min="0"
                        :max="0"
                        disabled
                      />
                      <p class="hci-subtle">此路径不调用模型</p>
                    </Form.Item>
                    <Form.Item label="翻页上限" :name="['budget', 'maxPages']">
                      <InputNumber
                        v-model:value="resourceForm.budget.maxPages"
                        :min="1"
                        :max="resourceRoute.limits.maxPages || 20"
                        :precision="0"
                      />
                    </Form.Item>
                    <Form.Item
                      label="详情商品数上限"
                      :name="['budget', 'maxDetailProducts']"
                    >
                      <InputNumber
                        v-model:value="resourceForm.budget.maxDetailProducts"
                        :min="0"
                        :max="100"
                        :precision="0"
                      />
                    </Form.Item>
                  </div>
                  <p class="hci-subtle">
                    不同单位分别受限，0表示关闭。达到任一上限即保留已采集结果并记录停止原因。未知扣费结果不会自动重放。
                  </p>
                  <p class="hci-subtle">
                    物理HTTP请求包含工具控制、重定向与数据请求。Sorftime每个数据步骤最多5次HTTP，Semrush每步最多14次HTTP；提供方调用、credits与units另行计数。
                  </p>
                </Collapse.Panel>
              </Collapse>
              <dl class="resource-route-facts">
                <dt>费用单位</dt>
                <dd>
                  {{
                    resourceCostUnitLabels[resourceRoute.cost.unit] ||
                    resourceRoute.cost.unit
                  }}
                  ·
                  {{
                    resourceRoute.cost.reason ||
                    '受已配置账户余额与每任务预算限制'
                  }}
                </dd>
                <dt>销量字段</dt>
                <dd>
                  {{
                    resourceRoute.salesFields
                      .map(resourceSalesFieldDescription)
                      .join('；') || '来源没有交易销量字段'
                  }}
                </dd>
                <dt>验证状态</dt>
                <dd>
                  {{
                    resourceRoute.verification.reason ||
                    resourceRoute.verification.status
                  }}
                </dd>
              </dl>
            </template>
          </Form>
          <Collapse v-if="capabilities" class="resource-capability-collapse">
            <Collapse.Panel key="capabilities" header="来源能力与未覆盖路径">
              <div class="resource-capability-table-wrap">
                <table class="resource-capability-table">
                  <thead>
                    <tr>
                      <th>来源 / 国家</th>
                      <th>获取与历史</th>
                      <th>费用与验证</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="route in capabilities.routes" :key="route.id">
                      <td>
                        <strong>{{ route.label }}</strong>
                        <p>{{ route.markets.join(' / ') }}</p>
                      </td>
                      <td>
                        {{
                          route.modes
                            .map((mode) => resourceModeLabels[mode])
                            .join('、')
                        }}
                        <p>
                          {{
                            route.operations.includes('detail')
                              ? '可补详情'
                              : '无详情接口'
                          }}
                        </p>
                        <p>
                          {{
                            route.salesFields
                              .map(resourceSalesFieldDescription)
                              .join('；') || '无交易销量字段'
                          }}
                        </p>
                        <p>
                          {{
                            route.history.supported
                              ? `历史${route.history.maxDays ? `最多${route.history.maxDays}天` : '依账户返回'}`
                              : route.history.reason || '不提供历史'
                          }}
                        </p>
                        <p v-if="route.reason">{{ route.reason }}</p>
                        <p v-if="route.alternatives?.length">
                          替代：{{ route.alternatives.join('；') }}
                        </p>
                      </td>
                      <td>
                        {{
                          resourceCostUnitLabels[route.cost.unit] ||
                          route.cost.unit
                        }}
                        <p>
                          {{
                            resourceRouteAvailable(
                              route,
                              capabilities.configured,
                            )
                              ? route.verification.reason ||
                                route.verification.status
                              : route.unavailableReason || '未配置现有凭据'
                          }}
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div
                v-for="platform in unsupportedPlatforms"
                :key="platform.id"
                class="resource-platform-gap"
              >
                <strong>{{ platform.label }}</strong>
                <p>{{ platform.reason }}</p>
                <p v-if="platform.alternatives?.length" class="hci-subtle">
                  替代：{{ platform.alternatives.join('；') }}
                </p>
              </div>
            </Collapse.Panel>
          </Collapse>
        </Spin>
      </Tabs.TabPane>
      <Tabs.TabPane key="keywords" tab="关键词多来源">
        <Alert
          type="info"
          show-icon
          message="商品直接取自平台，不先抓整站。Sorftime 搜 Amazon，Semrush 查 Google Shopping，ScrapeCreators 搜 TikTok Shop；每条数据分别保留来源与采集时间。"
        />
        <Form layout="vertical" :disabled="busy" style="margin-top: 16px">
          <Form.Item label="关键词（每行一个，最多100个）">
            <Input.TextArea
              v-model:value="form.terms"
              :rows="4"
              placeholder="creatine gummies"
            />
          </Form.Item>
          <Form.Item label="目标市场">
            <Select
              v-model:value="form.market"
              :options="markets.map((m) => ({ label: m.name, value: m.code }))"
            />
          </Form.Item>
          <Form.Item label="数据来源">
            <Checkbox.Group
              v-model:value="form.providers"
              :options="[
                {
                  label: 'Sorftime · Amazon',
                  value: 'sorftime',
                  disabled: form.market === 'VN',
                },
                { label: 'Semrush · Google Shopping', value: 'semrush' },
                { label: 'ScrapeCreators · TikTok Shop', value: 'tiktok_shop' },
              ]"
            />
          </Form.Item>
          <div class="platform-form-grid">
            <Form.Item label="每词每来源商品上限">
              <InputNumber
                v-model:value="form.perKeyword"
                :min="1"
                :max="100"
              />
            </Form.Item>
            <Form.Item label="整批商品总数上限">
              <InputNumber
                v-model:value="form.maxProducts"
                :min="1"
                :max="1000"
              />
            </Form.Item>
            <Form.Item label="发现与补全共用请求上限">
              <InputNumber
                v-model:value="form.maxRequests"
                :min="1"
                :max="100000"
              />
            </Form.Item>
            <Form.Item label="商品详情补全数量上限">
              <InputNumber
                v-model:value="form.maxDetailProducts"
                :min="0"
                :max="1000"
              />
            </Form.Item>
            <Form.Item label="Semrush 每词商家数上限">
              <InputNumber
                v-model:value="form.maxDomains"
                :min="1"
                :max="5"
                :disabled="!form.providers.includes('semrush')"
              />
            </Form.Item>
          </div>
          <Form.Item label="补全范围">
            <Checkbox v-model:checked="form.completeAll">
              补全全部已发现商品（会显著增加请求）
            </Checkbox>
            ><Checkbox v-model:checked="form.enrich">
              商品详情与图片/属性 </Checkbox
            ><Checkbox v-model:checked="form.trend">
              ASIN月销量、大类排名与评论数历史
            </Checkbox>
          </Form.Item>
        </Form>
        <p class="hci-subtle">
          {{ parsedTerms.length }} 个词；基础发现参考约
          {{ expected }}
          次数据请求；过滤不相关商品可能追加翻页。发现与补全共用
          {{ form.maxRequests }} 次预算；默认最多补全
          {{ form.maxDetailProducts }}
          件，勾选“补全全部”后仍受共用预算约束。相同查询优先复用缓存。
        </p>
        <p class="hci-subtle">
          Sorftime 与 TikTok Shop 消耗现有平台额度，Semrush 按报告行消耗 API
          units；次数、credits 和 units 不是同一单位。TikTok
          销量只保存为采集时点累计快照。不会购买额度；缺历史、配方或剂量时记录平台返回情况，可在商品库再次补全。
        </p>
      </Tabs.TabPane>
    </Tabs>
    <CollectionEstimate
      v-if="open"
      :input="
        activeTab === 'resources'
          ? { kind: 'platform_products', ...resourceInput }
          : { kind: 'platform_products', ...form }
      "
    />
    <Alert v-if="errorMessage" :message="errorMessage" type="error" show-icon />
  </Modal>
</template>
<style scoped>
.platform-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.resource-discovery-form {
  margin-top: 8px;
}

.resource-discovery-form :deep(.ant-input-number) {
  width: 100%;
}

.resource-discovery-notice {
  margin-bottom: 16px;
}

.resource-category-query {
  display: flex;
  gap: 8px;
}

.resource-category-query :deep(.ant-input) {
  min-width: 0;
}

.resource-category-query :deep(.ant-btn) {
  flex-shrink: 0;
}

.resource-completion-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.resource-budget-collapse,
.resource-capability-collapse {
  margin-bottom: 16px;
}

.resource-route-facts {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px 12px;
  margin: 16px 0;
  font-size: 12px;
}

.resource-route-facts dt {
  color: var(--hci-muted, #666);
}

.resource-route-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.resource-capability-table-wrap {
  overflow-x: auto;
}

.resource-capability-table {
  width: 100%;
  min-width: 550px;
  font-size: 12px;
  border-collapse: collapse;
}

.resource-capability-table th,
.resource-capability-table td {
  padding: 10px 8px;
  vertical-align: top;
  text-align: left;
  border-bottom: 1px solid #e8e8e8;
}

.resource-capability-table p {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.resource-platform-gap {
  padding: 12px 0;
  border-bottom: 1px solid #e8e8e8;
}

.resource-platform-gap p {
  margin: 4px 0 0;
}

@media (width < 600px) {
  .platform-form-grid {
    grid-template-columns: 1fr;
  }

  .resource-category-query {
    flex-wrap: wrap;
  }

  .resource-category-query :deep(.ant-btn) {
    width: 100%;
  }

  .resource-route-facts {
    grid-template-columns: 72px minmax(0, 1fr);
  }
}
</style>

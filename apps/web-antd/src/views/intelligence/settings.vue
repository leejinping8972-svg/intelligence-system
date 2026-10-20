<script setup lang="ts">
import { computed, onDeactivated, reactive, ref } from 'vue';

import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Tag,
} from 'ant-design-vue';

import { clearCloudKeywords } from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import SemrushSettings from './components/SemrushSettings.vue';
import SiteCollectionSettings from './components/SiteCollectionSettings.vue';
import YouTubeSettings from './components/YouTubeSettings.vue';
import AdsSettings from './components/AdsSettings.vue';
import AnalysisSettings from './components/AnalysisSettings.vue';
import {
  audit,
  clearWorkspaceResults,
  defaultBranding,
  marketName,
  markets,
  state,
} from './data';
import { serverMode } from './session';
import {
  keywordSourceStatus,
  saveSorftimeConfiguration,
} from './site-discovery';

const draft = reactive({ ...state.settings });
const brandingDraft = reactive({ ...state.branding });
const logoInput = ref<HTMLInputElement>();
const resetOpen = ref(false);
const resetBusy = ref(false);
async function resetResults() {
  resetBusy.value = true;
  try {
    await clearCloudKeywords();
    clearWorkspaceResults();
    Object.assign(draft, state.settings);
    Object.assign(brandingDraft, state.branding);
    resetOpen.value = false;
    message.success('云端关键词及本机结果已清空，基础配置已保留');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '清除失败，未清空本机缓存',
    );
  } finally {
    resetBusy.value = false;
  }
}
const sorftimeToken = ref('');
const providerBusy = ref(false);
const sorftimeState = ref('尚未检测');
const providerMessage = ref(
  '填写 MCP ACCESS TOKEN 后保存到云端，再检测连接。连接检测不会执行关键词数据查询。',
);
onDeactivated(() => {
  sorftimeToken.value = '';
});
async function configureSorftime(saveToken = false) {
  if (!draft.researchApiUrl || !draft.researchAccessKey) {
    message.warning('请先填写下方研究服务地址与访问码');
    return;
  }
  if (saveToken && !sorftimeToken.value.trim()) {
    message.warning('请输入 MCP ACCESS TOKEN；留空不会覆盖云端已有密钥');
    return;
  }
  providerBusy.value = true;
  try {
    if (saveToken) {
      const result = await saveSorftimeConfiguration(
        draft.researchApiUrl,
        draft.researchAccessKey,
        sorftimeToken.value,
      );
      sorftimeToken.value = '';
      sorftimeState.value = '已配置 · 待检测';
      providerMessage.value = result.message;
      audit('配置 Sorftime MCP', '密钥已加密保存到云端，不记录密钥内容', 'ALL');
      message.success('Token 已保存，可点击检测连接');
    } else {
      const result = await keywordSourceStatus(
        draft.researchApiUrl,
        draft.researchAccessKey,
        true,
      );
      sorftimeState.value = '未配置';
      if (result.sorftime.configured)
        sorftimeState.value = '已配置 · 连接未通过';
      if (result.sorftime.ready) sorftimeState.value = '连接正常';
      providerMessage.value = result.sorftime.message;
    }
  } catch (error) {
    providerMessage.value =
      error instanceof Error ? error.message : '配置或检测失败';
    message.error(providerMessage.value);
  } finally {
    providerBusy.value = false;
  }
}
const selected = ref<{ name: string; status: string; detail: string }>();
const sources = [
  {
    mark: 'SF',
    name: 'Sorftime Amazon 关键词',
    status: 'MCP 接入 · 待配置',
    detail:
      '使用 MCP ACCESS TOKEN 获取美国、墨西哥 Amazon 延伸关键词。第一步不调用产品工具；站内数据不替代 Google 搜索量。密钥在本页云端配置区保存。',
  },
  {
    mark: 'DS',
    name: 'NIH DSLD 商品标签',
    status: '零成本自动',
    detail:
      '美国国家卫生研究院膳食补充剂标签库。自动获取商品、品牌、剂型和标签成分；收录日期不等于首次上市日期。',
  },
  {
    mark: 'FD',
    name: 'openFDA 召回 / CAERS',
    status: '零成本自动',
    detail:
      '自动获取美国召回记录和CAERS名称匹配汇总。公开报告不证明因果关系，也不能估计不良事件发生率。',
  },
  {
    mark: 'PM',
    name: 'PubMed / ClinicalTrials.gov',
    status: '零成本自动',
    detail:
      '自动获取近期论文和临床研究登记，用于跟踪研究方向。登记、发表与营销功效成立是不同口径。',
  },
  {
    mark: 'PC',
    name: 'PubChem 成分档案',
    status: '零成本自动',
    detail:
      '获取可明确匹配的单一成分标识、分子式和基础化学信息。复合物和泛品类不强行匹配。',
  },
  {
    mark: 'BS',
    name: 'Brave Search 独立站发现',
    status: '已接入',
    detail:
      '从关键词搜索结果发现候选域名，再访问候选官网验证商品、价格、购物车和独立站平台；不需要预先提供品牌名单。',
  },
  {
    mark: 'YT',
    name: 'YouTube Data API',
    status: '本页配置 Key',
    detail:
      '按美、墨、越市场跟踪新视频及公开互动量。在本页 YouTube 配置区加密保存 Key 并检测；每日公共情报采集自动读取。',
  },
  {
    mark: 'GD',
    name: 'GDELT 全球新闻',
    status: '零成本试运行',
    detail:
      '跟踪全球新闻提及。公共接口可能限流；限流时保留历史数据并显示状态，不阻塞其他来源。',
  },
  {
    mark: 'G',
    name: 'Google 联想词 / SERP',
    status: '联想词已接入',
    detail:
      '用于关键词发现与自然搜索结果。需核验服务商账号、国家参数、配额及使用许可。',
  },
  {
    mark: 'T',
    name: 'Google Trends',
    status: '零成本试运行',
    detail:
      '通过公开网页接口采集同市场过去一年相对趋势，并尝试补齐最近30天变化；限流或低数据量时保留具体原因。',
  },
  {
    mark: 'SL',
    name: 'Store Leads',
    status: '未接入',
    detail: '用于站点发现与背景补充。需要正式套餐和字段覆盖验证。',
  },
  {
    mark: 'SS',
    name: '卖家精灵',
    status: '导入优先',
    detail: '先使用已有关键词和ASIN导出资料；正式接口按权限与预算接入。',
  },
  {
    mark: 'AD',
    name: 'Meta / TikTok 广告',
    status: '导入优先',
    detail: '首版先导入资料、人工关联商品。自动来源需逐国验证授权。',
  },
];
const visibleMarkets = computed(() =>
  markets.filter((m) => state.market === 'ALL' || m.code === state.market),
);
function save() {
  const numericValues = [
    draft.taskBudget,
    draft.monthlyBudget,
    draft.trendLimit,
    draft.productsPerSite,
    draft.serpSearchCost,
    draft.trendsTaskCost,
    draft.trendsKeywordsPerTask,
    draft.storeLeadsMarketCost,
    draft.costBufferRate,
    draft.researchMaxSites,
  ];
  if (
    numericValues.some((value) => value === null || value < 0) ||
    draft.trendLimit < 1 ||
    draft.trendLimit > 100 ||
    draft.productsPerSite < 1 ||
    draft.productsPerSite > 20 ||
    draft.researchMaxSites < 1 ||
    draft.researchMaxSites > 10 ||
    draft.trendsKeywordsPerTask < 1 ||
    draft.trendsKeywordsPerTask > 5 ||
    draft.costBufferRate > 100
  ) {
    message.error('请检查预算和采集数量范围');
    return;
  }
  if (draft.researchApiUrl) {
    try {
      const url = new URL(draft.researchApiUrl);
      if (url.protocol !== 'https:') throw new Error('HTTPS required');
    } catch {
      message.error('研究服务地址必须是有效的HTTPS网址');
      return;
    }
  }
  Object.assign(state.settings, draft);
  audit(
    '保存研究配额',
    `任务预算$${draft.taskBudget} / 单站商品${draft.productsPerSite}`,
  );
  message.success('配置已保存；研究访问码只保存在当前浏览器');
}

function saveBranding() {
  const values = {
    appName: brandingDraft.appName.trim(),
    workspaceName: brandingDraft.workspaceName.trim(),
    businessName: brandingDraft.businessName.trim(),
    environmentLabel: brandingDraft.environmentLabel.trim(),
  };
  if (Object.values(values).some((value) => !value)) {
    message.error('基础配置名称不能为空');
    return;
  }
  Object.assign(state.branding, brandingDraft, values);
  audit('更新基础配置', `${values.appName} / ${values.workspaceName}`, 'ALL');
  message.success('基础配置已保存，并已同步到后台界面');
}

function resetBranding() {
  Object.assign(brandingDraft, defaultBranding);
  Object.assign(state.branding, defaultBranding);
  audit('恢复默认品牌配置', defaultBranding.appName, 'ALL');
  message.success('已恢复默认品牌配置');
}

function sourceStatus(source: (typeof sources)[number]) {
  if (source.name === 'Sorftime Amazon 关键词') return sorftimeState.value;
  if (source.name !== 'Brave Search 独立站发现') return source.status;
  return state.settings.researchApiUrl && state.settings.researchAccessKey
    ? '已配置'
    : '等待配置';
}

function chooseLogo() {
  logoInput.value?.click();
}

function handleLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    message.error('Logo 仅支持 PNG、JPG 或 WebP');
    return;
  }
  if (file.size > 512 * 1024) {
    message.error('Logo 文件不能超过 512KB');
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    brandingDraft.logo = String(reader.result);
    message.success('Logo 已载入，保存后同步到后台界面');
  });
  reader.addEventListener('error', () =>
    message.error('Logo 读取失败，请重新选择'),
  );
  reader.readAsDataURL(file);
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="数据源与设置"
      description="明确每个市场的覆盖边界，控制研究规模与成本。"
    />
    <SemrushSettings v-if="serverMode" />
    <SiteCollectionSettings v-if="serverMode" />
    <YouTubeSettings v-if="serverMode" />
    <AdsSettings v-if="serverMode" />
    <AnalysisSettings v-if="serverMode" />
    <section class="hci-panel" id="keyword-providers">
      <div class="hci-panel-head">
        <h2>关键词数据源 · Sorftime MCP</h2>
        <Tag>{{ sorftimeState }}</Tag>
      </div>
      <p class="hci-subtle">
        使用你已有的 MCP ACCESS TOKEN。保存到当前工作区的云端加密存储，不写入
        源代码，不保存在浏览器长期存储，也不会回显完整密钥。
      </p>
      <Form layout="vertical">
        <Form.Item label="Sorftime MCP ACCESS TOKEN">
          <Input.Password
            v-model:value="sorftimeToken"
            autocomplete="new-password"
            :maxlength="4096"
            placeholder="粘贴 Token 本身；已有配置时留空即可"
          />
        </Form.Item>
        <div class="hci-toolbar">
          <Button
            type="primary"
            :loading="providerBusy"
            :disabled="providerBusy || !sorftimeToken.trim()"
            @click="configureSorftime(true)"
          >
            加密保存到云端
          </Button>
          <Button
            :loading="providerBusy"
            :disabled="providerBusy"
            @click="configureSorftime(false)"
          >
            检测连接
          </Button>
          <a
            class="hci-link"
            href="https://open.sorftime.com/mcp"
            target="_blank"
            rel="noopener noreferrer"
            >打开 Sorftime MCP</a
          >
        </div>
      </Form>
      <p class="hci-evidence">{{ providerMessage }}</p>
      <p class="hci-subtle">
        美国、墨西哥：Amazon
        延伸词；越南不跨国替代。研究时需主动勾选此来源，调用次数根据结果数量、种子词、市场和扩词深度自动安排，达到结果数量即停止。调用使用你的平台额度，系统不会自动购买。此配置由当前工作区管理员管理。
      </p>
    </section>
    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>基础配置</h2>
          <p>统一管理左上角品牌、页面业务名称和右上角工作区入口。</p>
        </div>
        <Tag color="green">同步到服务器</Tag>
      </div>
      <div class="hci-branding-layout">
        <div class="hci-brand-preview">
          <div class="hci-brand-preview-title">界面预览</div>
          <div class="hci-brand-lockup">
            <img :src="brandingDraft.logo" alt="Logo 预览" />
            <div>
              <strong>{{ brandingDraft.appName || '后台名称' }}</strong>
              <span>{{ brandingDraft.businessName || '业务名称' }}</span>
            </div>
          </div>
          <div class="hci-workspace-preview">
            <Tag color="gold">
              {{ brandingDraft.environmentLabel || '环境标识' }}
            </Tag>
            <span>{{ brandingDraft.workspaceName || '工作区名称' }}</span>
          </div>
          <input
            ref="logoInput"
            class="hci-file-input"
            type="file"
            aria-label="上传 Logo"
            accept="image/png,image/jpeg,image/webp"
            @change="handleLogo"
          />
          <div class="hci-brand-logo-actions">
            <Button @click="chooseLogo">更换 Logo</Button>
            <span class="hci-subtle">PNG / JPG / WebP，最大 512KB</span>
          </div>
        </div>
        <Form layout="vertical" class="hci-brand-form">
          <div class="hci-form-grid">
            <Form.Item label="后台名称">
              <Input
                v-model:value="brandingDraft.appName"
                aria-label="后台名称"
                :maxlength="20"
                show-count
                placeholder="例如：知衡情报"
              />
            </Form.Item>
            <Form.Item label="工作区名称">
              <Input
                v-model:value="brandingDraft.workspaceName"
                aria-label="工作区名称"
                :maxlength="20"
                show-count
                placeholder="例如：知衡工作区"
              />
            </Form.Item>
            <Form.Item label="业务名称">
              <Input
                v-model:value="brandingDraft.businessName"
                aria-label="业务名称"
                :maxlength="30"
                show-count
                placeholder="显示在页面标题上方"
              />
            </Form.Item>
            <Form.Item label="环境标识">
              <Input
                v-model:value="brandingDraft.environmentLabel"
                aria-label="环境标识"
                :maxlength="12"
                show-count
                placeholder="例如：前台演示"
              />
            </Form.Item>
          </div>
          <div class="hci-brand-actions">
            <Button type="primary" @click="saveBranding">保存基础配置</Button>
            <Button @click="resetBranding">恢复默认</Button>
          </div>
        </Form>
      </div>
    </section>
    <div class="hci-equal-col">
      <section class="hci-panel">
        <div class="hci-panel-head">
          <h2>首批市场</h2>
          <Tag color="green">{{ visibleMarkets.length }}个国家</Tag>
        </div>
        <div v-for="m in visibleMarkets" :key="m.code" class="hci-market-row">
          <span class="hci-market-code">{{ m.code }}</span>
          <div class="hci-market-detail">
            <h3>{{ m.name }}</h3>
            <p class="hci-subtle">{{ m.language }} · {{ m.currency }}</p>
          </div>
          <Tag>已配置</Tag>
        </div>
        <p class="hci-subtle" style="margin-top: 18px">
          其他国家后续扩展。已配置国家不代表第三方来源已获授权。
        </p>
      </section>
      <section class="hci-panel">
        <div class="hci-panel-head"><h2>研究服务与成本配置</h2></div>
        <Form layout="vertical">
          <div class="hci-form-grid">
            <Form.Item label="单任务预算（USD）">
              <InputNumber
                v-model:value="draft.taskBudget"
                :min="0"
              /> </Form.Item
            ><Form.Item label="月度预算（USD）">
              <InputNumber
                v-model:value="draft.monthlyBudget"
                :min="0"
              /> </Form.Item
            ><Form.Item label="单任务趋势查询项">
              <InputNumber
                v-model:value="draft.trendLimit"
                :min="1"
                :max="100"
              /> </Form.Item
            ><Form.Item label="每站商品上限">
              <InputNumber
                v-model:value="draft.productsPerSite"
                :min="1"
                :max="20"
              />
            </Form.Item>
          </div>
          <div class="hci-form-section-title hci-full">关键词找独立站</div>
          <div class="hci-form-grid hci-full">
            <Form.Item label="研究服务地址">
              <Input
                v-model:value="draft.researchApiUrl"
                placeholder="https://43.172.66.45/api"
                :readonly="serverMode"
              />
            </Form.Item>
            <Form.Item v-if="!serverMode" label="研究访问码">
              <Input.Password
                v-model:value="draft.researchAccessKey"
                placeholder="填写原研究访问码"
                autocomplete="off"
              />
            </Form.Item>
            <Form.Item label="每组最多保留站点">
              <InputNumber
                v-model:value="draft.researchMaxSites"
                :min="1"
                :max="10"
              />
            </Form.Item>
          </div>
          <div class="hci-cost-reference hci-full">
            研究接口和采集服务运行在腾讯云。Brave Search
            用于发现候选域名，再访问官网核验商品与站点信息。
            平台密钥加密保存在服务器；正式后台通过账号登录使用。关键词后台任务可一次提交最多100个结果，后台分步执行并保存进度；接口配额和网站访问限制仍可能影响结果数量。
          </div>
          <div class="hci-form-section-title hci-full">成本估算规则</div>
          <div class="hci-form-grid hci-full">
            <Form.Item label="SerpApi 单次搜索成本（USD）">
              <InputNumber
                v-model:value="draft.serpSearchCost"
                :min="0"
                :precision="4"
                :step="0.001"
              />
            </Form.Item>
            <Form.Item label="Trends 单任务成本（USD）">
              <InputNumber
                v-model:value="draft.trendsTaskCost"
                :min="0"
                :precision="4"
                :step="0.0001"
              />
            </Form.Item>
            <Form.Item label="Trends 每任务关键词数">
              <InputNumber
                v-model:value="draft.trendsKeywordsPerTask"
                :min="1"
                :max="5"
              />
            </Form.Item>
            <Form.Item label="Store Leads 每市场分摊（USD）">
              <InputNumber
                v-model:value="draft.storeLeadsMarketCost"
                :min="0"
                :precision="4"
                :step="0.01"
              />
            </Form.Item>
            <Form.Item label="预算预留比例（%）">
              <InputNumber
                v-model:value="draft.costBufferRate"
                :min="0"
                :max="100"
              />
            </Form.Item>
          </div>
          <div class="hci-cost-reference hci-full">
            默认参考：SerpApi Developer 套餐 $75 / 5,000 次，折算
            $0.015/次；DataForSEO Trends $0.0012/任务、每任务最多5词。Store
            Leads
            按实际套餐填写分摊成本。价格会变化，正式接入时以供应商账单为准。
            <a
              href="https://serpapi.com/pricing"
              target="_blank"
              rel="noreferrer"
              >SerpApi 价格</a
            >
            ·
            <a
              href="https://dataforseo.com/pricing/keywords-data/dataforseo-trends-api-pricing"
              target="_blank"
              rel="noreferrer"
              >Trends 价格</a
            >
          </div>
          <Button type="primary" @click="save">保存配置</Button
          ><span class="hci-subtle" style="margin-left: 12px"
            >预算0：禁止付费</span
          >
        </Form>
      </section>
    </div>
    <section class="hci-panel">
      <div class="hci-panel-head">
        <h2>{{ marketName(state.market) }} · 数据来源</h2>
        <span class="hci-subtle">平台密钥仅在服务器加密保存</span>
      </div>
      <div v-for="s in sources" :key="s.name" class="hci-source-card">
        <div class="hci-source-mark">{{ s.mark }}</div>
        <div class="hci-source-info">
          <h3>{{ s.name }}</h3>
          <p class="hci-subtle">
            {{
              s.name === '卖家精灵' && state.market === 'VN'
                ? '越南不支持本地Amazon / ASIN指标；可研究美国或墨西哥市场。'
                : s.detail
            }}
          </p>
        </div>
        <Tag
          :color="
            sourceStatus(s).includes('自动') || sourceStatus(s) === '已配置'
              ? 'green'
              : sourceStatus(s) === '未接入'
                ? 'default'
                : 'orange'
          "
        >
          {{
            s.name === '卖家精灵' && state.market === 'VN'
              ? '本地站点不支持'
              : sourceStatus(s)
          }} </Tag
        ><Button size="small" @click="selected = s">接入说明</Button>
      </div>
    </section>
    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>工作区结果管理</h2>
          <p>
            业务结果、收藏、审核、导入记录及监控设置会同步到服务器，本机保留缓存。尚未实现完整的多人角色权限管理。
          </p>
        </div>
        <Button danger @click="resetOpen = true">清空全部结果数据</Button>
      </div>
    </section>
    <Modal
      v-model:open="resetOpen"
      title="清空云端关键词及本机全部结果数据？"
      :confirm-loading="resetBusy"
      ok-text="确认清空"
      cancel-text="保留数据"
      @ok="resetResults"
    >
      <p>
        这会清除云端保存的关键词、趋势和关键词任务，以及本机的独立站、商品、广告、审核、监控、导入历史和操作记录。请先取消正在运行的后台任务并导出需要保留的数据。后台名称、服务地址、研究访问码和密钥配置会保留。
      </p> </Modal
    ><Modal
      :open="!!selected"
      :title="selected?.name"
      :footer="null"
      @cancel="selected = undefined"
    >
      <p style="padding: 18px 0">{{ selected?.detail }}</p>
      <div class="hci-evidence">
        后续接入步骤：确认账号与许可 → 验证美/墨/越覆盖 → 配置服务端密钥 →
        小样本测试 → 启用预算控制。
      </div>
    </Modal>
  </main>
</template>

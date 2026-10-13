<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  Button,
  Tag,
  Input,
  InputNumber,
  Form,
  Modal,
  message,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import {
  state,
  markets,
  marketName,
  resetDemo,
  audit,
  defaultBranding,
} from './data';

const draft = reactive({ ...state.settings });
const brandingDraft = reactive({ ...state.branding });
const logoInput = ref<HTMLInputElement>();
const resetOpen = ref(false);
const selected = ref<{ name: string; status: string; detail: string }>();
const sources = [
  {
    name: 'Google 联想词 / SERP',
    status: '未接入',
    detail:
      '用于关键词发现与自然搜索结果。需核验服务商账号、国家参数、配额及使用许可。',
  },
  {
    name: 'Google Trends',
    status: '未接入',
    detail: '用于同市场90天相对趋势。查询尺度、批次和低数据量状态单独保存。',
  },
  {
    name: 'Store Leads',
    status: '未接入',
    detail: '用于站点发现与背景补充。需要正式套餐和字段覆盖验证。',
  },
  {
    name: '卖家精灵',
    status: '导入优先',
    detail: '先使用已有关键词和ASIN导出资料；正式接口按权限与预算接入。',
  },
  {
    name: 'Meta / TikTok 广告',
    status: '导入优先',
    detail: '首版先导入资料、人工关联商品。自动来源需逐国验证授权。',
  },
];
const visibleMarkets = computed(() =>
  markets.filter((m) => state.market === 'ALL' || m.code === state.market),
);
function save() {
  if (
    Object.values(draft).some((v) => v === null || v < 0) ||
    draft.trendLimit < 1 ||
    draft.trendLimit > 100 ||
    draft.productsPerSite < 1 ||
    draft.productsPerSite > 50 ||
    draft.trendsKeywordsPerTask < 1 ||
    draft.trendsKeywordsPerTask > 5 ||
    draft.costBufferRate > 100
  ) {
    message.error('请检查预算和采集数量范围');
    return;
  }
  Object.assign(state.settings, draft);
  audit(
    '保存演示配额',
    `任务预算$${draft.taskBudget} / 单站商品${draft.productsPerSite}`,
  );
  message.success('配置已保存；当前不会发生付费调用');
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
  audit(
    '更新基础配置',
    `${values.appName} / ${values.workspaceName}`,
    'ALL',
  );
  message.success('基础配置已保存，并已同步到后台界面');
}

function resetBranding() {
  Object.assign(brandingDraft, defaultBranding);
  Object.assign(state.branding, defaultBranding);
  audit('恢复默认品牌配置', defaultBranding.appName, 'ALL');
  message.success('已恢复默认品牌配置');
}

function chooseLogo() {
  logoInput.value?.click();
}

function handleLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    message.error('Logo 仅支持 PNG、JPG 或 WebP');
    return;
  }
  if (file.size > 512 * 1024) {
    message.error('Logo 文件不能超过 512KB');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    brandingDraft.logo = String(reader.result);
    message.success('Logo 已载入，保存后同步到后台界面');
  };
  reader.onerror = () => message.error('Logo 读取失败，请重新选择');
  reader.readAsDataURL(file);
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="数据源与设置"
      description="明确每个市场的覆盖边界，控制研究规模与成本。"
    />
    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>基础配置</h2>
          <p>统一管理左上角品牌、页面业务名称和右上角工作区入口。</p>
        </div>
        <Tag color="green">当前浏览器生效</Tag>
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
            <Tag color="gold">{{ brandingDraft.environmentLabel || '环境标识' }}</Tag>
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
        <div class="hci-panel-head"><h2>工作区共享配额 · 演示配置</h2></div>
        <Form layout="vertical"
          ><div class="hci-form-grid">
            <Form.Item label="单任务预算（USD）"
              ><InputNumber
                v-model:value="draft.taskBudget"
                :min="0" /></Form.Item
            ><Form.Item label="月度预算（USD）"
              ><InputNumber
                v-model:value="draft.monthlyBudget"
                :min="0" /></Form.Item
            ><Form.Item label="单任务趋势查询项"
              ><InputNumber
                v-model:value="draft.trendLimit"
                :min="1"
                :max="100" /></Form.Item
            ><Form.Item label="每站商品上限"
              ><InputNumber
                v-model:value="draft.productsPerSite"
                :min="1"
                :max="50"
            /></Form.Item>
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
            Leads 按实际套餐填写分摊成本。价格会变化，正式接入时以供应商账单为准。
            <a href="https://serpapi.com/pricing" target="_blank" rel="noreferrer"
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
          ></Form
        >
      </section>
    </div>
    <section class="hci-panel">
      <div class="hci-panel-head">
        <h2>{{ marketName(state.market) }} · 数据来源</h2>
        <span class="hci-subtle">密钥将在服务端配置，前台演示不收集密钥</span>
      </div>
      <div v-for="(s, i) in sources" :key="s.name" class="hci-source-card">
        <div class="hci-source-mark">{{ ['G', 'T', 'S', 'S', 'AD'][i] }}</div>
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
        <Tag :color="s.status === '未接入' ? 'default' : 'orange'">{{
          s.name === '卖家精灵' && state.market === 'VN'
            ? '本地站点不支持'
            : s.status
        }}</Tag
        ><Button size="small" @click="selected = s">接入说明</Button>
      </div>
    </section>
    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>演示数据管理</h2>
          <p>
            收藏、审核、导入及监控设置保存在当前浏览器。正式权限与审计由后端实现。
          </p>
        </div>
        <Button danger @click="resetOpen = true">重置演示数据</Button>
      </div>
    </section>
    <Modal
      v-model:open="resetOpen"
      title="重置此浏览器的演示工作区？"
      ok-text="确认重置"
      cancel-text="保留数据"
      @ok="
        resetDemo();
        Object.assign(draft, state.settings);
        Object.assign(brandingDraft, state.branding);
        resetOpen = false;
        message.success('演示数据已恢复');
      "
      ><p>
        这会清除本地导入、收藏、审核和任务，恢复初始样本。电脑上的原始文件不会受到影响。
      </p></Modal
    ><Modal
      :open="!!selected"
      :title="selected?.name"
      :footer="null"
      @cancel="selected = undefined"
      ><p style="padding: 18px 0">{{ selected?.detail }}</p>
      <div class="hci-evidence">
        后续接入步骤：确认账号与许可 → 验证美/墨/越覆盖 → 配置服务端密钥 →
        小样本测试 → 启用预算控制。
      </div></Modal
    >
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { Button, Drawer, Progress, Tag } from 'ant-design-vue';

import { marketName, state } from '../data';
import CompactTags from './CompactTags.vue';
import ProductCollectDialog from './ProductCollectDialog.vue';

const props = defineProps<{ id?: string }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const site = computed(() => state.sites.find((item) => item.id === props.id));
const products = computed(() =>
  state.products.filter((item) => item.siteId === props.id),
);
const sources = computed(() =>
  site.value?.sources?.length
    ? site.value.sources
    : [
        site.value?.dataNature === 'imported'
          ? '人工导入'
          : '历史采集 · 来源待核对',
      ],
);
function go(path: string, query: Record<string, string>) {
  emit('close');
  void router.push({ path, query });
}
</script>
<template>
  <Drawer
    :open="!!site"
    width="min(940px, 100vw)"
    root-class-name="hci-resource-drawer"
    title="独立站档案"
    @close="emit('close')"
  >
    <template v-if="site">
      <header class="hci-resource-hero">
        <div class="hci-resource-avatar" aria-hidden="true">
          {{ site.brand.slice(0, 1).toUpperCase() }}
        </div>
        <div class="hci-resource-heading">
          <p class="hci-eyebrow">
            {{ marketName(site.market) }} · {{ site.platform || '平台待识别' }}
          </p>
          <h2>{{ site.brand }}</h2>
          <p class="hci-subtle hci-break">{{ site.domain }}</p>
          <Tag>{{ site.category || '类别待确认' }}</Tag><Tag>{{ site.type || '类型待确认' }}</Tag>
        </div>
        <div class="hci-resource-score">
          <strong>{{ site.assessment?.score ?? '—' }}</strong><span>/ 100</span>
          <p>
            {{ site.assessment?.grade || '待评分' }} · 覆盖
            {{ site.assessment?.coverage ?? 0 }}%
          </p>
        </div>
      </header>
      <div class="hci-resource-metrics">
        <div>
          <span>关联商品</span><b>{{ products.length }}</b>
        </div>
        <div>
          <span>自然搜索流量估算</span><b>{{ site.metrics?.organicTraffic ?? '—' }}</b>
        </div>
        <div>
          <span>付费搜索流量估算</span><b>{{ site.metrics?.paidTraffic ?? '—' }}</b>
        </div>
        <div>
          <span>自然关键词数</span><b>{{ site.metrics?.organicKeywords ?? '—' }}</b>
        </div>
      </div>
      <section class="hci-detail-section">
        <h3>站点概况</h3>
        <dl class="hci-detail-grid">
          <dt>销售市场</dt>
          <dd>{{ marketName(site.market) }}</dd>
          <dt>电商平台</dt>
          <dd>{{ site.platform || '未识别' }}</dd>
          <dt>发现关键词</dt>
          <dd>{{ site.keyword || '未记录' }}</dd>
          <dt>最近采集</dt>
          <dd>{{ site.lastCollectedAt || '未记录' }}</dd>
          <dt>验证置信度</dt>
          <dd>{{ site.confidence ?? '未记录' }}</dd>
          <dt>档案性质</dt>
          <dd>
            {{
              site.dataNature === 'demo'
                ? '演示数据'
                : site.dataNature === 'imported'
                  ? '人工导入'
                  : '已采集档案'
            }}
          </dd>
        </dl>
        <CompactTags
          v-if="site.signals?.length"
          :items="site.signals"
          label="验证信号"
        />
      </section>
      <section class="hci-detail-section">
        <h3>
          主要产品 <small>{{ site.mainProducts.length }} 项</small>
        </h3>
        <CompactTags :items="site.mainProducts" label="站点主要产品" />
      </section>
      <section class="hci-detail-section">
        <h3>评分与第三方指标</h3>
        <p class="hci-subtle">
          研究优先级，不是营收或盈利预测。{{
            site.metricsStatus || '第三方指标待补充'
          }}
          {{ site.metricsMessage }}
        </p>
        <p class="hci-subtle hci-break">
          来源 {{ site.metrics?.source || '未提供' }} · 市场
          {{ site.metrics?.market || '—' }} · 获取日期
          {{ site.metrics?.collectedAt || '未记录' }}
        </p>
        <div class="hci-dimension-grid">
          <article
            v-for="dimension in site.assessment?.dimensions"
            :key="dimension.key"
            class="hci-dimension-card"
          >
            <div>
              <b>{{ dimension.label }}</b><strong>{{ dimension.value ?? '待补充' }}</strong>
            </div>
            <Progress
              :percent="dimension.value ?? 0"
              :show-info="false"
              size="small"
            />
            <p>{{ dimension.evidence }}</p>
            <small>权重 {{ dimension.weight }}%</small>
          </article>
        </div>
      </section>
      <section class="hci-detail-section">
        <h3>发现来源与证据</h3>
        <CompactTags :items="sources" label="全部数据来源" color="blue" />
        <article
          v-for="(evidence, index) in site.sourceEvidence"
          :key="index"
          class="hci-source-record"
        >
          <div>
            <b>{{ evidence.source }}</b><time>{{ evidence.collectedAt || '日期未记录' }}</time>
          </div>
          <p v-if="evidence.keyword">发现词：{{ evidence.keyword }}</p>
          <a
            v-if="evidence.url"
            :href="evidence.url"
            target="_blank"
            rel="noreferrer"
            >查看原始证据 ↗</a>
          <p v-if="evidence.landingUrl" class="hci-subtle hci-break">
            落地页：{{ evidence.landingUrl }}
          </p>
        </article>
        <p v-if="!site.sourceEvidence?.length" class="hci-subtle">
          历史记录未保存逐条发现证据。
        </p>
      </section>
      <section class="hci-detail-section">
        <h3>官网背景与运营主体</h3>
        <dl class="hci-detail-grid">
          <dt>股权背景</dt>
          <dd>{{ site.ownershipBackground || '未核验' }}</dd>
          <dt>运营主体</dt>
          <dd>{{ site.ownershipOperations || '未核验' }}</dd>
          <dt>官网来源</dt>
          <dd class="hci-detail-wide">
            {{ site.ownershipSource || '未提供' }}
          </dd>
        </dl>
        <blockquote class="hci-resource-quote">
          {{ site.ownershipEvidence || '暂无可核验的官网原文。' }}
        </blockquote>
        <a
          v-if="site.evidenceUrl"
          :href="site.evidenceUrl"
          target="_blank"
          rel="noreferrer"
          >打开官网验证页面 ↗</a>
        <p class="hci-subtle">
          首次观察不等于成立日期；股权与运营主体以官网原文及人工核验为准。
        </p>
      </section>
      <footer class="hci-detail-actions">
        <Button type="primary" @click="go('/products', { site: site.id })">
          查看商品（{{ products.length }}）
</Button><ProductCollectDialog :site-ids="[site.id]" /><Button
          @click="go('/ads', { site: site.id })"
        >
          关联广告
</Button><Button @click="go('/consumer-insights', { site: site.id })">
          消费者需求
        </Button>
      </footer>
    </template>
  </Drawer>
</template>

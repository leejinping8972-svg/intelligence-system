<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Alert, Button, Drawer, message, Tabs, Tag } from 'ant-design-vue';
import { loadWorkspaceDetail } from '../cloud-workspace';

import {
  marketName,
  money,
  monitorProduct,
  state,
  toggleFavorite,
} from '../data';
import ProductArt from './ProductArt.vue';
import CollectionTime from './CollectionTime.vue';
import { productCollectedAt } from '../resource-metadata';
import ProductDecisionTags from './ProductDecisionTags.vue';
import ProductCompletionDialog from './ProductCompletionDialog.vue';
import { productDataSource } from '../product-decisions';
import PublicContentLauncher from './PublicContentLauncher.vue';
import CoreMetricsPanel from './CoreMetricsPanel.vue';
const props = defineProps<{ id?: string }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const detailError = ref('');
watch(() => props.id, async (id) => {
  detailError.value = '';
  if (!id) return;
  try {
    await loadWorkspaceDetail('products', id);
    const siteId = state.products.find((row) => row.id === id)?.siteId;
    if (siteId) await loadWorkspaceDetail('sites', siteId);
  } catch (cause) { if (props.id === id) detailError.value = (cause as Error).message; }
}, { immediate: true });
const product = computed(() => state.products.find((p) => p.id === props.id));
const productSite = computed(() =>
  state.sites.find((site) => site.id === product.value?.siteId),
);
function addMonitor() {
  if (product.value) {
    monitorProduct(product.value.id);
    message.success('已加入监控');
  }
}
</script>
<template>
  <Drawer
    :open="!!id"
    width="min(940px, 100vw)"
    root-class-name="hci-resource-drawer"
    title="商品情报详情"
    @close="emit('close')"
  >
    <Alert v-if="detailError" type="error" :message="detailError" show-icon />
    <template v-if="product">
      <div class="hci-product-detail-hero"><ProductArt
        :color="product.color"
        :brand="product.brand"
        :image-url="product.imageUrl"
        :source-label="productDataSource(product)"
      />
      <div class="hci-resource-heading">
        <p class="hci-product-brand">
          {{ product.brand }} · {{ marketName(product.market) }}
        </p>
        <h2 class="hci-resource-title">{{ product.title }}</h2>
        <p class="hci-subtle">最近采集：<CollectionTime :at="productCollectedAt(product)" /></p>
        <div style="display: flex; gap: 12px; margin: 14px 0">
          <Tag :color="product.reviewed ? 'green' : 'orange'">
            {{
              product.reviewed
                ? '审核已确认'
                : product.dataNature === 'collected'
                  ? `${productDataSource(product)} · 待核验`
                  : '演示 · 待核验'
            }} </Tag
          ><Tag>{{ product.category }}</Tag>
        </div>
      </div></div>
      <ProductCompletionDialog :product-ids="[product.id]" compact />
      <Tabs>
        <Tabs.TabPane key="core-evidence" tab="销售、价格与数据证据"><CoreMetricsPanel kind="products" :record="product" /></Tabs.TabPane>
        <Tabs.TabPane
          v-if="product.sourceProvider"
          key="platform"
          tab="平台数据与素材"
        >
          <dl class="hci-detail-grid">
            <dt>数据来源</dt>
            <dd>{{ productDataSource(product) }} · {{ product.market }}</dd>
            <dt>平台商品标识</dt>
            <dd>{{ product.sourceProductId }}</dd>
            <dt>平台上架日期</dt>
            <dd>
              {{
                product.decisionData?.listing?.date ||
                '未返回，不按首次发现日期代替'
              }}
            </dd>
            <dt>评分 / 评论数</dt>
            <dd>
              {{ product.sourceMetrics?.rating ?? '未知' }} /
              {{ product.sourceMetrics?.reviewCount ?? '未知' }}
            </dd>
            <dt>平台月销量指标</dt>
            <dd>
              {{ product.sourceMetrics?.monthlySales ?? '未知' }}
              <p class="hci-subtle">
                平台基础资料口径，变体范围待确认；决策标签只使用明确属于当前
                ASIN 的历史月销量，不与此值混算。
              </p>
            </dd>
            <dt>平台潜力指数</dt>
            <dd>{{ product.sourceMetrics?.platformPotential ?? '未评估' }}</dd>
            <dt>Shopping 排名</dt>
            <dd>
              {{ product.sourceMetrics?.position ?? '未知' }}
              <p v-if="product.sourceMetrics?.keyword" class="hci-subtle">
                对应词：{{ product.sourceMetrics.keyword }}
              </p>
            </dd>
            <dt>平台店铺</dt>
            <dd>{{ product.sourceMetrics?.shopName || '未返回' }}</dd>
            <dt>来源快照日期</dt>
            <dd>
              {{
                product.sourceMetrics?.observedAt?.slice(0, 10) || '平台未提供'
              }}
              <p
                v-if="product.sourceMetrics?.urlKind === 'merchant_landing'"
                class="hci-subtle"
              >
                平台记录指向商家首页；按标题区分商品，尚未核验具体SKU，价格是来源快照。
              </p>
            </dd>
            <dt>采集时间</dt>
            <dd><CollectionTime :at="product.sourceMetrics?.collectedAt" /></dd>
          </dl>
          <h3 class="hci-section-heading">商品属性原文</h3>
          <dl v-if="product.sourceContent?.attributes" class="hci-detail-grid">
            <template
              v-for="(value, key) in product.sourceContent.attributes"
              :key="key"
              ><dt>{{ key }}</dt>
              <dd>{{ value }}</dd></template
            >
          </dl>
          <p
            v-if="!Object.keys(product.sourceContent?.attributes || {}).length"
            class="hci-subtle"
          >
            尚未补充属性，未知字段不会由模型猜填。
          </p>
          <h3 class="hci-section-heading">商品描述原文</h3>
          <p
            v-for="(description, i) in product.sourceContent?.descriptions ||
            []"
            :key="i"
            style="white-space: pre-wrap; line-height: 1.7; margin: 12px 0"
          >
            {{ description }}
          </p>
          <div
            style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px"
          >
            <a
              v-for="url in product.imageUrls?.slice(0, 6) || []"
              :key="url"
              :href="url"
              target="_blank"
              rel="noreferrer"
              ><img
                :src="url"
                alt="平台商品素材"
                loading="lazy"
                style="width: 100px; height: 100px; object-fit: contain"
            /></a>
          </div>
          <p class="hci-subtle">
            平台商品描述和卖点属于品牌原文，不等于已验证的成品功效。
          </p>
        </Tabs.TabPane>
        <Tabs.TabPane key="decisions" tab="商品决策标签">
          <ProductDecisionTags :product="product" details />
        </Tabs.TabPane>
        <Tabs.TabPane key="details" tab="配方与规格">
          <dl class="hci-detail-grid">
            <dt>包装规格</dt>
            <dd>{{ product.size }}</dd>
            <dt>剂型</dt>
            <dd>{{ product.form }}</dd>
            <dt>原币种标价</dt>
            <dd class="hci-price">
              {{
                product.price > 0
                  ? money(product.price, product.currency)
                  : '价格待获取'
              }}
            </dd>
            <dt>成分原文</dt>
            <dd>{{ product.ingredient }}</dd>
            <dt>每份剂量</dt>
            <dd>{{ product.dose }}</dd>
            <dt>竞品宣称</dt>
            <dd>
              {{ product.claim }}
              <div class="hci-subtle">营销宣称示例，不代表科学验证的功效</div>
            </dd>
            <dt>采集完整度</dt>
            <dd>
              {{ product.collectionFields?.join('、') || '等待补采' }}
            </dd>
            <dt>科学证据状态</dt>
            <dd>未知 / 未核验</dd>
          </dl> </Tabs.TabPane
        ><Tabs.TabPane key="analysis" tab="卖点与成分分析">
          <h3 class="hci-section-heading">{{ product.sourceProvider ? '平台商品卖点原文' : '官网功效卖点提取' }}</h3>
          <div class="hci-compact-tags" style="margin: 12px 0">
            <Tag
              v-for="benefit in product.benefits"
              :key="benefit"
              color="green"
            >
              {{ benefit }}
            </Tag>
          </div>
          <div class="hci-evidence">
            <b>卖点原文依据</b><br />{{ product.benefitEvidence }}
            <div class="hci-subtle">
              品牌宣称不等于医学功效，入库后仍需人工审核。
            </div>
          </div>
          <h3 class="hci-section-heading">成分分析</h3>
          <div
            v-for="item in product.ingredientInsights"
            :key="`${item.name}-${item.amount}`"
            class="hci-ingredient-record"
          >
            <div>
              <strong>{{ item.name }}</strong>
              <Tag>{{ item.amount }}</Tag>
            </div>
            <p>{{ item.role }}</p>
            <small>依据：{{ item.evidence }}</small>
          </div> </Tabs.TabPane
        ><Tabs.TabPane key="evidence" tab="来源与证据">
          <div class="hci-evidence">
            <template v-if="product.sourceProvider"
              ><b>{{ productDataSource(product) }} 商品记录</b>
              <p>平台标识：{{ product.sourceProductId }}</p>
              <a
                :href="product.sourceUrl || product.evidenceUrl"
                target="_blank"
                rel="noreferrer"
                >打开平台商品来源</a
              ></template
            >
            <template v-else-if="product.dataNature === 'collected'">
              <b>官网采集证据</b><br />{{ product.title }}<br />
              {{ product.claim }}<br /><br />
              <a
                v-if="product.evidenceUrl"
                :href="product.evidenceUrl"
                target="_blank"
                rel="noreferrer"
                >打开商品证据页面</a
              >
            </template>
            <template v-else>
              <b>演示证据摘录</b><br />{{ product.title }}<br />Serving size:
              {{ product.size }}<br />{{ product.ingredient }} ·
              {{ product.dose
              }}<br /><br />此文本为演示样本，未抓取真实商品网页。
            </template>
          </div>
          <p class="hci-subtle">
            来源：{{
              product.sourceProvider
                ? productDataSource(product)
                : productSite?.domain
            }}
            · 观察日期：{{ product.firstSeenAt || '2026-10-13' }}
          </p>
          <Button
            v-if="productSite"
            @click="
              router.push({ path: '/sites', query: { site: productSite.id } });
              emit('close');
            "
          >
            查看关联独立站：{{ productSite.brand }} →
          </Button> </Tabs.TabPane
        ><Tabs.TabPane key="history" tab="历史记录">
          <div class="hci-market-row">
            <span>首次观察</span
            ><span>{{ product.firstSeenAt || '2026-10-13' }}</span>
          </div>
          <div
            v-for="event in state.audit.filter((a) =>
              a.detail.includes(product!.title),
            )"
            :key="event.id"
            class="hci-market-row"
          >
            <span>{{ event.title }}</span
            ><span class="hci-subtle">{{ event.at }}</span>
          </div>
          <p class="hci-subtle" style="margin-top: 18px">
            价格历史从第一次官网实采后开始积累。
          </p>
        </Tabs.TabPane>
      </Tabs>
      <div class="hci-detail-actions">
        <PublicContentLauncher :query="`${product.brand} ${product.title}`" :market="product.market" :product-ids="[product.id]" />
        <Button type="primary" @click="addMonitor">加入监控</Button
        ><Button @click="toggleFavorite(product)">
          {{ product.favorite ? '取消收藏' : '收藏商品' }} </Button
        ><Button
          @click="
            router.push('/reviews');
            emit('close');
          "
        >
          前往审核
        </Button>
      </div>
    </template>
  </Drawer>
</template>

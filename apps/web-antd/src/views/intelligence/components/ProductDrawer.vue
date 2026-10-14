<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { Button, Drawer, message, Tabs, Tag } from 'ant-design-vue';

import {
  marketName,
  money,
  monitorProduct,
  state,
  toggleFavorite,
} from '../data';
import ProductArt from './ProductArt.vue';
const props = defineProps<{ id?: string }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
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
    :open="!!product"
    :width="620"
    title="商品情报详情"
    @close="emit('close')"
  >
    <template v-if="product">
      <ProductArt
        :color="product.color"
        :brand="product.brand"
        :image-url="product.imageUrl"
      />
      <div style="margin-top: 20px">
        <p class="hci-product-brand">
          {{ product.brand }} · {{ marketName(product.market) }}
        </p>
        <h2 style="font-size: 23px; font-weight: 600">{{ product.title }}</h2>
        <div style="display: flex; gap: 12px; margin: 14px 0">
          <Tag :color="product.reviewed ? 'green' : 'orange'">
            {{
              product.reviewed
                ? '审核已确认'
                : product.dataNature === 'collected'
                  ? '官网实采 · 待核验'
                  : '演示 · 待核验'
            }}
</Tag><Tag>{{ product.category }}</Tag>
        </div>
      </div>
      <Tabs>
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
          </dl>
</Tabs.TabPane><Tabs.TabPane key="analysis" tab="卖点与成分分析">
          <h3 class="hci-section-heading">官网功效卖点提取</h3>
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
          </div>
</Tabs.TabPane><Tabs.TabPane key="evidence" tab="来源与证据">
          <div class="hci-evidence">
            <template v-if="product.dataNature === 'collected'">
              <b>官网采集证据</b><br />{{ product.title }}<br />
              {{ product.claim }}<br /><br />
              <a
                v-if="product.evidenceUrl"
                :href="product.evidenceUrl"
                target="_blank"
                rel="noreferrer"
                >打开商品证据页面</a>
            </template>
            <template v-else>
              <b>演示证据摘录</b><br />{{ product.title }}<br />Serving size:
              {{ product.size }}<br />{{ product.ingredient }} ·
              {{ product.dose
              }}<br /><br />此文本为演示样本，未抓取真实商品网页。
            </template>
          </div>
          <p class="hci-subtle">
            来源：{{ productSite?.domain }} · 观察日期：{{
              product.firstSeenAt || '2026-10-13'
            }}
          </p>
          <Button
            v-if="productSite"
            @click="
              router.push({ path: '/sites', query: { site: productSite.id } });
              emit('close');
            "
          >
            查看关联独立站：{{ productSite.brand }} →
          </Button>
</Tabs.TabPane><Tabs.TabPane key="history" tab="历史记录">
          <div class="hci-market-row">
            <span>首次观察</span><span>{{ product.firstSeenAt || '2026-10-13' }}</span>
          </div>
          <div
            v-for="event in state.audit.filter((a) =>
              a.detail.includes(product!.title),
            )"
            :key="event.id"
            class="hci-market-row"
          >
            <span>{{ event.title }}</span><span class="hci-subtle">{{ event.at }}</span>
          </div>
          <p class="hci-subtle" style="margin-top: 18px">
            价格历史从第一次官网实采后开始积累。
          </p>
        </Tabs.TabPane>
      </Tabs>
      <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px">
        <Button type="primary" @click="addMonitor">加入监控</Button><Button @click="toggleFavorite(product)">
          {{ product.favorite ? '取消收藏' : '收藏商品' }}
</Button><Button
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

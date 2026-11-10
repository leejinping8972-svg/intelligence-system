<script setup lang="ts">
import type { Product } from '../data';

import { computed } from 'vue';
import { Popover } from 'ant-design-vue';

import {
  productSellerDetails,
  productSellerName,
  productSellerUrl,
} from '../../../../../../server/product-seller.mjs';
import ProductText from './ProductText.vue';

const props = defineProps<{ product: Product }>();
const seller = computed(() => productSellerName(props.product));
const details = computed(() => productSellerDetails(props.product));
const sellerUrl = computed(() => productSellerUrl(props.product));
const collectedAt = computed(() =>
  details.value?.collectedAt
    ? new Date(details.value.collectedAt).toLocaleString('zh-CN', {
        hour12: false,
      })
    : '未记录',
);
const isAmazon = computed(
  () => props.product.sourcePlatform?.trim().toLowerCase() === 'amazon',
);
</script>

<template>
  <div class="product-merchant">
    <div v-if="isAmazon || seller" class="product-merchant-line">
      <span class="product-merchant-label">卖家：</span
      ><Popover
        v-if="isAmazon && seller"
        trigger="click"
        title="卖家详情"
        placement="bottomLeft"
      >
        <template #content>
          <div class="seller-details">
            <dl>
              <dt>卖家</dt>
              <dd>{{ seller }}</dd>
              <dt>企业名称（Business Name）</dt>
              <dd>{{ details?.businessName || '未取得' }}</dd>
              <dt>企业公开地址（Business Address）</dt>
              <dd class="seller-address">
                {{ details?.businessAddress?.join('\n') || '未取得' }}
              </dd>
              <template v-if="details?.nationality"
                ><dt>国家 / 地区</dt>
                <dd>{{ details.nationality }}</dd></template
              >
              <template v-if="details"
                ><dt>来源 / 采集时间</dt>
                <dd>
                  {{ details.provider }} · {{ details.market }}<br />{{
                    collectedAt
                  }}
                </dd></template
              >
            </dl>
            <p v-if="!details" class="seller-note">
              尚未获取企业资料，正常采集时会尝试补充。
            </p>
            <p v-else-if="details.status === 'unavailable'" class="seller-note">
              来源暂未返回企业名称和地址。
            </p>
            <p v-else class="seller-note">此处为卖家公开营业地址。</p>
            <a
              v-if="sellerUrl"
              :href="sellerUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
              >查看亚马逊卖家主页 ↗</a
            >
            <p v-else class="seller-note">未取得卖家主页链接</p>
          </div>
        </template>
        <button
          class="seller-trigger"
          type="button"
          :aria-label="`查看${seller}的卖家详情`"
          @click.stop
        >
          {{ seller }}
        </button> </Popover
      ><span v-else>{{ seller || '未返回' }}</span>
    </div>
    <div class="product-merchant-line">
      <span class="product-merchant-label">品牌：</span
      ><ProductText :text="product.brand" :translated="product.brandZh" />
    </div>
  </div>
</template>

<style scoped>
.product-merchant {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  font-weight: 400;
}
.product-merchant-line {
  display: flex;
  align-items: baseline;
  gap: 2px;
  overflow-wrap: anywhere;
}
.product-merchant-label {
  flex-shrink: 0;
  color: #8c8c8c;
}
.seller-trigger {
  border: 0;
  padding: 0;
  color: #1677ff;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.seller-trigger:hover {
  text-decoration: underline;
}
.seller-trigger:focus-visible {
  outline: 2px solid #1677ff;
  outline-offset: 2px;
}
.seller-details {
  max-width: 360px;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.seller-details dt {
  margin-top: 8px;
  color: #8c8c8c;
}
.seller-details dd {
  margin: 0;
}
.seller-address {
  white-space: pre-line;
}
.seller-note {
  margin: 8px 0;
  color: #8c8c8c;
}
</style>

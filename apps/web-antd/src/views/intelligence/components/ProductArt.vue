<script setup lang="ts">
import { ref, watch } from 'vue';
import { Image } from 'ant-design-vue';

const props = defineProps<{
  brand: string;
  color: string;
  imageUrl?: string;
  label?: string;
  sourceLabel?: string;
}>();
const imageFailed = ref(false);
const previewMask = () => '查看大图';
watch(
  () => props.imageUrl,
  () => {
    imageFailed.value = false;
  },
);
</script>
<template>
  <div
    v-if="imageUrl && !imageFailed"
    class="hci-product-art hci-product-photo"
    :class="[color]"
    :aria-label="`${brand}商品图片`"
  >
    <Image
      :src="imageUrl"
      :alt="`${brand}商品图片`"
      :preview="{ src: imageUrl }"
      :preview-mask="previewMask"
      @click.stop
      @error="imageFailed = true"
    />
    <span class="hci-art-caption">{{ sourceLabel || '官网商品图' }}</span>
  </div>
  <div
    v-else
    class="hci-product-art"
    :class="[color]"
    aria-label="商品包装占位图"
  >
    <div class="hci-bottle">
      <div class="hci-bottle-cap"></div>
      <div class="hci-bottle-body">
        <small>{{ brand }}</small>
        <div class="hci-bottle-rule"></div>
        <strong>{{ label || 'DAILY\nESSENTIALS' }}</strong><span>DAILY CARE / 30 SERVINGS</span>
      </div>
    </div>
    <span class="hci-art-caption">图片待采集</span>
  </div>
</template>

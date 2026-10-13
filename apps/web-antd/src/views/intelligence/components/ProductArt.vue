<script setup lang="ts">
defineProps<{ color: string; brand: string; label?: string }>();
</script>
<template>
  <div :class="['hci-product-art', color]" aria-label="演示商品示意图">
    <div class="hci-bottle">
      <div class="hci-bottle-cap"></div>
      <div class="hci-bottle-body">
        <small>{{ brand }}</small>
        <div class="hci-bottle-rule"></div>
        <strong>{{ label || 'DAILY\nESSENTIALS' }}</strong
        ><span>DAILY CARE / 30 SERVINGS</span>
      </div>
    </div>
    <span class="hci-art-caption">示意包装</span>
  </div>
</template>

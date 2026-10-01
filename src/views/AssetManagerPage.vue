<template>
  <div class="asset-manager-page">
    <!-- Display different manager based on type -->
    <ExpressionManager v-if="assetType === 'expressions'" />
    <BackgroundManager v-else-if="assetType === 'backgrounds'" />
    <PropManager v-else-if="assetType === 'props'" />
    <div
      v-else
      class="coming-soon"
    >
      <p>{{ assetType }} management feature is under development...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import BackgroundManager from '@/components/BackgroundManager.vue'
import ExpressionManager from '@/components/ExpressionManager.vue'
import PropManager from '@/components/PropManager.vue'
// v7.3: EffectManager has been removed

const route = useRoute()
const assetType = computed(() => route.params['type'] as string)
</script>

<style scoped>
.asset-manager-page {
  height: 100%;
  overflow: hidden;
}

.coming-soon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 16px;
}
</style>

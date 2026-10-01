<template>
  <div 
    ref="containerRef"
    class="expression-preview"
    @click="handleContainerClick"
  >
    <!-- Image display -->
    <img
      ref="imageRef"
      :src="displayImageUrl"
      class="preview-image"
      :style="imageStyle"
      alt="Expression Preview"
      @load="handleImageLoad"
    >
    
    <!-- SVG anchor overlay -->
    <svg
      v-if="imageLoaded && imageUrl"
      class="anchor-overlay"
      :viewBox="`0 0 ${containerWidth} ${containerHeight}`"
      preserveAspectRatio="none"
    >
      <!-- Crosshair -->
      <line
        :x1="anchorPixelX - 20"
        :y1="anchorPixelY"
        :x2="anchorPixelX + 20"
        :y2="anchorPixelY"
        stroke="#ff0000"
        stroke-width="2"
        stroke-linecap="round"
      />
      <line
        :x1="anchorPixelX"
        :y1="anchorPixelY - 20"
        :x2="anchorPixelX"
        :y2="anchorPixelY + 20"
        stroke="#ff0000"
        stroke-width="2"
        stroke-linecap="round"
      />
      <!-- Center dot (draggable) -->
      <circle
        :cx="anchorPixelX"
        :cy="anchorPixelY"
        r="4"
        fill="#ff0000"
        class="anchor-dot"
        @mousedown.stop="handleAnchorDragStart"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick,onMounted, onUnmounted, ref, watch } from 'vue'

import { useAssetImage } from '@/composables/useAssetImage'
import { useExpressionStore } from '@/stores/expressionStore'
import type { AnchorPoint } from '@/types/project'

const props = defineProps<{
  imageUrl?: string
  anchor: AnchorPoint
  flipHorizontal?: boolean
  expressionId?: string  // Optional: if provided, uses encapsulated method to get display transform
  blendMode?: 'normal' | 'multiply'
}>()

const { getImageUrl } = useAssetImage()
const expressionStore = useExpressionStore()

const emit = defineEmits<{
  'update:anchor': [anchor: AnchorPoint]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)
const imageLoaded = ref(false)
const containerWidth = ref(400)
const containerHeight = ref(400)
const imageDisplayWidth = ref(0)
const imageDisplayHeight = ref(0)
const imageOffsetX = ref(0)
const imageOffsetY = ref(0)
const isDragging = ref(false)

// Display image URL (using unified image loader)
const displayImageUrl = computed(() => {
  return props.imageUrl ? getImageUrl(props.imageUrl) : ''
})

// Image style (using encapsulated method)
const imageStyle = computed(() => {
  const blend: 'normal' | 'multiply' = props.blendMode === 'multiply' ? 'multiply' : 'normal'

  if (props.expressionId) {
    const style = expressionStore.getCssDisplayStyle(props.expressionId)
    return {
      ...style,
      mixBlendMode: blend,
      transition: 'transform 0.2s'
    }
  }
  return {
    transform: props.flipHorizontal ? 'scaleX(-1)' : 'none',
    mixBlendMode: blend,
    transition: 'transform 0.2s'
  }
})

// Get actual flip state (for anchor coordinate calculation)
const actualFlipX = computed(() => {
  if (props.expressionId) {
    const { flipX } = expressionStore.getDisplayTransform(props.expressionId)
    return flipX
  }
  return props.flipHorizontal ?? false
})

// Calculate anchor pixel coordinates
const anchorPixelX = computed(() => {
  if (!imageLoaded.value || imageDisplayWidth.value === 0) return containerWidth.value / 2
  
  // Calculate actual image display position in container
  const x = imageOffsetX.value + imageDisplayWidth.value * props.anchor.x
  
  // Mirror if horizontally flipped
  if (actualFlipX.value) {
    return imageOffsetX.value + imageDisplayWidth.value * (1 - props.anchor.x)
  }
  return x
})

const anchorPixelY = computed(() => {
  if (!imageLoaded.value || imageDisplayHeight.value === 0) return containerHeight.value / 2
  return imageOffsetY.value + imageDisplayHeight.value * props.anchor.y
})

// Image load complete
function handleImageLoad() {
  if (!imageRef.value || !containerRef.value) return
  
  const img = imageRef.value
  const container = containerRef.value
  
  // Calculate actual image display size (maintaining aspect ratio)
  const containerRect = container.getBoundingClientRect()
  const imgRect = img.getBoundingClientRect()
  
  containerWidth.value = containerRect.width
  containerHeight.value = containerRect.height
  imageDisplayWidth.value = imgRect.width
  imageDisplayHeight.value = imgRect.height
  
  // Calculate centering offset
  imageOffsetX.value = (containerRect.width - imgRect.width) / 2
  imageOffsetY.value = (containerRect.height - imgRect.height) / 2
  
  imageLoaded.value = true
}

// Container click (set anchor)
function handleContainerClick(event: MouseEvent) {
  if (isDragging.value || !imageRef.value || !containerRef.value) return
  
  const containerRect = containerRef.value.getBoundingClientRect()
  const imgRect = imageRef.value.getBoundingClientRect()
  
  const x = event.clientX - containerRect.left
  const y = event.clientY - containerRect.top
  
  // Check if click is within image area
  const imgLeft = imgRect.left - containerRect.left
  const imgTop = imgRect.top - containerRect.top
  
  if (x < imgLeft || 
      x > imgLeft + imgRect.width ||
      y < imgTop ||
      y > imgTop + imgRect.height) {
    return
  }
  
  updateAnchorFromPixel(x, y)
}

// Anchor drag start
function handleAnchorDragStart(event: MouseEvent) {
  event.stopPropagation()
  isDragging.value = true
  
  const handleMove = (e: MouseEvent) => {
    if (!containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    updateAnchorFromPixel(e.clientX - rect.left, e.clientY - rect.top)
  }
  
  const handleUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

// Update anchor from pixel coordinates
function updateAnchorFromPixel(pixelX: number, pixelY: number) {
  if (!imageRef.value || !containerRef.value) return
  
  const containerRect = containerRef.value.getBoundingClientRect()
  const imgRect = imageRef.value.getBoundingClientRect()
  
  // Calculate coordinates relative to image
  const imgLeft = imgRect.left - containerRect.left
  const imgTop = imgRect.top - containerRect.top
  
  const relativeX = (pixelX - imgLeft) / imgRect.width
  const relativeY = (pixelY - imgTop) / imgRect.height
  
  // Account for horizontal flip
  const finalX = actualFlipX.value ? 1 - relativeX : relativeX
  
  const newAnchor: AnchorPoint = {
    x: Math.max(0, Math.min(1, finalX)),
    y: Math.max(0, Math.min(1, relativeY))
  }
  
  emit('update:anchor', newAnchor)
}

// Watch image URL change
watch(() => props.imageUrl, (newUrl) => {
  imageLoaded.value = false
  if (newUrl && imageRef.value) {
    // If image already loaded, trigger load handler directly
    if (imageRef.value.complete && imageRef.value.src === newUrl) {
      void nextTick(() => {
        handleImageLoad()
      })
    } else {
      // Reset image src to trigger load event
      imageRef.value.src = newUrl
    }
  }
}, { immediate: true })

// Watch container dimension change
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      void nextTick(() => {
        if (imageRef.value && imageRef.value.complete && imageLoaded.value) {
          handleImageLoad()
        }
      })
    })
    resizeObserver.observe(containerRef.value)
  }
  
  // If image already loaded, compute layout immediately
  if (imageRef.value && imageRef.value.complete && props.imageUrl) {
    void nextTick(() => {
      handleImageLoad()
    })
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  // Clean up event listeners
  isDragging.value = false
})
</script>

<style scoped>
.expression-preview {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff; /* White background */
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
  /* Photoshop style checkerboard - shows transparent areas clearly */
  background-image: 
    linear-gradient(45deg, #e0e0e0 25%, transparent 25%), 
    linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), 
    linear-gradient(45deg, transparent 75%, #e0e0e0 75%), 
    linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  border: none;
  border-radius: 4px;
  background: transparent;
}

.anchor-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.anchor-dot {
  pointer-events: all;
  cursor: move;
  transition: r 0.2s;
}

.anchor-dot:hover {
  r: 6;
}
</style>


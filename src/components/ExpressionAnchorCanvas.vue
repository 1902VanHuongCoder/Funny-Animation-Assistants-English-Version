<template>
  <div class="anchor-canvas-container">
    <canvas
      ref="canvasRef"
      class="anchor-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick,onMounted, onUnmounted, ref, watch } from 'vue'

import type { AnchorPoint } from '@/types/project'

const props = defineProps<{
  imageUrl?: string
  anchor: AnchorPoint
  flipHorizontal?: boolean
}>()

const emit = defineEmits<{
  'update:anchor': [anchor: AnchorPoint]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isDragging = ref(false)
const image = ref<HTMLImageElement | null>(null)
const canvasWidth = ref(400)
const canvasHeight = ref(400)
const imageScale = ref(1)
const imageOffsetX = ref(0)
const imageOffsetY = ref(0)

// Calculate anchor actual coordinates on canvas
const anchorX = ref(0)
const anchorY = ref(0)

// Watch external anchor changes
watch(() => props.anchor, (newAnchor) => {
  updateAnchorPosition(newAnchor)
}, { deep: true })

// Watch horizontal flip changes
watch(() => props.flipHorizontal, () => {
  updateAnchorPosition(props.anchor)
  draw()
})

// Watch image changes
watch(() => props.imageUrl, async (newUrl) => {
  if (newUrl) {
    await loadImage(newUrl)
    draw()
  }
}, { immediate: true })

onMounted(async () => {
  await nextTick()
  if (props.imageUrl) {
    await loadImage(props.imageUrl)
  }
  updateAnchorPosition(props.anchor)
  draw()
})

function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      image.value = img
      calculateImageLayout()
      resolve()
    }
    img.onerror = reject
    img.src = url
  })
}

function calculateImageLayout() {
  if (!canvasRef.value || !image.value) return

  const canvas = canvasRef.value
  const img = image.value
  
  // Calculate scale ratio to fit image into canvas
  const scaleX = canvas.width / img.width
  const scaleY = canvas.height / img.height
  imageScale.value = Math.min(scaleX, scaleY)
  
  // Calculate centering offset
  const scaledWidth = img.width * imageScale.value
  const scaledHeight = img.height * imageScale.value
  imageOffsetX.value = (canvas.width - scaledWidth) / 2
  imageOffsetY.value = (canvas.height - scaledHeight) / 2
}

function updateAnchorPosition(anchor: AnchorPoint) {
  if (!canvasRef.value || !image.value) return

  const img = image.value
  
  const scaledWidth = img.width * imageScale.value
  const scaledHeight = img.height * imageScale.value
  
  // Calculate anchor actual coordinates on canvas
  // If horizontally flipped, mirror x coordinate
  if (props.flipHorizontal) {
    anchorX.value = imageOffsetX.value + scaledWidth * (1 - anchor.x)
  } else {
    anchorX.value = imageOffsetX.value + scaledWidth * anchor.x
  }
  anchorY.value = imageOffsetY.value + scaledHeight * anchor.y
}

function draw() {
  if (!canvasRef.value || !image.value) return

  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // Draw white background
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // Draw image
  const img = image.value
  const scaledWidth = img.width * imageScale.value
  const scaledHeight = img.height * imageScale.value
  
  // If horizontal flip enabled, save context state first
  if (props.flipHorizontal) {
    ctx.save()
    // Move to image center position
    ctx.translate(imageOffsetX.value + scaledWidth, imageOffsetY.value)
    // Flip horizontally
    ctx.scale(-1, 1)
    // Draw image(note: x coordinate must be negative)
    ctx.drawImage(img, 0, 0, -scaledWidth, scaledHeight)
    ctx.restore()
  } else {
    ctx.drawImage(
      img,
      imageOffsetX.value,
      imageOffsetY.value,
      scaledWidth,
      scaledHeight
    )
  }
  
  // Draw border
  ctx.strokeStyle = '#ddd'
  ctx.lineWidth = 1
  ctx.strokeRect(
    imageOffsetX.value,
    imageOffsetY.value,
    scaledWidth,
    scaledHeight
  )
  
  // Draw red crosshair
  const crossSize = 20
  const lineWidth = 2
  
  ctx.strokeStyle = '#ff0000'
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  
  // Horizontal line
  ctx.moveTo(anchorX.value - crossSize, anchorY.value)
  ctx.lineTo(anchorX.value + crossSize, anchorY.value)
  
  // Vertical line
  ctx.moveTo(anchorX.value, anchorY.value - crossSize)
  ctx.lineTo(anchorX.value, anchorY.value + crossSize)
  
  ctx.stroke()
  
  // Draw center dot
  ctx.fillStyle = '#ff0000'
  ctx.beginPath()
  ctx.arc(anchorX.value, anchorY.value, 4, 0, Math.PI * 2)
  ctx.fill()
}

function handleMouseDown(event: MouseEvent) {
  if (!canvasRef.value) return
  
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  
  // Check if click is near anchor
  const distance = Math.sqrt(
    Math.pow(x - anchorX.value, 2) + Math.pow(y - anchorY.value, 2)
  )
  
  if (distance < 30) {
    isDragging.value = true
    updateAnchorFromCanvas(x, y)
  }
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value || !canvasRef.value || !image.value) return
  
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  
  updateAnchorFromCanvas(x, y)
}

function handleMouseUp() {
  isDragging.value = false
}

function updateAnchorFromCanvas(canvasX: number, canvasY: number) {
  if (!image.value) return
  
  const img = image.value
  const scaledWidth = img.width * imageScale.value
  const scaledHeight = img.height * imageScale.value
  
  // Calculate coordinates relative to image
  let relativeX = (canvasX - imageOffsetX.value) / scaledWidth
  const relativeY = (canvasY - imageOffsetY.value) / scaledHeight
  
  // If horizontally flipped, mirror x coordinate
  if (props.flipHorizontal) {
    relativeX = 1 - relativeX
  }
  
  // Clamp within 0-1 range
  const newAnchor: AnchorPoint = {
    x: Math.max(0, Math.min(1, relativeX)),
    y: Math.max(0, Math.min(1, relativeY))
  }
  
  // Update displayed anchor position (accounting for flip)
  if (props.flipHorizontal) {
    anchorX.value = imageOffsetX.value + scaledWidth * (1 - newAnchor.x)
  } else {
    anchorX.value = imageOffsetX.value + scaledWidth * newAnchor.x
  }
  anchorY.value = imageOffsetY.value + scaledHeight * newAnchor.y
  
  emit('update:anchor', newAnchor)
  draw()
}

// Recalculate when canvas dimensions change
function resizeCanvas() {
  if (!canvasRef.value) return
  
  const container = canvasRef.value.parentElement
  if (!container) return
  
  canvasWidth.value = container.clientWidth
  canvasHeight.value = container.clientHeight
  
  canvasRef.value.width = canvasWidth.value
  canvasRef.value.height = canvasHeight.value
  
  if (image.value) {
    calculateImageLayout()
    updateAnchorPosition(props.anchor)
    draw()
  }
}

onMounted(() => {
  if (canvasRef.value) {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<style scoped>
.anchor-canvas-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.anchor-canvas {
  display: block;
  cursor: crosshair;
  max-width: 100%;
  max-height: 100%;
}
</style>


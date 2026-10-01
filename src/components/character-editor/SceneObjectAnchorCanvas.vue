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
    <div v-if="loading" class="loading-overlay">
      <span>Loading...</span>
    </div>
    <div v-if="error" class="error-overlay">
      <span>{{ error }}</span>
    </div>
    <div v-if="!loading && !error && !hasImage" class="empty-placeholder">
      <span>{{ objectId ? 'Unable to load preview' : 'Please select target object' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useAssetImage } from '@/composables/useAssetImage'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { usePropStore } from '@/stores/propStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { CompositeObject, ExpressionObject, SceneObject, SymbolObject } from '@/types/sceneObject'


interface PivotPoint {
  x: number
  y: number
}

const props = defineProps<{
  objectId?: string | undefined
  pivot: PivotPoint
  currentPoseId?: string  // Current pose key (evaluated pose in Action Mode)
}>()

const emit = defineEmits<{
  'update:pivot': [pivot: PivotPoint]
}>()

const sceneObjectStore = useSceneObjectStore()
const propStore = usePropStore()
const backgroundStore = useBackgroundStore()
const expressionStore = useExpressionStore()


const { getImageUrl } = useAssetImage()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isDragging = ref(false)
const loading = ref(false)
const error = ref('')
const hasImage = ref(false)

const canvasWidth = ref(300)
const canvasHeight = ref(200)

// View Transform
const imageScale = ref(1)
const imageOffsetX = ref(0)
const imageOffsetY = ref(0)

// Pivot position in canvas coordinates
const pivotX = ref(0)
const pivotY = ref(0)

// Content Bounding Box (World Coords)
const contentBBox = ref({ minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 })

// Checkerboard size
const CHECKER_SIZE = 10

// Parts Data (for character composite rendering)
interface RenderPart {
  id: string
  image: HTMLImageElement
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  zIndex: number
  width: number
  height: number
  anchorX: number
  anchorY: number
}

const renderParts = ref<RenderPart[]>([])

// Single image for prop/background
const singleImage = ref<HTMLImageElement | null>(null)

// ------------------------------------------------------------------
// Watchers
// ------------------------------------------------------------------
watch(() => props.objectId, async () => {
  await loadObjectData()
})

// Reload character data when currentPoseId changes
watch(() => props.currentPoseId, async () => {
  await loadObjectData()
})

watch(() => props.pivot, (newPivot) => {
  updatePivotPosition(newPivot)
  draw()
}, { deep: true })

// ------------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------------
onMounted(async () => {
  await nextTick()
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  await loadObjectData()
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
})

// ------------------------------------------------------------------
// Logic
// ------------------------------------------------------------------

async function loadObjectData() {
  if (!props.objectId) {
    hasImage.value = false
    renderParts.value = []
    singleImage.value = null
    draw()
    return
  }
  
  const obj = sceneObjectStore.objects.find(o => o.id === props.objectId)
  if (!obj) {
    error.value = 'Object does not exist'
    hasImage.value = false
    return
  }
  
  loading.value = true
  error.value = ''
  renderParts.value = []
  singleImage.value = null
  hasImage.value = false
  
  try {
    const objType = obj.type
    
    if (objType === 'prop') {
      await loadPropData(obj)
    } else if (objType === 'background') {
      await loadBackgroundData(obj)
    } else if (objType === 'symbol') {
      await loadSymbolData(obj as SymbolObject)
    } else if (objType === 'composite') {
      await loadCompositeData(obj as CompositeObject)
    } else if (objType === 'expression') {
      await loadExpressionData(obj as ExpressionObject)
    } else {
      error.value = 'Unsupported object type'
      return
    }
    
    if (renderParts.value.length > 0 || singleImage.value) {
      hasImage.value = true
      calculateContentBoundingBox()
      calculateImageLayout()
      updatePivotPosition(props.pivot)
      draw()
    }
  } catch (e) {
    console.error('Failed to load object data', e)
    error.value = 'Load failed: ' + (e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}



// ═══════════════════════════════════════════════════════════════════
// Pure function: resolve thumbnail by object type (no side effects)
// ═══════════════════════════════════════════════════════════════════

async function resolvePropImage(refId: string): Promise<HTMLImageElement | undefined> {
  const prop = propStore.getProp(refId)
  if (!prop) return undefined

  let imagePath: string | undefined
  if (prop.type === 'static') {
    imagePath = prop._runtimeUrl ?? (prop.url ? getImageUrl(prop.url) : undefined)
  } else if (prop.type === 'animation' && prop.frames && prop.frames.length > 0) {
    if (prop._runtimeStillUrl) {
      imagePath = prop._runtimeStillUrl
    } else if (prop.stillFrameSource === 'custom' && prop.stillFrameCustomUrl) {
      imagePath = getImageUrl(prop.stillFrameCustomUrl)
    } else {
      const idx = (typeof prop.stillFrameIndex === 'number' &&
                   prop.stillFrameIndex >= 0 &&
                   prop.stillFrameIndex < prop.frames.length)
        ? prop.stillFrameIndex : 0
      const frame = prop.frames[idx] as { _runtimeUrl?: string; url?: string }
      if (frame) {
        imagePath = frame._runtimeUrl ?? (frame.url ? getImageUrl(frame.url) : undefined)
      }
    }
  } else {
    imagePath = prop._runtimeUrl ?? (prop.url ? getImageUrl(prop.url) : undefined)
  }
  if (!imagePath) return undefined
  return loadImage(imagePath)
}

async function resolveBackgroundImage(refId: string): Promise<HTMLImageElement | undefined> {
  const bg = backgroundStore.getBackground(refId)
  if (!bg) return undefined

  const bgAny = bg as { _runtimeUrl?: string; url?: string; backgroundImage?: string }
  let imagePath: string | undefined
  if (bgAny._runtimeUrl) imagePath = bgAny._runtimeUrl
  else if (bgAny.url) imagePath = getImageUrl(bgAny.url)
  else if (bgAny.backgroundImage) imagePath = getImageUrl(bgAny.backgroundImage)
  if (!imagePath) return undefined
  return loadImage(imagePath)
}

async function resolveSymbolImage(symbolObj: SymbolObject): Promise<HTMLImageElement | undefined> {
  const materials = symbolObj.materials
  if (!materials || materials.length === 0) return undefined

  const mat = symbolObj.currentMaterialId
    ? materials.find(m => m.id === symbolObj.currentMaterialId) ?? materials[0]
    : materials[0]
  if (!mat) return undefined

  let imagePath: string | undefined
  if (mat.type === 'static') {
    imagePath = (mat as { _runtimeUrl?: string })._runtimeUrl ?? (mat.url ? getImageUrl(mat.url) : undefined)
  } else if (mat.type === 'animation' && mat.frames && mat.frames.length > 0) {
    if (mat.stillFrameSource === 'custom' && mat.url) {
      imagePath = (mat as { _runtimeUrl?: string })._runtimeUrl ?? getImageUrl(mat.url)
    } else {
      const idx = (typeof mat.stillFrameIndex === 'number' &&
                   mat.stillFrameIndex >= 0 &&
                   mat.stillFrameIndex < mat.frames.length)
        ? mat.stillFrameIndex : 0
      const frame = mat.frames[idx]
      if (frame) {
        imagePath = (frame as { _runtimeUrl?: string })._runtimeUrl ?? (frame.url ? getImageUrl(frame.url) : undefined)
      }
    }
  } else {
    imagePath = (mat as { _runtimeUrl?: string })._runtimeUrl ?? (mat.url ? getImageUrl(mat.url) : undefined)
  }
  if (!imagePath) return undefined
  return loadImage(imagePath)
}

async function resolveExpressionImage(obj: ExpressionObject): Promise<HTMLImageElement | undefined> {
  const expr = expressionStore.getExpression(obj.refId)
  if (!expr) return undefined
  const frame = expr.defaultFrame
  if (!frame?.url) return undefined
  const imagePath = frame.url.startsWith('blob:') || frame.url.startsWith('data:')
    ? frame.url
    : getImageUrl(frame.url)
  return loadImage(imagePath)
}



/**
 * Generic entry: load a thumbnail based on object type
 * Pure function, does not modify component state
 */
async function resolveObjectThumbnail(obj: SceneObject): Promise<HTMLImageElement | undefined> {
  switch (obj.type) {
    case 'prop': return obj.refId ? resolvePropImage(obj.refId) : undefined
    case 'background': return obj.refId ? resolveBackgroundImage(obj.refId) : undefined
    case 'symbol': return resolveSymbolImage(obj as SymbolObject)
    case 'expression': return resolveExpressionImage(obj as ExpressionObject)
    default: return undefined
  }
}

// ═══════════════════════════════════════════════════════════════════
// Loader with side effects (writes singleImage / renderParts)
// ═══════════════════════════════════════════════════════════════════

async function loadPropData(obj: SceneObject) {
  if (!obj.refId) return
  singleImage.value = (await resolvePropImage(obj.refId)) ?? null
}

async function loadBackgroundData(obj: SceneObject) {
  if (!obj.refId) return
  singleImage.value = (await resolveBackgroundImage(obj.refId)) ?? null
}

async function loadSymbolData(obj: SymbolObject) {
  singleImage.value = (await resolveSymbolImage(obj)) ?? null
}

async function loadExpressionData(obj: ExpressionObject) {
  singleImage.value = (await resolveExpressionImage(obj)) ?? null
}

/**
 * Resolve effective renderChain for composite
 * - entity composite: uses own renderChain
 * - union composite: looks up closest entity ancestor renderChain along parentId;
 *   if no entity ancestor, fallbacks to scene-level sceneRenderChain
 */
function resolveRenderChain(compositeObj: CompositeObject): string[] | undefined {
  if (compositeObj.compositeMode === 'entity') {
    return compositeObj.renderChain
  }
  // union: look up closest entity composite renderChain along parentId
  let currentParentId = compositeObj.parentId
  while (currentParentId) {
    const parent = sceneObjectStore.objects.find(o => o.id === currentParentId)
    if (!parent) break
    if (parent.type === 'composite') {
      const parentComp = parent as CompositeObject
      if (parentComp.compositeMode === 'entity' && parentComp.renderChain && parentComp.renderChain.length > 0) {
        return parentComp.renderChain
      }
      // union: continue upward
      currentParentId = parentComp.parentId
    } else {
      break
    }
  }
  // No entity ancestor -> scene-level renderChain
  const sceneChain = sceneObjectStore.getSceneRenderChain()
  return sceneChain.length > 0 ? sceneChain : undefined
}

/**
 * Resolve single leaf object (non-composite) as RenderPart
 * Handle special anchor and scale for expression objects
 */
async function resolveLeafRenderPart(child: SceneObject): Promise<RenderPart | undefined> {
  const childImage = await resolveObjectThumbnail(child)
  if (!childImage) return undefined

  // Special expression object handling: use anchor and defaultScale from expression definition
  let anchorX = 0.5
  let anchorY = 0.5
  let extraScaleX = 1
  let extraScaleY = 1

  if (child.type === 'expression' && child.refId) {
    const expr = expressionStore.getExpression(child.refId)
    if (expr) {
      anchorX = expr.anchor?.x ?? 0.5
      anchorY = expr.anchor?.y ?? 0.5
      const ds = expr.defaultScale ?? 1
      const flipH = expr.flipHorizontal ?? false
      extraScaleX = ds * (flipH ? -1 : 1)
      extraScaleY = ds
    }
  }

  return {
    id: child.id,
    image: childImage,
    x: child.x,
    y: child.y,
    scaleX: child.scaleX * (child.flipX ? -1 : 1) * extraScaleX,
    scaleY: child.scaleY * extraScaleY,
    rotation: child.rotation,
    zIndex: child.zIndex,
    width: childImage.width,
    height: childImage.height,
    anchorX,
    anchorY
  }
}

/**
 * Recursively collect all renderable parts of composite
 * - Leaf object -> load image directly
 * - Sub-composite (incl union) -> recursively flatten descendants, accumulating coordinate offsets
 * @param offsetX Parent cumulative X offset (local coords of parent composite)
 * @param offsetY Parent cumulative Y offset
 */
async function collectRenderParts(
  compositeObj: CompositeObject,
  offsetX = 0,
  offsetY = 0
): Promise<RenderPart[]> {
  const childIds = compositeObj.childIds
  if (!childIds || childIds.length === 0) return []

  const parts: RenderPart[] = []

  for (const childId of childIds) {
    const child = sceneObjectStore.objects.find(o => o.id === childId)
    if (!child) continue

    try {
      if (child.type === 'composite') {
        // Recursively flatten sub-composite: accumulate coordinate offset of composite itself
        const subParts = await collectRenderParts(
          child as CompositeObject,
          offsetX + child.x,
          offsetY + child.y
        )
        parts.push(...subParts)
      } else {
        const part = await resolveLeafRenderPart(child)
        if (part) {
          // Apply parent cumulative offset
          part.x += offsetX
          part.y += offsetY
          parts.push(part)
        }
      }
    } catch {
      continue
    }
  }

  return parts
}

/**
 * Composite object rendering: recursively traverse all descendants, load thumbnails and composite.
 * Descendants of sub-composites (including union) flattened into same render list.
 */
async function loadCompositeData(compositeObj: CompositeObject) {
  const partsToRender = await collectRenderParts(compositeObj)
  if (partsToRender.length === 0) return

  // Sort: order by renderChain to match main canvas rendering
  const renderChain = resolveRenderChain(compositeObj)
  if (renderChain && renderChain.length > 0) {
    const posMap = new Map<string, number>()
    renderChain.forEach((id: string, idx: number) => posMap.set(id, idx))
    partsToRender.sort((a, b) => {
      const aPos = posMap.get(a.id) ?? 9999
      const bPos = posMap.get(b.id) ?? 9999
      return aPos - bPos
    })
  } else {
    partsToRender.sort((a, b) => a.zIndex - b.zIndex)
  }
  renderParts.value = partsToRender
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function calculateContentBoundingBox() {
  if (singleImage.value) {
    // Single image: simple bounds
    const w = singleImage.value.width
    const h = singleImage.value.height
    contentBBox.value = { minX: 0, minY: 0, maxX: w, maxY: h, width: w, height: h }
    return
  }
  
  if (renderParts.value.length === 0) {
    contentBBox.value = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 }
    return
  }
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  
  renderParts.value.forEach(part => {
    const w = part.width * Math.abs(part.scaleX)
    const h = part.height * Math.abs(part.scaleY)
    
    const left = part.x - part.anchorX * w
    const right = part.x + (1 - part.anchorX) * w
    const top = part.y - part.anchorY * h
    const bottom = part.y + (1 - part.anchorY) * h
    
    minX = Math.min(minX, left)
    maxX = Math.max(maxX, right)
    minY = Math.min(minY, top)
    maxY = Math.max(maxY, bottom)
  })
  
  contentBBox.value = { 
    minX, minY, maxX, maxY, 
    width: maxX - minX, 
    height: maxY - minY 
  }
}

function calculateImageLayout() {
  if (!canvasRef.value) return

  const canvas = canvasRef.value
  const bbox = contentBBox.value
  
  const padding = 20
  const availableWidth = canvas.width - padding * 2
  const availableHeight = canvas.height - padding * 2
  
  const scaleX = availableWidth / (bbox.width || 1)
  const scaleY = availableHeight / (bbox.height || 1)
  imageScale.value = Math.min(scaleX, scaleY, 1)
  
  const scaledWidth = bbox.width * imageScale.value
  const scaledHeight = bbox.height * imageScale.value
  imageOffsetX.value = (canvas.width - scaledWidth) / 2 - bbox.minX * imageScale.value
  imageOffsetY.value = (canvas.height - scaledHeight) / 2 - bbox.minY * imageScale.value
}

function updatePivotPosition(pivot: PivotPoint) {
  const bbox = contentBBox.value
  
  const worldX = bbox.minX + pivot.x * bbox.width
  const worldY = bbox.minY + pivot.y * bbox.height
  
  pivotX.value = worldX * imageScale.value + imageOffsetX.value
  pivotY.value = worldY * imageScale.value + imageOffsetY.value
}

function drawCheckerboard(ctx: CanvasRenderingContext2D) {
  const color1 = '#e0e0e0'
  const color2 = '#ffffff'
  
  for (let y = 0; y < canvasHeight.value; y += CHECKER_SIZE) {
    for (let x = 0; x < canvasWidth.value; x += CHECKER_SIZE) {
      const isOdd = (Math.floor(x / CHECKER_SIZE) + Math.floor(y / CHECKER_SIZE)) % 2 === 1
      ctx.fillStyle = isOdd ? color1 : color2
      ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE)
    }
  }
}

function draw() {
  if (!canvasRef.value) return

  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawCheckerboard(ctx)
  
  if (!hasImage.value) return
  
  const bbox = contentBBox.value
  const bboxLeft = bbox.minX * imageScale.value + imageOffsetX.value
  const bboxTop = bbox.minY * imageScale.value + imageOffsetY.value
  const bboxW = bbox.width * imageScale.value
  const bboxH = bbox.height * imageScale.value
  
  // Draw content border
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.lineWidth = 1
  ctx.strokeRect(bboxLeft, bboxTop, bboxW, bboxH)
  
  // Draw single image or parts
  if (singleImage.value) {
    ctx.save()
    ctx.translate(imageOffsetX.value, imageOffsetY.value)
    ctx.scale(imageScale.value, imageScale.value)
    ctx.drawImage(singleImage.value, 0, 0)
    ctx.restore()
  } else {
    renderParts.value.forEach(part => {
      ctx.save()
      
      const cx = part.x * imageScale.value + imageOffsetX.value
      const cy = part.y * imageScale.value + imageOffsetY.value
      
      ctx.translate(cx, cy)
      ctx.rotate(part.rotation)
      ctx.scale(part.scaleX * imageScale.value, part.scaleY * imageScale.value)
      
      const drawX = -part.anchorX * part.width
      const drawY = -part.anchorY * part.height
      ctx.drawImage(part.image, drawX, drawY, part.width, part.height)
      
      ctx.restore()
    })
  }
  
  // Draw pivot crosshair
  const crossSize = 15
  const lineWidth = 2
  
  ctx.strokeStyle = '#ff0000'
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(pivotX.value - crossSize, pivotY.value)
  ctx.lineTo(pivotX.value + crossSize, pivotY.value)
  ctx.moveTo(pivotX.value, pivotY.value - crossSize)
  ctx.lineTo(pivotX.value, pivotY.value + crossSize)
  ctx.stroke()
  
  ctx.fillStyle = '#ff0000'
  ctx.beginPath()
  ctx.arc(pivotX.value, pivotY.value, 4, 0, Math.PI * 2)
  ctx.fill()
  
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(pivotX.value, pivotY.value, 5, 0, Math.PI * 2)
  ctx.stroke()
}

// ------------------------------------------------------------------
// Interaction
// ------------------------------------------------------------------

function handleMouseDown(event: MouseEvent) {
  if (!canvasRef.value || !hasImage.value) return
  
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const scaleRatio = canvas.width / rect.width
  const x = (event.clientX - rect.left) * scaleRatio
  const y = (event.clientY - rect.top) * scaleRatio
  
  isDragging.value = true
  updatePivotFromCanvas(x, y)
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value || !canvasRef.value || !hasImage.value) return
  
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const scaleRatio = canvas.width / rect.width
  const x = (event.clientX - rect.left) * scaleRatio
  const y = (event.clientY - rect.top) * scaleRatio
  
  updatePivotFromCanvas(x, y)
}

function handleMouseUp() {
  isDragging.value = false
}

function updatePivotFromCanvas(canvasX: number, canvasY: number) {
  const bbox = contentBBox.value
  
  const worldX = (canvasX - imageOffsetX.value) / imageScale.value
  const worldY = (canvasY - imageOffsetY.value) / imageScale.value
  
  const relativeX = (worldX - bbox.minX) / bbox.width
  const relativeY = (worldY - bbox.minY) / bbox.height
  
  const newPivot: PivotPoint = {
    x: Math.max(0, Math.min(1, relativeX)),
    y: Math.max(0, Math.min(1, relativeY))
  }
  
  pivotX.value = canvasX
  pivotY.value = canvasY
  
  emit('update:pivot', newPivot)
  draw()
}

function resizeCanvas() {
  if (!canvasRef.value) return
  
  const container = canvasRef.value.parentElement
  if (!container) return
  
  canvasWidth.value = container.clientWidth
  canvasHeight.value = container.clientHeight
  
  canvasRef.value.width = canvasWidth.value
  canvasRef.value.height = canvasHeight.value
  
  if (hasImage.value) {
    calculateImageLayout()
    updatePivotPosition(props.pivot)
  }
  draw()
}
</script>

<style scoped>
.anchor-canvas-container {
  width: 100%;
  height: 200px;
  position: relative;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.anchor-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.loading-overlay, .error-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  color: #6b7280;
}

.error-overlay {
  color: #dc2626;
  background: rgba(254, 226, 226, 0.9);
}

.empty-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: 
    linear-gradient(45deg, #e0e0e0 25%, transparent 25%), 
    linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), 
    linear-gradient(45deg, transparent 75%, #e0e0e0 75%), 
    linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  background-color: #ffffff;
  color: #9ca3af;
  font-size: 13px;
}
</style>

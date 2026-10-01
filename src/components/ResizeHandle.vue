<template>
  <div 
    class="resize-handle"
    :class="{ horizontal: direction === 'horizontal', vertical: direction === 'vertical' }"
    @mousedown="startResize"
  >
    <div class="resize-indicator" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  direction: 'horizontal' | 'vertical'
  minSize?: number
  maxSize?: number
  target?: 'prev' | 'next' // Target element: previous or next sibling
}>()

const emit = defineEmits<(e: 'resize', size: number) => void>()

function startResize(event: MouseEvent) {
  event.preventDefault()
  
  const startX = event.pageX
  const startY = event.pageY
  
  // Get target element based on target property
  const handle = event.currentTarget as HTMLElement
  const targetElement = (props.target === 'next' 
    ? handle.nextElementSibling 
    : handle.previousElementSibling) as HTMLElement
  
  if (!targetElement) return
  
  const startSize = props.direction === 'horizontal' 
    ? targetElement.offsetWidth
    : targetElement.offsetHeight
  
  function onMouseMove(e: MouseEvent) {
    const delta = props.direction === 'horizontal' 
      ? e.pageX - startX 
      : e.pageY - startY
    
    // If target is next element, delta must be inverted (dragging right decreases width)
    const adjustedDelta = props.target === 'next' ? -delta : delta
    let newSize = startSize + adjustedDelta
    
    // Apply constraints
    if (props.minSize !== undefined) {
      newSize = Math.max(newSize, props.minSize)
    }
    if (props.maxSize !== undefined) {
      newSize = Math.min(newSize, props.maxSize)
    }
    
    emit('resize', newSize)
  }
  
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.body.style.cursor = props.direction === 'horizontal' ? 'ew-resize' : 'ns-resize'
  document.body.style.userSelect = 'none'
}
</script>

<style scoped>
.resize-handle {
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.resize-handle.horizontal {
  width: 4px;
  cursor: ew-resize;
  background: transparent;
  transition: background 0.2s;
}

.resize-handle.vertical {
  height: 4px;
  cursor: ns-resize;
  background: transparent;
  transition: background 0.2s;
}

.resize-handle:hover {
  background: #3b82f6;
}

.resize-indicator {
  position: absolute;
  background: #d1d5db;
  transition: background 0.2s;
}

.horizontal .resize-indicator {
  width: 1px;
  height: 100%;
  left: 50%;
  transform: translateX(-50%);
}

.vertical .resize-indicator {
  width: 100%;
  height: 1px;
  top: 50%;
  transform: translateY(-50%);
}

.resize-handle:hover .resize-indicator {
  background: #3b82f6;
}
</style>

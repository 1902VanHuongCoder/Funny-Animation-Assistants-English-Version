import * as PIXI from 'pixi.js'
import { markRaw, onBeforeUnmount, onMounted, type Ref,ref, shallowRef } from 'vue'

export interface PixiCanvasOptions {
  width?: number
  height?: number
  backgroundColor?: number
}

export function usePixiCanvas(
  container: Ref<HTMLDivElement | undefined>,
  options: PixiCanvasOptions = {}
) {
  const app = shallowRef<PIXI.Application | null>(null)
  const stage = shallowRef<PIXI.Container | null>(null)
  const isReady = ref(false)

  const {
    width = 1920,
    height = 1080,
    backgroundColor = 0x1f2937
  } = options

  // Initialize Pixi application
  async function initPixiApp() {
    if (!container.value || app.value) return

    await Promise.resolve() // Ensure async behavior

    try {

      // Create Pixi application
      const pixiApp = new PIXI.Application({
        width,
        height,
        backgroundColor,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      })
      // Expose to Devtools in development environment
      const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
      if (isDev) {
        (globalThis as unknown as Record<string, unknown>)['__PIXI_APP__'] = pixiApp;
      }
      // Add canvas to container
      container.value.appendChild(pixiApp.view as HTMLCanvasElement)

      // Use markRaw to mark Pixi instance and prevent Vue deep proxying
      app.value = markRaw(pixiApp)
      stage.value = markRaw(pixiApp.stage)
      isReady.value = true

    } catch (error) {
      console.error('[PixiCanvas] Initialization failed:', error)
    }
  }

  // Destroy Pixi application
  function destroyPixiApp() {
    if (app.value) {
      app.value.destroy(true, { children: true, texture: true })
      app.value = null
      stage.value = null
      isReady.value = false
    }
  }

  // Add object to stage
  function addToStage(displayObject: PIXI.Container) {
    if (stage.value) {
      stage.value.addChild(displayObject)
    }
  }

  // Remove object from stage
  function removeFromStage(displayObject: PIXI.Container) {
    if (stage.value) {
      stage.value.removeChild(displayObject)
    }
  }

  // Clear stage
  function clearStage() {
    if (stage.value) {
      stage.value.removeChildren()
    }
  }

  // Resize canvas
  function resize(newWidth: number, newHeight: number) {
    if (app.value) {
      app.value.renderer.resize(newWidth, newHeight)
    }
  }

  onMounted(() => {
    void initPixiApp()
  })

  onBeforeUnmount(() => {
    destroyPixiApp()
  })

  return {
    app,
    stage,
    isReady,
    addToStage,
    removeFromStage,
    clearStage,
    resize
  }
}

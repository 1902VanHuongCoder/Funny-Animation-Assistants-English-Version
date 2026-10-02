/**
 * Action Handlers unified export
 * v8.6 P2: Unified Action handling logic
 * v9.3: Added SetVisualHandler and SetLifecycleHandler
 * v10.0: TriggerAnimHandler → SetAnimHandler
 */

// Type exports
export * from './registry'
export * from './types'

// Handler exports
export { CameraCutHandler } from './handlers/CameraCutHandler'
export { CameraMoveHandler } from './handlers/CameraMoveHandler'
export { SetCompositeHandler } from './handlers/SetCompositeHandler'
export { SetLifecycleHandler } from './handlers/SetLifecycleHandler'
export { SetLightHandler } from './handlers/SetLightHandler'
export { SetMaskHandler } from './handlers/SetMaskHandler'
export { SetMaterialHandler } from './handlers/SetMaterialHandler'
export { SetScreenEffectHandler } from './handlers/SetScreenEffectHandler'
export { SetTextHandler } from './handlers/SetTextHandler'
export { SetTransformHandler } from './handlers/SetTransformHandler'
export { SetVisualHandler } from './handlers/SetVisualHandler'
export { TweenLightHandler } from './handlers/TweenLightHandler'
export { TweenScreenEffectHandler } from './handlers/TweenScreenEffectHandler'
export { TweenTextHandler } from './handlers/TweenTextHandler'
export { TweenTransformHandler } from './handlers/TweenTransformHandler'

// Auto-register all Handlers
import { CameraCutHandler } from './handlers/CameraCutHandler'
import { CameraMoveHandler } from './handlers/CameraMoveHandler'
import { SetCompositeHandler } from './handlers/SetCompositeHandler'
import { SetLifecycleHandler } from './handlers/SetLifecycleHandler'
import { SetLightHandler } from './handlers/SetLightHandler'
import { SetMaskHandler } from './handlers/SetMaskHandler'
import { SetMaterialHandler } from './handlers/SetMaterialHandler'
import { SetScreenEffectHandler } from './handlers/SetScreenEffectHandler'
import { SetTextHandler } from './handlers/SetTextHandler'
import { SetTransformHandler } from './handlers/SetTransformHandler'
import { SetVisualHandler } from './handlers/SetVisualHandler'
import { TweenLightHandler } from './handlers/TweenLightHandler'
import { TweenScreenEffectHandler } from './handlers/TweenScreenEffectHandler'
import { TweenTextHandler } from './handlers/TweenTextHandler'
import { TweenTransformHandler } from './handlers/TweenTransformHandler'
import { registerHandler } from './registry'

// Register Handlers
registerHandler(SetTransformHandler)
registerHandler(SetVisualHandler)      // Added in v9.3
registerHandler(SetLifecycleHandler)   // v9.3
registerHandler(SetCompositeHandler)   // P2
registerHandler(SetMaskHandler)        // Clip-Mask Phase 1

registerHandler(TweenTransformHandler)
registerHandler(SetScreenEffectHandler)   // Added in Phase 1
registerHandler(SetLightHandler)          // Point light PRD Phase 0.5
registerHandler(SetMaterialHandler)       // Added in v16
registerHandler(SetTextHandler)           // Text PRD Phase 0
registerHandler(TweenScreenEffectHandler) // Added in Phase 1
registerHandler(TweenLightHandler)        // Point light PRD Phase 0.5
registerHandler(TweenTextHandler)         // Text PRD Phase 1
registerHandler(CameraCutHandler)
registerHandler(CameraMoveHandler)

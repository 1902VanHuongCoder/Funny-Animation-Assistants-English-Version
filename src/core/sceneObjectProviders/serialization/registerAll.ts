/**
 * Serializer entry point — ensures all serializers are registered to registry
 *
 * sceneObjectStore imports this file before using serializers to trigger all registerTypeSerializer() calls.
 */

// Note: import order does not affect functionality, registerTypeSerializer() runs automatically upon module load
// characterSerializer removed
import './backgroundSerializer'
import './audioSerializer'
import './propSerializer'
import './screenEffectSerializer'
import './compositeSerializer'
import './symbolSerializer'
import './expressionSerializer'
import './maskSerializer'
import './lightSerializer'
import './textSerializer'

// P2: Register composite lifecycle hooks (no PIXI dependency, safe for test environments)
import { registerCompositeLifecycleHooks } from '@/core/sceneObjectProviders/compositeProvider'
registerCompositeLifecycleHooks()

/**
 * Light serializer
 *
 * v25.1: Both ambient and point lights participate in serialization/deserialization.
 * Ambient light is auto-created by sceneLoader (if absent), but user modifications to
 * lightColor / lightIntensity need persistence so ScenePlayer can read them.
 *
 * Phase 1: Added flicker / flickerSpeed / directionMode / directionAngle / coneAngle
 * Serialization strategy: Only non-default values written to reduce file size (backward compatibility guaranteed by createLightObject defaults).
 */

import type { LightObject, SceneObject } from '@/types/sceneObject'

import type { DeserializeContext, TypeSerializer } from './index'
import { registerTypeSerializer } from './index'

const lightSerializer: TypeSerializer = {
    serializeFields(obj: SceneObject, base: Record<string, unknown>): void {
        const light = obj as LightObject
        base['lightType'] = light.lightType
        base['lightColor'] = light.lightColor
        base['lightIntensity'] = light.lightIntensity
        base['lightRadius'] = light.lightRadius

        // Phase 1: Only write non-default values (reduce file size)
        if (light.flicker !== undefined && light.flicker !== 0) {
            base['flicker'] = light.flicker
        }
        if (light.flickerSpeed !== undefined && light.flickerSpeed !== 0.35) {
            base['flickerSpeed'] = light.flickerSpeed
        }
        if (light.directionMode !== undefined && light.directionMode !== 'omni') {
            base['directionMode'] = light.directionMode
            // Directional parameters only meaningful in cone mode
            if (light.directionAngle !== undefined && light.directionAngle !== 0) {
                base['directionAngle'] = light.directionAngle
            }
            if (light.coneAngle !== undefined && light.coneAngle !== 100) {
                base['coneAngle'] = light.coneAngle
            }
        }
    },

    deserialize(objData: SceneObject, ctx: DeserializeContext): void {
        const lightData = objData as LightObject

        // Value range validation: fallback to 'point' on unknown lightType
        const validLightTypes = ['ambient', 'point', 'spot'] as const
        const lightType = validLightTypes.includes(lightData.lightType)
            ? lightData.lightType
            : 'point'

        const lightObj = ctx.createLightObject(
            lightType,
            objData.name ?? (
                lightData.lightType === 'ambient'
                    ? 'Ambient Light'
                    : lightData.lightType === 'spot'
                        ? 'Spotlight'
                        : 'Point Light'
            ),
            {
                lightColor: lightData.lightColor,
                lightIntensity: lightData.lightIntensity,
                lightRadius: lightData.lightRadius,
                // Phase 1: Conditional spread, only pass when not undefined (compatible with exactOptionalPropertyTypes)
                ...(lightData.flicker !== undefined ? { flicker: lightData.flicker } : {}),
                ...(lightData.flickerSpeed !== undefined ? { flickerSpeed: lightData.flickerSpeed } : {}),
                ...(lightData.directionMode !== undefined ? { directionMode: lightData.directionMode } : {}),
                ...(lightData.directionAngle !== undefined ? { directionAngle: lightData.directionAngle } : {}),
                ...(lightData.coneAngle !== undefined ? { coneAngle: lightData.coneAngle } : {}),
                x: objData.x,
                y: objData.y,
            },
            objData.id,
            objData.alias,
        )

        ctx.updateObject(lightObj.id, {
            x: objData.x,
            y: objData.y,
            zIndex: objData.zIndex,
            visible: objData.visible ?? true,
            alpha: objData.alpha ?? 1,
            spawned: objData.spawned ?? true,
        })
    },
}

registerTypeSerializer('light', lightSerializer)

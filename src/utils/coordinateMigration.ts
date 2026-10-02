/**
 * v1 -> v2 coordinate migration
 *
 * v1: prop/background x/y were top-left coordinates
 * v2: All objects uniformly use center coordinates
 *
 * Migration formula (top-left -> center):
 *   newX = oldX + (width * scaleX) / 2
 *   newY = oldY + (height * scaleY) / 2
 *
 * camera / screen_effect are already center coordinates, no migration needed.
 */

import type { ProjectData } from '@/types/project'

/** Object types requiring coordinate migration (types storing top-left coordinates in v1) */
const TYPES_NEEDING_MIGRATION: ReadonlySet<string> = new Set([
    'prop',
    'background',
])

interface MigratableObject {
    type: string
    x: number
    y: number
    width: number
    height: number
    scaleX: number
    scaleY: number
}

/**
 * Convert single object coordinate from top-left to center
 */
function migrateObjectCoordinate(obj: MigratableObject): void {
    if (!TYPES_NEEDING_MIGRATION.has(obj.type)) return

    // Defensive: when width/height is 0, cannot accurately migrate (Background first created before loading texture)
    // But saved projects typically have non-zero width/height (synced to store during render)
    const halfW = (obj.width * obj.scaleX) / 2
    const halfH = (obj.height * obj.scaleY) / 2

    obj.x = obj.x + halfW
    obj.y = obj.y + halfH
}

/**
 * Migrate ProjectData from v1 format to v2 format
 * - Traverse all episode -> scene -> setup.objects, migrate coordinates
 * - Update meta.version to '2.0.0'
 */
export function migrateV1ToV2(projectData: ProjectData): void {
    const episodes = projectData.episodes as {
        scenes?: {
            setup?: {
                objects?: MigratableObject[]
            }
            script?: {
                actions?: {
                    type: string
                    target: string
                    params?: Record<string, unknown>
                }[]
            }[]
        }[]
    }[] | undefined

    if (!episodes) return

    for (const episode of episodes) {
        if (!episode.scenes) continue

        for (const scene of episode.scenes) {
            // Migrate coordinates in setup.objects
            if (scene.setup?.objects) {
                for (const obj of scene.setup.objects) {
                    migrateObjectCoordinate(obj)
                }
            }

            // Note: x/y params in Action (e.g. set_transform, tween_transform)
            // store action target coordinates, which should also follow center coordinate semantics.
            // In v1, action values matched obj.x/y semantics (top-left).
            // Therefore coordinates in Action also need to be migrated.
            if (scene.script) {
                for (const block of scene.script) {
                    if (!block.actions) continue
                    for (const action of block.actions) {
                        migrateActionCoordinate(action, scene.setup?.objects)
                    }
                }
            }
        }
    }

    // Update version number
    projectData.meta.version = '2.0.0'
}

/**
 * Migrate coordinate parameters in Action
 *
 * Action types requiring migration:
 * - set_transform: params.x/y (if target is a type requiring migration)
 * - tween_transform: params.x/y (same as above)
 * - camera_cut / camera_move: target='camera', already center coordinates, no migration
 */
function migrateActionCoordinate(
    action: { type: string; target: string; params?: Record<string, unknown> },
    setupObjects?: MigratableObject[]
): void {
    if (!action.params) return

    // camera actions do not need migration
    if (action.target === 'camera') return

    // Only process action types containing x/y
    const actionTypesWithCoords = ['set_transform', 'tween_transform']
    if (!actionTypesWithCoords.includes(action.type)) return

    // Skip if action has neither x nor y param
    const hasX = action.params['x'] !== undefined
    const hasY = action.params['y'] !== undefined
    if (!hasX && !hasY) return

    // Look up target object to obtain width/height
    // Note: coordinates in setupObjects are already migrated by this point, but width/height/scale remain unchanged
    const targetObj = setupObjects?.find(
        (obj) => (obj as unknown as { id: string }).id === action.target
    ) as (MigratableObject & { id: string }) | undefined

    if (!targetObj) return
    if (!TYPES_NEEDING_MIGRATION.has(targetObj.type)) return

    const halfW = (targetObj.width * targetObj.scaleX) / 2
    const halfH = (targetObj.height * targetObj.scaleY) / 2

    if (hasX) {
        action.params['x'] = (action.params['x'] as number) + halfW
    }
    if (hasY) {
        action.params['y'] = (action.params['y'] as number) + halfH
    }
}

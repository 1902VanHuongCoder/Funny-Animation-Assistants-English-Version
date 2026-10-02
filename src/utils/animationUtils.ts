/**
 * Animation utility functions
 * v11.2: Provides common frame-sequence animation utilities to avoid code duplication
 */

import * as PIXI from 'pixi.js'

/**
 * Still frame configuration interface
 * Suitable for legacy assets, PropAsset, BackgroundAsset, etc.
 */
export interface StillFrameConfig {
    /** Still frame source: 'frame' uses frame sequence, 'custom' uses custom texture */
    stillFrameSource?: 'frame' | 'custom' | undefined
    /** Still frame index (used when stillFrameSource='frame') */
    stillFrameIndex?: number | undefined
    /** Custom still frame URL (used when stillFrameSource='custom') */
    url?: string | undefined
}

/**
 * Texture getter type
 */
export type TextureGetter = (url: string) => PIXI.Texture | undefined

/**
 * Restore AnimatedSprite still frame
 * @param sprite Target AnimatedSprite
 * @param config Still frame config
 * @param textureGetter Texture getter
 */
export function restoreAnimatedSpriteStillFrame(
    sprite: PIXI.AnimatedSprite,
    config: StillFrameConfig,
    textureGetter: TextureGetter
): void {
    if (sprite.textures.length === 0) {
        return
    }

    // Custom still frame mode
    if (config.stillFrameSource === 'custom' && config.url) {
        const stillTexture = textureGetter(config.url)
        if (stillTexture && stillTexture !== PIXI.Texture.EMPTY) {
            sprite.texture = stillTexture
            return
        }
    }

    // Sequence frame mode: use specified still frame index
    let stillIdx = 0

    if (typeof config.stillFrameIndex === 'number' &&
        config.stillFrameIndex >= 0 &&
        config.stillFrameIndex < sprite.textures.length) {
        stillIdx = config.stillFrameIndex
    }

    sprite.gotoAndStop(stillIdx)
}

/**
 * Restore AnimatedSprite to first frame
 * Simplified version, directly jumps to frame 0
 */
export function restoreAnimatedSpriteFirstFrame(sprite: PIXI.AnimatedSprite): void {
    if (sprite.textures.length > 0) {
        sprite.gotoAndStop(0)
    }
}

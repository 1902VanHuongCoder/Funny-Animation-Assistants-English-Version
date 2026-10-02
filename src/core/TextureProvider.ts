/**
 * Texture provider interface
 * Abstracts differences in texture retrieval across different engines (editor / preview / export)
 */

import type * as PIXI from 'pixi.js'

/**
 * Unified texture retrieval strategy
 *
 * Engine implementation differences:
 * - ScenePlayer: getImageUrl -> PIXI.Texture.from
 * - ActionPreview: useAssetLoader().getTexture (strict mode, throws if missing)
 * - FrameCapture: getImageUrl -> PIXI.Texture.from (strict mode, throws if missing)
 * - useSceneGraph: getImageUrl -> PIXI.Texture.from
 */
export interface TextureProvider {
    /**
     * Retrieve texture object
     * If implemented in strict mode, throws Error when missing
     */
    getTexture(url: string): PIXI.Texture

    /**
     * Convert asset path to a loadable URL (usually a blob URL)
     */
    getImageUrl(url: string): string
}

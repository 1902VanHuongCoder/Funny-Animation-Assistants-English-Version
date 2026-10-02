import * as PIXI from 'pixi.js'

/**
 * Synchronize assets from Legacy Cache (TextureCache/BaseTextureCache) to Modern Cache (Assets)
 * @param id - Resource URL or ID (e.g. blob:...)
 */
export function syncLegacyToAssets(id: string): void {
    // 1. If already present in Assets, return immediately to avoid redundant work
    if (PIXI.Assets.cache.has(id)) {
        return
    }

    let texture: PIXI.Texture | null = null

    // 2. Prefer checking TextureCache (most common case)
    if (PIXI.utils.TextureCache[id]) {
        texture = PIXI.utils.TextureCache[id]
    }
    // 3. If not in TextureCache, check BaseTextureCache
    else if (PIXI.utils.BaseTextureCache[id]) {
        const baseTexture = PIXI.utils.BaseTextureCache[id]

        // [Key Step]
        // The Assets system and Sprite need Texture, not BaseTexture.
        // Therefore we create a new Texture based on this BaseTexture.
        texture = new PIXI.Texture(baseTexture)

        // For consistency, restore it to TextureCache as well (optional, but recommended)
        PIXI.utils.TextureCache[id] = texture
    }

    // 4. If texture found, inject it into Assets cache system
    if (texture) {
        PIXI.Assets.cache.set(id, texture)
    }
}

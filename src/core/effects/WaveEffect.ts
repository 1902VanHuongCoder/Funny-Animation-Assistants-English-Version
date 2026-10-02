/**
 * WaveEffect.ts (v11.5)
 * 
 * Wave undulation effect using PIXI.SimplePlane for vertex deformation
 * Makes assets flutter in the wind like flags or cloaks
 */

import * as PIXI from 'pixi.js'

/**
 * Wave effect parameters
 */
export interface WaveEffectParams {
    speed?: number        // Speed multiplier (default 1.0)
    amplitude?: number    // Amplitude in pixels (default 10)
    frequency?: number    // Frequency (default 2)
    direction?: 'horizontal' | 'vertical' | 'both'  // Direction (default horizontal)
    segments?: number     // Grid subdivision count (default 10)
}

/**
 * Wave effect instance state
 */
interface WaveInstance {
    originalSprite: PIXI.Sprite | PIXI.AnimatedSprite
    simplePlane: PIXI.SimplePlane
    originalVertices: Float32Array
    params: Required<WaveEffectParams>
    startTime: number
    originalAnchor?: { x: number; y: number }
}

/**
 * WaveEffect
 * Manages creation, update, and destruction of wave effects
 */
export class WaveEffect {
    private instances = new Map<string, WaveInstance>()
    private currentTime = 0

    /**
     * Update time
     * @param deltaTime Time delta (ms)
     */
    update(deltaTime: number): void {
        this.currentTime += deltaTime
    }

    /**
     * Apply wave effect to Sprite
     * @param partId Part ID
     * @param sprite Original Sprite
     * @param container Parent container
     * @param params Effect parameters
     * @returns Created SimplePlane
     */
    applyEffect(
        partId: string,
        sprite: PIXI.Sprite | PIXI.AnimatedSprite,
        container: PIXI.Container,
        params: WaveEffectParams = {}
    ): PIXI.SimplePlane | null {
        // If instance exists, update parameters only
        const existing = this.instances.get(partId)
        if (existing) {
            existing.params = this.normalizeParams(params)
            return existing.simplePlane
        }

        // Get texture
        const texture = sprite.texture
        if (!texture || texture === PIXI.Texture.EMPTY) {
            console.warn('[WaveEffect] Cannot apply effect: sprite has no texture')
            return null
        }

        // Normalize parameters
        const normalizedParams = this.normalizeParams(params)
        const segments = normalizedParams.segments

        // Create SimplePlane
        const simplePlane = new PIXI.SimplePlane(texture, segments + 1, segments + 1)

        // Copy original Sprite transform properties
        simplePlane.position.copyFrom(sprite.position)
        simplePlane.scale.copyFrom(sprite.scale)
        simplePlane.rotation = sprite.rotation
        simplePlane.alpha = sprite.alpha
        simplePlane.visible = sprite.visible
        simplePlane.zIndex = sprite.zIndex
        simplePlane.name = sprite.name ? `${sprite.name}_wave` : null

        let originalAnchor: { x: number; y: number } | undefined
        if ('anchor' in sprite) {
            const anchor = sprite.anchor
            const anchorX = anchor.x
            const anchorY = anchor.y
            simplePlane.pivot.set(
                texture.width * anchorX,
                texture.height * anchorY
            )
            originalAnchor = { x: anchorX, y: anchorY }
        }

        // Save original vertex positions
        const positionBuffer = simplePlane.geometry.getBuffer('aVertexPosition')
        const originalVertices = new Float32Array(positionBuffer.data.length)
        originalVertices.set(positionBuffer.data)

        // Remove original Sprite from container, add SimplePlane
        const index = container.getChildIndex(sprite)
        sprite.visible = false
        sprite.renderable = false
        container.addChildAt(simplePlane, index)

        const instance: WaveInstance = {
            originalSprite: sprite,
            simplePlane,
            originalVertices,
            params: normalizedParams,
            startTime: this.currentTime
        }
        if (originalAnchor) instance.originalAnchor = originalAnchor
        this.instances.set(partId, instance)

        return simplePlane
    }

    /**
     * Update vertices for all wave effects
     */
    updateAllEffects(): void {
        for (const [partId, instance] of this.instances) {
            this.updateVertices(partId, instance)
        }
    }

    /**
     * Update vertices for a single effect
     */
    private updateVertices(_partId: string, instance: WaveInstance): void {
        const { simplePlane, originalSprite, originalVertices, params, startTime } = instance
        const elapsed = (this.currentTime - startTime) / 1000 // Convert to seconds

        // v11.95: Synchronize original Sprite transform to SimplePlane
        // Fixes issue where part does not follow virtual group/part transform animation during wave effect
        simplePlane.position.copyFrom(originalSprite.position)
        simplePlane.scale.copyFrom(originalSprite.scale)
        simplePlane.rotation = originalSprite.rotation
        simplePlane.alpha = originalSprite.alpha
        // visible not synced because original sprite is always false

        const currentTexture = instance.originalSprite.texture
        if (currentTexture && currentTexture !== PIXI.Texture.EMPTY && simplePlane.texture !== currentTexture) {
            simplePlane.texture = currentTexture
            const anchor = instance.originalAnchor
            if (anchor) {
                simplePlane.pivot.set(
                    currentTexture.width * anchor.x,
                    currentTexture.height * anchor.y
                )
            }
        }

        const positionBuffer = simplePlane.geometry.getBuffer('aVertexPosition')
        const vertices = new Float32Array(positionBuffer.data as ArrayLike<number>)

        const { speed, amplitude, frequency, direction, segments } = params
        const vertexPerRow = segments + 1

        for (let i = 0; i < vertices.length / 2; i++) {
            const col = i % vertexPerRow
            const row = Math.floor(i / vertexPerRow)

            // Original position
            const originalX = originalVertices[i * 2]
            const originalY = originalVertices[i * 2 + 1]

            if (originalX === undefined || originalY === undefined) continue

            // Compute wave offset
            // Offset increases with row/column (simulating flag fixed at one end)
            const phase = elapsed * speed * frequency * Math.PI * 2

            let offsetX = 0
            let offsetY = 0

            // Horizontal wave (X-axis displacement, based on Y/Row)
            if (direction === 'horizontal' || direction === 'both') {
                const factor = row / segments
                // sin(phase + row) produces undulation
                offsetX = Math.sin(phase + row * 0.5) * amplitude * factor
            }

            // Vertical wave (Y-axis displacement, based on X/Col)
            if (direction === 'vertical' || direction === 'both') {
                const factor = col / segments
                // sin(phase + col) produces undulation
                offsetY = Math.sin(phase + col * 0.5) * amplitude * factor
            }

            // Apply superposition of both directions
            vertices[i * 2] = originalX + offsetX
            vertices[i * 2 + 1] = originalY + offsetY
        }

        // Update position buffer
        const bufferData = positionBuffer.data as unknown as Float32Array
        bufferData.set(vertices)
        positionBuffer.update()
    }

    /**
     * Remove wave effect, restore original Sprite
     * @param partId Part ID
     * @param container Parent container
     */
    removeEffect(partId: string, container: PIXI.Container): PIXI.Sprite | PIXI.AnimatedSprite | null {
        const instance = this.instances.get(partId)
        if (!instance) return null

        const { originalSprite, simplePlane } = instance

        // v12.1: If Sprite or SimplePlane destroyed (transform is null), skip position sync
        const spriteDestroyed = (originalSprite as unknown as { destroyed?: boolean }).destroyed === true || !(originalSprite as unknown as { transform?: unknown }).transform
        const planeDestroyed = (simplePlane as unknown as { destroyed?: boolean }).destroyed === true || !(simplePlane as unknown as { transform?: unknown }).transform

        if (!spriteDestroyed && !planeDestroyed) {
            // Restore original Sprite visibility
            originalSprite.visible = true
            originalSprite.renderable = true

            // Sync position (in case SimplePlane was moved)
            originalSprite.position.copyFrom(simplePlane.position)
            originalSprite.scale.copyFrom(simplePlane.scale)
            originalSprite.rotation = simplePlane.rotation
            originalSprite.alpha = simplePlane.alpha
        }

        // Remove SimplePlane from container (safety check)
        if (!planeDestroyed) {
            container.removeChild(simplePlane)
            simplePlane.destroy()
        }

        // Delete instance
        this.instances.delete(partId)

        return spriteDestroyed ? null : originalSprite
    }

    /**
     * Check if part has wave effect applied
     */
    hasEffect(partId: string): boolean {
        return this.instances.has(partId)
    }

    /**
     * Get wave effect SimplePlane (if present)
     */
    getSimplePlane(partId: string): PIXI.SimplePlane | undefined {
        return this.instances.get(partId)?.simplePlane
    }

    /**
     * Clear all effects
     */
    clear(container: PIXI.Container): void {
        for (const partId of this.instances.keys()) {
            this.removeEffect(partId, container)
        }
    }

    /**
     * Normalize parameters
     */
    private normalizeParams(params: WaveEffectParams): Required<WaveEffectParams> {
        return {
            speed: params.speed ?? 1.0,
            amplitude: params.amplitude ?? 10,
            frequency: params.frequency ?? 2,
            direction: params.direction ?? 'horizontal',
            segments: params.segments ?? 10
        }
    }

    /**
     * Get active effect count
     */
    get activeCount(): number {
        return this.instances.size
    }
}

/**
 * Create WaveEffect instance
 */
export function createWaveEffect(): WaveEffect {
    return new WaveEffect()
}

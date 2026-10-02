/**
 * spriteAnimationDriver.ts
 *
 * Unified AnimatedSprite manual frame advancement module.
 *
 * ScenePlayer and FrameCapture share the same logic:
 *  - Disable PIXI Ticker automatic updates (autoUpdate = false)
 *  - Host passes deltaTime every frame, manually calculating frame index and calling gotoAndStop
 *
 * This eliminates the 1-frame latency in ScenePlayer when "spawn frame + play frame" coincide,
 * because we no longer rely on PIXI Ticker asynchronously advancing AnimatedSprite,
 * but instead advance synchronously to the correct frame at the end of updateFrame().
 */

import * as PIXI from 'pixi.js'

interface PlayableSprite extends PIXI.AnimatedSprite {
    _shouldPlay?: boolean
}

function isDisplayObjectContainer(
    child: PIXI.DisplayObject,
): child is PIXI.Container<PIXI.DisplayObject> {
    return child instanceof PIXI.Container
}

/**
 * Recursively advance frame index of all AnimatedSprites within a container
 *
 * Playback determination logic:
 *  1. _shouldPlay = true  -> Explicit play (triggered by initialAnimations / set_anim)
 *  2. _shouldPlay = false -> Explicit stop
 *  3. _shouldPlay = undefined and playing = true -> Play triggered by other code
 *
 * @param container     PIXI container to traverse
 * @param deltaTime     Time delta since previous frame (ms)
 * @param accumulator   WeakMap<AnimatedSprite, number> used to accumulate time
 */
export function advanceAnimatedSprites(
    container: PIXI.Container<PIXI.DisplayObject>,
    deltaTime: number,
    accumulator: WeakMap<PIXI.AnimatedSprite, number>,
): void {
    for (const child of container.children) {
        if (child instanceof PIXI.AnimatedSprite) {
            const shouldPlayAttr = (child as PlayableSprite)._shouldPlay
            const shouldPlay = shouldPlayAttr === true ||
                (shouldPlayAttr !== false && child.playing)

            if (shouldPlay && child.textures.length > 0) {
                const framesPerSecond = child.animationSpeed * 60
                const totalFrames = child.textures.length
                const frameDuration = 1000 / framesPerSecond
                const totalAnimDuration = frameDuration * totalFrames

                let accumTime = accumulator.get(child) ?? 0
                accumTime += deltaTime

                let frameIndex: number
                if (child.loop) {
                    const animTime = accumTime % totalAnimDuration
                    frameIndex = Math.floor(animTime / frameDuration) % totalFrames
                } else {
                    const animTime = Math.min(accumTime, totalAnimDuration - frameDuration)
                    frameIndex = Math.floor(animTime / frameDuration)
                    frameIndex = Math.min(frameIndex, totalFrames - 1)
                }

                accumulator.set(child, accumTime)
                child.gotoAndStop(frameIndex)
            }
        } else if (isDisplayObjectContainer(child)) {
            advanceAnimatedSprites(child, deltaTime, accumulator)
        }
    }
}

/**
 * Traverse objectContainers Map and manually advance all AnimatedSprites
 *
 * @param objectContainers  Object ID -> PIXI.Container mapping
 * @param deltaTime         Time delta since previous frame (ms)
 * @param accumulator       WeakMap used to accumulate time
 */
export function advanceAllObjectAnimations(
    objectContainers: Map<string, PIXI.Container<PIXI.DisplayObject>>,
    deltaTime: number,
    accumulator: WeakMap<PIXI.AnimatedSprite, number>,
): void {
    objectContainers.forEach((container) => {
        // Skip invisible containers (spawned=false objects have container.visible=false)
        // Prevents animation from accumulating frame indices in background before object spawns,
        // which would cause animation to start mid-way upon spawning
        if (!container.visible) return
        advanceAnimatedSprites(container, deltaTime, accumulator)
    })
}

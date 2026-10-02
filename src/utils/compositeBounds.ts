/**
 * Union Composite virtual bounding box calculation utility
 *
 * The PIXI Container of a Union composite is an empty proxy container (renderable = false),
 * and child objects are flattened onto the parent container, so `getLocalBounds()` returns 0.
 * This utility computes the virtual bounding box by converting child container corner coordinates.
 */
import * as PIXI from 'pixi.js'

type ContainerResolver = (childId: string) => PIXI.Container | null | undefined

/**
 * Computes the virtual bounding box of a union composite
 * Traverses child container corners and transforms coordinates to proxyContainer's local coordinate system
 *
 * @param childIds - List of child object IDs
 * @param containerResolver - Callback to get child container by ID
 * @param proxyContainer - Union's proxy container (reference frame for coordinate conversion)
 * @returns Virtual bounding box { x, y, width, height }
 */
export function computeUnionBounds(
    childIds: string[],
    containerResolver: ContainerResolver,
    proxyContainer: PIXI.Container
): { x: number; y: number; width: number; height: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const childId of childIds) {
        const cc = containerResolver(childId)
        if (!cc || (cc as unknown as { destroyed?: boolean }).destroyed) continue
        const cl = cc.getLocalBounds()
        if (cl.width <= 0 || cl.height <= 0) continue

        const corners = [
            new PIXI.Point(cl.x, cl.y),
            new PIXI.Point(cl.x + cl.width, cl.y),
            new PIXI.Point(cl.x + cl.width, cl.y + cl.height),
            new PIXI.Point(cl.x, cl.y + cl.height),
        ]
        for (const corner of corners) {
            const g = cc.toGlobal(corner)
            const l = proxyContainer.toLocal(g)
            minX = Math.min(minX, l.x)
            minY = Math.min(minY, l.y)
            maxX = Math.max(maxX, l.x)
            maxY = Math.max(maxY, l.y)
        }
    }

    return isFinite(minX)
        ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
        : { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * Object evaluation order utilities
 * v17: Topological sort by parentId to ensure parent is evaluated before child
 *
 * When child coordinate transforms depend on current frame state of the parent,
 * we must ensure parent evaluation has completed so context.getObjectState(parentId) returns latest values.
 */

/**
 * Topologically sort object list by parentId
 *
 * Sorting rules:
 * - Objects without parentId come first
 * - Objects with parentId come after their parent
 * - Recursively handle depth in multi-level nesting
 *
 * @param objects Object list (must include id and parentId properties)
 * @returns New topologically sorted array (does not mutate original array)
 */
export function topologicalSortByParent<T extends { id: string; parentId?: string | null | undefined }>(
    objects: readonly T[]
): T[] {
    // Build id -> object mapping
    const idMap = new Map<string, T>()
    for (const obj of objects) {
        idMap.set(obj.id, obj)
    }

    const depthCache = new Map<string, number>()

    function getDepth(obj: T, visiting?: Set<string>): number {
        const cached = depthCache.get(obj.id)
        if (cached !== undefined) return cached

        if (!obj.parentId) {
            depthCache.set(obj.id, 0)
            return 0
        }

        const parent = idMap.get(obj.parentId)
        if (!parent) {
            depthCache.set(obj.id, 0)
            return 0
        }

        // Fail-Fast: Detect circular parentId chain
        const chain = visiting ?? new Set<string>()
        if (chain.has(obj.id)) {
            throw new Error(`[topologicalSortByParent] Circular parent-child relationship detected: ${[...chain, obj.id].join(' → ')}`)
        }
        chain.add(obj.id)

        const depth = getDepth(parent, chain) + 1
        depthCache.set(obj.id, depth)
        return depth
    }

    // Compute all depths
    for (const obj of objects) {
        getDepth(obj)
    }

    // Stable sort: ascending by depth, preserving original order when depths match
    return [...objects].sort((a, b) => {
        const da = depthCache.get(a.id) ?? 0
        const db = depthCache.get(b.id) ?? 0
        return da - db
    })
}

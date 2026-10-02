/**
 * RenderChainStage — Custom render container driven by renderChain
 *
 * Core functionality:
 * Overrides the render() method to call leaf containers' render(renderer) one by one in renderChain order,
 * enabling interleaved rendering between union child objects and sibling objects.
 *
 * Principles:
 * Standard PIXI rendering (recursive child traversal) cannot interleave sorting across union container boundaries.
 * By overriding render(), we bypass default children traversal and directly invoke each leaf container's render(renderer)
 * according to the flattened renderChain order.
 *
 * Key guarantees:
 * - container.render(renderer) uses the pre-computed worldTransform (calculated recursively via updateTransform())
 * - Therefore even if an object is inside a union container, its transform remains correct when called by entity-level render()
 * - Union containers remain in entity.children to participate in updateTransform(), but are not rendered directly
 *
 * renderChain rules:
 * - Union composites do not appear in renderChain; their child objects are flattened out
 * - Entity composites appear in renderChain and possess their own renderChain
 * - renderChain is the single source of truth for rendering order
 *
 * Resolver pattern (root stage specific):
 * - Passes chainResolver/containerResolver callbacks to dynamically retrieve latest data on each render
 * - Avoids stale renderChain on root stage due to object additions/deletions/zIndex changes
 */
import * as PIXI from 'pixi.js'

import { isClipMaskWrapper } from './maskRenderer'

type RootRenderChainOverrideContainer = PIXI.Container & {
    _hasRootRenderChainOverride?: boolean
    _originalRootRender?: PIXI.Container['render']
}

/**
 * Render objects in container in renderChain order
 *
 * Replaces PIXI's default recursive children rendering.
 * Iterates through each ID in renderChain, retrieves corresponding PIXI container from containerMap,
 * and calls its render(renderer) directly.
 *
 * While union child objects reside inside union containers (receiving automatic transform propagation),
 * they are scheduled and rendered independently by this function to achieve interleaved sorting with other child objects.
 *
 * Children not in renderChain (such as overlays, selection boxes) are rendered at the end.
 *
 * @param entityContainer PIXI container of entity composite
 * @param renderChain Ordered ID list (unions flattened)
 * @param containerMap Mapping of objectId -> PIXI.Container
 * @param renderer PIXI.Renderer instance
 */
export function renderByRenderChain(
    entityContainer: PIXI.Container,
    renderChain: readonly string[],
    containerMap: ReadonlyMap<string, PIXI.Container>,
    renderer: PIXI.Renderer,
): void {
    // Strictly differentiate two sets:
    // directlyRendered: Leaf containers — completely rendered via container.render(renderer) (including internal PIXI children).
    //                   Fallback phase must completely skip them, not recursively entering (otherwise sprites redraw in PIXI children order, breaking renderChain sorting).
    // handledAncestors: Union container shells — marked only as ancestors, having no visual content themselves.
    //                   Fallback phase must recursively inspect them to find dynamic spawned child objects not in renderChain.
    const directlyRendered = new Set<PIXI.Container>()
    const handledAncestors = new Set<PIXI.Container>()
    const renderedClipWrappers = new Set<PIXI.Container>()

    // Ancestor visibility check: traverse up from container to entityContainer (exclusive);
    // if any ancestor has visible=false or renderable=false, consider invisible.
    // Aligns with PIXI default worldVisible semantics, compensating for renderChain bypassing ancestor render().
    // Fixes issue where children still displayed when union composite was set to visible=false.
    const isAncestorChainVisible = (container: PIXI.Container): boolean => {
        let parent = container.parent
        while (parent && parent !== entityContainer) {
            if (!parent.visible || !parent.renderable) return false
            parent = parent.parent
        }
        return true
    }

    // Render leaf containers one by one in renderChain order
    for (const objectId of renderChain) {
        const container = containerMap.get(objectId)
        if (!container || container.destroyed || !container.visible) continue
        // Ancestor chain visibility check (intermediate containers like union/entity)
        if (!isAncestorChainVisible(container)) continue

        // Clip-Mask Phase 1: maskRenderer wraps target in-place inside a temporary wrapper.
        // renderChain normally invokes target.render(renderer) directly for interleaved sorting, bypassing parent wrapper,
        // causing masks/filters attached to the wrapper to not take effect. When clip wrapper is detected here, render the
        // wrapper instead; each wrapper is rendered only once to avoid duplicate drawing.
        const renderContainer = isClipMaskWrapper(container.parent) ? container.parent : container
        if (isClipMaskWrapper(renderContainer)) {
            if (renderedClipWrappers.has(renderContainer)) continue
            renderedClipWrappers.add(renderContainer)
        }

        renderContainer.render(renderer)
        directlyRendered.add(renderContainer)
        if (renderContainer !== container) directlyRendered.add(container)

        // Mark all ancestor union containers (up to entityContainer)
        // These containers themselves should not be rendered as a whole, but inspected recursively during fallback
        let parent = renderContainer.parent
        while (parent && parent !== entityContainer) {
            handledAncestors.add(parent)
            parent = parent.parent
        }
    }

    // Render children not in renderChain (overlays, selection boxes, objects dynamically added to union but not in renderChain, etc.)
    const renderRemainingChildren = (parent: PIXI.Container): void => {
        for (const child of parent.children) {
            if (directlyRendered.has(child as PIXI.Container)) {
                // Leaf container — already rendered in main loop (including all internal PIXI children), skip entirely
            } else if (handledAncestors.has(child as PIXI.Container)) {
                // Union container shell — has no visual content itself, recursively inspect children for uncovered dynamic spawn objects
                // But if union itself is visible=false / renderable=false, its entire subtree should not render
                if (!child.visible || !(child as PIXI.Container).renderable) continue
                if ((child as PIXI.Container).children?.length > 0) {
                    renderRemainingChildren(child as PIXI.Container)
                }
            } else if (child.visible) {
                child.render(renderer)
            }
        }
    }
    renderRemainingChildren(entityContainer)
}

/**
 * Install custom render logic for entity composite (Static Map mode)
 *
 * Overrides render() method on entity container so that it renders in renderChain order
 * rather than default children traversal.
 *
 * @param entityContainer PIXI container of entity composite
 * @param renderChain Ordered ID list
 * @param containerMap Mapping of objectId -> PIXI.Container (static snapshot)
 */
export function installRenderChainRenderer(
    entityContainer: PIXI.Container,
    renderChain: readonly string[],
    containerMap: ReadonlyMap<string, PIXI.Container>,
): void {
    if (renderChain.length === 0) return

    // Override render method
    entityContainer.render = function customRender(renderer: PIXI.Renderer): void {
        if (!this.visible || this.worldAlpha <= 0 || !this.renderable) return

        // Ensure worldTransform is updated
        // Standard PIXI flow: renderer.render(stage) -> stage.updateTransform() -> recursively updates all children
        // At this point worldTransform of all children (including objects inside unions) is ready

        // Manually manage filter/mask pipeline while preserving renderChain order
        // Reference complete flow of PIXI Container.renderAdvanced():
        //   1. Filter disabled filters -> push enabled to FilterSystem
        //   2. push mask
        //   3. Render content
        //   4. batch.flush() — Critical! Submits pending draw calls to current render target
        //   5. pop mask -> pop filter
        // Missing batch.flush() causes GL_INVALID_OPERATION: Insufficient buffer size
        const filters = this.filters
        const mask = this._mask
        const needsAdvanced = (filters && filters.length > 0) ?? !!mask

        // Collect enabled filters (PIXI internally uses _enabledFilters; we use local variable to avoid pollution)
        let enabledFilters: PIXI.Filter[] | null = null
        if (filters && filters.length > 0) {
            enabledFilters = filters.filter(f => f.enabled)
            if (enabledFilters.length > 0) {
                renderer.filter.push(this, enabledFilters)
            } else {
                enabledFilters = null
            }
        }
        if (mask) {
            renderer.mask.push(this, mask)
        }

        // Render child objects in renderChain order (regardless of filter/mask existence)
        renderByRenderChain(this, renderChain, containerMap, renderer)

        // Critical: Flush batch before pop, ensuring all draw calls are committed to current render target
        if (needsAdvanced) {
            renderer.batch.flush()
        }
        if (mask) {
            renderer.mask.pop(this)
        }
        if (enabledFilters) {
            renderer.filter.pop()
        }
    }

    // Mark custom renderer as installed (for debugging and testing)
    ;(entityContainer as PIXI.Container & { _hasRenderChainOverride?: boolean })._hasRenderChainOverride = true
}

/**
 * Install renderChain-driven render logic for root-level containers (stage/contentViewport) (Resolver mode)
 *
 * Unlike installRenderChainRenderer, this mode dynamically retrieves renderChain and container mapping via callback functions,
 * ensuring latest data is used on every render (root-level stage object list and zIndex change dynamically).
 *
 * Applicable scenarios: Editor targetLayer/activeLayer, ScenePlayer stage, FrameCapture contentViewport
 *
 * @param stageContainer Root-level PIXI container
 * @param chainResolver Called on each render, returns current ordered renderChain ID list
 * @param containerResolver Called on each render, returns corresponding PIXI container by objectId
 */
export function installRootRenderChainRenderer(
    stageContainer: PIXI.Container,
    chainResolver: () => readonly string[],
    containerResolver: (id: string) => PIXI.Container | undefined,
): void {
    const rootContainer = stageContainer as RootRenderChainOverrideContainer
    rootContainer._originalRootRender ??= stageContainer.render.bind(stageContainer)
    const originalRender = rootContainer._originalRootRender

    stageContainer.render = function rootCustomRender(renderer: PIXI.Renderer): void {
        if (!this.visible || this.worldAlpha <= 0 || !this.renderable) return

        // Dynamically get latest renderChain and container mapping on each render
        const renderChain = chainResolver()
        if (renderChain.length === 0) {
            // Fall back to standard rendering when renderChain is empty
            originalRender(renderer)
            return
        }

        // Manually manage filter/mask pipeline (consistent with entity-level renderAdvanced pattern)
        const filters = this.filters
        const mask = this._mask
        const needsAdvanced = (filters && filters.length > 0) ?? !!mask

        let enabledFilters: PIXI.Filter[] | null = null
        if (filters && filters.length > 0) {
            enabledFilters = filters.filter(f => f.enabled)
            if (enabledFilters.length > 0) {
                renderer.filter.push(this, enabledFilters)
            } else {
                enabledFilters = null
            }
        }
        if (mask) {
            renderer.mask.push(this, mask)
        }

        // Build temporary Map (contains only containers needed by current renderChain)
        const containerMap = new Map<string, PIXI.Container>()
        for (const id of renderChain) {
            const c = containerResolver(id)
            if (c) containerMap.set(id, c)
        }

        renderByRenderChain(this, renderChain, containerMap, renderer)

        if (needsAdvanced) {
            renderer.batch.flush()
        }
        if (mask) {
            renderer.mask.pop(this)
        }
        if (enabledFilters) {
            renderer.filter.pop()
        }
    }

    rootContainer._hasRootRenderChainOverride = true
}

export function uninstallRootRenderChainRenderer(stageContainer: PIXI.Container): void {
    const rootContainer = stageContainer as RootRenderChainOverrideContainer
    if (!rootContainer._originalRootRender) return

    stageContainer.render = rootContainer._originalRootRender
    delete rootContainer._hasRootRenderChainOverride
}

/**
 * Update renderChain and containerMap for installed custom render logic
 *
 * When renderChain or containerMap changes (e.g. object added/deleted/reordered),
 * render logic needs to be re-installed.
 *
 * @param entityContainer PIXI container of entity composite
 * @param renderChain New ordered ID list
 * @param containerMap New objectId -> PIXI.Container mapping
 */
export function updateRenderChainRenderer(
    entityContainer: PIXI.Container,
    renderChain: readonly string[],
    containerMap: ReadonlyMap<string, PIXI.Container>,
): void {
    // Re-install directly (overwrites previous override)
    installRenderChainRenderer(entityContainer, renderChain, containerMap)
}

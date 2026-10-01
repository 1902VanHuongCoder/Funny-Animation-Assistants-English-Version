import { defineStore } from 'pinia'

import type { AnchorPoint, Expression, ExpressionDisplayTransform, ExpressionFrame } from '@/types/project'
import { deleteAssetFromDisk } from '@/utils/fileSystem'

import { useProjectStore } from './projectStore'

interface ExpressionState {
  expressions: Record<string, Expression>
}

function stripLegacyPixelSize(expression: Expression): Expression {
  const { pixelSize: _legacyPixelSize, ...cleanExpression } = expression as Expression & {
    pixelSize?: { width: number; height: number }
  }
  return cleanExpression
}

function stripLegacyPixelSizes(expressions: Record<string, Expression>): Record<string, Expression> {
  return Object.fromEntries(
    Object.entries(expressions).map(([id, expression]) => [id, stripLegacyPixelSize(expression)])
  )
}

/**
 * Expression Management Store
 * Manages all expression assets, supporting multi-frame expression animation system
 */
export const useExpressionStore = defineStore('expression', {
  state: (): ExpressionState => ({
    expressions: {}
  }),

  getters: {
    /**
     * Get all expression list (sorted in descending order by creation time)
     */
    expressionList(): Expression[] {
      return Object.values(this.expressions).sort((a, b) => {
        const timeA = a.createdAt || 0
        const timeB = b.createdAt || 0
        return timeB - timeA // Descending order
      })
    },

    /**
     * Get single expression
     */
    getExpression: (state) => (id: string): Expression | undefined => {
      return state.expressions[id]
    },

    /**
     * Filter expressions by tag
     */
    getExpressionsByTag: (state) => (tag: string): Expression[] => {
      if (!tag || tag === 'All' || tag === 'All') {
        return Object.values(state.expressions).sort((a, b) => {
          const timeA = a.createdAt ?? 0
          const timeB = b.createdAt ?? 0
          return timeB - timeA
        })
      }
      return Object.values(state.expressions)
        .filter(expr => expr.tags?.includes(tag))
        .sort((a, b) => {
          const timeA = a.createdAt ?? 0
          const timeB = b.createdAt ?? 0
          return timeB - timeA
        })
    },

    /**
     * Search expressions by name
     */
    searchExpressions: (state) => (keyword: string): Expression[] => {
      if (!keyword) {
        return Object.values(state.expressions).sort((a, b) => {
          const timeA = a.createdAt ?? 0
          const timeB = b.createdAt ?? 0
          return timeB - timeA
        })
      }
      const lowerKeyword = keyword.toLowerCase()
      return Object.values(state.expressions)
        .filter(expr => expr.name.toLowerCase().includes(lowerKeyword))
        .sort((a, b) => {
          const timeA = a.createdAt ?? 0
          const timeB = b.createdAt ?? 0
          return timeB - timeA
        })
    }
  },

  actions: {
    /**
     * Generate UUID
     */
    generateId(): string {
      return `expr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    },

    /**
     * Create expression
     */
    createExpression(
      name: string,
      defaultFrame: ExpressionFrame,
      options?: {
        speakingFrames?: ExpressionFrame[]
        tags?: string[]
        anchor?: AnchorPoint
        speakingFps?: number
        speakingLoop?: boolean
        flipHorizontal?: boolean
        lockEdit?: boolean
        defaultScale?: number
        // v6.5: Still frame origin identifier
        stillFrameSource?: 'frame' | 'custom'
        stillFrameIndex?: number
        gender?: 'male' | 'female' | 'other'
        blendMode?: 'normal' | 'multiply'
      }
    ): string {
      const id = this.generateId()

      // Ensure defaultFrame has id
      if (!defaultFrame.id) {
        defaultFrame.id = `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }

      // Ensure each frame in speakingFrames has id
      const speakingFrames = (options?.speakingFrames ?? []).map(frame => {
        if (!frame.id) {
          frame.id = `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }
        return frame
      })

      const expression: Expression = {
        id,
        name,
        tags: options?.tags ?? [],
        defaultFrame,
        speakingFrames,
        anchor: options?.anchor ?? { x: 0.5, y: 0.5 },
        speakingFps: options?.speakingFps ?? 12,
        speakingLoop: options?.speakingLoop ?? true,
        flipHorizontal: options?.flipHorizontal ?? false,
        lockEdit: options?.lockEdit ?? false,
        createdAt: Date.now()
      }

      if (options?.gender) expression.gender = options.gender
      if (options?.defaultScale !== undefined) expression.defaultScale = options.defaultScale
      if (options?.stillFrameSource) expression.stillFrameSource = options.stillFrameSource
      if (options?.stillFrameIndex !== undefined) expression.stillFrameIndex = options.stillFrameIndex
      if (options?.blendMode) expression.blendMode = options.blendMode

      this.expressions[id] = expression

      // Mark project as having unsaved changes
      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()

      return id
    },

    /**
     * Update expression
     */
    updateExpression(id: string, updates: Partial<Expression>): boolean {
      if (this.expressions[id]) {
        this.expressions[id] = stripLegacyPixelSize({
          ...this.expressions[id],
          ...updates
        })

        // Mark project as having unsaved changes
        const projectStore = useProjectStore()
        projectStore.markAsUnsaved()

        return true
      }
      console.warn(`[ExpressionStore] Expression not found: ${id}`)
      return false
    },

    /**
     * Update default frame (from path)
     */
    updateDefaultFrameFromPath(id: string, relativePath: string): boolean {
      if (!this.expressions[id]) {
        console.warn(`[ExpressionStore] Expression not found: ${id}`)
        return false
      }

      // Update frame (store path)
      this.expressions[id].defaultFrame = {
        id: this.expressions[id].defaultFrame.id || this.generateId(),
        url: relativePath
      }

      // Mark project as having unsaved changes
      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()

      return true
    },

    /**
     * Update default frame
     */
    updateDefaultFrame(id: string, frame: ExpressionFrame): boolean {
      if (this.expressions[id]) {
        // Release old Blob URL
        const oldFrame = this.expressions[id].defaultFrame
        if (oldFrame.url.startsWith('blob:')) {
          URL.revokeObjectURL(oldFrame.url)
        }

        if (!frame.id) {
          frame.id = this.generateId()
        }
        this.expressions[id].defaultFrame = frame

        // Mark project as having unsaved changes
        const projectStore = useProjectStore()
        projectStore.markAsUnsaved()

        return true
      }
      console.warn(`[ExpressionStore] Expression not found: ${id}`)
      return false
    },

    /**
     * Add speaking frame (from path)
     */
    addSpeakingFrameFromPath(id: string, relativePath: string, index?: number): boolean {
      if (!this.expressions[id]) {
        console.warn(`[ExpressionStore] Expression not found: ${id}`)
        return false
      }

      // Add frame (store path)
      const frame: ExpressionFrame = {
        id: this.generateId(),
        url: relativePath
      }
      if (index !== undefined && index >= 0 && index <= this.expressions[id].speakingFrames.length) {
        this.expressions[id].speakingFrames.splice(index, 0, frame)
      } else {
        this.expressions[id].speakingFrames.push(frame)
      }

      // Mark project as having unsaved changes
      const projectStore = useProjectStore()
      projectStore.markAsUnsaved()

      return true
    },

    /**
     * Add speaking frame
     */
    addSpeakingFrame(id: string, frame: ExpressionFrame, index?: number): boolean {
      if (this.expressions[id]) {
        if (!frame.id) {
          frame.id = this.generateId()
        }

        if (index !== undefined && index >= 0 && index <= this.expressions[id].speakingFrames.length) {
          this.expressions[id].speakingFrames.splice(index, 0, frame)
        } else {
          this.expressions[id].speakingFrames.push(frame)
        }

        return true
      }
      console.warn(`[ExpressionStore] Expression not found: ${id}`)
      return false
    },

    /**
     * Delete speaking frame
     */
    removeSpeakingFrame(id: string, frameIndex: number): boolean {
      if (this.expressions[id]) {
        if (frameIndex >= 0 && frameIndex < this.expressions[id].speakingFrames.length) {
          const frame = this.expressions[id].speakingFrames[frameIndex]
          if (frame) {
            // Release Blob URL
            if (frame.url.startsWith('blob:')) {
              URL.revokeObjectURL(frame.url)
            }
          }

          this.expressions[id].speakingFrames.splice(frameIndex, 1)

          // Mark project as having unsaved changes
          const projectStore = useProjectStore()
          projectStore.markAsUnsaved()

          return true
        }
      }
      console.warn(`[ExpressionStore] Expression or frame not found: ${id}`)
      return false
    },

    /**
     * Update speaking frame
     */
    updateSpeakingFrame(id: string, frameIndex: number, frame: Partial<ExpressionFrame>): boolean {
      if (this.expressions[id] && frameIndex >= 0 && frameIndex < this.expressions[id].speakingFrames.length) {
        const oldFrame = this.expressions[id].speakingFrames[frameIndex]
        if (!oldFrame) return false

        // If URL was updated, release old Blob URL
        if (frame.url && frame.url !== oldFrame.url && oldFrame.url.startsWith('blob:')) {
          URL.revokeObjectURL(oldFrame.url)
        }

        this.expressions[id].speakingFrames[frameIndex] = {
          ...oldFrame,
          ...frame
        } as ExpressionFrame

        return true
      }
      console.warn(`[ExpressionStore] Expression or frame not found: ${id}`)
      return false
    },

    /**
     * Reorder speaking frames
     */
    reorderSpeakingFrames(id: string, fromIndex: number, toIndex: number): boolean {
      if (this.expressions[id]) {
        const frames = this.expressions[id].speakingFrames
        if (fromIndex >= 0 && fromIndex < frames.length &&
          toIndex >= 0 && toIndex < frames.length) {
          const [movedFrame] = frames.splice(fromIndex, 1)
          if (movedFrame) {
            frames.splice(toIndex, 0, movedFrame)
          }

          return true
        }
      }
      console.warn(`[ExpressionStore] Expression not found or invalid indices: ${id}`)
      return false
    },

    /**
     * Update anchor point
     */
    updateAnchor(id: string, anchor: AnchorPoint): boolean {
      if (this.expressions[id]) {
        this.expressions[id].anchor = anchor
        return true
      }
      console.warn(`[ExpressionStore] Expression not found: ${id}`)
      return false
    },

    /**
     * Update tags
     */
    updateTags(id: string, tags: string[]): boolean {
      if (this.expressions[id]) {
        this.expressions[id].tags = tags
        return true
      }
      console.warn(`[ExpressionStore] Expression not found: ${id}`)
      return false
    },

    /**
     * Delete expression
     */
    async deleteExpression(id: string): Promise<boolean> {
      if (this.expressions[id]) {
        const expr = this.expressions[id]

        // If project is open, delete disk files
        const projectStore = useProjectStore()
        if (projectStore.assetsHandle) {
          try {
            // Delete default frame
            if (!expr.defaultFrame.url.startsWith('blob:') && !expr.defaultFrame.url.startsWith('data:')) {
              await deleteAssetFromDisk(projectStore.assetsHandle, expr.defaultFrame.url)
            }

            // Delete all speaking frames
            for (const frame of expr.speakingFrames) {
              if (!frame.url.startsWith('blob:') && !frame.url.startsWith('data:')) {
                await deleteAssetFromDisk(projectStore.assetsHandle, frame.url)
              }
            }
          } catch (error) {
            console.warn('[ExpressionStore] Failed to delete expression file:', error)
          }
        }

        // Release default frame Blob URL
        if (expr.defaultFrame.url.startsWith('blob:')) {
          URL.revokeObjectURL(expr.defaultFrame.url)
        }

        // Release all speaking frames Blob URLs
        expr.speakingFrames.forEach(frame => {
          if (frame.url.startsWith('blob:')) {
            URL.revokeObjectURL(frame.url)
          }
        })

        delete this.expressions[id]
        return true
      }
      console.warn(`[ExpressionStore] Expression not found: ${id}`)
      return false
    },

    /**
     * Batch delete expressions
     */
    async deleteExpressions(ids: string[]): Promise<number> {
      let count = 0
      for (const id of ids) {
        if (await this.deleteExpression(id)) {
          count++
        }
      }
      return count
    },

    /**
     * Clear all expressions
     */
    clearAll() {
      // Release all Blob URLs
      Object.values(this.expressions).forEach(expr => {
        if (expr.defaultFrame.url.startsWith('blob:')) {
          URL.revokeObjectURL(expr.defaultFrame.url)
        }
        expr.speakingFrames.forEach(frame => {
          if (frame.url.startsWith('blob:')) {
            URL.revokeObjectURL(frame.url)
          }
        })
      })

      this.expressions = {}
    },

    /**
     * Set all expressions (used for loading project data)
     * @param expressionsData Expression data object
     */
    setExpressions(expressionsData: Record<string, Expression>): void {
      this.expressions = stripLegacyPixelSizes(expressionsData)
    },

    /**
     * Export expression config as JSON
     */
    exportToJSON(): string {
      const data = {
        version: '2.4',
        exportTime: new Date().toISOString(),
        expressions: this.expressions
      }
      return JSON.stringify(data, null, 2)
    },

    /**
     * Import expression config from JSON
     */
    importFromJSON(jsonString: string): boolean {
      try {
        const data = JSON.parse(jsonString) as { expressions?: Record<string, Expression> }
        if (data.expressions) {
          this.expressions = stripLegacyPixelSizes(data.expressions)
          return true
        }
        return false
      } catch (error) {
        console.error('[ExpressionStore] Failed to import JSON:', error)
        return false
      }
    },

    // ==========================================
    // Display Transform Encapsulation
    // ==========================================

    /**
     * Get effective scale ratio of expression
     * Always returns defaultScale (default is 1)
     * @param expressionId Expression ID
     */
    getEffectiveScale(expressionId: string): number {
      const expr = this.expressions[expressionId]
      if (!expr) return 1
      return expr.defaultScale ?? 1
    },

    /**
     * Get expression display transform parameters (unified encapsulation)
     * External callers only need to invoke this method without knowing internal property details
     * @param expressionId Expression ID
     * @param externalFlipX External flip requirement (e.g. part instance flipX), XORed with expression flip
     * @returns { scale: number, flipX: boolean }
     */
    getDisplayTransform(expressionId: string, externalFlipX = false): ExpressionDisplayTransform {
      const expr = this.expressions[expressionId]
      if (!expr) {
        return { scale: 1, flipX: externalFlipX }
      }

      const effectiveScale = this.getEffectiveScale(expressionId)
      const exprFlipX = expr.flipHorizontal ?? false

      // XOR: Flip is only required when the two flip states differ
      const shouldFlipX = externalFlipX !== exprFlipX

      return {
        scale: effectiveScale,
        flipX: shouldFlipX
      }
    },

    /**
     * Get CSS Transform style of expression (for normal HTML elements)
     * Encapsulates processing details of flipHorizontal and defaultScale
     * @param expressionId Expression ID
     * @param externalFlipX External flip requirement (optional)
     * @returns CSS transform string
     */
    getCssDisplayStyle(expressionId: string, externalFlipX = false): { transform: string } {
      const { scale, flipX } = this.getDisplayTransform(expressionId, externalFlipX)

      const transforms: string[] = []

      // Flip handling
      if (flipX) {
        transforms.push('scaleX(-1)')
      }

      // Scale handling (only added when scale !== 1)
      if (scale !== 1) {
        transforms.push(`scale(${scale})`)
      }

      return {
        transform: transforms.length > 0 ? transforms.join(' ') : 'none'
      }
    },

    /**
     * Get display coordinates of expression anchor (considering flip)
     * Used to correctly display anchor position in standard controls (such as ExpressionPreview)
     * @param expressionId Expression ID
     * @param externalFlipX External flip
     * @returns Anchor coordinates for display (mirror handled)
     */
    getDisplayAnchor(expressionId: string, externalFlipX = false): AnchorPoint {
      const expr = this.expressions[expressionId]
      if (!expr) {
        return { x: 0.5, y: 0.5 }
      }

      const anchor = expr.anchor
      const { flipX } = this.getDisplayTransform(expressionId, externalFlipX)

      // If flip needed, mirror X coordinate
      return {
        x: flipX ? (1 - anchor.x) : anchor.x,
        y: anchor.y
      }
    },

    /**
     * Calculate scale value applied to PixiJS Sprite
     * Encapsulates processing details of flipHorizontal and defaultScale
     * @param expressionId Expression ID
     * @param baseScale Base scale passed externally (such as part instance scale)
     * @param externalFlipX External flip requirement (e.g. part instance flipX), XORed with expression flip
     * @returns Final scale { x, y }
     */
    calculatePixiScale(
      expressionId: string,
      baseScale: { x: number; y: number } = { x: 1, y: 1 },
      externalFlipX = false
    ): { x: number; y: number } {
      const { scale: effectiveScale, flipX } = this.getDisplayTransform(expressionId, externalFlipX)

      // Calculate final scale
      const finalScaleX = Math.abs(baseScale.x) * effectiveScale * (flipX ? -1 : 1)
      const finalScaleY = Math.abs(baseScale.y) * effectiveScale

      return { x: finalScaleX, y: finalScaleY }
    },

  }
})

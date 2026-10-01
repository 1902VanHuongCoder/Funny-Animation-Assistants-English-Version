/**
 * Scene template Store
 * v16: Manage scene template CRUD and search
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { SceneTemplate } from '@/types/sceneTemplate'

import { useProjectStore } from './projectStore'

export const useSceneTemplateStore = defineStore('sceneTemplate', () => {
    const templates = ref<SceneTemplate[]>([])

    /**
     * Generate unique ID
     */
    function generateId(): string {
        return `stpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    /**
     * Get all used tags
     */
    const allTags = computed(() => {
        const tags = new Set<string>()
        templates.value.forEach(t => t.tags?.forEach(tag => tags.add(tag)))
        return Array.from(tags).sort()
    })

    /**
     * Add template
     */
    function addTemplate(template: SceneTemplate): void {
        templates.value.push(template)
        const projectStore = useProjectStore()
        projectStore.markAsUnsaved()
    }

    /**
     * Get template
     */
    function getTemplate(id: string): SceneTemplate | undefined {
        return templates.value.find(t => t.id === id)
    }

    /**
     * Update template
     */
    function updateTemplate(id: string, updates: Partial<SceneTemplate>): boolean {
        const template = getTemplate(id)
        if (template) {
            Object.assign(template, updates, { updatedAt: Date.now() })
            const projectStore = useProjectStore()
            projectStore.markAsUnsaved()
            return true
        }
        return false
    }

    /**
     * Delete template
     */
    function deleteTemplate(id: string): boolean {
        const index = templates.value.findIndex(t => t.id === id)
        if (index !== -1) {
            const template = templates.value[index]
            // Release runtime thumbnail Blob URL
            if (template?._runtimeThumbnailUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(template._runtimeThumbnailUrl)
            }
            templates.value.splice(index, 1)
            const projectStore = useProjectStore()
            projectStore.markAsUnsaved()
            return true
        }
        return false
    }

    /**
     * Filter by tag
     */
    function getTemplatesByTag(tag: string): SceneTemplate[] {
        return templates.value.filter(t => t.tags?.includes(tag))
    }

    /**
     * Search templates (fuzzy matching by name)
     */
    function searchTemplates(query: string): SceneTemplate[] {
        const q = query.toLowerCase()
        return templates.value.filter(t => t.name.toLowerCase().includes(q))
    }

    /**
     * Set template list (used for loading project)
     */
    function setTemplates(list: SceneTemplate[]): void {
        templates.value = list
    }

    /**
     * Clear all templates
     */
    function clearAll(): void {
        templates.value.forEach(t => {
            if (t._runtimeThumbnailUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(t._runtimeThumbnailUrl)
            }
        })
        templates.value = []
    }

    return {
        templates,
        allTags,
        generateId,
        addTemplate,
        getTemplate,
        updateTemplate,
        deleteTemplate,
        getTemplatesByTag,
        searchTemplates,
        setTemplates,
        clearAll,
    }
})

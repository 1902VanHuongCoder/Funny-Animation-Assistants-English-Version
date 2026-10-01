/**
 * Composite Character Store
 * Implemented based on sceneTemplateStore, additionally supports gender filtering
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { CompositeCharacter } from '@/types/compositeCharacter'
import type { Gender } from '@/types/project'

import { useProjectStore } from './projectStore'

export const useCompositeCharacterStore = defineStore('compositeCharacter', () => {
    const characters = ref<CompositeCharacter[]>([])

    /**
     * Generate unique ID
     */
    function generateId(): string {
        return `cchar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    /**
     * Get all used tags
     */
    const allTags = computed(() => {
        const tags = new Set<string>()
        characters.value.forEach(c => c.tags?.forEach(tag => tags.add(tag)))
        return Array.from(tags).sort()
    })

    /**
     * Add character
     */
    function addCharacter(character: CompositeCharacter): void {
        characters.value.push(character)
        const projectStore = useProjectStore()
        projectStore.markAsUnsaved()
    }

    /**
     * Get single character
     */
    function getCharacter(id: string): CompositeCharacter | undefined {
        return characters.value.find(c => c.id === id)
    }

    /**
     * Update character
     */
    function updateCharacter(id: string, updates: Partial<CompositeCharacter>): boolean {
        const character = getCharacter(id)
        if (character) {
            Object.assign(character, updates, { updatedAt: Date.now() })
            const projectStore = useProjectStore()
            projectStore.markAsUnsaved()
            return true
        }
        return false
    }

    /**
     * Delete character
     */
    function deleteCharacter(id: string): boolean {
        const index = characters.value.findIndex(c => c.id === id)
        if (index !== -1) {
            const character = characters.value[index]
            // Release runtime thumbnail Blob URL
            if (character?._runtimeThumbnailUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(character._runtimeThumbnailUrl)
            }
            characters.value.splice(index, 1)
            const projectStore = useProjectStore()
            projectStore.markAsUnsaved()
            return true
        }
        return false
    }

    /**
     * Filter by gender
     */
    function getCharactersByGender(gender: Gender | 'all'): CompositeCharacter[] {
        if (gender === 'all') return characters.value
        return characters.value.filter(c => c.gender === gender)
    }

    /**
     * Filter by tag
     */
    function getCharactersByTag(tag: string): CompositeCharacter[] {
        return characters.value.filter(c => c.tags?.includes(tag))
    }

    /**
     * Search characters (fuzzy matching by name)
     */
    function searchCharacters(query: string): CompositeCharacter[] {
        const q = query.toLowerCase()
        return characters.value.filter(c => c.name.toLowerCase().includes(q))
    }

    /**
     * Set characters list (used for loading project)
     */
    function setCharacters(list: CompositeCharacter[]): void {
        characters.value = list
    }

    /**
     * Clear all characters
     */
    function clearAll(): void {
        characters.value.forEach(c => {
            if (c._runtimeThumbnailUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(c._runtimeThumbnailUrl)
            }
        })
        characters.value = []
    }

    return {
        characters,
        allTags,
        generateId,
        addCharacter,
        getCharacter,
        updateCharacter,
        deleteCharacter,
        getCharactersByGender,
        getCharactersByTag,
        searchCharacters,
        setCharacters,
        clearAll,
    }
})

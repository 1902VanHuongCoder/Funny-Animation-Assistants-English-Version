/**
 * Project Store
 * Manages project lifecycle: create, open, save, close
 * Uses File System Access API to manage folder structure
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { type PresetAnimationTemplate,validatePresetTemplate } from '@/types/presetAnimation'
import type { Background, Expression, ExpressionFrame, ProjectData, ProjectMeta, PropAsset, SoundAsset } from '@/types/project'
import type { SceneTemplate } from '@/types/sceneTemplate'
import type { ActorConfig, NarratorConfig, SceneContainer } from '@/types/screenplay'
import {
  fileExists,
  loadAssetFromDisk,
  saveFileToDisk,
  writeFileAsText
} from '@/utils/fileSystem'
import { reconcileSetupHierarchy, warnHierarchyIssues } from '@/utils/hierarchyUtils'
import type { TTSTimingFile } from '@/utils/ttsTiming'
import { ensureTTSTimingFile, getTTSTimingPath, loadTTSTimingFile, saveTTSTimingFile } from '@/utils/ttsTiming'

import { useAnimationStore } from './animationStore'
import { useBackgroundStore } from './backgroundStore'
import { useCompositeCharacterStore } from './compositeCharacterStore'
import type { Episode } from './episodeStore'
import { useEpisodeStore } from './episodeStore'
import { useExpressionStore } from './expressionStore'
import { usePropStore } from './propStore'
import { useSceneStore } from './sceneStore'
import { useSceneTemplateStore } from './sceneTemplateStore'
import { useSoundStore } from './soundStore'
// v7.3: useEffectStore removed, effects merged into props

interface WindowWithFSA extends Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}

// Helper to convert Base64 to File
function dataURLtoFile(dataurl: string, filename: string): File {
  const arr = dataurl.split(',')
  const mimeMatch = arr[0]?.match(/:(.*?);/)
  const mime = mimeMatch?.[1] ?? 'image/png'
  const base64Data = arr[1] ?? ''
  const bstr = atob(base64Data)
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new File([u8arr], filename, { type: mime })
}

function reconcileEpisodesHierarchy(episodes: Episode[], scope: string, warn = true): boolean {
  const warnings: string[] = []
  let changed = false
  for (const episode of episodes) {
    for (const scene of episode.scenes ?? []) {
      const result = reconcileSetupHierarchy(scene.setup)
      changed ||= result.changed
      warnings.push(...result.warnings.map(w => `${episode.id}/${scene.id}: ${w}`))
    }
  }
  if (warn) {
    warnHierarchyIssues(scope, warnings)
  }
  return changed
}

/**
 * Recursively removes runtime properties starting with _ from objects
 * Simultaneously filters out blob: URLs
 * @param obj Object to clean
 * @returns Cleaned new object (original object not modified)
 */
function stripRuntimeProps<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const array = obj as unknown[]
    const mapped = array.map(item => stripRuntimeProps(item))
    return mapped as unknown as T
  }

  // Handle plain objects
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      // Skip runtime properties starting with _
      if (key.startsWith('_')) {
        continue
      }
      const value = (obj as Record<string, unknown>)[key]
      // If it is a url field starting with blob:, clear it
      if (key === 'url' && typeof value === 'string' && value.startsWith('blob:')) {
        result[key] = ''
        continue
      }
      // Recursively process nested objects/arrays
      result[key] = stripRuntimeProps(value)
    }
    return result as T
  }

  // Return primitive types directly
  return obj
}





export const useProjectStore = defineStore('project', () => {
  const projectHandle = ref<FileSystemDirectoryHandle | null>(null)
  const assetsHandle = ref<FileSystemDirectoryHandle | null>(null)
  const projectName = ref<string>('Untitled Project')
  const projectMeta = ref<ProjectMeta>({
    name: 'Untitled Project',
    resolution: { w: 1920, h: 1080 },
    fps: 25,
    version: '2.0.0'
  })
  const isProjectOpen = ref<boolean>(false)
  const autoSaveEnabled = ref<boolean>(true)
  const hasUnsavedChanges = ref<boolean>(false)
  const currentProjectFileName = ref<string>('project.anime') // Current project file name

  const actors = ref<ActorConfig[]>([])
  const narrator = ref<NarratorConfig>({ voice: {} })

  // v20: User-defined prefab action templates (project level)
  const customPresetAnimations = ref<PresetAnimationTemplate[]>([])

  const expressionStore = useExpressionStore()
  const backgroundStore = useBackgroundStore()
  // const propStore = usePropStore() // Removed top-level call to avoid circular dependency
  const episodeStore = useEpisodeStore()
  const sceneStore = useSceneStore()

  /**
   * Mark project as having unsaved changes
   */
  function markAsUnsaved(): void {
    if (isProjectOpen.value) {
      hasUnsavedChanges.value = true
    }
  }

  /**
   * Select project directory (must be called in user gesture)
   * @returns Directory handle
   */
  async function selectProjectDirectory(): Promise<FileSystemDirectoryHandle> {
    // Check File System Access API support
    if (!('showDirectoryPicker' in window)) {
      throw new Error('File System Access API is not supported. Please use Chrome or Edge browser.')
    }

    // Prompt user to select project directory (must be called directly in user gesture)
    const handle = await (window as unknown as WindowWithFSA).showDirectoryPicker({
      mode: 'readwrite'
    })

    return handle
  }

  /**
   * Check for unsaved changes, prompting user to save if any exist
   * @returns true if user chooses to proceed (saved or discarded), false if cancelled
   */
  async function checkUnsavedChanges(): Promise<boolean> {
    if (!hasUnsavedChanges.value || !isProjectOpen.value) {
      return true // No unsaved changes, can proceed
    }

    // Use confirm dialog for options
    // Step 1: Ask whether to save
    const wantToSave = confirm(
      'The current project has unsaved changes.\n\n' +
      'Click "OK" to save the project and continue\n' +
      'Click "Cancel" to discard changes and continue'
    )

    if (wantToSave) {
      // User chooses to save
      try {
        await saveProject()
        return true
      } catch (error) {
        console.error('[ProjectStore] Save failed:', error)
        // Ask whether to continue when save fails
        const continueAnyway = confirm('Save failed!\n\nClick "OK" to discard changes and continue\nClick "Cancel" to return to editing')
        return continueAnyway
      }
    } else {
      // User chooses not to save, proceed directly
      return true
    }
  }

  /**
   * Scan all .anime project files under directory
   * @param handle Directory handle
   * @returns File info list
   */
  async function scanAnimeFiles(handle: FileSystemDirectoryHandle): Promise<{ name: string; lastModified: Date }[]> {
    const files: { name: string; lastModified: Date }[] = []

    try {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.anime')) {
          const fileHandle = await handle.getFileHandle(entry.name)
          const file = await fileHandle.getFile()
          files.push({
            name: entry.name,
            lastModified: new Date(file.lastModified)
          })
        }
      }
    } catch (error) {
      console.error('[scanAnimeFiles] Scan failed:', error)
    }

    // Sort in descending order by modified time (newest first)
    files.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())

    return files
  }

  /**
   * Generate unique project file name
   * @param existingFiles List of existing file names (including .anime extension)
   * @returns Unique file name (without extension)
   */
  function generateUniqueFileName(existingFiles: string[]): string {
    // Extract file name (strip .anime extension) and convert to lowercase for comparison
    const existingNamesLower = existingFiles.map(f => f.replace(/\.anime$/, '').toLowerCase())

    // If "Untitled" does not exist, return directly
    if (!existingNamesLower.includes('untitled')) {
      return 'Untitled'
    }

    // Otherwise try Untitled01, Untitled02, ...
    for (let i = 1; i <= 999; i++) {
      const name = `Untitled${i.toString().padStart(2, '0')}`
      if (!existingNamesLower.includes(name.toLowerCase())) {
        return name
      }
    }

    // Edge case: Generate random name
    return `Untitled_${Date.now()}`
  }

  /**
   * Create new project
   * @param name Project name
   * @param fileName Project file name (without .anime extension)
   * @param handle Project directory handle (optional; if not provided, selected in method)
   */
  async function newProject(name: string, fileName = 'project', handle?: FileSystemDirectoryHandle): Promise<void> {
    // Check for unsaved changes
    if (!await checkUnsavedChanges()) {
      throw new Error('Operation cancelled by user')
    }

    try {
      let directoryHandle = handle

      // If handle not provided, select directory (note: must be called in user gesture)
      directoryHandle ??= await selectProjectDirectory()

      const fullFileName = `${fileName}.anime`

      // Check whether file with same name exists under directory
      try {
        await directoryHandle.getFileHandle(fullFileName)
        // If file exists, throw error
        throw new Error(`The selected directory already contains a project file (${fullFileName}). Cannot create project with identical name. Please choose a different file name.`)
      } catch (error: unknown) {
        const err = error as { name?: string; message?: string }
        // If error is NotFoundError, file does not exist, can proceed
        if (err.name === 'NotFoundError') {
          // File does not exist, can proceed to create project
        } else if (err.message?.includes('already contains a project file')) {
          // This is our thrown error, rethrow directly
          throw error
        } else {
          // Other error, rethrow as well
          throw error
        }
      }

      // Set project handle
      projectHandle.value = directoryHandle
      // No longer create subdirectories, allowing user to organize folder structure freely
      assetsHandle.value = null

      // Initialize project metadata
      projectName.value = name
      projectMeta.value = {
        name,
        resolution: { w: 1920, h: 1080 },
        fps: 25,
        version: '2.0.0'
      }

      // Clear all Stores
      const propStore = usePropStore()
      // v7.3: effectStore removed, effects merged into props
      const soundStore = useSoundStore()
      expressionStore.clearAll()
      backgroundStore.clearAll()
      propStore.clearAll()
      // v7.3: effectStore.clearAll() removed
      soundStore.clearAll()
      episodeStore.clearAll()
      sceneStore.clearScene()
      useSceneTemplateStore().clearAll()
      useCompositeCharacterStore().clearAll()

      // Create initial project file (using custom file name)
      currentProjectFileName.value = fullFileName // Set current project file name
      await saveProject(fullFileName)

      isProjectOpen.value = true
      hasUnsavedChanges.value = false // Newly created project is saved, no unsaved changes

    } catch (error: unknown) {
      const err = error as { name?: string }
      if (err.name === 'AbortError') {
        return
      }
      console.error('[ProjectStore] Failed to create project:', error)
      throw error
    }
  }

  /**
   * Open project
   * Uses "open project folder" approach, similar to VS Code or Unity
   * User selects project folder, system checks .anime files in folder
   * @param selectedFileName File name to open (including .anime extension); UI prompt if not provided
   * @param directoryHandle Optional directory handle
   * @returns Returns file list and handle for UI selection if multiple files exist and none specified; otherwise undefined
   */
  async function openProject(selectedFileName?: string, directoryHandle?: FileSystemDirectoryHandle): Promise<{ files: { name: string; lastModified: Date }[]; handle: FileSystemDirectoryHandle } | undefined> {

    // Check unsaved changes only on first call (without directoryHandle)
    // If directoryHandle provided, call originated from file selector dialog, no check needed
    if (!directoryHandle) {
      if (!await checkUnsavedChanges()) {
        throw new Error('Operation cancelled by user')
      }
    }

    try {
      if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API is not supported. Please use Chrome or Edge browser.')
      }

      // Prompt user to select project folder (must be called directly in user gesture)
      let handle: FileSystemDirectoryHandle
      if (directoryHandle) {
        handle = directoryHandle
      } else {
        try {
          handle = await (window as unknown as WindowWithFSA).showDirectoryPicker({
            mode: 'readwrite'
          })
        } catch (error: unknown) {
          const err = error as { name?: string }
          if (err.name === 'AbortError') {
            // User cancelled selection, return directly without throwing error
            return undefined
          }
          throw error
        }
      }

      // Scan all .anime files
      const animeFiles = await scanAnimeFiles(handle)

      if (animeFiles.length === 0) {
        throw new Error('The selected folder is not a valid project (no .anime file found)\n\nPlease select a project folder containing a .anime file')
      }

      // If multiple files exist and none specified, return file list and directory handle for UI selection
      if (animeFiles.length > 1 && !selectedFileName) {
        return { files: animeFiles, handle }
      }

      // Determine file name to open
      const firstAnimeFile = animeFiles[0]
      if (!firstAnimeFile) {
        throw new Error('No valid .anime file found')
      }
      const fileNameToOpen = selectedFileName ?? firstAnimeFile.name

      // Check whether file exists
      let projectFileHandle: FileSystemFileHandle
      try {
        projectFileHandle = await handle.getFileHandle(fileNameToOpen)
      } catch {
        throw new Error(`Project file ${fileNameToOpen} does not exist`)
      }

      // Read project.anime file contents
      const projectFile = await projectFileHandle.getFile()
      const projectDataJson = await projectFile.text()

      // Set current project file name
      currentProjectFileName.value = fileNameToOpen

      // Set project handle (now having access permission for entire folder)
      projectHandle.value = handle
      // No longer check or create directories, directly use user existing folder structure
      assetsHandle.value = null

      // Parse project data
      const projectData = JSON.parse(projectDataJson) as ProjectData

      // ===== .anime format version validation (v1.0.0 standard) =====
      const CURRENT_FORMAT_VERSION = '2.0.0'
      const fileVersion = projectData.meta?.version ?? '0.0.0'

      // Version compatibility check
      const fileMajorParsed = fileVersion.split('.').map(Number)[0]
      const currentMajorParsed = CURRENT_FORMAT_VERSION.split('.').map(Number)[0]
      const fileMajor = fileMajorParsed ?? 0
      const currentMajor = currentMajorParsed ?? 1

      if (fileMajor > currentMajor) {
        // File version is higher than supported version, reject opening
        throw new Error(
          `Project file format version (${fileVersion}) is higher than the supported version (${CURRENT_FORMAT_VERSION}).\n` +
          `Please update Funny Animation Assistant and try again.`
        )
      }

      if (fileMajor < currentMajor) {
        // File version is lower than supported version, reject opening
        throw new Error(
          `Project file format version (${fileVersion}) is lower than the supported version (${CURRENT_FORMAT_VERSION}).\n` +
          `The current version of Funny Animation Assistant cannot open this project file.`
        )
      }



      // Update project metadata
      projectName.value = projectData.meta.name
      projectMeta.value = projectData.meta

      // Clear all Stores
      const propStore = usePropStore()
      expressionStore.clearAll()
      backgroundStore.clearAll()
      propStore.clearAll()
      episodeStore.clearAll()
      sceneStore.clearScene()
      const sceneTemplateStore = useSceneTemplateStore()
      sceneTemplateStore.clearAll()
      const compositeCharacterStore = useCompositeCharacterStore()
      compositeCharacterStore.clearAll()

      // Load background data into Store
      // Prefer loading full data from assets.backgrounds
      // Compatibility logic: if assets.backgrounds only contains summary info (legacy), attempt loading from root-level backgrounds
      let backgroundsLoaded = false
      if (projectData.assets?.backgrounds && projectData.assets.backgrounds.length > 0) {
        const firstBg = projectData.assets.backgrounds[0]
        // Check whether full fields (such as type) are present
        if (firstBg?.type) {
          backgroundStore.setBackgrounds(projectData.assets.backgrounds)
          backgroundsLoaded = true
        }
      }

      if (!backgroundsLoaded && projectData.backgrounds) {
        const backgroundsList = Object.values(projectData.backgrounds)
        backgroundStore.setBackgrounds(backgroundsList as Background[])
      }

      // Load expression data into Store
      if (projectData.expressions) {
        expressionStore.setExpressions(projectData.expressions)
      }

      // Load prop data into Store
      if (projectData.assets?.props) {
        propStore.setProps(projectData.assets.props)
      }

      // v7.3: Effects merged into props, no longer loaded separately

      // Load sound effect data into Store
      const soundStore = useSoundStore()
      if (projectData.assets?.sounds) {
        soundStore.setSounds(projectData.assets.sounds)
      }

      // v6.0: Load episode list data into Store (Screenplay merged)
      if (projectData.episodes && Array.isArray(projectData.episodes) && projectData.episodes.length > 0) {
        episodeStore.episodes = projectData.episodes.map((val) => {
          const ep = val as Episode
          const newEp: Episode = {
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            name: ep.name,
            scenes: ep.scenes ?? [],
            bgmTracks: ep.bgmTracks ?? [],
            duration: ep.duration ?? 0,
            createdAt: ep.createdAt,
            modifiedAt: ep.modifiedAt,
            version: ep.version ?? '6.0'
          }
          if (ep.thumbnail) newEp.thumbnail = ep.thumbnail
          return newEp
        })
      }

      // v6.0: Load project-level actor and narrator configuration
      if (projectData.actors && Array.isArray(projectData.actors)) {
        actors.value = projectData.actors
      }
      if (projectData.narrator) {
        narrator.value = projectData.narrator
      }

      // Legacy compatibility: if screenplays field exists, perform data migration
      const anyProjectData = projectData as unknown as { screenplays?: Record<string, { scenes: SceneContainer[] }> }
      if (anyProjectData.screenplays && Object.keys(anyProjectData.screenplays).length > 0) {
        Object.entries(anyProjectData.screenplays).forEach(([episodeId, screenplay]) => {
          const episode = episodeStore.episodes.find(ep => ep.id === episodeId)
          if (episode && screenplay.scenes) {
            episode.scenes = screenplay.scenes
          }
        })
      }
      const hierarchyChanged = reconcileEpisodesHierarchy(episodeStore.episodes, 'openProject')

      // v16: Load scene templates
      const sceneTemplatesData = (projectData as Record<string, unknown>)['sceneTemplates']
      if (Array.isArray(sceneTemplatesData) && sceneTemplatesData.length > 0) {
        sceneTemplateStore.setTemplates(sceneTemplatesData as SceneTemplate[])
      }

      // v16: Scene template thumbnail hydration (thumbnailPath -> BlobURL)
      for (const tpl of sceneTemplateStore.templates) {
        if (tpl.thumbnailPath && !tpl.thumbnailPath.startsWith('blob:') && !tpl.thumbnailPath.startsWith('data:')) {
          try {
            tpl._runtimeThumbnailUrl = await loadAssetFromDisk(handle, tpl.thumbnailPath)
          } catch {
            console.warn(`[ProjectStore] Failed to load scene template thumbnail: ${tpl.thumbnailPath}`)
          }
        }
      }

      // v18: Load composite characters
      const compositeCharsData = (projectData as Record<string, unknown>)['compositeCharacters']
      if (Array.isArray(compositeCharsData) && compositeCharsData.length > 0) {
        compositeCharacterStore.setCharacters(compositeCharsData as import('@/types/compositeCharacter').CompositeCharacter[])
      }

      // v18: Composite character thumbnail hydration (thumbnailPath -> BlobURL)
      for (const char of compositeCharacterStore.characters) {
        if (char.thumbnailPath && !char.thumbnailPath.startsWith('blob:') && !char.thumbnailPath.startsWith('data:')) {
          try {
            char._runtimeThumbnailUrl = await loadAssetFromDisk(handle, char.thumbnailPath)
          } catch {
            console.warn(`[ProjectStore] Failed to load composite character thumbnail: ${char.thumbnailPath}`)
          }
        }
      }

      // v20: Load custom prefab action templates
      const customPresetsData = (projectData as Record<string, unknown>)['customPresetAnimations']
      if (Array.isArray(customPresetsData) && customPresetsData.length > 0) {
        const validated: PresetAnimationTemplate[] = []
        for (const tpl of customPresetsData as PresetAnimationTemplate[]) {
          const errors = validatePresetTemplate(tpl)
          if (errors.length > 0) {
            console.warn(`[ProjectStore] Loading custom template "${tpl.id ?? 'unknown'}" validation failed: ${errors.join('; ')}`)
          }
          validated.push(tpl)
        }
        customPresetAnimations.value = validated
      } else {
        customPresetAnimations.value = []
      }

      // Load assets (create Blob URLs from paths)
      hydrateAssets(projectData)


      // v16: Populate resource-level animations into SceneObject.animations (backward-compatibility migration)
      populateObjectAnimationsOnLoad()

      isProjectOpen.value = true
      hasUnsavedChanges.value = hierarchyChanged
      return undefined
    } catch (error: unknown) {
      const err = error as { name?: string }
      if (err.name === 'AbortError') {
        return undefined
      }
      console.error('[ProjectStore] Failed to open project:', error)
      throw error
    }
  }

  /**
   * Load assets from disk and create Blob URLs
   * v12.8: Refactored to lazy-load mode - only dispatches data to Store without preloading binary assets
   * Assets loaded on-demand via useAssetImage/useAssetAudio when requested by UI components
   * @param projectData Project data
   */
  function hydrateAssets(_projectData: ProjectData): void {
    if (!projectHandle.value) {
      throw new Error('No project is open')
    }

    // Character data loading removed

    // 2-5: Expression, background, prop, sound data dispatched to Stores in openProject
    // No longer preloading binary assets; loaded on demand by components
  }




  /**
   * v16: Populate resource-level animations into SceneObject.animations
   * Executed on project load, traverses all objects across all scenes,
   * copying animations from resource-level store to object animations field.
   * Objects with existing animations will not be overwritten.
   */
  function populateObjectAnimationsOnLoad(): void {
    const animationStore = useAnimationStore()

    for (const episode of episodeStore.episodes) {
      for (const scene of episode.scenes ?? []) {
        for (const obj of scene.setup?.objects ?? []) {
          if (obj.animations && Object.keys(obj.animations).length > 0) {
            continue // Object-level animation exists, skip
          }
          populateObjectAnimationsForObject(obj, animationStore)
        }
      }
    }
  }

  /**
   * v16: Populate resource-level animations into single SceneObject.animations
   * Usable for batch migration on project load or single population upon placing new objects.
   */
  function populateObjectAnimationsForObject(
    obj: { type: string; refId: string; animations?: Record<string, unknown> },
    animationStore: ReturnType<typeof useAnimationStore>,
  ): void {
    if (obj.type === 'character' || obj.type === 'prop' || obj.type === 'background') {
      const resourceType = obj.type
      const resourceAnims = animationStore.getAnimations(resourceType, obj.refId)
      if (resourceAnims.length > 0) {
        const record: Record<string, unknown> = {}
        for (const anim of resourceAnims) {
          record[anim.id] = anim
        }
        obj.animations = record
      }
    }
  }

  // Concurrency guard flag for saving
  const isSaving = ref(false)

  /**
   * Save project
   * @param fileName Project file name (including .anime extension), default 'project.anime'
   */
  async function saveProject(fileName?: string): Promise<void> {
    // Skip if currently saving (avoids InvalidStateError from concurrent writes)
    if (isSaving.value) {

      return
    }

    // Use provided file name or current project file name
    const targetFileName = fileName ?? currentProjectFileName.value
    if (!projectHandle.value) {
      throw new Error('No project is open')
    }

    isSaving.value = true

    try {
      const propStore = usePropStore()
      // v7.3: effectStore removed, effects merged into props
      const soundStore = useSoundStore()
      // Collect data from all Stores
      const projectData: ProjectData = {
        meta: projectMeta.value,
        assets: {
          // Recursively strip runtime properties using stripRuntimeProps
          backgrounds: backgroundStore.backgrounds.map((bg: Background) => stripRuntimeProps(bg)),
          props: propStore.props.map(prop => stripRuntimeProps(prop)),
          sounds: soundStore.sounds.map(sound => stripRuntimeProps(sound)),
          musics: [], // Deprecated: kept for backwards compatibility
        },
        expressions: {}, // Save complete expression data
      }

      // Process thumbnail cache directory
      const cacheDirName = currentProjectFileName.value.replace(/\.anime$/, '') + '_cache'


      // Save complete background data (merged into assets.backgrounds, redundant write removed)
      // backgroundStore.backgrounds.forEach(bg => { ... })

      // Save complete expression data (ensuring URL is a path rather than Blob URL)
      const expressionStore = useExpressionStore()
      if (expressionStore.expressions) {
        Object.values(expressionStore.expressions).forEach(expr => {
          const exprCopy: Record<string, unknown> = {}

          // Copy all fields not starting with _
          Object.keys(expr).forEach(key => {
            if (!key.startsWith('_')) {
              if (key === 'defaultFrame') {
                // Process defaultFrame
                const frameCopy: Record<string, unknown> = {}
                Object.keys(expr.defaultFrame).forEach(frameKey => {
                  if (!frameKey.startsWith('_')) {
                    frameCopy[frameKey] = (expr.defaultFrame as unknown as Record<string, unknown>)[frameKey]
                  }
                })
                exprCopy['defaultFrame'] = frameCopy
              } else if (key === 'speakingFrames') {
                // Process speakingFrames
                exprCopy['speakingFrames'] = expr.speakingFrames.map(frame => {
                  const frameCopy: Record<string, unknown> = {}
                  Object.keys(frame).forEach(frameKey => {
                    if (!frameKey.startsWith('_')) {
                      frameCopy[frameKey] = (frame as unknown as Record<string, unknown>)[frameKey]
                    }
                  })
                  return frameCopy
                })
              } else {
                exprCopy[key] = (expr as unknown as Record<string, unknown>)[key]
              }
            }
          })

          // Ensure URL is a path
          if ((exprCopy['defaultFrame'] as ExpressionFrame)?.url?.startsWith('blob:')) {
            console.warn(`[ProjectStore] Expression ${expr.id} defaultFrame URL is Blob URL, cleared`)
              ; (exprCopy['defaultFrame'] as ExpressionFrame).url = ''
          }

          (exprCopy['speakingFrames'] as ExpressionFrame[])?.forEach((frame, index: number) => {
            if (frame.url?.startsWith('blob:')) {
              console.warn(`[ProjectStore] Expression ${expr.id} speakingFrame[${index}] URL is Blob URL, cleared`)
              frame.url = ''
            }
          })

          projectData.expressions![expr.id] = exprCopy as unknown as Expression
        })
      }

      reconcileEpisodesHierarchy(episodeStore.episodes, 'saveProject', false)

      // v6.0: Save episode list data (Screenplay merged, directly contains scenes)
      // v12.8: TTS audio uses external storage via audioPath, no longer needs blob URL conversion
      const processedEpisodes = episodeStore.episodes.map(ep => {
        const epCopy = { ...ep }

        if (epCopy.scenes) {
          epCopy.scenes = epCopy.scenes.map(scene => {
            const sceneCopy = { ...scene }

            // Prevent runtime properties in setup.objects from leaking into project file
            // (such as legacy SymbolMaterial _runtimeUrl and other fields starting with _)
            if (sceneCopy.setup?.objects) {
              sceneCopy.setup = {
                ...sceneCopy.setup,
                objects: sceneCopy.setup.objects.map(obj => stripRuntimeProps(obj)),
              }
            }

            if (sceneCopy.script) {
              sceneCopy.script = sceneCopy.script.map(block => {
                const blockCopy = { ...block }

                // v12.8: audioPath is already relative path, save directly
                // Removed legacy blob URL to Base64 conversion logic
                return blockCopy
              })
            }
            return sceneCopy
          })
        }

        return {
          id: epCopy.id,
          episodeNumber: epCopy.episodeNumber,
          name: epCopy.name,
          scenes: epCopy.scenes ?? [],
          bgmTracks: epCopy.bgmTracks ?? [], // Save BGM tracks (v7.5)
          duration: epCopy.duration,
          thumbnail: epCopy.thumbnail,
          createdAt: epCopy.createdAt,
          modifiedAt: epCopy.modifiedAt,
          version: epCopy.version ?? '6.0'
        }
      })

      projectData.episodes = processedEpisodes

      // v6.0: Save project-level actor and narrator configuration
      projectData.actors = actors.value
      projectData.narrator = narrator.value

      // v16: Save scene templates (including thumbnail persistence)
      const sceneTemplateStore = useSceneTemplateStore()
      if (sceneTemplateStore.templates.length > 0) {
        const processedTemplates: SceneTemplate[] = []
        for (const tpl of sceneTemplateStore.templates) {
          const tplCopy = stripRuntimeProps(tpl) as SceneTemplate

          // Thumbnail persistence: DataURL -> cache file
          if (tpl._runtimeThumbnailUrl?.startsWith('data:image')) {
            const extMatch = /data:image\/(.*?);/.exec(tpl._runtimeThumbnailUrl)
            const ext = extMatch?.[1] ?? 'jpg'
            const thumbFileName = `stpl_${tpl.id}.${ext === 'jpeg' ? 'jpg' : ext}`
            const relativePath = `${cacheDirName}/${thumbFileName}`
            const file = dataURLtoFile(tpl._runtimeThumbnailUrl, thumbFileName)
            await saveFileToDisk(projectHandle.value, relativePath, file)

            // Update reference in store
            tpl.thumbnailPath = relativePath
            tpl._runtimeThumbnailUrl = URL.createObjectURL(file)
            tplCopy.thumbnailPath = relativePath
          } else if (tpl.thumbnailPath) {
            tplCopy.thumbnailPath = tpl.thumbnailPath
          }

          processedTemplates.push(tplCopy)
        }
        projectData.sceneTemplates = processedTemplates
      }

      // v18: Save composite characters (including thumbnail persistence)
      const compositeCharacterStore = useCompositeCharacterStore()
      if (compositeCharacterStore.characters.length > 0) {
        const processedChars: import('@/types/compositeCharacter').CompositeCharacter[] = []
        for (const char of compositeCharacterStore.characters) {
          const charCopy = stripRuntimeProps(char) as import('@/types/compositeCharacter').CompositeCharacter

          // Thumbnail persistence: DataURL -> cache file
          if (char._runtimeThumbnailUrl?.startsWith('data:image')) {
            const extMatch = /data:image\/(.*?);/.exec(char._runtimeThumbnailUrl)
            const ext = extMatch?.[1] ?? 'jpg'
            const thumbFileName = `cchar_${char.id}.${ext === 'jpeg' ? 'jpg' : ext}`
            const relativePath = `${cacheDirName}/${thumbFileName}`
            const file = dataURLtoFile(char._runtimeThumbnailUrl, thumbFileName)
            await saveFileToDisk(projectHandle.value, relativePath, file)

            // Update reference in store
            char.thumbnailPath = relativePath
            char._runtimeThumbnailUrl = URL.createObjectURL(file)
            charCopy.thumbnailPath = relativePath
          } else if (char.thumbnailPath) {
            charCopy.thumbnailPath = char.thumbnailPath
          }

          processedChars.push(charCopy)
        }
        projectData.compositeCharacters = processedChars
      }

      // v20: Save custom prefab action templates
      if (customPresetAnimations.value.length > 0) {
        projectData.customPresetAnimations = customPresetAnimations.value
      }

      // Replace Blob URLs with relative paths
      // TODO: Implement path conversion logic
      // Needs to traverse all assets, replacing Blob URLs with relative paths
      // Write project file
      const jsonString = JSON.stringify(projectData, null, 2)
      await writeFileAsText(projectHandle.value, targetFileName, jsonString)

      hasUnsavedChanges.value = false
    } catch (error) {
      console.error('[ProjectStore] Failed to save project:', error)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Close project
   * @param skipCheck Whether to skip unsaved changes check (internal use)
   */
  async function closeProject(skipCheck = false): Promise<void> {
    // Check for unsaved changes
    if (!skipCheck && !await checkUnsavedChanges()) {
      throw new Error('Operation cancelled by user')
    }
    // Clean up all Blob URLs
    // TODO: Traverse all Stores to release Blob URLs

    projectHandle.value = null
    assetsHandle.value = null
    projectName.value = 'Untitled Project'
    currentProjectFileName.value = 'project.anime' // Reset to default
    projectMeta.value = {
      name: 'Untitled Project',
      resolution: { w: 1920, h: 1080 },
      fps: 25,
      version: '2.0.0'
    }
    isProjectOpen.value = false
    hasUnsavedChanges.value = false

    const propStore = usePropStore()
    expressionStore.clearAll()
    backgroundStore.clearAll()
    propStore.clearAll()
    episodeStore.clearAll()
    sceneStore.clearScene()
    useSceneTemplateStore().clearAll()
  }

  /**
   * v12.8: Save TTS audio to project cache directory
   * @param base64Audio Base64 encoded audio data
   * @param cacheKey Cache key (used to generate filename hash)
   * @returns Relative path, such as "{project}_cache/tts/{hash}.mp3"
   */
  async function saveTTSAudio(base64Audio: string, cacheKey: string): Promise<string> {
    if (!projectHandle.value) {
      throw new Error('No project is open')
    }

    // Generate file name hash
    const hash = await generateHash(cacheKey)
    const cacheDirName = currentProjectFileName.value.replace(/\.anime$/, '') + '_cache'
    const relativePath = `${cacheDirName}/tts/${hash}.mp3`

    // Base64 to File
    const byteCharacters = atob(base64Audio)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: 'audio/mp3' })
    const file = new File([blob], `${hash}.mp3`, { type: 'audio/mp3' })

    // Save to disk
    await saveFileToDisk(projectHandle.value, relativePath, file)

    return relativePath
  }

  /**
   * Generate string hash (for TTS cache filename)
   */
  async function generateHash(str: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Detect whether TTS audio file exists
   * @param audioPath Relative path of audio file
   * @returns Whether file exists
   */
  async function checkTTSAudioExists(audioPath: string): Promise<boolean> {
    if (!projectHandle.value) {
      return false
    }
    // Skip blob: and data: URLs (not valid file paths)
    if (audioPath.startsWith('blob:') || audioPath.startsWith('data:')) {
      return false
    }
    try {
      return await fileExists(projectHandle.value, audioPath)
    } catch {
      return false
    }
  }

  /**
   * v21: Save TTS audio pause/speech sidecar timing file
   * @returns Relative path, such as "{project}_cache/tts/{hash}.timing.json"
   */
  async function saveTTSTiming(audioPath: string, timing: TTSTimingFile): Promise<string> {
    if (!projectHandle.value) {
      throw new Error('No project is open')
    }

    return saveTTSTimingFile(projectHandle.value, audioPath, timing)
  }

  /**
   * v21: Load TTS timing sidecar file
   */
  async function loadTTSTiming(audioPath: string): Promise<TTSTimingFile | null> {
    if (!projectHandle.value) {
      return null
    }

    return loadTTSTimingFile(projectHandle.value, audioPath)
  }

  /**
   * v21: Detect whether TTS timing sidecar file exists
   */
  async function checkTTSTimingExists(audioPath: string): Promise<boolean> {
    if (!projectHandle.value) {
      return false
    }

    try {
      return await fileExists(projectHandle.value, getTTSTimingPath(audioPath))
    } catch {
      return false
    }
  }

  /**
   * v21: Ensure TTS timing sidecar is generated. Reuse if existing with matching parameters; otherwise reanalyze and write.
   */
  async function ensureTTSTiming(audioPath: string, audioBuffer: AudioBuffer): Promise<string> {
    if (!projectHandle.value) {
      throw new Error('No project is open')
    }

    return ensureTTSTimingFile(projectHandle.value, audioPath, audioBuffer)
  }

  /**
   * Auto save (save to file system and localStorage)
   */
  async function autoSave(): Promise<void> {
    // If project is open, save to file system
    if (isProjectOpen.value && projectHandle.value) {
      try {
        await saveProject()
      } catch (error) {
        console.error('[ProjectStore] File system save failed:', error)
        // If file system save fails, save to localStorage
        saveToLocalStorage()
      }
    } else {
      // Otherwise save to localStorage for subsequent restoration
      saveToLocalStorage()
    }
  }

  /**
   * Save to localStorage (fallback)
   */
  function saveToLocalStorage(): void {
    const propStore = usePropStore()
    // v7.3: effectStore removed, effects merged into props
    const soundStore = useSoundStore()
    const projectData: ProjectData = {
      meta: projectMeta.value,
      assets: {
        backgrounds: backgroundStore.backgrounds.map((bg: Background) => {
          // Create background copy, skipping runtime fields starting with _
          const bgCopy: Record<string, unknown> = {}
          Object.keys(bg).forEach(key => {
            if (!key.startsWith('_')) {
              if (key === 'frames') {
                bgCopy['frames'] = bg.frames?.map(frame => {
                  const frameCopy: Record<string, unknown> = {}
                  Object.keys(frame).forEach(frameKey => {
                    if (!frameKey.startsWith('_')) {
                      frameCopy[frameKey] = frame[frameKey]
                    }
                  })
                  // 2.2 Fix url check
                  if ((frameCopy['url'] as string)?.startsWith('blob:')) frameCopy['url'] = ''
                  return frameCopy
                })
              } else {
                bgCopy[key] = (bg as Record<string, unknown>)[key]
              }
            }
          })

          // 2.3 Cast properties for checking
          if ((bgCopy['url'] as string)?.startsWith('blob:')) {
            console.warn(`[ProjectStore] (AutoSave) Background ${bg.id} URL is still Blob URL: ${bgCopy['url'] as string}`)
          }
          if ((bgCopy['stillFrameCustomUrl'] as string)?.startsWith('blob:')) bgCopy['stillFrameCustomUrl'] = ''
          // Compatibility handling
          if ((bgCopy['backgroundImage'] as string)?.startsWith('blob:')) bgCopy['backgroundImage'] = undefined

          return bgCopy as Background
        }),
        props: propStore.props.map(prop => {
          // Deep copy and strip runtime fields
          const propCopy: Record<string, unknown> = {}
          Object.keys(prop).forEach(key => {
            if (!key.startsWith('_')) {
              if (key === 'frames') {
                propCopy['frames'] = prop.frames?.map(frame => {
                  const frameCopy: Record<string, unknown> = {}
                  Object.keys(frame).forEach(frameKey => {
                    if (!frameKey.startsWith('_')) {
                      frameCopy[frameKey] = frame[frameKey]
                    }
                  })
                  // Ensure URL is relative path
                  if ((frameCopy['url'] as string)?.startsWith('blob:')) frameCopy['url'] = ''
                  return frameCopy
                })
              } else {
                propCopy[key] = (prop as Record<string, unknown>)[key]
              }
            }
          })
          // Ensure URL is relative path
          if ((propCopy['url'] as string)?.startsWith('blob:')) {
            console.warn(`[ProjectStore] (AutoSave) Prop ${prop.id} URL is still Blob URL: ${propCopy['url'] as string}`)
          }
          if ((propCopy['stillFrameCustomUrl'] as string)?.startsWith('blob:')) propCopy['stillFrameCustomUrl'] = ''

          return propCopy as PropAsset
        }),
        // v7.3: Effects merged into props, no longer saved separately
        sounds: soundStore.sounds.map(sound => {
          const soundCopy: Record<string, unknown> = {}
          Object.keys(sound).forEach(key => {
            if (!key.startsWith('_')) {
              soundCopy[key] = (sound as Record<string, unknown>)[key]
            }
          })
          if ((soundCopy['url'] as string)?.startsWith('blob:')) {
            console.warn(`[ProjectStore] (AutoSave) Sound ${sound.id} URL is still Blob URL: ${soundCopy['url'] as string}`)
          }
          return soundCopy as SoundAsset
        }),
        musics: [], // Deprecated: kept for backwards compatibility
      },
      expressions: {},
    }

    // Save complete background data (merged into assets.backgrounds, redundant write removed)
    // backgroundStore.backgrounds.forEach(bg => { ... })

    // Save complete prop data
    // if (propStore.props) {
    //   propStore.props.forEach(prop => {
    //     if (!projectData.props) projectData.props = {}
    //     projectData.props[prop.id] = prop
    //   })
    // }

    // Save complete expression data
    const expressionStore = useExpressionStore()
    if (expressionStore.expressions) {
      Object.values(expressionStore.expressions).forEach(expr => {
        projectData.expressions![expr.id] = expr
      })
    }

    // Character data saving removed


    // Save episode list data to localStorage
    projectData.episodes = episodeStore.episodes.map(ep => ({ ...ep }))

    localStorage.setItem('animeStudio_autosave', JSON.stringify(projectData))
    localStorage.setItem('animeStudio_autosave_time', Date.now().toString())
  }

  /**
   * Check whether auto-save data exists
   */
  function hasAutoSave(): boolean {
    return localStorage.getItem('animeStudio_autosave') !== null
  }

  /**
   * Get timestamp of auto-save
   */
  function getAutoSaveTime(): Date | null {
    const timeStr = localStorage.getItem('animeStudio_autosave_time')
    if (timeStr) {
      return new Date(parseInt(timeStr))
    }
    return null
  }

  /**
   * Restore auto-saved data
   */
  function restoreFromAutoSave(): boolean {
    try {
      const dataStr = localStorage.getItem('animeStudio_autosave')
      if (!dataStr) return false

      const projectData = JSON.parse(dataStr) as ProjectData
      projectName.value = projectData.meta.name
      projectMeta.value = projectData.meta

      // TODO: Restore data for all Stores
      // Needs to convert Base64 to Blob URLs

      isProjectOpen.value = true
      return true
    } catch (error) {
      console.error('[ProjectStore] Failed to restore auto-save:', error)
      return false
    }
  }

  /**
   * Export to directory (deprecated, directly saved now)
   */
  async function exportToDirectory(): Promise<void> {
    // This method is now equivalent to saveProject
    await saveProject()
  }

  /**
   * Save to file (fallback for browsers without File System API support)
   */
  function saveToFile(): void {
    // Collect all data
    const projectData: ProjectData = {
      meta: projectMeta.value,
      assets: {
        backgrounds: backgroundStore.backgrounds.map((bg: Background) => {
          // Create background copy, skipping runtime fields starting with _
          const bgCopy: Record<string, unknown> = {}
          Object.keys(bg).forEach(key => {
            if (!key.startsWith('_')) {
              if (key === 'frames') {
                bgCopy['frames'] = bg.frames?.map(frame => {
                  const frameCopy: Record<string, unknown> = {}
                  Object.keys(frame).forEach(frameKey => {
                    if (!frameKey.startsWith('_')) {
                      frameCopy[frameKey] = frame[frameKey]
                    }
                  })
                  if ((frameCopy['url'] as string)?.startsWith('blob:')) frameCopy['url'] = ''
                  return frameCopy
                })
              } else {
                bgCopy[key] = (bg as Record<string, unknown>)[key]
              }
            }
          })

          if ((bgCopy['url'] as string)?.startsWith('blob:')) bgCopy['url'] = ''
          if ((bgCopy['stillFrameCustomUrl'] as string)?.startsWith('blob:')) bgCopy['stillFrameCustomUrl'] = ''
          // Compatibility handling
          if ((bgCopy['backgroundImage'] as string)?.startsWith('blob:')) bgCopy['backgroundImage'] = undefined

          return bgCopy as Background
        }),
        props: [],
        // v7.3: effects field removed
        sounds: [],
        musics: []
      },
    }

    // TODO: Convert Blob URLs to Base64 (for file download)

    // Create download link
    const jsonString = JSON.stringify(projectData, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.value ?? 'project'}.anime`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Load from file (fallback)
   */
  async function loadFromFile(file: File): Promise<boolean> {
    try {
      const text = await file.text()
      const projectData = JSON.parse(text) as ProjectData

      // ===== .anime format version validation =====
      const CURRENT_FORMAT_VERSION = '2.0.0'
      const fileVersion = projectData.meta?.version ?? '0.0.0'
      const fileMajorParsed = fileVersion.split('.').map(Number)[0]
      const currentMajorParsed = CURRENT_FORMAT_VERSION.split('.').map(Number)[0]
      const fileMajor = fileMajorParsed ?? 0
      const currentMajor = currentMajorParsed ?? 2

      if (fileMajor > currentMajor) {
        throw new Error(
          `Project file format version (${fileVersion}) is higher than the supported version (${CURRENT_FORMAT_VERSION}).\n` +
          `Please update Funny Animation Assistant and try again.`
        )
      }

      if (fileMajor < currentMajor) {
        throw new Error(
          `Project file format version (${fileVersion}) is lower than the supported version (${CURRENT_FORMAT_VERSION}).\n` +
          `The current version of Funny Animation Assistant cannot open this project file.`
        )
      }

      projectName.value = projectData.meta.name
      projectMeta.value = projectData.meta

      // TODO: Load all data into Store
      // Needs to convert Base64 to Blob URLs

      isProjectOpen.value = true
      return true
    } catch (error) {
      console.error('[ProjectStore] Failed to load from file:', error)
      return false
    }
  }

  /**
   * Generate project name (New Project 1, New Project 2, etc.)
   */
  function generateProjectName(): string {
    // Get used project name counter from localStorage
    const key = 'animeStudio_projectNameCounter'
    let counter = parseInt(localStorage.getItem(key) ?? '0', 10)
    counter++
    localStorage.setItem(key, counter.toString())
    return `New Project ${counter}`
  }

  // ==================== Actor / Narrator Management ====================

  /**
   * Add actor
   * v7.0: Actors use id as identifier
   */
  function addActor(actor: ActorConfig): void {
    actors.value.push(actor)
    markAsUnsaved()
  }

  /**
   * Update actor
   * v7.0: Use id to find actor
   */
  function updateActor(actorId: string, updates: Partial<Omit<ActorConfig, 'id'>>): void {
    const index = actors.value.findIndex(a => a.id === actorId)
    if (index !== -1) {
      actors.value[index] = { ...actors.value[index], ...updates } as ActorConfig
      markAsUnsaved()
    }
  }

  /**
   * Delete actor
   * v7.0: Use id to find actor
   */
  function deleteActor(actorId: string): void {
    const index = actors.value.findIndex(a => a.id === actorId)
    if (index !== -1) {
      actors.value.splice(index, 1)
      markAsUnsaved()
    }
  }

  /**
   * Update narrator configuration
   */
  function updateNarrator(config: NarratorConfig): void {
    narrator.value = config
    markAsUnsaved()
  }

  /**
   * Get actor by ID
   * v7.0: Use id to find actor
   */
  function getActor(actorId: string): ActorConfig | undefined {
    return actors.value.find(a => a.id === actorId)
  }

  /**
   * Get actor by characterId
   * v7.0: Added
   */
  function getActorByCharacterId(characterId: string): ActorConfig | undefined {
    return actors.value.find(a => a.characterId === characterId)
  }

  /**
   * For automated testing only: load project data directly from JSON string
   * Bypass File System Access API
   * Does not require FileSystemHandle, parses JSON and populates Stores only
   */
  async function OnlyForAutoTestCase_OpenProject(jsonContent: string): Promise<void> {
    await Promise.resolve()
    try {
      const projectData = JSON.parse(jsonContent) as ProjectData

      // Update project metadata
      projectName.value = projectData.meta.name
      projectMeta.value = projectData.meta

      // Clear all Stores
      const propStore = usePropStore()
      expressionStore.clearAll()
      backgroundStore.clearAll()
      propStore.clearAll()
      episodeStore.clearAll()
      sceneStore.clearScene()

      // Load background data
      let backgroundsLoaded = false
      if (projectData.assets?.backgrounds && projectData.assets.backgrounds.length > 0) {
        const firstBg = projectData.assets.backgrounds[0]
        if (firstBg?.type) {
          backgroundStore.setBackgrounds(projectData.assets.backgrounds)
          backgroundsLoaded = true
        }
      }
      if (!backgroundsLoaded && projectData.backgrounds) {
        const backgroundsList = Object.values(projectData.backgrounds)
        backgroundStore.setBackgrounds(backgroundsList as Background[])
      }

      // Load expression data
      if (projectData.expressions) {
        expressionStore.setExpressions(projectData.expressions)
      }

      // Load prop data
      if (projectData.assets?.props) {
        propStore.setProps(projectData.assets.props)
      }

      // Load sound effect data
      const soundStore = useSoundStore()
      if (projectData.assets?.sounds) {
        soundStore.setSounds(projectData.assets.sounds)
      }

      // Load episode list
      if (projectData.episodes && Array.isArray(projectData.episodes) && projectData.episodes.length > 0) {
        episodeStore.episodes = projectData.episodes.map((val) => {
          const ep = val as Episode
          const newEp: Episode = {
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            name: ep.name,
            scenes: ep.scenes ?? [],
            bgmTracks: ep.bgmTracks ?? [],
            duration: ep.duration ?? 0,
            createdAt: ep.createdAt,
            modifiedAt: ep.modifiedAt,
            version: ep.version ?? '6.0'
          }
          if (ep.thumbnail) newEp.thumbnail = ep.thumbnail
          return newEp
        })
      }

      // Load actors and narrator
      if (projectData.actors && Array.isArray(projectData.actors)) {
        actors.value = projectData.actors
      }
      if (projectData.narrator) {
        narrator.value = projectData.narrator
      }

      // Migrate Screenplay data (legacy compatibility)
      const anyProjectData = projectData as unknown as { screenplays?: Record<string, { scenes: unknown[] }> }
      if (anyProjectData.screenplays && Object.keys(anyProjectData.screenplays).length > 0) {
        Object.entries(anyProjectData.screenplays).forEach(([episodeId, screenplay]) => {
          const episode = episodeStore.episodes.find(ep => ep.id === episodeId)
          if (episode && screenplay.scenes) {
            episode.scenes = screenplay.scenes as unknown as SceneContainer[]
          }
        })
      }
      const hierarchyChanged = reconcileEpisodesHierarchy(episodeStore.episodes, 'loadProjectFromJson')

      // Character data loading removed


      // Set state
      isProjectOpen.value = true
      hasUnsavedChanges.value = hierarchyChanged

    } catch (error) {
      console.error('[OnlyForAutoTestCase] Failed to load project:', error)
      throw error
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // v20: Custom prefab action template CRUD
  // ═══════════════════════════════════════════════════════════════════

  function addCustomPreset(template: PresetAnimationTemplate): void {
    const errors = validatePresetTemplate(template)
    if (errors.length > 0) {
      console.warn(`[ProjectStore] Custom template validation failed: ${errors.join('; ')}`)
    }
    customPresetAnimations.value = [...customPresetAnimations.value, template]
    markAsUnsaved()
  }

  function deleteCustomPreset(templateId: string): void {
    customPresetAnimations.value = customPresetAnimations.value.filter(t => t.id !== templateId)
    markAsUnsaved()
  }

  function updateCustomPreset(templateId: string, updates: Partial<PresetAnimationTemplate>): void {
    customPresetAnimations.value = customPresetAnimations.value.map(t =>
      t.id === templateId ? { ...t, ...updates } as PresetAnimationTemplate : t
    )
    markAsUnsaved()
  }

  return {
    // State
    projectHandle,
    assetsHandle,
    projectName,
    projectMeta,
    isProjectOpen,
    autoSaveEnabled,
    hasUnsavedChanges,

    // v6.0: Project-level actor and narrator configuration
    actors,
    narrator,

    // Methods
    selectProjectDirectory,
    scanAnimeFiles,
    generateUniqueFileName,
    newProject,
    openProject,
    saveProject,
    closeProject,
    markAsUnsaved,
    checkUnsavedChanges,
    autoSave,
    hasAutoSave,
    getAutoSaveTime,
    restoreFromAutoSave,
    exportToDirectory,
    saveToFile,
    loadFromFile,
    generateProjectName,

    // v6.0: Actor/narrator management
    addActor,
    updateActor,
    deleteActor,
    updateNarrator,
    getActor,
    getActorByCharacterId,

    // v12.8: TTS cache
    saveTTSAudio,
    checkTTSAudioExists,
    saveTTSTiming,
    loadTTSTiming,
    checkTTSTimingExists,
    ensureTTSTiming,

    // v20: Custom prefab action templates
    customPresetAnimations,
    addCustomPreset,
    deleteCustomPreset,
    updateCustomPreset,

    // Test Helpers
    OnlyForAutoTestCase_OpenProject
  }
})

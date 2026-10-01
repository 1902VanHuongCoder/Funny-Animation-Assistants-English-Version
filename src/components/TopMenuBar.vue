<template>
  <div class="top-menu-bar">
    <div
      class="logo"
      title="Back to project home"
      @click="router.push('/project')"
    >
      <svg
        class="logo-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 128 128"
      >
        <defs>
          <linearGradient
            id="iconGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop
              offset="0%"
              style="stop-color:#2563EB;stop-opacity:1"
            />
            <stop
              offset="50%"
              style="stop-color:#3B82F6;stop-opacity:1"
            />
            <stop
              offset="100%"
              style="stop-color:#06B6D4;stop-opacity:1"
            />
          </linearGradient>
          <filter id="iconGlow">
            <feGaussianBlur
              stdDeviation="3"
              result="coloredBlur"
            />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx="64"
          cy="64"
          r="58"
          fill="url(#iconGradient)"
          filter="url(#iconGlow)"
        />
        <g transform="translate(64, 64)">
          <rect
            x="-24"
            y="-16"
            width="36"
            height="26"
            rx="3"
            fill="white"
            opacity="0.9"
          />
          <circle
            cx="-6"
            cy="-3"
            r="9"
            fill="white"
            opacity="0.95"
          />
          <circle
            cx="-6"
            cy="-3"
            r="5"
            fill="url(#iconGradient)"
          />
          <circle
            cx="8"
            cy="-11"
            r="3.5"
            fill="#ff4444"
          />
          <polygon
            points="18,-10 18,6 32,-2"
            fill="white"
            opacity="0.9"
          />
        </g>
      </svg>
      <h1 class="logo-text">
        Funny Animation Assistant
      </h1>
    </div>
    
    <!-- Project menu -->
    <div v-if="shouldShowProjectElements" class="menu-group">
      <div class="dropdown">
        <button
          class="menu-btn"
          @click="toggleProjectMenu"
        >
          📁 Project ▼
        </button>
        <div
          v-if="showProjectMenu"
          class="dropdown-menu"
        >
          <button
            class="menu-item"
            @click="handleNewProject"
          >
            📄 New Project
          </button>
          <button
            class="menu-item"
            @click="handleOpenProject"
          >
            📂 Open Project Folder
          </button>
          <button
            class="menu-item"
            @click="handleSaveProject"
          >
            💾 Save Project
          </button>
          <button
            class="menu-item"
            @click="handleCloseProject"
          >
            ❌ Close Project
          </button>
        </div>
      </div>
    </div>
    
    <!-- Project name breadcrumb -->
    <div v-if="shouldShowProjectElements" class="project-info">
      <span class="divider">/</span>
      <span
        class="project-name"
        :title="projectStore.projectName"
      >
        {{ projectStore.projectName }}
      </span>
    </div>

    <!-- Hidden file input fallback for browsers without the File System API. -->
    <input 
      ref="fileInput" 
      type="file" 
      accept=".anime" 
      style="display: none" 
      @change="handleFileSelect"
    >
    
    
    <!-- New project dialog -->
    <NewProjectDialog
      v-if="showNewProjectDialog"
      :directory-handle="selectedDirectory!"
      :existing-files="existingAnimeFiles"
      @confirm="handleConfirmNewProject"
      @cancel="showNewProjectDialog = false"
    />
    
    <!-- Confirm closing the current project before creating a new one. -->
    <ConfirmDialog
      v-if="showCloseConfirmDialog"
      title="Create New Project"
      :message="`The project '${projectStore.projectName}' will be saved and closed before creating a new project.`"
      confirm-text="Continue"
      cancel-text="Cancel"
      @confirm="handleConfirmClose"
      @cancel="showCloseConfirmDialog = false"
    />
    
    <!-- Confirm closing the current project before opening another one. -->
    <ConfirmDialog
      v-if="showOpenConfirmDialog"
      title="Open Project"
      :message="`The project '${projectStore.projectName}' will be saved and closed before opening another project.`"
      confirm-text="Continue"
      cancel-text="Cancel"
      @confirm="handleConfirmOpenProject"
      @cancel="showOpenConfirmDialog = false"
    />
    
    <!-- Project file selector dialog -->
    <ProjectFileSelectorDialog
      v-if="showFileSelectorDialog"
      :files="availableFiles"
      @select="handleSelectFile"
      @cancel="showFileSelectorDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import NewProjectDialog from '@/components/NewProjectDialog.vue'
import ProjectFileSelectorDialog from '@/components/ProjectFileSelectorDialog.vue'
import { useToast } from '@/composables/useToast'
import { useProjectStore } from '@/stores/projectStore'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const fileInput = ref<HTMLInputElement>()
const { success, error } = useToast()

const shouldShowProjectElements = computed(() => {
  return route.name !== undefined
})

const showProjectMenu = ref(false)

// New project dialog state
const showNewProjectDialog = ref(false)
const selectedDirectory = ref<FileSystemDirectoryHandle | null>(null)
const existingAnimeFiles = ref<string[]>([])

// Confirm close project dialog state
const showCloseConfirmDialog = ref(false)
const showOpenConfirmDialog = ref(false)

// Open project dialog state
const showFileSelectorDialog = ref(false)
const availableFiles = ref<{ name: string; lastModified: Date }[]>([])
const openProjectDirectory = ref<FileSystemDirectoryHandle | null>(null)


function toggleProjectMenu() {
  showProjectMenu.value = !showProjectMenu.value
}

// Close all menus
function closeMenus() {
  showProjectMenu.value = false
}

// Project menu actions
async function handleNewProject() {
  closeMenus()
  
  // If a project is open, show confirm dialog first
  if (projectStore.isProjectOpen) {
    showCloseConfirmDialog.value = true
    return
  }
  
  // If no project open, select directory directly
  await proceedWithNewProject()
}

// Handler after user confirms closing current project
async function handleConfirmClose() {
  showCloseConfirmDialog.value = false
  
  try {
    // Save current project
    const currentProjectName = projectStore.projectName || 'Current Project'
    try {
      await projectStore.saveProject()
      success(`"${currentProjectName}" saved`)
    } catch (saveError) {
      console.warn('Failed to save current project:', saveError)
      error('Save failed')
    }
    
    // Close current project
    await projectStore.closeProject(true) // skipCheck = true
    
    // Proceed with new project flow
    await proceedWithNewProject()
  } catch (error: unknown) {
    console.error(error)
    alert('Operation failed: ' + ((error as Error).message || 'Unknown error'))
  }
}

// Select directory and proceed with new project flow
async function proceedWithNewProject() {
  try {
    // Select directory (called within user gesture)
    const handle = await projectStore.selectProjectDirectory()
    
    // Scan existing files
    const files = await projectStore.scanAnimeFiles(handle)
    existingAnimeFiles.value = files.map(f => f.name)
    
    // Save directory handle and show dialog
    selectedDirectory.value = handle
    showNewProjectDialog.value = true
  } catch (error: unknown) {
    const err = error as Error
    if (err.name !== 'AbortError') {
      console.error(error)
      alert('Failed to select directory: ' + (err.message || 'Unknown error'))
    }
  }
}

// Confirm new project
async function handleConfirmNewProject(data: { fileName: string; projectName: string }) {
  try {
    showNewProjectDialog.value = false
    
    if (!selectedDirectory.value) {
      throw new Error('No directory selected')
    }
    
    // Create project using selected directory handle
    await projectStore.newProject(data.projectName, data.fileName, selectedDirectory.value)
    void router.push('/project')
  } catch (error: unknown) {
    console.error(error)
    alert('Failed to create project: ' + ((error as Error).message || 'Unknown error'))
  }
}

async function handleSaveProject() {
  closeMenus()
  try {
    // Save to file system (project.anime file)
    await projectStore.saveProject()
    success('Project saved successfully!')
  } catch (err: unknown) {
    console.error(err)
    error('Failed to save project: ' + ((err as Error).message || 'Unknown error'))
  }
}

async function handleOpenProject() {
  closeMenus()
  
  // If a project is open, show confirm dialog first
  if (projectStore.isProjectOpen) {
    showOpenConfirmDialog.value = true
    return
  }
  
  // If no project open, open directly
  await proceedWithOpenProject()
}

// Handler after user confirms closing current project (open new project)
async function handleConfirmOpenProject() {
  showOpenConfirmDialog.value = false
  
  try {
    // Save current project
    const currentProjectName = projectStore.projectName || 'Current Project'
    try {
      await projectStore.saveProject()
      success(`"${currentProjectName}" saved`)
    } catch (saveError) {
      console.warn('Failed to save current project:', saveError)
      error('Save failed')
    }
    
    // Close current project
    await projectStore.closeProject(true) // skipCheck = true
    
    // Proceed with open project flow (user confirm is new user gesture)
    await proceedWithOpenProject()
  } catch (error: unknown) {
    console.error(error)
    alert('Operation failed: ' + ((error as Error).message || 'Unknown error'))
  }
}

// Select and open project
async function proceedWithOpenProject() {
  try {
    // Select directory (called within user gesture)
    const handle = await projectStore.selectProjectDirectory()
    
    // Scan existing files
    const files = await projectStore.scanAnimeFiles(handle)
    
    // If multiple files exist, show selection dialog
    if (files.length > 1) {
      availableFiles.value = files
      openProjectDirectory.value = handle
      showFileSelectorDialog.value = true
    } else if (files.length === 1 && files[0]) {
      // Single file, open directly
      await projectStore.openProject(files[0].name, handle)
      void router.push('/project')
    } else {
      throw new Error('No .anime file found')
    }
  } catch (error: unknown) {
    const err = error as Error
    if (err.name === 'AbortError' || err.message === 'Operation cancelled by user') {
      return
    }
    console.error(error)
    alert('Failed to open project: ' + (err.message || 'Unknown error'))
  }
}

// Handler after user selects file
async function handleSelectFile(fileName: string) {
  try {
    showFileSelectorDialog.value = false
    
    if (!openProjectDirectory.value) {
      throw new Error('Directory handle not found')
    }
    
    await projectStore.openProject(fileName, openProjectDirectory.value)
    void router.push('/project')
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError' || (err as Error).message === 'Operation cancelled by user') {
      return
    }
    console.error(err)
    alert('Failed to open project: ' + ((err as Error).message || 'Unknown error'))
  }
}

async function handleCloseProject() {
  closeMenus()
  
  try {
    // closeProject checks unsaved changes internally
    await projectStore.closeProject()
    void router.push('/project')
  } catch (error: unknown) {
    if ((error as Error).message !== 'Operation cancelled by user') {
      console.error(error)
      alert('Failed to close project: ' + ((error as Error).message || 'Unknown error'))
    }
  }
}

// File selection handler (fallback approach)
async function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    if (!file.name.endsWith('.anime')) {
      alert('Please select a project file in .anime format')
      return
    }
    
    try {
      const success = await projectStore.loadFromFile(file)
      if (success) {
        projectStore.isProjectOpen = true
        void router.push('/project')
        alert(`Project "${projectStore.projectName}" loaded successfully!`)
      } else {
        alert('Failed to load project, please check the file format')
      }
    } catch (error) {
      console.error(error)
      alert('Failed to load project. Please check the console.')
    }
    
    // Clear input
    if (e.target) {
      (e.target as HTMLInputElement).value = ''
    }
  }
}

// Click outside to close menus
if (typeof window !== 'undefined') {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (!target.closest('.dropdown')) {
      closeMenus()
    }
  })
}

</script>

<style scoped>
.top-menu-bar {
  display: flex;
  align-items: center;
  padding: 0 24px;
  height: 60px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
  position: relative;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.2s;
}

.logo:hover {
  opacity: 0.8;
}

.logo-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.logo-text {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  background: linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #06B6D4 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.5px;
}

.menu-group {
  margin-left: 24px;
}

.dropdown {
  position: relative;
}

.menu-btn {
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  background: transparent;
  color: #4b5563;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.menu-btn:hover {
  background: #f3f4f6;
  color: #111827;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 8px;
  min-width: 180px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  z-index: 1000;
  overflow: hidden;
  padding: 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  text-align: left;
  background: white;
  color: #374151;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.menu-item:hover {
  background: #eff6ff;
  color: #2563eb;
}

.project-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 12px;
}

.divider {
  color: #9ca3af;
  font-size: 18px;
  font-weight: 300;
}

.project-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.right-actions {
  display: flex;
  align-items: center;
  margin-left: auto;
}

</style>

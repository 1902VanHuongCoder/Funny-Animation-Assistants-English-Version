<template>
  <div class="project-home-page">
    <!-- A. Project open: Show Studio interface -->
    <div
      v-if="projectStore.isProjectOpen"
      class="studio-workspace"
    >
      <!-- Project info card -->
      <ProjectInfoCard 
        :name="projectStore.projectName"
        :episode-count="episodeStore.episodes.length"
        @rename="handleRename"
      />
      
      <!-- Navigation tab bar -->
      <ProjectHomeTabs 
        v-model="currentTab"
        :tabs="tabs"
      />
      
      <!-- Content area -->
      <div class="hub-content">
        <!-- 1. Animation list (Episodes) -->
        <div
          v-if="currentTab === 'episodes'"
          class="episodes-section"
        >
          <div
            v-if="episodeStore.episodes.length > 0"
            class="episodes-grid"
          >
            <!-- New animation card -->
            <NewEpisodeCard @click="handleCreateEpisode" />
            
            <!-- Animation card list -->
            <EpisodeCard
              v-for="episode in episodeStore.sortedEpisodes"
              :key="episode.id"
              :episode="episode"
              @edit="handleEditScreenplay"
              @delete="handleDeleteEpisode"
            />
          </div>
          
          <!-- Empty state -->
          <div
            v-else
            class="empty-container"
          >
            <EmptyState />
            <div class="empty-action">
              <button
                class="create-btn"
                @click="handleCreateEpisode"
              >
                ➕ Create First Episode
              </button>
            </div>
          </div>
        </div>

        <!-- 2. Asset manager integration -->
        <div
          v-else
          class="asset-manager-container"
        >
          <CompositeCharacterManager v-if="currentTab === 'characters'" />
          <ExpressionManager v-else-if="currentTab === 'expressions'" />
          <BackgroundManager v-else-if="currentTab === 'backgrounds'" />
          <PropManager v-else-if="currentTab === 'props'" />
          <!-- v7.3: EffectManager removed, effects merged into props -->
          <SoundManager v-else-if="currentTab === 'sounds'" />
          <SceneTemplateManager v-else-if="currentTab === 'sceneTemplates'" />
          
          <!-- Under development module -->
          <div
            v-else
            class="coming-soon"
          >
            <div class="placeholder-content">
              <span class="placeholder-icon">🚧</span>
              <h3>{{ getTabLabel(currentTab) }} Management Coming Soon</h3>
              <p>This module will be available in future releases. Stay tuned.</p>
            </div>
          </div>
        </div>
      </div>
      
    </div>

    <!-- B. No project open: Welcome interface -->
    <div
      v-else
      class="welcome-screen"
    >
      <div class="welcome-card">
        <!-- Logo icon -->
        <div class="welcome-logo-container">
          <svg
            class="welcome-logo-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="120"
            height="120"
            viewBox="0 0 128 128"
          >
            <defs>
              <linearGradient
                id="welcomeIconGradient"
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
              <filter id="welcomeIconGlow">
                <feGaussianBlur
                  stdDeviation="4"
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
              fill="url(#welcomeIconGradient)"
              filter="url(#welcomeIconGlow)"
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
                fill="url(#welcomeIconGradient)"
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
        </div>
         
        <h1 class="welcome-title">
          Funny Animation Assistant
        </h1>

        <div class="welcome-actions">
          <button
            class="action-btn primary"
            @click="handleNewProject"
          >
            <span class="btn-icon">📄</span>
            <span class="btn-text">New Project</span>
          </button>
          <button
            class="action-btn outline"
            @click="handleOpenProject"
          >
            <span class="btn-icon">📂</span>
            <span class="btn-text">Open Project Folder</span>
          </button>
        </div>

        <!-- Open source edition description -->
        <div class="support-group-banner">
          <div class="support-group-icon">
            ℹ️
          </div>
          <div class="support-group-content">
            <p class="support-group-title">
              Community Edition
            </p>
            <p class="support-group-desc">
              A local-first open-source creator with no remote accounts, operations backend, or private service dependencies.
            </p>
            <p class="support-group-number">
              Technical discussion QQ group: 809574217
            </p>
          </div>
        </div>
         
        <!-- Feature display -->
        <div class="features-grid">
          <div class="feature-item">
            <div class="feature-icon">
              🎬
            </div>
            <div class="feature-text">
              <h3>Scene Editing</h3>
              <p>Visual script editing</p>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">
              👥
            </div>
            <div class="feature-text">
              <h3>Character Management</h3>
              <p>Flexible character system</p>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">
              🎨
            </div>
            <div class="feature-text">
              <h3>Asset Management</h3>
              <p>Organized asset library</p>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">
              🎵
            </div>
            <div class="feature-text">
              <h3>Smart Voiceover</h3>
              <p>Speech synthesis</p>
            </div>
          </div>
        </div>


      </div>
       
      <!-- Hidden file input (fallback) -->
      <input 
        ref="fileInput" 
        type="file" 
        accept=".anime" 
        style="display: none" 
        @change="handleFileSelect"
      >
    </div>
  </div>
  
  <!-- Global dialogs - not restricted by isProjectOpen -->
  <NewProjectDialog
    v-if="showNewProjectDialog"
    :directory-handle="selectedDirectory!"
    :existing-files="existingAnimeFiles"
    @confirm="handleConfirmNewProject"
    @cancel="showNewProjectDialog = false"
  />
  
  <ProjectFileSelectorDialog
    v-if="showFileSelectorDialog"
    :files="availableFiles"
    @select="handleSelectFile"
    @cancel="showFileSelectorDialog = false"
  />
  
  <!-- Confirm closing before creating a new project. -->
  <ConfirmDialog
    v-if="showCloseConfirmDialog"
    title="Create New Project"
    :message="`The project '${projectStore.projectName}' will be saved and closed before creating a new project.`"
    confirm-text="Continue"
    cancel-text="Cancel"
    @confirm="handleConfirmCloseForNew"
    @cancel="showCloseConfirmDialog = false"
  />
  
  <!-- Confirm closing before opening another project. -->
  <ConfirmDialog
    v-if="showOpenConfirmDialog"
    title="Open Project"
    :message="`The project '${projectStore.projectName}' will be saved and closed before opening another project.`"
    confirm-text="Continue"
    cancel-text="Cancel"
    @confirm="handleConfirmOpenProject"
    @cancel="showOpenConfirmDialog = false"
  />

  <!-- Delete animation confirmation dialog -->
  <ConfirmDialog
    v-if="showDeleteEpisodeConfirm"
    title="Delete Episode"
    :message="deleteEpisodeMessage"
    confirm-text="Delete"
    :is-danger="true"
    @confirm="confirmDeleteEpisode"
    @cancel="showDeleteEpisodeConfirm = false"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import BackgroundManager from '@/components/BackgroundManager.vue'
import CompositeCharacterManager from '@/components/CompositeCharacterManager.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import EpisodeCard from '@/components/EpisodeCard.vue'
import ExpressionManager from '@/components/ExpressionManager.vue'
import NewEpisodeCard from '@/components/NewEpisodeCard.vue'
import NewProjectDialog from '@/components/NewProjectDialog.vue'
import ProjectFileSelectorDialog from '@/components/ProjectFileSelectorDialog.vue'
// Components
import ProjectInfoCard from '@/components/ProjectInfoCard.vue'
import PropManager from '@/components/PropManager.vue'
// v7.3: EffectManager removed
import SceneTemplateManager from '@/components/SceneTemplateManager.vue'
import SoundManager from '@/components/SoundManager.vue'
import ProjectHomeTabs from '@/components/studio/ProjectHomeTabs.vue'
import { useEpisodeStore } from '@/stores/episodeStore'
import { useProjectStore } from '@/stores/projectStore'

const router = useRouter()
const projectStore = useProjectStore()
const episodeStore = useEpisodeStore()

const showNewProjectDialog = ref(false)
const showFileSelectorDialog = ref(false)
const selectedDirectory = ref<FileSystemDirectoryHandle | null>(null)
const existingAnimeFiles = ref<string[]>([])
const availableFiles = ref<{ name: string; lastModified: Date }[]>([])

// Confirm close project dialog state
const showCloseConfirmDialog = ref(false)
const showOpenConfirmDialog = ref(false)

// Delete animation confirmation dialog state
const showDeleteEpisodeConfirm = ref(false)
const pendingDeleteEpisodeId = ref<string | null>(null)
const deleteEpisodeMessage = ref('')

// Tabs Configuration
const currentTab = ref('episodes')

const tabs = [
  { label: 'Episodes', value: 'episodes', icon: '🎬' },
  { label: 'Scene Templates', value: 'sceneTemplates', icon: '🧩' },
  { label: 'Characters', value: 'characters', icon: '👤' },
  { label: 'Expressions', value: 'expressions', icon: '😊' },
  { label: 'Backgrounds', value: 'backgrounds', icon: '🖼️' },
  { label: 'Props', value: 'props', icon: '📦' },
  // v7.3: Effect library removed, effects merged into prop library
  { label: 'Sounds', value: 'sounds', icon: '🔊' },
  { label: 'About', value: 'about', icon: 'ℹ️', link: '/about' },
]

function getTabLabel(value: string) {
  return tabs.find(t => t.value === value)?.label || 'This module'
}

// ----------------------------------------------------------------
// Settings Logic
// ----------------------------------------------------------------

function handleRename(name: string) {
  projectStore.projectName = name
  projectStore.projectMeta.name = name
}

// ----------------------------------------------------------------
// Episode Logic (Moved from original)
// ----------------------------------------------------------------

// Create an episode.
function handleCreateEpisode() {
  // Auto-generate animation name
  const defaultName = `Episode ${episodeStore.episodes.length + 1}`
  const episode = episodeStore.createEpisode(defaultName)
  // Navigate to screenplay editor page after creation; user can modify name there
  void router.push(`/screenplay/${episode.id}`)
}

// ----------------------------------------------------------------
// Project Lifecycle Logic (Welcome Screen)
// ----------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null)

async function handleNewProject() {
  // If project is open, show confirmation dialog first
  if (projectStore.isProjectOpen) {
    showCloseConfirmDialog.value = true
    return
  }
  
  // If no project is open, continue directly
  await proceedWithNewProject()
}

// Handler when user confirms closing current project
async function handleConfirmCloseForNew() {
  showCloseConfirmDialog.value = false
  
  try {
    // Save current project
    try {
      await projectStore.saveProject()
    } catch (saveError) {
      // Save failed, ignore
    }
    
    // Close current project
    await projectStore.closeProject(true) // skipCheck = true
    
    // Continue new project workflow
    await proceedWithNewProject()
  } catch (error: unknown) {
    console.error(error)
    alert('Operation failed: ' + ((error as Error).message || 'Unknown error'))
  }
}

// Select directory and continue new project workflow
async function proceedWithNewProject() {
  try {
    // Prompt user to select directory (must be in user gesture)
    const handle = await projectStore.selectProjectDirectory()
    
    // Scan existing .anime files
    const files = await projectStore.scanAnimeFiles(handle)
    existingAnimeFiles.value = files.map(f => f.name)
    
    // Save directory handle and show dialog
    selectedDirectory.value = handle
    showNewProjectDialog.value = true
  } catch (error: unknown) {
    const err = error as Error
    if (err.name !== 'AbortError' && err.message !== 'The user cancelled the operation') {
      console.error(error)
      alert('Failed to select a folder: ' + (err.message || 'Unknown error'))
    }
  }
}

async function handleConfirmNewProject(data: { fileName: string; projectName: string }) {
  try {
    showNewProjectDialog.value = false
    
    if (!selectedDirectory.value) {
      throw new Error('No folder selected')
    }
    
    // Create project using selected directory handle
    await projectStore.newProject(data.projectName, data.fileName, selectedDirectory.value)
  } catch (error: unknown) {
    console.error(error)
    alert('Failed to create project: ' + ((error as Error).message || 'Unknown error'))
  }
}

async function handleOpenProject() {
  // If project is open, show confirmation dialog first
  if (projectStore.isProjectOpen) {
    showOpenConfirmDialog.value = true
    return
  }
  
  // If no project is open, open directly
  await proceedWithOpenProject()
}

// Handler when user confirms closing current project (open new project)
async function handleConfirmOpenProject() {
  showOpenConfirmDialog.value = false
  
  try {
    // Save current project
    try {
      await projectStore.saveProject()
    } catch (saveError) {
      // Save failed, ignore
    }
    
    // Close current project
    await projectStore.closeProject(true) // skipCheck = true
    
    // Continue open project workflow (user confirmation is a new user gesture)
    await proceedWithOpenProject()
  } catch (error: unknown) {
    console.error(error)
    alert('Operation failed: ' + ((error as Error).message || 'Unknown error'))
  }
}

// Select and open project
async function proceedWithOpenProject() {
  try {
    // Select directory (called in user gesture)
    const handle = await projectStore.selectProjectDirectory()
    
    // Scan existing files
    const files = await projectStore.scanAnimeFiles(handle)
    
    // If multiple files exist, show selection dialog
    if (files.length > 1) {
      availableFiles.value = files
      selectedDirectory.value = handle
      showFileSelectorDialog.value = true
    } else if (files.length === 1 && files[0]) {
      // Single file, open directly
      await projectStore.openProject(files[0].name, handle)
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

async function handleSelectFile(fileName: string) {
  try {
    showFileSelectorDialog.value = false
    
    // Open specified file using previously saved directory handle
    if (!selectedDirectory.value) {
      throw new Error('Directory handle not found')
    }
    await projectStore.openProject(fileName, selectedDirectory.value)
  } catch (error: unknown) {
    const err = error as Error
    if (err.name === 'AbortError' || err.message === 'Operation cancelled by user') {
      return
    }
    console.error(error)
    alert('Failed to open project: ' + (err.message || 'Unknown error'))
  }
}

async function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    if (!file.name.endsWith('.anime')) {
      alert('Please select a project file in .anime format')
      return
    }
    
    const success = await projectStore.loadFromFile(file)
    if (success) {
      projectStore.isProjectOpen = true
      alert(`Project "${projectStore.projectName}" loaded successfully!`)
    } else {
      alert('Failed to load project, please check the file format')
    }
  }
  if (e.target) (e.target as HTMLInputElement).value = ''
}

// Edit screenplay (click edit button)
function handleEditScreenplay(id: string) {
  void router.push(`/screenplay/${id}`)
}

// Delete animation
function handleDeleteEpisode(id: string) {
  const episode = episodeStore.getEpisode(id)
  if (episode) {
    pendingDeleteEpisodeId.value = id
    deleteEpisodeMessage.value = `Are you sure you want to delete "${episode.name}"? This action cannot be undone.`
    showDeleteEpisodeConfirm.value = true
  }
}

// Confirm delete animation
function confirmDeleteEpisode() {
  if (pendingDeleteEpisodeId.value) {
    episodeStore.deleteEpisode(pendingDeleteEpisodeId.value)
  }
  pendingDeleteEpisodeId.value = null
  showDeleteEpisodeConfirm.value = false
}

// (Removed old prompt-based edit)
</script>

<style scoped>
.project-home-page {
  padding: 24px;
  max-width: 1600px; /* Wider for studio view */
  margin: 0 auto;
}

.hub-content {
  min-height: 500px;
}

/* Episodes Grid Styles */
.episodes-section {
  animation: fadeIn 0.3s ease;
}

.episodes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.empty-container {
  background: white;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
}

.empty-action {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

.create-btn {
  padding: 12px 32px;
  font-size: 16px;
  font-weight: 600;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.create-btn:hover {
  background: #2563eb;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

/* Asset Manager Container Styles */
.asset-manager-container {
  background: #ffffff;
  border-radius: 12px;
  /* border: 1px solid #e5e7eb; */ /* Optional border */
  min-height: 600px;
  animation: fadeIn 0.3s ease;
}

/* Coming Soon Styles */
.coming-soon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 400px;
  background: #f9fafb;
  border-radius: 12px;
  border: 2px dashed #e5e7eb;
}

.placeholder-content {
  text-align: center;
  color: #6b7280;
}

.placeholder-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 16px;
}

/* Welcome Screen Styles */
.welcome-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8eef5 100%);
  animation: fadeIn 0.5s ease;
  position: relative;
  overflow: hidden;
}

/* Add background decoration */
.welcome-screen::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -10%;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%);
  border-radius: 50%;
  animation: float 20s ease-in-out infinite;
}

.welcome-screen::after {
  content: '';
  position: absolute;
  bottom: -30%;
  left: -5%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(236, 72, 153, 0.1) 0%, transparent 70%);
  border-radius: 50%;
  animation: float 15s ease-in-out infinite reverse;
}

@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, -30px) scale(1.1); }
}

.welcome-card {
  background: white;
  padding: 48px 72px;
  border-radius: 18px;
  box-shadow: 0 18px 50px -18px rgba(15, 23, 42, 0.24);
  text-align: center;
  max-width: 760px;
  width: 100%;
  position: relative;
  z-index: 1;
  animation: slideUp 0.6s ease;
}

@keyframes slideUp {
  from { 
    opacity: 0; 
    transform: translateY(30px); 
  }
  to { 
    opacity: 1; 
    transform: translateY(0); 
  }
}

.welcome-logo-container {
  margin-bottom: 18px;
  animation: logoAppear 0.8s ease 0.2s both;
}

@keyframes logoAppear {
  from {
    opacity: 0;
    transform: scale(0.8) rotate(-10deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
}

.welcome-logo-icon {
  width: 96px;
  height: 96px;
  filter: drop-shadow(0 10px 18px rgba(37, 99, 235, 0.2));
  animation: pulse 3s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.welcome-title {
  font-size: 42px;
  background: linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #06B6D4 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 28px;
  font-weight: 800;
  letter-spacing: 0;
  animation: fadeIn 0.6s ease 0.3s both;
}

.welcome-actions {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  margin-bottom: 18px;
  animation: fadeIn 0.6s ease 0.6s both;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 280px;
  padding: 14px 28px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.action-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transform: translate(-50%, -50%);
  transition: width 0.6s, height 0.6s;
}

.action-btn:hover::before {
  width: 300px;
  height: 300px;
}

.action-btn.primary {
  background: linear-gradient(135deg, #2563EB 0%, #3B82F6 100%);
  color: white;
  border: none;
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.24);
}

.action-btn.primary:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.28);
}

.action-btn.primary:active {
  transform: translateY(-1px);
}

.action-btn.outline {
  background: white;
  color: #374151;
  border: 2px solid #e5e7eb;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.action-btn.outline:hover {
  border-color: #2563EB;
  color: #2563EB;
  background: #f9fafb;
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(37, 99, 235, 0.12);
}

.btn-icon {
  font-size: 20px;
  position: relative;
  z-index: 1;
}

.btn-text {
  position: relative;
  z-index: 1;
}

/* Feature display grid */
.features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 22px;
  padding-top: 26px;
  border-top: 1px solid #e5e7eb;
  animation: fadeIn 0.6s ease 0.7s both;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  transition: all 0.3s ease;
  cursor: default;
}

.feature-item:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
  border-color: #2563EB;
}

.feature-icon {
  font-size: 26px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 3px solid #2563EB;
  border-radius: 12px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
}

.feature-text {
  text-align: left;
  flex: 1;
}

.feature-text h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.feature-text p {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

/* Support group guide */
.support-group-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 520px;
  margin: 0 auto 28px;
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 10px;
  border: 1px solid #dbeafe;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
  animation: fadeIn 0.6s ease 0.65s both;
  transition: all 0.3s ease;
}

.support-group-banner:hover {
  border-color: #bfdbfe;
  box-shadow: 0 10px 26px rgba(37, 99, 235, 0.08);
}

.support-group-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  font-size: 21px;
  background: #eff6ff;
  border-radius: 10px;
  flex-shrink: 0;
}

.support-group-content {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 12px;
  align-items: center;
  text-align: left;
  flex: 1;
}

.support-group-title {
  margin: 0 0 2px 0;
  font-size: 14px;
  font-weight: 700;
  color: #1e40af;
}

.support-group-desc {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.support-group-number {
  grid-column: 2;
  grid-row: 1 / 3;
  margin: 0;
  padding: 7px 10px;
  font-size: 16px;
  font-weight: 800;
  color: #1D4ED8;
  letter-spacing: 1px;
  background: white;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  box-shadow: none;
  user-select: all;
  cursor: text;
}

@media (max-width: 640px) {
  .support-group-banner {
    align-items: flex-start;
    margin-bottom: 24px;
    padding: 16px;
  }

  .support-group-content {
    grid-template-columns: 1fr;
    row-gap: 10px;
  }

  .support-group-number {
    grid-column: 1;
    grid-row: auto;
    justify-self: start;
    font-size: 20px;
  }
}

.history-list {
  margin-top: 48px;
  border-top: 1px solid #e5e7eb;
  padding-top: 24px;
}

.history-title {
  font-size: 14px;
  color: #9ca3af;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.studio-footer {
  text-align: center;
  padding: 24px 0 8px;
}

.about-link {
  color: #9ca3af;
  text-decoration: none;
  font-size: 13px;
  transition: color 0.2s;
}

.about-link:hover {
  color: #6b7280;
}
</style>

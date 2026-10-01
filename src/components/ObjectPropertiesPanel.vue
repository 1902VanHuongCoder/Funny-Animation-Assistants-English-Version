<template>
  <div class="properties-panel">
    <!-- P2: Object selector (collapsible tree dropdown) -->
    <div class="object-selector-section">
      <div
        ref="treeDropdownRef"
        class="tree-dropdown"
      >
        <!-- Selected item display / trigger button -->
        <button
          class="tree-dropdown-trigger"
          @click="treeDropdownOpen = !treeDropdownOpen"
        >
          <span v-if="localObject" class="trigger-content">
            <span class="trigger-icon">{{ getObjectIcon(localObject.type) }}</span>
            <span class="trigger-label">{{ getObjectDisplayName(localObject) }}</span>
          </span>
          <span v-else class="trigger-placeholder">Please select an object</span>
          <span class="trigger-arrow">{{ treeDropdownOpen ? '▲' : '▼' }}</span>
        </button>

        <!-- Dropdown list -->
        <div
          v-show="treeDropdownOpen"
          class="tree-dropdown-list"
        >
          <template v-for="obj in filteredObjects" :key="obj.id">
            <!-- Skip collapsed child objects (check all ancestors expanded) -->
            <div
              v-if="isTreeItemVisible(obj)"
              class="tree-item"
              :class="{
                selected: localObject?.id === obj.id,
                'child-item': !!getEffectiveParentId(obj),
                'nested-child-item': getTreeDepth(obj) > 1,
                inactive: isActionMode && !isObjectVisibleAtCurrentSlot(obj.id)
              }"
              @click="handleTreeItemSelect(obj.id)"
            >
              <button
                v-if="obj.type === 'composite' || hasRuntimeChildren(obj.id)"
                class="tree-toggle-btn"
                :style="getEffectiveParentId(obj) ? { marginLeft: (getTreeDepth(obj) - 1) * 16 + 'px' } : {}"
                @click.stop="toggleCompositeExpand(obj.id)"
              >
                {{ expandedComposites.has(obj.id) ? '▼' : '▶' }}
              </button>
              <span v-else-if="getEffectiveParentId(obj)" class="tree-indent" :style="{ paddingLeft: (getTreeDepth(obj) - 1) * 16 + 'px' }">└</span>
              <span v-else class="tree-indent-spacer" />

              <span class="tree-item-icon">{{ getObjectIcon(obj.type) }}</span>
              <span class="tree-item-label">{{ getObjectDisplayName(obj) }}{{ getObjectStatusSuffix(obj.id) }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
    
    <div
      v-if="!selectedObject || !localObject"
      class="empty-hint"
    >
      Please select a scene object to edit its properties
    </div>
    <div
      v-else
      class="properties-form"
    >
      <!-- Action Mode slot hint -->
      <div
        v-if="isActionMode"
        class="action-mode-hint"
      >
        <div class="slot-indicator">
          <span class="slot-badge">#{{ (currentSlotIndex ?? 0) + 1 }}</span>
          <span class="slot-text">{{ currentSlotText ? truncateText(currentSlotText, 15) : 'Current Slot' }}</span>
        </div>
        <div class="hint-text">
          💡 Property modifications will be recorded automatically based on action mode
        </div>
        <!-- v9.1: Unspawned object warning -->
        <div
          v-if="!isObjectBornAtCurrentSlot"
          class="unborn-warning"
        >
          <span class="warning-icon">⚠️</span>
          <span class="warning-text">This object has not spawned yet; current properties are read-only</span>
          <button
            v-if="objectBirthSlotIndex >= 0"
            class="jump-btn"
            title="Jump to object's spawn slot"
            @click="jumpToBirthSlot"
          >
            Jump to Spawn Point
          </button>
        </div>
      </div>

      <!-- v9.1: Record mode toggle (animation/layout) - shown in Action Mode only -->
      <div
        v-if="isActionMode && !isCamera && localObject?.type !== 'audio'"
        class="record-mode-section"
      >
        <div class="record-mode-label">Action Mode:</div>
        <div class="record-mode-tabs">
          <button
            class="record-mode-btn"
            :class="{ active: recordMode === 'animation' }"
            title="Tween mode - Dragging produces smooth movement animation"
            @click="recordMode = 'animation'"
          >
            🎬 Tween
          </button>
          <button
            class="record-mode-btn"
            :class="{ active: recordMode === 'layout' }"
            title="Instant mode - Dragging produces instant displacement"
            @click="recordMode = 'layout'"
          >
            📍 Instant
          </button>
        </div>
      </div>

      <!-- ===== Quick action toolbar ===== -->
      <div
        class="quick-toolbar"
        :class="{
          'with-record-mode': isActionMode && !isCamera && localObject?.type !== 'audio',
          'setup-toolbar': !isActionMode
        }"
      >
        <div class="quick-toolbar-header">
          <span class="quick-toolbar-title">Quick Actions</span>
          <span class="quick-toolbar-subtitle">
            {{ isActionMode ? 'Editing aids for current object' : 'Scene editing aids for current object' }}
          </span>
        </div>
        <!-- compositeLocked toggle (shown for composite objects only) -->
        <div
          v-if="localObject?.type === 'composite'"
          class="quick-toolbar-group quick-toolbar-group--compact"
        >
          <span class="quick-toolbar-group-label">Lock</span>
        <label v-if="localObject?.type === 'composite'" class="qt-toggle">
          <input
            :checked="(localObject as CompositeObject).compositeLocked"
            type="checkbox"
            @change="handleCompositeLockChange"
          >
          <span class="qt-toggle-label">🔒 Lock Group</span>
        </label>
        </div>

        <!-- Pass-through control -->
        <div class="quick-toolbar-group quick-toolbar-group--fill">
          <span class="quick-toolbar-group-label">Pass-Through</span>
        <div v-if="isPassThrough" class="pass-through-indicator">
          <div class="pt-status-line">
            <span class="pt-icon">👻</span>
            <span class="pt-text">This object is set to pass-through mode</span>
          </div>
          <div class="pt-actions">
            <button
              class="pt-btn"
              :class="{ active: passThroughVisible }"
              @click="emit('passThroughVisibleToggle', localObject!.id)"
            >
              {{ passThroughVisible ? '👁️ Show' : '🚫 Hide' }}
            </button>
            <button
              class="pt-btn remove"
              @click="emit('passThroughToggle', localObject!.id)"
            >
              ↩ Cancel Pass-Through
            </button>
          </div>
        </div>
        <button
          v-else
          class="qt-pt-btn"
          @click="emit('passThroughToggle', localObject!.id)"
        >
          👻 Set to Pass-Through
        </button>
        </div>
      </div>

      <!-- Basic properties -->
      <div class="property-section">
        <h4>Basic Properties</h4>
        
        <!-- v9.3: Name editing (merged original name and alias) -->
        <div
          v-if="!isCamera"
          class="property-field alias-field"
        >
          <label>Name:</label>
          <div class="alias-edit-stack">
            <div class="alias-edit-row">
              <span class="alias-value">{{ localObjectDisplayName }}</span>
              <button
                class="alias-edit-btn"
                title="Edit Name"
                @click="handleEditAliasClick"
              >
                Edit
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="showPresetNamePicker"
          class="property-field alias-field preset-name-field"
        >
          <label>Preset Name:</label>
          <div class="alias-edit-stack">
            <div
              class="preset-name-row"
            >
              <select
                class="preset-name-select"
                :value="selectedPresetNameValue"
                title="Select recommended name for predefined actions"
                @change="handlePresetNameSelect(($event.target as HTMLSelectElement).value)"
              >
                <option value="">Select preset name...</option>
                <option
                  v-for="name in recommendedNameOptions"
                  :key="name"
                  :value="name"
                  :disabled="isPresetNameUsedByOtherObject(name)"
                >
                  {{ name }}{{ isPresetNameUsedByOtherObject(name) ? ' (Used)' : '' }}
                </option>
              </select>
            </div>
          </div>
        </div>
        
        <div
          v-if="localObject.type !== 'audio' && !isAmbientLight"
          class="property-row"
        >
          <div class="property-field">
            <label>{{ isCamera ? 'Center X:' : 'X:' }}</label>
            <template v-if="isActionMode">
              <span class="readonly-value">{{ Math.round(localObject.x) }}</span>
            </template>
            <template v-else>
              <input 
                :value="Math.round(localObject.x)" 
                type="number" 
                :min="0" 
                :max="props.canvasWidth || 3840" 
                @change="handleXChange" 
              >
            </template>
          </div>
          <div class="property-field">
            <label>{{ isCamera ? 'Center Y:' : 'Y:' }}</label>
            <template v-if="isActionMode">
              <span class="readonly-value">{{ Math.round(localObject.y) }}</span>
            </template>
            <template v-else>
              <input 
                :value="Math.round(localObject.y)" 
                type="number" 
                :min="0" 
                :max="props.canvasHeight ?? 2160" 
                @change="handleYChange" 
              >
            </template>
          </div>
        </div>
        
        <div
          v-if="!isCamera && localObject.type !== 'audio' && localObject.type !== 'light'"
          class="property-row"
        >
          <div class="property-field">
            <label>Width:</label>
            <template v-if="isActionMode">
              <span class="readonly-value">{{ displayWidth }}</span>
            </template>
            <template v-else>
              <input 
                v-model.number="displayWidth" 
                type="number" 
                :min="1" 
                @change="handleSizeChange" 
              >
            </template>
          </div>
          <div class="property-field">
            <label>Height:</label>
            <template v-if="isActionMode">
              <span class="readonly-value">{{ displayHeight }}</span>
            </template>
            <template v-else>
              <input 
                v-model.number="displayHeight" 
                type="number" 
                :min="1" 
                @change="handleSizeChange" 
              >
            </template>
          </div>
        </div>
        
        <!-- Camera Zoom properties -->
        <div
          v-if="isCamera"
          class="property-field"
        >
          <label>Zoom:</label>
          <template v-if="isActionMode">
            <span class="readonly-value">{{ cameraZoomPercent }}%</span>
          </template>
          <template v-else>
            <div class="scale-control">
              <input 
                :value="cameraZoomPercent" 
                type="number" 
                min="10" 
                max="1000" 
                step="10"
                class="scale-input"
                @change="handleCameraZoomChange" 
              >
              <span class="percent-label">%</span>
            </div>
            <input 
              :value="cameraZoomPercent" 
              type="range" 
              min="10" 
              max="500" 
              step="10" 
              class="scale-slider"
              @input="handleCameraZoomSliderChange" 
            >
          </template>
        </div>
        
        <!-- Scale ratio for non-camera objects -->
        <div
          v-if="!isCamera && localObject.type !== 'audio' && localObject.type !== 'light'"
          style="display: flex; flex-direction: column; gap: 8px;"
        >
          <div class="property-row">
            <div class="property-field" style="flex: 1">
              <label>Scale X:</label>
              <template v-if="isActionMode">
                <span class="readonly-value">{{ scalePercentX }}%</span>
              </template>
              <template v-else>
                <div class="scale-control">
                  <input 
                    v-model.number="scalePercentX" 
                    type="number" 
                    min="1" 
                    max="1000" 
                    step="1"
                    class="scale-input"
                    @change="handleScaleXInputChange" 
                  >
                  <span class="percent-label">%</span>
                </div>
              </template>
            </div>
            <button 
              v-if="!isActionMode"
              class="lock-btn" 
              style="background: none; border: none; cursor: pointer; padding: 0 4px; font-size: 14px; align-self: flex-end; margin-bottom: 6px; opacity: 0.8; height: 28px;"
              :title="scaleLocked ? 'Unlock Aspect Ratio' : 'Lock Aspect Ratio'"
              @click="toggleScaleLock"
            >
              {{ scaleLocked ? '🔗' : '🔓' }}
            </button>
            <div class="property-field" style="flex: 1">
              <label>Scale Y:</label>
              <template v-if="isActionMode">
                <span class="readonly-value">{{ scalePercentY }}%</span>
              </template>
              <template v-else>
                <div class="scale-control">
                  <input 
                    v-model.number="scalePercentY" 
                    type="number" 
                    min="1" 
                    max="1000" 
                    step="1"
                    class="scale-input"
                    @change="handleScaleYInputChange" 
                  >
                  <span class="percent-label">%</span>
                </div>
              </template>
            </div>
          </div>
        </div>
        
        <div
          v-if="!isCamera && localObject.type !== 'audio' && localObject.type !== 'light'"
          class="property-field"
        >
          <label>Rotation (deg):</label>
          <template v-if="isActionMode">
            <span class="readonly-value">{{ rotationDegrees }}</span>
          </template>
          <template v-else>
            <input
              v-model.number="rotationDegrees"
              type="number"
              step="1"
              @change="handleRotationChange"
            >
          </template>
        </div>
        
        <!-- Transform origin (pixel offset) -->
        <div
          v-if="!isCamera && localObject.type !== 'audio' && localObject.type !== 'light'"
          class="property-row"
        >
          <div class="property-field">
            <label>Pivot X:</label>
            <template v-if="isActionMode">
              <span class="readonly-value">{{ localObject.transformOriginX ?? 0 }}</span>
            </template>
            <template v-else>
              <input 
                :value="localObject.transformOriginX ?? 0" 
                type="number" 
                step="1"
                @change="handleTransformOriginXChange" 
              >
            </template>
          </div>
          <div class="property-field">
            <label>Pivot Y:</label>
            <template v-if="isActionMode">
              <span class="readonly-value">{{ localObject.transformOriginY ?? 0 }}</span>
            </template>
            <template v-else>
              <input 
                :value="localObject.transformOriginY ?? 0" 
                type="number" 
                step="1"
                @change="handleTransformOriginYChange" 
              >
            </template>
          </div>
        </div>
        
        <div
          v-if="!isCamera && localObject.type !== 'audio' && localObject.type !== 'light'"
          class="property-field"
        >
          <label>Opacity:</label>
          <input
            v-model.number="localObject.alpha"
            type="range"
            min="0"
            max="1"
            step="0.1"
            @change="handleUpdate"
          >
          <span class="value-label">{{ localObject.alpha.toFixed(1) }}</span>
        </div>
        
        <div
          v-if="!isCamera && localObject.type !== 'audio'"
          class="property-field"
        >
          <label>Z-Index:</label>
          <input
            v-model.number="localObject.zIndex"
            type="number"
            @change="handleZIndexChange"
          >
        </div>
        
        <!-- v9.2: Restore visible control (spawned separates lifecycle from visibility) -->
        <div
          v-if="!isCamera && localObject.type !== 'audio' && !isAmbientLight"
          class="property-field checkbox"
        >
          <label>
            <input
              :checked="localObject.visible"
              type="checkbox"
              @change="handleVisibleChange"
            >
            Visible
          </label>
        </div>

        <!-- flipX horizontal flip (generic for all visual objects) -->
        <div
          v-if="!isCamera && localObject.type !== 'audio' && localObject.type !== 'screen_effect' && localObject.type !== 'light'"
          class="property-field checkbox"
        >
          <label>
            <input
              :checked="localObject.flipX"
              type="checkbox"
              @change="handleFlipXChange"
            >
            Flip Horizontal
          </label>
        </div>

        <div
          v-if="showReceiveLighting"
          class="property-field checkbox"
        >
          <label>
            <input
              :checked="localObject.receiveLighting ?? true"
              type="checkbox"
              @change="handleReceiveLightingChange"
            >
            Receive Lighting
          </label>
        </div>

        <div
          v-if="showCastShadow"
          class="property-field checkbox"
        >
          <label>
            <input
              :checked="localObject.castShadow ?? false"
              type="checkbox"
              @change="handleCastShadowChange"
            >
            Cast Shadow
          </label>
        </div>

        <!-- P2: Child object affiliation hint (at end of basic properties section) -->
        <div
          v-if="parentComposite"
          class="parent-composite-hint"
        >
          <span class="hint-label">📎 Parent Composite:</span>
          <button
            class="hint-name hint-name-clickable"
            title="Click to select parent composite"
            @click="emit('selectObject', parentComposite!.id)"
          >
            📦 {{ parentComposite.alias ?? parentComposite.name ?? 'Composite' }}
          </button>
          <button
            class="remove-from-group-btn"
            :title="isActionMode ? 'Create structure change action' : 'Remove from composite'"
            @click="handleRemoveFromComposite"
          >
            {{ isActionMode ? '🎬 Remove' : '⤴ Remove' }}
          </button>
        </div>
      </div>
      

      <!-- Background specific properties (flipX moved to basic properties section) -->

      <!-- Prop specific properties (flipX moved to basic properties section) -->

      <!-- P2: Composite object specific properties -->
      <div
        v-if="localObject.type === 'composite'"
        class="property-section"
      >
        <h4>📦 Composite Properties</h4>
        
        <!-- compositeMode display (always read-only) -->
        <div class="property-field">
          <label>Composite Mode:</label>
          <span class="composite-mode-readonly">
            {{ (localObject as CompositeObject).compositeMode === 'entity' ? '📦 Entity' : '📎 Union' }}
          </span>
        </div>
        
        <!-- Child object list (manages add/delete) -->
        <div class="composite-children-list">
          <div class="children-header">
            <span>Child Objects ({{ compositeChildObjects.length }})</span>
            <button
              class="add-child-btn"
              :title="isActionMode ? 'Create structure change action to add member' : 'Add member to composite'"
              @click="handleAddMemberToComposite"
            >
              ➕
            </button>
          </div>
          <div
            v-for="child in compositeChildObjects"
            :key="child.id"
            class="child-item child-item-clickable"
            title="Click to select this child object"
            @click="emit('selectObject', child.id)"
          >
            <span class="child-icon">{{ getObjectIcon(child.type) }}</span>
            <span class="child-name">{{ child.alias ?? child.name ?? 'Untitled' }}</span>
            <button
              class="remove-child-btn"
              :title="isActionMode ? 'Create structure change action' : 'Remove from composite'"
              @click="handleRemoveChildFromComposite(child.id)"
            >
              {{ '⤴' }}
            </button>
          </div>
          <div v-if="compositeChildObjects.length === 0" class="empty-children">
            No child objects
          </div>
        </div>

        <!-- Render order list (entity only, controls render order) -->
        <div
          v-if="(localObject as CompositeObject).compositeMode === 'entity' && renderChainObjects.length > 0"
          class="composite-children-list render-chain-section"
          style="margin-top: 8px;"
        >
          <div class="children-header render-chain-header">
            <span>Render Order ({{ renderChainObjects.length }})</span>
            <div class="render-chain-controls">
              <button
                class="rc-move-btn"
                title="Move up (towards bottom layer)"
                :disabled="!canMoveUp"
                @click="handleRenderChainMoveUp(selectedRenderChainIndex)"
              >
                ↑
              </button>
              <button
                class="rc-move-btn"
                title="Move down (towards top layer)"
                :disabled="!canMoveDown"
                @click="handleRenderChainMoveDown(selectedRenderChainIndex)"
              >
                ↓
              </button>
            </div>
          </div>
          <div class="render-order-hint">
            ↑ Bottom Layer · ↓ Top Layer
          </div>
          <template v-for="(entry, displayIdx) in renderChainDisplay" :key="'rcd-' + displayIdx">
            <!-- zIndex grouping divider -->
            <div v-if="entry.type === 'divider'" class="zindex-divider">
              <span class="zindex-label">Z-Index {{ entry.zIndex }}</span>
            </div>
            <!-- Render chain item -->
            <div
              v-else
              class="child-item rc-item"
              :class="{
                'rc-selected': entry.obj.id === selectedRenderChainId,
                'rc-drag-over': rcDragOverIndex === entry.flatIndex,
              }"
              draggable="true"
              @click="selectedRenderChainId = entry.obj.id"
              @dragstart="onRcDragStart(entry.flatIndex, $event)"
              @dragover.prevent="onRcDragOver(entry.flatIndex)"
              @dragleave="onRcDragLeave"
              @drop.prevent="onRcDrop(entry.flatIndex)"
              @dragend="onRcDragEnd"
            >
              <span class="rc-drag-handle" title="Drag to reorder">⠿</span>
              <span class="child-icon">{{ getObjectIcon(entry.obj.type) }}</span>
              <span class="child-name">{{ entry.obj.alias ?? entry.obj.name ?? 'Untitled' }}</span>
            </div>
          </template>
        </div>


        
        <!-- Ungroup all button -->
        <div v-if="compositeChildObjects.length > 0" class="composite-actions">
          <button
            class="composite-action-btn danger"
            :title="isActionMode ? 'Create structure change action' : 'Ungroup composite, all child objects become standalone'"
            @click="handleUngroupAll"
          >
            🔓 Ungroup All
          </button>
        </div>
      </div>
      <!-- v16: Symbol material section -->
      <div
        v-if="localObject.type === 'symbol'"
        class="property-section"
      >
        <h4>🔧 Symbol Material</h4>

        <!-- Current material preview -->
        <div class="symbol-preview-area">
          <div class="symbol-preview-frame">
            <img
              v-if="currentMaterialPreviewUrl"
              :src="currentMaterialPreviewUrl"
              alt="Current material"
            >
            <div v-else class="symbol-preview-empty">
              <span>🖼️</span>
              <span>No material selected</span>
            </div>
          </div>
          <div class="symbol-preview-info">
            <div class="symbol-current-name">
              {{ symbolCurrentMaterialName }}
            </div>
            <div class="symbol-material-count">
              {{ symbolMaterials.length }} materials in total
            </div>
            <div
              v-if="symbolCurrentMaterialPath"
              class="symbol-material-path"
              :title="symbolCurrentMaterialPath"
            >
              📂 {{ symbolCurrentMaterialPath }}
            </div>
          </div>
        </div>

        <!-- Quick switch grid -->
        <div
          v-if="symbolMaterials.length > 1"
          class="symbol-switch-grid"
        >
          <div
            v-for="mat in symbolMaterials"
            :key="mat.id"
            class="symbol-switch-item"
            :class="{ active: mat.id === symbolCurrentMaterialId }"
            :title="mat.name"
            @click="handleSwitchMaterial(mat.id)"
          >
            <img
              v-if="getSymbolMaterialThumb(mat)"
              :src="getSymbolMaterialThumb(mat)!"
              alt=""
            >
            <span v-else class="switch-icon">🖼️</span>
            <span class="switch-name">{{ mat.name }}</span>
          </div>
        </div>
      </div>

      <!-- v18: Standalone expression object properties section -->
      <div
        v-if="localObject.type === 'expression'"
        class="property-section"
      >
        <h4>😀 Expression Reference</h4>

        <div
          class="expression-card"
          @click="showExpressionObjectDialog = true"
        >
          <div class="expression-card-thumb">
            <img
              v-if="expressionObjectInfo?.thumbnailUrl"
              :src="expressionObjectInfo.thumbnailUrl"
              alt="Current expression"
              :style="{ transform: expressionObjectInfo?.flipH ? 'scaleX(-1)' : 'none' }"
            >
            <div v-else class="symbol-preview-empty">
              <span>😶</span>
            </div>
          </div>
          <div class="expression-card-info">
            <div class="expression-card-name">
              {{ expressionObjectInfo?.name ?? 'Unknown Expression' }}
              <span
                v-if="!expressionIsModified"
                class="expression-default-badge"
                title="Default expression"
              >⭐</span>
            </div>
            <div class="expression-card-hint">Click to switch</div>
          </div>
          <div class="expression-card-action">
            🔄
          </div>
        </div>
        <!-- Reset to default / Set as default action links -->
        <div
          v-if="expressionIsModified"
          class="expression-default-actions"
        >
          <span
            class="expression-action-link restore"
            @click.stop="handleRestoreDefaultExpression"
          >↩️ Reset to Default</span>
          <span
            v-if="!isActionMode"
            class="expression-action-link set-default"
            @click.stop="handleSetDefaultExpression"
          >⭐ Set as Default</span>
        </div>

        <!-- Edit expression asset -->
        <button
          class="btn-add-playlist"
          style="margin-top: 8px"
          @click="openExpressionEditor"
        >
          ✏️ Edit Expression Asset
        </button>
      </div>

      <!-- Effect specific properties -->
      <div
        v-if="localObject.type === 'screen_effect'"
        class="property-section"
      >
        <h4>🌟 Effect Parameters</h4>

        <!-- Basic overlay -->
        <div class="property-field">
          <label>Mask Color:</label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <input
              :value="(localObject as ScreenEffectObject).params.baseColor ?? '#000000'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleScreenEffectParamChange('baseColor', ($event.target as HTMLInputElement).value)"
            >
            <span class="value-label">{{ (localObject as ScreenEffectObject).params.baseColor ?? '#000000' }}</span>
          </div>
        </div>

        <!-- Overlay opacity removed, controlled uniformly by 'Opacity' slider (alpha) in basic properties -->

        <!-- Hole shape (if any) -->
        <template v-if="(localObject as ScreenEffectObject).params.holeShape">
          <div class="property-field">
            <label>Hole Shape:</label>
            <select
              :value="(localObject as ScreenEffectObject).params.holeShape"
              @change="handleScreenEffectParamChange('holeShape', ($event.target as HTMLSelectElement).value)"
            >
              <option value="circle">Circle</option>
              <option value="horizontal_ellipse">Horizontal Ellipse</option>
              <option value="vertical_ellipse">Vertical Ellipse</option>
              <option value="rectangle">Rectangle</option>
            </select>
          </div>

          <div class="property-row">
            <div class="property-field">
              <label>Hole Width:</label>
              <input
                :value="(localObject as ScreenEffectObject).params.holeWidth ?? 600"
                type="number"
                min="10"
                max="3840"
                step="10"
                @change="handleScreenEffectParamChange('holeWidth', parseFloat(($event.target as HTMLInputElement).value))"
              >
            </div>
            <div class="property-field">
              <label>Hole Height:</label>
              <input
                :value="(localObject as ScreenEffectObject).params.holeHeight ?? 600"
                type="number"
                min="10"
                max="2160"
                step="10"
                @change="handleScreenEffectParamChange('holeHeight', parseFloat(($event.target as HTMLInputElement).value))"
              >
            </div>
          </div>

          <div class="property-field">
            <label>Hole Ratio:</label>
            <input
              :value="(localObject as ScreenEffectObject).params.openRatio ?? 1.0"
              type="range"
              min="0"
              max="1"
              step="0.01"
              @input="handleScreenEffectParamChange('openRatio', parseFloat(($event.target as HTMLInputElement).value))"
            >
            <span class="value-label">{{ Math.round(((localObject as ScreenEffectObject).params.openRatio ?? 1) * 100) }}%</span>
          </div>


        </template>



      </div>

      <!-- Audio specific properties -->
      <div
        v-if="localObject.type === 'audio'"
        class="property-section"
      >
        <h4>Audio Properties</h4>
        
        <!-- Preview button -->
        <div class="property-field">
          <button 
            class="preview-audio-btn" 
            :class="{ playing: isAudioPreviewing }"
            @click="handleAudioPreview"
          >
            <span class="btn-icon">{{ isAudioPreviewing ? '⏸' : '▶' }}</span>
            <span class="btn-label">{{ isAudioPreviewing ? 'Stop Preview' : 'Preview' }}</span>
          </button>
        </div>

        <!-- Setup mode -->
        <template v-if="!isActionMode">
          <div class="anim-default-item">
            <div class="anim-part-header">
              <span class="anim-part-name">Default Behavior</span>
            </div>
            
            <div class="anim-default-options">
              <label
                class="anim-option"
                :class="{ active: (localObject as AudioObject).playbackState === 'play' }"
              >
                <input 
                  type="radio" 
                  name="audio-default-state" 
                  value="play" 
                  :checked="(localObject as AudioObject).playbackState === 'play'"
                  @change="updateAudioPlaybackState('play')"
                >
                <span class="option-icon">▶</span>
                <span class="option-label">Play by Default</span>
              </label>
              <label
                class="anim-option"
                :class="{ active: (localObject as AudioObject).playbackState === 'stop' }"
              >
                <input 
                  type="radio" 
                  name="audio-default-state" 
                  value="stop" 
                  :checked="(localObject as AudioObject).playbackState === 'stop'"
                  @change="updateAudioPlaybackState('stop')"
                >
                <span class="option-icon">⏹</span>
                <span class="option-label">Stop by Default</span>
              </label>
            </div>

            <div
              class="anim-action-extras-column"
              style="border-top: 1px dashed #e5e7eb; padding-top: 8px; margin-top: 8px;"
            >
              <div class="property-field checkbox">
                <label>
                  <input 
                    v-model="(localObject as AudioObject).loop" 
                    type="checkbox" 
                    @change="handleUpdate"
                  >
                  Loop Playback
                </label>
              </div>

              <div class="property-field">
                <label>Volume: {{ Math.round(((localObject as AudioObject).volume ?? 1.0) * 100) }}%</label>
                <input 
                  v-model.number="(localObject as AudioObject).volume" 
                  type="range" 
                  min="0" 
                  :max="1" 
                  step="0.05" 
                  @change="handleUpdate" 
                >
              </div>

              <div class="property-row">
                <div class="property-field">
                  <label>Fade In (s):</label>
                  <input 
                    v-model.number="(localObject as AudioObject).fadeIn" 
                    type="number" 
                    min="0" 
                    step="0.1" 
                    @change="handleUpdate" 
                  >
                </div>
                <div class="property-field">
                  <label>Fade Out (s):</label>
                  <input 
                    v-model.number="(localObject as AudioObject).fadeOut" 
                    type="number" 
                    min="0" 
                    step="0.1" 
                    @change="handleUpdate" 
                  >
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Action Mode: Playback controls and properties -->
        <template v-else>
          <div class="anim-action-item">
            <div class="anim-action-header">
              <span class="anim-part-name">Audio Action</span>
            </div>

            <div class="anim-action-options">
              <button 
                class="action-option-btn play"
                :class="{ selected: getAudioActionState() === 'play' }"
                title="Create play action"
                @click="handleAudioAction('play')"
              >
                <span class="btn-icon">▶</span>
                <span class="btn-label">Play</span>
              </button>
              <button 
                class="action-option-btn stop"
                :class="{ selected: getAudioActionState() === 'stop' }"
                title="Create stop action"
                @click="handleAudioAction('stop')"
              >
                <span class="btn-icon">⏹</span>
                <span class="btn-label">Stop</span>
              </button>
            </div>

            <div
              class="anim-action-extras-column"
              style="border-top: 1px dashed #e5e7eb; padding-top: 8px; margin-top: 8px;"
            >
              <div class="property-field checkbox">
                <label>
                  <input 
                    :checked="getAudioActionLoop()" 
                    type="checkbox" 
                    @change="updateAudioActionParam('loop', ($event.target as HTMLInputElement).checked)"
                  >
                  Loop Playback
                </label>
              </div>

              <div class="property-field">
                <label>Volume: {{ Math.round(getAudioActionVolume() * 100) }}%</label>
                <input 
                  :value="getAudioActionVolume()"
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.05" 
                  @input="updateAudioActionParam('volume', parseFloat(($event.target as HTMLInputElement).value))" 
                >
              </div>

              <div class="property-row">
                <div class="property-field">
                  <label>Fade In (s):</label>
                  <input 
                    :value="getAudioActionParam('fadeIn')"
                    type="number" 
                    min="0" 
                    step="0.1" 
                    @change="updateAudioActionParam('fadeIn', parseFloat(($event.target as HTMLInputElement).value))" 
                  >
                </div>
                <div class="property-field">
                  <label>Fade Out (s):</label>
                  <input 
                    :value="getAudioActionParam('fadeOut')"
                    type="number" 
                    min="0" 
                    step="0.1" 
                    @change="updateAudioActionParam('fadeOut', parseFloat(($event.target as HTMLInputElement).value))" 
                  >
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 💡 Light properties -->
      <div
        v-if="localObject.type === 'light'"
        class="property-section"
      >
        <h4>💡 Light Properties</h4>

        <!-- Light type (read-only) -->
        <div class="property-field">
          <label>Light Type:</label>
          <span class="composite-mode-readonly">
            {{
              (localObject as LightObject).lightType === 'ambient'
                ? '🌍 Ambient Light'
                : (localObject as LightObject).lightType === 'spot'
                  ? '🔦 Spotlight'
                  : '💡 Point Light'
            }}
          </span>
        </div>

        <!-- Ambient light presets -->
        <div
          v-if="(localObject as LightObject).lightType === 'ambient'"
          class="property-field"
        >
          <label>Preset:</label>
          <div class="ambient-preset-grid">
            <button
              v-for="preset in AMBIENT_LIGHT_PRESETS"
              :key="preset.id"
              class="ambient-preset-btn"
              :title="`${preset.label} (${preset.color}, ${Math.round(preset.intensity * 100)}%)`"
              @click="handleAmbientPreset(preset)"
            >
              <span
                class="preset-color-dot"
                :style="{ background: preset.color }"
              />
              <span class="preset-label">{{ preset.label }}</span>
            </button>
          </div>
        </div>

        <!-- Point / Spotlight presets -->
        <div
          v-if="(localObject as LightObject).lightType !== 'ambient'"
          class="property-field"
        >
          <label>Preset:</label>
          <div class="ambient-preset-grid">
            <button
              v-for="preset in currentLightPresets"
              :key="preset.id"
              class="ambient-preset-btn"
              :title="`${preset.label} — ${preset.description}`"
              @click="handleLightPresetApply(preset)"
            >
              <span
                class="preset-color-dot"
                :style="{ background: preset.params.lightColor }"
              />
              <span class="preset-label">{{ preset.label }}</span>
            </button>
          </div>
        </div>

        <div class="property-field">
          <label>Color:</label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <input
              :value="(localObject as LightObject).lightColor ?? '#ffffff'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleLightParamChange('lightColor', ($event.target as HTMLInputElement).value)"
            >
            <span class="value-label">{{ (localObject as LightObject).lightColor ?? '#ffffff' }}</span>
          </div>
        </div>

        <div class="property-field">
          <label>Intensity: {{ ((localObject as LightObject).lightIntensity ?? 1.0).toFixed(2) }}</label>
          <input
            :value="(localObject as LightObject).lightIntensity ?? 1.0"
            type="range"
            min="0"
            max="3"
            step="0.05"
            @input="handleLightParamChange('lightIntensity', parseFloat(($event.target as HTMLInputElement).value))"
          >
        </div>

        <div
          v-if="(localObject as LightObject).lightType !== 'ambient'"
          class="property-field"
        >
          <label>Radius: {{ Math.round((localObject as LightObject).lightRadius ?? 500) }}</label>
          <input
            :value="(localObject as LightObject).lightRadius ?? 500"
            type="range"
            min="50"
            max="3000"
            step="10"
            @input="handleLightParamChange('lightRadius', parseFloat(($event.target as HTMLInputElement).value))"
          >
        </div>

        <!-- Flicker parameters (non-ambient) -->
        <template v-if="(localObject as LightObject).lightType !== 'ambient'">
          <div class="property-field">
            <label>Flicker Intensity: {{ ((localObject as LightObject).flicker ?? 0).toFixed(2) }}</label>
            <input
              :value="(localObject as LightObject).flicker ?? 0"
              type="range"
              min="0"
              max="1"
              step="0.05"
              @input="handleLightParamChange('flicker', parseFloat(($event.target as HTMLInputElement).value))"
            >
          </div>
          <div class="property-field">
            <label>Flicker Speed: {{ ((localObject as LightObject).flickerSpeed ?? 0.35).toFixed(2) }}</label>
            <input
              :value="(localObject as LightObject).flickerSpeed ?? 0.35"
              type="range"
              min="0"
              max="1"
              step="0.05"
              @input="handleLightParamChange('flickerSpeed', parseFloat(($event.target as HTMLInputElement).value))"
            >
          </div>
        </template>

        <!-- Spotlight direction parameters -->
        <template v-if="(localObject as LightObject).lightType === 'spot'">
          <div class="property-field">
            <label>Direction Angle: {{ Math.round(((localObject as LightObject).directionAngle ?? 0) * 180 / Math.PI) }}°</label>
            <input
              :value="(localObject as LightObject).directionAngle ?? 0"
              type="range"
              :min="-Math.PI"
              :max="Math.PI"
              step="0.01"
              @input="handleLightParamChange('directionAngle', parseFloat(($event.target as HTMLInputElement).value))"
            >
          </div>
          <div class="property-field">
            <label>Cone Angle: {{ Math.round((localObject as LightObject).coneAngle ?? 100) }}°</label>
            <input
              :value="(localObject as LightObject).coneAngle ?? 100"
              type="range"
              min="10"
              max="360"
              step="5"
              @input="handleLightParamChange('coneAngle', parseFloat(($event.target as HTMLInputElement).value))"
            >
          </div>
        </template>
      </div>

      <!-- Camera console (Action Mode only) -->
      <div
        v-if="isCamera && isActionMode"
        class="property-section"
      >
        <h4>🎥 Camera Console</h4>
        
        <!-- Slot indicator -->
        <div class="slot-indicator-row">
          <span class="slot-badge">#{{ (currentSlotIndex ?? 0) + 1 }}</span>
          <span class="slot-text">{{ currentSlotText ? truncateText(currentSlotText, 20) : 'Current Slot' }}</span>
        </div>
        
        <!-- Segmented Control: Action type toggle -->
        <div class="camera-console">
          <div class="console-label">
            Action Type:
          </div>
          <div class="camera-mode-tabs">
            <button 
              class="camera-mode-btn" 
              :class="{ active: currentCameraActionType === 'camera_cut', disabled: isExclusiveButtonDisabled('camera_cut') }"
              :disabled="isExclusiveButtonDisabled('camera_cut')"
              :title="isExclusiveButtonDisabled('camera_cut') ? 'Another camera action already exists in this slot' : 'Camera Cut - Instant camera switch'"
              @click="handleCameraTypeSelect('camera_cut')"
            >
              ✂️ Cut
            </button>
            <button 
              class="camera-mode-btn" 
              :class="{ active: currentCameraActionType === 'camera_move', disabled: isExclusiveButtonDisabled('camera_move') }"
              :disabled="isExclusiveButtonDisabled('camera_move')"
              :title="isExclusiveButtonDisabled('camera_move') ? 'Another camera action already exists in this slot' : 'Camera Move - Smooth move to target'"
              @click="handleCameraTypeSelect('camera_move')"
            >
              🎬 Move
            </button>
            <button 
              class="camera-mode-btn" 
              :class="{ active: currentCameraActionType === 'camera_follow', disabled: isExclusiveButtonDisabled('camera_follow') }"
              :disabled="isExclusiveButtonDisabled('camera_follow')"
              :title="isExclusiveButtonDisabled('camera_follow') ? 'Another camera action already exists in this slot' : 'Follow - Follow target object'"
              @click="handleCameraTypeSelect('camera_follow')"
            >
              🎯 Follow
            </button>
            <button 
              class="camera-mode-btn" 
              :class="{ active: isShakeActive }"
              title="Shake - Camera shake effect (can coexist with other actions)"
              @click="handleCameraTypeSelect('camera_shake')"
            >
              💥 Shake
            </button>
          </div>
        </div>

        <!-- Hint: Click action type button to display action properties on the right -->
        <div class="camera-mode-hint">
          <span class="hint-icon">💡</span>
          <span>Click action type button to enter action adding mode</span>
        </div>
      </div>


      <!-- v16 H1: Animation default state settings (grouped display) -->
      <div
        v-if="!isActionMode && resourceAnimations.length > 0"
        class="property-section"
      >
        <h4>Animation Default State</h4>

        <!-- Resource animation group -->
        <div v-if="resourceOriginAnimations.length > 0" class="anim-group">
          <div class="anim-group-header">
            <span class="anim-group-label">📦 Resource Animations</span>
            <button
              class="btn-reapply"
              title="Reapply animation definitions from resource"
              @click="handleReapplyResourceAnimations"
            >
              🔄 Reapply
            </button>
          </div>
        </div>

        <!-- Instance animation group title -->
        <div v-if="instanceAnimations.length > 0 && resourceOriginAnimations.length > 0" class="anim-group">
          <div class="anim-group-header">
            <span class="anim-group-label">✏️ Instance Animations</span>
          </div>
        </div>

        <div class="anim-default-hint">
          <span class="hint-icon">ℹ️</span>
          <span class="hint-text">Set animation default state at scene start; these settings will be saved to scene data</span>
        </div>
        <div
          v-for="anim in resourceAnimations"
          :key="anim.id"
          class="anim-default-item"
        >
          <div class="anim-part-header">
            <span class="anim-part-name">{{ anim.name }}</span>
          </div>
          <!-- Play/Stop state -->
          <div class="anim-default-options">
            <label
              class="anim-option"
              :class="{ active: getAnimDefaultState(anim.name) === 'play' }"
            >
              <input 
                type="radio" 
                :name="'anim-default-' + anim.id" 
                value="play" 
                :checked="getAnimDefaultState(anim.name) === 'play'"
                @change="setAnimDefaultState(anim.name, 'play')"
              >
              <span class="option-icon">▶</span>
              <span class="option-label">Play by Default</span>
            </label>
            <label
              class="anim-option"
              :class="{ active: getAnimDefaultState(anim.name) === 'stop' }"
            >
              <input 
                type="radio" 
                :name="'anim-default-' + anim.id" 
                value="stop" 
                :checked="getAnimDefaultState(anim.name) === 'stop'"
                @change="setAnimDefaultState(anim.name, 'stop')"
              >
              <span class="option-icon">⏹</span>
              <span class="option-label">Stop by Default</span>
            </label>
          </div>
          <!-- Loop settings (v11.3: speed removed, loop only) -->
          <div class="anim-extra-settings">
            <label class="anim-loop-option">
              <input 
                type="checkbox" 
                :checked="getAnimLoop(anim.name)"
                @change="setAnimLoop(anim.name, ($event.target as HTMLInputElement).checked)"
              >
              <span>Loop Playback</span>
            </label>
          </div>
        </div>
      </div>



      <!-- v11.2: Old prop animation control area deleted, using resourceAnimations uniformly -->

      <!-- Effect animation default state settings (Setup mode only) -->

      <!-- Animation action recording in Action Mode (v11.1: using resource-level Animation) -->
      <div
        v-if="isActionMode && resourceAnimations.length > 0"
        class="property-section"
      >
        <h4>🎬 Animation Actions</h4>
        <div class="action-record-hint">
          <span class="hint-icon">📢</span>
          <span class="hint-text">Create animation action at current slot <strong>#{{ (currentSlotIndex ?? 0) + 1 }}</strong></span>
        </div>
        <div
          v-for="anim in resourceAnimations"
          :key="anim.id"
          class="anim-action-item"
        >
          <div class="anim-action-header">
            <span class="anim-part-name">{{ anim.name }}</span>
          </div>
          <!-- Play/Stop action -->
          <div class="anim-action-options">
            <button 
              class="action-option-btn play"
              :class="{ selected: getResourceAnimState(anim.name) === 'play' }"
              title="Create play action"
              @click="handleResourceAnimAction(anim.name, 'play')"
            >
              <span class="btn-icon">▶</span>
              <span class="btn-label">Play</span>
            </button>
            <button 
              class="action-option-btn stop"
              :class="{ selected: getResourceAnimState(anim.name) === 'stop' }"
              title="Create stop action"
              @click="handleResourceAnimAction(anim.name, 'stop')"
            >
              <span class="btn-icon">⏹</span>
              <span class="btn-label">Stop</span>
            </button>
          </div>
          <!-- Loop setting -->
          <div class="anim-action-extras">
            <label class="action-loop-option">
              <input 
                type="checkbox" 
                :checked="getResourceAnimLoop(anim.name)"
                @change="handleResourceAnimLoopChange(anim.name, ($event.target as HTMLInputElement).checked)"
              >
              <span>Loop</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 📝 Text properties -->
      <div
        v-if="localObject.type === 'text'"
        class="property-section"
      >
        <h4>📝 Text Properties</h4>

        <!-- Text content -->
        <div class="property-field">
          <label>Content:</label>
          <textarea
            :value="(localObject as any).content ?? ''"
            rows="3"
            class="text-content-input"
            @input="handleTextPropertyChange('content', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <!-- Font selection (online presets + system font enumeration) -->
        <div class="property-field">
          <label>Font:</label>
          <select
            :value="(localObject as any).fontFamily ?? 'Noto Sans SC'"
            class="font-select"
            @change="handleTextPropertyChange('fontFamily', ($event.target as HTMLSelectElement).value)"
          >
            <optgroup label="☁️ Online Fonts">
              <option value="Noto Sans SC">Noto Sans SC (Source Han Sans)</option>
              <option value="Noto Serif SC">Noto Serif SC (Source Han Serif)</option>
              <option value="LXGW WenKai">LXGW WenKai</option>
              <option value="ZCOOL QingKe HuangYou">ZCOOL QingKe HuangYou</option>
              <option value="Ma Shan Zheng">Ma Shan Zheng</option>
            </optgroup>
            <optgroup v-if="localFonts.length > 0" label="💻 Local Fonts">
              <option v-for="font in localFonts" :key="font" :value="font">{{ font }}</option>
            </optgroup>
          </select>
          <button
            v-if="!localFontsLoaded"
            class="load-fonts-btn"
            title="Load local font list (requires browser permission)"
            @click="loadLocalFonts"
          >
            🔍 Load Local Fonts
          </button>
        </div>

        <!-- Font size -->
        <div class="property-field">
          <label>Font Size:</label>
          <select
            :value="fontSizePresetMatch"
            @change="handleFontSizeSelectChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="size in FONT_SIZE_PRESETS" :key="size" :value="size">{{ size }}</option>
            <option
              v-if="!FONT_SIZE_PRESETS.includes(currentFontSize)"
              :value="currentFontSize"
            >
              {{ currentFontSize }} (Custom)
            </option>
          </select>
        </div>

        <!-- Color -->
        <div class="property-field">
          <label>Color:</label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <input
              :value="(localObject as any).color ?? '#ffffff'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleTextPropertyChange('color', ($event.target as HTMLInputElement).value)"
            >
            <span class="value-label">{{ (localObject as any).color ?? '#ffffff' }}</span>
          </div>
        </div>
        <div class="property-field">
          <label>Gradient:</label>
          <select
            :value="(localObject as any).fillType ?? ''"
            class="font-select"
            @change="handleTextPropertyChange('fillType', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Disabled</option>
            <option value="linear_gradient">Linear Gradient</option>
          </select>
        </div>
        <template v-if="(localObject as any).fillType === 'linear_gradient'">
          <div class="property-field">
            <label>Start Color:</label>
            <input
              :value="(localObject as any).gradientStops?.[0]?.color ?? '#ffffff'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleGradientStopChange(0, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="property-field">
            <label>End Color:</label>
            <input
              :value="(localObject as any).gradientStops?.[1]?.color ?? '#000000'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleGradientStopChange(1, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="property-field">
            <label>Angle°:</label>
            <input
              :value="(localObject as any).gradientAngle ?? 0"
              type="number"
              min="0"
              max="360"
              step="15"
              @change="handleTextPropertyChange('gradientAngle', Number(($event.target as HTMLInputElement).value))"
            >
          </div>
        </template>

        <!-- Alignment -->
        <div class="property-field">
          <label>Align:</label>
          <div class="text-align-group">
            <button
              class="text-align-btn"
              :class="{ active: (localObject as any).align === 'left' }"
              title="Align Left"
              @click="handleTextPropertyChange('align', 'left')"
            >
              ◧
            </button>
            <button
              class="text-align-btn"
              :class="{ active: (localObject as any).align === 'center' || !(localObject as any).align }"
              title="Center"
              @click="handleTextPropertyChange('align', 'center')"
            >
              ☰
            </button>
            <button
              class="text-align-btn"
              :class="{ active: (localObject as any).align === 'right' }"
              title="Align Right"
              @click="handleTextPropertyChange('align', 'right')"
            >
              ◨
            </button>
          </div>
        </div>

        <!-- Font weight and style -->
        <div class="property-row">
          <div class="property-field checkbox">
            <label>
              <input
                :checked="(localObject as any).fontWeight === 'bold'"
                type="checkbox"
                @change="handleTextPropertyChange('fontWeight', ($event.target as HTMLInputElement).checked ? 'bold' : 'normal')"
              >
              <b>Bold</b>
            </label>
          </div>
          <div class="property-field checkbox">
            <label>
              <input
                :checked="(localObject as any).fontStyle === 'italic'"
                type="checkbox"
                @change="handleTextPropertyChange('fontStyle', ($event.target as HTMLInputElement).checked ? 'italic' : 'normal')"
              >
              <i>Italic</i>
            </label>
          </div>
        </div>

        <!-- Auto-wrap toggle -->
        <div
          v-if="(localObject as any).textBoxMode !== 'auto-width' && (localObject as any).textBoxMode !== 'auto-size'"
          class="property-field checkbox"
        >
          <label>
            <input
              :checked="(localObject as any).wordWrap !== false"
              type="checkbox"
              @change="handleTextPropertyChange('wordWrap', ($event.target as HTMLInputElement).checked)"
            >
            Auto Wrap
          </label>
        </div>

        <!-- Auto-wrap width -->
        <div
          v-if="(localObject as any).textBoxMode !== 'auto-width' && (localObject as any).textBoxMode !== 'auto-size' && (localObject as any).wordWrap !== false"
          class="property-field"
        >
          <label>Wrap Width:</label>
          <input
            :value="(localObject as any).wordWrapWidth ?? 400"
            type="number"
            min="50"
            max="3840"
            step="10"
            @change="handleTextPropertyChange('wordWrapWidth', Number(($event.target as HTMLInputElement).value))"
          >
        </div>

        <!-- ═══════ Phase 1: Stroke ═══════ -->
        <div class="sub-section-heading">Text Stroke</div>
        <div class="property-field">
          <label>Color:</label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <input
              :value="(localObject as any).stroke ?? '#000000'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleTextPropertyChange('stroke', ($event.target as HTMLInputElement).value)"
            >
            <span class="value-label">{{ (localObject as any).stroke ?? 'None' }}</span>
          </div>
        </div>
        <div class="property-field">
          <label>Thickness:</label>
          <input
            :value="(localObject as any).strokeThickness ?? 0"
            type="range"
            min="0"
            max="20"
            step="1"
            style="flex: 1;"
            @input="handleTextPropertyChange('strokeThickness', Number(($event.target as HTMLInputElement).value))"
          >
          <span class="value-label" style="min-width: 28px; text-align: right;">{{ (localObject as any).strokeThickness ?? 0 }}</span>
        </div>

        <!-- ═══════ Phase 1: Shadow ═══════ -->
        <div class="sub-section-heading">Drop Shadow</div>
        <div class="property-field checkbox">
          <label>
            <input
              :checked="(localObject as any).dropShadow ?? false"
              type="checkbox"
              @change="handleTextPropertyChange('dropShadow', ($event.target as HTMLInputElement).checked ? true : false)"
            >
            Enable Shadow
          </label>
        </div>
        <template v-if="(localObject as any).dropShadow">
          <div class="property-field">
            <label>Color:</label>
            <input
              :value="(localObject as any).dropShadowColor ?? '#000000'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleTextPropertyChange('dropShadowColor', ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="property-field">
            <label>Blur:</label>
            <input
              :value="(localObject as any).dropShadowBlur ?? 4"
              type="range"
              min="0"
              max="20"
              step="1"
              style="flex: 1;"
              @input="handleTextPropertyChange('dropShadowBlur', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="value-label" style="min-width: 28px; text-align: right;">{{ (localObject as any).dropShadowBlur ?? 4 }}</span>
          </div>
          <div class="property-field">
            <label>Distance:</label>
            <input
              :value="(localObject as any).dropShadowDistance ?? 4"
              type="range"
              min="0"
              max="20"
              step="1"
              style="flex: 1;"
              @input="handleTextPropertyChange('dropShadowDistance', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="value-label" style="min-width: 28px; text-align: right;">{{ (localObject as any).dropShadowDistance ?? 4 }}</span>
          </div>
          <div class="property-field">
            <label>Angle°:</label>
            <input
              :value="Math.round(((localObject as any).dropShadowAngle ?? 0.785) * 180 / Math.PI)"
              type="number"
              min="0"
              max="360"
              step="15"
              @change="handleTextPropertyChange('dropShadowAngle', Number(($event.target as HTMLInputElement).value) * Math.PI / 180)"
            >
          </div>
        </template>

        <!-- ═══════ Phase 1: Spacing ═══════ -->
        <div class="sub-section-heading">Typography</div>
        <div class="property-field">
          <label>Letter Spacing:</label>
          <select
            :value="letterSpacingPresetMatch"
            @change="handleLetterSpacingSelectChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="spacing in LETTER_SPACING_PRESETS" :key="spacing" :value="spacing">{{ spacing }}</option>
            <option
              v-if="!LETTER_SPACING_PRESETS.includes(currentLetterSpacing)"
              :value="currentLetterSpacing"
            >
              {{ currentLetterSpacing }} (Custom)
            </option>
          </select>
        </div>
        <div class="property-field">
          <label>Line Height:</label>
          <select
            :value="lineHeightPresetMatch"
            @change="handleLineHeightSelectChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="">Auto</option>
            <option v-for="lh in LINE_HEIGHT_PRESETS" :key="lh" :value="lh">{{ lh }}</option>
            <option
              v-if="currentLineHeight !== '' && !LINE_HEIGHT_PRESETS.includes(Number(currentLineHeight))"
              :value="currentLineHeight"
            >
              {{ currentLineHeight }} (Custom)
            </option>
          </select>
        </div>

        <!-- Text box mode -->
        <div class="property-field">
          <label>Text Box:</label>
          <select
            :value="(localObject as any).textBoxMode ?? 'auto-size'"
            class="font-select"
            @change="handleTextPropertyChange('textBoxMode', ($event.target as HTMLSelectElement).value)"
          >
            <option value="auto-width">Auto Width</option>
            <option value="auto-height">Auto Height</option>
            <option value="auto-size">Auto Size</option>
            <option value="fixed">Fixed Size</option>
          </select>
        </div>

        <!-- Writing direction -->
        <div class="property-field">
          <label>Direction:</label>
          <div class="text-align-group">
            <button
              class="text-align-btn"
              :class="{ active: (localObject as any).writingMode !== 'vertical' }"
              title="Horizontal"
              @click="handleTextPropertyChange('writingMode', 'horizontal')"
            >
              Horiz
            </button>
            <button
              class="text-align-btn"
              :class="{ active: (localObject as any).writingMode === 'vertical' }"
              title="Vertical"
              @click="handleTextPropertyChange('writingMode', 'vertical')"
            >
              Vert
            </button>
          </div>
        </div>

        <div class="sub-section-heading">Text Box Background</div>
        <div class="property-field checkbox">
          <label>
            <input
              :checked="(localObject as any).textBackgroundEnabled === true"
              type="checkbox"
              @change="handleTextPropertyChange('textBackgroundEnabled', ($event.target as HTMLInputElement).checked)"
            >
            Enable Background Fill
          </label>
        </div>
        <template v-if="(localObject as any).textBackgroundEnabled === true">
          <div class="property-field">
            <label>Color:</label>
            <input
              :value="(localObject as any).textBackgroundColor ?? '#000000'"
              type="color"
              style="width: 28px; height: 28px; padding: 0; border: 1px solid #d1d5db; border-radius: 4px;"
              @input="handleTextPropertyChange('textBackgroundColor', ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="property-field">
            <label>Opacity:</label>
            <input
              :value="Math.round((((localObject as any).textBackgroundAlpha ?? 0.35) * 100))"
              type="range"
              min="0"
              max="100"
              step="1"
              style="flex: 1;"
              @input="handleTextPropertyChange('textBackgroundAlpha', Number(($event.target as HTMLInputElement).value) / 100)"
            >
            <span class="value-label" style="min-width: 36px; text-align: right;">{{ Math.round((((localObject as any).textBackgroundAlpha ?? 0.35) * 100)) }}%</span>
          </div>
          <div class="property-field">
            <label>Padding X:</label>
            <input
              :value="(localObject as any).textBackgroundPaddingX ?? 16"
              type="number"
              min="0"
              max="200"
              step="1"
              @change="handleTextPropertyChange('textBackgroundPaddingX', Number(($event.target as HTMLInputElement).value))"
            >
          </div>
          <div class="property-field">
            <label>Padding Y:</label>
            <input
              :value="(localObject as any).textBackgroundPaddingY ?? 10"
              type="number"
              min="0"
              max="200"
              step="1"
              @change="handleTextPropertyChange('textBackgroundPaddingY', Number(($event.target as HTMLInputElement).value))"
            >
          </div>
          <div class="property-field">
            <label>Corner Radius:</label>
            <input
              :value="(localObject as any).textBackgroundRadius ?? 8"
              type="number"
              min="0"
              max="200"
              step="1"
              @change="handleTextPropertyChange('textBackgroundRadius', Number(($event.target as HTMLInputElement).value))"
            >
          </div>
        </template>

        <!-- ═══════ Text Animation ═══════ -->
        <div class="sub-section-heading">Text Animation</div>
        <div class="property-field">
          <label>Typing Speed:</label>
          <input
            :value="(localObject as any).revealSpeed ?? 8"
            type="number"
            min="0.5"
            max="60"
            step="0.5"
            @change="handleTextPropertyChange('revealSpeed', Number(($event.target as HTMLInputElement).value))"
          >
          <span class="value-label">chars/s</span>
        </div>
        <div
          v-if="!isActionMode"
          class="anim-default-item text-reveal-default-card"
        >
          <div class="anim-part-header">
            <span class="anim-part-name">Default Display Mode</span>
          </div>
          <div class="anim-default-options">
            <label
              class="anim-option text-reveal-start-option"
              :class="{ active: (localObject as any).revealInitialState === 'typewriter' }"
            >
              <input
                type="radio"
                name="text-reveal-initial-state"
                value="typewriter"
                :checked="(localObject as any).revealInitialState === 'typewriter'"
                @change="updateTextRevealInitialState('typewriter')"
              >
              <span class="option-icon">⌨</span>
              <span class="option-label">Typewriter on Start</span>
            </label>
            <label
              class="anim-option text-reveal-complete-option"
              :class="{ active: ((localObject as any).revealInitialState ?? 'complete') === 'complete' }"
            >
              <input
                type="radio"
                name="text-reveal-initial-state"
                value="complete"
                :checked="((localObject as any).revealInitialState ?? 'complete') === 'complete'"
                @change="updateTextRevealInitialState('complete')"
              >
              <span class="option-icon">▣</span>
              <span class="option-label">Full Text</span>
            </label>
          </div>
        </div>
        <div
          v-if="isActionMode"
          class="anim-action-item text-reveal-action-card"
        >
          <div class="anim-action-header">
            <span class="anim-part-name">Typewriter Action</span>
          </div>
          <div class="anim-action-options">
            <button
              class="action-option-btn text-reveal-start"
              :class="{ selected: getTextRevealActionState() === 'play' }"
              title="Create start typing action at current slot"
              @click="handleTextRevealAction('play')"
            >
              <span class="btn-icon">⌨</span>
              <span class="btn-label">Start Typing</span>
            </button>
            <button
              class="action-option-btn text-reveal-complete"
              :class="{ selected: getTextRevealActionState() === 'stop' }"
              title="Create show full text action at current slot"
              @click="handleTextRevealAction('stop')"
            >
              <span class="btn-icon">▣</span>
              <span class="btn-label">Show Full Text</span>
            </button>
          </div>
        </div>

      </div>

      <!-- ▭ Mask properties -->
      <template v-if="localObject && localObject.type === 'mask'">
        <MaskShapeSection
          :mask="(localObject as MaskObject)"
          @change="handleMaskChange"
        />
        <MaskTargetsSection
          :mask="(localObject as MaskObject)"
          @change="handleMaskChange"
        />
      </template>

      <!-- Action buttons area (common for Setup + Action) -->
      <div
        v-if="localObject && (localObject.type === 'prop' || localObject.type === 'background' || localObject.type === 'audio' || localObject.type === 'symbol' || localObject.type === 'composite' || localObject.type === 'expression')"
        class="property-section anim-actions-section"
      >
        <!-- Animation management (prop/background/symbol/composite) -->
        <button
          v-if="localObject.type === 'prop' || localObject.type === 'background' || localObject.type === 'symbol' || localObject.type === 'composite'"
          class="btn-add-playlist"
          @click="showAnimationManager = true"
        >
          🎬 Manage Animations
        </button>

        <!-- Prop/Background: [Edit] -->
        <button
          v-if="localObject.type === 'prop' || localObject.type === 'background'"
          class="btn-add-playlist"
          @click="showPropEditor = true"
        >
          ✏️ Edit
        </button>

        <!-- Audio: [Edit] -->
        <button
          v-if="localObject.type === 'audio'"
          class="btn-add-playlist"
          @click="showSoundEditor = true"
        >
          ✏️ Edit
        </button>

        <!-- Symbol: [Edit] -->
        <button
          v-if="localObject.type === 'symbol'"
          class="btn-add-playlist"
          @click="showSymbolMaterialManager = true"
        >
          ✏️ Edit
        </button>

      </div>

      <!-- v11.1: Prop animation migrated to resourceAnimations area, old code deleted here -->
    </div>


    <ExpressionSelectorDialog
      v-if="showExpressionDialog"
      :current-expression="initialExpression"
      @select="handleExpressionSelect"
      @close="showExpressionDialog = false"
    />

    <!-- v18: Standalone expression object switch dialog -->
    <ExpressionSelectorDialog
      v-if="showExpressionObjectDialog"
      :current-expression="localObject?.refId ?? ''"
      @select="handleExpressionObjectSwitch"
      @close="showExpressionObjectDialog = false"
    />






    <!-- v16: Symbol material management dialog -->
    <SymbolMaterialManagerDialog
      v-if="showSymbolMaterialManager && localObject?.type === 'symbol'"
      :object-name="localObject.alias ?? localObject.name ?? 'Symbol'"
      :materials="(localObject as SymbolObject).materials ?? []"
      :current-material-id="(localObject as SymbolObject).currentMaterialId"
      @close="showSymbolMaterialManager = false"
      @save="handleSymbolMaterialSave"
    />

    <!-- v20: Animation workbench (list mode, replaces old AnimationManagerDialog) -->
    <AnimationWorkbench
      v-if="showAnimationManager && localObject"
      :visible="showAnimationManager"
      :animation="workbenchInitialAnimation"
      :resource-type="workbenchResourceType"
      :resource-id="localObject.refId ?? localObject.id"
      :scene-object-id="localObject.id"
      :animations="workbenchAnimationsList"
      :existing-names="workbenchAnimationsList.map(a => a.name)"
      :original-name="workbenchInitialAnimation?.name"
      :is-object-mode="true"
      :scene-object="localObject"
      :persist-changes="props.persistChanges"
      v-bind="workbenchOptionalProps"
      @save="handleWorkbenchAnimSave"
      @close="showAnimationManager = false"
      @animation-created="handleWorkbenchAnimCreate"
      @animation-deleted="handleWorkbenchAnimDelete"
      @preset-applied="handleWorkbenchPresetApplied"
      @update:animations="handleWorkbenchAnimationsUpdate"
    />

    <!-- v17: Prop/Background edit dialog -->
    <PropEditorModal
      v-if="showPropEditor && editPropId"
      :visible="showPropEditor"
      :prop-id="editPropId"
      :resource-type="localObject?.type === 'background' ? 'background' : 'prop'"
      @close="showPropEditor = false"
      @save="showPropEditor = false"
    />

    <SoundEditorModal
      v-if="showSoundEditor && editSoundId"
      :visible="showSoundEditor"
      :sound-id="editSoundId"
      @close="showSoundEditor = false"
      @save="showSoundEditor = false"
    />

    <!-- v18: Expression asset edit dialog -->
    <ExpressionEditorModal
      v-if="showExpressionEditor"
      :visible="showExpressionEditor"
      :expression="editExpression"
      @close="showExpressionEditor = false"
      @saved="handleExpressionResourceSaved"
      @deleted="showExpressionEditor = false"
    />

  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, type Ref, ref, watch } from 'vue'

import ExpressionSelectorDialog from '@/components/screenplay/ExpressionSelectorDialog.vue'
import { useAssetAudio } from '@/composables/useAssetAudio'
import { useAssetImage } from '@/composables/useAssetImage'
import { CAMERA_BASE_HEIGHT,CAMERA_BASE_WIDTH, CANVAS_CENTER_X, CANVAS_CENTER_Y } from '@/constants/canvas'
import { RECOMMENDED_NAMES, RECOMMENDED_NAMES_SET } from '@/constants/recommendedNames'
import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { useAnimationStore } from '@/stores/animationStore' // v11.1: Resource-level animations
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import { useSoundStore } from '@/stores/soundStore'
import type { AnimationDefinition, AnimationTimingMode } from '@/types/animation'
import { type AudioObject, type CompositeObject, type ExpressionObject, type LightObject, type MaskObject, type SceneObject, type ScreenEffectObject, type SymbolMaterial, type SymbolObject, type TextObject } from '@/types/sceneObject'
import type { Action } from '@/types/screenplay'
import { debugLog } from '@/utils/debugLogger'
import { ensureFontLoaded } from '@/utils/fontLoader'
import { AMBIENT_PRESETS, getPresetsForLightType, type LightPresetEntry } from '@/utils/lightPresets'
import { applyMeasuredDefaultSize, syncExpressionInstanceDefaultSizes } from '@/utils/sceneObjectDefaultSize'
import { FONT_SIZE_PRESETS } from '@/utils/textStylePresets'
import { getAutoTextLineHeight, normalizeTextContent, resolveTextLineHeight } from '@/utils/textUtils'

import AnimationWorkbench from './animation-workbench/AnimationWorkbench.vue'
import MaskShapeSection from './animation-workbench/MaskShapeSection.vue'
import MaskTargetsSection from './animation-workbench/MaskTargetsSection.vue'
import ExpressionEditorModal from './ExpressionEditorModal.vue'
import PropEditorModal from './PropEditorModal.vue'
import SoundEditorModal from './SoundEditorModal.vue'
import SymbolMaterialManagerDialog from './SymbolMaterialManagerDialog.vue'

// Camera action types
type CameraActionType = 'camera_cut' | 'camera_move' | 'camera_follow' | 'camera_shake'

const props = defineProps<{
  selectedObject: SceneObject | undefined
  canvasWidth?: number
  canvasHeight?: number
  isActionMode?: boolean      // Whether in Action Mode
  currentSlotIndex?: number   // Current slot index
  currentSlotText?: string    // Current slot text
  runtimeState?: SceneObject | null  // Runtime state of current slot under Action Mode
  cameraRecordMode?: 'camera_cut' | 'camera_move'  // v6.5: Camera recording mode
  // v6.5: Camera console extended props
  currentCameraAction?: Action | null  // Camera action at current slot (prioritizes exclusive)
  currentSlotHasShake?: boolean  // v6.7: Whether current slot has shake action
  // v9.3: List of alive object IDs in current slot (for Action Mode filtering)
  aliveObjectIds?: string[]
  // v14.1: Object recording mode from parent component (passed from ActionEditor)
  objectRecordMode?: 'animation' | 'layout'
  // Pass-through list state
  isPassThrough?: boolean
  passThroughVisible?: boolean
  // v20: Action library pass-through
  rootCompositeId?: string
  /** Upper editor persistence flow */
  persistChanges?: (() => Promise<void>) | undefined
}>()

const emit = defineEmits<{
  update: [object: SceneObject]
  moveUp: []
  moveDown: []
  initialStateUpdate: [pose?: string, expression?: string]
  // v11.1: Animation trigger action (using resource-level Animation)
  triggerAnim: [payload: { animName: string, action: 'play'|'stop', loop?: boolean, speed?: number, timingMode?: AnimationTimingMode }]
  // v6.5: Camera recording mode switch
  cameraRecordModeChange: [mode: 'camera_cut' | 'camera_move']
  // v6.5: Camera action create/update
  cameraActionUpdate: [actionType: CameraActionType, params: Record<string, unknown>]
  // v7.5: Audio trigger action
  triggerAudio: [payload: { action: 'play'|'stop', volume?: number, loop?: boolean, fadeIn?: number, fadeOut?: number }]
  // TextObject: Text reveal/typewriter trigger action
  triggerTextReveal: [payload: { action: 'play'|'stop', mode?: 'typewriter' }]
  // v8.6: Object selection and alias editing
  selectObject: [objectId: string]
  editAlias: [objectId: string]
  // v9.1: Recording mode toggle (animation/layout)
  recordModeChange: [mode: 'animation' | 'layout']
  // v9.1: Jump to specified slot
  selectSlot: [slotIndex: number]
  // v9.3: Visual property update (flipX/visible/zIndex/receiveLighting/castShadow)
  visualActionUpdate: [params: { flipX?: boolean, visible?: boolean, zIndex?: number, receiveLighting?: boolean, castShadow?: boolean }]
  // v16: Symbol material switch (creates set_material Action in Action Mode)
  materialActionUpdate: [materialId: string]
  // v16: Symbol material list save (syncs to Setup persistence in Action Mode)
  materialSave: [materials: SymbolMaterial[], currentMaterialId: string | undefined]
  // P2: composite operation (creates Action in Action Mode rather than directly modifying Store)
  compositeAction: [payload: { action: 'removeChild'; childId: string } | { action: 'ungroupAll'; compositeId: string } | { action: 'addMember'; compositeId: string } | { action: 'setCompositeLocked'; compositeId: string; locked: boolean } | { action: 'reorderRenderChain'; compositeId: string; renderChain: string[] }]
  // v16: Edit asset (opens prop/background asset edit dialog)
  editResource: [objectId: string]
  // v17: Animation update synced to scene.setup.objects
  animationsUpdated: [objectId: string, animations: Record<string, import('@/types/animation').AnimationDefinition>]
  // Pass-through list operations
  passThroughToggle: [objectId: string]
  passThroughVisibleToggle: [objectId: string]
}>()

const localObject = ref<SceneObject | null>(null) as Ref<SceneObject | null>
const textFontLoadRequestId = ref(0)
const expressionStore = useExpressionStore()
const sceneObjectStore = useSceneObjectStore()
// v11.2: propStore no longer used (old prop animation control logic deleted)
const animationStore = useAnimationStore() // v11.1: Resource-level animations
const soundStore = useSoundStore()
const projectStore = useProjectStore()
const { getAudioUrl } = useAssetAudio()
const { getImageUrl } = useAssetImage()

// v8.6: Get all scene objects (sorted by zIndex)
const sortedAllObjects = computed(() => {
  return [...sceneObjectStore.objects].sort((a, b) => b.zIndex - a.zIndex)
})




// v16: Symbol materials
const showSymbolMaterialManager = ref(false)

// v17: Animation management -> v20: Open AnimationWorkbench directly
const showAnimationManager = ref(false)

// v20: Computed properties required for Workbench list mode
const workbenchAnimationsList = computed((): AnimationDefinition[] => {
  if (!localObject.value?.animations) return []
  return Object.values(localObject.value.animations)
})

const workbenchInitialAnimation = computed((): AnimationDefinition | undefined => {
  const list = workbenchAnimationsList.value
  if (list.length > 0) return list[0]
  return undefined
})

const workbenchResourceType = computed((): 'prop' | 'background' | 'symbol' | 'composite' => {
  const t = localObject.value?.type
  if (t === 'prop' || t === 'background' || t === 'symbol' || t === 'composite') return t
  return 'prop' // fallback
})

const workbenchOptionalProps = computed(() => {
  const p: Record<string, unknown> = {}
  if (effectiveRootCompositeId.value) p['rootCompositeId'] = effectiveRootCompositeId.value
  return p
})

function _writeAnimationsToStore(animations: Record<string, AnimationDefinition>) {
  if (!localObject.value) return
  const objId = localObject.value.id
  const normalizedAnimations = normalizeAnimationsMap(animations)
  if (sceneObjectStore.getIsActionMode()) {
    sceneObjectStore.updateSetupObject(objId, { animations: normalizedAnimations })
  } else {
    sceneObjectStore.updateObject(objId, { animations: normalizedAnimations })
  }
  emit('animationsUpdated', objId, normalizedAnimations)
  projectStore.markAsUnsaved()
}

function normalizeAnimationsMap(animations: Record<string, AnimationDefinition>): Record<string, AnimationDefinition> {
  const normalized: Record<string, AnimationDefinition> = {}
  for (const animation of Object.values(animations)) {
    const cloned = JSON.parse(JSON.stringify(animation)) as AnimationDefinition
    normalized[cloned.id] = cloned
  }
  return normalized
}

function handleWorkbenchAnimSave(animation: AnimationDefinition) {
  if (!localObject.value) return
  const anims = { ...(localObject.value.animations ?? {}) }
  anims[animation.id] = animation
  _writeAnimationsToStore(anims)
}

function handleWorkbenchAnimCreate(animation: AnimationDefinition) {
  handleWorkbenchAnimSave(animation)
}

function handleWorkbenchAnimDelete(animationId: string) {
  if (!localObject.value) return
  const anims = { ...(localObject.value.animations ?? {}) }
  delete anims[animationId]
  _writeAnimationsToStore(anims)
}

function handleWorkbenchPresetApplied() {
  projectStore.markAsUnsaved()
}

function handleWorkbenchAnimationsUpdate(animations: Record<string, AnimationDefinition>) {
  _writeAnimationsToStore(animations)
}

// Phase 2b: Read root composite from object instance in scene editor.
// (Action name resolution only needs root composite id scope)
const effectiveRootCompositeId = computed(() => {
  if (props.rootCompositeId) return props.rootCompositeId
  if (localObject.value?.type === 'composite') {
    return (localObject.value as CompositeObject).instanceRootCompositeId
  }
  return undefined
})

// v17: Prop/Background edit dialog
const showPropEditor = ref(false)
const editPropId = computed(() => {
  if (!localObject.value) return undefined
  if (localObject.value.type === 'prop' || localObject.value.type === 'background') {
    return localObject.value.refId || undefined
  }
  return undefined
})

const showSoundEditor = ref(false)
const editSoundId = computed(() => {
  if (!localObject.value) return undefined
  if (localObject.value.type === 'audio') {
    return localObject.value.refId || undefined
  }
  return undefined
})

// v18: Expression asset edit dialog
const showExpressionEditor = ref(false)
const editExpression = computed(() => {
  if (localObject.value?.type !== 'expression') return null
  return expressionStore.getExpression(localObject.value.refId) ?? null
})

function openExpressionEditor() {
  showExpressionEditor.value = true
}

async function handleExpressionResourceSaved(expressionId: string) {
  showExpressionEditor.value = false
  await syncExpressionInstanceDefaultSizes(
    expressionId,
    sceneObjectStore.setupState.objects,
    (id, updates) => sceneObjectStore.updateSetupObject(id, updates as Partial<SceneObject>),
  )

  if (localObject.value) {
    const latest = sceneObjectStore.getObject(localObject.value.id)
    if (latest) {
      localObject.value = { ...latest } as SceneObject
      emit('update', localObject.value)
    }
  }
  useProjectStore().markAsUnsaved()
}

const symbolMaterials = computed(() => {
  if (localObject.value?.type !== 'symbol') return []
  return (localObject.value as unknown as { materials: { id: string; name: string }[] }).materials ?? []
})

const symbolCurrentMaterialId = computed(() => {
  if (localObject.value?.type !== 'symbol') return undefined
  return (localObject.value as unknown as { currentMaterialId?: string }).currentMaterialId
})

const symbolCurrentMaterialName = computed(() => {
  const id = symbolCurrentMaterialId.value
  if (!id) return 'Not Selected'
  const mat = symbolMaterials.value.find(m => m.id === id)
  return mat?.name ?? 'Unknown'
})

/** Relative path of current material (obtained from SymbolMaterial.url) */
const symbolCurrentMaterialPath = computed((): string => {
  const id = symbolCurrentMaterialId.value
  if (!id) return ''
  const symbolObj = localObject.value as unknown as SymbolObject | null
  const mat = symbolObj?.materials?.find(m => m.id === id)
  if (!mat) return ''
  // Static material gets url, animated material gets first frame url
  if (mat.type === 'static' && mat.url) return mat.url
  if (mat.frames && mat.frames.length > 0 && mat.frames[0]!.url) return mat.frames[0]!.url
  return mat.url ?? ''
})

const { getImageUrl: resolveProjectUrl } = useAssetImage()

/**
 * Resolve symbol material URL: resolve project path via getImageUrl
 */
function resolveSymbolUrl(url: string | undefined): string {
  if (!url) return ''
  return resolveProjectUrl(url) || ''
}

const currentMaterialPreviewUrl = computed(() => {
  const id = symbolCurrentMaterialId.value
  if (!id) return ''
  const mat = (localObject.value as unknown as SymbolObject | null)?.materials?.find(m => m.id === id)
  if (!mat) return ''
  if (mat.type === 'static') {
    return resolveSymbolUrl(mat.url)
  }
  // Animation: show first frame or still frame
  if (mat.stillFrameSource === 'frame' && mat.frames && mat.stillFrameIndex !== undefined && mat.frames[mat.stillFrameIndex]) {
    const f = mat.frames[mat.stillFrameIndex]!
    return resolveSymbolUrl(f.url)
  }
  if (mat.frames && mat.frames.length > 0) {
    return resolveSymbolUrl(mat.frames[0]!.url)
  }
  return resolveSymbolUrl(mat.url)
})

function getSymbolMaterialThumb(mat: { id: string; name: string }): string | null {
  const symbolObj = localObject.value as unknown as SymbolObject | null
  if (!symbolObj) return null
  const fullMat = symbolObj.materials?.find(m => m.id === mat.id)
  if (!fullMat) return null
  if (fullMat.type === 'static') return resolveSymbolUrl(fullMat.url) || null
  if (fullMat.frames && fullMat.frames.length > 0) return resolveSymbolUrl(fullMat.frames[0]!.url) || null
  return null
}

async function syncSelectedObjectMeasuredSize(options?: { persistSetup?: boolean }): Promise<void> {
  if (!localObject.value) return
  const target = sceneObjectStore.getObject(localObject.value.id) ?? localObject.value
  await applyMeasuredDefaultSize(target, (id, updates) => {
    if (options?.persistSetup) {
      sceneObjectStore.updateSetupObject(id, updates as Partial<SceneObject>)
    } else {
      sceneObjectStore.updateObject(id, updates as Partial<SceneObject>)
    }
    if (localObject.value?.id === id) {
      Object.assign(localObject.value, updates)
    }
  })
}

async function handleSwitchMaterial(materialId: string) {
  if (!localObject.value) return
  if (props.isActionMode) {
    // Action Mode: emit event to let ActionEditor create/update set_material Action
    emit('materialActionUpdate', materialId)
    return
  }
  // Setup Mode: update directly via Store and mark unsaved
  if (!localObject.value) return
  // Sync localObject first to prevent stale value overwriting Store upon emit
  ;(localObject.value as unknown as { currentMaterialId: string }).currentMaterialId = materialId
  sceneObjectStore.updateObject(localObject.value.id, { currentMaterialId: materialId } as Partial<SceneObject>)
  await syncSelectedObjectMeasuredSize()
  // Notify parent component (character editor etc) to mark unsaved state
  emit('update', localObject.value)
  useProjectStore().markAsUnsaved()
}

async function handleSymbolMaterialSave(materials: SymbolMaterial[], currentMaterialId: string | undefined) {
  if (localObject.value?.type !== 'symbol') return
  
  if (props.isActionMode) {
    // Action Mode: material list change synced to Setup persistence via emit
    emit('materialSave', materials, currentMaterialId)
    // Update runtime store simultaneously to reflect in UI immediately
    sceneObjectStore.updateObject(localObject.value.id, {
      materials,
    } as Partial<SceneObject>)
    await syncSelectedObjectMeasuredSize({ persistSetup: true })
    // currentMaterialId change via set_material Action
    const currentObj = localObject.value as unknown as { currentMaterialId?: string }
    if (currentMaterialId !== undefined && currentMaterialId !== currentObj.currentMaterialId) {
      emit('materialActionUpdate', currentMaterialId)
    }
  } else {
    // Setup Mode: modify Store directly
    sceneObjectStore.updateObject(localObject.value.id, {
      materials,
      currentMaterialId,
    } as Partial<SceneObject>)
    await syncSelectedObjectMeasuredSize()
    // Mark unsaved state (Store updated directly, no need for second emit('update'))
    useProjectStore().markAsUnsaved()
  }
  // Re-inject frame animation definitions after material change
  const updatedObj = sceneObjectStore.getObject(localObject.value.id)
  if (updatedObj) {
    animationStore.hydrateObjectAnimations(updatedObj)
    // Persist injection results to Store (triggers Vue reactive update)
    sceneObjectStore.updateObject(updatedObj.id, { animations: { ...updatedObj.animations } } as Partial<SceneObject>)
    // Get latest snapshot from Store to sync to localObject (including new materials + hydrated animations)
    const latestObj = sceneObjectStore.getObject(localObject.value.id)
    if (latestObj) {
      localObject.value = { ...latestObj } as SceneObject
    }
  }
}

// v9.3: Filtered object list (excluding spawned=false dynamic objects)
const filteredObjects = computed(() => {
  const flat = sortedAllObjects.value.filter(obj => {
    // Camera always displayed
    if (obj.type === 'camera') return true
    // v9.3: Check spawned state
    const spawned = (obj as unknown as { spawned?: boolean }).spawned
    
    // Setup mode: exclude spawned=false objects
    if (!props.isActionMode) {
      return spawned !== false
    }
    
    // Action Mode: filter according to aliveObjectIds
    // Only show alive objects (camera not in aliveObjectIds, whitelisted above)
    if (props.aliveObjectIds) {
      return props.aliveObjectIds.includes(obj.id)
    }
    
    // If no aliveObjectIds, show all objects (fallback logic)
    return true
  })

  // Dual-layer architecture: parentId written to runtimeObjects by applySlotState(), no need for accumulatedParentIds override

  // P2: Tree arrangement — recursively insert child objects after parent (supports nested runtime parents)
  const result: typeof flat = []
  const childrenByParent = new Map<string, typeof flat>()

  // First pass: group by parentId
  for (const obj of flat) {
    if (obj.parentId) {
      const siblings = childrenByParent.get(obj.parentId) ?? []
      siblings.push(obj)
      childrenByParent.set(obj.parentId, siblings)
    }
  }

  // Recursive insert: depth-first (any parent with children expands tree, not limited to composite)
  function insertWithChildren(obj: SceneObject): void {
    result.push(obj)
    const children = childrenByParent.get(obj.id)
    if (children) {
      childrenByParent.delete(obj.id)
      for (const child of children) {
        insertWithChildren(child)
      }
    }
  }

  // Second pass: recurse starting from root objects
  for (const obj of flat) {
    if (!obj.parentId) {
      insertWithChildren(obj)
    }
  }

  // Fallback: orphaned child objects whose parent is not in list appended to end
  for (const orphans of childrenByParent.values()) {
    result.push(...orphans)
  }

  return result
})

// P2: Check if tree item visible — check all parents expanded along ancestor chain
function isTreeItemVisible(obj: SceneObject): boolean {
  let currentParentId = getEffectiveParentId(obj)
  while (currentParentId) {
    if (!expandedComposites.has(currentParentId)) return false
    const parentObj = sceneObjectStore.getObject(currentParentId)
    currentParentId = parentObj ? getEffectiveParentId(parentObj) : undefined
  }
  return true
}

// P2: Get object nesting depth in tree (used for indentation calculation)
function getTreeDepth(obj: SceneObject): number {
  let depth = 0
  let currentParentId = getEffectiveParentId(obj)
  while (currentParentId) {
    depth++
    const parentObj = sceneObjectStore.getObject(currentParentId)
    currentParentId = parentObj ? getEffectiveParentId(parentObj) : undefined
  }
  return depth
}

// Dual-layer architecture: read directly from runtimeObjects obj.parentId (written by applySlotState)
function getEffectiveParentId(obj: SceneObject): string | undefined {
  return obj.parentId
}

// P2: Check if an object has children at runtime
function hasRuntimeChildren(objId: string): boolean {
  return filteredObjects.value.some(o => getEffectiveParentId(o) === objId)
}




// v9.3: Determine if object active in current Slot (based on spawned state)
function isObjectVisibleAtCurrentSlot(objectId: string): boolean {
  const obj = sceneObjectStore.objects.find(o => o.id === objectId)
  if (!obj) return false
  if (obj.type === 'camera') return true
  
  // Check spawned state
  const spawned = (obj as unknown as { spawned?: boolean }).spawned
  return spawned !== false
}

// v9.1: Get object status suffix
function getObjectStatusSuffix(objectId: string): string {
  if (!props.isActionMode) return ''
  const obj = sceneObjectStore.objects.find(o => o.id === objectId)
  if (!obj || obj.type === 'camera') return ''
  if (obj.visible === false) return ' (Hidden)'
  return ''
}

// v9.1: Determine whether selected object spawned in current slot
const isObjectBornAtCurrentSlot = computed(() => {
  if (!props.isActionMode || !localObject.value) return true
  if (localObject.value.type === 'camera') return true
  
  // Check object's visible property (simplified implementation)
  // Dynamic objects have visible = false on creation, set to true after spawn
  return localObject.value.visible !== false
})

// v9.4: Display name of current object (alias preferred, otherwise name)
const localObjectDisplayName = computed(() => {
  if (!localObject.value) return 'Not Set'
  const obj = localObject.value
  // Use unknown cast to avoid type assertion error
  const alias = obj.alias
  return alias ?? obj.name ?? 'Not Set'
})

const recommendedNameOptions = RECOMMENDED_NAMES

const showPresetNamePicker = computed(() =>
  !!props.rootCompositeId &&
  !!localObject.value &&
  localObject.value.type !== 'camera',
)

const selectedPresetNameValue = computed(() => {
  const alias = localObject.value?.alias?.trim()
  return alias && RECOMMENDED_NAMES_SET.has(alias) ? alias : ''
})

function isPresetNameUsedByOtherObject(name: string): boolean {
  const current = localObject.value
  if (!current) return false
  const namespaceRoot = props.rootCompositeId ?? sceneObjectStore.resolveNamespaceRoot(current.id)
  return sceneObjectStore.isAliasExists(name, current.id, namespaceRoot)
}

// v16: Get animation list of current object (resource animations deep cloned to obj.animations upon creation)
const resourceAnimations = computed(() => {
  if (!localObject.value) return []
  return animationStore.getObjectAnimations(localObject.value)
})

// v16 H1: Grouping — distinguish resource animations and instance animations
const resourceOriginAnimNames = computed<Set<string>>(() => {
  if (!localObject.value) return new Set()
  const obj = localObject.value
  if (obj.type !== 'prop' && obj.type !== 'background') return new Set()
  const resAnims = animationStore.getAnimations(obj.type, obj.refId)
  return new Set(resAnims.map(a => a.name))
})

const resourceOriginAnimations = computed(() =>
  resourceAnimations.value.filter(a => resourceOriginAnimNames.value.has(a.name))
)

const instanceAnimations = computed(() =>
  resourceAnimations.value.filter(a => !resourceOriginAnimNames.value.has(a.name))
)

// v16 H1: Reapply resource animations (deep clone from resource to overwrite)
function handleReapplyResourceAnimations() {
  if (!localObject.value) return
  const obj = localObject.value
  if (obj.type !== 'prop' && obj.type !== 'background' && obj.type !== 'symbol') return
  animationStore.hydrateObjectAnimations(obj)
  sceneObjectStore.updateObject(obj.id, { animations: { ...obj.animations } })
}


// v9.1: Get object spawn slot index
const objectBirthSlotIndex = computed(() => {
  if (!props.isActionMode || !localObject.value) return -1
  if (localObject.value.type === 'camera') return 0
  
  // Simplified implementation: return -1 if visible = false indicating not spawned
  // Full implementation needs to iterate Block Actions to find first visible: true Action
  return localObject.value.visible === false ? -1 : 0
})

// v9.1: Jump to spawn slot
function jumpToBirthSlot() {
  if (objectBirthSlotIndex.value >= 0) {
    emit('selectSlot', objectBirthSlotIndex.value)
  }
}

// v11.1: Get resource animation current state (based on Action in current slot)
function getResourceAnimState(_animName: string): 'play' | 'stop' | null {
  // Simplified implementation: return null for no state
  // Full implementation needs to search set_anim action from current Block Actions
  return null
}

// v11.1: Handle resource animation play/stop action
function handleResourceAnimAction(animName: string, action: 'play' | 'stop') {
  const timingMode = getResourceAnimTimingMode(animName)
  emit('triggerAnim', {
    animName,
    action,
    loop: action === 'play',
    ...(action === 'play' ? { timingMode } : {}),
    speed: 1
  })
}

function getResourceAnimTimingMode(animName: string): AnimationTimingMode {
  const animation = resourceAnimations.value.find(a => a.name === animName)
  return animation?.timingMode ?? 'continuous'
}

// v11.1: Get resource animation loop state
function getResourceAnimLoop(_animName: string): boolean {
  // Simplified implementation: default loop
  return true
}

// v11.1: Handle resource animation loop change
function handleResourceAnimLoopChange(animName: string, loop: boolean) {
  const timingMode = getResourceAnimTimingMode(animName)
  emit('triggerAnim', {
    animName,
    action: 'play',
    loop,
    timingMode,
    speed: 1
  })
}

// v8.6: Get object type icon — P1: delegate to metadata registry
function getObjectIcon(type: string): string {
  return getTypeIcon(type)
}

// v8.6: Get object display name
function getObjectDisplayName(obj: SceneObject): string {
  if (obj.type === 'camera') {
    return obj.name ? obj.name : 'Camera'
  }
  if (obj.type === 'light' && (obj as LightObject).lightType === 'ambient') {
    return 'Ambient Light'
  }
  if (obj.type === 'light' && (obj as LightObject).lightType === 'spot') {
    return obj.alias ?? obj.name ?? 'Spotlight'
  }
  return obj.alias ?? obj.name ?? 'Untitled'
}

// ==================== P2: Composite Related Logic ====================

// Parent composite of currently selected object (supports runtime hierarchy)
const parentComposite = computed((): CompositeObject | null => {
  if (!localObject.value) return null
  const effectiveId = getEffectiveParentId(localObject.value)
  if (!effectiveId) return null
  const parent = sceneObjectStore.getObject(effectiveId)
  if (parent?.type === 'composite') {
    return parent as CompositeObject
  }
  return null
})

// Child objects list of current composite object
// Dual-layer architecture: runtimeObjects parentId already includes structure action effect
const compositeChildObjects = computed((): SceneObject[] => {
  if (localObject.value?.type !== 'composite') return []
  const comp = localObject.value as CompositeObject

  // Arranged in childIds order, ensuring UI list matches render order
  // childIds[0] = bottom layer (rendered first, obscured), childIds[last] = top layer (rendered last, in front)
  const result: SceneObject[] = []
  for (const childId of comp.childIds ?? []) {
    const child = sceneObjectStore.getObject(childId)
    if (child) result.push(child)
  }
  return result
})

/** Refresh localObject from store (sync childIds/renderChain after adding/deleting child objects) */
function refreshLocalObject() {
  if (!localObject.value) return
  const fresh = sceneObjectStore.getObject(localObject.value.id)
  if (fresh) {
    localObject.value = { ...fresh } as SceneObject
  }
}

// entity composite: renderChain ordered objects
const renderChainObjects = computed((): SceneObject[] => {
  if (localObject.value?.type !== 'composite') return []
  const comp = localObject.value as CompositeObject
  if (comp.compositeMode !== 'entity') return []
  const chain = comp.renderChain ?? []
  const result: SceneObject[] = []
  for (const childId of chain) {
    const child = sceneObjectStore.getObject(childId)
    if (child) result.push(child)
  }
  return result
})

// === Render chain ordering: zIndex grouping + selection state + dragging ===

/** Render chain group info: group by zIndex, insert divider at group boundary */
interface RcGroupEntry {
  type: 'item'
  obj: SceneObject
  flatIndex: number    // Index in renderChainObjects
  isFirstInGroup: boolean
  isLastInGroup: boolean
  zIndex: number
}

interface RcGroupDivider {
  type: 'divider'
  zIndex: number       // zIndex of group below divider
}

type RcDisplayEntry = RcGroupEntry | RcGroupDivider

const renderChainDisplay = computed((): RcDisplayEntry[] => {
  const items = renderChainObjects.value
  if (items.length === 0) return []

  const entries: RcDisplayEntry[] = []
  let prevZIndex: number | null = null

  for (let i = 0; i < items.length; i++) {
    const obj = items[i]!
    const z = obj.zIndex

    // Insert divider on group transition
    if (z !== prevZIndex) {
      if (prevZIndex !== null) {
        // Mark previous item as group end
        for (let j = entries.length - 1; j >= 0; j--) {
          const e = entries[j]!
          if (e.type === 'item') { e.isLastInGroup = true; break }
        }
      }
      entries.push({ type: 'divider', zIndex: z })
    }

    const isFirst = prevZIndex === null || z !== prevZIndex
    entries.push({
      type: 'item',
      obj,
      flatIndex: i,
      isFirstInGroup: isFirst,
      isLastInGroup: false, // Updated later
      zIndex: z,
    })
    prevZIndex = z
  }

  // Mark last item as group end
  for (let j = entries.length - 1; j >= 0; j--) {
    const e = entries[j]!
    if (e.type === 'item') { e.isLastInGroup = true; break }
  }

  return entries
})

const selectedRenderChainId = ref<string | null>(null)
const rcDragOverIndex = ref(-1)
let rcDragStartIndex = -1

const selectedRenderChainIndex = computed(() => {
  if (!selectedRenderChainId.value) return -1
  return renderChainObjects.value.findIndex(o => o.id === selectedRenderChainId.value)
})

/** Get boundary [groupStart, groupEnd] (inclusive) of zIndex group containing specified flatIndex */
function getZIndexGroupBounds(flatIdx: number): [number, number] {
  const items = renderChainObjects.value
  if (flatIdx < 0 || flatIdx >= items.length) return [-1, -1]
  const z = items[flatIdx]!.zIndex
  let start = flatIdx
  let end = flatIdx
  while (start > 0 && items[start - 1]!.zIndex === z) start--
  while (end < items.length - 1 && items[end + 1]!.zIndex === z) end++
  return [start, end]
}

const canMoveUp = computed(() => {
  const idx = selectedRenderChainIndex.value
  if (idx <= 0) return false
  const [groupStart] = getZIndexGroupBounds(idx)
  return idx > groupStart
})

const canMoveDown = computed(() => {
  const idx = selectedRenderChainIndex.value
  const items = renderChainObjects.value
  if (idx < 0 || idx >= items.length - 1) return false
  const [, groupEnd] = getZIndexGroupBounds(idx)
  return idx < groupEnd
})

function onRcDragStart(idx: number, e: DragEvent) {
  rcDragStartIndex = idx
  selectedRenderChainId.value = renderChainObjects.value[idx]?.id ?? null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onRcDragOver(idx: number) {
  // Only allow dragging within same zIndex group
  if (rcDragStartIndex >= 0) {
    const items = renderChainObjects.value
    const srcZ = items[rcDragStartIndex]?.zIndex
    const tgtZ = items[idx]?.zIndex
    if (srcZ !== tgtZ) {
      rcDragOverIndex.value = -1
      return
    }
  }
  rcDragOverIndex.value = idx
}

function onRcDragLeave() {
  rcDragOverIndex.value = -1
}

function onRcDrop(dropIdx: number) {
  rcDragOverIndex.value = -1
  if (rcDragStartIndex < 0 || rcDragStartIndex === dropIdx) return
  if (localObject.value?.type !== 'composite') return

  // zIndex cross-group validation
  const items = renderChainObjects.value
  const srcZ = items[rcDragStartIndex]?.zIndex
  const tgtZ = items[dropIdx]?.zIndex
  if (srcZ !== tgtZ) return

  const comp = localObject.value as CompositeObject
  const chain = comp.renderChain
  if (!chain) return

  const newChain = [...chain]
  const [moved] = newChain.splice(rcDragStartIndex, 1)
  if (!moved) return
  newChain.splice(dropIdx, 0, moved)

  if (props.isActionMode) {
    emit('compositeAction', { action: 'reorderRenderChain', compositeId: comp.id, renderChain: newChain })
  } else {
    sceneObjectStore.updateObject(comp.id, { renderChain: newChain } as Partial<SceneObject>)
    comp.renderChain = newChain
    emit('update', localObject.value)
  }
  selectedRenderChainId.value = moved
}

function onRcDragEnd() {
  rcDragOverIndex.value = -1
  rcDragStartIndex = -1
}

function handleRenderChainMoveUp(idx: number) {
  if (idx <= 0) return
  // zIndex boundary check
  const [groupStart] = getZIndexGroupBounds(idx)
  if (idx <= groupStart) return

  if (localObject.value?.type !== 'composite') return
  const comp = localObject.value as CompositeObject
  const chain = comp.renderChain
  if (!chain) return
  const newChain = [...chain]
  const moved = newChain.splice(idx, 1)[0]!
  newChain.splice(idx - 1, 0, moved)
  if (props.isActionMode) {
    emit('compositeAction', { action: 'reorderRenderChain', compositeId: comp.id, renderChain: newChain })
    return
  }
  sceneObjectStore.updateObject(comp.id, { renderChain: newChain } as Partial<SceneObject>)
  comp.renderChain = newChain
  emit('update', localObject.value)
}

function handleRenderChainMoveDown(idx: number) {
  if (localObject.value?.type !== 'composite') return
  const comp = localObject.value as CompositeObject
  const chain = comp.renderChain
  if (!chain || idx >= chain.length - 1) return

  // zIndex boundary check
  const [, groupEnd] = getZIndexGroupBounds(idx)
  if (idx >= groupEnd) return

  const newChain = [...chain]
  const moved = newChain.splice(idx, 1)[0]!
  newChain.splice(idx + 1, 0, moved)
  if (props.isActionMode) {
    emit('compositeAction', { action: 'reorderRenderChain', compositeId: comp.id, renderChain: newChain })
    return
  }
  sceneObjectStore.updateObject(comp.id, { renderChain: newChain } as Partial<SceneObject>)
  comp.renderChain = newChain
  emit('update', localObject.value)
}



// Toggle compositeLocked
function handleCompositeLockChange(event: Event) {
  if (localObject.value?.type !== 'composite') return
  const target = event.target as HTMLInputElement
  if (props.isActionMode) {
    // Action Mode: let ActionEditor write directly to scene.setup.objects via compositeAction event
    emit('compositeAction', {
      action: 'setCompositeLocked',
      compositeId: localObject.value.id,
      locked: target.checked
    })
  } else {
    // Setup Mode: update Store directly
    sceneObjectStore.updateObject(localObject.value.id, { compositeLocked: target.checked } as Partial<SceneObject>)
  }
  if (localObject.value) {
    ;(localObject.value as CompositeObject).compositeLocked = target.checked
  }
}

// Remove current object from parent composite
function handleRemoveFromComposite() {
  if (!localObject.value?.parentId) return
  const childId = localObject.value.id

  if (props.isActionMode) {
    // Action Mode: emit event to let ActionEditor create structure change Action
    emit('compositeAction', { action: 'removeChild', childId })
  } else {
    // Setup Mode: use Store method directly
    sceneObjectStore.removeFromComposite([childId])
    refreshLocalObject()
  }
}

// Remove specified child object from composite
function handleRemoveChildFromComposite(childId: string) {
  if (localObject.value?.type !== 'composite') return

  if (props.isActionMode) {
    emit('compositeAction', { action: 'removeChild', childId })
  } else {
    sceneObjectStore.removeFromComposite([childId])
    // Refresh localObject from store, syncing childIds/renderChain changes
    refreshLocalObject()
  }
}

// Ungroup all child objects
function handleUngroupAll() {
  if (localObject.value?.type !== 'composite') return
  const compositeId = localObject.value.id

  if (props.isActionMode) {
    // Action Mode: emit event to let ActionEditor create structure change Action
    emit('compositeAction', { action: 'ungroupAll', compositeId })
  } else {
    // Setup Mode: use Store method directly
    sceneObjectStore.ungroupAll(compositeId)
    refreshLocalObject()
  }
}

// Add member to current composite
function handleAddMemberToComposite() {
  if (localObject.value?.type !== 'composite') return
  emit('compositeAction', { action: 'addMember', compositeId: localObject.value.id })
}

// P2: handleObjectSelect replaced by handleTreeItemSelect

// P2: Tree dropdown — state
const treeDropdownRef = ref<HTMLElement>()
const treeDropdownOpen = ref(false)
const expandedComposites = reactive(new Set<string>())

// P2: All composites collapsed by default on initialization
// User can manually click to expand composites of interest
// (Previously union mode expanded by default, but too many children affected operations)

// P2: Tree dropdown — select item
function handleTreeItemSelect(objectId: string) {
  emit('selectObject', objectId)
  treeDropdownOpen.value = false
}

// P2: Tree dropdown — expand/collapse
function toggleCompositeExpand(compositeId: string) {
  if (expandedComposites.has(compositeId)) {
    expandedComposites.delete(compositeId)
  } else {
    expandedComposites.add(compositeId)
  }
}

// P2: Tree dropdown — close on outside click
function handleTreeDropdownOutsideClick(event: MouseEvent) {
  if (treeDropdownRef.value && !treeDropdownRef.value.contains(event.target as Node)) {
    treeDropdownOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleTreeDropdownOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleTreeDropdownOutsideClick)
})

// v8.6: Handle alias edit click
function handleEditAliasClick() {
  if (localObject.value && localObject.value.type !== 'camera') {
    emit('editAlias', localObject.value.id)
  }
}

function handlePresetNameSelect(name: string) {
  if (!localObject.value || !name) return
  if (isPresetNameUsedByOtherObject(name)) return
  localObject.value.alias = name
  emit('update', localObject.value)
}

// v9.3: Handle horizontal flip change
function handleFlipXChange(event: Event) {
  const target = event.target as HTMLInputElement
  const newFlipX = target.checked
  
  if (props.isActionMode) {
    // Action Mode: emit visualActionUpdate to create set_visual Action
    emit('visualActionUpdate', { flipX: newFlipX })
  } else {
    // Setup Mode: update local object and emit update
    if (localObject.value) {
      (localObject.value as { flipX?: boolean }).flipX = newFlipX
      emit('update', localObject.value)
    }
  }
}

// v9.3: Handle visibility change
function handleVisibleChange(event: Event) {
  const target = event.target as HTMLInputElement
  const newVisible = target.checked
  
  if (props.isActionMode) {
    // Action Mode: emit visualActionUpdate to create set_visual Action
    emit('visualActionUpdate', { visible: newVisible })
  } else {
    // Setup Mode: update local object and emit update
    if (localObject.value) {
      localObject.value.visible = newVisible
      emit('update', localObject.value)
    }
  }
}

function handleReceiveLightingChange(event: Event) {
  const target = event.target as HTMLInputElement
  const receiveLighting = target.checked

  if (props.isActionMode) {
    emit('visualActionUpdate', { receiveLighting })
  } else if (localObject.value) {
    localObject.value.receiveLighting = receiveLighting
    emit('update', localObject.value)
  }
}

function handleCastShadowChange(event: Event) {
  const target = event.target as HTMLInputElement
  const castShadow = target.checked

  if (props.isActionMode) {
    emit('visualActionUpdate', { castShadow })
  } else if (localObject.value) {
    localObject.value.castShadow = castShadow
    emit('update', localObject.value)
  }
}

// v9.3: Handle structure change
function handleZIndexChange() {
  if (!localObject.value) return
  
  const newZIndex = localObject.value.zIndex
  
  if (props.isActionMode) {
    // Action Mode: emit visualActionUpdate to create set_visual Action
    emit('visualActionUpdate', { zIndex: newZIndex })
  } else {
    // Setup Mode: stably sort renderChain after updating object
    // Stable sort only regroups by zIndex, preserving user relative order within same zIndex
    emit('update', localObject.value)
    sceneObjectStore.sortOwningRenderChain(localObject.value.id)
    refreshLocalObject()
  }
}

// Handle transform origin X change (Setup Mode only)
function handleTransformOriginXChange(event: Event) {
  if (!localObject.value) return
  const newValue = parseFloat((event.target as HTMLInputElement).value) || 0
  applyTransformOriginWithCompensation(newValue, localObject.value.transformOriginY ?? 0)
}

// Handle transform origin Y change (Setup Mode only)
function handleTransformOriginYChange(event: Event) {
  if (!localObject.value) return
  const newValue = parseFloat((event.target as HTMLInputElement).value) || 0
  applyTransformOriginWithCompensation(localObject.value.transformOriginX ?? 0, newValue)
}

/**
 * Unified transform origin modification + position compensation (pixel offset approach)
 * Consistent with useSceneRenderer.ts canvas drag compensation logic:
 * When object is rotated/scaled, moving pivot requires synchronous x/y compensation to keep visuals invariant.
 */
function applyTransformOriginWithCompensation(newOriginX: number, newOriginY: number) {
  const obj = localObject.value
  if (!obj) return

  const oldOriginX = obj.transformOriginX ?? 0
  const oldOriginY = obj.transformOriginY ?? 0
  const rotation = obj.rotation ?? 0
  const sx = Math.abs(obj.scaleX ?? 1)
  const sy = obj.scaleY ?? 1

  // Pixel offset approach: offset is originX/Y itself, no bounds calculation needed
  const deltaOffsetX = newOriginX - oldOriginX
  const deltaOffsetY = newOriginY - oldOriginY

  // (R×S - I) × Δoffset
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const adjustX = (cos * sx * deltaOffsetX - sin * sy * deltaOffsetY) - deltaOffsetX
  const adjustY = (sin * sx * deltaOffsetX + cos * sy * deltaOffsetY) - deltaOffsetY

  obj.transformOriginX = newOriginX
  obj.transformOriginY = newOriginY

  // Only compensate when object is rotated/scaled
  if (Math.abs(adjustX) > 0.01 || Math.abs(adjustY) > 0.01) {
    obj.x = (obj.x ?? 0) + adjustX
    obj.y = (obj.y ?? 0) + adjustY
  }

  emit('update', obj)
}

// Audio preview state
const isAudioPreviewing = ref(false)
const previewAudioInstance = ref<HTMLAudioElement | null>(null)

// v9.1: Recording mode toggle (animation/layout)
type RecordMode = 'animation' | 'layout'
// v14.1: Get initial value from parent prop, solving reset to default on v-else rebuild
const recordMode = ref<RecordMode>(props.objectRecordMode ?? 'layout')

// v14.1: Sync to local ref when parent objectRecordMode changes
watch(() => props.objectRecordMode, (newMode) => {
  if (newMode !== undefined) {
    recordMode.value = newMode
  }
})

// v9.2: Watch recordMode change and notify parent component
watch(recordMode, (newMode) => {
  emit('recordModeChange', newMode)
})

// Expression picker dialog state
const showExpressionDialog = ref(false)
// v18: Standalone expression object switch dialog state
const showExpressionObjectDialog = ref(false)

// v18: Standalone expression object info
const expressionObjectInfo = computed(() => {
  if (localObject.value?.type !== 'expression') return null
  const expr = expressionStore.getExpression(localObject.value.refId)
  if (!expr) return null
  return {
    name: expr.name,
    thumbnailUrl: expr.defaultFrame?.url ? getImageUrl(expr.defaultFrame.url) : null,
    flipH: expr.flipHorizontal ?? false,
  }
})

// v18: Standalone expression object switch handling
async function handleExpressionObjectSwitch(expressionId: string) {
  showExpressionObjectDialog.value = false
  if (localObject.value?.type !== 'expression') return

  if (props.isActionMode) {
    // Action Mode: emit materialActionUpdate -> ActionEditor creates/updates set_material Action
    emit('materialActionUpdate', expressionId)
  } else {
    // Setup Mode: update refId directly
    // Automatically fill missing defaultRefId (legacy compatibility: records original value on first switch)
    const expr = localObject.value as ExpressionObject
    if (!expr.defaultRefId) {
      expr.defaultRefId = expr.refId
    }
    localObject.value.refId = expressionId
    sceneObjectStore.updateObject(localObject.value.id, {
      refId: expressionId,
      defaultRefId: expr.defaultRefId,
    } as Partial<ExpressionObject>)
    await syncSelectedObjectMeasuredSize()
    emit('update', localObject.value)
  }
}

// Whether expression modified (refId ≠ defaultRefId)
const expressionIsModified = computed(() => {
  if (localObject.value?.type !== 'expression') return false
  const expr = localObject.value as ExpressionObject
  // Legacy data without defaultRefId treated as unmodified
  if (!expr.defaultRefId) return false
  return expr.refId !== expr.defaultRefId
})

// Reset to default expression
function handleRestoreDefaultExpression() {
  if (localObject.value?.type !== 'expression') return
  const expr = localObject.value as ExpressionObject
  if (!expr.defaultRefId) return

  if (props.isActionMode) {
    // Action Mode: emit materialActionUpdate -> ActionEditor creates/updates set_material Action
    emit('materialActionUpdate', expr.defaultRefId)
  } else {
    // Setup Mode: update refId directly
    localObject.value.refId = expr.defaultRefId
    emit('update', localObject.value)
  }
}

// Set as default expression
function handleSetDefaultExpression() {
  if (localObject.value?.type !== 'expression') return
  const expr = localObject.value as ExpressionObject
  expr.defaultRefId = expr.refId
  emit('update', localObject.value)
}

// Initial expression
const initialExpression = ref<string>('')


// Determine whether it is a camera object
const isCamera = computed(() => {
  return localObject.value?.type === 'camera' || localObject.value?.name === 'Camera'
})

const isAmbientLight = computed(() => {
  if (localObject.value?.type !== 'light') return false
  return (localObject.value as LightObject).lightType === 'ambient'
})

const showReceiveLighting = computed(() => {
  if (!localObject.value) return false
  const obj = localObject.value
  if (obj.type === 'prop' || obj.type === 'symbol' || obj.type === 'expression' || obj.type === 'text') return true
  if (obj.type === 'composite') {
    return (obj as CompositeObject).compositeMode === 'entity'
  }
  return false
})

const showCastShadow = computed(() => {
  if (!localObject.value) return false
  const obj = localObject.value
  if (obj.type === 'prop' || obj.type === 'symbol' || obj.type === 'expression') return true
  if (obj.type === 'composite') {
    return (obj as CompositeObject).compositeMode === 'entity'
  }
  return false
})

// v25.6: Removed basic/advanced grouping, all light parameters flattened directly

// Current recording mode (obtained from props or default camera_move)
const cameraRecordMode = computed(() => props.cameraRecordMode ?? 'camera_move')

// ==================== Camera Console Variables and Functions ====================

// const projectStore... (removed)

// Current camera action type (from currentCameraAction or default camera_move)
// v6.7: Returns mutually exclusive action types only, shake handled separately
const currentCameraActionType = computed<CameraActionType>(() => {
  if (props.currentCameraAction) {
    const type = props.currentCameraAction.type as string
    // Mutually exclusive actions
    if (['camera_cut', 'camera_move', 'camera_follow'].includes(type)) {
      return type as CameraActionType
    }
  }
  return cameraRecordMode.value
})

// v6.7: Whether shake button is active
const isShakeActive = computed(() => {
  return props.currentSlotHasShake ?? false
})


// v21: Determine whether a button should be disabled
// New mutual exclusion rules: camera_cut + camera_move can coexist, camera_follow mutually exclusive with both
function isExclusiveButtonDisabled(buttonType: CameraActionType): boolean {
  // Shake does not participate in mutual exclusion
  if (buttonType === 'camera_shake') return false
  
  // If no camera actions exist, all buttons enabled
  if (!props.currentCameraAction) return false
  
  const currentType = props.currentCameraAction.type as string
  
  // camera_follow exclusive: disable cut/move when follow exists, disable follow when cut/move exists
  if (currentType === 'camera_follow') {
    // follow exists -> cut/move disabled, follow itself enabled (selected state)
    return buttonType !== 'camera_follow'
  }
  
  // When cut or move exists -> follow disabled, cut/move both enabled
  if (currentType === 'camera_cut' || currentType === 'camera_move') {
    return buttonType === 'camera_follow'
  }
  
  return false
}

// v7.0: List of available character instances (for follow target selection)
// const availableInstances... (removed)

// Camera parameters computed
const cameraX = computed(() => {
  const action = props.currentCameraAction as { params?: { x?: number } } | null
  if (action?.params?.x !== undefined) return Math.round(action.params.x)
  return localObject.value?.x ? Math.round(localObject.value.x) : CANVAS_CENTER_X
})

const cameraY = computed(() => {
  const action = props.currentCameraAction as { params?: { y?: number } } | null
  if (action?.params?.y !== undefined) return Math.round(action.params.y)
  return localObject.value?.y ? Math.round(localObject.value.y) : CANVAS_CENTER_Y
})

const cameraZoom = computed(() => {
  // v7.19: Fix: In Action Mode, properties panel should always display object Setup value (zoom)
  // User feedback: properties panel displays scene object setup values in action mode, does not change with action
  // removed legacy code
  
  // // In Action mode, prioritize reading from action parameters
  // if (action?.params?.zoom !== undefined) return action.params.zoom
  
  // If no action or action lacks zoom parameter, read from camera object
  if (localObject.value?.type === 'camera') {
    return (localObject.value as { zoom?: number }).zoom ?? 1.0
  }
  
  return 1.0
})

// Camera zoom display value (read from camera in Setup mode, from action params in Action mode)
const cameraZoomDisplay = computed(() => {
  if (props.isActionMode) {
    return cameraZoom.value
  }
  // Setup mode: read zoom from camera object
  if (localObject.value?.type === 'camera') {
    return (localObject.value as { zoom?: number }).zoom ?? 1.0
  }
  return 1.0
})

// Camera zoom percentage display value (zoom * 100)
const cameraZoomPercent = computed(() => {
  return Math.round(cameraZoomDisplay.value * 100)
})

// camera params... (removed)

// Camera action type selection handling
function handleCameraTypeSelect(actionType: CameraActionType) {
  // Simultaneously update recordMode (for cut/move)
  if (actionType === 'camera_cut' || actionType === 'camera_move') {
    emit('cameraRecordModeChange', actionType)
  }
  
  // Emit action create/update event
  let defaultParams: Record<string, unknown> = {}
  switch (actionType) {
    case 'camera_cut':
    case 'camera_move':
      defaultParams = {
        x: cameraX.value,
        y: cameraY.value,
        zoom: cameraZoom.value
      }
      break
    case 'camera_follow':
      defaultParams = {
        followTarget: '',
        damping: 0,  // Fixed value, tight follow
        offsetX: 0,
        offsetY: -50,  // Default -50, place character slightly lower
        zoom: 1,  // v6.10: Default 100%
        constrainBounds: true  // v6.10: Default constrain bounds, restrict camera within canvas
      }
      break
    case 'camera_shake':
      defaultParams = {
        intensity: 10,
        frequency: 20,
        decay: true
      }
      break
  }
  
  emit('cameraActionUpdate', actionType, defaultParams)
}

// Camera position parameter handling functions
// camera handlers... (removed)

function handleCameraZoomChange(event: Event) {
  const target = event.target as HTMLInputElement
  const percent = parseFloat(target.value)
  if (!isNaN(percent) && percent > 0) {
    const zoom = percent / 100  // Convert percentage to zoom value
    if (props.isActionMode) {
      // Action mode: emit action update event
      emit('cameraActionUpdate', currentCameraActionType.value, { zoom })
    } else {
      // Setup mode: update camera zoom property and sync width/height
      if (localObject.value?.type === 'camera') {
        const baseWidth = CAMERA_BASE_WIDTH
        const baseHeight = CAMERA_BASE_HEIGHT
        const newWidth = baseWidth / zoom
        const newHeight = baseHeight / zoom
        
        ;(localObject.value as { zoom?: number }).zoom = zoom
        localObject.value.width = newWidth
        localObject.value.height = newHeight
        emit('update', localObject.value)
      }
    }
  }
}

// Zoom slider change handling in Setup mode
function handleCameraZoomSliderChange(event: Event) {
  const target = event.target as HTMLInputElement
  const percent = parseFloat(target.value)
  if (!isNaN(percent) && percent > 0) {
    const zoom = percent / 100  // Convert percentage to zoom value
    if (localObject.value?.type === 'camera') {
      const baseWidth = CAMERA_BASE_WIDTH
      const baseHeight = CAMERA_BASE_HEIGHT
      const newWidth = baseWidth / zoom
      const newHeight = baseHeight / zoom
      
      ;(localObject.value as { zoom?: number }).zoom = zoom
      localObject.value.width = newWidth
      localObject.value.height = newHeight
      emit('update', localObject.value)
    }
  }
}

// more camera handlers... (removed)

// v11.2: isAnimatedProp deleted, using resourceAnimations uniformly

// function emitTriggerAnim... (removed)

// v11.1: Local animation default state cache (for Setup mode UI)
// v11.3: speed property removed, using values in AnimationDefinition
const animDefaultStates = ref<Map<string, { action: 'play' | 'stop', loop: boolean }>>(new Map())

// v11.1: Get animation default state (Setup mode)
function getAnimDefaultState(animName: string): 'play' | 'stop' {
  return animDefaultStates.value.get(animName)?.action ?? 'stop'
}

// v11.1: Set animation default state (Setup mode) - triggers playback and saves to scene data
function setAnimDefaultState(animName: string, action: 'play' | 'stop') {
  console.log('[ObjectPropertiesPanel] setAnimDefaultState:', animName, action)
  
  // Update local state
  const current = animDefaultStates.value.get(animName) ?? { action: 'stop', loop: true, speed: 1 }
  current.action = action
  animDefaultStates.value.set(animName, current)
  
  // v16: Access SceneObjectBase.initialAnimations directly (no assertion needed)
  if (localObject.value) {
    if (!localObject.value.initialAnimations) {
      localObject.value.initialAnimations = []
    }
    
    if (action === 'play') {
      // Add to list (if not exists)
      const existing = localObject.value.initialAnimations.find(a => a.name === animName)
      if (!existing) {
        localObject.value.initialAnimations.push({ name: animName, loop: current.loop })
      } else {
        existing.loop = current.loop
      }
    } else {
      // Remove from list
      const index = localObject.value.initialAnimations.findIndex(a => a.name === animName)
      if (index > -1) {
        localObject.value.initialAnimations.splice(index, 1)
      }
    }
    
    // Trigger update and save to scene data
    emit('update', localObject.value)
  }
  
  // v11.52: Removed instant animation play/stop trigger
  // Only marks default play state in Setup mode, does not play actively
  // Animations take effect during Preview/Export according to initialAnimations
}

// v11.1: Get animation loop setting (Setup mode)
function getAnimLoop(animName: string): boolean {
  return animDefaultStates.value.get(animName)?.loop ?? true
}

// v11.1: Set animation loop (Setup mode)
function setAnimLoop(animName: string, loop: boolean) {
  console.log('[ObjectPropertiesPanel] setAnimLoop:', animName, loop)
  
  const current = animDefaultStates.value.get(animName) ?? { action: 'stop', loop: true }
  current.loop = loop
  animDefaultStates.value.set(animName, current)
  
  // v11.3: Synchronously save to initialAnimations
  if (localObject.value && current.action === 'play') {
    const obj = localObject.value
    if (obj.initialAnimations) {
      const existing = obj.initialAnimations.find(a => a.name === animName)
      if (existing) {
        existing.loop = loop
      }
    }
    emit('update', localObject.value)
  }
  
  // If playing, update loop setting
  if (current.action === 'play') {
    emit('triggerAnim', {
      animName,
      action: 'play',
      loop,
      timingMode: getResourceAnimTimingMode(animName)
    })
  }
}

// v11.3: getAnimSpeed and setAnimSpeed removed; speed uses value defined in AnimationDefinition


// ==================== Audio Control Functions (v7.5) ====================

// Update audio default play state (Setup Mode)
function updateAudioPlaybackState(state: 'play' | 'stop') {
  if (localObject.value?.type !== 'audio') return
  ;(localObject.value as AudioObject).playbackState = state
  emit('update', localObject.value)
}

// Audio state cache under Action Mode
const actionAudioState = ref<{
  action: 'play' | 'stop' | null,
  volume: number,
  loop: boolean,
  fadeIn: number,
  fadeOut: number
}>({
  action: null,
  volume: 1.0,
  loop: false,
  fadeIn: 0,
  fadeOut: 0
})

const actionTextRevealState = ref<{
  action: 'play' | 'stop' | null
}>({
  action: null,
})

// Get audio action state (Action Mode)
function getAudioActionState(): 'play' | 'stop' | null {
  return actionAudioState.value.action
}

function getTextRevealActionState(): 'play' | 'stop' | null {
  return actionTextRevealState.value.action
}

function updateTextRevealInitialState(state: 'complete' | 'typewriter') {
  if (localObject.value?.type !== 'text') return
  ;(localObject.value as TextObject).revealInitialState = state
  handleUpdate()
}

// Get audio action parameters
function getAudioActionParam(key: 'volume' | 'loop' | 'fadeIn' | 'fadeOut'): number | boolean {
  return actionAudioState.value[key]
}

// v9.4: Type-safe audio parameter getter
function getAudioActionLoop(): boolean {
  return actionAudioState.value.loop
}

function getAudioActionVolume(): number {
  return actionAudioState.value.volume
}

// Update audio action parameters
function updateAudioActionParam(key: 'volume' | 'loop' | 'fadeIn' | 'fadeOut', value: number | boolean) {
  if (key === 'loop') {
    actionAudioState.value.loop = value as boolean
  } else if (key === 'volume') {
    actionAudioState.value.volume = value as number
  } else if (key === 'fadeIn') {
    actionAudioState.value.fadeIn = value as number
  } else if (key === 'fadeOut') {
    actionAudioState.value.fadeOut = value as number
  }
  
  // If no action selected currently, default to play
  actionAudioState.value.action ??= 'play'
  
  // Trigger update event immediately
  emitTriggerAudio()
}

function emitTriggerAudio() {
  if (!actionAudioState.value.action) return
  emit('triggerAudio', {
    action: actionAudioState.value.action,
    volume: actionAudioState.value.volume,
    loop: actionAudioState.value.loop,
    fadeIn: actionAudioState.value.fadeIn,
    fadeOut: actionAudioState.value.fadeOut
  })
}

// Handle audio action (Action Mode)
function handleAudioAction(action: 'play' | 'stop') {
  actionAudioState.value.action = action
  emitTriggerAudio()
}

function handleTextRevealAction(action: 'play' | 'stop') {
  if (localObject.value?.type !== 'text') return
  actionTextRevealState.value.action = action
  emit('triggerTextReveal', { action, mode: 'typewriter' })
}

// Audio preview
async function handleAudioPreview() {
  if (isAudioPreviewing.value) {
    // Stop
    if (previewAudioInstance.value) {
      previewAudioInstance.value.pause()
      previewAudioInstance.value = null
    }
    isAudioPreviewing.value = false
    return
  }

  // Start
  if (localObject.value?.type !== 'audio') return
  const audioObj = localObject.value
  const sound = soundStore.getSound(audioObj.refId)
  if (!sound?.url) return

  const audioUrl = getAudioUrl(sound.url)
  if (!audioUrl) return

  const audio = new Audio(audioUrl)
  // Use current settings from panel
  // v7.22: Always use 100% volume and non-looping for preview in both Setup and Action modes
  const volume = 1.0
  const loop = false
  
  audio.volume = volume ?? 1.0
  audio.loop = !!loop
  
  audio.onended = () => {
    // Only reset if not looping
    if (!audio.loop) {
        isAudioPreviewing.value = false
        previewAudioInstance.value = null
    }
  }

  previewAudioInstance.value = audio
  try {
    await audio.play()
    isAudioPreviewing.value = true
  } catch (e) {
    console.warn('Preview failed', e)
    isAudioPreviewing.value = false
    previewAudioInstance.value = null
  }
}

// ==================== Action Mode Animation Control Functions ====================

// v11.1: Legacy partId animation state deleted, using resourceAnimations instead

// Truncate text
function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text
}

// Scale aspect ratio lock state
const scaleLocked = ref(true)

function toggleScaleLock() {
  scaleLocked.value = !scaleLocked.value
  if (scaleLocked.value && localObject.value) {
    localObject.value.scaleY = localObject.value.scaleX
    handleUpdate()
  }
}

// Scale ratio X (percentage)
const scalePercentX = computed({
  get: () => {
    if (!localObject.value) return 100
    return Math.round(localObject.value.scaleX * 100)
  },
  set: (value: number) => {
    if (!localObject.value) return
    const scale = Math.max(0.1, value / 100)
    localObject.value.scaleX = scale
    if (scaleLocked.value) {
      localObject.value.scaleY = scale
    }
  }
})

// Scale ratio Y (percentage)
const scalePercentY = computed({
  get: () => {
    if (!localObject.value) return 100
    return Math.round(localObject.value.scaleY * 100)
  },
  set: (value: number) => {
    if (!localObject.value) return
    const scale = Math.max(0.1, value / 100)
    localObject.value.scaleY = scale
    if (scaleLocked.value) {
      localObject.value.scaleX = scale
    }
  }
})

// Rotation angle (degrees)
const rotationDegrees = computed({
  get: () => {
    if (!localObject.value) return 0
    return Math.round((localObject.value.rotation * 180 / Math.PI) * 10) / 10
  },
  set: (value: number) => {
    if (!localObject.value) return
    localObject.value.rotation = value * Math.PI / 180
  }
})

// Display width (taking scale into account)
const displayWidth = computed({
  get: () => {
    if (!localObject.value) return 0
    return Math.round(localObject.value.width * localObject.value.scaleX)
  },
  set: (value: number) => {
    if (!localObject.value || localObject.value.width === 0) return
    if (localObject.value.type === 'mask') {
      const scaleX = Math.abs(localObject.value.scaleX) || 1
      localObject.value.width = Math.max(1, Math.round(value / scaleX))
      return
    }
    const isTextFixed = localObject.value.type === 'text'
      && ((localObject.value as unknown as Record<string, unknown>)['textBoxMode'] === 'fixed')
    if (isTextFixed) {
      const scaleX = Math.abs(localObject.value.scaleX) || 1
      localObject.value.width = Math.max(1, Math.round(value / scaleX))
      return
    }
    const newScale = Math.max(0.01, value / localObject.value.width)
    localObject.value.scaleX = newScale
    if (scaleLocked.value) {
      localObject.value.scaleY = newScale
    }
  }
})

// Display height (taking scale into account)
const displayHeight = computed({
  get: () => {
    if (!localObject.value) return 0
    return Math.round(localObject.value.height * localObject.value.scaleY)
  },
  set: (value: number) => {
    if (!localObject.value || localObject.value.height === 0) return
    if (localObject.value.type === 'mask') {
      const scaleY = Math.abs(localObject.value.scaleY) || 1
      localObject.value.height = Math.max(1, Math.round(value / scaleY))
      return
    }
    const isTextFixed = localObject.value.type === 'text'
      && ((localObject.value as unknown as Record<string, unknown>)['textBoxMode'] === 'fixed')
    if (isTextFixed) {
      const scaleY = Math.abs(localObject.value.scaleY) || 1
      localObject.value.height = Math.max(1, Math.round(value / scaleY))
      return
    }
    const newScale = Math.max(0.01, value / localObject.value.height)
    localObject.value.scaleY = newScale
    if (scaleLocked.value) {
      localObject.value.scaleX = newScale
    }
  }
})

function handleScaleXInputChange() { handleUpdate() }
function handleScaleYInputChange() { handleUpdate() }

// Use deep watch to observe all property changes of selected object
// This ensures modifications like drags and external updates sync to properties panel
watch(
  () => ({ obj: props.selectedObject, runtime: props.runtimeState, slot: props.currentSlotIndex }),
  ({ obj }: { obj: SceneObject | undefined }) => {
    if (obj) {
      // Deep copy object to ensure data synchronization
      const cloned = { ...obj } as SceneObject
      // screen_effect params is nested object, deep copy needed to avoid sharing reference with store
      if (cloned.type === 'screen_effect' && 'params' in cloned) {
        (cloned as unknown as { params: Record<string, unknown> }).params = { ...((cloned as unknown as { params: Record<string, unknown> }).params) }
      }
      
      
      localObject.value = cloned

      
      
      // Initialize audio Action Mode state
      if (obj.type === 'audio') {
        const audioObj = obj
        actionAudioState.value = {
          action: null, // No action selected initially
          volume: (audioObj as AudioObject).volume ?? 1.0,
          loop: (audioObj as AudioObject).loop ?? false,
          fadeIn: (audioObj as AudioObject).fadeIn ?? 0,
          fadeOut: (audioObj as AudioObject).fadeOut ?? 0
        }
      }
      
      // v16: Initialize animDefaultStates from initialAnimations
      animDefaultStates.value.clear()
      if (obj.initialAnimations && obj.initialAnimations.length > 0) {
        for (const anim of obj.initialAnimations) {
          animDefaultStates.value.set(anim.name, { action: 'play', loop: anim.loop })
        }
      }
    } else {
      localObject.value = null

      initialExpression.value = ''
    }
  },
  { immediate: true, deep: true }
)

// Watcher to stop preview when object changes
watch(
  () => props.selectedObject?.id,
  () => {
    if (isAudioPreviewing.value) {
      if (previewAudioInstance.value) {
        previewAudioInstance.value.pause()
        previewAudioInstance.value = null
      }
      isAudioPreviewing.value = false
    }
  }
)

function handleUpdate() {
  if (localObject.value) {
    emit('update', localObject.value)
  }
}

/**
 * Screen effect parameter change handling
 * Modify specified key in params, trigger store update + PIXI redraw
 */
function handleScreenEffectParamChange(key: string, value: string | number) {
  if (localObject.value?.type !== 'screen_effect') return
  const params = (localObject.value as ScreenEffectObject).params as Record<string, unknown>
  params[key] = value

  // When switching holeShape, auto adjust holeWidth/holeHeight to match shape semantics
  if (key === 'holeShape') {
    const w = (params['holeWidth'] as number) ?? 600
    const h = (params['holeHeight'] as number) ?? 600
    if (value === 'horizontal_ellipse' && w < h) {
      // Horizontal ellipse: width should be larger than height, swap
      params['holeWidth'] = h
      params['holeHeight'] = w
    } else if (value === 'vertical_ellipse' && h < w) {
      // Vertical ellipse: height should be larger than width, swap
      params['holeWidth'] = h
      params['holeHeight'] = w
    } else if (value === 'circle') {
      // Circle: unify width and height to smaller value
      const minDim = Math.min(w, h)
      params['holeWidth'] = minDim
      params['holeHeight'] = minDim
    }
  }

  emit('update', localObject.value)
}

/**
 * v25: Light parameter change handling
 */
function handleLightParamChange(
  key: 'lightColor' | 'lightIntensity' | 'lightRadius' | 'flicker' | 'flickerSpeed' | 'directionMode' | 'directionAngle' | 'coneAngle',
  value: string | number
) {
  if (localObject.value?.type !== 'light') return
  const lightObj = localObject.value as LightObject
  if (key === 'lightColor') {
    lightObj.lightColor = value as string
  } else if (key === 'lightIntensity') {
    lightObj.lightIntensity = value as number
  } else if (key === 'lightRadius') {
    lightObj.lightRadius = value as number
  } else if (key === 'flicker') {
    lightObj.flicker = value as number
  } else if (key === 'flickerSpeed') {
    lightObj.flickerSpeed = value as number
  } else if (key === 'directionMode') {
    lightObj.directionMode = value as 'omni' | 'cone'
  } else if (key === 'directionAngle') {
    lightObj.directionAngle = value as number
  } else if (key === 'coneAngle') {
    lightObj.coneAngle = value as number
  }
  emit('update', localObject.value)
}

/**
 * Clip-Mask Phase 1: Mask property change handling (from MaskShapeSection / MaskTargetsSection)
 */
function handleMaskChange(patch: Partial<MaskObject>) {
  if (localObject.value?.type !== 'mask') return
  debugLog('mask', '[MASK-DEBUG] ObjectPropertiesPanel.handleMaskChange\n' + JSON.stringify({ id: localObject.value.id, patch }, null, 2))
  const target = localObject.value as unknown as Record<string, unknown>
  for (const k of Object.keys(patch)) {
    target[k] = (patch as Record<string, unknown>)[k]
  }
  emit('update', localObject.value)
}

/**
 * Text PRD Phase 0 + Phase 1: Text property change handling
 */
function handleTextPropertyChange(key: string, value: string | number | boolean | undefined) {
  if (localObject.value?.type !== 'text') return
  const target = localObject.value as unknown as Record<string, unknown>
  target[key] = value

  if (key === 'revealSpeed') {
    const raw = Number(value)
    if (Number.isFinite(raw)) {
      target['revealSpeed'] = Math.max(0.5, Math.min(60, raw))
    } else {
      target['revealSpeed'] = 8
    }
  }

  // Legacy compatibility: if lineHeight matches old auto value (fontSize*1.3), normalize to auto line height
  const normalizedLineHeight = resolveTextLineHeight(
    target['fontFamily'] as string | undefined,
    Number(target['fontSize'] ?? 72),
    target['lineHeight'] as number | undefined,
  )
  if (normalizedLineHeight.source !== 'explicit') {
    delete target['lineHeight']
  } else {
    target['lineHeight'] = normalizedLineHeight.lineHeight
  }

  // When switching to linear gradient, auto supply default color stops to avoid visual stagnation
  if (key === 'fillType' && value === 'linear_gradient') {
    const currentStops = target['gradientStops'] as { offset: number; color: string }[] | undefined
    if (!currentStops || currentStops.length === 0) {
      const baseColor = (target['color'] as string | undefined) ?? '#ffffff'
      target['gradientStops'] = [
        { offset: 0, color: baseColor },
        { offset: 1, color: '#000000' },
      ]
    }
    if (target['gradientAngle'] === undefined) {
      target['gradientAngle'] = 90
    }
  }

  if (key === 'textBoxMode' && value === 'fixed') {
    const content = normalizeTextContent((target['content'] as string | undefined) ?? '')
    const fontSize = Number(target['fontSize'] ?? 72)
    const lineHeight = Number(target['lineHeight'] ?? getAutoTextLineHeight(target['fontFamily'] as string | undefined, fontSize))
    const lines = Math.max(1, content.split('\n').length)
    const estimatedHeight = Math.ceil(lines * lineHeight + 24)
    const currentHeight = Number(target['height'] ?? 0)
    if (!Number.isFinite(currentHeight) || currentHeight < estimatedHeight) {
      target['height'] = estimatedHeight
    }
    const minWidth = Number(target['wordWrapWidth'] ?? 400)
    const currentWidth = Number(target['width'] ?? 0)
    if (!Number.isFinite(currentWidth) || currentWidth < minWidth) {
      target['width'] = minWidth
    }
    const safeWrapWidth = Math.max(50, Number(target['width'] ?? minWidth))
    target['wordWrapWidth'] = safeWrapWidth
  }

  if (key === 'textBoxMode' && value === 'auto-size') {
    target['wordWrap'] = false
  }

  if (key === 'textBackgroundEnabled' && value === true) {
    target['textBackgroundColor'] ??= '#000000'
    target['textBackgroundAlpha'] ??= 0.35
    target['textBackgroundPaddingX'] ??= 16
    target['textBackgroundPaddingY'] ??= 10
    target['textBackgroundRadius'] ??= 8
  }

  emit('update', localObject.value)
  // When switching font: emit updated data first (PIXI renders with fallback immediately),
  // after font loads, use request sequence to prevent stale rewrites, and emit clone to trigger PIXI.Text rebuild.
  if (key === 'fontFamily' && typeof value === 'string' && value) {
    const textObj = localObject.value as TextObject | null
    const objectId = textObj?.id
    const requestId = ++textFontLoadRequestId.value
    const sampleText = textObj?.content ?? ''
    void ensureFontLoaded(value, sampleText).then(() => {
      const latest = localObject.value as TextObject | null
      if (
        latest?.type === 'text'
        && latest.id === objectId
        && latest.fontFamily === value
        && requestId === textFontLoadRequestId.value
      ) {
        emit('update', { ...latest })
      }
    })
  }
}

/** Preset font list */
const PRESET_FONT_FAMILIES = [
  'Noto Sans SC', 'Noto Serif SC', 'LXGW WenKai',
  'ZCOOL QingKe HuangYou', 'Ma Shan Zheng',
]

/** System local font list (enumerated via queryLocalFonts API) */
const localFonts = ref<string[]>([])
const localFontsLoaded = ref(false)

/** Load system local fonts */
async function loadLocalFonts() {
  // @ts-expect-error queryLocalFonts is experimental Chrome 103+ API, types not in standard lib
  if (typeof window.queryLocalFonts !== 'function') {
    alert('Current browser does not support local font enumeration (requires Chrome/Edge 103+)')
    return
  }
  try {
    // @ts-expect-error queryLocalFonts returns FontData[], types not in standard lib
    const fonts: { family: string }[] = await (window.queryLocalFonts as () => Promise<{ family: string }[]>)()
    // Deduplicate and sort alphabetically
    const uniqueFamilies = [...new Set(fonts.map(f => f.family))]
      .filter(name => !PRESET_FONT_FAMILIES.includes(name))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    localFonts.value = uniqueFamilies
    localFontsLoaded.value = true
  } catch (e) {
    console.warn('[ObjectPropertiesPanel] Failed to load local fonts:', e)
    alert('Failed to load local fonts; permission may have been denied')
  }
}

/** Current font size */
const currentFontSize = computed(() => {
  if (localObject.value?.type !== 'text') return 32
  return ((localObject.value as unknown as Record<string, unknown>)['fontSize'] as number | undefined) ?? 72
})

/** Match value of current font size in presets (for select display) */
const fontSizePresetMatch = computed(() => {
  const size = currentFontSize.value
  return FONT_SIZE_PRESETS.includes(size) ? size : size
})

/** Font size select change */
function handleFontSizeSelectChange(value: string) {
  handleTextPropertyChange('fontSize', Number(value))
}

/** Letter spacing presets */
const LETTER_SPACING_PRESETS = [-5, -2, 0, 1, 2, 4, 6, 8, 12, 16, 20]

/** Line height presets */
const LINE_HEIGHT_PRESETS = [40, 48, 56, 64, 72, 80, 88, 96, 112, 128, 144]

const currentLetterSpacing = computed(() => {
  if (localObject.value?.type !== 'text') return 0
  return ((localObject.value as unknown as Record<string, unknown>)['letterSpacing'] as number | undefined) ?? 0
})

const letterSpacingPresetMatch = computed(() => {
  const v = currentLetterSpacing.value
  return LETTER_SPACING_PRESETS.includes(v) ? v : v
})

const currentLineHeight = computed<string | number>(() => {
  if (localObject.value?.type !== 'text') return ''
  const v = (localObject.value as unknown as Record<string, unknown>)['lineHeight'] as number | undefined
  return v ?? ''
})

const lineHeightPresetMatch = computed(() => {
  const v = currentLineHeight.value
  return v === '' ? '' : Number(v)
})

function handleLetterSpacingSelectChange(value: string) {
  handleTextPropertyChange('letterSpacing', Number(value))
}

function handleLineHeightSelectChange(value: string) {
  handleTextPropertyChange('lineHeight', value ? Number(value) : undefined)
}

/**
 * Phase 2: Gradient color stop modification handling
 * Maintain 2-stop gradientStops array
 */
function handleGradientStopChange(index: number, color: string) {
  if (localObject.value?.type !== 'text') return
  const obj = localObject.value as unknown as Record<string, unknown>
  const stops = (obj['gradientStops'] as { offset: number; color: string }[] | undefined) ?? [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#000000' },
  ]
  // Ensure at least 2 color stops
  while (stops.length < 2) {
    stops.push({ offset: stops.length === 0 ? 0 : 1, color: '#000000' })
  }
  stops[index]!.color = color
  obj['gradientStops'] = [...stops]
  emit('update', localObject.value)
}

/** Ambient light preset list (imported from unified module, mapped to legacy UI format) */
const AMBIENT_LIGHT_PRESETS = AMBIENT_PRESETS.map(p => ({
  id: p.id,
  label: p.label,
  color: p.params.lightColor,
  intensity: p.params.lightIntensity,
}))

/** Preset list for current light type (point/spot) */
const currentLightPresets = computed<LightPresetEntry[]>(() => {
  if (localObject.value?.type !== 'light') return []
  return getPresetsForLightType((localObject.value as LightObject).lightType)
})

/** Apply ambient light preset */
function handleAmbientPreset(preset: { color: string; intensity: number }) {
  if (localObject.value?.type !== 'light') return
  const lightObj = localObject.value as LightObject
  lightObj.lightColor = preset.color
  lightObj.lightIntensity = preset.intensity
  emit('update', localObject.value)
}

/** Apply point / spot light preset (one-click overwrite of all runtime parameters) */
function handleLightPresetApply(preset: LightPresetEntry) {
  if (localObject.value?.type !== 'light') return
  const lightObj = localObject.value as LightObject
  const p = preset.params
  lightObj.lightColor = p.lightColor
  lightObj.lightIntensity = p.lightIntensity
  lightObj.lightRadius = p.lightRadius
  lightObj.flicker = p.flicker
  lightObj.flickerSpeed = p.flickerSpeed
  if (p.directionAngle !== undefined) lightObj.directionAngle = p.directionAngle
  if (p.coneAngle !== undefined) lightObj.coneAngle = p.coneAngle
  emit('update', localObject.value)
}

// Rotation angle change
function handleRotationChange() {
  if (localObject.value) {
    emit('update', localObject.value)
  }
}

// When scale changes, update both scaleX and scaleY to preserve aspect ratio
// function handleScaleChange... (removed)

// Size change handling
function handleSizeChange() {
  if (localObject.value) {
    emit('update', localObject.value)
  }
}

// X coordinate change
function handleXChange(event: Event) {
  if (localObject.value) {
    const target = event.target as HTMLInputElement
    const val = parseInt(target.value, 10)
    localObject.value.x = isNaN(val) ? 0 : val
    emit('update', localObject.value)
  }
}

// Y coordinate change
function handleYChange(event: Event) {
  if (localObject.value) {
    const target = event.target as HTMLInputElement
    const val = parseInt(target.value, 10)
    localObject.value.y = isNaN(val) ? 0 : val
    emit('update', localObject.value)
  }
}


// Handle expression selection
function handleExpressionSelect(expressionId: string) {
  initialExpression.value = expressionId
  showExpressionDialog.value = false
}
</script>

<style scoped>
.properties-panel {
  height: 100%;
  overflow-y: auto;
}

.empty-hint {
  padding: 20px;
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
}

.properties-form {
  padding: 16px;
}

.property-section {
  margin-bottom: 24px;
}

.property-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
}

.light-subsection {
  margin-top: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #fafafa;
}

.light-section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: none;
  background: #f3f4f6;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.light-section-body {
  padding: 12px;
}

.property-field {
  margin-bottom: 12px;
}

.property-field label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.property-field input[type="text"],
.property-field input[type="number"],
.property-field select {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
}

.property-field input[type="range"] {
  width: 100%;
  margin-top: 8px;
}

.scale-control {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.scale-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  text-align: right;
}

.percent-label {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.scale-slider {
  width: 100%;
  margin-top: 0;
}

.value-label {
  font-size: 12px;
  color: #6b7280;
}

.readonly-value {
  display: block;
  padding: 6px 10px;
  font-size: 13px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  color: #374151;
}

.property-field.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.property-field.checkbox input[type="checkbox"] {
  width: auto;
  cursor: pointer;
}

.property-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.expression-selector-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expression-name {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expression-select-btn {
  padding: 6px 12px;
  font-size: 13px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}

.expression-select-btn:hover {
  background: #2563eb;
}

.layer-controls {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.layer-btn {
  flex: 1;
  padding: 8px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.layer-btn:hover:not(:disabled) {
  background: #e5e7eb;
  border-color: #3b82f6;
}

.layer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Action Mode slot hint styles */
.action-mode-hint {
  margin-bottom: 16px;
  padding: 12px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 1px solid #f59e0b;
  border-radius: 8px;
}

.slot-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.slot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 20px;
  padding: 0 6px;
  background: #f59e0b;
  color: white;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
}

.slot-text {
  font-size: 13px;
  color: #92400e;
  font-weight: 500;
}

.hint-text {
  font-size: 11px;
  color: #b45309;
}

.anim-control-item {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
}

.anim-part-name {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 6px;
}

.anim-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  transition: all 0.2s;
}

.control-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.control-btn.play {
  color: #10b981;
}

.control-btn.stop {
  color: #ef4444;
}

.loop-check {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
}

.speed-input {
  width: 40px;
  padding: 2px 4px;
  font-size: 11px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  text-align: center;
}

/* v16 H1: Animation group styles */
.anim-group {
  margin-bottom: 4px;
}

.anim-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.anim-group-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.btn-reapply {
  padding: 2px 8px;
  font-size: 11px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 4px;
  color: #0284c7;
  cursor: pointer;
}

.btn-reapply:hover {
  background: #e0f2fe;
}

.btn-add-playlist {
  width: 100%;
  padding: 8px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  color: #475569;
  cursor: pointer;
  font-size: 13px;
}

.btn-add-playlist:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

/* Animation default state setting styles */
.anim-default-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  margin-bottom: 12px;
}

.anim-default-hint .hint-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.anim-default-hint .hint-text {
  font-size: 12px;
  color: #0369a1;
  line-height: 1.4;
}

.anim-default-item {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
}

.anim-part-header {
  margin-bottom: 8px;
}

.anim-part-header .anim-part-name {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.anim-default-options {
  display: flex;
  gap: 8px;
}

.anim-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.anim-option input[type="radio"] {
  display: none;
}

.anim-option .option-icon {
  font-size: 12px;
  color: #6b7280;
}

.anim-option .option-label {
  font-size: 12px;
  color: #374151;
  font-weight: 500;
}

.anim-option:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.anim-option.active {
  background: #eff6ff;
  border-color: #3b82f6;
}

.anim-option.active .option-icon {
  color: #3b82f6;
}

.anim-option.active .option-label {
  color: #1d4ed8;
}

/* Animation extra settings styles */
.anim-extra-settings {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
}

.anim-loop-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
}

.anim-loop-option input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.anim-speed-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
}

.speed-input-small {
  width: 50px;
  padding: 2px 4px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  text-align: center;
}

/* Action Mode animation action styles */
.action-record-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 1px solid #f59e0b;
  border-radius: 6px;
  margin-bottom: 12px;
}

.action-record-hint .hint-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.action-record-hint .hint-text {
  font-size: 12px;
  color: #92400e;
  line-height: 1.4;
}

.action-record-hint .hint-text strong {
  color: #b45309;
  font-weight: 600;
}

.anim-action-item {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
}

.anim-action-header {
  margin-bottom: 8px;
}

.anim-action-header .anim-part-name {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.anim-action-options {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.action-option-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-option-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.action-option-btn.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.action-option-btn.play.selected {
  border-color: #10b981;
  background: #ecfdf5;
}

.action-option-btn.play.selected .btn-icon {
  color: #10b981;
}

.action-option-btn.stop.selected {
  border-color: #ef4444;
  background: #fef2f2;
}

.action-option-btn.stop.selected .btn-icon {
  color: #ef4444;
}

.text-reveal-action-card {
  background: #f8fafc;
}

.text-reveal-default-card {
  background: #f8fafc;
}

.text-reveal-action-card .anim-action-options {
  margin-bottom: 0;
}

.anim-option.text-reveal-start-option.active {
  border-color: #10b981;
  background: #ecfdf5;
}

.anim-option.text-reveal-start-option.active .option-icon,
.anim-option.text-reveal-start-option.active .option-label {
  color: #047857;
}

.anim-option.text-reveal-complete-option.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.anim-option.text-reveal-complete-option.active .option-icon,
.anim-option.text-reveal-complete-option.active .option-label {
  color: #1d4ed8;
}

.action-option-btn.text-reveal-start.selected {
  border-color: #10b981;
  background: #ecfdf5;
}

.action-option-btn.text-reveal-start.selected .btn-icon,
.action-option-btn.text-reveal-start.selected .btn-label {
  color: #047857;
}

.action-option-btn.text-reveal-complete.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.action-option-btn.text-reveal-complete.selected .btn-icon,
.action-option-btn.text-reveal-complete.selected .btn-label {
  color: #1d4ed8;
}

.action-option-btn .btn-icon {
  font-size: 12px;
  color: #6b7280;
}

.action-option-btn .btn-label {
  font-size: 12px;
  color: #374151;
  font-weight: 500;
}

.preview-audio-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  font-weight: 500;
}

.preview-audio-btn:hover {
  background: #2563eb;
}

.preview-audio-btn.playing {
  background: #ef4444;
}

.preview-audio-btn.playing:hover {
  background: #dc2626;
}

.anim-action-extras {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
}

.action-loop-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
}

.action-loop-option input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.action-speed-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
}

/* Camera action button styles */
/* v6.5: Camera console styles */
.camera-console {
  padding: 12px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border: 1px solid #bae6fd;
  border-radius: 8px;
}

.camera-console .console-label {
  font-size: 11px;
  color: #0369a1;
  margin-bottom: 8px;
  font-weight: 500;
}

.camera-console .camera-mode-tabs {
  display: flex;
  gap: 4px;
  background: white;
  padding: 4px;
  border-radius: 6px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
}

.camera-console .camera-mode-btn {
  flex: 1;
  padding: 8px 4px;
  font-size: 11px;
  border: none;
  background: transparent;
  color: #6b7280;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.camera-console .camera-mode-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #374151;
}

.camera-console .camera-mode-btn.active {
  background: #0284c7;
  color: white;
  font-weight: 600;
  box-shadow: 0 2px 4px rgba(2, 132, 199, 0.3);
}

.camera-console .camera-mode-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.camera-console .console-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: #0369a1;
  background: white;
  border-radius: 6px;
  border-left: 3px solid #0284c7;
}

.camera-console .console-hint .hint-icon {
  font-size: 14px;
}

.camera-console .slot-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
}

.camera-console .slot-indicator .slot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding: 0 6px;
  background: #0284c7;
  color: white;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
}

.camera-console .slot-indicator .slot-text {
  color: #475569;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Camera parameters panel styles */
.slot-indicator-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 6px 10px;
  background: #f8fafc;
  border-radius: 6px;
}

.slot-indicator-row .slot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 8px;
  background: #0284c7;
  color: white;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
}

.slot-indicator-row .slot-text {
  color: #475569;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.camera-params-section {
  margin-top: 12px;
  padding: 12px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.camera-mode-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 8px 10px;
  font-size: 12px;
  color: #0369a1;
  background: #f0f9ff;
  border-radius: 6px;
  border-left: 3px solid #0284c7;
}

.camera-mode-hint .hint-icon {
  font-size: 14px;
}

.camera-param-row {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}

.camera-param-row:last-child {
  margin-bottom: 0;
}

.camera-param-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.camera-param-item.full-width {
  flex: unset;
  width: 100%;
  margin-bottom: 10px;
}

.camera-param-item.full-width:last-child {
  margin-bottom: 0;
}

.camera-param-item label {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}

.camera-param-item label .hint-text {
  font-weight: normal;
  color: #94a3b8;
  font-size: 10px;
}

.camera-param-item input[type="number"],
.camera-param-item select {
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
  background: white;
}

.camera-param-item input[type="number"]:focus,
.camera-param-item select:focus {
  outline: none;
  border-color: #0284c7;
  box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.1);
}

.camera-param-item .range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.camera-param-item .range-row input[type="range"] {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #e2e8f0;
  border-radius: 2px;
}

.camera-param-item .range-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #0284c7;
  border-radius: 50%;
  cursor: pointer;
}

.camera-param-item .range-row .value-label {
  min-width: 30px;
  font-size: 12px;
  font-weight: 600;
  color: #0284c7;
  text-align: right;
}

.camera-param-item .checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
}

.camera-param-item .checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

/* Part material selector styles */
.part-asset-selector-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.current-asset-name {
  flex: 1;
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.part-asset-select-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.part-asset-select-btn:hover {
  background: #e5e7eb;
  border-color: #9ca3af;
}

/* Part material thumbnail preview */
.part-asset-preview {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}

.part-asset-preview:hover {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.part-asset-thumb {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.part-asset-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  opacity: 0.5;
}

/* P2: Tree object selector */
.object-selector-section {
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.tree-dropdown {
  position: relative;
  width: 100%;
}

.tree-dropdown-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.tree-dropdown-trigger:hover {
  border-color: #93c5fd;
}

.tree-dropdown-trigger:focus {
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.trigger-content {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.trigger-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2937;
}

.trigger-placeholder {
  flex: 1;
  color: #9ca3af;
}

.trigger-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: #6b7280;
  margin-left: 6px;
}

.tree-dropdown-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 50;
  padding: 4px;
}

.tree-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  gap: 4px;
  transition: background 0.1s;
  user-select: none;
}

.tree-item:hover {
  background: #f0f4ff;
}

.tree-item.selected {
  background: #3b82f6;
  color: white;
}

.tree-item.selected .tree-item-label {
  font-weight: 500;
}

.tree-item.inactive {
  opacity: 0.45;
}

.tree-item.child-item {
  padding-left: 24px;
}

.tree-toggle-btn {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 9px;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  transition: all 0.15s;
  padding: 0;
}

.tree-toggle-btn:hover {
  background: #e5e7eb;
  color: #1f2937;
}

.tree-item.selected .tree-toggle-btn {
  color: rgba(255, 255, 255, 0.8);
}

.tree-item.selected .tree-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.tree-indent {
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  font-size: 12px;
  color: #9ca3af;
}

.tree-item.selected .tree-indent {
  color: rgba(255, 255, 255, 0.7);
}

.tree-indent-spacer {
  width: 18px;
  flex-shrink: 0;
}

.tree-item-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.tree-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* v8.6: Alias editing */
.alias-field {
  margin-top: 4px;
}

.alias-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.alias-edit-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.alias-value {
  flex: 1;
  font-size: 13px;
  color: #374151;
}

.alias-edit-btn {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.alias-edit-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.preset-name-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.preset-name-select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  color: #374151;
}

/* v9.1: Record mode toggle */
.record-mode-section {
  padding: 8px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(to right, #fef3c7, #fde68a);
  display: flex;
  align-items: center;
  gap: 12px;
}

.record-mode-label {
  font-size: 12px;
  font-weight: 600;
  color: #78350f;
  white-space: nowrap;
}

.record-mode-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
}

.record-mode-btn {
  flex: 1;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #d97706;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.6);
  color: #92400e;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.record-mode-btn:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: #b45309;
}

.record-mode-btn.active {
  background: #d97706;
  color: white;
  border-color: #b45309;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Group Management Styles (Migrated) */
.part-groups-section {
  margin-top: 8px;
}

.group-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  border-top: 1px dashed #e5e7eb;
  padding-top: 12px;
}

.groups-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  color: #4b5563;
}

.group-name {
  font-weight: 500;
}

.group-actions {
  display: flex;
  gap: 4px;
}

.btn-icon-small {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.btn-icon-small:hover {
  background: #f3f4f6;
  color: #3b82f6;
  border-color: #3b82f6;
}

.btn-icon-mini {
  width: 22px; 
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  color: #6b7280;
  font-size: 14px;
}

.btn-icon-mini:hover {
  background: #f3f4f6;
  color: #374151;
}

.btn-icon-mini.btn-delete:hover {
  color: #ef4444;
  background: #fee2e2;
}

/* ==================== P2: Composite UI ==================== */

.parent-composite-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: linear-gradient(135deg, #dbeafe, #ede9fe);
  border: 1px solid #93c5fd;
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 12px;
}

.parent-composite-hint .hint-label {
  color: #6b7280;
  white-space: nowrap;
}

.parent-composite-hint .hint-name {
  font-weight: 600;
  color: #1e40af;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parent-composite-hint .hint-name-clickable {
  background: none;
  border: none;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: inherit;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}

.parent-composite-hint .hint-name-clickable:hover {
  background: rgba(59, 130, 246, 0.15);
  color: #1d4ed8;
  text-decoration: underline;
}

.remove-from-group-btn {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid #93c5fd;
  border-radius: 4px;
  background: white;
  color: #3b82f6;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.remove-from-group-btn:hover {
  background: #3b82f6;
  color: white;
}

/* compositeMode read-only display */
.composite-mode-readonly {
  font-size: 12px;
  color: #374151;
  font-weight: 500;
}

/* Ambient light preset grid */
.ambient-preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 4px;
}

.ambient-preset-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #fafafa;
  cursor: pointer;
  font-size: 11px;
  color: #374151;
  transition: all 0.15s ease;
}

.ambient-preset-btn:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.preset-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}

.preset-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composite-children-list {
  margin-top: 8px;
}

.children-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
  padding: 4px 0;
  border-bottom: 1px solid #e5e7eb;
}

.add-child-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
  color: #6b7280;
  transition: all 0.15s;
}

.add-child-btn:hover {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.child-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s;
  cursor: default;
}

.child-item.child-item-clickable {
  cursor: pointer;
}

.child-item.child-item-clickable:hover {
  background: #dbeafe;
}

.child-item[draggable="true"] {
  cursor: grab;
}

.child-item[draggable="true"]:active {
  cursor: grabbing;
}

.child-item.drag-over {
  background: #dbeafe;
  border: 1px dashed #3b82f6;
  border-radius: 4px;
}

.drag-handle {
  font-size: 14px;
  color: #9ca3af;
  cursor: grab;
  flex-shrink: 0;
  user-select: none;
  line-height: 1;
}

.drag-handle:active {
  cursor: grabbing;
}

.render-order-hint {
  text-align: center;
  font-size: 10px;
  color: #9ca3af;
  padding: 2px 0;
  letter-spacing: 1px;
}

.zindex-divider {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin: 4px 0 2px;
}

.zindex-divider::before,
.zindex-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e5e7eb;
}

.zindex-label {
  font-size: 10px;
  color: #9ca3af;
  white-space: nowrap;
  font-family: monospace;
}

.child-item:hover {
  background: #f3f4f6;
}

.child-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.child-name {
  flex: 1;
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-child-btn {
  padding: 2px 6px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  color: #6b7280;
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s;
}

.child-item:hover .remove-child-btn {
  opacity: 1;
}

.reorder-btns {
  display: flex;
  flex-direction: row;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.child-item:hover .reorder-btns {
  opacity: 1;
}

.reorder-btn {
  padding: 4px 8px;
  font-size: 14px;
  line-height: 1;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.reorder-btn:hover:not(:disabled) {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.reorder-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* === Render chain order UI === */
.render-chain-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.render-chain-controls {
  display: flex;
  gap: 4px;
}

.rc-move-btn {
  padding: 2px 8px;
  font-size: 13px;
  line-height: 1;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}

.rc-move-btn:hover:not(:disabled) {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.rc-move-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.rc-item {
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
  border: 1px solid transparent;
  border-radius: 4px;
}

.rc-item:hover {
  background: #f3f4f6;
}

.rc-selected {
  background: #eff6ff !important;
  border-color: #93c5fd;
}

.rc-drag-over {
  border-color: #3b82f6;
  background: #dbeafe !important;
}

.rc-drag-handle {
  font-size: 14px;
  color: #c4c9d0;
  cursor: grab;
  flex-shrink: 0;
  letter-spacing: -2px;
  user-select: none;
  transition: color 0.15s;
}

.rc-item:hover .rc-drag-handle {
  color: #9ca3af;
}

.rc-drag-handle:active {
  cursor: grabbing;
}

.remove-child-btn:hover {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.empty-children {
  padding: 8px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  font-style: italic;
}

.composite-actions {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
}

.composite-action-btn {
  width: 100%;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
}

.composite-action-btn:hover {
  background: #f3f4f6;
}

.composite-action-btn.danger {
  border-color: #fca5a5;
  color: #dc2626;
}

.composite-action-btn.danger:hover {
  background: #fef2f2;
  border-color: #f87171;
}

/* ===== Symbol Material Preview ===== */
.symbol-preview-area {
  display: flex;
  gap: 12px;
  padding: 8px 0;
}

.symbol-preview-frame {
  width: 80px;
  height: 80px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.symbol-preview-frame img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.symbol-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: #9ca3af;
  font-size: 11px;
}

.symbol-preview-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.symbol-current-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.symbol-material-count {
  font-size: 11px;
  color: #6b7280;
}
.symbol-material-path {
  font-size: 10px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  cursor: default;
}

/* v18: Expression reference card */
.expression-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.expression-card:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}
.expression-card:active {
  background: #e5e7eb;
}

.expression-card-thumb {
  width: 48px;
  height: 48px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.expression-card-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.expression-card-info {
  flex: 1;
  min-width: 0;
}
.expression-card-name {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.expression-card-hint {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 2px;
}

.expression-card-action {
  flex-shrink: 0;
  font-size: 16px;
  opacity: 0.4;
  transition: opacity 0.15s ease;
}
.expression-card:hover .expression-card-action {
  opacity: 0.8;
}

.expression-default-badge {
  font-size: 10px;
  margin-left: 4px;
  vertical-align: middle;
}

.expression-default-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  padding: 0 2px;
}

.expression-action-link {
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s;
}

.expression-action-link.restore {
  color: #60a5fa;
}

.expression-action-link.restore:hover {
  color: #93bbfd;
}

.expression-action-link.set-default {
  color: #9ca3af;
}

.expression-action-link.set-default:hover {
  color: #d1d5db;
}

.symbol-manage-btn {
  margin-top: 4px;
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  width: fit-content;
}
.symbol-manage-btn:hover {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #2563EB;
}

/* ===== Symbol Quick Switch Grid ===== */
.symbol-switch-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
}

.symbol-switch-item {
  width: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: #f9fafb;
}
.symbol-switch-item:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}
.symbol-switch-item.active {
  border-color: #2563EB;
  background: #eff6ff;
}
.symbol-switch-item img {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
}
.switch-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.switch-name {
  font-size: 10px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 52px;
  text-align: center;
}

/* ===== Quick action toolbar ===== */
.quick-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  border-bottom: 1px solid #f0f0f0;
}

.quick-toolbar-header {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 2px;
}

.quick-toolbar-title {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  letter-spacing: 0.02em;
}

.quick-toolbar-subtitle {
  font-size: 11px;
  color: #64748b;
}

.quick-toolbar.with-record-mode {
  margin-top: 12px;
}

.quick-toolbar.setup-toolbar {
  margin-top: 2px;
}

.quick-toolbar-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.quick-toolbar-group--compact {
  flex: 0 0 auto;
}

.quick-toolbar-group--fill {
  flex: 1 1 220px;
}

.quick-toolbar-group-label {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  line-height: 1;
}

.qt-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  user-select: none;
}

.qt-toggle:hover {
  border-color: #93c5fd;
  background: #f0f5ff;
}

.qt-toggle input[type="checkbox"] {
  margin: 0;
}

.qt-toggle-label {
  font-size: 12px;
}

/* ===== Through-status indicator ===== */
.pass-through-indicator {
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  background: linear-gradient(135deg, #f0f5ff, #e8f0fe);
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}

.pt-status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.pt-icon {
  font-size: 16px;
}

.pt-text {
  font-size: 12px;
  color: #1e40af;
  font-weight: 500;
}

.pt-actions {
  display: flex;
  gap: 6px;
}

.pt-btn {
  flex: 1;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid #93c5fd;
  background: white;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  color: #374151;
}

.pt-btn:hover {
  background: #dbeafe;
}

.pt-btn.active {
  border-color: #3b82f6;
  color: #1d4ed8;
}

.pt-btn.remove {
  border-color: #fca5a5;
  color: #dc2626;
}

.pt-btn.remove:hover {
  background: #fee2e2;
}

.qt-pt-btn {
  min-height: 34px;
  padding: 6px 10px;
  border: 1px dashed #d1d5db;
  background: transparent;
  border-radius: 8px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.qt-pt-btn:hover {
  border-color: #93c5fd;
  background: #f0f5ff;
  color: #2563eb;
}

@media (max-width: 520px) {
  .quick-toolbar-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .quick-toolbar-group,
  .quick-toolbar-group--fill {
    width: 100%;
    flex-basis: 100%;
  }

  .qt-toggle,
  .qt-pt-btn {
    width: 100%;
    justify-content: center;
  }
}

/* Text properties */
.text-content-input {
  width: 100%;
  resize: vertical;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  background: white;
}

.text-content-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.font-select {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  background: white;
}

.text-align-group {
  display: flex;
  gap: 4px;
}

.text-align-btn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}

.text-align-btn:hover {
  background: #f3f4f6;
}

.text-align-btn.active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

/* Phase 1: Sub-section headings within text properties */
.sub-section-heading {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 8px;
  margin-bottom: 2px;
  padding-bottom: 2px;
  border-bottom: 1px solid #e5e7eb;
}

/* FR-0.11: Custom font disclaimer */
.font-warning-tip {
  font-size: 11px;
  color: #d97706;
  margin-top: 4px;
  line-height: 1.3;
}

/* Load local font button */
.load-fonts-btn {
  margin-top: 4px;
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  color: #6b7280;
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.load-fonts-btn:hover {
  color: #3b82f6;
  border-color: #93c5fd;
  background: #eff6ff;
}


/* Phase 2: Animation parameter unit suffix */
.value-label {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
}
</style>

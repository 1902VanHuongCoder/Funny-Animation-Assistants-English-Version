<template>
  <div class="action-inspector">
    <div
      v-if="!action"
      class="empty-hint"
    >
      Select an action to inspect properties
    </div>
    
    <div
      v-else
      class="inspector-form"
    >
      <!-- Header -->
      <div class="inspector-header">
        <div class="target-object">
          <span class="target-icon">{{ getActionHeaderIcon(action!) }}</span>
          <span class="target-name">{{ getActionHeaderTitle(action!) }}</span>
        </div>
        <span
          class="action-type-badge"
          :class="action!['category']"
        >
          {{ action!['category'] === 'point' ? '◆ Instant' : '═ Duration' }}
        </span>
      </div>

      <!-- Timing Settings (v6.2) -->
      <div class="property-section">
        <h4>Timing Settings</h4>
        <div class="property-field">
          <label>Slot:</label>
          <select
            :value="action!['slotIndex']"
            @change="handleSlotIndexChange"
          >
            <option 
              v-for="slot in slots" 
              :key="slot.index" 
              :value="slot.index"
            >
              #{{ slot.index + 1 }} {{ getSlotLabel(slot) }}
            </option>
          </select>
        </div>
        <div
          v-if="action!['category'] === 'duration'"
          class="property-field"
        >
          <label>Span:</label>
          <input
            :value="(action as BaseDurationAction)['slotSpan'] ?? 1"
            type="number"
            min="1"
            step="1"
            @change="handleSlotSpanChange"
          >
        </div>
      </div>

      <!-- Parameter Configuration (v6.3 Delta Mode) -->
      <div class="property-section">
        <h4>Modified Properties</h4>
        
        <!-- set_character removed -->

        <!-- set_transform: visual properties + geometry properties (v9.2) -->
        <template v-if="action!['type'] === 'set_transform'">
          <!-- v9.2: Death Action simplified panel -->
          <template v-if="isCurrentDeathAction">
            <div class="death-action-panel">
              <div class="death-icon">🍂</div>
              <div class="death-label">Object Despawned</div>
              <div class="death-hint">The object is no longer rendered after despawning and its properties cannot be edited</div>
            </div>
          </template>
          <!-- Normal property editor -->
          <template v-else>
            <!-- Geometry properties (v9.2) -->
            <template
              v-for="prop in activeGeometryProps"
              :key="prop.key"
            >
              <div class="delta-property-item">
                <div class="delta-property-header">
                  <span class="delta-property-label">{{ prop.label }}</span>
                  <button
                    class="delta-remove-btn"
                    title="Remove"
                    @click="removeGeometryProp(prop.key)"
                  >
                    ×
                  </button>
                </div>
                <!-- Percentage type -->
                <template v-if="prop.type === 'percent'">
                  <div class="percent-input-row" style="display: flex; align-items: center;">
                    <input
                      v-model.number="geometryParams[prop.key]"
                      type="number"
                      step="1"
                      @change="(prop.key === 'scaleX' || prop.key === 'scaleY') ? handleScaleChange(prop.key) : handleSetTransformGeometryChange()"
                    >
                    <span class="percent-label">%</span>
                    <button 
                      v-if="prop.key === 'scaleX'"
                      class="lock-btn" 
                      style="background: none; border: none; cursor: pointer; padding: 0 4px; font-size: 14px; margin-left: 6px; opacity: 0.8;"
                      :title="scaleLocked ? 'Unlock Ratio' : 'Lock Ratio'"
                      @click="toggleScaleLock"
                    >
                      {{ scaleLocked ? '🔗' : '🔓' }}
                    </button>
                  </div>
                </template>
                <!-- Degree type -->
                <template v-else-if="prop.type === 'degree'">
                  <div class="degree-input-row">
                    <input
                      v-model.number="geometryParams[prop.key]"
                      type="number"
                      step="1"
                      @change="handleSetTransformGeometryChange"
                    >
                    <span class="degree-label">°</span>
                  </div>
                </template>
                <!-- Normal number type -->
                <template v-else>
                  <input
                    v-model.number="geometryParams[prop.key]"
                    type="number"
                    :step="prop.step ?? 1"
                    @change="handleSetTransformGeometryChange"
                  >
                </template>
              </div>
            </template>
            
            <!-- Visual properties -->
            <template
              v-for="prop in activeVisualProps"
              :key="prop.key"
            >
              <div class="delta-property-item">
                <div class="delta-property-header">
                  <span class="delta-property-label">{{ prop.label }}</span>
                  <button
                    class="delta-remove-btn"
                    title="Remove"
                    @click="removeVisualProp(prop.key)"
                  >
                    ×
                  </button>
                </div>
                <template v-if="prop.type === 'number'">
                  <input
                    v-model.number="visualParams[prop.key]"
                    type="number"
                    :step="prop.step ?? 1"
                    @change="handleVisualParamsChange"
                  >
                </template>
                <template v-else-if="prop.type === 'range'">
                  <div class="range-row">
                    <input
                      v-model.number="visualParams[prop.key]"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      @input="handleVisualParamsChange"
                    >
                    <span class="value-label">{{ ((visualParams[prop.key] as number) ?? 1).toFixed(1) }}</span>
                  </div>
                </template>
                <template v-else-if="prop.type === 'checkbox'">
                  <label class="checkbox-label">
                    <input
                      v-model="visualParams[prop.key]"
                      type="checkbox"
                      @change="handleVisualParamsChange"
                    >
                    <span>{{ prop.checkLabel }}</span>
                  </label>
                </template>
              </div>
            </template>
            <div
              v-if="activeVisualProps.length === 0 && activeGeometryProps.length === 0"
              class="empty-props-hint"
            >
              No modified properties, click below to add
            </div>
          </template>
        </template>

        <!-- v9.3: set_visual: Visual properties (visible/flipX/zIndex) -->
        <template v-else-if="action!['type'] === 'set_visual'">
          <!-- visible -->
          <div
            v-if="setVisualParams['visible'] !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">👁️ Visibility</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeSetVisualProp('visible')"
              >
                ×
              </button>
            </div>
            <label class="checkbox-label">
              <input
                v-model="setVisualParams['visible']"
                type="checkbox"
                @change="handleSetVisualParamsChange"
              >
              <span>Visible</span>
            </label>
          </div>
          
          <!-- flipX -->
          <div
            v-if="setVisualParams['flipX'] !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">🔄 Flip</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeSetVisualProp('flipX')"
              >
                ×
              </button>
            </div>
            <label class="checkbox-label">
              <input
                v-model="setVisualParams['flipX']"
                type="checkbox"
                @change="handleSetVisualParamsChange"
              >
              <span>Flip Horizontal</span>
            </label>
          </div>
          
          <!-- zIndex -->
          <div
            v-if="setVisualParams['zIndex'] !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">📑 Layer (Z-Index)</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeSetVisualProp('zIndex')"
              >
                ×
              </button>
            </div>
            <input
              v-model.number="setVisualParams['zIndex']"
              type="number"
              step="1"
              @change="handleSetVisualParamsChange"
            >
          </div>

          <div
            v-if="setVisualParams['receiveLighting'] !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">💡 Scene Lighting</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeSetVisualProp('receiveLighting')"
              >
                ×
              </button>
            </div>
            <label class="checkbox-label">
              <input
                v-model="setVisualParams['receiveLighting']"
                type="checkbox"
                @change="handleSetVisualParamsChange"
              >
              <span>Receive Scene Lighting</span>
            </label>
          </div>

          <div
            v-if="setVisualParams['castShadow'] !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">🌑 Ground Shadow</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeSetVisualProp('castShadow')"
              >
                ×
              </button>
            </div>
            <label class="checkbox-label">
              <input
                v-model="setVisualParams['castShadow']"
                type="checkbox"
                @change="handleSetVisualParamsChange"
              >
              <span>Cast Shadow</span>
            </label>
          </div>
          
          <!-- Empty state hint -->
          <div
            v-if="setVisualParams['visible'] === undefined && setVisualParams['flipX'] === undefined && setVisualParams['zIndex'] === undefined && setVisualParams['receiveLighting'] === undefined && setVisualParams['castShadow'] === undefined"
            class="empty-props-hint"
          >
            No modified properties
          </div>
        </template>

        <!-- set_lifecycle: Lifecycle control -->
        <template v-else-if="action!['type'] === 'set_lifecycle'">
          <!-- Despawn Action simplified panel -->
          <template v-if="isCurrentDeathAction">
            <div class="death-action-panel">
              <div class="death-icon">🍂</div>
              <div class="death-label">Object Despawned</div>
              <div class="death-hint">The object is no longer rendered after despawning and its properties cannot be edited</div>
            </div>
          </template>
          <!-- Spawn Action -->
          <template v-else-if="isCurrentBirthAction">
            <div class="birth-action-panel">
              <div class="birth-icon">🌱</div>
              <div class="birth-label">Object Spawned</div>
              <label class="anim-option-checkbox">
                <input
                  type="checkbox"
                  :checked="(action as SetLifecycleAction).params.autoDespawnOnBlockEnd ?? true"
                  @change="handleAutoDespawnChange(($event.target as HTMLInputElement).checked)"
                >
                <span>Auto-despawn at end of block</span>
              </label>
            </div>
          </template>
        </template>

        <template v-else-if="action!['type'] === 'set_scene_structure'">
          <div class="scene-structure-panel">
            <div class="scene-structure-summary">
              <div class="scene-structure-icon">🧭</div>
              <div>
                <div class="scene-structure-title">Structure Change</div>
                <div class="scene-structure-hint">Parent-child structure final state for current slot</div>
              </div>
            </div>

            <div class="scene-structure-counts">
              <span>Structure Operations {{ sceneStructureOperationGroups.length }}</span>
              <span>Changes {{ sceneStructureChangeCount }}</span>
            </div>

            <div
              v-for="group in sceneStructureOperationGroups"
              :key="group.id"
              class="scene-structure-section"
            >
              <div class="scene-structure-operation-header">
                <div>
                  <div class="scene-structure-section-title">{{ group.title }}</div>
                  <div class="scene-structure-operation-hint">{{ group.hint }}</div>
                </div>
                <button
                  class="delta-remove-btn"
                  title="Delete this structure operation"
                  @click="removeSceneStructureOperation(group)"
                >
                  ×
                </button>
              </div>

              <div
                v-if="group.parentEntries.length > 0"
                class="scene-structure-subsection"
              >
                <div class="scene-structure-subtitle">Parent Relationship</div>
                <div
                  v-for="entry in group.parentEntries"
                  :key="`parent-${entry.objectId}`"
                  class="scene-structure-row"
                >
                  <div class="scene-structure-object">
                    <span class="scene-structure-name">{{ getObjectDisplayName(entry.objectId) }}</span>
                    <span
                      v-if="!getSceneObject(entry.objectId)"
                      class="scene-structure-missing"
                    >Object no longer exists</span>
                  </div>
                  <div class="scene-structure-value">
                    {{ getObjectDisplayName(entry.parentId) }}
                  </div>
                </div>
              </div>

              <div
                v-if="group.spawnedEntries.length > 0"
                class="scene-structure-subsection"
              >
                <div class="scene-structure-subtitle">Group State</div>
                <div
                  v-for="entry in group.spawnedEntries"
                  :key="`spawned-${entry.objectId}`"
                  class="scene-structure-object-entry"
                >
                  <div class="scene-structure-row">
                    <div class="scene-structure-object">
                      <span class="scene-structure-name">{{ getObjectDisplayName(entry.objectId) }}</span>
                      <span
                        v-if="!getSceneObject(entry.objectId)"
                        class="scene-structure-missing"
                      >Object no longer exists</span>
                    </div>
                    <div class="scene-structure-value">
                      {{ entry.spawned ? 'Enabled' : 'Disabled' }}
                    </div>
                  </div>
                  <label
                    v-if="entry.spawned"
                    class="scene-structure-auto-restore-row"
                    title="Automatically deactivate this structure object at the end of this block and restore its member attachments"
                  >
                    <input
                      type="checkbox"
                      :checked="isSceneStructureAutoRestoreEnabled(group.operation)"
                      @change="handleSceneStructureAutoRestoreChange(group.id, ($event.target as HTMLInputElement).checked)"
                    >
                    <span>Auto-deactivate at end of block</span>
                  </label>
                </div>
              </div>
            </div>

            <div
              v-if="sceneStructureChangeCount === 0"
              class="empty-props-hint"
            >
              This structure change has no modified items
            </div>
          </div>
        </template>

        <!-- P2: set_composite: Modify composite object properties (editable panel) -->
        <template v-else-if="action!['type'] === 'set_composite'">

          <!-- renderChain sorting editor -->
          <div
            v-if="compositeParams.renderChain !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">📋 Render Chain Order</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeCompositeProp('renderChain')"
              >
                ×
              </button>
            </div>
            <div class="sc-rc-list">
              <div class="sc-rc-header">
                <span>Render Order ({{ compositeParams.renderChain?.length ?? 0 }})</span>
                <div class="sc-rc-controls">
                  <button
                    class="sc-rc-move-btn"
                    title="Move Up (toward bottom layer)"
                    :disabled="!scRcCanMoveUp"
                    @click="handleCompositeChildMove(scRcSelectedIndex, -1)"
                  >
                    ↑
                  </button>
                  <button
                    class="sc-rc-move-btn"
                    title="Move Down (toward top layer)"
                    :disabled="!scRcCanMoveDown"
                    @click="handleCompositeChildMove(scRcSelectedIndex, 1)"
                  >
                    ↓
                  </button>
                </div>
              </div>
              <div class="sc-rc-order-hint">
                ↑ Bottom Layer  ·  ↓ Top Layer
              </div>
              <template v-for="(entry, displayIdx) in scRcDisplay" :key="'scrc-' + displayIdx">
                <!-- zIndex group divider -->
                <div v-if="entry.type === 'divider'" class="sc-rc-zindex-divider">
                  <span class="sc-rc-zindex-label">zIndex {{ entry.zIndex }}</span>
                </div>
                <!-- Render chain item -->
                <div
                  v-else
                  class="sc-rc-item"
                  :class="{
                    'sc-rc-selected': entry.childId === scRcSelectedId,
                    'sc-rc-drag-over': scRcDragOverIndex === entry.flatIndex,
                  }"
                  draggable="true"
                  @click="scRcSelectedId = entry.childId"
                  @dragstart="onScRcDragStart(entry.flatIndex, $event)"
                  @dragover.prevent="onScRcDragOver(entry.flatIndex)"
                  @dragleave="onScRcDragLeave"
                  @drop.prevent="onScRcDrop(entry.flatIndex)"
                  @dragend="onScRcDragEnd"
                >
                  <span class="sc-rc-drag-handle" title="Drag to reorder">⠿</span>
                  <span class="sc-rc-icon">{{ getCompositeChildIcon(entry.childId) }}</span>
                  <span class="sc-rc-name">{{ getCompositeChildName(entry.childId) }}</span>
                </div>
              </template>
              <div v-if="!compositeParams.renderChain?.length" class="sc-rc-empty">
                No child objects
              </div>
            </div>
          </div>

          <!-- Empty state hint -->
          <div
            v-if="compositeParams.renderChain === undefined"
            class="empty-props-hint"
          >
            No modified properties, click below to add
          </div>
        </template>

        <!-- Clip-Mask Phase 1 D3: set_mask (modify mask target / shape) -->
        <template v-else-if="action!['type'] === 'set_mask'">
          <!-- Shape -->
          <div
            v-if="maskParams.shape !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">Shape</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeMaskProp('shape')"
              >
                ×
              </button>
            </div>
            <select
              v-model="maskParams.shape"
              class="prop-select"
              @change="handleMaskParamsChange"
            >
              <option value="rectangle">▭ Rectangle</option>
              <option value="ellipse">⬭ Ellipse</option>
            </select>
          </div>

          <!-- Width -->
          <div
            v-if="maskParams.width !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">Width</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeMaskProp('width')"
              >
                ×
              </button>
            </div>
            <input
              v-model.number="maskParams.width"
              type="number"
              min="1"
              step="1"
              class="prop-input"
              @change="handleMaskParamsChange"
            >
          </div>

          <!-- Height -->
          <div
            v-if="maskParams.height !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">Height</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeMaskProp('height')"
              >
                ×
              </button>
            </div>
            <input
              v-model.number="maskParams.height"
              type="number"
              min="1"
              step="1"
              class="prop-input"
              @change="handleMaskParamsChange"
            >
          </div>

          <!-- Clipping Targets (targetIds) -->
          <div
            v-if="maskParams.targetIds !== undefined"
            class="delta-property-item"
          >
            <div class="delta-property-header">
              <span class="delta-property-label">✂ Clipping Targets ({{ maskParams.targetIds.length }})</span>
              <button
                class="delta-remove-btn"
                title="Remove"
                @click="removeMaskProp('targetIds')"
              >
                ×
              </button>
            </div>
            <ul v-if="maskParams.targetIds.length > 0" class="mask-target-list">
              <li
                v-for="tid in maskParams.targetIds"
                :key="tid"
                class="mask-target-row"
              >
                <span class="mask-target-icon">{{ getMaskTargetIcon(tid) }}</span>
                <span class="mask-target-name" :title="getMaskTargetName(tid)">
                  {{ getMaskTargetName(tid) }}
                </span>
                <button
                  class="mask-target-remove-btn"
                  title="Remove target"
                  @click="removeMaskTarget(tid)"
                >
                  ❌
                </button>
              </li>
            </ul>
            <div v-else class="mask-target-empty">No targets (release all)</div>
            <div class="mask-target-add-row">
              <select v-model="maskTargetAddSelection" class="mask-target-add-select">
                <option value="">+ Add target...</option>
                <option
                  v-for="obj in maskCandidateTargets"
                  :key="obj.id"
                  :value="obj.id"
                >
                  {{ obj.alias || obj.name || obj.id }}
                </option>
              </select>
              <button
                class="mask-target-add-btn"
                :disabled="!maskTargetAddSelection"
                @click="addMaskTarget"
              >
                Add
              </button>
            </div>
          </div>

          <!-- Empty state hint -->
          <div
            v-if="maskParams.shape === undefined && maskParams.targetIds === undefined && maskParams.width === undefined && maskParams.height === undefined"
            class="empty-props-hint"
          >
            No modified properties, click below to add
          </div>
        </template>

        <!-- tween_transform: Geometry properties + Opacity -->
        <template v-else-if="action!['type'] === 'tween_transform'">
          <template
            v-for="prop in activeTweenProps"
            :key="prop.key"
          >
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">{{ prop.label }}</span>
                <button
                  class="delta-remove-btn"
                  title="Remove"
                  @click="removeGeometryProp(prop.key)"
                >
                  ×
                </button>
              </div>
              <!-- Percentage type -->
              <template v-if="prop.type === 'percent'">
                <div class="percent-input-row" style="display: flex; align-items: center;">
                  <input
                    v-model.number="geometryParams[prop.key]"
                    type="number"
                    step="1"
                    @change="(prop.key === 'scaleX' || prop.key === 'scaleY') ? handleScaleChange(prop.key) : handleGeometryParamsChange()"
                  >
                  <span class="percent-label">%</span>
                  <button 
                    v-if="prop.key === 'scaleX'"
                    class="lock-btn" 
                    style="background: none; border: none; cursor: pointer; padding: 0 4px; font-size: 14px; margin-left: 6px; opacity: 0.8;"
                    :title="scaleLocked ? 'Unlock Ratio' : 'Lock Ratio'"
                    @click="toggleScaleLock"
                  >
                    {{ scaleLocked ? '🔗' : '🔓' }}
                  </button>
                </div>
              </template>
              <!-- Degree type -->
              <template v-else-if="prop.type === 'degree'">
                <div class="degree-input-row">
                  <input
                    v-model.number="geometryParams[prop.key]"
                    type="number"
                    step="1"
                    @change="handleGeometryParamsChange"
                  >
                  <span class="degree-label">°</span>
                </div>
              </template>
              <!-- Range slider type (alpha) -->
              <template v-else-if="prop.type === 'range'">
                <div class="range-row">
                  <input
                    v-model.number="geometryParams[prop.key]"
                    type="range"
                    min="0"
                    max="1"
                    :step="prop.step ?? 0.1"
                    @input="handleGeometryParamsChange"
                  >
                  <span class="value-label">{{ ((geometryParams[prop.key] as number) ?? 1).toFixed(1) }}</span>
                </div>
              </template>
              <template v-else-if="prop.type === 'select'">
                <select
                  v-model="lightParams[prop.key]"
                  @change="handleLightParamsChange"
                >
                  <option
                    v-for="option in prop.options ?? []"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </template>
              <!-- Normal number type -->
              <template v-else>
                <input
                  v-model.number="geometryParams[prop.key]"
                  type="number"
                  :step="prop.step ?? 1"
                  @change="handleGeometryParamsChange"
                >
              </template>
            </div>
          </template>
          <div
            v-if="activeTweenProps.length === 0"
            class="empty-props-hint"
          >
            No modified properties, click below to add
          </div>
        </template>

        <!-- Camera Action Types (camera_cut / camera_move / camera_follow / camera_shake) -->
        <template v-else-if="isCameraAction">
          <!-- Action type badge -->
          <div class="camera-action-type-label">
            <span class="type-icon">{{ getCameraActionIcon(action!['type']) }}</span>
            <span class="type-name">{{ getCameraActionTypeName(action!['type']) }}</span>
          </div>

          <!-- Camera Cut / Camera Move parameters -->
          <template v-if="action!['type'] === 'camera_cut' || action!['type'] === 'camera_move'">
            <div class="camera-mode-hint">
              {{ action!['type'] === 'camera_cut' ? 'Hint: Drag camera frame on canvas to set instant position' : 'Hint: Drag camera frame on canvas to set [Target] position' }}
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Target Center X</span>
              </div>
              <input
                :value="Math.round(cameraParams.x)"
                type="number"
                step="1"
                @change="handleCameraXChange"
              >
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Target Center Y</span>
              </div>
              <input
                :value="Math.round(cameraParams.y)"
                type="number"
                step="1"
                @change="handleCameraYChange"
              >
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Target Zoom</span>
              </div>
              <div class="zoom-input-row">
                <input
                  :value="cameraZoomPercent"
                  type="number"
                  step="10"
                  min="10"
                  max="1000"
                  @change="handleCameraZoomChange"
                >
                <span class="percent-label">%</span>
              </div>
            </div>
          </template>

          <!-- Follow parameters -->
          <template v-else-if="action!['type'] === 'camera_follow'">
            <div class="camera-mode-hint">
              Hint: Camera will follow the selected target
            </div>
            <div class="follow-panel">
              <div class="follow-card">
                <div class="follow-card-header">
                  <span class="delta-property-label">Follow Target</span>
                  <span class="follow-card-caption">Select an object as the camera tracking target</span>
                </div>
                <div
                  class="follow-target-dropdown"
                  tabindex="-1"
                  @focusout="onFollowDropdownFocusOut"
                >
                  <button
                    class="follow-target-trigger"
                    type="button"
                    @click="showFollowDropdown = !showFollowDropdown"
                  >
                    <span v-if="selectedFollowTargetLabel">
                      {{ selectedFollowTargetLabel }}
                    </span>
                    <span v-else class="follow-target-placeholder">Select target...</span>
                    <span class="follow-target-arrow">{{ showFollowDropdown ? '▲' : '▼' }}</span>
                  </button>
                  <div v-if="showFollowDropdown" class="follow-target-list">
                    <div
                      class="follow-target-item"
                      :class="{ selected: !followParams.followTarget }"
                      @click="selectFollowTarget('')"
                    >
                      <span class="follow-target-item-label">None</span>
                    </div>
                    <div
                      v-for="item in flatFollowTargetList"
                      :key="item.id"
                      class="follow-target-item"
                      :class="{
                        selected: followParams.followTarget === item.id,
                        'child-item': item.depth > 0
                      }"
                      :style="item.depth > 0 ? { paddingLeft: `${8 + item.depth * 20}px` } : undefined"
                      @click="selectFollowTarget(item.id)"
                    >
                      <span v-if="item.depth > 0" class="follow-target-child-prefix">└</span>
                      <span class="follow-target-item-label">{{ item.icon }} {{ item.alias }}</span>
                      <span
                        v-if="item.hasChildren"
                        class="follow-target-toggle"
                        @click.stop="toggleCompositeExpand(item.id)"
                      >
                        {{ expandedComposites.has(item.id) ? '▲' : '▼' }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="follow-card">
                <div class="follow-card-header">
                  <span class="delta-property-label">Basic Parameters</span>
                  <span class="follow-card-caption">Configure framing offset and camera zoom</span>
                </div>
                <div class="follow-inline-stack">
                  <label class="follow-inline-field">
                    <span class="follow-inline-label">Zoom</span>
                    <div class="zoom-input-row">
                      <input
                        :value="followZoomPercent"
                        type="number"
                        step="10"
                        min="10"
                        max="1000"
                        @change="handleFollowZoomChange"
                      >
                      <span class="value-label">%</span>
                    </div>
                  </label>
                </div>
                <div class="follow-inline-grid">
                  <label class="follow-inline-field">
                    <span class="follow-inline-label">Offset X</span>
                    <input
                      v-model.number="followParams.offsetX"
                      type="number"
                      step="10"
                      @change="handleFollowParamsChange"
                    >
                  </label>
                  <label class="follow-inline-field">
                    <span class="follow-inline-label">Offset Y</span>
                    <input
                      v-model.number="followParams.offsetY"
                      type="number"
                      step="10"
                      @change="handleFollowParamsChange"
                    >
                  </label>
                </div>
              </div>

              <div class="follow-card">
                <label class="follow-toggle-card">
                  <span class="follow-toggle-main">
                    <input
                      v-model="followParams.smoothEntry"
                      type="checkbox"
                      @change="handleFollowParamsChange"
                    >
                    <span>Smooth Transition</span>
                  </span>
                  <span class="follow-toggle-desc">Smoothly glide from current camera position to target position when tracking starts</span>
                </label>
                <div v-if="followParams.smoothEntry" class="follow-inline-grid follow-sub-grid">
                  <label class="follow-inline-field">
                    <span class="follow-inline-label">Duration</span>
                    <div class="zoom-input-row">
                      <input
                        v-model.number="followParams.smoothEntryDuration"
                        type="number"
                        :min="100"
                        :max="2000"
                        :step="50"
                        class="number-input"
                        @change="handleFollowParamsChange"
                      >
                      <span class="value-label">ms</span>
                    </div>
                  </label>
                </div>
              </div>

              <div class="follow-card">
                <label class="follow-toggle-card">
                  <span class="follow-toggle-main">
                    <input
                      v-model="followParams.autoZoom"
                      type="checkbox"
                      @change="handleFollowParamsChange"
                    >
                    <span>Auto Zoom</span>
                  </span>
                  <span class="follow-toggle-desc">Overlay periodic zoom pulsation during follow to add camera breathing feel</span>
                </label>
                <div v-if="followParams.autoZoom" class="follow-inline-grid follow-sub-grid">
                  <label class="follow-inline-field">
                    <span class="follow-inline-label">Zoom Range</span>
                    <div class="zoom-input-row">
                      <input
                        v-model.number="followParams.autoZoomRange"
                        type="number"
                        step="1"
                        min="5"
                        max="50"
                        @change="handleFollowParamsChange"
                      >
                      <span class="value-label">%</span>
                    </div>
                  </label>
                  <label class="follow-inline-field">
                    <span class="follow-inline-label">Cycles</span>
                    <input
                      v-model.number="followParams.autoZoomCycles"
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="10"
                      @change="handleFollowParamsChange"
                    >
                  </label>
                </div>
              </div>

              <div class="follow-card">
                <label class="follow-toggle-card follow-toggle-card-compact">
                  <span class="follow-toggle-main">
                    <input
                      v-model="followParams.constrainBounds"
                      type="checkbox"
                      @change="handleFollowParamsChange"
                    >
                    <span>Boundary Constraint</span>
                  </span>
                  <span class="follow-toggle-desc">Clamp camera within canvas bounds to prevent out-of-frame display</span>
                </label>
              </div>
            </div>
          </template>

          <template v-else-if="action!['type'] === 'camera_shake'">
            <div class="camera-mode-hint">
              Hint: Camera will shake with randomized perturbation
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Intensity (px)</span>
              </div>
              <input
                v-model.number="shakeParams.intensity"
                type="number"
                min="0"
                step="1"
                @change="handleShakeChange"
              >
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Frequency (Hz)</span>
              </div>
              <input
                v-model.number="shakeParams.frequency"
                type="number"
                min="0.1"
                max="60"
                step="0.1"
                @change="handleShakeChange"
              >
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Decay</span>
              </div>
              <label class="checkbox-label">
                <input
                  v-model="shakeParams.decay"
                  type="checkbox"
                  @change="handleShakeChange"
                >
                <span>Decay over time</span>
              </label>
            </div>
          </template>
        </template>

        <!-- set_audio: Audio action -->
        <template v-else-if="action!['type'] === 'set_audio'">
          <!-- Required property: Action -->
          <div class="delta-property-item">
            <div class="delta-property-header">
              <span class="delta-property-label">Action</span>
            </div>
            <div class="anim-action-row">
              <label
                class="anim-action-option"
                :class="{ active: audioParams['action'] === 'play' }"
              >
                <input
                  type="radio"
                  name="audio-action"
                  value="play" 
                  :checked="audioParams['action'] === 'play'"
                  @change="handleAudioParamsChange('action', 'play')"
                >
                <span>▶ Play</span>
              </label>
              <label
                class="anim-action-option"
                :class="{ active: audioParams['action'] === 'stop' }"
              >
                <input
                  type="radio"
                  name="audio-action"
                  value="stop" 
                  :checked="audioParams['action'] === 'stop'"
                  @change="handleAudioParamsChange('action', 'stop')"
                >
                <span>⏹ Stop</span>
              </label>
            </div>
          </div>

          <!-- Optional properties -->
          <template
            v-for="prop in activeAudioProps"
            :key="prop.key"
          >
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">{{ prop.label }}</span>
                <button
                  class="delta-remove-btn"
                  title="Remove"
                  @click="removeAudioProp(prop.key)"
                >
                  ×
                </button>
              </div>
              <template v-if="prop.type === 'number'">
                <input
                  :value="audioParams[prop.key]"
                  type="number"
                  :step="prop.step ?? 1"
                  :min="prop.min"
                  @change="handleAudioParamsChange(prop.key, parseFloat(($event.target as HTMLInputElement).value))"
                >
              </template>
              <template v-else-if="prop.type === 'range'">
                <div class="range-row">
                  <input
                    :value="audioParams[prop.key]"
                    type="range"
                    :min="prop.min"
                    :max="prop.max"
                    :step="prop.step"
                    @input="handleAudioParamsChange(prop.key, parseFloat(($event.target as HTMLInputElement).value))"
                  >
                  <span
                    v-if="prop.key === 'volume'"
                    class="value-label"
                  >{{ Math.round(((audioParams[prop.key] as number) ?? 1) * 100) }}%</span>
                  <span
                    v-else
                    class="value-label"
                  >{{ ((audioParams[prop.key] as number) ?? 1).toFixed(2) }}</span>
                </div>
              </template>
              <template v-else-if="prop.type === 'checkbox'">
                <label class="checkbox-label">
                  <input
                    :checked="(audioParams[prop.key] as boolean)"
                    type="checkbox"
                    @change="handleAudioParamsChange(prop.key, ($event.target as HTMLInputElement).checked)"
                  >
                  <span>{{ prop.checkLabel }}</span>
                </label>
              </template>
            </div>
          </template>
        </template>

        <!-- set_text_reveal: Text reveal action -->
        <template v-else-if="action!['type'] === 'set_text_reveal'">
          <div class="delta-property-item">
            <div class="delta-property-header">
              <span class="delta-property-label">Action</span>
            </div>
            <div class="anim-action-row">
              <label
                class="anim-action-option text-reveal-start-option"
                :class="{ active: textRevealParams['action'] === 'play' }"
              >
                <input
                  type="radio"
                  name="text-reveal-action"
                  value="play" 
                  :checked="textRevealParams['action'] === 'play'"
                  @change="handleTextRevealParamsChange('action', 'play')"
                >
                <span>⌨ Start Typing</span>
              </label>
              <label
                class="anim-action-option text-reveal-complete-option"
                :class="{ active: textRevealParams['action'] === 'stop' }"
              >
                <input
                  type="radio"
                  name="text-reveal-action"
                  value="stop" 
                  :checked="textRevealParams['action'] === 'stop'"
                  @change="handleTextRevealParamsChange('action', 'stop')"
                >
                <span>▣ Show Full Text</span>
              </label>
            </div>
          </div>
          <div class="delta-property-item">
            <div class="delta-property-header">
              <span class="delta-property-label">Effect</span>
            </div>
            <select
              :value="textRevealParams['mode'] ?? 'typewriter'"
              @change="handleTextRevealParamsChange('mode', ($event.target as HTMLSelectElement).value)"
            >
              <option value="typewriter">Typewriter</option>
            </select>
          </div>
        </template>

        <!-- set_screen_effect / tween_screen_effect: Screen effect parameters -->
        <template v-else-if="action!['type'] === 'set_screen_effect' || action!['type'] === 'tween_screen_effect'">
          <template
            v-for="prop in activeScreenEffectProps"
            :key="prop.key"
          >
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">{{ prop.label }}</span>
                <button
                  class="delta-remove-btn"
                  title="Remove"
                  @click="removeScreenEffectProp(prop.key)"
                >
                  ×
                </button>
              </div>
              <!-- Color type -->
              <template v-if="prop.type === 'color'">
                <div class="color-input-row">
                  <input
                    :value="screenEffectParams[prop.key]"
                    type="color"
                    @input="handleScreenEffectColorChange(prop.key, ($event.target as HTMLInputElement).value)"
                  >
                  <span class="color-hex-label">{{ screenEffectParams[prop.key] ?? '#000000' }}</span>
                </div>
              </template>
              <!-- Range slider type -->
              <template v-else-if="prop.type === 'range'">
                <div class="range-row">
                  <input
                    v-model.number="screenEffectParams[prop.key]"
                    type="range"
                    :min="prop.min ?? 0"
                    :max="prop.max ?? 1"
                    :step="prop.step ?? 0.1"
                    @input="handleScreenEffectParamsChange"
                  >
                  <span class="value-label">{{ ((screenEffectParams[prop.key] as number) ?? 0).toFixed(2) }}</span>
                </div>
              </template>
              <!-- Select type (holeShape) -->
              <template v-else-if="prop.type === 'select'">
                <select
                  :value="screenEffectParams[prop.key]"
                  @change="handleScreenEffectSelectChange(prop.key, ($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="opt in prop.options"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </template>
              <!-- Normal number type -->
              <template v-else>
                <input
                  v-model.number="screenEffectParams[prop.key]"
                  type="number"
                  :step="prop.step ?? 1"
                  @change="handleScreenEffectParamsChange"
                >
              </template>
            </div>
          </template>
          <div
            v-if="activeScreenEffectProps.length === 0"
            class="empty-props-hint"
          >
            No modified properties, click below to add
          </div>
        </template>

        <!-- set_light / tween_light: Light parameters (Point light PRD Phase 0.5) -->
        <template v-else-if="action!['type'] === 'set_light' || action!['type'] === 'tween_light'">
          <template
            v-for="prop in activeLightProps"
            :key="prop.key"
          >
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">{{ prop.label }}</span>
                <button
                  class="delta-remove-btn"
                  title="Remove"
                  @click="removeLightProp(prop.key)"
                >
                  ×
                </button>
              </div>
              <!-- Color type -->
              <template v-if="prop.type === 'color'">
                <div class="color-input-row">
                  <input
                    :value="lightParams[prop.key]"
                    type="color"
                    @input="handleLightColorChange(prop.key, ($event.target as HTMLInputElement).value)"
                  >
                  <span class="color-hex-label">{{ lightParams[prop.key] ?? '#ffffff' }}</span>
                </div>
              </template>
              <!-- Range slider type -->
              <template v-else-if="prop.type === 'range'">
                <div class="range-row">
                  <input
                    v-model.number="lightParams[prop.key]"
                    type="range"
                    :min="prop.min ?? 0"
                    :max="prop.max ?? 1"
                    :step="prop.step ?? 0.01"
                    @input="handleLightParamsChange"
                  >
                  <span class="value-label">{{ ((lightParams[prop.key] as number) ?? 0).toFixed(2) }}</span>
                </div>
              </template>
              <template v-else-if="prop.type === 'select'">
                <select
                  v-model="lightParams[prop.key]"
                  @change="handleLightParamsChange"
                >
                  <option
                    v-for="option in prop.options ?? []"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </template>
              <!-- Normal number type -->
              <template v-else>
                <input
                  v-model.number="lightParams[prop.key]"
                  type="number"
                  :step="prop.step ?? 1"
                  :min="prop.min"
                  :max="prop.max"
                  @change="handleLightParamsChange"
                >
              </template>
            </div>
          </template>
          <div
            v-if="activeLightProps.length === 0"
            class="empty-props-hint"
          >
            No modified properties, click below to add
          </div>
        </template>

        <!-- set_text / tween_text: Text properties (Text PRD) -->
        <template v-else-if="action!['type'] === 'set_text' || action!['type'] === 'tween_text'">
          <template
            v-for="prop in activeTextProps"
            :key="prop.key"
          >
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">{{ prop.label }}</span>
                <button
                  class="delta-remove-btn"
                  title="Remove"
                  @click="removeTextProp(prop.key)"
                >
                  ×
                </button>
              </div>
              <!-- Color type -->
              <template v-if="prop.type === 'color'">
                <div class="color-input-row">
                  <input
                    :value="textParams[prop.key]"
                    type="color"
                    @input="handleTextColorChange(prop.key, ($event.target as HTMLInputElement).value)"
                  >
                  <span class="color-hex-label">{{ textParams[prop.key] ?? '#ffffff' }}</span>
                </div>
              </template>
              <!-- Select type -->
              <template v-else-if="prop.type === 'select'">
                <select
                  :value="textParams[prop.key]"
                  @change="handleTextSelectChange(prop.key, ($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="opt in prop.options"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </template>
              <!-- Text content (textarea) -->
              <template v-else-if="prop.type === 'textarea'">
                <textarea
                  :value="(textParams[prop.key] as string) ?? ''"
                  rows="2"
                  class="text-content-input"
                  @input="handleTextContentChange(($event.target as HTMLTextAreaElement).value)"
                />
              </template>
              <!-- Checkbox type -->
              <template v-else-if="prop.type === 'checkbox'">
                <label class="checkbox-label">
                  <input
                    :checked="(textParams[prop.key] as boolean) ?? false"
                    type="checkbox"
                    @change="textParams[prop.key] = ($event.target as HTMLInputElement).checked; handleTextParamsChange()"
                  >
                  <span>{{ prop.checkLabel }}</span>
                </label>
              </template>
              <!-- Range slider type -->
              <template v-else-if="prop.type === 'range'">
                <div class="range-row">
                  <input
                    v-model.number="textParams[prop.key]"
                    type="range"
                    :min="prop.min ?? 0"
                    :max="prop.max ?? 100"
                    :step="prop.step ?? 1"
                    @input="handleTextParamsChange"
                  >
                  <span class="value-label">{{ ((textParams[prop.key] as number) ?? 0) }}</span>
                </div>
              </template>
              <!-- Normal number type -->
              <template v-else>
                <input
                  v-model.number="textParams[prop.key]"
                  type="number"
                  :step="prop.step ?? 1"
                  :min="prop.min"
                  :max="prop.max"
                  @change="handleTextParamsChange"
                >
              </template>
            </div>
          </template>
          <!-- gradientStops: Gradient color stops (shown when fillType is linear_gradient) -->
          <template v-if="textParams['fillType'] === 'linear_gradient'">
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">Start Color</span>
              </div>
              <div class="color-input-row">
                <input
                  :value="textGradientStartColor"
                  type="color"
                  @input="handleTextGradientStopChange(0, ($event.target as HTMLInputElement).value)"
                >
                <span class="color-hex-label">{{ textGradientStartColor }}</span>
              </div>
            </div>
            <div class="delta-property-item">
              <div class="delta-property-header">
                <span class="delta-property-label">End Color</span>
              </div>
              <div class="color-input-row">
                <input
                  :value="textGradientEndColor"
                  type="color"
                  @input="handleTextGradientStopChange(1, ($event.target as HTMLInputElement).value)"
                >
                <span class="color-hex-label">{{ textGradientEndColor }}</span>
              </div>
            </div>
          </template>
          <div
            v-if="activeTextProps.length === 0"
            class="empty-props-hint"
          >
            No modified properties, click below to add
          </div>
        </template>

        <!-- v11.0: set_anim - Animation control -->
        <!-- v11.52: On-demand addition mode -->
        <template v-else-if="action!['type'] === 'set_anim'">
          <div class="v11-anim-editor">
            <!-- Added animation control list -->
            <div v-if="currentAnimations.length > 0" class="anim-list">
              <div 
                v-for="(animItem, index) in currentAnimations" 
                :key="animItem.animName" 
                class="anim-list-item"
              >
                <div class="anim-header">
                  <span class="anim-name">🎬 {{ animItem.animName }}</span>
                  <label v-if="animItem.action !== 'stop'" class="anim-option-checkbox">
                    <input
                      type="checkbox"
                      :checked="animItem.autoStopOnBlockEnd ?? true"
                      @change="handleAnimAutoStopChange(index, ($event.target as HTMLInputElement).checked)"
                    >
                    <span>Auto-stop at end of block</span>
                  </label>
                </div>
                <!-- v12.x: Control row (buttons + loop option) -->
                <div class="anim-controls-row">
                  <div class="anim-controls">
                    <button
                      class="anim-action-btn"
                      :class="{ active: animItem.action === 'play' }"
                      title="Play"
                      @click="handleSetAnimAction(animItem.animName, 'play')"
                    >▶</button>
                    <button
                      class="anim-action-btn"
                      :class="{ active: animItem.action === 'stop' }"
                      title="Stop"
                      @click="handleSetAnimAction(animItem.animName, 'stop')"
                    >⏹</button>
                    <button
                      class="anim-remove-btn"
                      title="Remove"
                      @click="removeAnimFromAction(index)"
                    >🗑️</button>
                  </div>
                  <select
                    v-if="animItem.action !== 'stop'"
                    :value="animItem.loop === undefined ? '' : String(animItem.loop)"
                    class="anim-loop-select"
                    @change="handleAnimLoopOverrideChange(index, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">Follow Animation Definition</option>
                    <option value="true">Loop</option>
                    <option value="false">No Loop</option>
                  </select>
                </div>
                <div
                  v-if="animItem.action !== 'stop'"
                  class="anim-timing-row"
                >
                  <span class="anim-timing-label">Playback Mode</span>
                  <select
                    :value="animItem.timingMode ?? ''"
                    class="anim-timing-select"
                    @change="handleAnimTimingModeChange(index, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">Follow Animation Definition</option>
                    <option value="continuous">Continuous</option>
                    <option value="tts_speech">Follow TTS Speech</option>
                  </select>
                </div>
              </div>
            </div>
            
            <!-- Empty state hint -->
            <div v-else class="empty-props-hint">
              💡 Click the button below to add animation control
            </div>
            
            <!-- Add animation control button -->
            <div v-if="availableAnimationsToAdd.length > 0" class="add-anim-section">
              <button
                class="add-anim-btn"
                @click="showAddAnimMenu = !showAddAnimMenu"
              >
                + Add Animation Control
              </button>
              <div v-if="showAddAnimMenu" class="add-anim-menu">
                <button 
                  v-for="anim in availableAnimationsToAdd" 
                  :key="anim.id" 
                  class="add-anim-option"
                  @click="addAnimToAction(anim.name)"
                >
                  🎬 {{ anim.name }}
                </button>
              </div>
            </div>
            
            <!-- No available animations -->
            <div v-else-if="availableAnimations.length === 0" class="empty-props-hint">
              ⚠️ No animations available for this object
            </div>
          </div>
        </template>

        <!-- v16: set_material - Symbol material switch / v18: Expression reference switch -->
        <template v-else-if="action!['type'] === 'set_material'">
          <div class="delta-property-item">
            <div class="delta-property-header">
              <span class="delta-property-label">{{ targetIsExpression ? 'Target Expression' : 'Target Material' }}</span>
            </div>
            <!-- Symbol: Material dropdown list -->
            <template v-if="!targetIsExpression">
              <select
                :value="(action as SetMaterialAction).params.materialId"
                class="inspector-select"
                @change="handleMaterialIdChange(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="mat in targetSymbolMaterials"
                  :key="mat.id"
                  :value="mat.id"
                >
                  {{ mat.name }} ({{ mat.type === 'static' ? 'Static' : 'Animated' }})
                </option>
                <option v-if="targetSymbolMaterials.length === 0" disabled value="">
                  No materials available
                </option>
              </select>
            </template>
            <!-- Expression: Expression dropdown list -->
            <template v-else>
              <select
                :value="(action as SetMaterialAction).params.materialId"
                class="inspector-select"
                @change="handleMaterialIdChange(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="expr in targetExpressionList"
                  :key="expr.id"
                  :value="expr.id"
                >
                  {{ expr.name }}
                </option>
                <option v-if="targetExpressionList.length === 0" disabled value="">
                  No expressions available
                </option>
              </select>
            </template>
          </div>
        </template>
      </div>

      <!-- Add Property button (v6.3) - v9.2: Not shown for Death Action -->
      <div v-if="!isCurrentDeathAction" class="add-property-section">
        <template v-if="availablePropsToAdd.length > 0">
          <button
            class="add-property-btn"
            @click="showAddPropertyMenu = !showAddPropertyMenu"
          >
            + Add Property
          </button>
          <div
            v-if="showAddPropertyMenu"
            class="add-property-menu"
          >
            <button 
              v-for="prop in availablePropsToAdd" 
              :key="prop.key" 
              class="add-property-option"
              @click="addProperty(prop.key)"
            >
              {{ prop.label }}
            </button>
          </div>
        </template>
        <!-- v11.0: set_anim no longer needs "Add Property", Animation is managed in character editor -->
      </div>
      
      <!-- Delete action button -->
      <div class="delete-action-section">
        <button
          class="delete-action-btn"
          @click="handleDeleteAction"
        >
          🗑️ Delete Action
        </button>
      </div>
    </div>

    <!-- Expression selector dialog -->
    <ExpressionSelectorDialog
      v-if="showExpressionDialog"
      @select="handleExpressionSelect"
      @close="showExpressionDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { getTypeIcon } from '@/core/sceneObjectProviders/metadata'
import { useAnimationStore } from '@/stores/animationStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useSceneObjectStore } from '@/stores/sceneObjectStore'
import type { AnimationTimingMode } from '@/types/animation'
import type { CameraObject, CompositeObject, LightObject, MaskObject, SceneObject, ScreenEffectObject, SymbolObject } from '@/types/sceneObject'
import type { Action, ActionType, BaseDurationAction, RuntimeSlot, SceneStructureOperation, SetAnimAction, SetMaterialAction, SetSceneStructureParams } from '@/types/screenplay'
import type { SetLifecycleAction } from '@/types/screenplay'
import { SCENE_ACTION_TARGET } from '@/types/screenplay'
import { isBirthAction, isDeathAction } from '@/utils/actionHelpers'
import { isAllowedMaskTargetType } from '@/utils/maskUtils'

import ExpressionSelectorDialog from './screenplay/ExpressionSelectorDialog.vue'

interface InspectorPropDef {
  key: string
  label: string
  type: string
  step?: number
  min?: number
  max?: number
  checkLabel?: string
  options?: { value: string; label: string }[]
}

const props = defineProps<{
  action: Action | null
  blockDuration: number // Block total duration (ms)
  slots: RuntimeSlot[] // Slots list
  // v7.55: Field to auto-focus when entering from ObjectPropertiesPanel
  focusField?: 'pose' | 'layerPreset' | 'expression' | 'partAsset' | null
  // v9.3: Alive object ID list under current slot (used to filter camera_follow targets)
  aliveObjectIds?: string[]
  // v11.1: Scene context, used to get scene-level animations
  episodeId?: string | undefined
  sceneId?: string | undefined
}>()

const emit = defineEmits<{
  update: [updates: Partial<Action>]
  delete: []
}>()

const expressionStore = useExpressionStore()
const sceneObjectStore = useSceneObjectStore()
const animationStore = useAnimationStore()

const showExpressionDialog = ref(false)
const showAddPropertyMenu = ref(false)

interface SceneStructureParentEntry {
  objectId: string
  parentId: string | null
}

interface SceneStructureSpawnedEntry {
  objectId: string
  spawned: boolean
}

interface SceneStructureOperationGroup {
  id: string
  operation: SceneStructureOperation
  title: string
  hint: string
  parentEntries: SceneStructureParentEntry[]
  spawnedEntries: SceneStructureSpawnedEntry[]
}

function getSceneObject(id: string): SceneObject | undefined {
  return sceneObjectStore.getObject(id)
}

function getObjectDisplayName(id: string | null): string {
  if (!id) return 'No Parent'
  if (id === SCENE_ACTION_TARGET) return 'Current Scene'
  const obj = getSceneObject(id)
  if (!obj) return id
  return obj.alias?.trim() || obj.name?.trim() || id
}

const sceneStructureParams = computed<SetSceneStructureParams>(() => {
  if (props.action?.type !== 'set_scene_structure') {
    return { operations: [] }
  }
  return props.action.params
})

function sortSceneStructureParentEntries(entries: SceneStructureParentEntry[]): SceneStructureParentEntry[] {
  return [...entries].sort((a, b) => {
    const aObj = getSceneObject(a.objectId)
    const bObj = getSceneObject(b.objectId)
    const aRank = aObj?.type === 'composite' ? 0 : 1
    const bRank = bObj?.type === 'composite' ? 0 : 1
    return aRank - bRank || getObjectDisplayName(a.objectId).localeCompare(getObjectDisplayName(b.objectId), 'zh-Hans-CN')
  })
}

function getSceneStructureOperationTitle(operation: SceneStructureOperation): string {
  if (operation.kind === 'group') return 'Group Operation'
  if (operation.kind === 'ungroup') return 'Ungroup'
  return 'Adjust Parent'
}

function getSceneStructureOperationHint(operation: SceneStructureOperation): string {
  if (operation.kind === 'group') return 'Enable composite and attach members, executed as a unified operation'
  if (operation.kind === 'ungroup') return 'Deactivate composite and restore member parentage, executed as a unified operation'
  return 'Adjust object relationships, executed as a unified operation'
}

const sceneStructureOperationGroups = computed<SceneStructureOperationGroup[]>(() => {
  return sceneStructureParams.value.operations.map((operation) => {
    const parentEntries: SceneStructureParentEntry[] = []
    const spawnedEntries: SceneStructureSpawnedEntry[] = []

    if (operation.kind === 'group') {
      parentEntries.push({ objectId: operation.groupId, parentId: operation.parentId })
      for (const memberId of operation.memberIds) {
        parentEntries.push({ objectId: memberId, parentId: operation.groupId })
      }
      spawnedEntries.push({ objectId: operation.groupId, spawned: true })
    } else if (operation.kind === 'ungroup') {
      parentEntries.push({ objectId: operation.groupId, parentId: operation.groupParentId })
      for (const memberId of operation.memberIds) {
        parentEntries.push({ objectId: memberId, parentId: operation.restoreParentId })
      }
      spawnedEntries.push({ objectId: operation.groupId, spawned: false })
    } else {
      for (const objectId of operation.objectIds) {
        parentEntries.push({ objectId, parentId: operation.parentId })
      }
    }

    return {
      id: operation.id,
      operation,
      title: getSceneStructureOperationTitle(operation),
      hint: getSceneStructureOperationHint(operation),
      parentEntries: sortSceneStructureParentEntries(parentEntries),
      spawnedEntries,
    }
  })
})

const sceneStructureChangeCount = computed(() =>
  sceneStructureOperationGroups.value.reduce(
    (count, group) => count + group.parentEntries.length + group.spawnedEntries.length,
    0,
  )
)

function commitSceneStructureOperations(operations: SceneStructureOperation[]): void {
  if (operations.length === 0) {
    emit('delete')
    return
  }

  emit('update', { params: { operations } })
}

function isSceneStructureAutoRestoreEnabled(operation: SceneStructureOperation): boolean {
  return operation.kind !== 'group' || operation.autoRestoreOnBlockEnd !== false
}

function handleSceneStructureAutoRestoreChange(operationId: string, autoRestoreOnBlockEnd: boolean): void {
  const operations = sceneStructureParams.value.operations.map((operation) => {
    if (operation.id !== operationId || operation.kind !== 'group') return operation
    const nextOperation = { ...operation }
    if (autoRestoreOnBlockEnd) {
      delete nextOperation.autoRestoreOnBlockEnd
    } else {
      nextOperation.autoRestoreOnBlockEnd = false
    }
    return nextOperation
  })
  commitSceneStructureOperations(operations)
}

function removeSceneStructureOperation(group: SceneStructureOperationGroup): void {
  commitSceneStructureOperations(sceneStructureParams.value.operations.filter(operation => operation.id !== group.id))
}

// Delete action
function handleDeleteAction() {
  if (props.action) {
    emit('delete')
  }
}

// ==================== Property Definitions (v6.3) ====================

// Visual property definitions (used by set_character, including alpha and visible/flipX/zIndex)
const VISUAL_PROPS: InspectorPropDef[] = [
  { key: 'alpha', label: 'Opacity', type: 'range', step: 0.1 },
  { key: 'visible', label: 'Visibility', type: 'checkbox', checkLabel: 'Visible' },
  { key: 'flipX', label: 'Flip', type: 'checkbox', checkLabel: 'Flip Horizontal' },
  { key: 'zIndex', label: 'Layer (Z-Index)', type: 'number', step: 1 },
]

// v9.3: set_transform only supports opacity (remaining visual props handled by set_visual)
const TRANSFORM_VISUAL_PROPS: InspectorPropDef[] = [
  { key: 'alpha', label: 'Opacity', type: 'range', step: 0.1 },
]

// Geometry property definitions (tween_transform)
const GEOMETRY_PROPS: InspectorPropDef[] = [
  { key: 'x', label: 'Target X', type: 'number', step: 1 },
  { key: 'y', label: 'Target Y', type: 'number', step: 1 },
  { key: 'scaleX', label: 'Target Scale X', type: 'percent', step: 1 },
  { key: 'scaleY', label: 'Target Scale Y', type: 'percent', step: 1 },
  { key: 'rotation', label: 'Rotation (°)', type: 'degree', step: 1 },
]

// Transform origin properties (used by set_transform only, not supported by tween_transform)
const TRANSFORM_ORIGIN_PROPS: InspectorPropDef[] = [
  { key: 'transformOriginX', label: 'Origin X', type: 'number', step: 1 },
  { key: 'transformOriginY', label: 'Origin Y', type: 'number', step: 1 },
]

// Audio property definitions
const AUDIO_PROPS: InspectorPropDef[] = [
  { key: 'volume', label: 'Volume', type: 'range', step: 0.05, min: 0, max: 1 },
  { key: 'loop', label: 'Loop', type: 'checkbox', checkLabel: 'Loop Playback' },
  { key: 'fadeIn', label: 'Fade In (s)', type: 'number', step: 0.1, min: 0 },
  { key: 'fadeOut', label: 'Fade Out (s)', type: 'number', step: 0.1, min: 0 }
]

// Screen effect property definitions
const SCREEN_EFFECT_PROPS: InspectorPropDef[] = [
  { key: 'baseColor', label: '🎨 Mask Color', type: 'color' },
  { key: 'holeShape', label: '🔲 Cutout Shape', type: 'select', options: [
    { value: 'circle', label: 'Circle' },
    { value: 'horizontal_ellipse', label: 'Horizontal Ellipse' },
    { value: 'vertical_ellipse', label: 'Vertical Ellipse' },
    { value: 'rectangle', label: 'Rectangle' },
  ] },
  { key: 'openRatio', label: 'Cutout Ratio', type: 'range', step: 0.01, min: 0, max: 1 },
  { key: 'holeWidth', label: 'Hole Width', type: 'number', step: 10, min: 0 },
  { key: 'holeHeight', label: 'Hole Height', type: 'number', step: 10, min: 0 },
]

// Light property definitions (Point light PRD Phase 0.5)
const LIGHT_PROPS: InspectorPropDef[] = [
  { key: 'lightColor', label: '💡 Light Color', type: 'color' },
  { key: 'lightIntensity', label: 'Intensity', type: 'range', step: 0.01, min: 0, max: 2 },
  { key: 'lightRadius', label: 'Radius (px)', type: 'range', step: 10, min: 50, max: 3000 },
  { key: 'flicker', label: 'Flicker Intensity', type: 'range', step: 0.05, min: 0, max: 1 },
  { key: 'flickerSpeed', label: 'Flicker Speed', type: 'range', step: 0.05, min: 0, max: 1 },
  { key: 'directionAngle', label: 'Direction Angle (rad)', type: 'range', step: 0.01, min: -3.14, max: 3.14 },
  { key: 'coneAngle', label: 'Cone Angle (°)', type: 'range', step: 5, min: 10, max: 360 },
]

// Text property definitions (Text PRD: set_text / tween_text)
const TEXT_PROPS: InspectorPropDef[] = [
  { key: 'content', label: '📝 Content', type: 'textarea' },
  { key: 'fontFamily', label: '🔤 Font', type: 'select', options: [
    { value: 'Noto Sans SC', label: 'Noto Sans SC' },
    { value: 'Noto Serif SC', label: 'Noto Serif SC' },
    { value: 'LXGW WenKai', label: 'LXGW WenKai' },
    { value: 'ZCOOL QingKe HuangYou', label: 'ZCOOL QingKe HuangYou' },
    { value: 'Ma Shan Zheng', label: 'Ma Shan Zheng' },
  ] },
  { key: 'fontSize', label: '🔢 Font Size', type: 'number', step: 1, min: 8 },
  { key: 'color', label: '🎨 Color', type: 'color' },
  { key: 'align', label: '↔ Align', type: 'select', options: [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ] },
  { key: 'fontWeight', label: '𝐁 Weight', type: 'select', options: [
    { value: 'normal', label: 'Normal' },
    { value: 'bold', label: 'Bold' },
  ] },
  { key: 'fontStyle', label: '𝐼 Style', type: 'select', options: [
    { value: 'normal', label: 'Normal' },
    { value: 'italic', label: 'Italic' },
  ] },
  { key: 'stroke', label: 'Stroke Color', type: 'color' },
  { key: 'strokeThickness', label: 'Stroke Thickness', type: 'number', step: 1, min: 0 },
  { key: 'letterSpacing', label: 'Letter Spacing', type: 'number', step: 1 },
  { key: 'lineHeight', label: 'Line Height', type: 'number', step: 1, min: 0 },
  { key: 'wordWrap', label: 'Word Wrap', type: 'checkbox', checkLabel: 'Enabled' },
  { key: 'wordWrapWidth', label: 'Wrap Width', type: 'number', step: 10, min: 50 },
  { key: 'textBoxMode', label: 'Text Box Mode', type: 'select', options: [
    { value: 'auto-size', label: 'Auto Size' },
    { value: 'auto-width', label: 'Auto Width' },
    { value: 'auto-height', label: 'Auto Height' },
    { value: 'fixed', label: 'Fixed Size' },
  ] },
  { key: 'writingMode', label: 'Writing Direction', type: 'select', options: [
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'vertical', label: 'Vertical' },
  ] },
  // Drop shadow
  { key: 'dropShadow', label: 'Text Shadow', type: 'checkbox', checkLabel: 'Enabled' },
  { key: 'dropShadowColor', label: 'Shadow Color', type: 'color' },
  { key: 'dropShadowBlur', label: 'Shadow Blur', type: 'number', step: 1, min: 0 },
  { key: 'dropShadowAngle', label: 'Shadow Angle', type: 'number', step: 0.1 },
  { key: 'dropShadowDistance', label: 'Shadow Distance', type: 'number', step: 1, min: 0 },
  // Gradient
  { key: 'fillType', label: 'Gradient Fill', type: 'select', options: [
    { value: '', label: 'None' },
    { value: 'linear_gradient', label: 'Linear Gradient' },
  ] },
  { key: 'gradientAngle', label: 'Gradient Angle (°)', type: 'number', step: 1 },
  { key: 'revealSpeed', label: '⌨ Speed (chars/s)', type: 'number', step: 0.5, min: 0.5 },
  // Background fill
  { key: 'textBackgroundEnabled', label: 'Background Fill', type: 'checkbox', checkLabel: 'Enabled' },
  { key: 'textBackgroundColor', label: 'Background Color', type: 'color' },
  { key: 'textBackgroundAlpha', label: 'Background Opacity', type: 'range', step: 0.05, min: 0, max: 1 },
  { key: 'textBackgroundPaddingX', label: 'Background Padding X', type: 'number', step: 1, min: 0 },
  { key: 'textBackgroundPaddingY', label: 'Background Padding Y', type: 'number', step: 1, min: 0 },
  { key: 'textBackgroundRadius', label: 'Background Radius', type: 'number', step: 1, min: 0 },
]

// Non-interpolatable properties for tween_text (set_text only)
const TEXT_NON_INTERPOLATABLE_KEYS = [
  'content', 'fontFamily', 'align', 'fontWeight', 'fontStyle', 'stroke',
  'wordWrap', 'textBoxMode', 'writingMode', 'dropShadow',
  'fillType', 'textBackgroundEnabled', 'textBackgroundColor',
  'dropShadowColor',
]

// Non-interpolatable property keys (tween_screen_effect should not include these)
const NON_INTERPOLATABLE_KEYS = ['baseColor', 'holeShape']

// effectClass → editable property keys mapping
const EFFECT_CLASS_ALLOWED_KEYS: Record<string, string[]> = {
  fullscreen_cover: ['baseColor'],
  iris_mask: ['baseColor', 'holeShape', 'openRatio', 'holeWidth', 'holeHeight'],
  spotlight: ['baseColor', 'holeShape', 'openRatio', 'holeWidth', 'holeHeight'],
}

// Get effectClass for current action target object
const targetEffectClass = computed(() => {
  const action = props.action
  if (!action) return undefined
  if (action.type !== 'set_screen_effect' && action.type !== 'tween_screen_effect') return undefined
  const obj = sceneObjectStore.getObject(action.target)
  if (obj?.type === 'screen_effect') {
    return (obj as ScreenEffectObject).effectClass
  }
  return undefined
})

// Property definitions filtered by effectClass
const filteredScreenEffectProps = computed(() => {
  const ec = targetEffectClass.value
  let base = SCREEN_EFFECT_PROPS
  if (ec) {
    const allowedKeys = EFFECT_CLASS_ALLOWED_KEYS[ec]
    if (allowedKeys) {
      base = SCREEN_EFFECT_PROPS.filter(prop => allowedKeys.includes(prop.key))
    }
  }
  // tween_screen_effect: exclude non-interpolatable properties (baseColor, holeShape)
  if (props.action?.type === 'tween_screen_effect') {
    return base.filter(prop => !NON_INTERPOLATABLE_KEYS.includes(prop.key))
  }
  return base
})


interface LooseObject {
  [key: string]: unknown
  alpha?: number
  visible?: boolean
  flipX?: boolean
  zIndex?: number
  x?: number
  y?: number
  scale?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  zoom?: number
  action?: string
  volume?: number
  loop?: boolean
  fadeIn?: number
  fadeOut?: number
}

// Visual parameters
const visualParams = ref<LooseObject>({})

// Geometry parameters
const geometryParams = ref<LooseObject>({})

// Audio parameters
const audioParams = ref<LooseObject>({})
const textRevealParams = ref<{ action: 'play' | 'stop'; mode: 'typewriter' }>({
  action: 'play',
  mode: 'typewriter',
})

// Screen effect parameters
const screenEffectParams = ref<LooseObject>({})

// Light parameters (Point light PRD Phase 0.5)
const lightParams = ref<LooseObject>({})

// Text property parameters (Text PRD)
const textParams = ref<LooseObject>({})

// v9.3: Dedicated set_visual property definitions (without alpha, alpha handled by set_transform)
const SET_VISUAL_PROPS: InspectorPropDef[] = [
  { key: 'visible', label: 'Visibility', type: 'checkbox', checkLabel: 'Visible' },
  { key: 'flipX', label: 'Flip', type: 'checkbox', checkLabel: 'Flip Horizontal' },
  { key: 'zIndex', label: 'Layer (Z-Index)', type: 'number', step: 1 },
  { key: 'receiveLighting', label: 'Scene Lighting', type: 'checkbox', checkLabel: 'Receive Scene Lighting' },
  { key: 'castShadow', label: 'Ground Shadow', type: 'checkbox', checkLabel: 'Cast Shadow' },
]

// v9.3: set_visual parameters
const setVisualParams = ref<LooseObject>({})

// P2: set_composite parameters
const compositeParams = ref<{ renderChain?: string[] | undefined }>({})

// Clip-Mask Phase 1 D3: set_mask parameters
const maskParams = ref<{ targetIds?: string[]; shape?: 'rectangle' | 'ellipse'; width?: number; height?: number }>({})
const maskTargetAddSelection = ref<string>('')

// Camera parameters
const cameraParams = ref({ x: 0, y: 0, zoom: 1 })

// Camera zoom percentage display (zoom * 100)
const cameraZoomPercent = computed(() => {
  return Math.round(cameraParams.value.zoom * 100)
})

// Watch action changes and update parameters
// v6.6: Add deep: true to watch action['params'] changes (for real-time update when dragging camera frame)
watch(() => props.action, (newAction) => {
  if (!newAction) {
    visualParams.value = {}
    geometryParams.value = {}
    return
  }
  
  const params = ('params' in newAction ? newAction.params : {}) as unknown as LooseObject
  
  if (newAction.type === 'set_transform') {
      visualParams.value = {
        alpha: params.alpha,
        visible: params.visible,
        flipX: params.flipX,
        zIndex: params.zIndex,
      } as LooseObject
    
    // v9.2: set_transform also supports geometry properties
    if (newAction.type === 'set_transform') {
      let currentScaleX: number | undefined = undefined
      let currentScaleY: number | undefined = undefined
      
      // Compatibility for legacy single-axis scale parameter
      if (params.scale !== undefined) {
         currentScaleX = currentScaleY = Math.round((params.scale) * 100)
      } else {
         if (params.scaleX !== undefined) currentScaleX = Math.round((params.scaleX) * 100)
         if (params.scaleY !== undefined) currentScaleY = Math.round((params.scaleY) * 100)
         // If legacy data only has scaleX without scaleY, default them to be equal
         if (currentScaleX !== undefined && currentScaleY === undefined) currentScaleY = currentScaleX
      }

      geometryParams.value = {
        x: params.x !== undefined ? Math.round(params.x) : undefined,
        y: params.y !== undefined ? Math.round(params.y) : undefined,
        scaleX: currentScaleX,
        scaleY: currentScaleY,
        rotation: params.rotation !== undefined ? Math.round((params.rotation) * 180 / Math.PI) : undefined,
        transformOriginX: params['transformOriginX'],
        transformOriginY: params['transformOriginY'],
      } as LooseObject
    }
  }
  
  if (newAction.type === 'tween_transform') {
    let currentScaleX: number | undefined = undefined
    let currentScaleY: number | undefined = undefined
    
    // Compatibility for legacy single-axis scale parameter
    if (params.scale !== undefined) {
        currentScaleX = currentScaleY = Math.round((params.scale) * 100)
    } else {
        if (params.scaleX !== undefined) currentScaleX = Math.round((params.scaleX) * 100)
        if (params.scaleY !== undefined) currentScaleY = Math.round((params.scaleY) * 100)
        if (currentScaleX !== undefined && currentScaleY === undefined) currentScaleY = currentScaleX
    }

    geometryParams.value = {
      x: params.x !== undefined ? Math.round(params.x) : undefined,
      y: params.y !== undefined ? Math.round(params.y) : undefined,
      scaleX: currentScaleX,
      scaleY: currentScaleY,
      rotation: params.rotation !== undefined ? Math.round((params.rotation) * 180 / Math.PI) : undefined,
      alpha: params.alpha,
    } as LooseObject
  }
  
  if (newAction.type === 'camera_cut' || newAction.type === 'camera_move') {
    cameraParams.value = {
      x: Math.round(params.x ?? 0),
      y: Math.round(params.y ?? 0),
      zoom: Math.round((params.zoom ?? 1) * 10) / 10,
    }
  }

  if (newAction.type === 'set_audio') {
    audioParams.value = {
      action: params.action ?? 'play',
      volume: params.volume,
      loop: params.loop,
      fadeIn: params.fadeIn,
      fadeOut: params.fadeOut
    } as LooseObject
  }

  if (newAction.type === 'set_text_reveal') {
    const action = params.action === 'stop' ? 'stop' : 'play'
    textRevealParams.value = {
      action,
      mode: 'typewriter',
    }
  }
  
  // v9.3: set_visual initialization
  if (newAction.type === 'set_visual') {
    setVisualParams.value = {
      visible: params.visible,
      flipX: params.flipX,
      zIndex: params.zIndex,
      receiveLighting: params['receiveLighting'],
      castShadow: params['castShadow'],
    } as LooseObject
  }

  // P2: set_composite initialization
  if (newAction.type === 'set_composite') {
    const compositeAction = newAction
    compositeParams.value = {
      renderChain: compositeAction.params.renderChain ?? undefined,
    }
  }

  // Clip-Mask Phase 1 D3: set_mask initialization
  if (newAction.type === 'set_mask') {
    const maskAction = newAction
    maskParams.value = {
      ...(maskAction.params.targetIds !== undefined ? { targetIds: [...maskAction.params.targetIds] } : {}),
      ...(maskAction.params.shape !== undefined ? { shape: maskAction.params.shape } : {}),
      ...(maskAction.params.width !== undefined ? { width: maskAction.params.width } : {}),
      ...(maskAction.params.height !== undefined ? { height: maskAction.params.height } : {}),
    }
    maskTargetAddSelection.value = ''
  }

  // Screen effect parameters initialization
  if (newAction.type === 'set_screen_effect' || newAction.type === 'tween_screen_effect') {
    screenEffectParams.value = { ...params } as LooseObject
  }

  // Light parameters initialization (Point light PRD Phase 0.5)
  if (newAction.type === 'set_light' || newAction.type === 'tween_light') {
    lightParams.value = { ...params } as LooseObject
  }

  // Text parameters initialization (Text PRD)
  if (newAction.type === 'set_text' || newAction.type === 'tween_text') {
    textParams.value = { ...params } as LooseObject
  }
}, { immediate: true, deep: true })

// Currently active visual properties (only non-undefined values)
const activeVisualProps = computed(() => {
  return VISUAL_PROPS.filter(prop => visualParams.value[prop.key] !== undefined)
})

// Currently active geometry properties
const activeGeometryProps = computed(() => {
  const base = GEOMETRY_PROPS.filter(prop => geometryParams.value[prop.key] !== undefined)
  // Transform origin is only displayed for set_transform
  if (props.action?.type === 'set_transform') {
    const originProps = TRANSFORM_ORIGIN_PROPS.filter(prop => geometryParams.value[prop.key] !== undefined)
    return [...base, ...originProps]
  }
  return base
})

// All active properties of tween_transform (geometry + opacity)
const activeTweenProps = computed(() => {
  const allProps = [...GEOMETRY_PROPS, ...TRANSFORM_VISUAL_PROPS]
  return allProps.filter(prop => geometryParams.value[prop.key] !== undefined)
})

// Currently active audio properties
const activeAudioProps = computed(() => {
  return AUDIO_PROPS.filter(prop => audioParams.value[prop.key] !== undefined)
})

// Currently active screen effect properties
const activeScreenEffectProps = computed(() => {
  return filteredScreenEffectProps.value.filter(prop => screenEffectParams.value[prop.key] !== undefined)
})

// v9.3: activeVisualPropsForSetVisual removed, set_visual properties displayed directly in template

// Available properties to add
const availablePropsToAdd = computed(() => {
  if (!props.action) return []
  
  // set_character removed
  
  // v9.3: set_transform only supports opacity + geometry properties (other visual props handled by set_visual)
  if (props.action.type === 'set_transform') {
    const availableVisual = TRANSFORM_VISUAL_PROPS.filter(prop => visualParams.value[prop.key] === undefined)
    const availableGeometry = GEOMETRY_PROPS.filter(prop => geometryParams.value[prop.key] === undefined)
    const availableOrigin = TRANSFORM_ORIGIN_PROPS.filter(prop => geometryParams.value[prop.key] === undefined)
    return [...availableGeometry, ...availableOrigin, ...availableVisual]
  }
  
  if (props.action.type === 'tween_transform') {
    const availableGeometry = GEOMETRY_PROPS.filter(prop => geometryParams.value[prop.key] === undefined)
    const availableAlpha = TRANSFORM_VISUAL_PROPS.filter(prop => geometryParams.value[prop.key] === undefined)
    return [...availableGeometry, ...availableAlpha]
  }

  if (props.action.type === 'set_audio') {
    return AUDIO_PROPS.filter(prop => audioParams.value[prop.key] === undefined)
  }

  // v9.3: set_visual available visual properties to add
  if (props.action.type === 'set_visual') {
    return SET_VISUAL_PROPS.filter(prop =>
      setVisualParams.value[prop.key] === undefined && canAddSetVisualProp(prop.key)
    )
  }
  
  // v11.0: set_anim is no longer managed via add-property, returns empty list
  if (props.action.type === 'set_anim') {
    return []
  }

  // P2: set_composite available composite properties to add
  if (props.action.type === 'set_composite') {
    return SET_COMPOSITE_PROPS.filter(prop => {
      const key = prop.key as keyof typeof compositeParams.value
      return compositeParams.value[key] === undefined
    })
  }

  // Clip-Mask Phase 1 D3: set_mask available properties to add
  if (props.action.type === 'set_mask') {
    return SET_MASK_PROPS.filter(prop => {
      const key = prop.key as keyof typeof maskParams.value
      return maskParams.value[key] === undefined
    })
  }

  // Screen effect parameters
  if (props.action.type === 'set_screen_effect' || props.action.type === 'tween_screen_effect') {
    return filteredScreenEffectProps.value.filter(prop => screenEffectParams.value[prop.key] === undefined)
  }

  // Text properties (Text PRD)
  if (props.action.type === 'set_text' || props.action.type === 'tween_text') {
    return filteredTextProps.value.filter(prop => textParams.value[prop.key] === undefined)
  }

  // Light parameters (Point light PRD Phase 0.5)
  if (props.action.type === 'set_light' || props.action.type === 'tween_light') {
    return filteredLightProps.value.filter(prop => lightParams.value[prop.key] === undefined)
  }
  
  return []
})

// Add property
function addProperty(key: string) {
  if (!props.action) return
  
  if (props.action.type === 'set_transform') {
    // v9.3: set_transform only supports opacity + geometry properties
    const visualProp = TRANSFORM_VISUAL_PROPS.find(p => p.key === key)
    if (visualProp) {
      // TRANSFORM_VISUAL_PROPS currently only has alpha (range type), default value 1
      visualParams.value[key] = 1
      handleVisualParamsChange()
    } else {
      // Geometry properties
      // Geometry properties
      if (key === 'scaleX' || key === 'scaleY') {
        geometryParams.value[key] = 100
      } else {
        geometryParams.value[key] = 0
      }
      handleSetTransformGeometryChange()
    }
  } else if (props.action.type === 'tween_transform') {
    // scale defaults to 100%, rotation defaults to 0 deg, alpha defaults to 1
    if (key === 'scaleX' || key === 'scaleY') {
      geometryParams.value[key] = 100
    } else if (key === 'alpha') {
      geometryParams.value[key] = 1
    } else {
      geometryParams.value[key] = 0
    }
    handleGeometryParamsChange()
  } else if (props.action.type === 'set_audio') {
    const prop = AUDIO_PROPS.find(p => p.key === key)
    if (prop) {
       const defaultValue = prop.type === 'checkbox' ? false : (prop.key === 'volume' ? 1.0 : 0)
       handleAudioParamsChange(key, defaultValue)
    }
  } else if (props.action.type === 'set_anim') {
    // v11.0: set_anim no longer adds properties this way
  } else if (props.action.type === 'set_visual') {
    // v9.3: Add set_visual property
    const prop = SET_VISUAL_PROPS.find(p => p.key === key)
    if (prop && canAddSetVisualProp(key)) {
      setVisualParams.value[key] = prop.type === 'checkbox' ? false : 0
      handleSetVisualParamsChange()
    }
  } else if (props.action.type === 'set_composite') {
    // P2: Add set_composite property
    if (key === 'renderChain') {
      // Read default value from target composite runtime renderChain
      const targetObj = sceneObjectStore.getObject(props.action.target)
      const currentRenderChain = targetObj?.type === 'composite'
        ? [...((targetObj as CompositeObject).renderChain ?? [])]
        : []
      compositeParams.value.renderChain = currentRenderChain
      handleCompositeParamsChange()
    }
  } else if (props.action.type === 'set_mask') {
    // Clip-Mask Phase 1 D3: Add set_mask property
    if (key === 'targetIds') {
      // Read default value from target mask current targetIds
      const targetObj = sceneObjectStore.getObject(props.action.target)
      const currentTargets = targetObj?.type === 'mask'
        ? [...((targetObj as MaskObject).targetIds ?? [])]
        : []
      maskParams.value.targetIds = currentTargets
      handleMaskParamsChange()
    } else if (key === 'shape') {
      // Read default value from target mask current shape
      const targetObj = sceneObjectStore.getObject(props.action.target)
      const currentShape: 'rectangle' | 'ellipse' = targetObj?.type === 'mask'
        ? ((targetObj as MaskObject).shape ?? 'rectangle')
        : 'rectangle'
      maskParams.value.shape = currentShape
      handleMaskParamsChange()
    } else if (key === 'width') {
      const targetObj = sceneObjectStore.getObject(props.action.target)
      maskParams.value.width = targetObj?.type === 'mask'
        ? Math.max(1, Number((targetObj as MaskObject).width) || 200)
        : 200
      handleMaskParamsChange()
    } else if (key === 'height') {
      const targetObj = sceneObjectStore.getObject(props.action.target)
      maskParams.value.height = targetObj?.type === 'mask'
        ? Math.max(1, Number((targetObj as MaskObject).height) || 200)
        : 200
      handleMaskParamsChange()
    }
  } else if (props.action.type === 'set_screen_effect' || props.action.type === 'tween_screen_effect') {
    const prop = SCREEN_EFFECT_PROPS.find(p => p.key === key)
    if (prop) {
      let defaultValue: string | number
      if (prop.type === 'color') defaultValue = '#000000'
      else if (prop.type === 'select') defaultValue = prop.options?.[0]?.value ?? 'circle'
      else if (prop.type === 'range') defaultValue = 0
      else defaultValue = 0
      screenEffectParams.value[key] = defaultValue
      handleScreenEffectParamsChange()
    }
  } else if (props.action.type === 'set_text' || props.action.type === 'tween_text') {
    // Add text property (Text PRD)
    const prop = TEXT_PROPS.find(p => p.key === key)
    if (prop) {
      let defaultValue: string | number
      if (prop.type === 'color') defaultValue = '#ffffff'
      else if (prop.type === 'textarea') defaultValue = ''
      else if (key === 'fontSize') defaultValue = 72
      else if (key === 'fontFamily') defaultValue = 'Noto Sans SC'
      else if (key === 'align') defaultValue = 'center'
      else if (key === 'fontWeight') defaultValue = 'normal'
      else if (key === 'fontStyle') defaultValue = 'normal'
      else if (key === 'strokeThickness') defaultValue = 0
      else if (key === 'revealSpeed') defaultValue = 8
      else if (key === 'textBoxMode') defaultValue = 'auto-size'
      else if (key === 'writingMode') defaultValue = 'horizontal'
      else if (key === 'fillType') defaultValue = ''
      else if (key === 'gradientAngle') defaultValue = 0
      else if (key === 'wordWrapWidth') defaultValue = 500
      else if (key === 'dropShadowAngle') defaultValue = 0.785
      else if (key === 'dropShadowDistance') defaultValue = 4
      else if (key === 'dropShadowBlur') defaultValue = 4
      else if (key === 'textBackgroundAlpha') defaultValue = 0.8
      else if (prop.type === 'checkbox') { textParams.value[key] = false; handleTextParamsChange(); showAddPropertyMenu.value = false; return }
      else defaultValue = 0
      textParams.value[key] = defaultValue
      handleTextParamsChange()
    }
  } else if (props.action.type === 'set_light' || props.action.type === 'tween_light') {
    // Add light property (Point light PRD Phase 0.5)
    const prop = LIGHT_PROPS.find(p => p.key === key)
    if (prop) {
      let defaultValue: string | number
      if (prop.type === 'color') defaultValue = '#ffffff'
      else if (key === 'lightIntensity') defaultValue = 1.0
      else if (key === 'lightRadius') defaultValue = 500
      else if (key === 'flicker') defaultValue = 0
      else if (key === 'flickerSpeed') defaultValue = 0.35
      else if (key === 'directionAngle') defaultValue = 0
      else if (key === 'coneAngle') defaultValue = 100
      else defaultValue = 0
      lightParams.value[key] = defaultValue
      handleLightParamsChange()
    }
  }
  
  showAddPropertyMenu.value = false
}

// Remove visual property
function removeVisualProp(key: string) {
  visualParams.value[key] = undefined
  handleVisualParamsChange()
}

// Remove geometry property
function removeGeometryProp(key: string) {
  geometryParams.value[key] = undefined
  // v17: Dispatch to correct handler by action type
  if (props.action?.type === 'set_transform') {
    handleSetTransformGeometryChange()
  } else {
    handleGeometryParamsChange()
  }
}

// Remove audio property
function removeAudioProp(key: string) {
  handleAudioParamsChange(key, undefined)
}

// v9.3: Remove set_visual property
function removeSetVisualProp(key: string) {
  setVisualParams.value[key] = undefined
  handleSetVisualParamsChange()
}

function canAddSetVisualProp(key: string): boolean {
  if (props.action?.type !== 'set_visual') return false

  const targetObj = sceneObjectStore.getObject(props.action.target)
  if (!targetObj) return true

  if (key === 'castShadow') {
    if (targetObj.type === 'prop' || targetObj.type === 'symbol' || targetObj.type === 'expression') return true
    if (targetObj.type === 'composite') {
      return (targetObj as CompositeObject).compositeMode === 'entity'
    }
    return false
  }

  if (key === 'receiveLighting') {
    if (targetObj.type === 'composite') {
      return (targetObj as CompositeObject).compositeMode === 'entity'
    }
    return targetObj.type !== 'background'
      && targetObj.type !== 'camera'
      && targetObj.type !== 'audio'
      && targetObj.type !== 'light'
      && targetObj.type !== 'screen_effect'
  }

  return true
}

// Remove screen effect property
function removeScreenEffectProp(key: string) {
  delete screenEffectParams.value[key]
  handleScreenEffectParamsChange()
}

// Remove light property (Point light PRD Phase 0.5)
function removeLightProp(key: string) {
  delete lightParams.value[key]
  handleLightParamsChange()
}

// Remove text property (Text PRD)
function removeTextProp(key: string) {
  delete textParams.value[key]
  handleTextParamsChange()
}

// P2: set_composite property definitions
const SET_COMPOSITE_PROPS: InspectorPropDef[] = [
  { key: 'renderChain', label: '📋 Render Chain Order', type: 'childList' },
]

// P2: Remove set_composite property
function removeCompositeProp(key: 'renderChain') {
  const updated = { ...compositeParams.value }
  delete updated[key]
  compositeParams.value = updated
  handleCompositeParamsChange()
}

// Clip-Mask Phase 1 D3: set_mask property definitions
const SET_MASK_PROPS: InspectorPropDef[] = [
  { key: 'targetIds', label: '✂ Clipping Targets', type: 'maskTargetList' },
  { key: 'shape', label: 'Shape', type: 'select', options: [
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'ellipse', label: 'Ellipse' },
  ] },
  { key: 'width', label: 'Width', type: 'number' },
  { key: 'height', label: 'Height', type: 'number' },
]

// Remove set_mask property
function removeMaskProp(key: 'targetIds' | 'shape' | 'width' | 'height') {
  const updated = { ...maskParams.value }
  delete updated[key]
  maskParams.value = updated
  handleMaskParamsChange()
}

// Handle set_mask parameter change (emit to parent component)
function handleMaskParamsChange() {
  const action = props.action
  if (action?.type !== 'set_mask') return
  const params: Record<string, unknown> = {}
  const mp = maskParams.value
  if (mp.targetIds !== undefined) params['targetIds'] = [...mp.targetIds]
  if (mp.shape !== undefined) params['shape'] = mp.shape
  if (mp.width !== undefined && Number.isFinite(mp.width) && mp.width > 0) params['width'] = mp.width
  if (mp.height !== undefined && Number.isFinite(mp.height) && mp.height > 0) params['height'] = mp.height
  emit('update', { params })
}

// Add mask clipping target
function addMaskTarget() {
  if (!maskTargetAddSelection.value) return
  const cur = maskParams.value.targetIds ?? []
  if (cur.includes(maskTargetAddSelection.value)) {
    maskTargetAddSelection.value = ''
    return
  }
  maskParams.value.targetIds = [...cur, maskTargetAddSelection.value]
  maskTargetAddSelection.value = ''
  handleMaskParamsChange()
}

// Remove mask clipping target
function removeMaskTarget(id: string) {
  const cur = maskParams.value.targetIds ?? []
  maskParams.value.targetIds = cur.filter(t => t !== id)
  handleMaskParamsChange()
}

// Current mask (mask object pointed to by set_mask.target, to exclude itself)
const maskCurrentMask = computed<MaskObject | null>(() => {
  const action = props.action
  if (action?.type !== 'set_mask') return null
  const obj = sceneObjectStore.getObject(action.target)
  return obj?.type === 'mask' ? (obj as unknown as MaskObject) : null
})

// Target ID set occupied by other masks (excluding this mask)
const maskClaimedByOthers = computed<Set<string>>(() => {
  const set = new Set<string>()
  const selfId = maskCurrentMask.value?.id ?? null
  for (const o of sceneObjectStore.objects) {
    if (o.type !== 'mask') continue
    if (o.id === selfId) continue
    for (const tid of (o as unknown as MaskObject).targetIds ?? []) set.add(tid)
  }
  return set
})

// Candidate targets: type allowed + not in current targetIds + not occupied by other mask + not this mask itself
const maskCandidateTargets = computed<SceneObject[]>(() => {
  const own = new Set(maskParams.value.targetIds ?? [])
  const selfId = maskCurrentMask.value?.id ?? null
  return sceneObjectStore.objects.filter(obj => {
    if (obj.id === selfId) return false
    if (!isAllowedMaskTargetType(obj.type)) return false
    if (own.has(obj.id)) return false
    if (maskClaimedByOthers.value.has(obj.id)) return false
    return true
  })
})

// Get mask target display name
function getMaskTargetName(id: string): string {
  const o = sceneObjectStore.getObject(id)
  return o?.alias || o?.name || id
}

// Get mask target icon
function getMaskTargetIcon(id: string): string {
  const o = sceneObjectStore.getObject(id)
  if (!o) return '❓'
  return getTypeIcon(o.type)
}
const scRcSelectedId = ref<string | null>(null)
const scRcDragOverIndex = ref(-1)
let scRcDragStartIndex = -1

const scRcSelectedIndex = computed(() => {
  if (!scRcSelectedId.value) return -1
  return compositeParams.value.renderChain?.indexOf(scRcSelectedId.value) ?? -1
})

// zIndex grouped display data
interface ScRcItemEntry {
  type: 'item'
  childId: string
  flatIndex: number
  zIndex: number
}

interface ScRcDividerEntry {
  type: 'divider'
  zIndex: number
}

type ScRcDisplayEntry = ScRcItemEntry | ScRcDividerEntry

/** Parse renderChain into display list with zIndex group dividers */
const scRcDisplay = computed((): ScRcDisplayEntry[] => {
  const chain = compositeParams.value.renderChain
  if (!chain || chain.length === 0) return []

  const entries: ScRcDisplayEntry[] = []
  let prevZIndex: number | null = null

  for (let i = 0; i < chain.length; i++) {
    const childId = chain[i]!
    const obj = sceneObjectStore.getObject(childId)
    const z = obj?.zIndex ?? 0

    // Insert divider on group transition
    if (prevZIndex !== null && z !== prevZIndex) {
      entries.push({ type: 'divider', zIndex: z })
    }

    entries.push({ type: 'item', childId, flatIndex: i, zIndex: z })
    prevZIndex = z
  }

  return entries
})

/** Get bounds [groupStart, groupEnd] (inclusive) for zIndex group at flatIndex */
function getScRcZIndexGroupBounds(flatIdx: number): [number, number] {
  const chain = compositeParams.value.renderChain
  if (!chain || flatIdx < 0 || flatIdx >= chain.length) return [-1, -1]
  const obj = sceneObjectStore.getObject(chain[flatIdx]!)
  const z = obj?.zIndex ?? 0
  let start = flatIdx
  let end = flatIdx
  while (start > 0) {
    const prevObj = sceneObjectStore.getObject(chain[start - 1]!)
    if ((prevObj?.zIndex ?? 0) !== z) break
    start--
  }
  while (end < chain.length - 1) {
    const nextObj = sceneObjectStore.getObject(chain[end + 1]!)
    if ((nextObj?.zIndex ?? 0) !== z) break
    end++
  }
  return [start, end]
}

const scRcCanMoveUp = computed(() => {
  const idx = scRcSelectedIndex.value
  if (idx <= 0) return false
  const [groupStart] = getScRcZIndexGroupBounds(idx)
  return idx > groupStart
})

const scRcCanMoveDown = computed(() => {
  const idx = scRcSelectedIndex.value
  const len = compositeParams.value.renderChain?.length ?? 0
  if (idx < 0 || idx >= len - 1) return false
  const [, groupEnd] = getScRcZIndexGroupBounds(idx)
  return idx < groupEnd
})

// P2: Handle child object reorder move (constrained by zIndex group)
function handleCompositeChildMove(index: number, direction: -1 | 1) {
  const renderChain = compositeParams.value.renderChain
  if (!renderChain) return
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= renderChain.length) return
  // zIndex boundary check
  const [groupStart, groupEnd] = getScRcZIndexGroupBounds(index)
  if (targetIndex < groupStart || targetIndex > groupEnd) return
  // swap
  const newRenderChain = [...renderChain]
  const temp = newRenderChain[index]!
  newRenderChain[index] = newRenderChain[targetIndex]!
  newRenderChain[targetIndex] = temp
  compositeParams.value.renderChain = newRenderChain
  // Follow selected item
  scRcSelectedId.value = newRenderChain[targetIndex] ?? null
  handleCompositeParamsChange()
}

// Drag and drop sorting (constrained by zIndex group)
function onScRcDragStart(idx: number, e: DragEvent) {
  scRcDragStartIndex = idx
  const chain = compositeParams.value.renderChain
  scRcSelectedId.value = chain?.[idx] ?? null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onScRcDragOver(idx: number) {
  // Only allow dragging within same zIndex group
  if (scRcDragStartIndex >= 0) {
    const chain = compositeParams.value.renderChain
    if (chain) {
      const srcObj = sceneObjectStore.getObject(chain[scRcDragStartIndex]!)
      const tgtObj = sceneObjectStore.getObject(chain[idx]!)
      const srcZ = srcObj?.zIndex ?? 0
      const tgtZ = tgtObj?.zIndex ?? 0
      if (srcZ !== tgtZ) {
        scRcDragOverIndex.value = -1
        return
      }
    }
  }
  scRcDragOverIndex.value = idx
}

function onScRcDragLeave() {
  scRcDragOverIndex.value = -1
}

function onScRcDrop(dropIdx: number) {
  scRcDragOverIndex.value = -1
  if (scRcDragStartIndex < 0 || scRcDragStartIndex === dropIdx) return
  const renderChain = compositeParams.value.renderChain
  if (!renderChain) return
  // zIndex cross-group validation
  const srcObj = sceneObjectStore.getObject(renderChain[scRcDragStartIndex]!)
  const tgtObj = sceneObjectStore.getObject(renderChain[dropIdx]!)
  const srcZ = srcObj?.zIndex ?? 0
  const tgtZ = tgtObj?.zIndex ?? 0
  if (srcZ !== tgtZ) return
  const newChain = [...renderChain]
  const [moved] = newChain.splice(scRcDragStartIndex, 1)
  if (!moved) return
  newChain.splice(dropIdx, 0, moved)
  compositeParams.value.renderChain = newChain
  scRcSelectedId.value = moved
  handleCompositeParamsChange()
}

function onScRcDragEnd() {
  scRcDragOverIndex.value = -1
  scRcDragStartIndex = -1
}

// P2: Handle set_composite parameters change
function handleCompositeParamsChange() {
  const action = props.action
  if (action?.type !== 'set_composite') return

  const params: Record<string, unknown> = {}
  const cv = compositeParams.value
  if (cv.renderChain !== undefined) {
    params['renderChain'] = [...cv.renderChain]
  }
  emit('update', { params })
}

// P2: Get child object display name
function getCompositeChildName(childId: string): string {
  const obj = sceneObjectStore.getObject(childId)
  if (!obj) return childId
  const alias = obj.alias
  if (alias?.trim()) return alias
  if (obj.name?.trim()) return obj.name
  return childId
}

// P2: Get child object icon (delegated to unified metadata registry)
function getCompositeChildIcon(childId: string): string {
  const obj = sceneObjectStore.getObject(childId)
  if (!obj) return '❓'
  return getTypeIcon(obj.type)
}

// Screen effect color change
function handleScreenEffectColorChange(key: string, value: string) {
  screenEffectParams.value[key] = value
  handleScreenEffectParamsChange()
}

// Screen effect select change (e.g. holeShape)
function handleScreenEffectSelectChange(key: string, value: string) {
  screenEffectParams.value[key] = value
  handleScreenEffectParamsChange()
}

// Screen effect parameter change
function handleScreenEffectParamsChange() {
  const action = props.action
  if (!action) return
  if (action.type !== 'set_screen_effect' && action.type !== 'tween_screen_effect') return

  // Collect all non-undefined parameters
  const updatedParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(screenEffectParams.value)) {
    if (value !== undefined) {
      updatedParams[key] = value
    }
  }

  emit('update', { params: updatedParams })
}

// Light parameter change (Point light PRD Phase 0.5)
function handleLightParamsChange() {
  const action = props.action
  if (!action) return
  if (action.type !== 'set_light' && action.type !== 'tween_light') return

  const updatedParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(lightParams.value)) {
    if (value !== undefined) {
      updatedParams[key] = value
    }
  }

  emit('update', { params: updatedParams })
}

// Light color change (Point light PRD Phase 0.5)
function handleLightColorChange(key: string, value: string) {
  lightParams.value[key] = value
  handleLightParamsChange()
}

// Light property definitions filtered by lightType
const filteredLightProps = computed(() => {
  const action = props.action
  if (!action) return LIGHT_PROPS
  if (action.type !== 'set_light' && action.type !== 'tween_light') return LIGHT_PROPS
  const obj = sceneObjectStore.getObject(action.target)
  if (obj?.type === 'light' && (obj as LightObject).lightType === 'ambient') {
    return LIGHT_PROPS.filter(p => p.key === 'lightColor' || p.key === 'lightIntensity')
  }
  if (obj?.type === 'light' && (obj as LightObject).lightType === 'spot') {
    return LIGHT_PROPS
  }
  return LIGHT_PROPS.filter(p => p.key !== 'directionAngle' && p.key !== 'coneAngle')
})

// Currently active light properties
const activeLightProps = computed(() => {
  return filteredLightProps.value.filter(prop => lightParams.value[prop.key] !== undefined)
})

// Text property filter (tween_text excludes non-interpolatable properties)
const filteredTextProps = computed(() => {
  if (props.action?.type === 'tween_text') {
    return TEXT_PROPS.filter(prop => !TEXT_NON_INTERPOLATABLE_KEYS.includes(prop.key))
  }
  return TEXT_PROPS
})

// Currently active text properties
const activeTextProps = computed(() => {
  return filteredTextProps.value.filter(prop => textParams.value[prop.key] !== undefined)
})

// Text parameter change (Text PRD)
function handleTextParamsChange() {
  const action = props.action
  if (!action) return
  if (action.type !== 'set_text' && action.type !== 'tween_text') return

  const updatedParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(textParams.value)) {
    if (value !== undefined) {
      updatedParams[key] = value
    }
  }

  emit('update', { params: updatedParams })
}

// Text color change
function handleTextColorChange(key: string, value: string) {
  textParams.value[key] = value
  handleTextParamsChange()
}

// Text select change
function handleTextSelectChange(key: string, value: string) {
  textParams.value[key] = value
  // Auto initialize gradientStops when fillType switches to linear_gradient
  if (key === 'fillType' && value === 'linear_gradient') {
    const existing = textParams.value['gradientStops'] as { offset: number; color: string }[] | undefined
    if (!existing || existing.length < 2) {
      textParams.value['gradientStops'] = [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#000000' },
      ]
    }
    if (textParams.value['gradientAngle'] === undefined) {
      textParams.value['gradientAngle'] = 90
    }
  }
  handleTextParamsChange()
}

// Text content change
function handleTextContentChange(value: string) {
  textParams.value['content'] = value
  handleTextParamsChange()
}

// Gradient stop change (two-color mode)
function handleTextGradientStopChange(index: number, color: string) {
  const stops = (textParams.value['gradientStops'] as { offset: number; color: string }[] | undefined) ?? [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#000000' },
  ]
  while (stops.length < 2) {
    stops.push({ offset: stops.length === 0 ? 0 : 1, color: '#000000' })
  }
  stops[index]!.color = color
  textParams.value['gradientStops'] = [...stops]
  handleTextParamsChange()
}

// Gradient stop computed property
const textGradientStartColor = computed(() => {
  const stops = textParams.value['gradientStops'] as { offset: number; color: string }[] | undefined
  return stops?.[0]?.color ?? '#ffffff'
})

const textGradientEndColor = computed(() => {
  const stops = textParams.value['gradientStops'] as { offset: number; color: string }[] | undefined
  return stops?.[1]?.color ?? '#000000'
})

// v16: set_material — Get target symbol material list
const targetSymbolMaterials = computed(() => {
  const action = props.action
  if (action?.type !== 'set_material') return []
  const targetObj = sceneObjectStore.getObject(action.target)
  if (targetObj?.type !== 'symbol') return []
  return (targetObj as SymbolObject).materials
})

// v18: set_material — Determine whether target is an expression object
const targetIsExpression = computed(() => {
  const action = props.action
  if (action?.type !== 'set_material') return false
  const targetObj = sceneObjectStore.getObject(action.target)
  return targetObj?.type === 'expression'
})

// v18: set_material — Get expression list
const targetExpressionList = computed(() => {
  if (!targetIsExpression.value) return []
  return expressionStore.expressionList
})

// v16: set_material — Handle material selection change
function handleMaterialIdChange(materialId: string) {
  emit('update', { params: { materialId } })
}

// v9.3: Handle set_visual parameter change
function handleSetVisualParamsChange() {
  const action = props.action
  if (action?.type !== 'set_visual') return
  
  const params: LooseObject = { ...(action.params ?? {}) }
  
  // Only retain properties with defined values
  for (const prop of SET_VISUAL_PROPS) {
    if (setVisualParams.value[prop.key] !== undefined) {
      params[prop.key] = setVisualParams.value[prop.key]
    } else {
      delete params[prop.key]
    }
  }
  
  emit('update', { params })
}

// Handle visual parameter change
function handleVisualParamsChange() {
  if (!props.action) return
  
  const action = props.action as unknown as { params?: Record<string, unknown> }
  const params: LooseObject = { ...(action.params ?? {}) }

  // Only retain properties with defined values
  for (const prop of VISUAL_PROPS) {
    if (visualParams.value[prop.key] !== undefined) {
      params[prop.key] = visualParams.value[prop.key]
    } else {
      delete params[prop.key]
    }
  }
  
  emit('update', { params })
}

// Handle geometry parameter change
function handleGeometryParamsChange() {
  if (props.action?.type !== 'tween_transform') return
  
  const action = props.action as unknown as { params?: Record<string, unknown> }
  const params: LooseObject = { ...(action.params ?? {}) }
  
  // x, y saved directly as integers
  if (geometryParams.value.x !== undefined) {
    params.x = Math.round(geometryParams.value.x)
  } else {
    delete params.x
  }
  
  if (geometryParams.value.y !== undefined) {
    params.y = Math.round(geometryParams.value.y)
  } else {
    delete params.y
  }
  
  // scaleX/scaleY converted from percentage back to scale
  if (geometryParams.value.scaleX !== undefined) {
    params.scaleX = geometryParams.value.scaleX / 100
  } else {
    delete params.scaleX
  }

  if (geometryParams.value.scaleY !== undefined) {
    params.scaleY = geometryParams.value.scaleY / 100
  } else {
    delete params.scaleY
  }
  
  // rotation converted from degrees back to radians
  if (geometryParams.value.rotation !== undefined) {
    params.rotation = (geometryParams.value.rotation) * Math.PI / 180
  } else {
    delete params.rotation
  }
  
  // alpha saved directly (0-1 range)
  if (geometryParams.value.alpha !== undefined) {
    params.alpha = geometryParams.value.alpha
  } else {
    delete params.alpha
  }
  
  emit('update', { params })
}

// v9.2: Handle set_transform geometry parameter change
function handleSetTransformGeometryChange() {
  if (props.action?.type !== 'set_transform') return
  
  const action = props.action as unknown as { params?: Record<string, unknown> }
  const params: LooseObject = { ...(action.params ?? {}) }
  
  // x, y saved directly as integers
  if (geometryParams.value.x !== undefined) {
    params.x = Math.round(geometryParams.value.x)
  } else {
    delete params.x
  }
  
  if (geometryParams.value.y !== undefined) {
    params.y = Math.round(geometryParams.value.y)
  } else {
    delete params.y
  }
  
  // scaleX/scaleY converted from percentage back to scale
  if (geometryParams.value.scaleX !== undefined) {
    params.scaleX = geometryParams.value.scaleX / 100
  } else {
    delete params.scaleX
  }

  if (geometryParams.value.scaleY !== undefined) {
    params.scaleY = geometryParams.value.scaleY / 100
  } else {
    delete params.scaleY
  }
  
  // rotation converted from degrees back to radians
  if (geometryParams.value.rotation !== undefined) {
    params.rotation = geometryParams.value.rotation * Math.PI / 180
  } else {
    delete params.rotation
  }

  // Transform origin: 0~1 normalized value, stored directly
  if (geometryParams.value['transformOriginX'] !== undefined) {
    params['transformOriginX'] = geometryParams.value['transformOriginX']
  } else {
    delete params['transformOriginX']
  }
  if (geometryParams.value['transformOriginY'] !== undefined) {
    params['transformOriginY'] = geometryParams.value['transformOriginY']
  } else {
    delete params['transformOriginY']
  }
  
  emit('update', { params })
}

// Handle audio parameter change
function handleAudioParamsChange(key: string, value: string | number | boolean | undefined) {
  if (props.action?.type !== 'set_audio') return
  
   
  const params: LooseObject = { ...audioParams.value, [key]: value }
  audioParams.value = params // Update local state
  
  // Clean up undefined
  const finalParams: LooseObject = {}
  if (params.action) finalParams.action = params.action
  for (const prop of AUDIO_PROPS) {
    if (params[prop.key] !== undefined) {
      finalParams[prop.key] = params[prop.key]
    }
  }
  
  emit('update', { params: finalParams })
}

function handleTextRevealParamsChange(key: 'action' | 'mode', value: string) {
  if (props.action?.type !== 'set_text_reveal') return

  const action = key === 'action'
    ? (value === 'stop' ? 'stop' : 'play')
    : textRevealParams.value.action
  textRevealParams.value = { action, mode: 'typewriter' }

  emit('update', {
    params: {
      action,
      mode: 'typewriter',
    }
  })
}

// Handle camera parameter change
function handleCameraParamsChange() {
  if (!props.action) return
  emit('update', { params: { ...cameraParams.value } })
}

// Handle camera X change (maintain integer)
function handleCameraXChange(event: Event) {
  const target = event.target as HTMLInputElement
  const value = Math.round(parseFloat(target.value) || 0)
  cameraParams.value.x = value
  handleCameraParamsChange()
}

// Handle camera Y change (maintain integer)
function handleCameraYChange(event: Event) {
  const target = event.target as HTMLInputElement
  const value = Math.round(parseFloat(target.value) || 0)
  cameraParams.value.y = value
  handleCameraParamsChange()
}

// Handle camera Zoom change (input percentage, convert to zoom value)
function handleCameraZoomChange(event: Event) {
  const target = event.target as HTMLInputElement
  const percent = parseFloat(target.value) || 100
  const zoom = Math.max(0.1, percent / 100)  // Percentage converted to zoom value
  cameraParams.value.zoom = Math.round(zoom * 100) / 100  // Keep 2 decimal places
  handleCameraParamsChange()
}

// Handle scale lock events
const scaleLocked = ref(true)

function toggleScaleLock() {
  scaleLocked.value = !scaleLocked.value
  if (scaleLocked.value) {
    if (geometryParams.value.scaleX !== undefined) {
      geometryParams.value.scaleY = geometryParams.value.scaleX
    } else if (geometryParams.value.scaleY !== undefined) {
      geometryParams.value.scaleX = geometryParams.value.scaleY
    }
    if (props.action?.type === 'set_transform') handleSetTransformGeometryChange()
    if (props.action?.type === 'tween_transform') handleGeometryParamsChange()
  }
}

function handleScaleChange(changedKey: string) {
  if (scaleLocked.value) {
    if (changedKey === 'scaleX' && geometryParams.value.scaleX !== undefined) {
      geometryParams.value.scaleY = geometryParams.value.scaleX
    } else if (changedKey === 'scaleY' && geometryParams.value.scaleY !== undefined) {
      geometryParams.value.scaleX = geometryParams.value.scaleY
    }
  }
  if (props.action?.type === 'set_transform') handleSetTransformGeometryChange()
  if (props.action?.type === 'tween_transform') handleGeometryParamsChange()
}

// Truncate slot text
function truncateSlotText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

// Get slot label (supports preroll/subtitle/postroll)
function getSlotLabel(slot: RuntimeSlot): string {
  if (slot.type === 'preroll') return 'Pre-roll'
  if (slot.type === 'postroll') return 'Post-roll'
  return truncateSlotText(slot.text ?? '', 15)
}

// Currently selected slot
// const currentSlot... (removed)

// Current slot text
// const currentSlotText... (removed)
// function formatSlotDuration... (removed)

// Determine whether action is duration action (v6.3)
function isDurationAction(action: Action): boolean {
  const durationActions: ActionType[] = [
    'tween_transform',
    'camera_move',
    'camera_follow', // v7.x: Add camera_follow
    'camera_shake'
  ]
  return durationActions.includes(action.type)
}

// Get target object icon
function getTargetIcon(target: string): string {
  if (target === 'camera') return '📷'
  if (target === SCENE_ACTION_TARGET) return '🎬'
  return '👤'
}

function getActionHeaderIcon(action: Action): string {
  if (action.type === 'set_text_reveal') return '⌨'
  return getTargetIcon(action.target)
}

function getActionHeaderTitle(action: Action): string {
  if (action.type === 'set_text_reveal') return 'Typewriter'
  return getTargetName(action.target)
}

// v7.0: Get target object name
function getTargetName(target: string): string {
  if (target === 'camera') return 'Camera'
  if (target === SCENE_ACTION_TARGET) return 'Current Scene'
  
  // v7.0: Look up scene object via instance ID
  const obj = sceneObjectStore.getObject(target)
  if (obj) {
    // v7.1: Prefer alias (ensure non-empty string)
    const alias = obj.alias
    if (alias?.trim()) {
      return alias
    }
    if (obj.name?.trim()) {
      return obj.name
    }
  }
  
  // v7.1: If object not found, provide user-friendly display
  if (target.startsWith('char_')) {
    return 'Character ' + target.substring(5, 13) + '...'
  }
  if (target.startsWith('bg_')) {
    return 'Background ' + target.substring(3, 11) + '...'
  }
  
  return target
}

// Shake parameters - using ref
const shakeParams = ref({
  intensity: 0,
  decay: false,
  frequency: 10
})

// Camera follow parameters
const followParams = ref({
  followTarget: '',

  damping: 0,
  offsetX: 0,
  offsetY: -50,  // Default -50, placing character slightly lower
  zoom: undefined as number | undefined,  // Optional zoom parameter
  smoothEntry: false,  // v15: Smooth transition
  smoothEntryDuration: 300,  // v15: Smooth transition duration (ms)
  autoZoom: false,  // v15: Auto zoom
  autoZoomRange: 5,  // v15: Zoom range %
  autoZoomCycles: 0.5,  // v15: Zoom cycles
  constrainBounds: false  // v6.9: Boundary constraint option
})

// P2: Custom tree dropdown state
const showFollowDropdown = ref(false)

// P2: Track expanded composite ID set (collapsed by default)
const expandedComposites = ref(new Set<string>())



function toggleCompositeExpand(compositeId: string) {
  const next = new Set(expandedComposites.value)
  if (next.has(compositeId)) {
    next.delete(compositeId)
  } else {
    next.add(compositeId)
  }
  expandedComposites.value = next
}

// P2: Get display label for currently selected target (recursive lookup)
const selectedFollowTargetLabel = computed(() => {
  const targetId = followParams.value.followTarget
  if (!targetId) return ''
  function findInTree(items: FollowTargetTreeItem[]): string | undefined {
    for (const item of items) {
      if (item.id === targetId) return `${item.icon} ${item.alias}`
      if (item.children) {
        const found = findInTree(item.children)
        if (found) return found
      }
    }
    return undefined
  }
  return findInTree(followTargetTree.value) ?? targetId
})

// P2: Handle dropdown blur (delayed close to prevent flicker when clicking child elements)
function onFollowDropdownFocusOut(event: FocusEvent) {
  const dropdown = (event.currentTarget as HTMLElement)
  const relatedTarget = event.relatedTarget as HTMLElement | null
  // Do not close if focus is still within dropdown container
  if (relatedTarget && dropdown.contains(relatedTarget)) return
  // Delayed close, allowing click event to trigger first
  setTimeout(() => { showFollowDropdown.value = false }, 150)
}
// v6.9: Get actual zoom value of current camera
const currentCameraZoom = computed(() => {
  const cameraObj = sceneObjectStore.objects.find(obj => obj.type === 'camera')
  return (cameraObj as CameraObject).zoom ?? 1
})

// Follow zoom percentage display (zoom * 100, always shows current value)
const followZoomPercent = computed(() => {
  // v6.9: If zoom is undefined, use current camera actual zoom
  const zoom = followParams.value.zoom ?? currentCameraZoom.value
  return Math.round(zoom * 100)
})

// v9.2: Determine if action is Death Action (despawn action)
const isCurrentDeathAction = computed(() => {
  if (!props.action) return false
  return isDeathAction(props.action)
})

// v9.5: Determine if action is Birth Action (spawn action) - for autoDespawnOnBlockEnd control
const isCurrentBirthAction = computed(() => {
  if (!props.action) return false
  return isBirthAction(props.action)
})

// v9.5: Handle 'Auto-despawn at end of block' checkbox change
function handleAutoDespawnChange(checked: boolean) {
  if (!props.action) return
  const currentParams = (props.action as SetLifecycleAction).params
  emit('update', {
    params: { ...currentParams, autoDespawnOnBlockEnd: checked }
  } as Partial<Action>)
}

// Determine whether action is camera action
const isCameraAction = computed(() => {
  if (!props.action) return false
  const cameraActionTypes = ['camera_cut', 'camera_move', 'camera_follow', 'camera_shake']
  return cameraActionTypes.includes(props.action.type)
})

// v7.0: Available instance list (for follow target selection: characters, props, composites, backgrounds)
// v9.3: Filter out despawned objects according to aliveObjectIds
const FOLLOW_TARGET_ICONS: Record<string, string> = {
  character: '👤',
  prop: '📦',
  composite: '🧩',
  background: '🖼️',
  expression: '😀',
}

interface FollowTargetTreeItem {
  id: string
  alias: string
  type: string
  icon: string
  children?: FollowTargetTreeItem[]  // composite type has child objects (both entity and union supported)
}

/** Flattened visible list items for template v-for rendering */
interface FollowTargetFlatItem {
  id: string
  alias: string
  type: string
  icon: string
  depth: number
  hasChildren: boolean
}

/** Check whether object is in alive list */
function isAlive(objId: string): boolean {
  if (!props.aliveObjectIds || props.aliveObjectIds.length === 0) return true
  return props.aliveObjectIds.includes(objId)
}

/**
 * Tree-structure follow target list (recursively constructed):
 * - Both entity / union composite objects build children with expand/collapse support
 * - Non-composite child objects do not appear redundantly at root level
 */
const followTargetTree = computed<FollowTargetTreeItem[]>(() => {
  const supportedTypes = ['character', 'prop', 'composite', 'background', 'expression']
  // Collect set of childIds for all composites
  const allChildIds = new Set<string>()
  for (const obj of sceneObjectStore.objects) {
    if (obj.type === 'composite') {
      for (const cid of ((obj as CompositeObject).childIds ?? [])) {
        allChildIds.add(cid)
      }
    }
  }

  /** Recursively construct single object node */
  function buildItem(obj: SceneObject): FollowTargetTreeItem {
    const item: FollowTargetTreeItem = {
      id: obj.id,
      alias: obj.alias ?? obj.name ?? obj.id,
      type: obj.type,
      icon: FOLLOW_TARGET_ICONS[obj.type] ?? '?',
    }
    if (obj.type === 'composite') {
      const composite = obj as CompositeObject
      // Both entity / union build children
      const children = (composite.childIds ?? [])
        .map(cid => sceneObjectStore.objects.find(o => o.id === cid))
        .filter((child): child is SceneObject => !!child && isAlive(child.id))
        .map(child => buildItem(child))  // Recursive construction
      if (children.length > 0) {
        item.children = children
      }
    }
    return item
  }

  const result: FollowTargetTreeItem[] = []
  for (const obj of sceneObjectStore.objects) {
    if (!supportedTypes.includes(obj.type)) continue
    if (!isAlive(obj.id)) continue
    // Skip child objects already contained in composite (displayed under composite)
    if (allChildIds.has(obj.id)) continue
    result.push(buildItem(obj))
  }
  return result
})

/**
 * Flattened visible list (recursively flattened according to expand state):
 * Template directly iterates this list via v-for, using depth to control indentation
 */
const flatFollowTargetList = computed<FollowTargetFlatItem[]>(() => {
  const result: FollowTargetFlatItem[] = []
  function flatten(items: FollowTargetTreeItem[], depth: number) {
    for (const item of items) {
      const hasChildren = !!(item.children && item.children.length > 0)
      result.push({
        id: item.id,
        alias: item.alias,
        type: item.type,
        icon: item.icon,
        depth,
        hasChildren,
      })
      if (hasChildren && expandedComposites.value.has(item.id)) {
        flatten(item.children!, depth + 1)
      }
    }
  }
  flatten(followTargetTree.value, 0)
  return result
})

// P2: Clean up non-existent composite IDs (recursively collect valid IDs)
watch(() => followTargetTree.value, (tree) => {
  function collectIds(items: FollowTargetTreeItem[], ids: Set<string>) {
    for (const item of items) {
      ids.add(item.id)
      if (item.children) collectIds(item.children, ids)
    }
  }
  const validIds = new Set<string>()
  collectIds(tree, validIds)
  const cleaned = new Set<string>()
  for (const id of expandedComposites.value) {
    if (validIds.has(id)) cleaned.add(id)
  }
  expandedComposites.value = cleaned
})

// Watch action changes and update shakeParams
watch(() => props.action, (newAction) => {
  if (newAction?.type !== 'camera_shake') {
    shakeParams.value = { intensity: 0, decay: false, frequency: 10 }
    return
  }
  
  const action = newAction
  shakeParams.value = {
    intensity: action.params?.intensity ?? 0,
    decay: action.params?.decay ?? false,
    frequency: action.params?.frequency ?? 10
  }
}, { immediate: true })

// set_character logic in focusField watch removed

// Handle slot index change (dropdown selection, directly uses 0-based index)
function handleSlotIndexChange(event: Event) {
  if (!props.action) return
  const target = event.target as HTMLSelectElement
  const slotIndex = parseInt(target.value, 10)
  if (!isNaN(slotIndex) && slotIndex >= 0) {
    emit('update', { slotIndex })
  }
}

// Handle slot span change
function handleSlotSpanChange(event: Event) {
  if (!props.action || !isDurationAction(props.action)) return
  const target = event.target as HTMLInputElement
  const slotSpan = parseInt(target.value, 10)
  if (!isNaN(slotSpan) && slotSpan >= 1) {
    emit('update', { slotSpan, easing: 'linear' })
  }
}

// Handle shake parameters change
function handleShakeChange() {
  if (props.action?.type !== 'camera_shake') return
  
  const params = {
    intensity: shakeParams.value.intensity,
    decay: shakeParams.value.decay,
    frequency: shakeParams.value.frequency
  }
  
  emit('update', { params })
}

// ==================== Camera Console Functions ====================

// switchCameraActionType removed


// Handle easing function change
// function handleEasingChange... (removed)

// Handle follow target change
function selectFollowTarget(targetId: string) {
  if (!props.action) return
  followParams.value.followTarget = targetId
  showFollowDropdown.value = false
  handleFollowParamsChange()
}

// Handle follow parameters change
function handleFollowParamsChange() {
  if (!props.action) return

  const params: Record<string, string | number | boolean | undefined> = {
    followTarget: followParams.value.followTarget,

    damping: followParams.value.damping,
    offsetX: followParams.value.offsetX,
    offsetY: followParams.value.offsetY,
    smoothEntry: followParams.value.smoothEntry,
    smoothEntryDuration: followParams.value.smoothEntryDuration,
    autoZoom: followParams.value.autoZoom,
    autoZoomRange: followParams.value.autoZoomRange,
    autoZoomCycles: followParams.value.autoZoomCycles,
    constrainBounds: followParams.value.constrainBounds
  }

  if (followParams.value.zoom !== undefined) {
    params['zoom'] = followParams.value.zoom
  }

  emit('update', { params })
}

// Handle follow zoom change (input percentage, convert to zoom value)
function handleFollowZoomChange(event: Event) {
  const target = event.target as HTMLInputElement
  const percent = parseFloat(target.value)
  if (!isNaN(percent) && percent > 0) {
    followParams.value.zoom = Math.round(percent) / 100  // Percentage converted to zoom value
  } else {
    followParams.value.zoom = undefined
  }
  handleFollowParamsChange()
}

// function clearFollowZoom... (removed)
// function useCurrentZoom... (removed)

// Watch action changes and update followParams
watch(() => props.action, (newAction) => {
  if (newAction?.type !== 'camera_follow') {
    followParams.value = { followTarget: '', damping: 0, offsetX: 0, offsetY: -50, zoom: undefined, smoothEntry: false, smoothEntryDuration: 300, autoZoom: false, autoZoomRange: 5, autoZoomCycles: 0.5, constrainBounds: false }
    return
  }
  
  const action = newAction
  followParams.value = {
    followTarget: action.params?.followTarget ?? '',

    damping: action.params?.damping ?? 0,
    offsetX: action.params?.offsetX ?? 0,
    offsetY: action.params?.offsetY ?? -50,
    zoom: action.params?.zoom,  // May be undefined
    smoothEntry: action.params?.smoothEntry ?? false,  // v15: Smooth transition
    smoothEntryDuration: action.params?.smoothEntryDuration ?? 300,  // v15: Smooth transition duration
    autoZoom: action.params?.autoZoom ?? false,  // v15: Auto zoom
    autoZoomRange: action.params?.autoZoomRange ?? 5,  // v15: Zoom range
    autoZoomCycles: action.params?.autoZoomCycles ?? 0.5,  // v15: Zoom cycles
    constrainBounds: action.params?.constrainBounds ?? false  // v6.9: Boundary constraint
  }
}, { immediate: true })

// Handle expression selection
function handleExpressionSelect(_expressionId: string) {
  // set_character removed, this function is a no-op
  showExpressionDialog.value = false
}



// Handle generic update
// function handleUpdate... (removed)

// ==================== v11.0: set_anim Support ====================

// Get set_anim target resource type and ID
function getSetAnimTargetResource(): { type: 'prop' | 'background'; id: string } | null {
  if (props.action?.type !== 'set_anim') return null
  const target = props.action.target
  const obj = sceneObjectStore.getObject(target)
  if (!obj) return null
  
  if (obj.type === 'prop') {
    return { type: 'prop', id: obj.refId }
  } else if (obj.type === 'background') {
    return { type: 'background', id: obj.refId }
  }
  return null
}

// v11.1: Get available Animation list for target resource
const availableAnimations = computed(() => {
  const result: {
    id: string
    name: string
    source: 'resource' | 'scene'
    timingMode: AnimationTimingMode
  }[] = []
  
  const target = props.action?.target
  
  // v16: Scene object: prioritize reading from SceneObject.animations
  const targetObj = target ? sceneObjectStore.getObject(target) : null
  if (targetObj) {
    // Prioritize object-level animations
    const objectAnims = animationStore.getObjectAnimations(targetObj)
    if (objectAnims.length > 0) {
      for (const anim of objectAnims) {
        result.push({ id: anim.id, name: anim.name, source: 'resource', timingMode: anim.timingMode ?? 'continuous' })
      }
      return result
    }
  }

  // Fallback: resource-level lookup (for non-migrated objects)
  const resource = getSetAnimTargetResource()
  if (resource) {
    const resourceAnims = animationStore.getAnimations(resource.type, resource.id)
    for (const anim of resourceAnims) {
      result.push({ id: anim.id, name: anim.name, source: 'resource', timingMode: anim.timingMode ?? 'continuous' })
    }
  }
  
  return result
})

// v11.3: Animation state management (supports multi-animation)
// Data structure: params.animations = [{ animName, action, loop }, ...]
// v11.52: With on-demand addition mode, getAnimActionState and getAnimLoopState are no longer needed

// Handle animation play/stop change
function handleSetAnimAction(animName: string, action: 'play' | 'stop') {
  updateAnimationsParams(animName, { action })
}

// v11.88: handleSetAnimLoop removed, loop setting controlled by Animation resource definition

// Update animations array parameter
// v11.88: Removed loop property, loop setting controlled by Animation resource definition
function updateAnimationsParams(animName: string, updates: { action?: 'play' | 'stop' }) {
  if (props.action?.type !== 'set_anim') return
  
  // v11.88: animations is the only required format
  type AnimItem = SetAnimAction['params']['animations'][number]
  const animations: AnimItem[] = [...(props.action.params.animations || [])]
  // Find or create animation item
  const existingIndex = animations.findIndex(a => a.animName === animName)
  if (existingIndex >= 0) {
    const existing = animations[existingIndex]
    if (existing) {
      // v11.88: Use conditional property assignment to avoid exactOptionalPropertyTypes error
      const updatedItem: AnimItem = {
        animName: existing.animName
      }
      // Only assign optional properties when value is present
      const newAction = updates.action !== undefined ? updates.action : existing.action
      if (newAction !== undefined) {
        updatedItem.action = newAction
      }
      if (existing.autoStopOnBlockEnd !== undefined) {
        updatedItem.autoStopOnBlockEnd = existing.autoStopOnBlockEnd
      }
      // v12.x: preserve loop override
      if (existing.loop !== undefined) {
        updatedItem.loop = existing.loop
      }
      if (newAction !== 'stop' && existing.timingMode !== undefined) {
        updatedItem.timingMode = existing.timingMode
      }
      animations[existingIndex] = updatedItem
    }
  } else {
    const newItem: AnimItem = { animName }
    if (updates.action !== undefined) newItem.action = updates.action
    else newItem.action = 'stop'
    animations.push(newItem)
  }
  
  // v11.52: On-demand addition mode - no longer auto-filters stop state animations
  // Explicitly added animations must be retained regardless of state
  
  emit('update', {
    params: {
      animations
    }
  })
}

// v11.52: On-demand addition mode - menu display state
const showAddAnimMenu = ref(false)

// v11.52: Current added animation list (read from action.params.animations)
// v11.88: animations is the only required format, includes autoStopOnBlockEnd property
const currentAnimations = computed(() => {
  if (props.action?.type !== 'set_anim') return []
  return props.action.params.animations || []
})

// v11.52: Available animations to add (excluding already added)
const availableAnimationsToAdd = computed(() => {
  const addedNames = new Set(currentAnimations.value.map(a => a.animName))
  return availableAnimations.value.filter(anim => !addedNames.has(anim.name))
})

// v11.52: Add animation to action
// v11.88: Includes autoStopOnBlockEnd property (default true)
function addAnimToAction(animName: string) {
  if (props.action?.type !== 'set_anim') return
  
  type AnimItem = SetAnimAction['params']['animations'][number]
  const animations: AnimItem[] = [...currentAnimations.value]
  
  // Add new animation, default play, default stop on block end
  animations.push({
    animName,
    action: 'play',
    autoStopOnBlockEnd: true
  })
  
  emit('update', {
    params: {
      animations
    }
  })
  
  showAddAnimMenu.value = false
}

// v11.52: Remove animation from action
// v11.88: Remove loop property
function removeAnimFromAction(index: number) {
  if (props.action?.type !== 'set_anim') return
  
  interface AnimItem { animName: string; action?: 'play' | 'stop' }
  const animations: AnimItem[] = [...currentAnimations.value]
  
  animations.splice(index, 1)
  
  emit('update', {
    params: {
      animations
    }
  })
}

// v11.88: Handle per-animation auto-stop at block end change
function handleAnimAutoStopChange(index: number, checked: boolean) {
  if (props.action?.type !== 'set_anim') return
  
  type AnimItem = SetAnimAction['params']['animations'][number]
  const animations: AnimItem[] = [...(props.action.params.animations || [])]
  
  if (animations[index]) {
    animations[index] = {
      ...animations[index],
      autoStopOnBlockEnd: checked
    }
  }
  
  emit('update', {
    params: {
      animations
    }
  })
}

// v12.x: handle loop override change
function handleAnimLoopOverrideChange(index: number, value: string) {
  if (props.action?.type !== 'set_anim') return
  
  type AnimItem = SetAnimAction['params']['animations'][number]
  const animations: AnimItem[] = [...(props.action.params.animations || [])]
  
  if (animations[index]) {
    const item = { ...animations[index] }
    if (value === '') {
      // Default: remove loop property
      delete (item as Record<string, unknown>)['loop']
    } else {
      item.loop = value === 'true'
    }
    animations[index] = item
  }
  
  emit('update', {
    params: {
      animations
    }
  })
}

function handleAnimTimingModeChange(index: number, value: string) {
  if (props.action?.type !== 'set_anim') return

  type AnimItem = SetAnimAction['params']['animations'][number]
  const animations: AnimItem[] = [...(props.action.params.animations || [])]

  if (animations[index]) {
    const item = { ...animations[index] }
    if (value === '') {
      delete (item as Record<string, unknown>)['timingMode']
    } else {
      item.timingMode = value as AnimationTimingMode
    }
    animations[index] = item
  }

  emit('update', {
    params: {
      animations
    }
  })
}


// Get camera action icon
function getCameraActionIcon(type: string): string {
  switch (type) {
    case 'camera_cut':
      return '✂️'
    case 'camera_move':
      return '🎞️'
    case 'camera_follow':
      return '🎯'
    case 'camera_shake':
      return '💥'
    default:
      return ''
  }
}

// Get camera action type name
function getCameraActionTypeName(type: string): string {
  switch (type) {
    case 'camera_cut':
      return 'Camera Cut'
    case 'camera_move':
      return 'Camera Move'
    case 'camera_follow':
      return 'Follow'
    case 'camera_shake':
      return 'Shake'
    default:
      return ''
  }
}

</script>

<style scoped>
.action-inspector {
  height: 100%;
  overflow-y: auto;
}

.empty-hint {
  padding: 20px;
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
}

.inspector-form {
  padding: 16px;
}

.inspector-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.target-object {
  display: flex;
  align-items: center;
  gap: 8px;
}

.target-icon {
  font-size: 20px;
}

.target-name {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
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

.property-field input[type="number"],
.property-field input[type="text"],
.property-field select {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: #374151;
  border: 1px solid #cfd8e3;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.property-field input[type="number"]:focus,
.property-field input[type="text"]:focus,
.property-field select:focus {
  outline: none;
  border-color: #9fb7d9;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.property-field input[type="range"] {
  width: 100%;
  margin-top: 8px;
}

.property-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.radio-group {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
}

.radio-label input[type="radio"] {
  width: auto;
  cursor: pointer;
  margin: 0;
}

.radio-text {
  user-select: none;
}

.input-with-value {
  width: 100%;
}

.input-with-value input {
  width: 100%;
}

.unit {
  font-size: 12px;
  color: #9ca3af;
  margin-left: 4px;
}

.value-label {
  font-size: 12px;
  color: #6b7280;
  margin-left: 8px;
}

.segmented-control {
  display: flex;
  gap: 4px;
  background: #f3f4f6;
  padding: 2px;
  border-radius: 4px;
}

.segmented-btn {
  flex: 1;
  padding: 6px 12px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: #6b7280;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.segmented-btn:hover {
  background: rgba(255, 255, 255, 0.5);
}

.segmented-btn.active {
  background: white;
  color: #3b82f6;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
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

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  cursor: pointer;
}

.checkbox-row {
  margin-top: 8px;
}

/* v6.2 Styles */
.type-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.type-badge.point {
  background: rgba(251, 191, 36, 0.2);
  color: #f59e0b;
}

.type-badge.duration {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.type-explanation {
  margin-top: 8px;
  font-size: 11px;
  color: #9ca3af;
  line-height: 1.4;
  padding: 6px 10px;
  background: #f9fafb;
  border-radius: 4px;
  border-left: 3px solid #d1d5db;
}

.hint {
  font-size: 11px;
  color: #9ca3af;
  margin-left: 8px;
}

/* Slot text display styles */
.slot-text-display {
  margin-top: 12px;
  background: #f0f7ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  overflow: hidden;
}

.slot-text-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #e0f2fe;
  border-bottom: 1px solid #bfdbfe;
}

.slot-badge {
  font-size: 12px;
  font-weight: 600;
  color: #0369a1;
  background: white;
  padding: 2px 8px;
  border-radius: 4px;
}

.slot-duration {
  font-size: 11px;
  color: #0891b2;
  font-family: 'Courier New', monospace;
}

.slot-text-content {
  padding: 10px 12px;
  font-size: 13px;
  color: #1e40af;
  line-height: 1.5;
  background: white;
}

/* v6.3 Delta mode styles */
.action-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}

.action-type-badge.point {
  background: rgba(251, 191, 36, 0.2);
  color: #f59e0b;
}

.action-type-badge.duration {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.delta-property-item {
  margin-bottom: 12px;
  padding: 8px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.delta-property-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.delta-property-label {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.delta-remove-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delta-remove-btn:hover {
  background: #fecaca;
}

.empty-props-hint {
  padding: 16px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px dashed #d1d5db;
}

.scene-structure-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scene-structure-summary {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.scene-structure-icon {
  font-size: 24px;
  line-height: 1;
}

.scene-structure-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.scene-structure-hint {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
}

.scene-structure-counts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.scene-structure-counts span {
  padding: 3px 8px;
  font-size: 12px;
  color: #374151;
  background: #f3f4f6;
  border-radius: 4px;
}

.scene-structure-object-entry {
  margin-bottom: 10px;
}

.scene-structure-object-entry:last-child {
  margin-bottom: 0;
}

.scene-structure-auto-restore-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
  padding-left: 2px;
  color: #4b5563;
  font-size: 12px;
  cursor: pointer;
}

.scene-structure-auto-restore-row input {
  margin: 0;
}

.scene-structure-section {
  padding: 10px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.scene-structure-operation-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.scene-structure-operation-hint {
  margin-top: 2px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.4;
}

.scene-structure-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}

.scene-structure-subsection {
  padding-top: 10px;
  margin-top: 10px;
  border-top: 1px solid #e5e7eb;
}

.scene-structure-subtitle {
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.scene-structure-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(100px, 140px);
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.scene-structure-row:last-child {
  margin-bottom: 0;
}

.scene-structure-object {
  min-width: 0;
}

.scene-structure-name {
  display: block;
  overflow: hidden;
  color: #111827;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scene-structure-missing {
  display: block;
  margin-top: 2px;
  color: #dc2626;
  font-size: 11px;
}

.scene-structure-value {
  min-width: 0;
  padding: 5px 8px;
  overflow: hidden;
  color: #374151;
  font-size: 12px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* v9.2: Death Action simplified panel styles */
.death-action-panel {
  text-align: center;
  padding: 24px 16px;
  background: linear-gradient(135deg, rgba(234, 88, 12, 0.1), rgba(220, 38, 38, 0.1));
  border-radius: 8px;
  border: 1px dashed rgba(234, 88, 12, 0.3);
}
.death-action-panel .death-icon {
  font-size: 48px;
  margin-bottom: 8px;
}
.death-action-panel .death-label {
  font-size: 16px;
  font-weight: 600;
  color: #ea580c;
}
.death-action-panel .death-hint {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 8px;
}

.add-property-section {
  position: relative;
  margin-top: 8px;
}

.add-property-btn {
  width: 100%;
  padding: 8px 16px;
  border: 1px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.05);
  color: #3b82f6;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.add-property-btn:hover {
  background: rgba(59, 130, 246, 0.1);
}

.add-property-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 10;
  overflow: hidden;
}

.add-property-option {
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
}

.add-property-option:hover {
  background: #f3f4f6;
}

/* Part material edit area */
.part-assets-edit-section {
  margin-top: 12px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.part-assets-edit-section .section-header {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
}

.part-assets-edit-section .section-label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.part-asset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}

.part-asset-row:last-child {
  border-bottom: none;
}

.part-asset-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 80px;
}

.part-asset-icon {
  font-size: 14px;
}

.part-asset-name {
  font-size: 12px;
  color: #6b7280;
}

.part-asset-value {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.part-asset-thumbnail {
  width: 24px;
  height: 24px;
  object-fit: contain;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.part-asset-asset-name {
  font-size: 12px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.part-asset-placeholder {
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
}

.part-asset-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.part-asset-edit-btn {
  padding: 4px 8px;
  font-size: 11px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.part-asset-edit-btn:hover {
  background: #2563eb;
}

.part-asset-remove-btn {
  width: 20px;
  height: 20px;
  font-size: 12px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.part-asset-remove-btn:hover {
  background: #fecaca;
}

/* Pose switch confirmation dialog */
.confirm-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-dialog {
  background: white;
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.confirm-dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 16px;
}

.confirm-dialog-content {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 20px;
}

.invalid-parts-list {
  margin-top: 12px;
  padding-left: 20px;
  color: #dc2626;
}

.invalid-parts-list li {
  margin: 4px 0;
}

.confirm-dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.confirm-btn-cancel {
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  background: white;
  color: #374151;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.confirm-btn-cancel:hover {
  background: #f3f4f6;
}

.confirm-btn-confirm {
  padding: 8px 16px;
  border: none;
  background: #3b82f6;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.confirm-btn-confirm:hover {
  background: #2563eb;
}

.color-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-input-row input[type="color"] {
  width: 40px;
  height: 30px;
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 4px;
  padding: 2px;
  cursor: pointer;
}

.color-hex-label {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-secondary, #666);
}

.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-row input[type="range"] {
  flex: 1;
}

.percent-input-row,
.degree-input-row,
.zoom-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.percent-input-row input,
.degree-input-row input,
.zoom-input-row input {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
  color: #374151;
  border: 1px solid #cfd8e3;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.percent-input-row input:focus,
.degree-input-row input:focus,
.zoom-input-row input:focus {
  outline: none;
  border-color: #9fb7d9;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.percent-label,
.degree-label {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
  min-width: 16px;
}

.add-character-props {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.add-prop-btn {
  flex: 1;
  padding: 8px 12px;
  border: 1px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.05);
  color: #3b82f6;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.add-prop-btn:hover {
  background: rgba(59, 130, 246, 0.1);
}

/* Delete action button */
.delete-action-section {
  padding: 16px 16px 8px;
  border-top: 1px solid #e5e7eb;
  margin-top: 8px;
}

.delete-action-btn {
  width: 100%;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.delete-action-btn:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

/* v6.4: set_anim animation control styles */
.anim-state-item {
  margin-bottom: 16px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.anim-state-controls {
  margin-top: 8px;
}

/* v11.3: Animation list styles */
.anim-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.anim-list-item {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  background: #f8f9fa;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.anim-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.anim-name {
  font-size: 12px;
  color: #374151;
  flex-shrink: 0;
}

.anim-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.anim-action-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.anim-action-btn:hover {
  border-color: #9ca3af;
  background: #f3f4f6;
}

.anim-action-btn.active {
  background: #3b82f6;
  border-color: #2563eb;
  color: white;
}

.anim-loop-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #6b7280;
  cursor: pointer;
}

.anim-loop-check input {
  margin: 0;
  cursor: pointer;
}

/* v11.52: Remove animation button */
.anim-remove-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #fecaca;
  border-radius: 4px;
  background: #fef2f2;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.anim-remove-btn:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

/* v11.52: Add animation control area */
.add-anim-section {
  margin-top: 12px;
  position: relative;
}

.add-anim-btn {
  width: 100%;
  padding: 8px 16px;
  font-size: 13px;
  color: #3b82f6;
  background: white;
  border: 1px dashed #93c5fd;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.add-anim-btn:hover {
  background: #eff6ff;
  border-color: #3b82f6;
}

.add-anim-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.add-anim-option {
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: #374151;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.add-anim-option:hover {
  background: #f3f4f6;
}

.add-anim-option:first-child {
  border-radius: 6px 6px 0 0;
}

.add-anim-option:last-child {
  border-radius: 0 0 6px 6px;
}

.anim-action-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.anim-action-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #6b7280;
  transition: all 0.2s;
}

.anim-action-option:hover {
  border-color: #9ca3af;
}

.anim-action-option.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.anim-action-option.text-reveal-start-option.active {
  background: #ecfdf5;
  border-color: #10b981;
  color: #047857;
}

.anim-action-option.text-reveal-complete-option.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
}

.anim-action-option input[type="radio"] {
  display: none;
}

.anim-extra-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.anim-loop-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
}

.anim-loop-checkbox input[type="checkbox"] {
  width: auto;
}

.anim-speed-input {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
}

.anim-speed-input input {
  width: 60px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

/* v12.x: controls row (buttons + loop select) */
.anim-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #e5e7eb;
}

.anim-option-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  white-space: nowrap;
}

.anim-option-checkbox input[type="checkbox"] {
  margin: 0;
  width: auto;
}

.anim-loop-select {
  padding: 8px 10px;
  font-size: 12px;
  border: 1px solid #cfd8e3;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  color: #374151;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(15, 23, 42, 0.04);
}

.anim-loop-select:focus {
  outline: none;
  border-color: #9fb7d9;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.anim-timing-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.anim-timing-label {
  color: #6b7280;
  font-size: 12px;
}

.anim-timing-select {
  min-width: 0;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  background: #fff;
  color: #4b5563;
  font-size: 12px;
  cursor: pointer;
}

.anim-timing-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.10);
}

/* Camera control panel styles */
.camera-console {
  margin-bottom: 16px;
}

.camera-mode-tabs {
  display: flex;
  gap: 4px;
  background: #f3f4f6;
  padding: 4px;
  border-radius: 8px;
}

.camera-mode-btn {
  flex: 1;
  padding: 8px 4px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: #6b7280;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.camera-mode-btn:hover {
  background: rgba(255, 255, 255, 0.7);
  color: #374151;
}

.camera-mode-btn.active {
  background: white;
  color: #059669;
  font-weight: 600;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.camera-mode-hint {
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #6b7280;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  border-left: 3px solid #22c55e;
}

.camera-action-type-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.type-icon {
  font-size: 20px;
}

.type-name {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.follow-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.follow-card {
  padding: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.follow-card-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.follow-card-caption {
  font-size: 12px;
  line-height: 1.5;
  color: #6b7280;
}

.follow-inline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.follow-inline-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.follow-inline-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.follow-inline-label {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
}

.follow-inline-field input[type="number"],
.follow-inline-field select,
.follow-sub-grid input[type="number"],
.follow-sub-grid select {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: #374151;
  border: 1px solid #cfd8e3;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.follow-inline-field input[type="number"]:focus,
.follow-inline-field select:focus,
.follow-sub-grid input[type="number"]:focus,
.follow-sub-grid select:focus {
  outline: none;
  border-color: #9fb7d9;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.follow-toggle-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.follow-toggle-main {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.follow-toggle-main input[type="checkbox"] {
  margin: 0;
}

.follow-toggle-desc {
  font-size: 12px;
  line-height: 1.6;
  color: #6b7280;
}

.follow-sub-grid {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #dbe3ee;
}

.follow-toggle-card-compact {
  gap: 6px;
}

/* camera_follow zoom input */
.zoom-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-input-row input {
  flex: 1;
  min-width: 0;
}

.zoom-input-row .value-label {
  font-size: 12px;
  color: #6b7280;
  min-width: 30px;
}

@media (max-width: 640px) {
  .follow-inline-grid {
    grid-template-columns: 1fr;
  }
}

.clear-zoom-btn {
  padding: 4px 8px;
  font-size: 14px;
  font-weight: bold;
  color: #9ca3af;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-zoom-btn:hover {
  color: #ef4444;
  background: #fef2f2;
  border-color: #fecaca;
}

/* v6.9: Use current value button */
.use-current-btn {
  padding: 4px 8px;
  font-size: 12px;
  color: #3b82f6;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.use-current-btn:hover {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #93c5fd;
}
.add-anim-section {
  margin-top: 12px;
}

.all-props-added-hint {
  padding: 12px;
  text-align: center;
  color: #10b981;
  font-size: 13px;
  background: #f0fdf4;
  border-radius: 6px;
  border: 1px solid #bbf7d0;
  margin-top: 8px;
}

/* v11.88: Auto stop at block end checkbox */
.auto-stop-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e5e7eb;
}

.auto-stop-section .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
}

.auto-stop-section .checkbox-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.auto-stop-section .checkbox-label span {
  user-select: none;
}

.auto-stop-section .checkbox-label:hover {
  color: #1f2937;
}

/* v11.88: Per-animation auto stop at block end checkbox */
.anim-auto-stop-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #6b7280;
  cursor: pointer;
  margin-top: 6px;
  user-select: none;
}

.anim-auto-stop-label input[type="checkbox"] {
  width: 12px;
  height: 12px;
}

.anim-auto-stop-label span {
  white-space: nowrap;
}

.anim-auto-stop-label:hover {
  color: #374151;
}

/* P2: Custom tree dropdown component */
.follow-target-dropdown {
  position: relative;
  outline: none;
}

.follow-target-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #cfd8e3;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  text-align: left;
  min-height: 42px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.follow-target-trigger:hover {
  border-color: #b7c6d9;
}

.follow-target-trigger:focus {
  outline: none;
  border-color: #9fb7d9;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.follow-target-placeholder {
  color: #9ca3af;
}

.follow-target-arrow {
  font-size: 8px;
  color: #6b7280;
  margin-left: 4px;
  flex-shrink: 0;
}

.follow-target-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  margin-top: 2px;
}

.follow-target-item {
  display: flex;
  align-items: center;
  padding: 5px 8px;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
  transition: background-color 0.1s;
}

.follow-target-item:hover {
  background: #f3f4f6;
}

.follow-target-item.selected {
  background: #eff6ff;
  color: #2563eb;
}

/* Child item: indent controlled by inline style paddingLeft */
.follow-target-item.child-item {
  font-size: 11px;
  color: #6b7280;
}

.follow-target-item.child-item:hover {
  color: #374151;
}

.follow-target-item.child-item.selected {
  color: #2563eb;
}

/* Child item prefix symbol └ */
.follow-target-child-prefix {
  color: #9ca3af;
  margin-right: 2px;
  font-size: 10px;
  flex-shrink: 0;
}

/* Expand/collapse button - placed at end of row without affecting root alignment */
.follow-target-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 8px;
  color: #6b7280;
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 2px;
  margin-left: auto;
}

.follow-target-toggle:hover {
  background: #e5e7eb;
  color: #374151;
}

.follow-target-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* P2: set_composite editable panel */
.composite-mode-tabs {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.composite-mode-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #f9fafb;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
}

.composite-mode-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.composite-mode-btn.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
  font-weight: 500;
}

/* === set_composite render chain order UI (aligned with entity composite property panel) === */
.sc-rc-list {
  margin-top: 6px;
}

.sc-rc-header {
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

.sc-rc-controls {
  display: flex;
  gap: 4px;
}

.sc-rc-move-btn {
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

.sc-rc-move-btn:hover:not(:disabled) {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.sc-rc-move-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.sc-rc-order-hint {
  text-align: center;
  font-size: 10px;
  color: #9ca3af;
  padding: 2px 0;
  letter-spacing: 1px;
}

.sc-rc-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
  border: 1px solid transparent;
}

.sc-rc-item:hover {
  background: #f3f4f6;
}

.sc-rc-item[draggable="true"] {
  cursor: grab;
}

.sc-rc-item[draggable="true"]:active {
  cursor: grabbing;
}

.sc-rc-selected {
  background: #eff6ff !important;
  border-color: #93c5fd;
}

.sc-rc-drag-over {
  border-color: #3b82f6;
  background: #dbeafe !important;
}

.sc-rc-drag-handle {
  font-size: 14px;
  color: #c4c9d0;
  cursor: grab;
  flex-shrink: 0;
  letter-spacing: -2px;
  user-select: none;
  transition: color 0.15s;
}

.sc-rc-item:hover .sc-rc-drag-handle {
  color: #9ca3af;
}

.sc-rc-drag-handle:active {
  cursor: grabbing;
}

.sc-rc-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.sc-rc-name {
  flex: 1;
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-rc-empty {
  padding: 8px;
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
  font-style: italic;
}

.sc-rc-zindex-divider {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin: 4px 0 2px;
}

.sc-rc-zindex-divider::before,
.sc-rc-zindex-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e5e7eb;
}

.sc-rc-zindex-label {
  font-size: 10px;
  color: #9ca3af;
  white-space: nowrap;
  font-family: monospace;
}

/* === Clip-Mask Phase 1 D3: set_mask UI === */
.mask-target-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mask-target-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
}

.mask-target-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.mask-target-name {
  flex: 1;
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mask-target-remove-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 3px;
}

.mask-target-remove-btn:hover {
  background: #fee2e2;
}

.mask-target-empty {
  padding: 6px 8px;
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
}

.mask-target-add-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.mask-target-add-select {
  flex: 1;
  padding: 4px 6px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
}

.mask-target-add-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.mask-target-add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mask-target-add-btn:not(:disabled):hover {
  background: #f3f4f6;
}
</style>

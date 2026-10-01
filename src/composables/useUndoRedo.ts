/**
 * Undo/Redo System
 * Implements undo/redo functionality using the Command pattern
 */

import { computed,ref } from 'vue'

export interface Command {
  execute(): void
  undo(): void
  description?: string
}

export function useUndoRedo(maxHistorySize = 50) {
  const undoStack = ref<Command[]>([])
  const redoStack = ref<Command[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  /**
   * Execute command
   */
  function executeCommand(command: Command) {
    command.execute()
    undoStack.value.push(command)
    
    // Limit history stack size
    if (undoStack.value.length > maxHistorySize) {
      undoStack.value.shift()
    }
    
    // Clear redo stack on executing new command
    redoStack.value = []
  }

  /**
   * Undo
   */
  function undo() {
    if (!canUndo.value) return
    
    const command = undoStack.value.pop()!
    command.undo()
    redoStack.value.push(command)
  }

  /**
   * Redo
   */
  function redo() {
    if (!canRedo.value) return
    
    const command = redoStack.value.pop()!
    command.execute()
    undoStack.value.push(command)
  }

  /**
   * Clear history
   */
  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  return {
    canUndo,
    canRedo,
    executeCommand,
    undo,
    redo,
    clear
  }
}

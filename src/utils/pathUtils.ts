/**
 * Path calculation utility functions
 * Used to calculate relative paths from File System Access API file handles
 */

/**
 * Calculate relative path of file by traversing directory handle
 * @param projectHandle Project root directory handle
 * @param fileHandle Target file handle
 * @returns Path relative to project root (using / as separator)
 */
export async function getRelativePath(
  projectHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle
): Promise<string> {
  // Use depth-first search starting from project root to find file
  async function findFile(
    dirHandle: FileSystemDirectoryHandle,
    targetName: string,
    targetKind: FileSystemHandleKind,
    currentPath: string[]
  ): Promise<boolean> {
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.name === targetName && entry.kind === targetKind) {
          // Check if same file/directory
          if (entry.kind === 'file') {
            const file1 = await (entry).getFile()
            const file2 = await (fileHandle.getFile())
            // Confirm same file by comparing name and size
            if (file1.name === file2.name && file1.size === file2.size) {
              return true
            }
          } else {
            // For directories, compare name only
            return true
          }
        }
        
        if (entry.kind === 'directory') {
          currentPath.push(entry.name)
          const found = await findFile(
            entry,
            targetName,
            targetKind,
            currentPath
          )
          if (found) {
            return true
          }
          currentPath.pop()
        }
      }
    } catch (error) {
      console.error('[PathUtils] Error traversing directory:', error)
    }
    return false
  }
  
  // Search from project root
  const searchPath: string[] = []
  const found = await findFile(
    projectHandle,
    fileHandle.name,
    'file',
    searchPath
  )
  
  if (found && searchPath.length > 0) {
    return searchPath.join('/') + '/' + fileHandle.name
  } else if (found) {
    return fileHandle.name
  }
  
  // If not found, try fallback: compare file handles by traversing directory tree
  return await getRelativePathByComparison(projectHandle, fileHandle)
}

/**
 * Get relative path by comparing file handles (fallback method)
 * Traverses entire directory tree
 */
async function getRelativePathByComparison(
  projectHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle
): Promise<string> {
  async function searchDirectory(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string[]
  ): Promise<string | null> {
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const fileEntry = entry
          // Attempt file handle comparison
          try {
            // If names match, verify by reading file
            if (fileEntry.name === fileHandle.name) {
              const file1 = await fileEntry.getFile()
              const file2 = await fileHandle.getFile()
              if (file1.size === file2.size && file1.name === file2.name) {
                // Probable match, construct path
                if (currentPath.length > 0) {
                  return currentPath.join('/') + '/' + fileHandle.name
                }
                return fileHandle.name
              }
            }
          } catch (error) {
            // Ignore error and continue searching
          }
        } else if (entry.kind === 'directory') {
          const newPath = [...currentPath, entry.name]
          const result = await searchDirectory(
            entry,
            newPath
          )
          if (result) {
            return result
          }
        }
      }
    } catch (error) {
      console.error('[PathUtils] Error searching directory:', error)
    }
    return null
  }
  
  const result = await searchDirectory(projectHandle, [])
  if (result) {
    return result
  }
  
  // Fallback if not found: return filename directly
  console.warn('[PathUtils] Could not find file in project directory, returning filename only')
  return fileHandle.name
}

/**
 * Normalize path (uses / as separator)
 * @param path Path string
 * @returns Normalized path
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Join path segments
 * @param parts Array of path segments
 * @returns Joined path
 */
export function joinPath(...parts: string[]): string {
  return parts
    .filter(p => p.length > 0)
    .map(p => normalizePath(p))
    .join('/')
    .replace(/\/+/g, '/') // Remove duplicate slashes
}

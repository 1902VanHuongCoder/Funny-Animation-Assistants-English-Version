/**
 * File System Access API Utility Functions
 * Used to manage asset files in the project directory structure
 */

/**
 * Ensure directory exists, create if not
 * @param parentHandle Parent directory handle
 * @param path Relative path (e.g. "assets/characters")
 * @returns Directory handle
 */
export async function ensureDirectory(
  parentHandle: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(p => p.length > 0)
  let currentHandle = parentHandle

  for (const part of parts) {
    currentHandle = await currentHandle.getDirectoryHandle(part, { create: true })
  }

  return currentHandle
}

/**
 * Safely get subdirectory handle
 * Chrome's File System Access API rejects certain directory names (such as names ending with .swf/.ini extensions).
 * This function first tries getDirectoryHandle, then falls back to traversing parent directory entries() to find matching directory.
 */
export async function getDirectoryHandleSafe(
  parentHandle: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  try {
    return await parentHandle.getDirectoryHandle(name)
  } catch (error) {
    // TypeError = "Name is not allowed" (browser security restriction)
    if (error instanceof TypeError) {
      // Fallback: traverse parent directory entries to find matching subdirectory
      for await (const [entryName, handle] of parentHandle.entries()) {
        if (handle.kind === 'directory' && entryName === name) {
          return handle
        }
      }
      throw new Error(`Directory does not exist (name restricted by browser): ${name}`)
    }
    throw error
  }
}

/**
 * Save asset file to disk (full version)
 * @param parentHandle Parent directory handle
 * @param relativePath Relative path (e.g. "assets/backgrounds/bg_123.png")
 * @param file File object to save
 * @returns Relative path
 */
export async function saveFileToDisk(
  parentHandle: FileSystemDirectoryHandle,
  relativePath: string,
  file: File
): Promise<string> {
  const parts = relativePath.split('/')
  const fileName = parts.pop()!
  const dirPath = parts.join('/')

  // Ensure directory exists
  const dirHandle = dirPath
    ? await ensureDirectory(parentHandle, dirPath)
    : parentHandle

  // Check if file already exists; delete if so
  try {
    await dirHandle.removeEntry(fileName, { recursive: false })
  } catch {
    // File does not exist, ignore error
  }

  // Create file and write (use keepExistingData: false for atomic write)
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable({ keepExistingData: false })
  await writable.write(file)
  await writable.close()


  return relativePath
}

/**
 * Load asset file from disk
 * @param parentHandle Parent directory handle
 * @param relativePath Relative path (e.g. "assets/backgrounds/bg_123.png")
 * @returns Blob URL (used for display in browser)
 */
export async function loadAssetFromDisk(
  parentHandle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<string> {
  try {
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    const dirPath = parts.join('/')

    // Get directory handle (with timeout protection)
    let dirHandle = parentHandle
    if (dirPath) {
      const dirParts = dirPath.split('/').filter(p => p.length > 0)

      for (const part of dirParts) {
        try {
          // Add 5 second timeout for each getDirectoryHandle
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Directory access timeout: ${part}`)), 5000)
          })

          dirHandle = await Promise.race([
            getDirectoryHandleSafe(dirHandle, part),
            timeoutPromise
          ])
        } catch (error: unknown) {
          const dirError = error as Error & { name?: string; message?: string }
          if (dirError.name === 'NotFoundError') {
            throw new Error(`Directory does not exist: ${part}`)
          } else if (dirError.name === 'SecurityError') {
            throw new Error(`No permission to access directory: ${part}`)
          } else if (dirError.message?.toLowerCase().includes('timeout')) {
            throw new Error(`Directory access timeout: ${part}, please check file system permissions`)
          } else {
            throw new Error(`Cannot access directory: ${part} - ${dirError.message}`)
          }
        }
      }
    }

    // Read file (with timeout protection)
    const fileTimeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`File read timeout: ${fileName}`)), 5000)
    })

    const fileHandle = await Promise.race([
      dirHandle.getFileHandle(fileName),
      fileTimeoutPromise
    ])

    const file = await fileHandle.getFile()

    // v12.8 Fix: Use arrayBuffer to read content and create independent Blob
    // Previously, directly using File object (URL.createObjectURL(file)) maintained reference to disk file
    // If disk file was modified (e.g., auto-saved or written by another process), that Blob URL invalidated immediately causing ERR_UPLOAD_FILE_CHANGED
    const buffer = await file.arrayBuffer()
    const blob = new Blob([buffer], { type: file.type })
    const blobUrl = URL.createObjectURL(blob)
    return blobUrl
  } catch (error) {
    console.error('[loadAssetFromDisk] Load failed:', relativePath, error)
    throw error
  }
}

/**
 * Check if file exists
 * @param parentHandle Parent directory handle
 * @param relativePath Relative path
 * @returns Whether file exists
 */
export async function fileExists(
  parentHandle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<boolean> {
  try {
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    const dirPath = parts.join('/')

    // Get directory handle
    let dirHandle = parentHandle
    if (dirPath) {
      const dirParts = dirPath.split('/').filter(p => p.length > 0)
      for (const part of dirParts) {
        try {
          dirHandle = await getDirectoryHandleSafe(dirHandle, part)
        } catch {
          return false // Directory does not exist
        }
      }
    }

    // Check if file exists
    try {
      await dirHandle.getFileHandle(fileName)
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

/**
 * Delete asset file from disk
 * @param parentHandle Parent directory handle
 * @param relativePath Relative path
 */
export async function deleteAssetFromDisk(
  parentHandle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<void> {
  try {
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    const dirPath = parts.join('/')

    // Get directory handle
    let dirHandle = parentHandle
    if (dirPath) {
      for (const part of dirPath.split('/').filter(p => p.length > 0)) {
        dirHandle = await getDirectoryHandleSafe(dirHandle, part)
      }
    }

    // Delete file
    await dirHandle.removeEntry(fileName, { recursive: false })

  } catch (error) {
    // File might not exist, ignore error

  }
}

/**
 * Read file content as text
 * @param parentHandle Parent directory handle
 * @param relativePath Relative path
 * @returns File content (text)
 */
export async function readFileAsText(
  parentHandle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<string> {
  const parts = relativePath.split('/')
  const fileName = parts.pop()!
  const dirPath = parts.join('/')

  let dirHandle = parentHandle
  if (dirPath) {
    for (const part of dirPath.split('/').filter(p => p.length > 0)) {
      dirHandle = await getDirectoryHandleSafe(dirHandle, part)
    }
  }

  const fileHandle = await dirHandle.getFileHandle(fileName)
  const file = await fileHandle.getFile()
  return await file.text()
}

/**
 * Write text to file
 * @param parentHandle Parent directory handle
 * @param relativePath Relative path
 * @param content File content (text)
 */
export async function writeFileAsText(
  parentHandle: FileSystemDirectoryHandle,
  relativePath: string,
  content: string
): Promise<void> {
  const parts = relativePath.split('/')
  const fileName = parts.pop()!
  const dirPath = parts.join('/')

  // Ensure directory exists
  const dirHandle = dirPath
    ? await ensureDirectory(parentHandle, dirPath)
    : parentHandle

  // Create or get file handle
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}


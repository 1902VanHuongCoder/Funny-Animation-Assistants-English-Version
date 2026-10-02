/**
 * Expression import utility
 * Used for batch scanning and importing expression assets from folders
 */

import type { ExpressionFrame } from '@/types/project'

/**
 * Import preview item
 */
export interface ImportPreviewItem {
    /** Expression type: static (single image) or animated (multiple images) */
    type: 'static' | 'animation'
    /** Expression name (from filename or directory name) */
    name: string
    /** Image count */
    imageCount: number
    /** File handle for static expression */
    fileHandle?: FileSystemFileHandle
    /** Directory handle for animated expression */
    dirHandle?: FileSystemDirectoryHandle
    /** File relative path (for static expression) */
    filePath?: string
    /** Directory relative path (for animated expression) */
    dirPath?: string
}

/**
 * Import result item
 */
export interface ImportResultItem {
    name: string
    defaultFrame: ExpressionFrame
    speakingFrames: ExpressionFrame[]
}

/**
 * Supported image extensions
 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

/**
 * Check whether filename has supported image extension
 */
export function isImageFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * Extract expression name from filename (removes extension)
 */
export function extractNameFromFile(filename: string): string {
    const lastDot = filename.lastIndexOf('.')
    return lastDot > 0 ? filename.substring(0, lastDot) : filename
}

/**
 * Natural comparison function
 */
function naturalCompare(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Scan directory to generate import preview list
 * @param dirHandle Directory handle to scan
 * @param basePath Relative path prefix of directory
 */
export async function scanDirectoryForExpressions(
    dirHandle: FileSystemDirectoryHandle,
    basePath: string
): Promise<ImportPreviewItem[]> {
    const items: ImportPreviewItem[] = []
    const fileEntries: { name: string; handle: FileSystemFileHandle }[] = []
    const dirEntries: { name: string; handle: FileSystemDirectoryHandle }[] = []

    // Collect all entries, separating files and directories
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            fileEntries.push({ name: entry.name, handle: entry })
        } else {
            dirEntries.push({ name: entry.name, handle: entry })
        }
    }

    // Sort naturally by name
    fileEntries.sort((a, b) => naturalCompare(a.name, b.name))
    dirEntries.sort((a, b) => naturalCompare(a.name, b.name))

    // Process files -> static expressions
    for (const entry of fileEntries) {
        if (isImageFile(entry.name)) {
            const filePath = basePath ? `${basePath}/${entry.name}` : entry.name
            items.push({
                type: 'static',
                name: extractNameFromFile(entry.name),
                imageCount: 1,
                fileHandle: entry.handle,
                filePath
            })
        }
    }

    // Process directories -> animated expressions
    for (const entry of dirEntries) {
        const imageCount = await countImagesInDirectory(entry.handle)
        if (imageCount > 0) {
            const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name
            items.push({
                type: 'animation',
                name: entry.name,
                imageCount,
                dirHandle: entry.handle,
                dirPath
            })
        }
    }

    return items
}

/**
 * Count image files in directory
 */
async function countImagesInDirectory(dirHandle: FileSystemDirectoryHandle): Promise<number> {
    let count = 0
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && isImageFile(entry.name)) {
            count++
        }
    }
    return count
}

/**
 * Process single import item, generating ExpressionFrame data
 * @param item Import preview item
 */
export async function processImportItem(item: ImportPreviewItem): Promise<ImportResultItem> {
    if (item.type === 'static' && item.fileHandle && item.filePath) {
        // Static expression: single image
        const frame: ExpressionFrame = {
            id: generateFrameId(),
            url: item.filePath
        }
        return {
            name: item.name,
            defaultFrame: frame,
            speakingFrames: []
        }
    } else if (item.type === 'animation' && item.dirHandle && item.dirPath) {
        // Animated expression: all images in folder
        const frames = await loadFramesFromDirectory(item.dirHandle, item.dirPath)
        if (frames.length === 0) {
            throw new Error(`Directory "${item.name}" does not contain any valid image files`)
        }
        // frames.length > 0 guaranteed, safe assertion
        const firstFrame = frames[0]!
        return {
            name: item.name,
            defaultFrame: { id: firstFrame.id, url: firstFrame.url },
            speakingFrames: frames
        }
    } else {
        throw new Error(`Invalid import item: ${item.name}`)
    }
}

/**
 * Load all image frames from directory
 */
async function loadFramesFromDirectory(
    dirHandle: FileSystemDirectoryHandle,
    dirPath: string
): Promise<ExpressionFrame[]> {
    const imageFiles: { name: string; handle: FileSystemFileHandle }[] = []

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && isImageFile(entry.name)) {
            imageFiles.push({ name: entry.name, handle: entry })
        }
    }

    // Sort naturally by filename
    imageFiles.sort((a, b) => naturalCompare(a.name, b.name))

    // Generate ExpressionFrame list
    return imageFiles.map((file, index) => ({
        id: generateFrameId(index),
        url: `${dirPath}/${file.name}`
    }))
}

/**
 * Generate frame ID
 */
function generateFrameId(index?: number): string {
    const base = `frame_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    return index !== undefined ? `${base}_${index}` : base
}

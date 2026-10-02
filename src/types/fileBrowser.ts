export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
  size?: number
  isParentDir?: boolean
  children?: FileNode[]
}

export interface SelectedFile {
  handle: FileSystemFileHandle
  path: string
  name: string
}

/**
 * Directory selection result (used for FileBrowserDialog directory selection mode)
 */
export interface SelectedDirectory {
  handle: FileSystemDirectoryHandle
  path: string
  name: string
}

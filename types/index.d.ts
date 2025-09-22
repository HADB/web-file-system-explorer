export interface FileItem {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  size?: number
  lastModified?: Date
  type?: string
}

export interface StoredDirectory {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  lastAccessed: Date
}

<script setup lang="ts">
import type { FileItem, StoredDirectory } from '~~/types'

useHead({
  title: '文件浏览器',
  meta: [
    {
      name: 'description',
      content: '使用 File System Access API 访问本地目录，浏览文件并提供预览功能',
    },
  ],
})

// 应用状态
const currentView = ref<'home' | 'directory'>('home') // 当前视图：首页或目录浏览
const directoryHandle = ref<FileSystemDirectoryHandle | null>(null)
const currentPath = ref<string>('')
const fileList = ref<FileItem[]>([])
const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref<{ [key: string]: number }>({})
const toast = useToast()

// 多目录管理
const storedDirectories = ref<StoredDirectory[]>([])
const currentDirectoryId = ref<string | null>(null)

// 使用 useOverlay 创建模态框
const overlay = useOverlay()

// 拖拽上传相关状态
const isDragOver = ref(false)
const uploadQueue = ref<File[]>([])
const currentDirectory = ref<FileSystemDirectoryHandle | null>(null)

// 保存目录到 IndexedDB
async function saveDirectory(handle: FileSystemDirectoryHandle) {
  try {
    if (!('indexedDB' in window)) {
      return
    }

    const id = crypto.randomUUID()
    const directory: StoredDirectory = {
      id,
      name: handle.name,
      handle,
      lastAccessed: new Date(),
    }

    return new Promise((resolve, reject) => {
      // 使用版本 3 来支持两个独立的对象存储
      const request = indexedDB.open('FileSystemDB', 3)

      request.onupgradeneeded = (event) => {
        const db = request.result
        const oldVersion = event.oldVersion

        console.log(`Upgrading database from version ${oldVersion} to 3`)

        // 如果存在旧的 handles 表，删除它
        if (db.objectStoreNames.contains('handles')) {
          console.log('Deleting old handles object store')
          db.deleteObjectStore('handles')
        }

        // 如果存在旧的 directories 表，删除它
        if (db.objectStoreNames.contains('directories')) {
          console.log('Deleting old directories object store')
          db.deleteObjectStore('directories')
        }

        // 创建新的对象存储
        if (!db.objectStoreNames.contains('directoryInfo')) {
          console.log('Creating directoryInfo object store')
          db.createObjectStore('directoryInfo', { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains('directoryHandles')) {
          console.log('Creating directoryHandles object store')
          db.createObjectStore('directoryHandles', { keyPath: 'id' })
        }
      }

      request.onsuccess = () => {
        const db = request.result
        console.log('Database opened successfully, version:', db.version)
        console.log('Available object stores:', Array.from(db.objectStoreNames))

        // 创建一个简单的延迟函数
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        const executeTransaction = async () => {
          // 稍微延迟以确保数据库完全就绪
          await delay(100)

          try {
            const transaction = db.transaction(['directoryInfo', 'directoryHandles'], 'readwrite')
            const infoStore = transaction.objectStore('directoryInfo')
            const handleStore = transaction.objectStore('directoryHandles')

            // 分别存储可序列化的信息和 handle
            const serializableInfo = {
              id: directory.id,
              name: directory.name,
              lastAccessed: directory.lastAccessed,
            }

            const handleObject = {
              id: directory.id,
              handle,
            }

            const infoRequest = infoStore.put(serializableInfo)
            const handleRequest = handleStore.put(handleObject)

            let infoSuccess = false
            let handleSuccess = false

            infoRequest.onsuccess = async () => {
              console.log('Directory info saved successfully:', directory.name)
              infoSuccess = true
              if (handleSuccess) {
                db.close()

                // 更新本地状态 - 使用 isSameEntry 方法进行精确比较
                let existingIndex = -1
                for (let i = 0; i < storedDirectories.value.length; i++) {
                  try {
                    const existingDir = storedDirectories.value[i]
                    if (directory.handle && existingDir?.handle
                      && await directory.handle.isSameEntry(existingDir.handle)) {
                      existingIndex = i
                      break
                    }
                  }
                  catch (error) {
                    // 如果比较失败，继续检查下一个
                    console.warn('无法比较目录句柄:', error)
                  }
                }

                if (existingIndex >= 0) {
                  storedDirectories.value[existingIndex] = directory
                }
                else {
                  storedDirectories.value.push(directory)
                }

                resolve(id)
              }
            }

            handleRequest.onsuccess = async () => {
              console.log('Directory handle saved successfully:', directory.name)
              handleSuccess = true
              if (infoSuccess) {
                db.close()

                // 更新本地状态 - 使用 isSameEntry 方法进行精确比较
                let existingIndex = -1
                for (let i = 0; i < storedDirectories.value.length; i++) {
                  try {
                    const existingDir = storedDirectories.value[i]
                    if (directory.handle && existingDir?.handle
                      && await directory.handle.isSameEntry(existingDir.handle)) {
                      existingIndex = i
                      break
                    }
                  }
                  catch (error) {
                    // 如果比较失败，继续检查下一个
                    console.warn('无法比较目录句柄:', error)
                  }
                }

                if (existingIndex >= 0) {
                  storedDirectories.value[existingIndex] = directory
                }
                else {
                  storedDirectories.value.push(directory)
                }

                resolve(id)
              }
            }

            infoRequest.onerror = () => {
              console.error('Failed to save directory info:', infoRequest.error)
              db.close()
              reject(infoRequest.error)
            }

            handleRequest.onerror = () => {
              console.error('Failed to save directory handle:', handleRequest.error)
              db.close()
              reject(handleRequest.error)
            }

            transaction.onerror = () => {
              console.error('Transaction error:', transaction.error)
              db.close()
              reject(transaction.error)
            }
          }
          catch (error) {
            console.error('Error executing transaction:', error)
            db.close()
            reject(error)
          }
        }

        executeTransaction()
      }

      request.onerror = () => {
        console.error('Database open error:', request.error)
        reject(request.error)
      }
    })
  }
  catch (error) {
    console.warn('无法保存目录:', error)
    return null
  }
}

// 从 IndexedDB 加载所有目录
async function loadAllDirectories(): Promise<StoredDirectory[]> {
  try {
    if (!('indexedDB' in window)) {
      return []
    }

    return new Promise((resolve) => {
      // 使用版本 3 来确保数据库结构正确
      const request = indexedDB.open('FileSystemDB', 3)

      request.onupgradeneeded = (event) => {
        const db = request.result
        const oldVersion = event.oldVersion

        console.log(`Upgrading database from version ${oldVersion} to 3`)

        // 如果存在旧的 handles 表，删除它
        if (db.objectStoreNames.contains('handles')) {
          console.log('Deleting old handles object store')
          db.deleteObjectStore('handles')
        }

        // 如果存在旧的 directories 表，删除它
        if (db.objectStoreNames.contains('directories')) {
          console.log('Deleting old directories object store')
          db.deleteObjectStore('directories')
        }

        // 创建新的对象存储
        if (!db.objectStoreNames.contains('directoryInfo')) {
          console.log('Creating directoryInfo object store')
          db.createObjectStore('directoryInfo', { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains('directoryHandles')) {
          console.log('Creating directoryHandles object store')
          db.createObjectStore('directoryHandles', { keyPath: 'id' })
        }
      }

      request.onsuccess = () => {
        const db = request.result
        console.log('Database opened successfully for loading, version:', db.version)
        console.log('Available object stores:', Array.from(db.objectStoreNames))

        // 创建一个简单的延迟函数
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        const executeTransaction = async () => {
          // 稍微延迟以确保数据库完全就绪
          await delay(100)

          try {
            const transaction = db.transaction(['directoryInfo', 'directoryHandles'], 'readonly')
            const infoStore = transaction.objectStore('directoryInfo')
            const handleStore = transaction.objectStore('directoryHandles')

            const infoRequest = infoStore.getAll()
            const handleRequest = handleStore.getAll()

            let infoResults: any[] = []
            let handleResults: any[] = []
            let infoComplete = false
            let handleComplete = false

            const combineResults = () => {
              try {
                const directories: StoredDirectory[] = []

                for (const info of infoResults) {
                  const handleData = handleResults.find((h) => h.id === info.id)
                  if (handleData && handleData.handle) {
                    directories.push({
                      id: info.id,
                      name: info.name,
                      lastAccessed: new Date(info.lastAccessed),
                      handle: handleData.handle,
                    })
                  }
                }

                console.log('Loaded directories:', directories)
                db.close()
                resolve(directories)
              }
              catch (error) {
                console.error('Error combining results:', error)
                db.close()
                resolve([])
              }
            }

            infoRequest.onsuccess = () => {
              infoResults = infoRequest.result || []
              infoComplete = true
              if (handleComplete) {
                combineResults()
              }
            }

            handleRequest.onsuccess = () => {
              handleResults = handleRequest.result || []
              handleComplete = true
              if (infoComplete) {
                combineResults()
              }
            }

            infoRequest.onerror = () => {
              console.error('Failed to load directory info:', infoRequest.error)
              db.close()
              resolve([])
            }

            handleRequest.onerror = () => {
              console.error('Failed to load directory handles:', handleRequest.error)
              db.close()
              resolve([])
            }

            transaction.onerror = () => {
              console.error('Transaction error:', transaction.error)
              db.close()
              resolve([])
            }
          }
          catch (error) {
            console.error('Error executing transaction:', error)
            db.close()
            resolve([])
          }
        }

        executeTransaction()
      }

      request.onerror = () => {
        console.error('Database open error:', request.error)
        resolve([])
      }
    })
  }
  catch (error) {
    console.warn('无法加载目录列表:', error)
    return []
  }
}

// 删除目录
async function removeDirectory(id: string) {
  try {
    if (!('indexedDB' in window)) {
      return
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('FileSystemDB', 3)

      request.onupgradeneeded = (event) => {
        const db = request.result
        const oldVersion = event.oldVersion

        console.log(`Upgrading database from version ${oldVersion} to 3`)

        // 如果存在旧的 handles 表，删除它
        if (db.objectStoreNames.contains('handles')) {
          console.log('Deleting old handles object store')
          db.deleteObjectStore('handles')
        }

        // 如果存在旧的 directories 表，删除它
        if (db.objectStoreNames.contains('directories')) {
          console.log('Deleting old directories object store')
          db.deleteObjectStore('directories')
        }

        // 创建新的对象存储
        if (!db.objectStoreNames.contains('directoryInfo')) {
          console.log('Creating directoryInfo object store')
          db.createObjectStore('directoryInfo', { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains('directoryHandles')) {
          console.log('Creating directoryHandles object store')
          db.createObjectStore('directoryHandles', { keyPath: 'id' })
        }
      }

      request.onsuccess = () => {
        const db = request.result

        // 创建一个简单的延迟函数
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        const executeTransaction = async () => {
          // 稍微延迟以确保数据库完全就绪
          await delay(100)

          try {
            const transaction = db.transaction(['directoryInfo', 'directoryHandles'], 'readwrite')
            const infoStore = transaction.objectStore('directoryInfo')
            const handleStore = transaction.objectStore('directoryHandles')

            const infoDeleteRequest = infoStore.delete(id)
            const handleDeleteRequest = handleStore.delete(id)

            let infoDeleted = false
            let handleDeleted = false

            infoDeleteRequest.onsuccess = () => {
              console.log('Directory info deleted successfully')
              infoDeleted = true
              if (handleDeleted) {
                db.close()

                // 更新本地状态
                storedDirectories.value = storedDirectories.value.filter((d) => d.id !== id)

                resolve(true)
              }
            }

            handleDeleteRequest.onsuccess = () => {
              console.log('Directory handle deleted successfully')
              handleDeleted = true
              if (infoDeleted) {
                db.close()

                // 更新本地状态
                storedDirectories.value = storedDirectories.value.filter((d) => d.id !== id)

                resolve(true)
              }
            }

            infoDeleteRequest.onerror = () => {
              db.close()
              reject(infoDeleteRequest.error)
            }

            handleDeleteRequest.onerror = () => {
              db.close()
              reject(handleDeleteRequest.error)
            }

            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
          }
          catch (error) {
            db.close()
            reject(error)
          }
        }

        executeTransaction()
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }
  catch (error) {
    console.warn('无法删除目录:', error)
  }
}

// 更新目录最后访问时间
async function updateDirectoryAccess(id: string) {
  try {
    if (!('indexedDB' in window)) {
      return
    }

    const directory = storedDirectories.value.find((d) => d.id === id)
    if (!directory) {
      return
    }

    directory.lastAccessed = new Date()

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('FileSystemDB', 3)

      request.onupgradeneeded = (event) => {
        const db = request.result
        const oldVersion = event.oldVersion

        console.log(`Upgrading database from version ${oldVersion} to 3`)

        // 如果存在旧的 handles 表，删除它
        if (db.objectStoreNames.contains('handles')) {
          console.log('Deleting old handles object store')
          db.deleteObjectStore('handles')
        }

        // 如果存在旧的 directories 表，删除它
        if (db.objectStoreNames.contains('directories')) {
          console.log('Deleting old directories object store')
          db.deleteObjectStore('directories')
        }

        // 创建新的对象存储
        if (!db.objectStoreNames.contains('directoryInfo')) {
          console.log('Creating directoryInfo object store')
          db.createObjectStore('directoryInfo', { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains('directoryHandles')) {
          console.log('Creating directoryHandles object store')
          db.createObjectStore('directoryHandles', { keyPath: 'id' })
        }
      }

      request.onsuccess = () => {
        const db = request.result

        // 创建一个简单的延迟函数
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        const executeTransaction = async () => {
          // 稍微延迟以确保数据库完全就绪
          await delay(100)

          try {
            const transaction = db.transaction(['directoryInfo'], 'readwrite')
            const infoStore = transaction.objectStore('directoryInfo')

            // 只更新可序列化的信息，不需要更新 handle
            const serializableInfo = {
              id: directory.id,
              name: directory.name,
              lastAccessed: directory.lastAccessed,
            }

            const putRequest = infoStore.put(serializableInfo)

            putRequest.onsuccess = () => {
              console.log('Directory access time updated successfully:', directory.name)
              db.close()
              resolve(true)
            }

            putRequest.onerror = () => {
              console.error('Failed to update directory access time:', putRequest.error)
              db.close()
              reject(putRequest.error)
            }

            transaction.onerror = () => {
              console.error('Transaction error:', transaction.error)
              db.close()
              reject(transaction.error)
            }
          }
          catch (error) {
            console.error('Error executing transaction:', error)
            db.close()
            reject(error)
          }
        }

        executeTransaction()
      }

      request.onerror = () => {
        console.error('Database open error:', request.error)
        reject(request.error)
      }
    })
  }
  catch (error) {
    console.warn('无法更新目录访问时间:', error)
  }
}

// 验证目录句柄是否仍然有效
async function verifyDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // 尝试获取权限
    const permission = await (handle as any).queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') {
      return true
    }

    // 如果权限是 'prompt'，尝试请求权限
    if (permission === 'prompt') {
      const requestPermission = await (handle as any).requestPermission({ mode: 'readwrite' })
      return requestPermission === 'granted'
    }

    return false
  }
  catch (error) {
    console.warn('验证目录句柄失败:', error)
    return false
  }
}

// 进入指定目录（用户交互触发）
async function enterDirectory(directoryData: StoredDirectory) {
  loading.value = true
  try {
    const isValid = await verifyDirectoryHandle(directoryData.handle)
    if (isValid) {
      directoryHandle.value = directoryData.handle
      currentDirectory.value = directoryData.handle
      currentPath.value = directoryData.handle.name
      currentDirectoryId.value = directoryData.id
      currentView.value = 'directory'

      await loadDirectoryContents(directoryData.handle)
      await updateDirectoryAccess(directoryData.id)
    }
    else {
      // 权限失效，从列表中移除
      await removeDirectory(directoryData.id)

      toast.add({
        title: '目录权限已失效',
        description: '目录权限已失效，已从列表中移除',
        color: 'warning',
      })
    }
  }
  catch (error) {
    console.error('进入目录失败:', error)
    toast.add({
      title: '进入目录失败',
      description: '无法访问该目录，请重新授权',
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}

// 返回首页
function goHome() {
  currentView.value = 'home'
  directoryHandle.value = null
  currentDirectory.value = null
  currentPath.value = ''
  currentDirectoryId.value = null
  fileList.value = []
}// 验证目录句柄是否有写入权限
async function verifyWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // 尝试获取写入权限
    const permission = await (handle as any).queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') {
      return true
    }

    // 如果权限是 'prompt'，尝试请求写入权限
    if (permission === 'prompt') {
      const requestPermission = await (handle as any).requestPermission({ mode: 'readwrite' })
      return requestPermission === 'granted'
    }

    return false
  }
  catch (error) {
    console.warn('验证写入权限失败:', error)
    return false
  }
}

// 检查浏览器是否支持 File System Access API
const isSupported = computed(() => {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
})

// 声明全局接口扩展
declare global {
  interface Window {
    showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>
  }
}

// 选择并添加新目录
async function addNewDirectory() {
  if (!isSupported.value) {
    toast.add({
      title: '浏览器不支持',
      description: '当前浏览器不支持 File System Access API',
      color: 'error',
    })
    return
  }

  try {
    loading.value = true
    const handle = await window.showDirectoryPicker()

    // 检查是否已经添加过这个目录 - 使用 isSameEntry 方法进行精确比较
    let exists = false
    for (const existingDir of storedDirectories.value) {
      try {
        if (await handle.isSameEntry(existingDir.handle)) {
          exists = true
          break
        }
      }
      catch (error) {
        // 如果比较失败（可能是权限问题），继续检查下一个
        console.warn('无法比较目录句柄:', error)
      }
    }

    if (exists) {
      toast.add({
        title: '目录已存在',
        description: `目录 "${handle.name}" 已经在列表中`,
        color: 'warning',
      })
      return
    }

    // 保存目录
    await saveDirectory(handle)

    toast.add({
      title: '目录添加成功',
      description: `已添加目录: ${handle.name}`,
      color: 'success',
    })
  }
  catch (error: any) {
    if (error.name !== 'AbortError') {
      toast.add({
        title: '添加目录失败',
        description: error.message,
        color: 'error',
      })
    }
  }
  finally {
    loading.value = false
  }
}

// 加载目录内容
async function loadDirectoryContents(handle: FileSystemDirectoryHandle) {
  try {
    loading.value = true
    currentDirectory.value = handle
    const items: FileItem[] = []

    for await (const [name, itemHandle] of (handle as any).entries()) {
      const item: FileItem = {
        name,
        kind: itemHandle.kind,
        handle: itemHandle,
      }

      if (itemHandle.kind === 'file') {
        const file = await (itemHandle as FileSystemFileHandle).getFile()
        item.size = file.size
        item.lastModified = new Date(file.lastModified)
        item.type = file.type || getFileTypeByExtension(name)
      }

      items.push(item)
    }

    // 排序：目录在前，文件在后，然后按名称排序
    fileList.value = items.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }
  catch (error: any) {
    toast.add({
      title: '加载目录内容失败',
      description: error.message,
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}

// 根据文件扩展名获取 MIME 类型
function getFileTypeByExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    js: 'application/javascript',
    ts: 'application/typescript',
    json: 'application/json',
    html: 'text/html',
    css: 'text/css',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / (k ** i)).toFixed(2))} ${sizes[i]}`
}

// 获取文件图标
function getFileIcon(item: FileItem): string {
  if (item.kind === 'directory') {
    return '📁'
  }

  const ext = item.name.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    txt: '📄',
    md: '📝',
    js: '📜',
    ts: '📜',
    json: '📋',
    html: '🌐',
    css: '🎨',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    svg: '🖼️',
    pdf: '📕',
    mp4: '🎬',
    mp3: '🎵',
    zip: '📦',
    rar: '📦',
  }
  return iconMap[ext || ''] || '📄'
}

// 进入子目录
async function enterSubDirectory(item: FileItem) {
  if (item.kind === 'directory') {
    currentPath.value += `/${item.name}`
    currentDirectory.value = item.handle as FileSystemDirectoryHandle
    await loadDirectoryContents(item.handle as FileSystemDirectoryHandle)
  }
}

// 文件上传功能
async function handleFileUpload(files: FileList | File[]) {
  const targetDirectory = currentDirectory.value || directoryHandle.value
  if (!targetDirectory) {
    toast.add({
      title: '上传失败',
      description: '请先选择一个目录',
      color: 'error',
    })
    return
  }

  // 验证写入权限
  const hasWritePermission = await verifyWritePermission(targetDirectory)
  if (!hasWritePermission) {
    toast.add({
      title: '权限不足',
      description: '当前目录没有写入权限，请重新选择目录',
      color: 'error',
    })
    return
  }

  uploading.value = true
  const fileArray = Array.from(files)
  uploadQueue.value = fileArray

  try {
    for (const file of fileArray) {
      uploadProgress.value[file.name] = 0

      // 检查文件是否已存在
      const existingFile = fileList.value.find((item) => item.name === file.name && item.kind === 'file')
      if (existingFile) {
        // 简单跳过重复文件，或者可以实现更复杂的重命名逻辑
        toast.add({
          title: '文件已存在',
          description: `文件 "${file.name}" 已存在，已跳过上传`,
          color: 'warning',
        })
        uploadProgress.value[file.name] = -1 // 标记为跳过
        continue
      }

      try {
        // 创建新文件
        const fileHandle = await (targetDirectory as any).getFileHandle(file.name, { create: true })
        const writable = await (fileHandle as any).createWritable()

        // 分块上传以显示进度
        const chunkSize = 1024 * 1024 // 1MB chunks
        const totalChunks = Math.ceil(file.size / chunkSize)

        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize
          const end = Math.min(start + chunkSize, file.size)
          const chunk = file.slice(start, end)

          await writable.write(chunk)
          uploadProgress.value[file.name] = Math.round(((i + 1) / totalChunks) * 100)
        }

        await writable.close()
        uploadProgress.value[file.name] = 100

        toast.add({
          title: '上传成功',
          description: `文件 "${file.name}" 上传完成`,
          color: 'success',
        })
      }
      catch (error: any) {
        uploadProgress.value[file.name] = -1
        toast.add({
          title: '上传失败',
          description: `文件 "${file.name}" 上传失败: ${error.message}`,
          color: 'error',
        })
      }
    }

    // 刷新文件列表
    await loadDirectoryContents(targetDirectory)
  }
  finally {
    uploading.value = false
    uploadQueue.value = []
    uploadProgress.value = {}
  }
}

// 文件选择上传
async function selectFilesToUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = (e) => {
    const files = (e.target as HTMLInputElement).files
    if (files && files.length > 0) {
      handleFileUpload(files)
    }
  }
  input.click()
}

// 拖拽上传处理
function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false

  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    handleFileUpload(files)
  }
}

// 删除文件或文件夹
async function deleteItem(item: FileItem) {
  const targetDirectory = currentDirectory.value || directoryHandle.value
  if (!targetDirectory) {
    toast.add({
      title: '删除失败',
      description: '无法确定当前目录',
      color: 'error',
    })
    return
  }

  // 验证写入权限
  const hasWritePermission = await verifyWritePermission(targetDirectory)
  if (!hasWritePermission) {
    toast.add({
      title: '权限不足',
      description: '当前目录没有写入权限，无法删除文件',
      color: 'error',
    })
    return
  }

  try {
    // 动态导入删除确认组件并使用 overlay 打开模态框
    const { default: DeleteConfirmModal } = await import('~/components/DeleteConfirmModal.vue')
    const modal = overlay.create(DeleteConfirmModal)

    const instance = modal.open({
      item,
    })

    // 等待用户确认
    const shouldDelete = await instance.result
    if (!shouldDelete) {
      return
    }

    // 执行删除操作
    await (targetDirectory as any).removeEntry(item.name, { recursive: item.kind === 'directory' })

    toast.add({
      title: '删除成功',
      description: `${item.kind === 'directory' ? '文件夹' : '文件'} "${item.name}" 已删除`,
      color: 'success',
    })

    // 刷新文件列表
    await loadDirectoryContents(targetDirectory)
  }
  catch (error: any) {
    toast.add({
      title: '删除失败',
      description: `删除 "${item.name}" 失败: ${error.message}`,
      color: 'error',
    })
  }
}

// 创建新文件夹
async function createNewFolder() {
  const targetDirectory = currentDirectory.value || directoryHandle.value
  if (!targetDirectory) {
    toast.add({
      title: '创建失败',
      description: '请先选择一个目录',
      color: 'error',
    })
    return
  }

  // 验证写入权限
  const hasWritePermission = await verifyWritePermission(targetDirectory)
  if (!hasWritePermission) {
    toast.add({
      title: '权限不足',
      description: '当前目录没有写入权限，无法创建文件夹',
      color: 'error',
    })
    return
  }

  try {
    // 获取现有文件夹列表
    const existingFolders = fileList.value
      .filter((item) => item.kind === 'directory')
      .map((item) => item.name)

    // 动态导入创建文件夹组件并使用 overlay 打开模态框
    const { default: CreateFolderModal } = await import('~/components/CreateFolderModal.vue')
    const modal = overlay.create(CreateFolderModal)

    const instance = modal.open({
      existingFolders,
    })

    // 等待用户输入
    const folderName = await instance.result
    if (!folderName) {
      return
    }

    // 创建新文件夹
    await (targetDirectory as any).getDirectoryHandle(folderName, { create: true })

    toast.add({
      title: '创建成功',
      description: `文件夹 "${folderName}" 创建成功`,
      color: 'success',
    })

    // 刷新文件列表
    await loadDirectoryContents(targetDirectory)
  }
  catch (error: any) {
    toast.add({
      title: '创建失败',
      description: `创建文件夹失败: ${error.message}`,
      color: 'error',
    })
  }
}

// 预览文件
async function previewFileContent(item: FileItem) {
  if (item.kind === 'directory') {
    return
  }

  try {
    const fileHandle = item.handle as FileSystemFileHandle
    const file = await fileHandle.getFile()

    let previewType = 'unknown'
    let previewContent = ''

    // 判断预览类型
    if (file.type.indexOf('text/') === 0 || isTextFile(item.name)) {
      previewType = 'text'
      previewContent = await file.text()
    }
    else if (file.type.indexOf('image/') === 0) {
      previewType = 'image'
      previewContent = URL.createObjectURL(file)
    }
    else if (file.type.indexOf('video/') === 0) {
      previewType = 'video'
      previewContent = URL.createObjectURL(file)
    }
    else if (file.type.indexOf('audio/') === 0) {
      previewType = 'audio'
      previewContent = URL.createObjectURL(file)
    }
    else if (file.type === 'application/pdf') {
      previewType = 'pdf'
      previewContent = URL.createObjectURL(file)
    }
    else {
      previewType = 'unknown'
      previewContent = ''
    }

    // 动态导入组件并使用 overlay 打开模态框
    const { default: FilePreviewModal } = await import('~/components/FilePreviewModal.vue')
    const modal = overlay.create(FilePreviewModal)

    const instance = modal.open({
      file: item,
      content: previewContent,
      type: previewType,
    })

    // 等待模态框关闭，然后清理资源
    await instance.result
    if (previewContent.indexOf('blob:') === 0) {
      URL.revokeObjectURL(previewContent)
    }
  }
  catch (error: any) {
    toast.add({
      title: '预览文件失败',
      description: error.message,
      color: 'error',
    })
  }
}

// 判断是否为文本文件
function isTextFile(filename: string): boolean {
  const textExtensions = ['txt', 'md', 'js', 'ts', 'json', 'html', 'css', 'vue', 'py', 'java', 'cpp', 'c', 'h', 'xml', 'yml', 'yaml']
  const ext = filename.split('.').pop()?.toLowerCase()
  return textExtensions.includes(ext || '')
}

// 下载文件
async function downloadFile(item: FileItem) {
  if (item.kind === 'directory') {
    return
  }

  try {
    const fileHandle = item.handle as FileSystemFileHandle
    const file = await fileHandle.getFile()
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = item.name
    a.click()
    URL.revokeObjectURL(url)
    toast.add({
      title: '文件下载已开始',
      color: 'success',
    })
  }
  catch (error: any) {
    toast.add({
      title: '下载文件失败',
      description: error.message,
      color: 'error',
    })
  }
}

// 返回上级目录
async function goBack() {
  if (!directoryHandle.value) {
    return
  }

  const pathParts = currentPath.value.split('/')
  if (pathParts.length <= 1) {
    return
  }

  // 简单实现：重新选择根目录
  // 实际应用中需要维护目录堆栈
  pathParts.pop()
  currentPath.value = pathParts.join('/')

  if (pathParts.length === 1) {
    currentDirectory.value = directoryHandle.value
    await loadDirectoryContents(directoryHandle.value)
  }
}

// 页面挂载时加载已授权的目录列表
onMounted(async () => {
  if (!isSupported.value) {
    return
  }

  try {
    const directories = await loadAllDirectories()
    storedDirectories.value = directories
  }
  catch (error) {
    console.warn('加载目录列表失败:', error)
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-900 p-8">
    <div class="max-w-6xl mx-auto">
      <h1 class="text-3xl font-bold mb-8 text-gray-100">
        文件浏览器
      </h1>

      <!-- 浏览器支持提示 -->
      <UAlert
        v-if="!isSupported"
        icon="i-heroicons-exclamation-triangle"
        color="error"
        variant="soft"
        title="浏览器不支持"
        description="当前浏览器不支持 File System Access API，请使用 Chrome 86+ 或 Edge 86+ 浏览器"
        class="mb-6"
      />

      <!-- 首页：目录列表 -->
      <div v-if="isSupported && currentView === 'home'">
        <!-- 顶部操作栏 -->
        <UCard class="mb-6">
          <div class="flex justify-between items-center">
            <div class="flex items-center space-x-3">
              <UIcon name="i-heroicons-folder" class="text-primary-500 text-xl" />
              <span class="text-lg font-semibold text-gray-200">已授权的目录</span>
            </div>
            <div class="flex gap-3">
              <UButton
                :loading="loading"
                color="primary"
                icon="i-heroicons-plus"
                @click="addNewDirectory"
              >
                添加目录
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- 目录列表 -->
        <UCard v-if="storedDirectories.length > 0">
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-lg font-semibold">
                目录列表
              </h2>
              <UBadge color="neutral" variant="subtle">
                {{ storedDirectories.length }} 个目录
              </UBadge>
            </div>
          </template>

          <div class="space-y-3">
            <div
              v-for="directory in storedDirectories"
              :key="directory.id"
              class="flex items-center justify-between p-4 rounded-lg hover:bg-gray-800 transition-colors border border-gray-700 cursor-pointer"
              @click="enterDirectory(directory)"
            >
              <div class="flex items-center space-x-4">
                <span class="text-2xl">📁</span>
                <div>
                  <h3 class="font-semibold text-gray-200">
                    {{ directory.name }}
                  </h3>
                  <p class="text-sm text-gray-400">
                    最后访问: {{ directory.lastAccessed.toLocaleDateString() }}
                  </p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="primary"
                  icon="i-heroicons-folder-open"
                  @click.stop="enterDirectory(directory)"
                >
                  进入
                </UButton>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-heroicons-trash"
                  @click.stop="removeDirectory(directory.id)"
                >
                  移除
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <!-- 空状态 -->
        <UCard v-else>
          <div class="py-12 text-center">
            <div class="text-6xl text-gray-600 mb-4">
              📂
            </div>
            <h3 class="text-lg font-semibold text-gray-300 mb-2">
              还没有授权的目录
            </h3>
            <p class="text-gray-400 mb-6">
              点击"添加目录"按钮来选择并授权一个本地目录
            </p>
            <UButton
              color="primary"
              icon="i-heroicons-plus"
              @click="addNewDirectory"
            >
              添加第一个目录
            </UButton>
          </div>
        </UCard>
      </div>

      <!-- 目录浏览视图 -->
      <div v-if="isSupported && currentView === 'directory'">
        <!-- 顶部操作栏 -->
        <UCard class="mb-6">
          <div class="flex justify-between items-center">
            <div class="flex items-center space-x-3">
              <UIcon name="i-heroicons-folder" class="text-primary-500 text-xl" />
              <span class="font-mono bg-gray-800 px-3 py-1 rounded border border-gray-700 text-sm text-gray-200">
                {{ currentPath || '未选择目录' }}
              </span>
            </div>
            <div class="flex gap-3">
              <UButton
                :disabled="loading"
                variant="outline"
                icon="i-heroicons-home"
                @click="goHome"
              >
                返回首页
              </UButton>
              <UButton
                v-if="currentPath && currentPath.includes('/')"
                :disabled="loading"
                variant="outline"
                icon="i-heroicons-arrow-left"
                @click="goBack"
              >
                返回上级
              </UButton>
              <UButton
                v-if="directoryHandle"
                :disabled="loading || uploading"
                color="info"
                icon="i-heroicons-folder-plus"
                @click="createNewFolder"
              >
                新建文件夹
              </UButton>
              <UButton
                v-if="directoryHandle"
                :disabled="loading || uploading"
                color="success"
                icon="i-heroicons-arrow-up-tray"
                @click="selectFilesToUpload"
              >
                上传文件
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- 文件列表 -->
        <UCard
          class="mb-6"
          :class="{ 'border-2 border-dashed border-primary-500 bg-primary-50/10': isDragOver }"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        >
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-lg font-semibold">
                文件列表
              </h2>
              <div class="flex items-center gap-3">
                <UBadge
                  v-if="uploading"
                  color="warning"
                  variant="subtle"
                >
                  正在上传 {{ Object.keys(uploadProgress).length }} 个文件
                </UBadge>
                <UBadge color="neutral" variant="subtle">
                  {{ fileList.length }} 个项目
                </UBadge>
              </div>
            </div>
          </template>

          <!-- 拖拽上传提示 -->
          <div
            v-if="isDragOver"
            class="absolute inset-0 bg-primary-500/20 flex items-center justify-center z-10 rounded-lg border-2 border-dashed border-primary-500"
          >
            <div class="text-center">
              <UIcon name="i-heroicons-arrow-up-tray" class="text-4xl text-primary-500 mb-2" />
              <p class="text-lg font-semibold text-primary-600">
                释放文件以上传
              </p>
            </div>
          </div>

          <!-- 上传进度显示 -->
          <div v-if="uploading && Object.keys(uploadProgress).length > 0" class="mb-4 p-4 bg-gray-800 rounded-lg">
            <h3 class="text-sm font-semibold mb-3 text-gray-200">
              上传进度
            </h3>
            <div class="space-y-2">
              <div
                v-for="(progress, fileName) in uploadProgress"
                :key="fileName"
                class="flex items-center justify-between text-sm"
              >
                <span class="text-gray-300 truncate flex-1 mr-3">{{ fileName }}</span>
                <div class="flex items-center gap-2">
                  <div class="w-20 bg-gray-700 rounded-full h-2">
                    <div
                      class="h-2 rounded-full transition-all duration-300"
                      :class="{
                        'bg-green-500': progress === 100,
                        'bg-red-500': progress === -1,
                        'bg-blue-500': progress > 0 && progress < 100,
                        'bg-gray-500': progress === 0,
                      }"
                      :style="{ width: `${Math.max(0, progress)}%` }"
                    />
                  </div>
                  <span
                    class="text-xs w-12 text-right"
                    :class="{
                      'text-green-400': progress === 100,
                      'text-red-400': progress === -1,
                      'text-blue-400': progress > 0 && progress < 100,
                      'text-gray-400': progress === 0,
                    }"
                  >
                    {{ progress === -1 ? '跳过' : progress === 0 ? '等待' : `${progress}%` }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="loading" class="flex justify-center items-center py-12">
            <UIcon name="i-heroicons-arrow-path" class="animate-spin text-2xl text-primary-500 mr-2" />
            <span class="text-gray-400">加载中...</span>
          </div>

          <div v-else-if="fileList.length === 0" class="py-12">
            <div class="text-center">
              <div class="text-6xl text-gray-600 mb-4">
                📁
              </div>
              <p class="text-gray-400 text-lg">
                目录为空
              </p>
            </div>
          </div>

          <div v-else class="space-y-1">
            <div
              v-for="item in fileList"
              :key="item.name"
              class="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800 transition-colors border border-gray-700"
              :class="{ 'cursor-pointer': item.kind === 'directory' }"
              @click="item.kind === 'directory' ? enterSubDirectory(item) : null"
            >
              <div class="flex items-center space-x-3 min-w-0 flex-1">
                <span class="text-xl flex-shrink-0">{{ getFileIcon(item) }}</span>
                <div class="min-w-0 flex-1">
                  <p class="font-mono text-sm truncate text-gray-200">
                    {{ item.name }}
                  </p>
                  <div class="flex items-center space-x-4 text-xs text-gray-400 mt-1">
                    <UBadge :color="item.kind === 'directory' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                      {{ item.kind === 'directory' ? '目录' : '文件' }}
                    </UBadge>
                    <span v-if="item.kind === 'file' && item.size !== undefined">
                      {{ formatFileSize(item.size) }}
                    </span>
                    <span v-if="item.lastModified">
                      {{ item.lastModified.toLocaleDateString() }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex items-center space-x-2 flex-shrink-0">
                <UButton
                  v-if="item.kind === 'file'"
                  size="xs"
                  variant="ghost"
                  icon="i-heroicons-eye"
                  @click.stop="previewFileContent(item)"
                >
                  预览
                </UButton>
                <UButton
                  v-if="item.kind === 'file'"
                  size="xs"
                  variant="ghost"
                  color="success"
                  icon="i-heroicons-arrow-down-tray"
                  @click.stop="downloadFile(item)"
                >
                  下载
                </UButton>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-heroicons-trash"
                  @click.stop="deleteItem(item)"
                >
                  删除
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>

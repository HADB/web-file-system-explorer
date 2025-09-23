<script setup lang="ts">
import { useStorage } from '@vueuse/core'

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
const storedDirectories = useStorage<StoredDirectoryInfo[]>('storedDirectories', () => [])
const currentPathDirectories = reactive<{ name: string, handle: FileSystemDirectoryHandle }[]>([])
const fileList = ref<EntryItem[]>([])
const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref<{ [key: string]: number }>({})
const toast = useToast()
const currentPath = computed(() => {
  return currentPathDirectories.map((dir) => dir.name).join('/')
})

// 使用 useOverlay 创建模态框
const overlay = useOverlay()

// 拖拽上传相关状态
const isDragOver = ref(false)
const uploadQueue = ref<File[]>([])

async function removeDirectory(id: string) {
  await removeDirectoryHandle(id)
  storedDirectories.value = storedDirectories.value.filter((dir) => dir.id !== id)
}

// 进入指定目录（用户交互触发）
async function enterDirectory(directoryData: StoredDirectoryInfo) {
  loading.value = true
  try {
    const directoryHandle = await getDirectoryHandle(directoryData.id)
    if (directoryHandle && await requestDirectoryPermission(directoryHandle)) {
      currentPathDirectories.push({ name: directoryData.name, handle: directoryHandle })
      currentView.value = 'directory'
      fileList.value = await listDirectoryEntryItems(directoryHandle)
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

// 进入子目录
async function enterSubDirectory(item: EntryItem) {
  if (item.kind === 'directory') {
    currentPathDirectories.push({ name: item.name, handle: item.handle as FileSystemDirectoryHandle })
    fileList.value = await listDirectoryEntryItems(item.handle as FileSystemDirectoryHandle)
  }
}

// 返回首页
function goHome() {
  currentView.value = 'home'
  currentPathDirectories.splice(0)
  fileList.value = []
}

// 选择并添加新目录
async function addNewDirectory() {
  try {
    loading.value = true
    const handle = await window.showDirectoryPicker()

    // 检查是否已经添加过这个目录 - 使用 isSameEntry 方法进行精确比较
    let exists = false
    for (const directoryInfo of storedDirectories.value) {
      const directoryHandle = await getDirectoryHandle(directoryInfo.id)
      if (await isSameEntry(handle, directoryHandle)) {
        exists = true
        break
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
    const handleId = await saveDirectoryHandle(handle)
    storedDirectories.value.push({
      id: handleId,
      name: handle.name,
    })

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

// 获取文件图标
function getFileIcon(item: EntryItem): string {
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

// 文件上传功能
async function handleFileUpload(files: FileList | File[]) {
  const targetDirectoryHandle = currentPathDirectories.at(-1)?.handle
  if (!targetDirectoryHandle) {
    toast.add({
      title: '上传失败',
      description: '请先选择一个目录',
      color: 'error',
    })
    return
  }

  // 验证写入权限
  const hasWritePermission = await requestDirectoryPermission(targetDirectoryHandle)
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
        const fileHandle = await createNewFile(targetDirectoryHandle, file.name)
        await writeFile(fileHandle, file, (progress) => {
          uploadProgress.value[file.name] = Math.round(progress * 100)
        })
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
    fileList.value = await listDirectoryEntryItems(targetDirectoryHandle)
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
async function deleteItem(item: EntryItem) {
  const targetDirectoryHandle = currentPathDirectories.at(-1)?.handle
  if (!targetDirectoryHandle) {
    toast.add({
      title: '删除失败',
      description: '无法确定当前目录',
      color: 'error',
    })
    return
  }

  // 验证写入权限
  const hasWritePermission = await requestDirectoryPermission(targetDirectoryHandle)
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
    await targetDirectoryHandle.removeEntry(item.name, { recursive: item.kind === 'directory' })

    toast.add({
      title: '删除成功',
      description: `${item.kind === 'directory' ? '文件夹' : '文件'} "${item.name}" 已删除`,
      color: 'success',
    })

    // 刷新文件列表
    fileList.value = await listDirectoryEntryItems(targetDirectoryHandle)
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
  const targetDirectory = currentPathDirectories.at(-1)?.handle
  if (!targetDirectory) {
    toast.add({
      title: '创建失败',
      description: '请先选择一个目录',
      color: 'error',
    })
    return
  }

  // 验证写入权限
  const hasWritePermission = await requestDirectoryPermission(targetDirectory)
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
    await createNewDirectory(targetDirectory, folderName)

    toast.add({
      title: '创建成功',
      description: `文件夹 "${folderName}" 创建成功`,
      color: 'success',
    })

    // 刷新文件列表
    fileList.value = await listDirectoryEntryItems(targetDirectory)
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
async function previewFileContent(item: EntryItem) {
  if (item.kind === 'directory') {
    return
  }

  try {
    const fileHandle = item.handle as FileSystemFileHandle
    const file = await readFile(fileHandle)

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
async function downloadFile(item: EntryItem) {
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
  if (currentPathDirectories.length === 1) {
    goHome()
    return
  }

  currentPathDirectories.pop()

  fileList.value = await listDirectoryEntryItems(currentPathDirectories.at(-1)?.handle as FileSystemDirectoryHandle)
}
</script>

<template>
  <div class="min-h-screen bg-gray-900 p-8">
    <div class="max-w-6xl mx-auto">
      <h1 class="text-3xl font-bold mb-8 text-gray-100">
        文件浏览器
      </h1>

      <!-- 浏览器支持提示 -->
      <UAlert
        v-if="!isFileSystemAccessSupported()"
        icon="i-heroicons-exclamation-triangle"
        color="error"
        variant="soft"
        title="浏览器不支持"
        description="当前浏览器不支持 File System Access API，请使用 Chrome 86+ 或 Edge 86+ 浏览器"
        class="mb-6"
      />
      <template v-else>
        <!-- 首页：目录列表 -->
        <div v-if="currentView === 'home'">
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
        <div v-if="currentView === 'directory'">
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
                  v-if="currentPathDirectories.length > 0"
                  :disabled="loading"
                  variant="outline"
                  icon="i-heroicons-arrow-left"
                  @click="goBack"
                >
                  返回上级
                </UButton>
                <UButton
                  v-if="currentPathDirectories.length > 0"
                  :disabled="loading || uploading"
                  color="info"
                  icon="i-heroicons-folder-plus"
                  @click="createNewFolder"
                >
                  新建文件夹
                </UButton>
                <UButton
                  v-if="currentPathDirectories.length > 0"
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
      </template>
    </div>
  </div>
</template>

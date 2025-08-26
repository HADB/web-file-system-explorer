# 🗂️ Web 文件系统浏览器

基于 File System Access API 构建的现代化 Web 文件浏览器，让您能够在浏览器中直接访问和管理本地文件系统。

## ✨ 特性

- 🔍 **本地文件系统访问** - 使用 File System Access API 直接访问本地目录
- 📁 **文件夹浏览** - 支持多层级文件夹导航
- 📄 **文件预览** - 支持文本、图像、视频、音频、PDF 等多种文件类型预览
- ⬆️ **文件上传** - 支持拖拽上传和批量文件上传，带进度显示
- 📂 **文件夹管理** - 创建新文件夹、删除文件和文件夹
- 💾 **权限管理** - 智能权限验证和提示
- 🔄 **自动恢复** - 自动保存和恢复上次访问的目录

## 🖥️ 浏览器兼容性

此应用使用 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 中的 `showDirectoryPicker` 方法，目前支持以下浏览器：

- ✅ Chrome 86+
- ✅ Edge 86+
- ❌ Firefox（不支持 `showDirectoryPicker`）
- ❌ Safari（不支持 `showDirectoryPicker`）

> **重要说明**: 
> - 虽然 Firefox 和 Safari 在较新版本中支持部分 File System Access API，但都不支持 `showDirectoryPicker` 方法
> - 本应用的核心功能依赖于 `showDirectoryPicker`，因此目前只能在基于 Chromium 的浏览器中正常使用
> - 建议使用 Chrome 或 Edge 浏览器以获得最佳体验

## 🚀 快速开始

### 安装依赖

推荐使用 pnpm：

```bash
pnpm install
```

或使用其他包管理器：

```bash
# npm
npm install

# yarn
yarn install

# bun
bun install
```

### 开发服务器

启动开发服务器，默认运行在 `http://localhost:3000`：

```bash
pnpm dev
```

### 生产构建

构建生产版本：

```bash
pnpm build
```

预览生产构建：

```bash
pnpm preview
```

## 🛠️ 技术栈

- **框架**: [Nuxt](https://nuxt.com/) - Vue.js 全栈框架
- **UI 组件**: [Nuxt UI](https://ui.nuxt.com/) - 基于 Tailwind CSS 和 Reka UI
- **样式**: [Tailwind CSS](https://tailwindcss.com/) - 原子化 CSS 框架
- **类型检查**: [TypeScript](https://www.typescriptlang.org/) - 静态类型检查
- **代码规范**: [ESLint](https://eslint.org/) + [@antfu/eslint-config](https://github.com/antfu/eslint-config)
- **API**: [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) - 浏览器文件系统访问

## 📁 项目结构

```
web-file-system-explorer/
├── app/
│   ├── app.vue                    # 根组件
│   ├── assets/
│   │   └── main.css              # 全局样式
│   ├── components/
│   │   ├── CreateFolderModal.vue # 创建文件夹模态框
│   │   ├── DeleteConfirmModal.vue # 删除确认模态框
│   │   └── FilePreviewModal.vue  # 文件预览模态框
│   └── pages/
│       └── index.vue             # 主页面（文件浏览器）
├── public/                       # 静态资源
├── nuxt.config.ts               # Nuxt 配置
├── package.json                 # 项目依赖
└── README.md                    # 项目说明
```

## 🎯 主要功能

### 目录选择与浏览
- 点击"选择目录"按钮选择本地文件夹
- 自动保存选择的目录，下次访问时自动恢复
- 支持多层级目录导航

### 文件操作
- **预览**: 双击文件进行预览，支持多种文件类型
- **下载**: 右键菜单或操作按钮下载文件
- **删除**: 删除文件和文件夹（需要写入权限）

### 文件上传
- 拖拽文件到界面进行上传
- 点击"上传文件"按钮选择文件
- 实时显示上传进度
- 自动处理重名文件

### 文件夹管理
- 创建新文件夹
- 删除空文件夹或包含内容的文件夹
- 重名检测和提示

## 🔒 权限说明

应用会请求以下权限：
- **读取权限**: 浏览文件和文件夹
- **写入权限**: 上传文件、创建文件夹、删除操作

首次访问目录时，浏览器会提示您授予相应权限。

## 📝 开发说明

### 代码规范

项目使用 ESLint 进行代码规范检查：

```bash
# 检查代码规范
pnpm lint

# 自动修复代码规范问题
pnpm lint:fix
```

### 类型检查

使用 TypeScript 进行类型检查：

```bash
# 类型检查
pnpm type-check
```

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🔗 相关链接

- [Nuxt 文档](https://nuxt.com/docs)
- [File System Access API 文档](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [Nuxt UI 文档](https://ui.nuxt.com/)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)

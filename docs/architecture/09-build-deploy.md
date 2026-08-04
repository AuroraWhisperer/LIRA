# 构建、打包与发布

> 涉及文件：`package.json` (build 配置), `scripts/create-icon.js`, `scripts/publish-release.js`, `scripts/check-js.js`, `build/installer.nsh`, `src/electron/update-manager.js`

---

## 技术选型

| 技术 | 说明 |
|------|------|
| **electron-builder 26.x** | 打包为 Windows NSIS 安装包 |
| **electron-updater 6.x** | 应用内自动更新（GitHub Releases） |
| **Node.js Canvas (scripts/create-icon.js)** | 动态生成 .ico 图标 |
| **GitHub Releases API** | 版本分发 + 更新检测 |
| **NSIS (Nullsoft Scriptable Install System)** | Windows 安装程序 |

---

## npm scripts

```json
{
  "start":        "node src/server.js",
  "desktop":      "electron .",
  "check":        "node scripts/check-js.js",
  "test":         "node --experimental-vm-modules --test --test-concurrency=1",
  "make:icon":    "node scripts/create-icon.js",
  "dist:win":     "npm run make:icon && electron-builder --win nsis --x64",
  "dist:win:local":"npm run make:icon && cross-env ELECTRON_SKIP_BINARY_DOWNLOAD=1 electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist",
  "release:win":  "node scripts/publish-release.js"
}
```

### 脚本说明

| 命令 | 功能 |
|------|------|
| `npm start` | 纯 Web 模式：启动 HTTP 服务器（浏览器访问） |
| `npm run desktop` | 桌面模式：Electron 壳 + HTTP 服务器同进程 |
| `npm run check` | 语法检查：JavaScript 文件基本正确性验证 |
| `npm test` | 单元测试：`node:test` + ESM 模块 |
| `npm run make:icon` | 图标生成：从 `build/icon.png` 生成 `build/icon.ico` |
| `npm run dist:win` | 正式打包：从网络下载 Electron 二进制 + 打包 NSIS |
| `npm run dist:win:local` | 本地打包：使用已安装的 Electron，跳过下载（离线/加速） |
| `npm run release:win` | 发布：打包 + 创建 GitHub Release + 上传安装包 |

---

## electron-builder 配置

### 核心配置 (`package.json` → `build`)

```json
{
  "build": {
    "appId": "com.aurorawhisperer.bilibili-live-song-plugin",
    "productName": "点歌助手",
    "artifactName": "bilibili-live-song-plugin-setup-${version}.${ext}",
    "directories": {
      "output": "release",
      "buildResources": "build"
    },
    "files": [
      "src/**/*",
      "public/**/*",
      "package.json"
    ],
    "asar": true,
    "npmRebuild": false,
    "win": {
      "icon": "build/icon.ico",
      "target": [{ "target": "nsis", "arch": ["x64"] }]
    },
    "nsis": {
      "artifactName": "bilibili-live-song-plugin-setup-${version}.${ext}",
      "include": "build/installer.nsh",
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "shortcutName": "点歌助手",
      "uninstallDisplayName": "点歌助手",
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "publish": [{
      "provider": "github",
      "owner": "AuroraWhisperer",
      "repo": "Request-song",
      "releaseType": "release"
    }]
  }
}
```

### 关键配置决策

| 配置项 | 值 | 原因 |
|--------|-----|------|
| `asar: true` | 打包为 asar 归档 | 减少文件数，加快加载 |
| `npmRebuild: false` | 跳过原生模块重编译 | 项目无原生 npm 依赖 |
| `oneClick: false` | 标准安装向导 | 允许用户选择安装目录 |
| `perMachine: false` | 按用户安装 | 不需要管理员权限 |
| `files` | 白名单模式 | 排除 `data/`, `release/`, `node_modules/` 等 |

---

## 图标生成 (`scripts/create-icon.js`)

```
build/icon.png (1024×1024 源文件)
    │
    ▼
scripts/create-icon.js
    ├─ Node.js Canvas 读取 icon.png
    ├─ 生成多种尺寸：16, 24, 32, 48, 64, 128, 256
    └─ 输出 build/icon.ico（Windows 多尺寸图标）
```

需要安装系统级 Canvas 依赖（node-canvas 的 Windows 编译环境）。

---

## NSIS 安装脚本 (`build/installer.nsh`)

自定义 NSIS 扩展，在标准安装流程之外：
- 安装前的环境检查
- 自定义卸载逻辑
- 安装后的快捷方式创建

---

## 发布流程 (`scripts/publish-release.js`)

### 完整发布流水线

```
npm run release:win
    │
    ├─ 1. 读取 package.json → version
    ├─ 2. 执行 npm run dist:win → 生成安装包
    ├─ 3. 校验安装包存在
    ├─ 4. 通过 GitHub API 创建 Release
    │   ├─ tag_name: v{version}
    │   ├─ target_commitish: main
    │   ├─ name: v{version}
    │   ├─ body: (从 changelog 读取或手动输入)
    │   └─ draft: false, prerelease: false
    │
    ├─ 5. 上传安装包到 Release
    │   └─ bilibili-live-song-plugin-setup-{version}.exe
    │
    ├─ 6. 上传 latest.yml（electron-updater 需要）
    │
    └─ 7. 输出 Release URL
```

### GitHub Personal Access Token

需要在运行环境设置 `GH_TOKEN` 或 `GITHUB_TOKEN` 环境变量，用于 API 认证。

---

## 自动更新架构

### 更新检测流程

```
应用启动（打包版 + 开启自动更新）
    │
    ├─ 1s 延迟 → checkForUpdates()
    │
    ├─ electron-updater 读取：
    │   https://github.com/AuroraWhisperer/Request-song/releases/latest/download/latest.yml
    │
    ├─ 比较版本号
    │   ├─ 相同 → 无更新
    │   └─ 更新版本 > 当前版本 → 触发更新
    │
    ├─ 更新状态机：
    │   idle → checking → update-available → downloading → downloaded
    │
    └─ 用户点击安装 → quitAndInstall()
        ├─ 保存播放器状态
        ├─ 关闭服务器
        └─ 启动安装程序 → 自动重启
```

### 状态同步到 UI

```javascript
// Main Process → Renderer Process
function sendUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:update-state', updateState);
  }
}

// updateState 结构
{
  status: 'idle' | 'checking' | 'update-available' | 'downloading'
         | 'downloaded' | 'error' | 'dev-disabled' | 'no-update',
  message: '...',
  version: '1.6.6',
  canDownload: true/false,
  canInstall: true/false,
  progress: { percent: 45, bytesPerSecond: 1024000, total: 50000000, transferred: 22500000 },
  updateVersion: '1.7.0'
}
```

---

## 代码检查 (`scripts/check-js.js`)

自定义 JavaScript 语法验证器：
- 遍历 `src/` 和 `public/js/` 下所有 `.js` 文件
- 检查基本的语法正确性
- 检查 CommonJS/ESM 模块导入一致性
- 输出错误文件列表

---

## 本地构建批处理

### build-local.bat

```
设置 ELECTRON_SKIP_BINARY_DOWNLOAD=1
→ 跳过从网络下载 Electron 二进制
→ 使用 node_modules/electron/dist 中已安装的版本
→ 大幅加速本地打包
npm run dist:win:local
```

### build-debug.bat

```
调试构建：
→ 设置 DEBUG 环境变量
→ 输出更详细的构建日志
→ 不压缩 asar（方便检查打包内容）
```

---

## 运行模式对比

| 模式 | 命令 | ELECTRON_DESKTOP | 进程 | 用途 |
|------|------|------------------|------|------|
| Web 模式 | `npm start` | `undefined` | 仅 HTTP Server | 开发调试后端 API |
| 桌面模式 | `npm run desktop` | `'1'` | Electron + Server | 生产环境 |
| 开发桌面 | 直接运行 `electron .` | `'1'` | Electron + Server | 开发调试桌面功能 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | HTTP 绑定地址；旧值 `localhost` 启动时会自动规范为 IPv4 回环地址 |
| `PORT` | `3000` | HTTP 起始端口 |
| `SONG_PLUGIN_DATA_DIR` | `{ROOT}/data/` | 数据目录（桌面模式指向 userData） |
| `ELECTRON_DESKTOP` | `undefined` | 桌面模式标识（影响行为） |
| `AUTO_OPEN_ADMIN` | `undefined` | Web 模式下自动打开浏览器 |
| `GH_TOKEN` / `GITHUB_TOKEN` | — | 发布脚本的 GitHub API Token |

---

## 版本历史（近期）

| 版本 | 主要变更 |
|------|----------|
| v1.6.6 | QQ音乐歌单接口升级为客户端API、登录态检测增强、歌词切换按钮合并 |
| v1.6.5 | QQ音乐GTK动态计算、extractUin优先级匹配、我喜欢回退逻辑 |
| v1.6.4 | 网易云歌单写入、歌单选择器UI、ProviderManager平台隔离、weapi加密、QQ Cookie增强 |
| v1.6.3 | 播放器歌单去重、播放页网格布局优化 |
| v1.6.2 | 播放器歌单添加按钮、首页卡片视觉重设计、发布脚本优化 |

> 完整版本历史见 `UPDATE.md`

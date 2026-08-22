# 构建、打包与发布

> 涉及文件:[package.json](../../../package.json)(`scripts` 与 `build` 配置)、[scripts/create-icon.js](../../../scripts/create-icon.js)、[scripts/publish-release.js](../../../scripts/publish-release.js)、[scripts/check-js.js](../../../scripts/check-js.js)、[scripts/build-local.bat](../../../scripts/build-local.bat)、[scripts/build-debug.bat](../../../scripts/build-debug.bat)、[build/installer.nsh](../../../build/installer.nsh)

本文档是构建/打包/发布的**唯一事实源**:npm scripts、依赖清单、electron-builder 配置、图标生成、NSIS 脚本、发布流水线、运行模式、版本管理、本地批处理均只在此成表。自动更新的运行时状态机与 UI 同步见 [desktop/update.md](../desktop/update.md),桌面进程与 userData 布局见 [desktop/main.md](../desktop/main.md),各运行模式的认证能力差异见 [desktop/auth.md](../desktop/auth.md)。

## 1. npm scripts(唯一成表处)

| script | 命令 | 说明 |
|---|---|---|
| `start` | `node src/server.js` | 纯 Web 模式:仅启动 HTTP 服务,进程模型见 [backend/server-core.md](../backend/server-core.md) |
| `desktop` | `electron .` | 桌面模式:Electron 壳与 HTTP 服务同进程 |
| `check` | `node scripts/check-js.js` | 全量 JS 语法检查(见 [test.md](test.md) §3) |
| `test` | `node --experimental-vm-modules --test --test-concurrency=4` | 单元测试:node:test,并发 4(见 [test.md](test.md)) |
| `test:admin` | `node --experimental-vm-modules --test --test-concurrency=4 test/admin-page-composition.test.js test/frontend-admin-shell.test.js test/frontend-admin-ai.test.js` | 管理页完整回归测试(显式启用 ESM VM 模块) |
| `verify:docs` | `node --test test/governance-docs.test.js` | 治理文件、路由表、规格索引和范围内 Markdown 链接检查 |
| `verify:architecture` | `node --experimental-vm-modules --test test/module-boundaries.test.js test/esm-module-boundaries.test.js` | 模块边界、遗留债务预算和前端 ESM 边界检查 |
| `verify:quick` | `npm run verify:docs && npm run check && npm run verify:architecture` | 日常评审前快速门禁:文档 → 语法 → 架构 |
| `verify` | `npm run verify:quick && npm test` | 完整门禁:先快速失败,再运行全量测试 |
| `diagnose:wesing` | `node scripts/inspect-wesing-playback.js` | 全民 K 歌播放状态交互诊断(见 [test.md](test.md) §4 与 [backend/music/wesing.md](../backend/music/wesing.md)) |
| `make:icon` | `node scripts/create-icon.js` | 生成 `build/icon.png` + `build/icon.ico`(见 §5) |
| `dist:win` | `npm run make:icon && electron-builder --win nsis --x64` | 正式打包:下载 Electron 二进制 + 构建 NSIS 安装包 |
| `dist:win:local` | `npm run make:icon && set ELECTRON_SKIP_BINARY_DOWNLOAD=1 && electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist` | 本地打包:跳过二进制下载,复用 `node_modules/electron/dist` |
| `release:win` | `node scripts/publish-release.js` | 完整发布流水线(见 §7) |

- 出处:[package.json](../../../package.json) 的 `scripts` 字段。
- `dist:win:local` 使用**原生 cmd 语法**(`set VAR=1 && …`,Windows-only),未引入任何跨平台环境变量注入工具,该命令只能在 Windows cmd 下执行。
- `test` 的 `--test-concurrency=4`(并发数 4,勿改回 1);`--experimental-vm-modules` 必需:多个测试在 vm 中求值前端 ESM 模块(见 [test.md](test.md) §1)。

## 2. 依赖清单(唯一成表处)

| 类型 | 包 | 版本 | 用途 |
|---|---|---|---|
| dependencies | `@jixun/qmweb-sign` | `2.0.3` | QQ音乐 zzcSign 请求签名([package.json:24](../../../package.json#L24)) |
| dependencies | `qrc-decoder` | `1.0.2` | QQ音乐 QRC 歌词 3DES 解密([package.json:26](../../../package.json#L26)) |
| dependencies | `electron-updater` | `^6.8.4` | 应用内自动更新(运行时见 [desktop/update.md](../desktop/update.md)) |
| devDependencies | `electron` | `43.2.0` | Electron 运行时,精确锁定([package.json:29](../../../package.json#L29)) |
| devDependencies | `electron-builder` | `^26.11.1` | 打包器([package.json:30](../../../package.json#L30)) |

**engines:`node >=24`**([package.json:20-22](../../../package.json#L20-L22))。运行时依赖仅 3 个,其余功能全部手写(见 [00-overview.md](../README.md))。

**npm overrides**([package.json:79-81](../../../package.json#L79-L81)):js-yaml 强制 `^4.3.1` 以解决 GHSA-5p4m-2wfm-xmqj(CVE-2026-59870,!!omap 二次方 CPU 消耗)。该漏洞影响 electron-updater 与 electron-builder 的传递依赖 js-yaml 4.0.0-4.3.0;override 后生产依赖审计为 0 高危漏洞。

## 3. electron-builder 配置(唯一成表处)

全部配置内联在 [package.json:32-77](../../../package.json#L32-L77) 的 `build` 字段,无独立 electron-builder 配置文件。

| 配置项 | 值 | 出处 | 说明 |
|---|---|---|---|
| `appId` | `com.aurorawhisperer.lira` | [package.json:33](../../../package.json#L33) | 应用标识 |
| `productName` | LIRA | [package.json:34](../../../package.json#L34) | 安装/卸载显示名 |
| `artifactName` | `lira-setup-${version}.${ext}` | [package.json:35](../../../package.json#L35) | 安装包命名 |
| `directories.output` | `release` | [package.json:37](../../../package.json#L37) | 产物目录(见 §4) |
| `files` | `src/**/*` + `public/**/*` + `package.json` + 静态 PNG 排除项 | [package.json:40-64](../../../package.json#L40-L64) | 白名单打包;静态界面 PNG 保留在源码但由 WebP 兄弟文件替代进入安装包;礼物目录 PNG 不排除 |
| `asar` | `true` | [package.json:45](../../../package.json#L45) | 源码打成 asar 归档 |
| `npmRebuild` | `false` | [package.json:46](../../../package.json#L46) | 无原生模块,跳过重编译 |
| `win.icon` | `build/icon.ico` | [package.json:48](../../../package.json#L48) | 由 make:icon 生成 |
| `win.target` | nsis / x64 | [package.json:49-56](../../../package.json#L49-L56) | 仅 Windows x64 |
| `nsis.oneClick` | `false` | [package.json:61](../../../package.json#L61) | 标准安装向导,非一键安装 |
| `nsis.perMachine` | `false` | [package.json:62](../../../package.json#L62) | 按用户安装,无需管理员权限 |
| `nsis.allowToChangeInstallationDirectory` | `true` | [package.json:63](../../../package.json#L63) | 允许自定义安装目录 |
| `nsis.shortcutName` / `uninstallDisplayName` | LIRA | [package.json:64-65](../../../package.json#L64-L65) | 快捷方式与卸载显示名 |
| `nsis.createDesktopShortcut` / `createStartMenuShortcut` | `true` | [package.json:66-67](../../../package.json#L66-L67) | 桌面 + 开始菜单快捷方式 |
| `nsis.include` | `build/installer.nsh` | [package.json:60](../../../package.json#L60) | 自定义 NSIS 宏(见 §6) |
| `publish` | GitHub `AuroraWhisperer/LIRA`,`releaseType: release` | [package.json:69-76](../../../package.json#L69-L76) | electron-updater 更新源与发布脚本读取 |

`artifactName` 在顶层 `build` 与 `build.nsis` 各声明一次([package.json:35](../../../package.json#L35)、[package.json:59](../../../package.json#L59));发布脚本按 `build.nsis.artifactName` 计算产物文件名([publish-release.js:14-16](../../../scripts/publish-release.js#L14-L16))。

## 4. 产物(release/)

| 产物 | 说明 |
|---|---|
| `lira-setup-{version}.exe` | NSIS 安装包,发布时的上传主产物 |
| `lira-setup-{version}.exe.blockmap` | 差分更新块映射(electron-updater 用) |
| `latest.yml` | 更新清单,electron-updater 的版本比对依据 |
| `win-unpacked/` | 未打包目录(本地运行/调试) |

## 5. 图标生成(scripts/create-icon.js)

**零第三方依赖**的纯 Node 实现(`node:zlib` 之外不 import 任何包),**不使用 node-canvas**,无需任何系统级图形库(与旧文档相反)。

- 若 `build/icon-source.png` 存在([create-icon.js:15-25](../../../scripts/create-icon.js#L15-L25)):手写 PNG 解码器([create-icon.js:103-175](../../../scripts/create-icon.js#L103-L175))读取 → 居中裁正方形 → 暗色边缘背景泛洪去除([create-icon.js:219-241](../../../scripts/create-icon.js#L219-L241))→ 最近邻缩放到 256×256;
- 否则程序化绘制应用图标:圆角渐变底 + 麦克风/音符图形(圆与矩形图元,[create-icon.js:27-56](../../../scripts/create-icon.js#L27-L56));
- 输出 `build/icon.png` 与 `build/icon.ico` — ICO 为 **PNG 压缩的单尺寸 256×256**(宽度字段 0 表示 256,[create-icon.js:307-321](../../../scripts/create-icon.js#L307-L321))。

`npm run make:icon` 是 `dist:win`/`dist:win:local`/`release:win` 的前置步骤;electron-builder 读取 `build/icon.ico`([package.json:48](../../../package.json#L48))。

## 6. NSIS 安装脚本(build/installer.nsh)

被 `nsis.include` 引用([package.json:60](../../../package.json#L60)),在标准 NSIS 流程上追加:

- `ManifestDPIAware true`([installer.nsh:1](../../../build/installer.nsh#L1)):安装器进程高 DPI 感知。
- `customInit`([installer.nsh:3-19](../../../build/installer.nsh#L3-L19)):安装前遍历 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`,删除 DisplayName 为「LIRA」但 UninstallString 指向的文件已不存在的**残留注册表项** — 避免 NSIS 因找不到旧卸载程序而中止(`Failed to uninstall old application files.: 2`)。
- `customUnInstall`([installer.nsh:21-26](../../../build/installer.nsh#L21-L26)):卸载时递归删除 `%APPDATA%\LIRA` — 旧版本残留在 %APPDATA% 下的 Chromium 分区数据(userData 已重定向到安装目录下 `data/`,见 [desktop/main.md](../desktop/main.md))。同时兼容清理更早期的 `%APPDATA%\bilibili-live-song-plugin` 遗留数据。

## 7. 发布流程(scripts/publish-release.js)

`npm run release:win` 一键发布,目标仓库取自 `build.publish[0]`([publish-release.js:12-13](../../../scripts/publish-release.js#L12-L13)):

| 步骤 | 动作 | 出处 |
|---|---|---|
| 1 | 读 package.json `version` → tag `v{version}`;记录当前分支与 HEAD | [publish-release.js:8-11](../../../scripts/publish-release.js#L8-L11) |
| 2 | `ensureTag`:本地无标签则创建**附注标签**;远端无则 `git push origin v{version}` | [publish-release.js:67-79](../../../scripts/publish-release.js#L67-L79) |
| 3 | `ensureGhToken`:取 `GH_TOKEN` 环境变量,未设则回退 `gh auth token`(gh CLI 已登录即可);两者皆无则报错 | [publish-release.js:81-89](../../../scripts/publish-release.js#L81-L89) |
| 4 | `ensureGithubRelease`:先 `gh release view` 探测;不存在则 `gh release create` **提前建好 Release**(规避 electron-builder 并发建 Release 的竞态),标题 `v{version}`,正文取 `UPDATE.md` 的 `## v{version} ` 小节,经临时文件 `--notes-file` 传入(规避 Windows shell 对反引号的命令替换) | [publish-release.js:91-115](../../../scripts/publish-release.js#L91-L115) |
| 5 | `npm run make:icon` 生成图标 | [publish-release.js:30](../../../scripts/publish-release.js#L30) |
| 6 | 循环最多 3 次:`npx electron-builder --win nsis --x64 --publish always --config.electronDist=node_modules/electron/dist`,env 注入 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`(本地二进制,不重新下载) | [publish-release.js:32-44](../../../scripts/publish-release.js#L32-L44) |
| 7 | `findMissingAssets` 用 `gh api repos/{owner}/{repo}/releases/tags/{tag}` 核对三个产物均处于 `uploaded`:安装包 exe、`exe.blockmap`、`latest.yml`;缺什么补什么 | [publish-release.js:46-52](../../../scripts/publish-release.js#L46-L52)、[publish-release.js:133-153](../../../scripts/publish-release.js#L133-L153) |
| 8 | 3 次尝试后仍缺产物 → 抛错并提示 `gh release view v{version}` 人工介入 | [publish-release.js:55-58](../../../scripts/publish-release.js#L55-L58) |

**凭据**:仅认 `GH_TOKEN`(或 gh CLI 登录态),不读 `GITHUB_TOKEN`。`latest.yml` 由 electron-builder `--publish always` 上传,是 electron-updater 的更新清单,运行时机制见 [desktop/update.md](../desktop/update.md)。

## 8. 运行模式对比

| 模式 | 入口 | ELECTRON_DESKTOP | 进程 | 认证与功能 |
|---|---|---|---|---|
| Web | `npm start` | 未设 | 仅 HTTP Server | **降级认证**:无 safeStorage、无 Cookie 注入,桌面专属能力(Chromium 分区登录、Cookie 注入、自动更新)不可用,差异见 [desktop/auth.md](../desktop/auth.md) |
| 桌面 | `npm run desktop` | `'1'` | Electron main + Server 同进程 | 完整:分区登录、Cookie 注入、自动更新 |
| 开发桌面 | `electron .`(直接运行) | `'1'` | 同上 | 同上;未打包环境下调试桌面功能 |

`ELECTRON_DESKTOP` 由 Electron main 启动早期写为 `'1'`([main.js:212](../../../src/electron/main.js#L212)),`/api/health` 的 `desktop` 字段据此上报([server.js:395](../../../src/server.js#L395));进程模型见 [desktop/main.md](../desktop/main.md)。环境变量(`HOST`/`PORT`/`SONG_PLUGIN_DATA_DIR`/`AUTO_OPEN_ADMIN`)的唯一成表处在 [backend/server-core.md §3](../backend/server-core.md)。

## 9. 版本管理

- 版本号唯一来源:package.json `version`([package.json:3](../../../package.json#L3))。
- 变更记录:`UPDATE.md`,按 `## v{version} 变更` 小节组织([UPDATE.md:7](../../../UPDATE.md#L7));发布脚本自动截取当前版本小节作为 Release 正文([publish-release.js:117-131](../../../scripts/publish-release.js#L117-L131))。
- git 标签:每次发布创建附注标签 `v{version}` 并推送 origin([publish-release.js:67-79](../../../scripts/publish-release.js#L67-L79))。
- 发布前需确认 package.json 与 UPDATE.md 中的版本一致(版本不匹配时 Release 正文会退回占位文本)。

## 10. 本地构建批处理

| 脚本 | 内容 | 用途 |
|---|---|---|
| [build-local.bat](../../../scripts/build-local.bat) | `set ELECTRON_SKIP_BINARY_DOWNLOAD=1` + `ELECTRON_BUILDER_CACHE=%USERPROFILE%\.cache\electron-builder` → make:icon → `electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist` | 使用本地已安装的 Electron 构建,避免重复下载;完成后列出 `release\*.exe` |
| [build-debug.bat](../../../scripts/build-debug.bat) | `set DEBUG=electron-builder` + `DEBUG_COLORS=true` → `npx electron-builder --win nsis --x64 %*` | electron-builder 调试日志输出;`%*` 透传额外参数(如 `--publish never`) |

两个批处理与 `npm run dist:win:local` 等价但带额外环境变量/参数;**均不改变 asar 打包行为**(与旧文档的描述相反)。

## 11. 自动更新

运行时依赖 `electron-updater` ^6.8.4(见 §2);更新清单即 §7 上传的 `latest.yml`。检查时机、更新状态机(`idle → checking → update-available → downloading → downloaded`)、安装与重启时序、状态到渲染进程的同步,全部成文于 [desktop/update.md](../desktop/update.md)。

## 12. Windows 代码签名

**当前状态:设计完成,实现阻塞于所有者输入**。完整设计见 [code-signing.md](code-signing.md)。

所需所有者决策:
- **发布者名称**(Publisher Name):证书主题 CN,必须与购买/生成的代码签名证书完全匹配(如 `Aurora`、`AuroraWhisperer`)
- **证书存储方式**:选择文件存储(.pfx 文件路径 + 密码环境变量)或 Windows 证书存储区(指纹)
- **CI/自动化策略**:是否在 CI 中强制签名检查,或仅在手动发布脚本中执行

签名基础设施已就绪:
- [scripts/sign-windows.js](../../../scripts/sign-windows.js):electron-builder 签名脚本(骨架实现,等待证书配置)
- [scripts/verify-windows-release.js](../../../scripts/verify-windows-release.js):PowerShell `Get-AuthenticodeSignature` 验证脚本(完整实现)
- 发布门禁集成点已设计(在 [scripts/publish-release.js](../../../scripts/publish-release.js) electron-builder 成功后插入验证)

**当前完整性保护**:electron-updater 已通过 SHA-512 哈希验证保护更新完整性([desktop/update.md](../desktop/update.md) §5 的 `checksum mismatch` 错误映射)。代码签名的附加价值:Windows SmartScreen 信誉、发布者身份验证、企业环境兼容性(详见 [code-signing.md](code-signing.md) §7)。

配置签名后需更新 `package.json` `build.win`:
```json
"win": {
  "icon": "build/icon.ico",
  "target": [...],
  "signingHashAlgorithms": ["sha256"],
  "certificateSubjectName": "<OWNER_INPUT_PUBLISHER_NAME>",
  "sign": "./scripts/sign-windows.js"
}
```

并在 §7 发布流程步骤 6-7 之间插入签名验证(详见 [code-signing.md](code-signing.md) §5)。

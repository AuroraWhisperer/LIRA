# 共享字体随安装包分发

Status: Completed

## 目标与当前证据

八款完整共享字体随安装包内置，首次使用不依赖 GitHub、jsDelivr 或 VPN。用户已明确选择内置分发并要求核对安装后位置。当前运行实例只发布得意黑与猫啃什锦黑，下载并不可靠；原打包规则排除了仓库已有的八款 WOFF2。工作区已有菜单就绪过滤与样式刷新修改，保留并验证。

## 归属、约束与非目标

- `package.json` 拥有分发规则；`src/fonts/font-library.js` 已支持校验内置资源，`src/server.js` 根据模块位置定位 `public`，静态资源由现有 HTTP handler 读取。
- 字体位于 `<安装目录>/resources/app.asar/public/fonts/`；不依赖工作目录，不写入安装目录，不注册 Windows 系统字体。HTTP/IPC、缓存格式、字体版本、设置和原有下载修复边界不变。
- 保留所有已有未提交修改；不重启用户应用，不发布、提交或改动用户缓存。隔离安装布局/ASAR 验证全部放在 `tmp/`。
- 文档 owner：字体说明、打包参考、桌面初始化、缓存说明和相关前端参考。用户指南更新为内置离线使用；交互式引导核对是否受影响。

## 实施与验证

- [x] 移除八款共享字体的打包排除项，保留 OFL、完整 WOFF2 和文楷全部分片；外置套装专用素材规则不变。
- [x] 用既有 packaging matcher 与下载测试验证字体保留、空缓存离线初始化零请求。
- [x] 在含中文和空格的隔离安装路径中创建实际 ASAR，通过 Electron 从 ASAR 加载八款字体，核对真实字形；现有文本框 Electron 测试验证选择/编辑/预览链路。
- [x] 同步文档并完成定向回归、文档/架构门禁与任务范围语法检查；全仓语法检查受同期文件修改影响，限制见下方。最后审查任务 diff、`git diff --check`、`git status --short`。

## 验证记录与限制

- 字体下载/缓存、菜单就绪、loader、HTTP 与打包范围 30 项通过；新增 `node --test test/desktop/bundled-fonts-electron.test.js` 通过。八款字体合计 30 个 WOFF2 文件、36.5018 MiB，实际 ASAR 内各字体在「在这里输入文字」样本中均使用独立的自定义字形，零外网请求、零字体缓存。
- `node --experimental-vm-modules --test test/desktop/text-box-electron.test.js test/lyrics/desktop-lyric-fonts-browser.test.js test/admin/frontend-usage-guide.test.js`：19 项通过，含 500 次格式点击、字体选择、预览、保存与重开。
- `npm run verify:docs`：10 项通过；`npm run verify:architecture`：27 项通过。
- `npm run check` 两次均因其他工作同时改动输入而返回 `Syntax inputs changed during verification`，没有有效的全仓语法结果。对字体 catalog/library/loader、测试执行器、下载/打包/ASAR 测试、服务夹具和 Electron 夹具共 9 文件分别执行 `node --check` 均通过。测试执行器已确认新增测试属于 desktop 组。
- 首次 ASAR 测试因夹具缺少文本框默认字段失败，已改为复用 `createTextBoxDefaults()` 并修正测试清理顺序，随后通过；没有改动产品校验规则。旧失败探针已退出，其 `tmp/packaged-app-Yvl9gA` 目录清理被工具安全策略拒绝，未绕过，保留于 tmp。
- 字体来源/安装位置、打包/缓存/初始化参考、前端参考和两处使用指南已同步；交互式引导未包含首次下载字体步骤，无需改动。现有场景设置、HTTP/IPC 与字体版本不变，无需修改架构契约或截图。
- 未生成正式安装器、未提交或发布、未重启用户当前应用。新安装器构建后才会将这些资源安装到用户机器；没有宣称已更新现有运行版本。

## 失败处理与完成条件

内置资源随软件版本更新，字体完整性仍通过清单哈希验证。旧下载缓存继续兼容；正常内置使用不发起下载。需要回退时仅逐项撤销本任务的打包规则、测试和文档修改。八款资源在实际 ASAR 路径中零网络可读、真实字形和相关回归通过、文档一致后完成。安装器未重新构建时不得声称已更新用户当前应用。

# 字体增量下载 Implementation Plan

**Status:** Completed

**Goal:** 八款可选字体独立于安装包，由客户端直接从固定版本字体源下载，首次授权与礼物初始化并行；后续只补缺失或变化文件，进度使用现有 toast 堆叠。

**Architecture:** 本地字体资源 owner 负责随客户端更新的 JSON 清单、固定 SHA-256、有限并发、原子缓存和状态。现有本地 HTTP 静态资源适配器提供同源字体/CSS；Electron 只接线授权启动与受限状态/重试桥。字体下载不经过 LIRA Server，也不添加远端接口。

**Tech Stack:** Node.js 24、Electron 43、现有 yauzl、原生 ESM/CSS。

## Current Behavior

- 已有 5.4.2 EXE 的 app.asar 中字体为 27,920,784 字节（26.63 MiB）；当前源码字体约 42.5 MiB。
- 八款共享字体约 36.5 MiB；歌词多语言补字约 6 MiB。后者和极小固定标题字库保留内置，保障默认补字。
- 字体大多由上游 TTF 转换为 WOFF2，不能假定作者提供同字节 WOFF2；下载保留同版本完整字形，接受首次原版下载量较大。
- 现有礼物缓存、首次授权就绪控制器和 toast 堆叠已存在，业务状态不能混入礼物统计。
- 用户明确限制服务器仅 3 Mbps：禁止把 LIRA Server 用作字体代理或失败回源。

## Ownership / Compatibility

- 新增 `src/fonts/` 拥有清单与资源下载；`src/shared/data-paths.js` 定义 `data/cache/fonts/`。
- `src/server/font-assets.js` 适配本地 CSS/字体请求，`src/server.js` 拥有创建和关闭。
- `src/electron/desktop-readiness-controller.js` 启动并行任务；受信 preload/IPC 提供状态和重试，不接受 URL/文件路径。
- `public/js/admin/` 复用 `shared/toast.js`；字体 ID、CSS family、设置值、本机字体权限和外部套装保持兼容。
- 保留工作区全部已有未提交修改。无提交、发布、服务端修改、字体安装或用户数据迁移。

## Milestones

- [x] 核实八款字体实际来源、下载大小和哈希；清单保留许可证与开发期资源信息。
- [x] 实现下载/缓存：同一轮去重、两路并发、有限超时、哈希/格式校验、原子发布、保留旧版本、取消收尾。缓存齐全时零网络请求；失败下次启动或显式重试补齐。
- [x] 接入本地 HTTP 与 Electron；首次进度可见且与礼物并行，字体错误不阻塞核心桌面；后续独立 toast 原位更新，多条共存。
- [x] 按清单从安装包排除可选字体，保留源码制作素材、许可及补字；补齐聚焦回归和实际字体加载检查。
- [x] 同步字体 README、存储/HTTP/桌面桥/打包参考及相关应用内说明，最终检查 task diff。

## Verification

- `node --experimental-vm-modules --test`：字体 owner、HTTP、授权启动/IPC、toast、打包范围、现有共享字体与歌词消费者。
- 使用隔离 `tmp/` 下载验证真实字体源与哈希，确认字体请求不访问 LIRA Server；复用现有浏览器/桌面 fixture 检查文字加载及 toast 共存。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs`；按失败实际影响调整，不默认跑无关全量。
- `git diff --check`、最终 diff 和 `git status --short`，确认无下载/运行时数据进入变更。

## Failure Handling / Done When

下载中止或校验失败不覆盖旧缓存；只清理由本任务创建的临时文件。首次失败使用内置补字/系统字体，并显示重试入口；升级保留缓存。完成条件为安装包排除规则与运行时下载闭环可验证、原有字体/授权/礼物边界保持、文档一致，且如实记录未覆盖的正式发布安装器验收。

## Acceptance — 2026-10-17

- 实际 5.4.2 安装器内字体为 26.63 MiB；当前共享可选字体约 36.5 MiB 已通过 electron-builder 文件过滤排除，保留约 6 MiB 多语言补字、固定标题字库和许可证。未重新构建正式安装器，不把原文件体积视为 EXE 压缩收益。
- 八款固定上游资源通过生产下载器实际下载并校验。首次网络量 84.21 MiB、本机缓存 79.80 MiB；客户端直连 GitHub/jsDelivr，不请求 LIRA Server。Electron net.fetch 的真实联网及哈希验证通过；连通性仍取决于用户网络。
- 80 项字体、HTTP、IPC、授权启动、打包、现有歌词/字体消费者、toast 和服务生命周期组合回归通过；指南 16 项、架构 27 项、文档 10 项及 1590 个 JS 语法检查通过。
- 隔离 Electron 使用真实 preload、HTTP 认证与 IPC，合成授权/礼物状态及受控字体失败：匿名 admin 为 401、授权页为 200；字体未完成时仍进入桌面，两条进度 toast 不重叠。八次下载中故意失败一款，点击重试仅追加一次请求；八款 document.fonts.load 均成功，再启动零下载。
- 原先等待字体的 HTTP 会占用渲染连接池，已改为缺失立即返回、CSS 只发布已就绪字体；桌面状态事件/浏览器源短期本地轮询刷新样式。新样式加载前保留前一份；迟到初始状态和导航后结果不再覆盖页面。浏览器源遇到失败后停止轮询，桌面重试完成后可能需手动刷新该浏览器源。
- 字体 README、存储、HTTP、桌面生命周期/IPC、打包与前端参考、应用内字体说明已同步；交互式引导的入口和操作顺序未变。字体选择 ID、CSS family、现有礼物与授权边界保留。
- 本任务差异已按开始前副本核对，git diff --check 通过。工作区其他修改保留，无服务端修改、提交、发布或用户数据操作。隔离 Electron 已关闭。
- 临时清理命令被自动审批以 blocked by policy 拒绝，未提供更具体理由。下载样本、提取的 app.asar、隔离用户数据和验证记录继续保留在被 Git 忽略的 tmp/font-download-audit/；未换工具重试删除。

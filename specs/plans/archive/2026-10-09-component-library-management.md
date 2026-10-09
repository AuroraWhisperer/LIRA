# 本机样式库可靠性与客户端管理

Status: Completed

## 目标

落实本次审查的五项优化：索引恢复、暂存及无引用资源清理、单组件包版本管理、可操作的错类导入引导、素材/参数/布局的专用备份恢复。逐阶段验证后重新审查完整链路，修复范围内仍然存在的问题。交付 ZIP 及其中的 1.0.0 版本保持原字节；不提交、分支、打包发布或操作真实用户数据库。

## 当前证据

四个 output ZIP 在隔离库安装得到 18 款样式，约 156.7 MiB。重建库实例不会回收 pending；软删除保留全部资源。单组件包升级显示两个版本。损坏 index.json 导致读取失败，而每包 package.json 不包含后续参数修改。前端已有服务端类型拒绝文字，但无法直接前往匹配分类。场景模板只导出结构，换电脑仍需重选素材与布局。

## 所有者与兼容边界

- `src/storage/component-style-store.js`：索引事务、安装身份、软删除及配置；新增恢复/维护辅助模块仍在 storage 边界，不访问桌面和服务端。
- `src/server/component-style-library.js` 与 routes：导入校验、错误数据、维护与转移服务；沿用管理或当前 canvas capability，读取/写入前后重验权限。
- `src/storage/scene-store.js`、`src/scenes/scene-service.js`、`src/server/scene-runtime.js`、组件预览会话：提供持久场景/发布文档/当前草稿引用；所有账号的引用均保护，但不在 UI 暴露其他账号详情。
- `public/js/admin/component-style-library.js`、picker/client、场景工具栏：包级管理、维护反馈、入口跳转、备份恢复。
- 本机数据目录、包 UUID 与不可变 URL、已有场景快照、账号隔离、safeStorage、原子替换和原生 Electron 权限保持。新增的持久化格式须显式迁移，不能把旧文件视为空库。不能依靠前端传来的“未使用”判断删除。
- 不引入框架、进程或运行时依赖；复用现有 ZIP/场景合同。资源库故障不能静默重建空索引或覆盖用户素材。

## 阶段与验收

1. **索引可靠性**：保存有效恢复副本，检测缺失/损坏及不支持结构；恢复保留损坏现场，给出可读状态。故障注入覆盖首次保存、后续参数、主/副索引错误、锁定失败、安装回滚和异常中断边界。不能把导入时 package.json 当成最新参数源。
2. **库维护**：盘点安装/保留/暂存空间；自动回收过期且非活动的 pending，手动清理需显式确认并重新核对所有持久与活动引用。软删除本身不删除文件；引用或完整性检查失败时拒绝清理。清理后相同原 ZIP 可恢复，历史套装分类保持。覆盖当前与其他账号、发布与草稿、浏览器/CSS/媒体、目录链接、失败恢复及重复调用。
3. **包管理与引导**：同 packageId 的单组件包沿用套装更新规则，当前库展示一个版本，旧场景保持原资源；多变体包可整包移除。显示包名、类型、版本和成员数。错类错误返回服务端确定的目标入口；按钮切换到该入口并复用原文件，检查与安装仍以服务端为准。覆盖客户端/画布/inspector、更新失败、取消与清理、无重复请求/渲染。
4. **专用备份恢复**：从当前账号已保存的场景/预设和已发布布局导出所需素材及参数；明示未保存内容需先保存。归档排除设备授权、账号凭据和业务数据，外部浏览器源按现有模板规则脱敏。恢复前预检清单、资源引用、哈希、路径与大小；导入新场景身份并重映射包/样式/本地图片引用，不覆盖当前直播。失败可回滚或安全续作，重复导入明确处理。提供桌面/画布可用入口并验证换目录恢复。
5. **最终复审**：逐条核对本计划、接口及存储文档、用户教程和运行证据；模拟中断/重启/重复导入/更新/删除/清理/恢复后再导出，继续处理发现的范围内缺口。

## 验证与文档

逐阶段使用已有 `test/scenes/`、`test/admin/component-style-library.test.js`、`test/admin/component-source-import.test.js`、`test/desktop/woodland-style-import-electron.test.js` 与场景/预览权限夹具扩展定向行为覆盖，scratch 只使用仓库 tmp。新增存储维护及转移测试按 owner 分组，避免重测无关渲染细节。

同步 `docs/reference/backend/storage.md`、`backend/api.md`、`frontend/app.md`、`docs/guides/component-style-packages.md`、`component-sources.md`、内置 `usage-guide-obs.html` / `usage-guide-reference.html`。引导与截图有可见入口变化时同步其实际受影响内容。技术设计和存储变更决策在本计划与所属合同中记录，不复制接口事实表。

每阶段记录执行的精确命令及结果。最终运行受影响的服务/存储/场景/桌面测试、`npm run check`、`npm run verify:docs`、`npm run verify:architecture`；根据实际生命周期与数据影响决定 offline/browser 的扩大范围。整组运行期间不编辑其源码；失败归因后只先运行相关回归，不盲目重复全量。最终检查任务 diff、`git diff --check`、`git status --short`。

## 失败处理

原工作区已有许多用户改动，按任务拥有的差异增量修改。测试永不使用真实用户数据。数据恢复保留原件，清理只在完整引用检查后执行，ZIP 恢复不能覆盖已有场景或凭据。必要回退只撤销本任务变更，不使用 reset/checkout 或全目录删除。

## 完成记录

- [x] 索引可靠性及合同
- [x] 库维护及引用保护
- [x] 包管理和导入引导
- [x] 备份恢复与客户端配套
- [x] 完整复审、剩余问题修复及最终证据

## 完成决策与复审结果（2026-10-09）

- 索引继续使用 v1，新增独立恢复副本和恢复记录，不以导入时的包快照覆盖最新参数。主索引提交后的副本失败只降低恢复能力，避免将已成功的安装误判为失败并回滚文件。
- 过期暂存按 24 小时回收，活动导入和导出通过引用计数保护。未登记的正式目录保留。清理在服务器重新核对所有账号的保存/发布文档、当前预览草稿、待处理命令及可见样式依赖；其他预设仍有未保存修改而无法取得完整文档时拒绝清理。隔离删除失败可直接重试。
- 同作者 ID 的单组件包与套装均整包替换可见版本；历史资源、参数和 UUID 保留。清理后重新导入相同 ZIP 补回原目录。复审用故障注入复现此恢复路径遗漏 Windows 短暂文件占用重试，现已补齐目录移动及回滚的有限重试，并验证样式身份和已保存参数保留。
- 管理窗提供类型、版本、成员、占用及恢复状态，支持整包更新、移除、清理和备份恢复。错类引导复用原 File，切换后仍由接口重新检查。复审通过延迟检查响应复现操作交叠，现已在处理中禁用其他动作及关闭；导入窗关闭后的已完成检查会取消暂存。客户端与画布不会重复渲染或重复安装。
- 专用备份使用独立 v1 清单，流式输出 ZIP，校验路径、CRC、SHA-256、大小及本地资源引用。备份包含最新索引参数、可见/被当前账号布局引用的包、保存/发布布局和文本框图片；排除外部浏览器源、本机背景路径、未保存草稿及账号业务数据。系统字体需在新电脑安装，内置组件仍使用当前公共设置。
- 恢复采用新身份，先登记隐藏素材，再事务创建未发布场景，最后恢复可见性。稳定副本 ID 支持失败续作和重复恢复，不覆盖已有修改、场景、直播绑定或凭据。画布新增预设通过既有授权会话刷新，保留当前草稿。真实 Electron 的原生文件选择、ZIP 下载及恢复已验证。
- 本次 API、存储、前端职责文档以及用户指南、内置教程已同步。引导步骤和原有截图对应的顶级导航未因本任务改变，保留既有引导配置与截图；管理窗另有隔离 QA 截图。工作区其他任务的组件页/侧栏调整保留。

## 验证证据

- `node --test test/scenes/component-library-maintenance.test.js test/scenes/component-style-recovery.test.js test/scenes/component-library-transfer.test.js`：最终 18/18；覆盖索引恢复、提交失败、引用保护、同版本补回、Windows 锁、换目录迁移、当前账号绑定、资源损坏、重复恢复、数据库失败续作及 HTTP 权限。
- `node --test test/admin/component-style-library.test.js test/ui/ui-surface.test.js`：最终 15/15；覆盖正确/错误分类、包管理、备份恢复、处理中的操作锁、参数保留、共享对话框合同及 native confirm 禁用规则。
- `node --test test/admin/component-source-import.test.js test/admin/canvas-component-library.test.js test/admin/canvas-editing.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-output.test.js`：26/26，导入来源、画布编辑/发布及重试恢复通过。
- `node --test test/desktop/woodland-style-import-electron.test.js`：最后一次 1/1，47.2 秒；真实 Electron 正确导入、错类跳转、包管理、已使用文件保护、原生 ZIP 下载/恢复和预设刷新通过，无页面错误。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs`：语法、26 项架构检查和 10 项文档检查通过；归档后再核对文档链接和最终差异。
- `npm run test:offline`：执行一次，共 3594 项，3590 通过、4 失败。本次管理窗局部函数名触发 native confirm 静态检查，已更名并在最终 15 项界面组中复验通过。以下 3 项为工作区原有页面调整与旧断言不一致，保留用户改动，不修改无关页面或削弱断言，也未盲目重复全量运行：
  - `test/admin/toolbox-sidebar-routing.test.js` 的标题去重断言与原有 gift 页新增标题不一致。
  - `test/danmaku/admin-danmaku-markup.test.js` 的弹幕区域标题/帮助正则与原有组件页拆分不一致。
  - `test/overlays/clock-overlay.test.js` 仍断言旧百宝箱中的 `otherClockFeature`，而原有导航调整已将其移出。
- 测试使用仓库 `tmp/` 隔离数据；日志、截图和交付 ZIP 均被 Git 忽略。最终审查任务拥有的差异、`git diff --check` 和 `git status --short`，保留既有未提交内容。

## 当前交付 ZIP

仅更新交付文件名，原字节、清单 ID 与版本均未改变，避免已有同版本安装出现摘要冲突。没有运行会生成其他版本的打包脚本。

| 文件 | 清单版本 | 成员数 |
| --- | --- | --- |
| `output/套装-月渡花汀-1.0.0.zip` | 1.0.0 | 8 |
| `output/背景样式-蕾丝迷境-1.0.0.zip` | 1.0.0 | 8 |
| `output/大航海感谢样式-航海旗帜-1.0.0.zip` | 1.0.0 | 1 |
| `output/全屏礼物感谢样式-林间花信-1.0.0.zip` | 1.0.0 | 1 |

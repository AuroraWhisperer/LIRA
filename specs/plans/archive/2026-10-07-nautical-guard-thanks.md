# 航海旗帜大航海感谢接入

**Goal:** 将已取得的三档透明动画作为可在「大航海感谢」导入、选用、保存应用的正式 LIRA 样式，收到真实上舰事件后显示对应动画及观众头像、昵称。

**Architecture:** 使用现有 schemaVersion 2 资源素材包和场景感谢队列。航海旗帜属于大航海感谢组件的单款样式；跨多个组件类型的组合才称为套装。可信播放器随客户端提供，ZIP 只包含素材、清单和说明；不执行第三方网页代码。

**Tech Stack:** 现有原生 ES modules、CSS、Node.js 和 Electron。

## 约束与当前行为

- 当前 output ZIP 只有预览 HTML，没有 lira-pack.json，不能正式导入。
- 原生辉光、经典分别产生上舰事件；自定义航海旗帜在同一组件中按购买事件去重。
- 触发仍受现有上舰开关控制，不新增业务消费者、设置项或订阅。
- 保持其他样式、授权、存储路径、用户运行中的已安装客户端及既有未提交修改。
- 不修改用户直播场景；导入和保存应用由用户在客户端完成。源码修改不会自动更新已安装 EXE。

## Ownership 与兼容

- public/js/shared/component-resource-style.js：注册固定资源预设，无可切换的内置 style。
- public/js/overlays/guard-nautical-player.js 与对应 CSS：1920×1080、五秒动画、真实身份、取消与资源释放。
- public/js/overlays/gift-effects-component.js：复用 createGuardThanksQueue；只对本预设合并同一购买的原生风格事件。
- public/js/admin/component-style-library.js：在大航海感谢样式区复用原导入套装流程。
- scripts/package-guard-nautical.js、public/img/overlays/guard-nautical/：素材和可重复打包；大素材仅随套装交付。
- 合同：docs/reference/frontend/overlays.md；用户流程：docs/guides/component-style-packages.md。
- 不改变 HTTP/IPC、事件字段、数据库或既有配置键。新增已注册资源预设沿用现有资源安全校验。

## 实施与验证

- [x] 注册资源预设，生成正式 ZIP；通过 createComponentStyleLibrary 的 inspect/install 验证三档资源、配置往返与安全限制。
- [x] 接入播放器：按 tier 选择原动画，以独立 Blob URL 从头播放，1 秒后头像入场，1.2 秒后昵称入场，4–5 秒淡出。stop/dispose 立即清理图层、计时器与 Blob。
- [x] 在大航海感谢页添加导入入口，说明现有触发开关和保存应用步骤；通过隔离 Electron/现有 UI 测试路径验证导入及选择。
- [x] 使用真实格式合成事件验证三档、头像昵称、重复购买消息去重、重置取消与串行播放；不连接真实直播间。
- [x] 检查任务增量 diff、git diff --check、git status --short，将正式套装输出到 output。

命令：node --experimental-vm-modules --test test/scenes/guard-nautical-pack.test.js test/gifts/guard-nautical-player.test.js；相关现有 component-styles、scene-gift-events、canvas-gift-components 测试按接入影响执行。测试临时数据只在 tmp。

## 失败处理与完成条件

只回退本任务增量，不覆盖用户已有改动。缺素材时沿用套装准备失败提示，不播放错误等级；取消播放立即隐藏。完成以正式 ZIP 可导入、组件真实格式事件可播、客户端入口验证通过为准；不将旧 EXE 或真实直播验收标为已更新/已执行。

## 完成记录（2026-10-07）

以下首次接入记录中的「导入套装」入口已被后续用户纠正取代，现行行为见文末「样式与套装概念修正」。

- 两项新增套装/播放集成测试通过，覆盖真实导入流程、画布保存应用、三档原动画、真实格式身份、文本注入防护、双原生风格去重、同等级重启及 reset 回收 URL。
- 隔离 Electron 使用真实 preload 与桌面请求授权：大航海感谢页导入成功，点击卡片打开画布，通过桌面桥保存后 publishedVersion=1，持久化项类型 guard-thanks、preset=nautical-guard-thanks。
- 扩展命令运行 20 项，16 通过、4 失败。component-styles 的月渡花汀期望字号22而现有预设为30；本任务开始时保存的 registry 副本已为30。canvas-gift-components 的3项超时，在只读提供任务前 JS 的复核中仍然失败；未修改这些无关行为或测试。
- 新增/修改 JS 语法检查和 git diff --check 通过。增量对照保存在 tmp/nautical-guard-work/task-changes.diff，保留其他任务同期文档改动。
- 正式素材：output/航海旗帜-上舰感谢-1.0.0.zip。随后为用户实际使用生成本地安装包：output/航海旗帜客户端/lira-setup-5.1.0.exe（158569851 字节）。electron-builder 使用本地 Electron、--publish never，现有 installer 完整性钩子成功；额外只读核对 app.asar 包含播放器、CSS、预设与导入入口，大素材按预期仅随 ZIP 交付。
- 本地安装包来自当前工作区，未发布、未安装到用户现有客户端，也未改变其直播场景。真实付费上舰未触发测试。
- 本次 Electron/浏览器测试进程已关闭。自动审批以 blocked by policy 拦截含临时目录清理的命令，保留 tmp/guard-nautical-electron-OiINWf；未换工具重试删除。此前 tmp/bilibili-guard-source/profile-hWocHn 也未触碰，不包含在交付包中。

## 样式与套装概念修正（2026-10-07，已完成）

用户明确：大航海感谢是组件，航海旗帜是其中的样式；跨弹幕、开播、感谢、时钟、背景等多个组件类型组合的才是套装。旧指南把带清单 ZIP 一概称为套装、甚至将单个许愿样式命名为「许愿素材套装」，确有歧义，现已修正。

- 单组件标准 ZIP 从对应组件「更多样式 → ＋ 添加样式 → 选择 LIRA 样式包（ZIP）」添加，确认框为「确认添加样式」。大航海感谢页面移除单独的「导入套装」。所有组件复用原添加样式窗口与现有 inspect/install 接口，不改持久化格式。
- 素材包按成员的组件分类数量区分：多个同类样式仍是样式包；跨组件类型才显示在套装分类。旧包直接按这个规则展示；单样式误选套装入口、套装误选组件入口时取消本次待导入数据并指向正确入口。
- 修正组件管理、样式/套装制作指南、overlay 合同、客户端大航海感谢教程及交付说明。通用导入错误改称「素材包」或「样式资源」，保留真正套装的用语。
- 正式样式包更新为 output/航海旗帜-大航海感谢样式-1.0.1.zip，避免与已导入的 1.0.0 内容冲突。output/航海旗帜客户端/lira-setup-5.1.0.exe 已重新本地构建，未自动安装或发布。
- 6 项相关用例通过：航海旗帜包安装与全链路播放2项、组件类型分类1项、真实跨组件套装导入及画布复用2项、HTML/CSS原导入流程1项。并发检查中旧时钟复用用例曾超时、HTML/CSS用例曾遇到草稿同步时序错误；前者任务前代码复核通过，两者独立重跑当前代码均通过，未改动这些不相关测试行为。
- 隔离 Electron 的真实 preload/桌面授权环境中，通过「＋ 添加样式」文件选择器添加新 ZIP 成功；页面只出现样式卡片与添加样式入口，无导入套装按钮。进程与本次隔离数据已清理，先前被拒绝清理的目录保持不动。截图与只读打包核对在 tmp/guard-style-correction/。

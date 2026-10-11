# Color Alpha Implementation Plan

Status: Completed

## Goal

所有公共颜色控件提供 RGB 与不透明度编辑，读取当前/默认透明度，保存、重开和直播渲染保留用户选择。

## Non-goals

不改变整体不透明度、主题默认像素、认证或桌面权限；不提交或发布。

## Current Behavior

`shared/color-control.js` 包装原生颜色输入。当前 Chromium 的 `alpha` 属性未实现，八位色值被原生输入截断。背景、阴影等另有不透明度字段，其他颜色一般为六位 HEX。现有公共控件测试覆盖事件、动态插入、克隆和重置。

## Ownership

- 控件与颜色转换：`public/js/shared/color-control.js`、`color-picker.js`、`color-value.js`，`public/css/components/color-control.css`。
- 不透明度关联由静态表单与生成参数的 owner 标注；现有字段继续保存。
- 六/八位 HEX 的校验与渲染由现有时钟、互动、弹幕、文本框、场景、播放器 owner 扩展。
- 契约：`docs/reference/frontend/pages.md`、`overlays.md`、`docs/reference/backend/api.md`；操作指南：`docs/guides/component-sources.md` 和应用内场景编辑指南。
- 云端弹幕：相邻 LIRA Server 仓库的 `src/lib/overlay-style-options.js`、`public/overlay/style-options.js` 及两个 OpenAPI 文档同步接受六/八位颜色；本任务只修改本地源码，不部署。
- 验证：公共控件、场景/颜色契约与相关 renderer 测试；复用隔离 Electron fixture 检查真实控件。

## Compatibility Constraints

保留输入节点、ID、原生事件和六位纯色格式。已有独立不透明度存储键继续使用，不进行数据迁移；仅独立颜色在需要半透明时保存八位 HEX。保留全部无关工作区修改。调色强度与整体透明度不是颜色 Alpha，不任意合并。

## Proposed Changes

1. 增加无 DOM 颜色转换与公共选色弹层，含 RGB、HEX、不透明度滑条/数字输入、键盘关闭和实时色块预览。
2. 公共包装读取/写入完整色值；独立透明度通过声明关联使用原字段。隐藏被合并的旧控制行，克隆、动态渲染、程序赋值和重置仍同步。
3. 扩展相关颜色边界接收六/八位 HEX，修复转换截断 Alpha，确保全透明不会回退默认值。
4. 补齐控件与保存/渲染回归，更新对应参考和使用指南。

## Milestones

- [x] 公共控件与旧字段关联；验证 RGB、0/35/100%、程序赋值、重置、克隆、事件次数。
- [x] 保存与渲染；验证新/旧配置 round trip 与不同颜色消费者。
- [x] 隔离 Electron 界面与文档；最终 diff 审阅。

## Verification

`node --experimental-vm-modules --test test/ui/frontend-color-control.test.js`；按改动扩展直接相关契约测试；`npm run check`、`npm run verify:architecture`、`npm run verify:docs`；隔离 Electron 实测弹层及保存重开；`git diff --check` 和 `git status --short`。

## Completion Evidence And Limits

- 公共控件最终 6 项通过；与场景、样式参数和背景渲染合跑的 27 项通过，见 `tmp/color-alpha-final-bindings.log`。原 UI 新增用例因默认启用主题跟随导致颜色隐藏，已将夹具切换到自定义主题并复验。
- 颜色控件、overlay helpers、时钟、许愿与播放器的定向 41 项通过，见 `tmp/color-alpha-checks.log`。文本编辑器 14 项通过，见 `tmp/color-alpha-final-ui.log`；该日志中的生成参数失败随后已修复并通过上述 6 项复验。
- 客户端语法检查通过 1444 文件。相关技术契约和内置/Markdown 使用说明已同步；新手引导入口和步骤不变，无须新增引导步骤。
- 隔离 Electron 使用既有 `danmaku-canvas-editor.cjs` 的真实 preload、管理授权和保存 IPC；35% 保存为 `#eaf2ff59`，重开回显 35%。最终截图位于 `tmp/color-alpha-picker.png`。测试会话长期停留后授权过期，使用夹具既有续期方法恢复后复验；已关闭自有进程并清理隔离数据。
- LIRA Server 的颜色校验相关 22 项及后续协议、文档、持久化相关 52 项通过。使用仓库认可的 Node 24.15.0；线上弹幕需同步部署这些服务端改动，本任务未部署。
- 全局架构门禁仍有两项与本任务无关的失败：`admin/gifts/blindbox-analysis.js` 的未绑定 `Option`，以及 `admin/fans/index.js` 的空 catch。额外桌面共享样式测试停在已被其他工作区改动移除的「调整样式：配套歌词」入口（`component-style-client.js` 已移除该挂载项）；未修改这些无关行为或放宽断言。
- 保留所有既有工作区改动；未提交、未发布，未运行仓库全套测试。

## Rollback Or Failure Handling

只逆转本任务补丁，保留已有工作区改动；测试仅使用仓库 tmp 及既有隔离 fixture，不访问用户运行数据。

## Done When

当前/默认不透明度显示正确，用户调整后保存和渲染一致，无双重 Alpha、重复控件或额外事件；相关测试和文档同步，最终 diff 已审阅。

# 手账风客户端接入 Implementation Plan

**Status:** Completed — 2026-10-27；客户端接入及隔离验收完成，未打包或部署远程服务器。

> **For agentic workers:** 在当前工作区顺序实施；保留所有既有用户改动，不提交、不分支、不发布。根 AGENTS.md 与 PLANS.md 的风险、测试及目录要求优先于技能默认流程。

**Goal:** 将用户已选定的兔宝《手账风》（BV1Aw3V6zExv）从 tmp 复刻加入客户端固定弹幕样式选择、画布和浏览器源，使用真实消息字段及 B 站表情图片。用户在 2026-10-26 明确将后续工作改为客户端接入。

**Architecture:** 新增 `notebook` 样式及专属消息适配器、CSS 和静态装饰。消息正文、表情 URL 解析、安全文本、队列、测量、移动、淘汰和清理由现有 renderer/feed 拥有；不改服务器来源的 renderer core。

**Tech Stack:** 既有 Vanilla ESM、CSS、Electron、Node.js、node:test 与 Playwright；不增加依赖。

## 当前行为与边界

tmp 样例在 `tmp/notebook-chat-replica/`，33 个原片状态、8 组样例与完整 43–1074 帧播放已有证据。实测图层包括头像先入、纸张延迟、昵称和正文分层显现、最新纸张浮动以及头像持续摆动/缩放。表情是消息内容图片，没有样式附加动画。参考视频有压缩、遮挡和字形细节误差，不能把 tmp 截图、样例文字、逐帧坐标或表情裁图作为真实消息实现。

正式 renderer 由 `public/js/overlays/danmaku-message-renderer.js` 适配；`danmaku-renderer-core.js` 是有来源清单的共用核心。样式参数和画布区域分别在 public/src 两份共享模块中维护。两个 HTML 入口拥有客户端和独立预览的样式按钮。

## 兼容约束

- 只增加 `notebook` 枚举及可补齐的区域，已有样式、设置值、URL、IPC、认证及持久化结构保持兼容。
- 继续使用真实 `name/message/avatarUrl/emotes`、当前房间身份及礼物购买身份；不能把示例昵称、TV 头像或静态表情写死为消息内容。
- 大航海开通按照 `giftGuardLevel`，聊天身份按当前房间字段，不能把其他直播间等级当作当前权限。
- 表情沿用现有解析和 URL resolver；样式不为表情增加 CSS/JS 动画。
- 列表控制仍由 feed 拥有。最新纸张的浮动使用样式层及 DOM 新旧顺序暂停；头像的持续动作独立。
- 系统减少动态效果时直接完整显示并停用循环；快照不重播入场。
- 正常客户端 UI 必须在隔离 Electron fixture 验证；浏览器源另外验证。不得重启用户 LIRA 或使用真实用户数据。

## Task 1: 样式注册与兼容

**Files:** `public/js/shared/danmaku-style-options.js`、`src/shared/danmaku-style-options.js`、两份 `danmaku-layout.js`、两份 `component-style-parameters.js`、两个 danmaku HTML 入口。

新增参数入口：

```js
notebook: {
  scrollDirection: true, defaultEdgeFade: 'none', label: '手账风',
  minFontSize: 18, maxFontSize: 48, defaultFontSize: 23,
  background: false, giftImage: false, defaultTextColor: '#3e3e3d',
},
```

- [x] 新增固定样式卡片及区域默认值；旧 layout 缺失 notebook 区域时使用现有补齐机制。
- [x] 注册 `panel` 外观能力，保留客户端既有字号、文字颜色及滚动方向流程。
- [x] 扩展现有 options/layout/markup 用例，确认前后端镜像与旧配置兼容。

## Task 2: 真实消息渲染与原片图层

**Create:** `public/js/overlays/danmaku-notebook.js`、`public/css/overlays/danmaku/notebook.css`、`public/img/overlays/danmaku-notebook/` 及样式缩略图。

**Modify:** `public/js/overlays/danmaku-message-renderer.js`、`public/css/overlays/danmaku.css`。

适配接口：

```js
export function createNotebookMessageRenderer(options, render) {
  // Returns the existing renderer contract: (item = {}, index = 0) => HTMLElement.
}
// Desktop adapter routing, before its existing specialized adapters:
if (options.style === 'notebook') return createNotebookMessageRenderer(options, render);
```

- [x] 从共用 renderer 取得安全正文/表情与消息字段，再组合本款头像、纸张、胶带、折角、标题和正文图层。
- [x] 普通、舰长、提督、总督保留对应色调；头像替换为真实头像，装饰素材不能覆盖成固定 TV 内容。
- [x] 普通礼物使用薄荷色抬头和金额，上舰使用购买等级；SC 保留现有字段和完整正文，使用本款纸张语言，不编造原片不存在的动画。
- [x] 只迁移独立装饰素材并记录来源；不迁移视频、逐帧坐标、示例表情或分析字体。
- [x] CSS 拥有分层入场、旧纸张暂停、独立头像循环和减少动态效果；移动参数由现有 feed 消费，不增加样式名称分支或每消息 JS 循环。
- [x] 实际生产 renderer 生成缩略图。

## Task 3: 验证与同步

**Tests:** 扩展 `test/danmaku/danmaku-message-renderer.test.js` 的真实字段、表情 resolver、房间身份、礼物/开通与字面文本用例；扩展现有 feed-motion 行为与 style-ownership 导入覆盖。新增 `test/desktop/danmaku-notebook-electron.test.js`，复用 `test/fixtures/danmaku-canvas-editor.cjs` 和既有 launch helper。

- [x] 运行聚焦回归：

```powershell
node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/admin-danmaku-markup.test.js test/danmaku/danmaku-feed-motion.test.js
node --test test/desktop/danmaku-notebook-electron.test.js
```

- [x] 真实播放第一条、连续/密集、长文本、B 站表情字段、礼物、开通和 SC；检查缩放、上下滚动、文字稳定、减少动态效果与销毁。
- [x] 隔离 Electron 中选择、应用、重开、画布与独立预览共用 notebook；确认图片/预览不是普通浏览器冒充桌面集成。
- [x] 更新 `docs/reference/frontend/overlays.md`、`danmaku-motion.md`、`docs/guides/component-style-parameters.md`（有参数影响时）、相关内置使用指南；无需变更的类别记录理由。
- [x] 运行 `npm run verify:docs`、直接涉及的语法检查、`git diff --check`，检查最终任务增量和状态。

## 回退与完成条件

任务开始前将计划触及文件的当前内容保存在 `tmp/notebook-client-integration/baseline/`，用于区分 418 项既有用户改动。回退只逆转任务增量，禁止 blanket checkout/reset。所有 QA 数据留在 tmp。

只有样式在客户端可选择/应用、真实消息与静态表情正确显示、实际动态及隔离桌面验收通过、兼容测试和文档同步完成、最终增量经过审查，才算客户端接入完成。不构建或发布安装包，除非用户另行要求。

## 验证结果（2026-10-27）

- 参数、旧布局、选择器、消息/当前房间身份、表情与预览数据：68/68，通过。
- feed-motion：45/45，通过；包含本款旧纸张暂停、头像独立继续、静态表情、礼物头像尺寸、长昵称不省略、减少动态效果，以及各固定样式上下移动回归。
- 隔离 Electron：1/1，通过；实际选择、字号 23→24、应用/重开、画布 24→26、保存回桌面、真实头像及隐藏旧标题栏。fixture 独立数据路径/端口，验收实例关闭并清理。
- 文档门禁：10/10，通过；变更 JS 语法检查、任务增量审阅与 git diff --check 通过。
- 源码、动作、默认值、用户指南与样式卡已同步。通用导览及导航截图不列举全部样式，既有入口仍正确，未改写。
- 证据：tmp/notebook-client-integration/ 下的 final-focused-check.txt、motion-check.txt、desktop-check.txt、docs-check.txt、electron-canvas-preview.png、task-increment.diff。
- 共享目录的花与信笺并行变动保留。pre-edit/ 记录共同文件在本任务首次实际编辑前的状态；baseline/ 保留更早状态，不能以整文件还原覆盖其他人的后续改动。
- 本次只交付客户端源码及本地场景渲染。安装版没有重新打包，远程服务器的在线独立弹幕源没有同步部署；没有连接真实直播间作实播测试。

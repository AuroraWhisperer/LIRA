# 新增弹幕样式的服务端一致性 Implementation Plan

Status: Superseded

2026-10-28：用户确认服务器事件 → 客户端外观 → 本机场景输出，原强制镜像方向由[本地外观计划](2026-10-28-local-danmaku-appearance.md)取代。下文保留当时的排查证据，不再作为实施指令；已有服务器兼容样式保留，跨仓镜像脚本退出维护。

**Goal:** 在线弹幕源完整支持 ripploid、notebook、spooky、twitter、flower-letter，客户端保存新版参数与画布后可读回并实际渲染。

**Architecture:** 延续服务端拥有配置、认证边界确定租户、共享 feed 拥有消息生命周期的现有架构。展示合同与五款独立装饰模块沿用客户端实现；服务端适配资源地址和系统消息策略，不改已固定的 renderer core。新增跨仓维护检查，禁止仅凭本地预览宣告在线功能完成。

**Tech Stack:** 现有 CommonJS、原生 ESM/CSS、Node test、Playwright；不新增运行时依赖。

## 当前证据与约束

- 五款保存均复现 `INVALID_OVERLAY_STYLE`；客户端 `createLayout()` 被服务器拒绝为 `INVALID_OVERLAY_LAYOUT`。
- 服务器样式列表、参数合同、区域、渲染入口与资源未同步；旧规范明确尚未支持，用户现已要求补齐。
- 保留两仓全部已有未提交修改，尤其服务器 protocol/OpenAPI/requirements 的无关修改。
- 不改认证、租户选择、端点路径、旧设置键、旧字段语义、事件存储及撤回行为；未知字段仍原子拒绝。
- 不提交、推送、部署或操作用户运行实例。验证使用现有隔离环境及 tmp/。

## 所有者与修改边界

- Live：`src/shared/danmaku-style-options.js`、`danmaku-layout.js`、`component-style-parameters.js` 及浏览器镜像为已实现的展示合同；`public/js/overlays/danmaku-*.js` 和对应 CSS/素材为五款实现。
- Server：`src/modules/streamer/overlay-settings.js` 负责保存；`src/lib/overlay-*.js` 与 `component-style-parameters.js` 校验；`public/overlay/` 负责输出，不复制客户端授权或本地资料请求。
- 合同：Server `public-overlay-api.md`、三份 OpenAPI、REQ-BILI-006 / AC-BILI-005；Live `overlays.md`、使用指南和工程工作流。
- 验证：现有 settings-routes/service、layout、style-options/parameters、protocol、preview、static、浏览器测试；新增跨端合同/资源检查和五款真实浏览器回归。

## 实施与验证

- [ ] 补齐保存合同：从现有客户端镜像同步新增样式/字段/区域；服务端样式允许列表取自同一合同；更新三份 schema。扩展现有设置/路由测试验证每款提交、读回、所属租户一次事件、旧布局补齐和非法输入原子拒绝。
- [ ] 接入渲染：复用五款装饰模块、SC 分支、CSS/字体/素材；接入外框和仿推特资料区；保持服务端安全 URL 与即时入场策略。浏览器回归覆盖普通弹幕/礼物/上舰/SC、同样式参数热更新、撤回和资源无 404。
- [ ] 防止复发：新增维护脚本核对两仓展示合同和受控展示源文件；服务端合同测试对照允许列表、参数与 schema，客户端交付规范要求同步所有消费者，并把对应命令纳入验证入口。
- [ ] 同步协议、需求、验收和用户说明，撤销“只完成客户端”的过期描述，区分源码完成与线上已部署。
- [ ] 运行直接相关 Node/浏览器、两仓文档、必要静态/架构检查；最终审阅 diff、`git diff --check`、status，无生成物/秘密进入差异。

## 验证命令

- Live：`node --experimental-vm-modules --test test/danmaku/server-danmaku-settings.test.js test/danmaku/danmaku-overlay-ipc.test.js`，新增一致性脚本测试及检查，`npm run verify:docs`。
- Server：用 `npm run verify -- --plan` 明确选择受影响的完整 Node 文件与浏览器文件，再运行相同范围；`npm run docs:check`。
- 运行失败先定位并用针对性检查修复；不反复跑全量，不在检查期间改写被测文件。

## 完成标准与失败处理

五款经认证 Device 保存后读回不丢字段、公开源按同一配置显示完整内容，旧样式/布局保持兼容，新增漂移能被自动检查捕获，规范与操作说明准确。代码和隔离验收完成不代表生产部署；最终明确这项限制。

失败时保留用户工作与证据，仅修正本任务修改；不放宽服务器校验、不丢弃未知配置、不以显示默认样式掩盖失败。

## 结果

实施中。

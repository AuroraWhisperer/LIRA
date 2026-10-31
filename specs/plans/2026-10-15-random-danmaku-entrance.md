# 随机弹幕可选入场动画

**Status:** Awaiting Verification

## Goal

青雾、杏花白头像放大 15%，流光溢彩昵称放大 30%。白描、流光溢彩、点点流萤新增可保存的入场动画选择：动画 1 保持现有渐显；动画 2 在 500ms 内同时完成卡片/昵称上浮和整段正文从左侧轻微回弹，正文距离随宽度变化。用户已确认整段滑入。

## Ownership and current behavior

- 两端 `danmaku-style-options` 负责逐样式原子校验与默认值；`entranceAnimation` 仅接受三款样式的 `fade` / `rise`，省略及恢复默认使用 `fade`。
- 客户端 `danmaku-parameter-view.js` 与 `danmaku-preview-appearance.js` 负责客户端和画布控件，沿用草稿、应用与旧服务器能力检查。
- Server `public/overlay/danmaku-renderer-core.js` 是共享消息结构的源；需要的正文内层通过现有同步脚本导入客户端并更新摘要。主题入场 CSS 负责动画，不修改随机位置、存活计时、淘汰、缩放和退出机制。
- 参考拥有者：`docs/reference/frontend/overlays.md`、Server `docs/protocol/public-overlay-api.md` 与三份 OpenAPI；用户指导为组件参数指南及应用内弹幕说明。

## Boundaries and compatibility

不新增依赖、计时器、服务、订阅或凭据。不改变消息载荷、URL、租户隔离及现有布局；旧配置不含新字段时保持当前动画。新选项按消息创建时锁定，改参数不重播已有消息。减少动态效果时不做位移；异常/缺图仍保留原有文本处理。保留全部既有未提交改动，不提交或部署。

## Milestones and verification

- [x] 尺寸调整：仅改拥有样式；测量普通与礼物/SC 中现有头像及昵称，无头像的结构不新增头像。
- [x] 参数与两个 UI：三款显示选择器，其他样式隐藏；验证默认、合法/非法枚举、逐样式保存/恢复、预览与应用传递。运行相关 style-options、panel-edit-state、local-preview、server-danmaku-settings 及 Server overlay-protocol-contract 检查。
- [x] 入场：500ms 同时完成上浮与横向轻回弹，无文字缩放；短长正文、换行、表情、礼物、密集到达、缩小画布与减少动态效果通过浏览器实际播放。确认既有停留/过期与位置稳定。复用 renderer 和随机弹幕浏览器测试；共享核心同步检查通过。
- [ ] 技术说明、参数指南、应用内说明和三份 OpenAPI 已同步；最终差异审阅和两仓 `git diff --check` 通过。2026-10-28 两仓文档门禁已复验通过，原外部阻断已消失；真实环境验收仍按下列边界保留。

Server 使用 `npm run verify -- --plan` 显式选择相关完整测试文件后再执行；失败先聚焦诊断，保持成功的其它文件证据。客户端运行对应 Node 测试和持久浏览器验收。没有真实 OBS/直播姬/第二台电脑运行证据时不作此承诺。

## Failure handling and done when

只撤销本任务拥有的差异，保留旧参数默认值和现有动画 1。上述行为、参数持久化、双端 UI、协议及聚焦验证完成后关闭计划，完成记录留在归档索引；不会因测试通过自动发布。

## Verification evidence — 2026-10-15

- 客户端 8 个直接相关测试文件共 80 项通过，覆盖参数、编辑草稿、预览、消息结构、CSS 归属、字号和固定来源摘要。Server 3 个 Node 文件共 34 项通过，9 个浏览器文件共 100 项通过；无断言失败。
- 复用隔离 Electron fixture（内存 SQLite、独立 userData/sessionData、随机端口）验证客户端选择/保存/重载、画布保存同步回客户端、逐款选择/恢复默认，以及画布真实下拉菜单；没有使用真实用户数据。旧画布在客户端重载后连接失效，关闭旧页再从客户端建立新会话后继续验收。
- 实际 Chromium 播放中，两段动画均为 500ms、无延迟；三款的短文、长文、表情和礼物在动画 1/2 完成后宽高与内容完全一致。600×440 区域、18 条密集追加、减少动态效果及三款 2 秒停留后移除通过。青雾现有头像测得 43.125px；杏花白头像约 55.2px；流光溢彩普通/礼物昵称分别为 26px/19.5px。
- Impeccable 定向检测通过；共享核心同步核验通过。QA 图片保留在仓库忽略目录 `tmp/random-entrance-review/`，不进入产品资源。
- Server 验证脚本曾在用例通过后检测到并行任务修改输入，拒绝记录成功缓存；此结果不等同于整仓 gate 通过。`npm run docs:check` 为 55 通过、1 失败：外部两份盲盒 ADR 同时使用 `ADR-0102`（`0102-blind-box-background-playback.md` 与 `0102-bozai-pool-and-maritime-retirement.md`）。未修改这些不属于弹幕任务的文件。
- 客户端 `npm run verify:docs` 为 9 通过、1 失败：并行任务的 `2026-10-13-doubao-conversation-isolation.md` 状态与计划索引不一致。本计划及本轮文档链接检查通过；未改动其他计划的状态或历史证据。
- 未打包、部署或验证真实 OBS/哔哩哔哩直播姬；在线源需要部署相应服务端版本。

# 机器人入场欢迎的弹幕姬显示

Status: Completed

## 目标与边界

将现有「显示进房消息」改为「显示机器人欢迎弹幕」。欢迎机器人照常按服务器设置向 B 站发送；本机弹幕姬只在当前样式开关开启时展示该欢迎的真实回流。首次欢迎、定制欢迎、重逢欢迎和二次问候共用此规则。普通聊天（包括观众手打的欢迎）、其他机器人回复、礼物和 SC 保持现有规则。不再在本机弹幕姬展示原始 entry 提示。

## 当前行为与归属

- Server `src/modules/danmaku/welcome-service.js` 通过共享 `send-runtime.js` 发送，RoomMonitor 将 B 站 DANMU_MSG 发布为普通 danmaku，尚无欢迎来源标记。
- Live `src/electron/scene-cloud-controller.js` 校验 SSE；`src/scenes/cloud-display-buffer.js` 投影公开字段；`public/js/overlays/scene-danmaku-display.js` 按样式参数过滤。
- 参数控件由 `public/js/shared/component-style-parameter-view.js` 拥有，正式输出、场景和 BLC/blivechat 导入样式共用展示逻辑，预览有独立模拟消息。
- 契约 owner：Server `docs/protocol/public-overlay-api.md`、对应 OpenAPI 与 fixture；欢迎需求及验收；Live `docs/reference/frontend/overlays.md`、`docs/guides/component-style-parameters.md` 和应用内欢迎指南。

## 决策与兼容

- 保留持久化键 `showEntryMessages` 和按样式保存范围，明确更新其语义；依用户后续要求默认开启，缺少设置时显示，明确保存的 false 仍隐藏，恢复当前样式效果后重新开启；不新增设置或改变发送开关。
- 给真实回流的 danmaku 增加可选布尔字段 `isWelcome`。由实际欢迎发送任务在请求开始前登记，按租户、房间、发送账号 UID、完整正文和短暂有效期消费一次，处理先收到回流后收到 HTTP 结果的顺序。明确失败删除记录；未知发送结果保留到期，因为上游回流是实际交付证据。来源终止后失效，内存有界，不持久化，不公开 UID/凭据。
- 不按昵称或「欢迎」关键词过滤，不合成正式欢迎消息。旧事件没有标记时继续作为普通弹幕；旧服务端需更新后才能识别欢迎。
- 保留 Server 原 entry 交付及旧在线源的兼容行为；本次改变本机弹幕姬，不扩展旧在线源实现。
- 两仓已有用户修改保持；不提交、推送、部署或构建安装包，不访问真实账号和直播间。

## 实施与验证

1. [x] Server 在共享发送运行时登记欢迎实际尝试，RoomMonitor 标注真实回流；增加有界识别与回流集成测试，验证账号/租户/房间隔离、顺序、失败和来源失效。
2. [x] Live 校验和缓存保留标记；共同展示层只过滤机器人欢迎，忽略原 entry；更新控件和预览。覆盖开关两态、普通欢迎文字、其他消息、动态切换与导入样式。
3. [x] 同步双方契约、需求/验收及用户说明，完成相关验证和差异检查。

计划命令：Live `node --experimental-vm-modules --test test/danmaku/danmaku-entry-display.test.js test/danmaku/danmaku-local-preview.test.js test/scenes/scene-cloud-controller.test.js test/scenes/scene-display.test.js test/scenes/component-style-parameters.test.js`、`npm run verify:docs`；Server 使用仓库 Node 入口运行欢迎回流、RoomMonitor overlay、欢迎发送、公开 SSE 与协议测试，及 `npm run docs:check`。依据实际新增测试补全文件名，不运行无关全量测试。

## 失败处理与完成条件

仅撤回本任务拥有的改动，保留其他工作，不使用 reset 或 blanket checkout。相关自动化、文档和 diff 检查通过，确认不会因开关改变 B 站发送、不会误隐藏普通聊天、不会重复生成欢迎后完成源码交付。服务器部署和真实 B 站/直播软件验收单独说明，不能由模拟测试宣称已完成。

## 验证证据与交付限制

- Live：计划列出的五份 Node/VM 测试，加 `test/desktop/danmaku-canvas-electron.test.js`，共 108 项通过，0 失败/跳过；包括两个隔离 Electron 流程（真实 preload/IPC、逐样式保存、发布、重开与重置），夹具自行关闭进程并移除自己的临时目录。日志位于被忽略的 `tmp/welcome-visibility/client-tests.log`。
- Server：`welcome-echoes`、`welcome-service`、`welcome-stages`、`overlay-entry`、`room-monitor-overlay` 五份测试 47 项通过；`overlay-protocol-contract` 与 `overlay-public-sse` 30 项通过，0 失败/跳过。
- Server `npm run docs:check` 59 项通过。Live 文档门禁在归档后运行，当前实现参考、用户指南及应用内操作说明均已同步；交互式引导未描述此开关，不需修改。
- 修改的 12 份 Live、6 份 Server JavaScript 文件语法检查通过。RoomMonitor 继续保留上游事件解析与发布的单一职责，本次仅注入欢迎回流识别；短暂匹配记录归属独立小模块，没有按行数拆分现有 monitor。
- 两仓未提交、推送、部署或构建安装包；未进行真实 B 站及直播软件推流验收。旧服务端未提供 `isWelcome` 时保留普通弹幕显示，须配套更新后获得欢迎隐藏能力。
- 后续默认开启调整：未配置及恢复默认时显示，显式 false 保持关闭；26 项相关测试（含两个隔离 Electron 流程）通过，覆盖默认勾选、手动关闭保存及重开、恢复默认、预览与两种导入 CSS 引擎。Live 文档门禁 10 项、Server 文档门禁 59 项通过；七份调整的 JavaScript 语法检查通过。日志为 `tmp/welcome-visibility/default-on-tests.log`。

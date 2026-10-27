# RIPPLOID 官方演示还原实施计划

**Status:** Completed

**Goal:** 对照 BV1UBpieAEhw 的 72 秒至片尾和用户三张截图，修正正文横线、还原礼物票券，并核对现有聊天、进房、礼物、大航海、SC 的分层动效。

**Architecture:** 保持现有客户端渲染适配器与公共 feed；图形、排版和时间轴只在 RIPPLOID owner 内调整。浏览器源是本次验证目标，不启动或重启用户 Electron 应用。

**Tech Stack:** 原生 ES modules、CSS/SVG、现有 node:test / Playwright 夹具。

## 边界与兼容

- 用户已确认不新增红包、天选；不改消息来源、HTTP/WS/IPC、持久化键或公共 feed 的列表机制。
- 保留现有未提交工作，尤其 `spooky.css` 和动效测试中既有幽灵便笺变更。
- 不复制演示昵称、金额或头像作为真实业务数据；普通聊天仍只显示当前房间真实粉丝牌和大航海徽标。
- 临时提帧、脚本、播放录制和截图均在 `tmp/ripploid-reference-correction/`。
- Edge 未接入浏览器工具，无法访问其登录会话；当前官方视频副本为 852×480 / 30fps，礼物细节另由用户高清截图约束。

## 当前证据与 owner

- 原片 `tmp/ripploid-rebuild/reference/source.mp4`，编号与用户官方链接一致，时长 104.8 秒；72 秒至片尾共提取 984 帧。
- `public/js/overlays/danmaku-ripploid.js`：聊天身份、礼物票券、大航海、SC 图形。
- `public/css/overlays/danmaku/ripploid.css`：上述排版、字体与分层关键帧；接入前正文叠深色描边，礼物框裁切外侧箭头，票券细节与参考不同。
- `public/js/overlays/danmaku-message-renderer.js`：本机消息适配和进房提示接入。
- `docs/reference/frontend/danmaku-motion.md` 拥有逐款动效契约；`overlays.md` 拥有展示行为与字段。
- `test/danmaku/danmaku-message-renderer.test.js` 和 `danmaku-feed-motion.test.js` 已覆盖字段、四类卡片、完整时间轴和非整数缩放末帧交接，优先扩展这些用例。

## 实施与验收

- [x] 提取完整参考帧，确认保留已有消息类型。
- [x] 逐帧记录聊天/进房/礼物/上舰/SC 的可见层、起止时间和稳定排版，保存对照图；核对描边与实际字体回退，不把临时解码状态误认为源视频内容。
- [x] 在 owning CSS/SVG 中修正正文与票券：完整笔画、名称框和双箭头、金额、渐变票面、签名区、条码与小图标；现有金额/昵称字段保持原意。
- [x] 按参考修正有偏差的分层顺序和时间；公共列表移动、动画中追加与 reduced-motion 继续走现有 feed。
- [x] 扩展已有相关测试，更新 owning 技术说明。样式修正不改变操作入口，用户指南仅检查影响。

## 验证

- `node --experimental-vm-modules --test --test-name-pattern=RIPPLOID test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-feed-motion.test.js`：字段、构图与时间轴回归通过。
- `npm run verify:docs`：当前 Markdown 和导航有效。
- 对改动 JS 执行 `node --check`，运行 impeccable detector 一次。
- 真实浏览器播放四类事件与进房提示，对照逐帧接触表；检查长正文/长礼物名和动画未结束时密集追加、非整数画布缩放、减少动态效果。
- 末次编辑后检查 touched diff、`git diff --check` 和 `git status --short`。

## 失败处理与 Done When

若参考不足，明确记录无法验证的细节；不编造高清或原作者参数。回退时只逆向本任务 patch，不覆盖用户改动。完成条件为横线根因修正、礼物及已有类型的视觉和动效对照通过、聚焦检查通过、技术说明同步、最终 diff 无运行数据或秘密。没有真实直播或高清逐像素证据时不宣称已完成这些验收。

## 完成证据（2026-10-27，未提交工作区）

- 官方片尾 984 帧以 `requestVideoFrameCallback` 校验真实呈现时间，最大时间误差 0.334ms；五类消息另保存 209 张运行时序帧，橙色横向移动、签名、徽章、头像与 SC 撕纸分别对照。SC 标题使用每卡独立的纸面遮罩，避免同时出现时互相引用。
- RIPPLOID 聚焦测试 8/8，文档门禁 10/10，三份变更 JS 的 `node --check` 和 `git diff --check` 通过。测试中的既有幽灵便笺变更与并行点歌工作保留。
- 隔离浏览器录制 13 条混合消息，覆盖两张 SC 同时入场、动画中追加及密集长正文；运行错误、末尾 live entry 与动画残留均为 0。五类消息的减少动态效果检查均为 0 动画；长礼物名横向溢出为 0，事件区与票券同高。
- 效果图 `tmp/ripploid-reference-correction/result.png`、录制 `runtime-playback.webm`、逐帧清单、对照图与 QA JSON 均留在同一临时目录，未进入版本控制。机械设计检查的 6 个字体、强调边线和网格提示均属于用户指定参考的构成，保留。
- 技术说明已同步；使用指南、应用内教程和引导不修改，因入口、配置键及操作步骤未改变。没有打包、提交、部署或访问真实直播事件。
- Edge 未接入，参考为 480p 原片与用户截图，不能宣称高清逐像素一致。末次原场景复查时 `127.0.0.1:3000/c` 已拒绝连接，浏览器工具同时拦截了错误页跳转；本次可确认的是隔离浏览器源播放结果，不是该已断开的原场景或真实 OBS／直播姬实播。

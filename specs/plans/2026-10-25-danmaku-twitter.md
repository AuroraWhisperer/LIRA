# 仿推特 3.0 弹幕样式实施计划

**Status:** Awaiting Verification

## 2026-10-27 视频复刻校正

用户否定现有外观，要求以同一视频逐帧校正，并明确要求弥补原视频表情裁切的问题。此前的聚焦测试与合成播放只证明功能可用，不代表视觉验收。

- [x] 以本地 `BV1fr421c7t4` 原片（852×480、30fps）重新测量资料头、标签、帖子、操作图标与事件卡；证据放在 `tmp/twitter-reference-refit/`。
- [x] 在原有 Twitter decorator/CSS 中校正几何、礼物/SC 色块与大航海阶梯；列表约 100ms 完成位移，骨架保持至约 400ms，操作约 330ms 起逐个上浮，爱心约 830ms 起完成圆点、圆环与粒子。保留实际身份颜色，不伪造互动数据。
- [x] 表情保持完整比例，宽图约束到正文可用宽度，多个表情可换行，帖子随内容增长；操作行始终位于内容下方。
- [x] 用正式 renderer/feed 实际播放并以 30fps 时间点检查稳定帧和过渡帧，覆盖密集追加、长文/宽表情、四类消息、快照与减少动态效果。扩展已有 renderer/motion 覆盖，同步 owning reference 和用户说明，执行聚焦检查及最终 diff 审阅。

本轮仅改客户端视觉与对应测试/说明，复用共享布局机制，不改消息协议、持久化设置或其他样式，不提交或发布。

本轮结果：保存 39 帧正式 renderer/feed 的 30fps 入场序列，逐帧对照原片 21.1–22.4 秒，原片第 1/3、2/3 位移分别为总位移的 38.75%、77.5%，当前对应采样误差小于 0.1 个逻辑像素。正式 `/danmaku?preview=1&style=twitter` 连续播放已观察聊天、礼物、大航海、SC 四类消息，房主为合成资料，无脚本错误及横向溢出。宽图、高图、九张重复表情和混排均保留完整比例，图片解码不改变帖子高度；0.925 倍缩放及边缘遮罩下入场末帧与稳定文字像素一致。聚焦 renderer/ownership/preview/profile 49/49、Twitter 动效 5/5、文档门禁 10/10 与 JS 语法检查通过。技术参考、参数指南、应用内说明和缩略图已同步；README 与交互式引导未改变，因为入口、操作和参数未变。旧计划中的真实上游及直播软件验收仍未执行，不以本次合成播放替代。

## 底部提示文字参数（2026-10-27）

将原底部装饰文案改为默认「欢迎来到直播间 ✨」，在仿推特样式中增加可选 `styleOptions.twitter.composerText`，由现有 Node/浏览器参数合同统一校验和解析；旧配置缺失时使用默认值，不迁移已有数据。允许中文、英文、符号与表情，按 Unicode 可见字符计数，上限 20，拒绝换行；首尾空格清理并归一为 NFC，留空删除覆盖、恢复默认。参数由客户端、克隆画布面板与独立预览的既有草稿和保存链路传递，只通过 `textContent` 写入底部节点。

验证沿用参数合同测试、客户端/画布参数浏览器测试、预览与保存链路测试，检查 20/21 字边界、组合表情、HTML 字面显示、恢复默认及其他样式隔离；在默认区域测量最宽文本后执行文档检查与增量 diff 审阅。较宽的表情或符号文案自动换行，底栏至少保持原 68px 高度，并随多行文字增长，避免裁切。服务端仓库当前仍不含 `twitter` 样式，远程浏览器源支持沿用本计划原有同步限制，本次不扩展为整个样式的服务端移植。

结果：以上四个已有测试文件合计 70/70 通过，文档门禁 10/10 通过。真实 Chromium 预览中，20 个庆祝表情在 348px 文案列中完整换为两行，高度 40px，底栏仍为 68px，无横向或纵向裁切；中文、英文、组合表情与旗帜由浏览器回归覆盖。参数提交和保存回读由现有授权设置控制器的隔离测试验证，不等同于未同步的远端支持。额外观察到独立预览刷新会重置当前样式及草稿，因此未将刷新当作参数持久化证据；正式保存仍走客户端「应用」流程，预览刷新恢复行为另行定位。README 与交互式引导入口未变，本次仅同步参数说明。

## 专属参数扩展（2026-10-27）

**Goal:** 在客户端和克隆画布参数面板中提供有实际直播用途的 Twitter 版式与事件配色设置，默认继续复刻当前参考外观。

**Architecture:** 扩展既有 `styleOptions.twitter` 合同；Node 与浏览器副本同步校验，管理端复用 `bindDanmakuParameters`，展示端通过 CSS 变量和 data 属性更新现有消息。沿用草稿、保存、恢复默认流程，不创建另一套设置存储。

**Tech Stack:** Vanilla ESM、原生 CSS、现有 node:test / Chromium 测试。按仓库要求直接在当前对话实施，不提交或自动委派。

新增字段：`twitterHeader`（顶部资料与标签区）、`twitterComposer`（底部提示栏）、`twitterActions`（帖子操作图标行），均仅接受 `show` / `hide`，默认 `show`；`twitterColor0/50/100/1000` 为礼物及 SC 按单次金额划分的四档底色，接受六位或八位十六进制颜色（沿用选色器的不透明度），默认依次为 `#409afa/#f9c844/#f89260/#ef4260`。旧配置无需迁移；其他样式拒绝这些字段。已有底部文案与通用字号、字体、滚动设置继续复用。

### 实施与验证

- [x] 合同：扩展 `src/shared/danmaku-style-options.js` 与 `public/js/shared/danmaku-style-options.js`；在既有 `danmaku-style-options.test.js` 控制矩阵中检查七个字段的有效值、非法值、默认值、样式隔离及两端一致性。
- [x] 界面：扩展 `public/js/admin/danmaku-parameter-view.js` 和 `public/pages/admin/live-components/danmaku.html`，由克隆面板自动复用；同步 `public/js/overlays/danmaku-preview-appearance.js` 与独立预览字段。版式放在常用参数，四档配色放在高级参数。
- [x] 展示：由 `applyStyleOptions(document, style, allOptions)` 写入显示状态与四档 CSS 颜色；`danmaku-twitter.js` 使用可继承的档位变量，`twitter.css` 收起隐藏区域的布局空间。默认几何不变；操作行隐藏后缩短帖子，已有文字和表情保持稳定。
- [x] 验证：扩展既有客户端／画布同步、预览、设置保存和动效浏览器测试，覆盖三个区域独立切换、当前消息即时换色、保存回读、恢复默认和其他样式隔离；用合成资料实际操作两份参数面板和展示页面。执行直接受影响的测试、文档门禁和最终 diff 审阅。
- [x] 同步 `docs/reference/frontend/overlays.md`、`docs/guides/component-style-parameters.md` 及应用内弹幕指南。README 与交互式引导入口不变，不重复维护字段表。

结果：四个参数／预览／面板／保存套件 73/73 通过，Twitter 动效、renderer 与 profile 聚焦 10/10 通过，文档门禁 10/10 通过。真实 Chromium 中，客户端和克隆画布面板通过实际选色器把低档配色同步为 `#8058a8b3`，两侧均保留 70% 不透明度；独立预览连续播放时，三个区域隐藏后消息区完整占用 850px，现有消息节点和文字保留，色块为 `rgba(128, 88, 168, 0.7)`；重新显示底栏保留文案，恢复默认回到原版式与四档配色。八种开关组合、金额边界及礼物／SC 共用配色由浏览器回归覆盖。证据位于 `tmp/twitter-style-parameters/`，无页面脚本错误；未使用真实用户数据、未提交或部署。原计划未完成的远端／真实上游验收保持原状。

本次范围为本仓库的客户端、画布与本地展示；服务端仓库仍缺少整个 Twitter 样式，不在本次参数扩展中移植。远程浏览器源须同步样式后才能接受这些字段，不把隔离保存回读测试表述为远端部署验收。

## Goal

在正式客户端新增独立固定位置样式 `twitter`（仿推特 3.0），按 `BV1fr421c7t4` 的本地拆帧证据实现白色社交面板，覆盖聊天、普通礼物、大航海和 SC；操作图标使用 SVG，当前房间大航海对勾为舰长蓝、提督紫、总督红，顶部展示当前房主头像、名称和 UID。

## Non-goals

- 不替换或删除现有样式，不继续把 `tmp/twitter-3-rebuild` 当交付物。
- 不引入框架、构建步骤、新服务或真实用户测试数据；不提交、发布或部署。
- 不伪造点赞数、开通／续费动作、陪伴天数或身份；缺失动作时使用中性大航海文案。
- 不发明 LIRA Server 新房主资料协议。服务器辅助场景仅在本地资料与已授权场景房间号一致时复用本地资料，否则显示中性等待状态，绝不展示另一房间资料。

## Current Behavior

- 原型只在 `tmp/`，底部使用被放大的低清 PNG；正式 renderer 没有 `twitter`。
- 共享 `danmaku-feed` 已拥有固定列表测量、连续位移、淘汰和快照恢复；`data-live-entry` 只出现在新追加消息。
- 本地 `feed-buffer.pushGift()` 目前省略头像、礼物图和购买大航海等级；本地 SC 只进入持久化／点歌链路，没有进入公开弹幕 feed，也没有对应撤回通知。
- `/api/bilibili/room/profile` 已由服务端按当前配置房间解析房主资料，但 danmaku overlay scope 尚无精确访问权限或响应投影。
- 场景礼物／SC 与本地公开 feed 字段丰富度不同；预览已有全类型合成样本。

## Ownership

- 视觉：`danmaku-message-renderer.js`、新增 `danmaku-twitter.js` / `danmaku/twitter.css`；SC 金额与价格档继续由 `danmaku-superchat-renderer.js` 拥有。
- 布局与生命周期：共享 `danmaku-feed.js`，新样式只提供 DOM decorator、CSS 和样式注册，不添加 Twitter 专用共享布局分支。
- 本地公开事件：`src/bilibili/danmaku/feed-buffer.js`、`src/server/bilibili-client.js`、`src/server/runtime-transport.js` 与 `src/server/overlay-projection.js`。
- 礼物图片：现有礼物目录解析器及 `/overtime-gift-images/` 只读资源，不复制目录或缓存。
- 房主资料：现有 `bilibili-runtime.getRoomProfile()` / `bilibili-routes.js`；overlay 仅在 `access-policy.js`、`overlay-http.js`、`overlay-projection.js` 增加精确 capability。
- 注册与保存：两份 `danmaku-style-options.js`、两份 `danmaku-layout.js`、两份 `component-style-parameters.js`、正式 Admin／预览 markup 与现有合成预览。
- 合同说明：`docs/reference/frontend/{danmaku-motion,overlays}.md`、`docs/reference/backend/{api.md,ws.md,bilibili/danmaku.md}` 及受影响用户指南。

## Compatibility Constraints

- 保留现有样式、设置键、页面 URL、Electron 安全边界和工作区已有修改；旧布局缺少 `twitter` region 时只补默认值，不移动旧区域。
- 公开新字段均可选且只含展示信息；继续排除账本 ID、原始报文、检测状态、凭据及客户端提供的租户身份。
- danmaku overlay 只新增 `GET /api/bilibili/room/profile`，响应仅投影 `roomId uid name avatarUrl`，其他 scope 不获得该能力。
- 本地礼物图只接受合法 B 站 CDN 或既有安全 `/overtime-gift-images/` 路径；头像失败保留文字回退，所有用户文本继续通过 DOM `textContent` 创建。
- SC 撤回使用同一 danmaku topic 的可选公开事件，不改变持久化撤回所有权；快照恢复和 reduced motion 不重播入场或爱心动画。
- 预览顶部使用合成房主；直播独立 overlay 读取当前房间资料。场景模式要求返回资料的房间号与场景状态房间号一致，异步旧请求不得覆盖新房间或新样式。

## Proposed Changes And Milestones

- [x] **M1 公开事件与房主资料边界。** 礼物补头像、目录图片和 `giftGuardLevel`；SC 进入 feed 并支持撤回；WebSocket／HTTP 白名单同步。扩展 feed-buffer、runtime、B 站客户端、overlay projection/access/room-profile 测试，验证缺字段、恶意 URL、撤回和跨 scope 拒绝。
- [x] **M2 样式注册与静态 chrome。** 注册 `twitter`、默认区域、参数能力、Admin／独立预览入口和缩略图；加入顶部资料、标签栏、输入栏及 SVG symbol。扩展 style-options/layout/markup/ownership 测试。
- [x] **M3 四类卡片与动效。** 新增样式 decorator 和 CSS；聊天复用表情与安全正文，礼物复用真实图片，大航海使用三档矢量阶梯箭头和已知动作／天数，SC 复用金额和价格档。底部评论／转发／爱心／分享全部 inline SVG；蓝紫红对勾使用现有 guard tokens。扩展 renderer 测试。
- [x] **M4 房主资料与完整预览。** 新增加载器处理取消、旧响应、头像失败和场景房间一致性；预览首轮依次展示聊天、礼物、大航海、SC，随后保留无重复洗牌循环。扩展 local-preview/component-source 测试。
- [x] **M5 文档与实际播放。** 同步实现合同、动效说明和用户指南；运行聚焦回归、语法／文档门禁，并使用现有隔离浏览器或 Electron 路径验证实际追加、密集消息、动画中追加、长文本／表情、上下方向、快照、reduced motion 与 SVG 清晰度。

## Verification

按改动最终范围运行以下聚焦命令（不默认升级全仓测试）：

```text
node --test test/danmaku/danmaku-feed-buffer.test.js test/server/runtime-event-publication.test.js test/bilibili/server-bilibili-client-avatar.test.js test/bilibili/bilibili-room-profile.test.js test/overlays/overlay-projection.test.js test/transport/websocket-access-policy.test.js
node --experimental-vm-modules --test test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-preview-samples.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/admin-danmaku-markup.test.js
npm run check
npm run verify:docs
git diff --check
git status --short
```

实际播放优先复用现有隔离 Electron／Playwright 测试入口和合成事件；若现有入口不能覆盖某个视觉条件，在 `tmp/` 只放 QA 证据及必要驱动，不作为产品代码。真实 B 站上游、OBS／直播姬或远程服务器未执行的验收必须明确保留，不能用合成预览冒充。

### Recorded Results

- 2026-10-26：公开事件、房间资料、overlay 投影和 WebSocket 权限聚焦测试 73/73 通过；renderer、样式参数、布局、预览、资料加载、快照、SC 撤回及完整固定 feed 浏览器动效测试 130/130 通过。Twitter 密集混合用例覆盖长文、重复文本、表情、普通礼物、大航海、SC 和移动中追加。
- `npm run check` 通过 1666 个 JavaScript 文件的语法检查；`npm run verify:docs` 10/10 通过。最终礼物原图兼容测试确认旧 `giftImage:'theme'` 仍解析为真实图片，Admin／预览不显示无素材的插画切换。
- 隔离 Chromium 实际播放使用 `tmp/inspect-twitter-playback.cjs` 和合成事件，已检查四类卡片、稳定帧／中间帧、向上／向下、密集追加、reduced motion、房主文字回退、四组 SVG 与横向溢出；30／40px 在 1×／0.75× 下按实际倍率显示，未发现脚本或控制台错误。截图和驱动只留在 `tmp/`。
- 全样式字号套件仍在既有 RIPPLOID 用例缺少 `.draw-danmaku-item:first-child .draw-danmaku-body > p` 处失败；未修改无关 RIPPLOID 或削弱断言，Twitter 定向字号与布局验证已通过。
- 未执行真实 B 站上游、OBS、哔哩哔哩直播姬或远程 LIRA Server 验收；这些外部场景仍需实播确认。参考视频仅 852×480，当前实现是尽量接近的正式样式，不声称逐像素复刻。

## Rollback Or Failure Handling

失败时停止扩大范围，保留用户已有修改；依据任务增量仅反改本计划文件，不做 reset、blanket checkout 或广泛删除。异步资料加载先使 generation 失效再清理；图片／资料失败不得阻断消息 feed。测试若暴露合同影响，先区分真实缺陷与重复 fixture，再修 owning layer。

## Done When

正式客户端可选择并保存 `twitter`；四类真实本地事件、SC 撤回、房主资料和预览按上述边界工作；SVG 与三档身份正确；共享 feed 的快照、方向、密集追加和清理保持有效；受影响测试／文档已同步，聚焦验证通过或限制已记录，最终增量 diff 无生成物、秘密或无关改动。

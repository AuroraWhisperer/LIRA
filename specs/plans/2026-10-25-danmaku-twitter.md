# 仿推特 3.0 弹幕样式实施计划

**Status:** Awaiting Verification

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

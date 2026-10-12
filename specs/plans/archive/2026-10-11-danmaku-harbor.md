# 航海气泡实施计划

状态：Completed。2026-10-11 本地实现与隔离验证完成，未提交或部署。需求来源为用户截图、直播间 52030；用户确认在线榜仅前三名，随后补充 SC 截图。

## 目标与边界

新增 `harbor`（航海气泡）固定位置样式：灰色普通弹幕，蓝/紫/红本房间舰长/提督/总督，航海头像装饰；在线榜前三显示排名牌，身份气泡继续依照大航海等级。上舰卡显示姓名、CN¥ 金额、明确的开通/续费与已知陪伴天数。SC 使用头像与姓名金额上下排列的浅色头部、深色留言区。普通礼物先保留简洁基础通知，待用户提供参考后再定稿。

仅增加新样式，不修改其他主题、账本、结算、消息发送、鉴权和租户边界。保留两仓正在进行的雪狐及指南修改；不提交或部署。

## 所有权与兼容性

- Server `public/overlay/danmaku-renderer-core.js` 是消息渲染来源，桌面由 `scripts/sync-danmaku-source.cjs` 显式同步。主题装饰位于 `danmaku-harbor.js`；CSS 各端沿用自身路径。
- 新样式和 `minGiftAmount` 同步四份 style-options、布局与样式效果能力；现有 `styleOptions` 内按主题保存，不新增数据库结构。
- `minGiftAmount` 默认 0，0–100000 元、最多两位小数。仅过滤 gift（包含上舰）；使用 `giftTotalPrice` 最终总额，不再次乘数量。等于阈值保留；非零门槛下金额缺失隐藏。SC 和普通弹幕不受影响。
- 排名来自当前房间的 B 站在线榜事件，不从会员等级、荣耀等级或昵称推算；公开投影仅增加可选 `onlineRank: 1|2|3`，不带 UID。状态属于现有 RoomMonitor，停止/场次切换清空。
- 桌面 `scene-cloud-controller.js` 对新字段继续逐项验证；前端只渲染。运行中的用户应用与真实数据不用于测试。

## 实施与验证

- [x] 新主题注册、气泡、上舰卡、SC、预览样例、缩略图与参数控件。
- [x] 礼物门槛覆盖快照、增量与设置更新；在线榜来自房间快照，私下匹配 UID，公开仅投影前三名整数。
- [x] 同步桌面 reference、guide、应用内说明和 Server protocol、三份 OpenAPI、需求与验收说明。
- [x] 定向检查、隔离 Electron 保存重载、浏览器实际渲染与截图检查。

## 验证证据与限制

- 桌面 renderer、feed、layout、style-options、preview、scene-cloud 和来源同步的 127 项定向测试通过；隔离 Electron 中航海气泡金额参数保存／重载测试通过。
- Server room-monitor、style-options、settings、SC renderer 和 protocol 的 50 项定向测试通过；文档与协议门禁 53 项通过。
- `e2e/overlay-harbor.spec.js` 通过：四档身份、前三排名、门槛下／等于、配置重建、SC 不受筛选、头像失败、窄区域长文本；检查真实 CSS 的上舰卡布局与头像框资源。
- 合成预览由现有隔离 Electron fixture 的授权画布生成；测试进程和临时数据库已清理。临时截图位于 `tmp/harbor-reference/`；正式样式卡为 `public/img/overlays/danmaku-previews/harbor.png`。
- 按用户修订要求，头像框改为 [B 站官方大航海资源](https://api.live.bilibili.com/xlive/open-interface/v1/query_resource?module=guard_resource) 的千舰款：舰长、提督、总督各自独立；与 52030 页面实际引用的舰长／提督 URL 核对，PNG 随两端打包。气泡和 SC 按用户截图采样；参考中未出现的总督红、提督／总督上舰底色参照 [B 站官方等级色](https://s1.hdslb.com/bfs/static/blive/blfe-live-room/static/css/app.ed0d6945abb5988ddf16.vip.css)。舰长感谢图标取自用户截图并去除底色，保留原始分辨率，放大时存在清晰度限制；提督／总督舰徽为 B 站官方图案。资源来源记录在各端素材目录的 sources.json。
- 已只读核对 52030 页面原生头像框；页面截图接口不可用，视觉比较使用用户提供的截图。未将 LIRA 连接真实直播或部署；普通礼物外观暂用基础通知，等待用户后续参考图。榜单须在当前连接收到平台快照后才显示。
- 测试、技术文档和使用说明已同步；README 与交互导览无入口变化，无需修改。公共 style-ownership 检查通过；最终桌面文档门禁 10/10、Server 文档与协议门禁 53/53 通过。
- Impeccable 对新主题 CSS/JS 的检查无发现；两仓 `git diff --check` 通过。本任务无运行数据、秘密或临时文件进入版本化差异，未暂存、提交或部署。

## 原生头像框与外观修订复验

- 三档头像框 PNG 与官方源一致，并且在桌面授权预览与 Server 浏览器源实际加载。头像加载失败仍保留独立身份框。
- 截图对照修正灰／蓝／紫气泡、字号比例、行间距和黄色深字榜首牌；上舰卡采用三行文案、斜向深浅底纹和右侧舰徽。SC 保留补充截图的蓝灰标题、深蓝正文。
- renderer、feed、样式所有权 30 项测试通过；最终 CSS 的完整 `e2e/overlay-harbor.spec.js` 通过，覆盖四档配色、三种本地框资源、前三排名、金额门槛与窄区域／头像失败。
- 桌面实际 640×720 区域内，合成参考图占 640×652，所有消息文字无横向溢出；缩略图 640×360 完整容纳四档身份、舰长卡与 SC。隔离 Electron／Chromium 已关闭，临时测试数据已清理。来源同步检查通过。
- 本轮没有修改参数或公开事件契约；沿用此前的参数保存、榜单投影及协议覆盖。更新所属前端 reference、Server 视觉规范及应用内说明；参数指南、README 与导览操作未变化。

## 失败处理与完成条件

仅撤回本任务的局部改动，不覆盖其他未提交修改。截图相似度、基础消息安全渲染、两端参数校验与门槛测试通过后交付；未验证的真实直播或尚缺的礼物外观参考明确注明。

# 画布与客户端组件参数逐项核对

Status: Complete

## Goal

逐个核对所有画布组件与客户端对应界面的参数来源、编辑、保存、回填和直播输出。相同对象的同一参数使用同一 owner；修复未接入、覆盖、遗漏、陈旧界面与保存后不一致的问题。上一轮仅验证歌曲信息、展示板及部分资源样式，不作为其他组件已完成的证据。

## Boundaries

沿用 Electron、现有组件控制器、场景中继及各领域读写接口。场景几何、图层和实例选用样式保留原契约；领域操作不得变成只修改演示数据。每条许愿的文字颜色按用户已确认的要求拥有，不重新引入整层覆盖。保留所有已有工作区修改；不提交、不切分支，不操作真实用户数据或正在运行的客户端。

## Owners and contracts

- 共享控制器：`public/js/admin/scene-item-controller.js`、`public/js/shared/scene-shared-appearance.js`、`public/js/admin/component-preview-publication.js`。
- 本地共享外观：`public/js/admin/canvas-shared-appearance.js`、`src/server/scene-shared-appearance.js`。
- 参数 UI：`public/js/admin/component-preview-definitions.js`、各 `*-preview.js`、`scene-extra-preview.js` 与客户端 owning forms。
- 输出：`src/server/scene-components.js`、`scene-extra-display.js`、`public/js/overlays/`。
- 契约：`specs/component-scenes.md`；`docs/reference/frontend/app.md`、`overlays.md`，各后端 owner 参考；用户说明 `docs/guides/component-sources.md` 与对应内置指南。
- 验证：现有 `test/admin/`、`test/scenes/`、`test/overtime/`、`test/gifts/`、`test/desktop/shared-canvas-appearance-electron.test.js`；隔离宿主 `test/fixtures/danmaku-canvas-editor.cjs`。

## Audit matrix

“已核对”必须有字段及读写证据；通过某个通用测试不等于整行完成。

| 组件 | 核对范围与 owner | 状态 / 证据 |
| --- | --- | --- |
| 加班机 | 背景 `path/fit` 走原 controller；时长、启停走 overtime service；礼物规则仍由客户端编辑 | 已修复。原加时按钮只改样例；现在默认实际时间，执行原 time/action 接口。V2 的真实 Electron 用例覆盖双向时长、取消确认、开始/暂停、背景、发布和重开；V1 覆盖授权与重放。 |
| 弹幕姬 | `danmaku-preview.js` 复用 `bindDanmakuParameters`；通用字段及逐样式 options/parameters 走账号本地 appearance | 已核对。场景仅保留样式选择与布局；V2 验证原控制器保存，V4 验证样式切换、重载、参数与实际播放不重置。 |
| 时钟 | `clock-preview.js` 复用原绑定；日期、秒、小时制、角标、配色、月相及 styleParameters 走 clock profiles | 已核对。`mergeSharedAppearancePatch` 只合并所选款，不回写别款；V1 样式隔离，V2 时钟保存、重开、旧月相参数及输出尺寸。 |
| 点歌板 | `queue-preview.js` 复用 themeForm 与 `bindQueueTheme`；主题、字体、文字、显示开关走 queue theme owner | 已核对。编辑样例不改真实队列；V1 A/B/A 多样式保存及字段边界，V2 原控制器与输出保存。 |
| 展示板 | `display.js` / `song-board-settings.js`；标题、排序、速度、文字与跟随主题走 settings，category 是图层过滤 | 已核对。补丁保存、不回写未编辑字段；V1 主题/数值精度与发布共享值，V2 Electron 双向修改、多实例和正式输出。 |
| 直播歌词 | `desktop-lyric.js` 与 scene lyrics fields 共用 `desktopLyric*`；全民 K 歌来源仍为客户端业务项 | 已修复。整表保存改为实际修改字段，保存后合并画布最新值；V1 验证并发不同字段不覆盖、重置保留来源，V2 排版与正式暂停隐藏。静态示例歌词只用于看外观。 |
| 歌曲信息 | `nowPlayingAppearance` / `now-playing.js`；布局、字号、配色、唱片/歌手和旋转参数 | 已修复。加入 `canvas-shared-appearance.js` 本地类型列表；V1 双入口与样式身份，V2 Electron 双向保存、重开；实际曲目复用 `app:now-playing`。 |
| 开播动画 | `opening-canvas-settings.js` / opening service；经典、像素、月渡固定样式，文案、媒体、音乐音量和专属外观 | 已核对。复用受限 opening 接口及逐样式保存；V4 验证双向读取、媒体槽隔离、发布输出和撤销授权。资源包外观走库 owner。 |
| 滚动礼物 | `gifts/display-settings.js` / giftDisplayConfig；尾部、纹理、行数、速度、最低金额和三档阈值 | 已核对。元/分换算一致，接收更新保留草稿、只保存修改字段；V1 校验/边界，V2 正式渲染，V4 客户端保存、取消、金额精度。 |
| 全屏礼物感谢 | `gift-frame.js` 的启用/触发金额；资源样式参数走 library config | 已核对。画布没有第二套触发规则；预览昵称/礼物/数量是示例，正式事件来自原 gift owner。V2 独立图层及真实触发输出、资源参数共享。 |
| 大航海感谢 | `gift-guard-thanks.js`；逐样式文字语言走 guard settings，导入资源走 library | 已核对。等级/昵称/月数为明确标记的预览输入；头像和昵称字号只在实际支持的航海资源中显示。V1 逐款语言隔离，V2 Electron 资源外观双向保存及真实等级事件。 |
| 礼物许愿 | wish owner 保存每条目标、文本、颜色；图层只保存周期过滤、条数、间距、展示样式与彩带参数 | 已修复。移除整层状态色覆盖，保留旧字段兼容；画布读取实际保存的许愿并复用客户端 feed，周期不再篡改为示例。V3 保存/删除实时回填、颜色、单订阅/取消/失败；V2 筛选与彩带正式输出。 |
| 月底冲刺 | `gifts/sprint.js` 及 giftSprint 投影；图层 fields 为空 | 已核对。目标和统计只有原 owner，画布没有另一份可编辑目标；编辑页明确示例进度。V1 不持久化业务状态，V2 发布后跟随真实目标变化与归零隐藏。 |
| 心动盲盒 | `gifts/heart-box-collection.js` 与心动收集 owner；图层仅 `displayStyle` | 已核对当前并行新增功能。客户端实时进度、画布明确示例、正式场景共享当前来源投影，无重复计数参数。V2 两种样式发布及来源切换。 |
| 盲盒盈亏榜 | `settings-blindbox.js` 与 shared appearance；top/compact/winnersOnly/heartBoxOnly/noScroll 映射已有 settings 键，字体和颜色同 owner | 已核对。legacy hideLoss 与 winnersOnly 同一开关；V1 别名、倍数和剩余堡数，V2 关闭旧过滤及正式渲染，V4 客户端保存来源参数。 |
| 弹幕投票 | `interaction-appearance.js` / settings；标题、提示、配色、字号、圆角、不透明度与状态/人数开关 | 已核对。与评分共用同一外观，未编辑字段随快照更新，提交变更补丁；场次/投票选项由 interactions 业务 owner 管理。V2 参数与输出，V4 外观投影/保存。 |
| 观众评分 | 同一 appearance owner；`interactionRatingRules` 是显示文案，kind 是图层选择 | 已核对。没有另一套评分统计或规则配置；画布样例分数不可编辑。V2 评分样式及输出，V4 规则文案、多行及字段边界。 |
| 文本框 | `text-box.js` 直接按 item ID 编辑同一 canvas controller/document；两端共用 editor | 已核对。内容、格式和滚动不另存 settings；V4 Electron 格式、撤销、发布与重开。 |
| 直播小游戏 | `games-canvas-data.js` 读取原 session；三种游戏共享原 games owner | 已核对。画布 game/showTitle/showDanmaku/opacity 是图层显示字段，客户端没有重复项；V2 真实局面更新、结束清空和输出，V1 排除游戏秘密数据。 |
| 转盘 | `games-wheel.js` 管理选项/权重/抽取；图层 showResult/textColor/labelFontSize/opacity 由 scene 拥有 | 已核对。客户端无重复外观字段，画布不提供样例业务操作；V2 参数保存和真实正式输出。 |
| 背景 / 外部浏览器源 | 资源外观走 library；`background-parameter-view.js`、`browser-source-preview.js` 绑定当前图层，URL/网页分辨率按实例保存 | 已核对。普通媒体和第三方网页没有另一份客户端设置；V1 资源共享与背景字段校验，V5 外部源编辑、固定视口和正式输出。 |

## Execution

已确认加班机复现：用户在画布调整时间，客户端未改变；原“演示加时 / 暂停”只修改内存样例。将实际时间设置及开始/暂停接到既有桌面预览中继，由客户端调用原 overtime API；仅 overtime 会话接受该命令，沿用会话归属、页面 attachment 和重放去重。时间不写进外观快照。示例模式只查看，不再提供会被误认为真实操作的时间按钮。需要覆盖两向回填、真实输出、重开及未授权/过期会话拒绝。

同时修复歌曲信息遗漏共享接线、许愿整层覆盖颜色及随机预览、歌词自动保存旧表单覆盖。许愿沿用现有 feed，增加同页按接口共享消费者，保留其他接口消费者的独立生命周期；未新增服务器轮询通道或领域存储。其余矩阵项沿用已有实现。检查方法为逐字段来源、绑定与保存路径审阅，加上直接相关的行为验证，不声称人工点击了每个款式的每个控件。

- [x] 逐行对照客户端控件、画布控件与字段 allowlist，记录同名不同作用范围及缺失的实际参数；核实旧场景、副本与导入样式。
- [x] 从加班机开始复现用户看到的问题，使用真实绑定与可见控件；仅修改实际 owning 层。已有测试没有覆盖真实 UI 接线时扩展原用例，不以 mock 往返证明产品行为。
- [x] 对发现的问题验证两向修改、显式/自动保存、回填、重新打开及正式输出；保存失败保留草稿，未改的参数不得回退。
- [x] 同步受影响技术参考和用户指导；给矩阵每行填入当前代码位置、检查结论和实际运行证据。

## Verification

复用有判别力的现有用例；按变更扩展直接相关测试。基础命令：

```powershell
node --experimental-vm-modules --test test/admin/canvas-shared-appearance.test.js test/admin/scene-item-notifications.test.js test/scenes/shared-appearance.test.js
node --experimental-vm-modules --test test/desktop/shared-canvas-appearance-electron.test.js
npm run verify:docs
git diff --check
git status --short
```

每次运行记录具体覆盖范围和失败原因。缺少证据的行继续调查，不凭绿色检查推断。最后按实际代码变更决定额外静态/架构门禁，避免无理由全仓测试。

2026-11-06 当前运行结果（分批合计 175 项，去重；没有运行全仓测试）：

- V1：共享 owner、scene-item 通知、场景配置/投影、预览 contracts/remote/transport、加班机回执顺序、歌词保存，共 82 项通过。
- V2：`shared-canvas-appearance-electron`、`component-preview-browser`、`canvas-component-library`、`canvas-empty-previews`、`canvas-gift-components`，共 20 项通过。
- V3：`component-preview-providers` 与 `frontend-gift-wishes`，共 34 项通过；随后在既有许愿保存用例加入真实客户端到 canvas provider 的联动断言，该用例单独重跑通过。
- V4：`canvas-opening`、`opening-canvas-settings`、`opening-independent-settings`、`interaction-appearance`、`frontend-gift-display-settings`、`frontend-blindbox-admin`、`text-box-electron`、`danmaku-local-preview`，共 38 项通过。
- V5：`canvas-browser-source` 1 项通过。
- 隔离 Electron 人工 UI 检查：真实画布将 15 分钟设为 27:03，客户端控件和原 service 确认 1623 秒；画布按钮及提示可见，无页面异常。使用独立合成数据库，测试 Electron、浏览器与 scratch 目录已关闭清理。初次复用的长期开启夹具因测试授权过期未取得入口，重启本任务自有夹具后通过，没有修改授权保护。
- 已同步规格、API/frontend 参考、组件指南及内置加班机/许愿/场景指南。交互式引导未涉及这些具体操作，无需修改；现有截图没有描述被移除的示例时间操作，无需替换。
- 23 个修改相关 JS/CJS 文件语法检查通过，任务差异已审阅，`git diff --check` 通过。架构 27/28：唯一失败是其他工作移除 `public/js/admin/overtime.js` 空 catch 后，`test/engineering/module-boundaries.test.js` 中旧豁免基线未同步；本任务未修改这两个文件。
- 文档门禁最初发现本计划与索引状态未同步，已修正；归档后最终复查为 9/10，唯一失败为并行新建的 `2026-11-06-standalone-component-sources.md` 尚无当前状态。其余接口、引用与规范导航检查通过；未修改其他工作的计划。

## Compatibility / failure handling

不改变账号范围、鉴权、预览 capability、持久字段或业务结算。共享参数保存以既有 owner 确认为准；场景保存失败不吞掉编辑。修复只逆转本任务的具体行，不重置或覆盖其他改动。所有合成数据与临时产物限仓库 `tmp/`。

## Done when

矩阵每项完成并有直接证据；确认问题已修复且回归通过；无法等同的领域/场景参数已明确说明；文档与当前行为一致；最终差异、状态和临时资源已检查。所有组件检查完成前不关闭目标。

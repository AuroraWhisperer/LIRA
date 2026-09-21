# Admin 应用与公共框架

> 涉及文件:[pages/admin/](../../../public/pages/admin/)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin-page-composition.test.js)、[js/admin/index.js](../../../public/js/admin/index.js)、[js/admin/app.js](../../../public/js/admin/app.js)、[js/admin/legacy-admin-bridge.js](../../../public/js/admin/legacy-admin-bridge.js)、[js/admin/state.js](../../../public/js/admin/state.js)、[js/admin/forms.js](../../../public/js/admin/forms.js)、[js/shared/](../../../public/js/shared/)、[js/desktop.js](../../../public/js/desktop.js)、[js/admin/gifts/](../../../public/js/admin/gifts/)、[js/admin/overtime.js](../../../public/js/admin/overtime.js)、[pages/gift-audit.html](../../../public/pages/gift-audit.html)

本文档描述管理后台(`/admin`)的页面结构、公共框架与各业务模块。通信行为见 [comms.md](comms.md),端点定义见 [api.md](../backend/api.md),快照与消息类型见 [ws.md](../backend/ws.md),IPC 通道见 [desktop/preload.md](../desktop/preload.md)。

### Admin 业务模块边界

粉丝档案由 `fans/index.js` 持有选中项、请求上下文、表单和快捷窗口生命周期，`forms.js` 定义字段读取，`view.js` 只做转义后的展示，`transfer-ui.js` 拥有备份、恢复点、认领与合并的多步预览。保存失败保留输入；请求/选择代次拒绝迟到显示。`queue.js` 仅把已知 typed identity 交给同一详情入口；私人资料不并入 StateService 或 legacy globals。

`state-renderer.js` 消费 StateService 的 `changedKeys`，分别调度设置、队列、SC、直播状态、礼物和歌库元数据视图。`queue.js` 以具名 ESM 导出队列操作和渲染，只在 `legacy-admin-bridge.js` 发布既有兼容入口；它不再回填设置或渲染礼物、直播与分类。礼物专属快照不会重建队列或覆盖表单。

`gift-frame.js` 按字段保存未提交草稿，并与通用表单的 `preserveDirty` 标记协作。设置同步不覆盖草稿；保存成功只清理仍等于本次提交内容的字段，保存等待期间的新输入继续保留。

百宝箱“动态抽奖”由 [dynamic-lottery.js](../../../public/js/admin/dynamic-lottery.js) 管理独立登录与授权失效，由 [dynamic-lottery-workflow.js](../../../public/js/admin/dynamic-lottery-workflow.js) 管理规则表单、最近 50 个活动、采集进度、暂停/继续与中奖结果。账号管理与本地抽奖记录使用展开入口；设置使用单列输入和复选条件，创建后保留内容链接、作者与截止时间的摘要。采集明细在结果出现后默认收起，刷新和采集/核验的暂停、继续入口始终按状态保留。独立结果框每页展示 5 人，包含真实昵称（旧记录回退 UID）、主页链接、关注核验和完整参与评论，以 DOM textContent 渲染；同时保留核验/排除/缺额统计及开奖凭证。使用现有工具箱标签、原生 CSS token 和命名 ESM；不增加 AdminApp 全局。只在用户提交时开始采集/开奖，后台忙时通过受保护状态接口读取进度。renderer 不计算资格或随机顺序、不保存 Cookie；授权变化和页面卸载取消页面请求并丢弃旧响应，后台进度持久化后需手动继续。相关端点见 [api.md](../backend/api.md)。

下表记录本轮拆分后仍由门面保留的外部入口。内部模块使用显式 ESM import/export，不新增 `window.AdminApp` 全局；兼容注册只留在既有门面。

| 业务门面                   | 内部模块                                                                                                                                      | 所有权边界                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `settings.js`              | `settings-auth.js` / `settings-form.js` / `settings-license.js` / `settings-blindbox.js` / `settings-operations.js`                           | 门面接 DOM 与兼容 API；内部模块分别拥有认证、表单、授权账户资料、盲盒 URL 和保存/导入导出操作 |
| `overtime.js`              | `overtime-rule-editor.js` / `overtime-rule-model.js` / `overtime-rule-effect-editor.js` / `overtime-time-view.js` / `overtime-status-view.js` | 门面接快照与事件；规则编排、规则模型、效果编辑、时间格式/结算展示、状态时钟各自独立       |
| `ai-assistant-settings.js` | `ai-assistant-config-view.js`                                                                                                                 | 门面拥有自动保存和事件生命周期；view 只负责配置读取、校验、渲染和错误文案                 |
| `desktop-lyric-preview.js` | `desktop-lyric-settings.js` / `desktop-lyric-timeline.js` / `desktop-lyric-styles.js` / `desktop-lyric-controls.js`                           | 预览门面拥有 DOM/动画生命周期；设置归一化、时间轴数学、样式映射和表单读取无交叉状态       |
| `games.js` / `todo.js`     | `games-wheel.js` / `todo-model.js`                                                                                                            | 门面拥有页面事件；转盘配置和待办模型逻辑可独立测试                                        |
| `interactive-tour.js`      | `interactive-tour-config.js` / `interactive-tour-position.js`                                                                                 | 门面拥有引导生命周期；步骤配置和定位计算不访问全局状态                                    |

## 1. 页面结构

管理页 HTML 分片位于 [pages/admin/](../../../public/pages/admin/)，由
[server/admin-page.js](../../../src/server/admin-page.js) 按固定顺序组合；完整性、顺序和唯一 ID 由
[admin-page-composition.test.js](../../../test/admin-page-composition.test.js) 保护。

```
topbar: 品牌 Logo + 主页面 Tab(点歌 / 播放 / 礼物 / 百宝箱)
        + 状态条: #wsStatus(WS 连接) #liveStatus(直播连接+主播名/房间号)
                 #reconnectBtn(刷新直播) #songCount(歌库计数) #shutdownBtn(退出)
        + 窗口控件 #windowControls(最小化/最大化/关闭,仅桌面可见)
├── #songAssistantPage     点歌主页面(默认,#hash 无)
│     ├── SC 队列面板 + 点歌队列面板(切歌/清空,带滚轮冒泡控制)
│     └── 歌曲管理面板(song-management-panel):内部六个 Tab
│           songsPage(歌库) / settingsPage(设置) / themePage(点歌板)
│           displayPage(展示板) / overlayPage(浏览器源) / importPage(导入导出)
│           / desktopLyricPage(桌面歌词设置)
├── #playbackAssistantPage 播放助手(#playback)
├── #giftAssistantPage     礼物面板(#gifts):礼物检测/提示/最近/月底冲刺/今日盲盒盈亏/盈亏榜/盲盒映射
└── #otherAssistantPage    百宝箱(#other):左侧功能导航 + 面板(弹幕姬/礼物姬/加班机/礼物特效/主播工作台/开播动画/萌时钟/性能检测/使用文档/桌面更新)
```

六个内部 Tab 的内容由 [pages/admin/song/](../../../public/pages/admin/song/) 下的分片组成:

| Tab          | 主要内容                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| 歌库         | 歌曲表格 + 搜索/分类/语言/歌手/标签/启停筛选 + 编辑表单                                                         |
| 设置         | 直播间(roomId/开关)、点歌行为、队列上限/冷却、清库按钮、Bilibili 登录、退出程序                                 |
| 点歌板       | 经典/身份/奶油画框三种样式切换、预设卡片、规则与置顶文案、主题色/字号/滚动/字体                                 |
| 展示板       | 歌单板独立主题(可同步主主题)、滚动秒数、字号、预设卡片                                                          |
| 浏览器源     | 按点歌与音乐、直播互动、场景与氛围分类汇总全部 11 个固定 OBS / 直播姬浏览器源地址；参数化地址仍由对应功能页生成 |
| 导入导出     | 文本/文件导入、导入结果统计                                                                                     |
| 桌面歌词设置 | `desktopLyric*` 全套 + 实时预览(弹簧跟随)                                                                       |

主页面切换由 [app.js](../../../public/js/admin/app.js) 的 `setMainPage` 负责:维护 `VALID_MAIN_PAGES`/`MAIN_PAGE_HASH_MAP`/`MAIN_PAGE_BODY_MAP` 三张表,切换 `body.dataset.mainPage` 并同步 `location.hash`(`#playback`/`#gifts`/`#other` 直达,[app.js:120-167](../../../public/js/admin/app.js#L120-L167))。

**桌面形态**:`/admin?desktop=1` 时由 [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前给 `html` 加 `desktop-shell` 类,加载 `css/overlays/desktop.css` 的暖金主题,顶栏变为 `-webkit-app-region: drag` 拖拽区,`#windowControls` 与 `.desktop-only` 元素显示([desktop.js:14-17](../../../public/js/desktop.js#L14-L17))。

## 2. 公共框架(shared/)

| 模块          | 文件                                                                            | 说明                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EventBus      | [shared/event-bus.js](../../../public/js/shared/event-bus.js)                   | 应用内事件总线(`on/off/once/emit/clear`),单例挂 `window.AdminApp.eventBus`;常用事件常量 `Events`(SONG_ADDED/QUEUE_UPDATED/PLAYBACK_*/GIFT_RECEIVED/OVERTIME_UPDATED/STATE_LOADED/STATE_SAVED 等,[event-bus.js:181-211](../../../public/js/shared/event-bus.js#L181-L211)) |
| Legacy Bridge | [admin/legacy-admin-bridge.js](../../../public/js/admin/legacy-admin-bridge.js) | 迁移期唯一允许访问 `window.AdminApp` 的边界;`app.js` 通过 `getLegacyAdminModules()` 取得窄兼容接口,通过 `publishNavigation()` 发布导航 API                                                                                                                                |
| StateService  | [admin/state.js](../../../public/js/admin/state.js)                             | 全局状态唯一入口:WS 客户端 + `/api/state` + `/api/songs` 加载,快照经 EventBus 派发 `STATE_LOADED`/`SONG_UPDATED`,同时以 CustomEvent(`app:wesing-state` 等)广播实时状态(详见 [comms.md](comms.md) §3)                                                                      |
| FormsService  | [admin/forms.js](../../../public/js/admin/forms.js)                             | 表单工具:`bindRangePair`(range↔number 双向)、`initTabs`、`fillForm`(快照设置→表单,正在编辑的输入框不被覆盖,[forms.js:174-179](../../../public/js/admin/forms.js#L174-L179))、播放器全屏/收起、滚动速度与字号归一化                                                        |
| Logger        | [shared/logger.js](../../../public/js/shared/logger.js)                         | 生产自动禁用 debug 日志(仅 localhost/127.0.0.1 或 `AdminApp.debug` 时输出)                                                                                                                                                                                                |
| Theme         | [shared/theme.js](../../../public/js/shared/theme.js)                           | `loadThemeConfig()` 拉取 `/data/theme-presets.json`,提供经典/歌单板预设、色板、标签访问器,兼容层挂 `window.AdminApp.theme`                                                                                                                                                |
| Utils         | [shared/utils.js](../../../public/js/shared/utils.js)                           | `api/readJsonResponse/toast/escapeHtml/formatBytes/dangerConfirm/…`(清单见 [comms.md](comms.md) §2)                                                                                                                                                                       |
| Desktop       | [desktop.js](../../../public/js/desktop.js)                                     | 桌面外壳:更新状态机渲染、`desktop.getInfo()` 版本徽章、`onShowUpdatePage`/`onUpdateState` 回调订阅(详见 [comms.md](comms.md) §4)                                                                                                                                          |

**模块注册惯例**:遗留模块仍可在 IIFE 内把公共函数注册到 `window.AdminApp.<模块名>`,但新 ESM 代码禁止直接访问该全局;所有兼容读取集中在 `legacy-admin-bridge.js`。新模块优先使用具名 import/export 和显式工厂参数;EventBus 只承担一对多通知,不作为隐藏的请求/响应依赖。

**事件流约定**:

| 事件                                                                                             | 发布方 → 订阅方                                 | 用途                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| `Events.STATE_LOADED`                                                                            | app.js(接 stateService)→ state-renderer      | 快照接纳后按 changedKeys 更新相关视图，相同数据跳过             |
| `Events.SONG_UPDATED`                                                                            | app.js(接 stateService)→ songs.renderSongs      | 歌库列表/筛选器重渲染                                                |
| `Events.GIFT_RECEIVED`                                                                           | stateService(礼物类 reason)→ 礼物通知模块       | 新礼物 toast 触发                                                    |
| `Events.OVERTIME_UPDATED`                                                                        | stateService(overtime:update)→ overtime.js      | 加班机面板增量刷新(带 revision 去重)                                 |
| `Events.GIFT_CATALOG_UPDATED`                                                                    | stateService(gift-catalog:update)→ overtime.js / gifts/recent.js  | 图片扫描完成后按精确 ID 刷新本地图片，去重包含图片路径和 assetsUpdatedAt；不得覆盖当前直播间成员，不触发歌库或礼物事件重载 |
| CustomEvent `app:lyric-state` / `app:lyric-timeline` / `app:wesing-state` / `app:settings-state` | stateService → 各页面 `window.addEventListener` | WeSing 面板、桌面歌词预览、设置自动保存就绪信号                      |

**迁移期调用示例**:`app.js` 将 `STATE_LOADED` 交给具名导入的 `createAdminStateRenderer`，并显式注入礼物渲染函数；协调器直接调用队列、歌曲和表单 ESM 接口。歌曲模块通过 `createSongs({state, utils})` 显式依赖状态服务和工具。礼物入口通过具名 import 组装通知、检测、冲刺、最近礼物、盲盒和历史模块；工具函数和状态服务直接导入，通知工厂可注入 toast 能力。盲盒直接导入最近礼物图标及分析能力，并独立订阅 `GIFT_CATALOG_UPDATED`，不依赖全局注册顺序或最近礼物模块的转发；旧调用的发布集中在 bridge。遗留调用保持兼容，新增跨模块调用不得扩大全局模式。

`StateService` 对 `songs:*` 和 `cloud:songs` 快照原因防抖重载歌库，其他快照不触发额外歌库请求。HTTP `reloadState()` 对歌词版本只接纳一次并复用结果：新版本派发 `app:lyric-state`，重复/旧版本保留已接纳状态且不重复派发，与 WebSocket 路径共享版本检查。

加班姬礼物选择器的 `GET /api/overtime/gifts` 与刷新按钮始终使用当前直播间礼物面板、`giftConfig` 和已配置的在售盲盒展开，不读取个人背包。首次授权初始化的付费全局目录通过精确礼物 ID 为这些房间条目提供本地图片；弹窗中的“搜索全部礼物”无需先输入，通过 `GET /api/overtime/gifts/catalog` 加载本机完整快照，随后在前端按名称/ID 筛选，不受搜索接口的 100 条上限影响。输入、回车和清空搜索均保留当前目录模式，清空后恢复全部可选项；“返回在售礼物”切回房间目录，重新打开弹窗默认显示房间目录。加载中、本地缓存未就绪、空目录和无匹配结果分别显示对应状态，礼物图片按需加载。最近礼物模块也通过该全局快照接口取得盲盒和高价值礼物图片映射。两者都只显示 `/overtime-gift-images/<basename>`，同名不同 ID 不共享映射，缺失图片保留礼物并显示占位图。`gift-catalog:update` 按精确 ID 刷新最近礼物、已显示规则和选择器图片，不替换房间成员或规则内容；推送的新图片优先于尚未结束的首次 HTTP 读取，失败不清空已有映射。远程 HTTPS 域名入口的配置说明见 [backend/overtime.md](../backend/overtime.md) §1.5。

共享通知由 `shared/toast.js` 直接拥有，`shared/utils.js` 保持 `toast(message, options?)` / `showStackedToast(options)` 兼容导出。相同 key 默认去重；状态类调用明确传 `update: true`，原位替换内容和语义并重置停留时间。返回的句柄提供 `node`、`update(options)`、`close()`；`duration: 0` 表示进度持续显示。每个节点独立持有计时器，退出幂等，默认退出 180ms；悬停及焦点位于卡片内时暂停计时。所有 toast 均不显示关闭按钮，通过自动计时或业务句柄移除；动作使用真实按钮且仅触发一次，CSS 排序避免移动 DOM 导致焦点丢失，移除时优先恢复到其他可见动作或原触发元素。普通结果最多同时 3 条、礼物最多 6 条，并按窗口实际剩余高度调度：错误/动作优先，未展示系统结果等待空位后计时，超额瞬时礼物淘汰。普通结果通过独立状态区播报，礼物不逐条播报；`urgent: true` 才使用 assertive。成功短提示默认 2600ms，警告/错误至少 6000ms，动作至少 8000ms；系统 reduce 关闭通知位移动画。独立 `gift-audit` 页面复用控制器但保持独立 CSS，以一个固定 key 更新最新结果。

通知视觉统一采用雾蓝紫微渐变，背景、文字与动作样式由 `admin/toasts/system.css` 拥有，业务样式只保留图标和专属信息排版。无标题短提示使用 18px 状态图标与 14px 文字同排，不额外生成“成功／注意”标题；有标题的通知使用 15px 半粗标题、14px 说明和 4px 层间距，动作位于正文下方并左对齐。礼物的观众／来源及目录进度计数采用 13px 次级文字，金额独立展示；辅助核对页使用相同底色及短提示布局。

礼物通知通过 `recent.js` 的 `getGiftToastArtwork` 复用本地目录图片索引，优先按 `gift_variant_id` 匹配；旧记录仅在 ID 与名称唯一匹配时使用图片。盲盒通知使用实际产物图片，大航海使用客户端内置徽章。通知只读取本地 WebP，统一在 40×40px 区域内等比完整显示并异步解码；同一通知数量更新时复用相同图片节点。目录未就绪、无匹配图片或加载失败时显示 `gift-toast-fallback.svg`，不发起额外图片下载或全库预加载。

`utils.api(url, body, { notifyError: false })` 允许已有业务 catch 独占错误反馈；省略该选项时保留默认 `showError`，错误对象、HTTP 状态和 payload 仍原样传递。字段就地错误由 `shared/field-feedback.js` 关联 `aria-describedby`/`aria-invalid`，保留原字段说明，输入修改后清理。

`gifts/catalog-update-toast.js` 在 Admin 入口订阅既有授权目录进度桥，以单条 toast 原位显示后续图片下载的开始、已处理数量、完成或失败，完成后自动移除；首次初始化、目录检查和零下载更新不提示。订阅后再读取当前状态，较新的事件优先；本次后台更新在页面加载前已完成时也能显示结果。关闭页面或应用时清理订阅和计时器。进度字段由 [desktop/preload.md](../desktop/preload.md) 定义。

## 3. 启动时序

### 3.1 模块加载([index.js](../../../public/js/admin/index.js))

[document-end.html](../../../public/pages/admin/document-end.html) 加载 [index.js](../../../public/js/admin/index.js)，入口按序导入共享层与常驻 Admin 模块(顺序即依赖顺序):`shared/utils` → `shared/theme` → `desktop.js` → `import` → `queue` → `songs` → `theme` → `display` → `settings` → `gifts/*`(notification/detection/sprint/recent/blindbox/blindbox-analysis/history/index)→ `metrics` → `danmaku-tool` → `ai-assistant-settings` → `todo` → `other` → `gift-effects` → `desktop-lyric-preview` → `desktop-lyric` → `app.js`。同一分片另加载 `<script type="module" src="/js/playback.js">` 播放助手入口。

### 3.2 初始化([app.js:18-99](../../../public/js/admin/app.js#L18-L99))

开场动画、时钟、小游戏和加班机管理界面由 `toolbox-lifecycle.js` 在主页面与对应功能同时选中时动态加载。`other.js` 经注入的 `onFeatureSelected` 通知选择，主导航经 `setPage` 通知可见性；同一轮程序导航只激活最终选择。记忆选择也走此路径，重复进入复用已初始化模块，离开或关闭窗口后不执行迟到的初始化。首次进入使用各模块现有 HTTP 读取当前配置/会话，加班机同时从 StateService 取当前礼物检测与直播状态。服务器计时、游戏会话、抽奖授权及必要实时服务保持原生命周期。

桌面入口在解析正文前同时设置 `html` 和 `body` 的桌面样式。初始化期间保留标题栏与窗口按钮，显示启动提示；工作区使用 `visibility` 暂时隐藏以保留导航测量尺寸，在初始状态和歌库读取、主题预设渲染完成后显示。初始化失败也会解除隐藏并显示错误提示。

1. 初始化桌面外壳与设置表单入口；窗口按钮在账号信息读取前绑定
2. `initMainPages()` 绑定主页面 Tab(按 hash 选中初始页)
3. `formsService.initWorkspaceControls()` + `initTabs()`(播放器默认收起、ESC/空格快捷键)
4. `await Theme.loadThemeConfig()` 预载主题配置，再监听 `playback-module-loaded` 事件(播放助手模块异步加载完成后)调 `initPlaybackAssistant(options)`,把浏览器基础设施能力注入播放控制器
5. 通过 `legacy-admin-bridge` 初始化迁移期常驻模块；队列通过具名 ESM 初始化，四个可选工具编辑器通过上述激活入口初始化
6. `stateService.connectSocket()` + `await stateService.reloadAll()`(先 WS 后 HTTP 兜底)
7. 渲染主题预设卡片

## 4. 点歌主页面模块

### 4.1 queue.js(队列与 SC)

- 渲染:点歌队列 = `current + waiting` 拼表,置顶📌、序号、来源标签(`admin/danmaku/superchat/random:<scope>`/history)、SC 列表(价格降序、已处理状态);长歌名分级字号(`data-length="long|very-long"`);管理员队列字体预览(`--admin-queue-font-family`,[queue.js:236-243](../../../public/js/admin/queue.js#L236-L243))。
- 操作:`/api/queue/action`(next/clear/pin/unpin/delete)、`/api/superchats/action`(assist/unassist/delete),成功后 `reloadState()` 乐观刷新;清空队列走 `dangerConfirm` 二次确认;首行(当前播放)不显示置顶按钮,置顶按钮行为随 `is_pinned` 切换(↧/↑)。
- 状态条归属：`queue.js` 更新队列计数 `#queueSize`；歌库计数 `#songCount` 与 `#liveStatus` 由 `state-renderer.js` 按对应字段变化更新。
- 滚轮处理:队列内滚动用 wheel 事件归一化(deltaMode 换算),到达边界后放行页面滚动([queue.js:47-74](../../../public/js/admin/queue.js#L47-L74))。

### 4.2 songs.js(歌库)

- 渲染:`/api/songs` 列表(首字母/歌名/歌手/分类/标签/语言/可点状态/点歌价格)，空价格单元格留空；歌名下可展开歌切纯文本。行操作:编辑(载入表单)、入队(`/api/queue/add`,source=admin)、删除(`dangerConfirm` + `/api/songs/delete`)。
- 价格与歌切始终显示自由文本输入，编辑完整回填 `request_price/song_clip`，保存传 `requestPrice/songClip`；显式空值清空，表单重置清除 id、价格、歌切和快捷状态。价格快捷填写为免费/舰长/提督/总督/可编辑 SC 文本，不设置默认收费金额；预览用纯文本，空值留空。
- 价格显示 UTF-16 code unit 长度，超过 1000 通过输入有效性阻止提交，历史超长回填不截断。停用说明歌曲不出现在公开歌单；保存反馈仅确认本地成功，网页更新以云端同步结果为准。验收见 [点歌资料规范](../../../specs/song-request-metadata.md)。
- 筛选:搜索框 180ms 防抖、分类/标签多选(`details` 下拉 + 点击外部收起,见 [song-category-filter.js](../../../public/js/admin/song-category-filter.js))、语言/歌手下拉、`enabledOnly` 开关——任何变化触发 `reloadSongs()`。

### 4.3 settings.js(设置)

- 表单收集 `roomId/enableBilibili/paused/queueLimit/userCooldownSeconds/onlyFromLibrary/allowDuplicate` → `POST /api/settings`。
- 立即生效开关:礼物检测 `enableGiftSprint`、礼物提示 `enableGiftNotification`(失败回滚 checkbox)。
- Bilibili 扫码登录(仅桌面,`window.bilibiliAuth`,Web 模式禁用);登出走 `logoutConfirm` 弹窗。
- 盲盒映射:表单添加(chip 展示)/高级 JSON 编辑/逐条删除,保存到 `giftBlindBoxCustomConfigV2` 设置；官方项仅展示 `giftCategory=blindBox` 且有该完整身份的核验礼物产物或权益奖池的记录，同名或同 ID 的其他活动不继承奖池。官方卡片显示真实 gift ID，权益只显示名称和价值，不伪造礼物编号。服务器标为非盲盒的资料在目录更新后移出官方映射；¥15 七夕盲盒 `35429` 排除，¥25 七夕盲盒 `35141` 保留。默认显示当前直播间可送的盒型，其余通过带数量的按钮展开/收起。状态显示服务器确认的官方映射就绪情况及非零自定义/接管计数，不再显示旧配置迁移提示；当前服务端统一使用官方目录和新版私有配置。高级编辑的空配置显示说明，保留 dirty 草稿，未编辑的空状态不触发保存。
- 盲盒投屏:由 `blindboxOverlayTitle/Top/WinnersOnly/HeartBoxOnly` 实时生成 `/blindbox?top=&title=&winners=&heartBox=` URL([settings.js:354-380](../../../public/js/admin/settings.js#L354-L380))。
- 系统操作:清歌库/清 SC/清全部(`dangerConfirm` + `/api/database/*`)、退出(`/api/system/shutdown` 后整页替换为退出屏,桌面版带"重新启动"按钮)、刷新直播(`/api/bilibili/reconnect`)。

### 4.4 theme.js(点歌板)与 display.js(展示板)

- 两者共用 `fillForm` 把预设/快照值写回表单,`input/change` 事件 180ms 防抖自动保存到 `/api/settings`(`theme.js` 的 `collectTheme()` 收集约 40 个键;`display.js` 的 `collectDisplay()` 含 `songBoardSyncTheme` 开关——开启时歌单板跟随主主题)。`local-font-library.js` 统一查询、净化、去重并分发本机字体族;点歌板风格 3–6 与桌面歌词选择器共用一次查询,各自保留内置选项和已保存值。
- 预设卡片点击套用(`classicPresets`/`songBoardPresets`);`quickBeautifyBtn` 一键美化;点歌板样式切换(`overlayQueueStyle`:classic / identity / storybook / neon-vinyl / cherry-ribbon / golden-lily,遗留 festival 归一为 identity,需要重启时提示)。风格 1、2 的选择卡片使用中性底色,风格 3–6 保留素材主题色。管理页复用一组风格 2–6 控件,但通过 `queue-style-settings.js` 只填充并提交当前风格拥有的内容字号与纵向滚动设置;风格 3–6 的字体、字重、自定义正文颜色也分别持久化,切换或自动保存不会覆盖其他风格。风格 2 专属的置顶与规则设置不向插画风格显示或提交。
- `display.initOverlayUrls()` 生成 `/queue`、`/songlist`、`/lyrics` 的 OBS 地址文本(以 `127.0.0.1` 规范化)。

### 4.5 import.js(批量导入)

- 输入源:粘贴文本 或 文件(.tsv/.csv/.xlsx)。文本先解析表格(引号转义、表头别名映射 `歌名/歌手/分类/标签/可点/语言/核对平台/备注/点歌价格/歌切`,无表头按列位),`readTextFile` 做 UTF-8→GB18030 编码回退;xlsx 读 base64 提交 `/api/songs/import-xlsx`;结果渲染 `总行数/成功/重复/失败/新增分类`。
- 表头识别:命中任一别名(如 `歌曲名字`/`歌名`/`name`)才按表头解析,否则整表按固定列序([import.js:52-85](../../../public/js/admin/import.js#L52-L85));`可点` 列支持 `是/可点/true/1` 与 `否/停用/false/0` 语义。
- 价格别名与后端一致，新增「点歌条件 / 点歌说明」；保留原价格别名交给领域入口检查同一行的非空冲突，失败行显示解析后数据行序号和原因。相同值或只有一列非空可接受。默认重复歌曲明确显示“重复跳过（未更新已有歌曲）”，提示通过单曲编辑改价。
- 成功后 `reloadAll()` 使歌库、分类、计数立即生效。

阶段 4 [song-import-update.js](../../../public/js/admin/song-import-update.js) 由 app 初始化，拥有单一更新预览。模式默认“仅新增”，选择“更新匹配歌曲”后先预览；文本通过 `parseTable(text,{preserveMissing:true})` 保留实际列和无效行，XLSX 原样交本地接口解析。明确的空单元格清空选项默认关闭。

预览显示新增/更新/未改变/冲突/无效数量和逐行差异，每页最多 25 行，可查看全部页；差异用 textContent 展示。只有可应用预览才启用确认按钮。切换模式、文件、粘贴内容或空值选项使预览及在途旧响应失效；提交持有生成预览时的输入，禁止并行/重复提交。过期或失败后必须重新预览；成功反馈只说明本地更新，云端同步另行确认。核对平台导出保存值，默认新增仍跳过已有歌曲。

### 4.6 metrics.js(性能检测)

- 手动触发:`/api/system/metrics?windowMs=5000`(系统 + 服务进程 CPU/GPU/内存),5 秒采样,阈值 70%/85% 分 warn/danger 色阶([metrics.js:113-118](../../../public/js/admin/metrics.js#L113-L118))。
- 页面仅保留一个检测按钮；旁侧圆环待机显示 5 秒采样时长，采样期间按秒倒计时并收拢进度环，同时按钮进入 busy 态。结果展示采样窗口/时间/服务 PID/运行时长,不可用指标(如 GPU 缺失)置灰显示。
- 硬件概览在进入性能页时请求 `/api/system/hardware`，显示 CPU/物理 GPU/内存型号与容量并排除虚拟显示适配器；CPU 温度不可用时显示“未知”，内存不显示温度行，GPU 温度只随用户发起的 5 秒检测请求 `includeTemperatures=true`，不设置后台定时器。

## 5. 礼物主页面(gifts/)

渲染入口 `gifts/index.js` 的 `renderGiftPanel(gifts, sprint, live, diagnostics, settings)`,由 queue.js 在每次快照时调用:

礼物检测的权威端是 `D:/Work/lira-server`。Electron main 进程暂停本地 Bilibili 礼物 detector，通过 DeviceBearer SSE 与 final cursor pull 接收已处理 DTO，再调用内嵌 runtime 的 `importProcessedGiftEvent` 投影到本地 snapshot、历史、统计、加班机和 `gift:frame`；renderer 不持有远端 token、不访问 lira-server 礼物接口，也不解析原始 B 站报文。弹幕、点歌、SC、用户信息和小游戏仍沿本地连接运行。

| 子模块                                                  | 面板                                                                      | 数据源                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| detection.js                                            | 礼物检测状态(toggle + 共享收礼核心状态)                                   | snapshot `giftDetection`/`giftSprint`/`liveStatus`                                              |
| notification.js                                         | 礼物提示(桌面 toast,`gift-notify-toast`,最多 6 条)                        | snapshot `gifts.recent` 新增比对                                                                |
| sprint.js                                               | 月底冲刺(目标/已收/剩余,水晶球)                                           | snapshot `giftSprint`                                                                           |
| recent.js                                               | 最近礼物(最多 6 行,按精确礼物 ID 使用本地全局目录图片或占位图)             | snapshot `gifts.recent` + `/api/overtime/gifts/catalog` + `Events.GIFT_CATALOG_UPDATED` 图片映射 |
| blindbox.js                                             | 今日盲盒盈亏(汇总/盈亏榜/映射列表)                                        | `GET /api/gifts/blind-box-stats`                                                                |
| blindbox-analysis.js                                    | 盲盒分析工作区(观众排行/盲盒汇总/开盒记录三视图,25 条分页,500ms 刷新防抖) | `GET /api/gifts/blind-box-analysis?...`                                                         |
| history.js                                              | 礼物历史抽屉(时间范围/平台筛选)                                           | `GET /api/gifts/history`;清最近/清礼物走 `/api/gifts/clear-recent`、`/api/database/clear-gifts` |
| [gift-frame.js](../../../public/js/admin/gift-frame.js) | 礼物姬里的四方边框开关、金额阈值、主题/动效、预览和投屏地址               | `/api/settings`、`POST /api/gifts/frame/preview`、`app:settings-state`                          |

## 6. 百宝箱(otherAssistantPage)

礼物姬由 [gift-assistant.js](../../../public/js/admin/gift-assistant.js) 在首次打开时初始化，按「礼物边框」「滚动礼物」两个分区呈现。滚动礼物分区拥有显示行数、滚动速率（1–50，线性对应每行 5–0.1 秒，默认 25）、OBS 地址和共用词条价格配色，移除暂停和低功耗选项；草稿切换分区时保留，保存后生效，取消修改恢复已保存值。图片导出设置位于「最近礼物 → 查看全部 → 导出所选」的预览右侧，可调整输出方式、背景和保存文件夹；通过现有桌面接口即时应用于本次导出并保存为后续默认设置。调整导出设置保留记录与样式快照，导出期间禁用设置。滚动与导出共用今日卡片合并规则，导出在分页前按 UID、礼物 ID 和礼物名合并所选今日记录，并采用该用户今日最新已知昵称/等级、累计数量和金额配色；预览区同时显示原始选择条数、卡片数和 PNG 数。历史日期、原始流水及统计不合并，身份资料未就绪时说明部分礼物尚未合并。桌面接口见 [preload 桥](../desktop/preload.md#礼物图片导出设置)。

`other.js` 只负责**功能导航**(侧边栏整体可折叠、四个功能分组可独立折叠、方向键/WAI-ARIA tab 模式、localStorage 记住整栏折叠与选中项);[shell-start.html](../../../public/pages/admin/toolbox/shell-start.html)将不变的功能 ID 按直播互动、直播画面、主播工作、软件与帮助四组呈现,各面板仍由独立模块初始化:

| 功能                | 模块                                                                                                                                                                                                                                                                                                      | 内容与数据源                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 弹幕姬              | [danmaku-tool.js](../../../public/js/admin/danmaku-tool.js)                                                                                                                                                                                                                                               | 面板按连接状态、弹幕姬、发送弹幕、AI 回复和固定回复归类；固定回复组统一放置点歌未匹配、签到、抽签和 DIY 关键词回复开关及词库编辑器。弹幕姬区域的复制/打开按钮使用当前授权账号的服务器 `/overlay` 地址。样式选择提供真实缩略图、名称与差异说明，分为固定位置（聊天气泡/深色面板/蝴蝶结/大头像气泡/透明文字/头像横卡）和全屏随机（简洁白卡/奶油气泡）；「本地预览」使用本机 `/danmaku?preview=1`，八种风格在同一网址切换，示例完整且不循环。选择只改草稿，「应用到服务器」通过既有 bridge 提交 `style` 与 `fullscreenDurationSeconds`，保存成功后由服务器通知正式 OBS 页面，预览不写配置。固定样式按顺序排列；透明简约统一身份视觉并在正文下显示粉丝牌等级，其余固定样式保留各自身份视觉。全屏随机只显示发送者和正文，在整个画布内随机散布并按设置秒数消失。身份横卡(`identity`)作为第六种固定样式，在 624×640 设计画布中使用 600px 宽、至少 92px 高的卡片、右侧头像和四档身份底色，随浏览器源取宽高较小倍率等比缩放。发送弹幕只保留在 Admin（`/api/bilibili/danmaku/send`,Ctrl+Enter 快捷发送,超长自动拆条并提示条数），不另设网页地址。连接/账号/房间状态来自 `/api/bilibili/danmaku/state`，断开时可一键重连并回读新状态；四个机器人开关为 `enableRandomTagReply/enableCheckinBot/enableFortuneBot/enableCustomReplyBot`，无发送权限时禁用 |
| 弹幕库编辑器        | [danmaku-libraries.js](../../../public/js/admin/danmaku-libraries.js)                                                                                                                                                                                                                                     | 签到祝福语 / 抽签词库 / DIY 关键词回复 三个编辑器的工厂(加载/增删/脏标记/保存到对应 settings 键)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AI 互动助手         | [ai-assistant-settings.js](../../../public/js/admin/ai-assistant-settings.js)                                                                                                                                                                                                                             | 模型服务配置:`/api/ai/config`(PUT 保存)、`/api/ai/status`、`/api/ai/test/<provider>`、`/api/ai/models`；电脑端先选自动识别、DeepSeek、OpenAI、Claude、Gemini 或自定义，官方预设锁定地址/协议，自动与自定义允许编辑；按服务端 `modelEndpoint` 显示协议、联网方式与可用推理控件；密钥字段使用 password + `'********'` 遮罩且提交时过滤遮罩值；700ms 自动保存 + 保存失败重试队列                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 礼物姬 · 礼物边框   | [gift-frame.js](../../../public/js/admin/gift-frame.js)                                                                                                                                                                                                                                                   | 保存 `giftFrameEnabled`、`giftFrameThresholdRmb`、`giftFrameTheme`、`giftFrameMotionMode`；预览只发 `gift:frame` 事件，不影响实时开关与事件去重                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 加班机              | [overtime.js](../../../public/js/admin/overtime.js) + [overtime-rule-editor.js](../../../public/js/admin/overtime-rule-editor.js) + [overtime-rule-model.js](../../../public/js/admin/overtime-rule-model.js) + [overtime-rule-effect-editor.js](../../../public/js/admin/overtime-rule-effect-editor.js) | 控制台:启用/开始/暂停/重置(`/api/overtime/action`)、初始时间(`/api/overtime/time`)、礼物规则编辑器(固定时间 / 时间盲盒,`/api/overtime/rules`)、背景(`/api/overtime/config`)、结算流水、内置 `/overtime` 预览 iframe(`?quality=low`);规则编辑器只负责编排 DOM 与事件，规则归一化/校验和效果编辑分别由 model/effect-editor 拥有；**Round-trip contract**:前端从 `GET /api/overtime` 的 `limits` 字段获取服务端限制(maxSeconds/maxEffectFactor/maxRandomWeight/maxEnabledRules),用于 UI 提示与客户端验证;前端必须保留服务端接受的任何值,即使超出 UI 输入控件范围(如 999h 小时选择器无法编辑 9999 年的值),只读展示 + 隐藏字段保存,最大值验证交给服务端;详见 [overtime.md](../backend/overtime.md) §4                                                                                                                  |
| 小游戏直播台        | [games.js](../../../public/js/admin/games.js)                                                                                                                                                                                                                                                             | 固定 `/games` 地址 + 数字炸弹/五子棋/你画我猜单会话互斥；第三张画猜卡片向下展开，可设置 1–12 局和每局 15–300 秒，并从 9 类、每类 100 词的固定题库中全选、清空或组合本场分类，未选分类时禁止开局，开局后锁定选择；`GET /api/games/host-state` 私下显示题词并恢复 `categoryIds`，`game:update` 驱动主持状态与 10/7/5/3 积分；画猜控制拆分为结束作画、公布答案、开始下一题，超时后仍捕捉弹幕但不计分；独立 `/wheel` 不参与互斥                                                                                                                                                                                                                                                                                                                                                                                       |
| 主播工作台          | [todo.js](../../../public/js/admin/todo.js)                                                                                                                                                                                                                                                               | **纯 localStorage 工作台**(`admin.streamerWorkbench.v3`):按月管理直播/工作/个人日程,按天查看时间与备注;备忘支持编辑、置顶、删除和转为待办,待办支持编辑、完成筛选与删除;首次读取 v2 时将已填写场次迁为日程并精确移除历史内置任务,读取 v1 时仅导入自定义任务,两类旧键均保留;当前存储不可读时暂停写入,不经过后端                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 萌时钟              | [clock-card.js](../../../public/js/admin/clock-card.js)                                                                                                                                                                                                                                                   | 只展示并复制固定 `/clock` Browser Source 地址；桃桃便签/星夜软糖/汽水小鸭/横向刻度/竖向刻度/白字数显、日期/秒数、12/24 小时制和装饰款 16 字角标文案经设置接口持久化，同时用同页 iframe 按横竖画布即时预览                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 性能检测            | metrics.js(见 §4.6)                                                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 使用文档 / 桌面更新 | [usage-guide.js](../../../public/js/admin/usage-guide.js) / [desktop.js](../../../public/js/desktop.js)                                                                                                                                                                                                   | 目录锚点平滑滚动与章节高亮、侧栏收缩时切换双栏目录;更新检查/下载/安装进度条、重启确认弹窗、`desktop-set-auto-update`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 首次启动引导        | [onboarding.js](../../../public/js/admin/onboarding.js) / [interactive-tour.js](../../../public/js/admin/interactive-tour.js)                                                                                                                                                                             | 配置遮罩通过现有认证、设置、AI 接口验证状态，完成标记写入普通 settings；交互式导览只在用户配置首次使用时自动展示一次，并立即写入 `localStorage.liraTourFirstRunShown`，已有任意 `liraTourCompleted` 值也视为展示过，覆盖安装、版本升级和手动重看均不重新启用自动展示                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

桌面歌词设置页(点歌主页面 Tab):[desktop-lyric.js](../../../public/js/admin/desktop-lyric.js) 收集 `desktopLyric*` 12 个键 → `/api/settings`,500ms 自动保存(带"等待自动保存/已保存/失败"状态条);客户端打开设置页时自动通过 Chromium `queryLocalFonts()` 读取、去重字体族名称并追加到主字体下拉框,若 Chromium 首次调用要求瞬时用户激活则在用户首次正常点击/按键时自动重试,不提供单独获取按钮;权限边界与原生确认见 [desktop/main.md](../desktop/main.md) §4;[desktop-lyric-preview.js](../../../public/js/admin/desktop-lyric-preview.js) 用 `LyricWordRenderer` + 弹簧动画控制器(`SPRING_STIFFNESS=170, SPRING_DAMPING=26`,[desktop-lyric-preview.js:26-29](../../../public/js/admin/desktop-lyric-preview.js#L26-L29))渲染完整时间轴预览,滚轮缩放、暂停 6 秒手动跟随。

## 7. 设置持久化流程

```
表单 input/change ──→ debounce(180ms)/autosave ──→ POST /api/settings {key:value,…}
   ↑                                                       │
   │                        settings-store 写库(见 storage.md §7)
   └── WS snapshot(settings 字段)全量回推,fillForm 写回表单(正在编辑的控件除外)
```

- 所有设置键经同一个 `/api/settings` 端点(端点定义见 [api.md](../backend/api.md));DB 持久化与默认键见 [storage.md](../backend/storage.md) §7。
- 前端不维护"已保存"标志:每次快照都回灌表单,保证多窗口/叠加层视觉一致;AI 配置等含密钥的设置**不**走通用 settings(见 [storage.md](../backend/storage.md) §3.1 `ai_configuration`)。
- 各表单的保存节奏不同:点歌板/展示板 **180ms 防抖自动保存**(input/change),设置页**提交时保存**,桌面歌词 **500ms 自动保存**(带"读取设置中→等待→已保存"状态条与失败重试,[desktop-lyric.js:31-90](../../../public/js/admin/desktop-lyric.js#L31-L90)),AI 互动助手 **700ms 自动保存**。
- `fillForm` 的"正在编辑不覆盖"规则([forms.js:174-179](../../../public/js/admin/forms.js#L174-L179)):快照回灌时跳过 `document.activeElement`,避免用户输入被实时快照打断。

## 8. 播放助手页(playbackAssistantPage)

见 [playback.md](playback.md):播放器面板(默认收起 dock)、快捷入口、WeSing 歌词现场面板、在线搜索、点歌匹配诊断区由 `playback/*` 渲染,桥接方式见 [app.md](app.md) §3.2 的 `initPlaybackAssistant` 注入。

## 9. 子页面:gift-audit.html

| 页面                                                     | 用途                                                                                                                                                                           | 数据源                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| [gift-audit.html](../../../public/pages/gift-audit.html) | **气泡 × WebSocket 交叉对比审计**:左右两栏分别显示直播间气泡流事件与 WS 收到的事件,逐一核对礼物/SC 是否一致、缺失与多出;支持时间范围过滤、事件详情、手动重放投递(测试通知链路) | WS `/ws` + `GET /api/state`(基线) |

该页面使用独立 HTML、CSS 与 ES Module 脚本,无构建依赖;经 `/pages/gift-audit.html` 文件路径直接访问(不在 pageMap 中,见 [pages.md](pages.md) §2)。

云端签到/抽签由 `public/js/admin/danmaku-daily-bots.js` 独立初始化，开关不读取本地 canSend；`danmaku-daily-bot-takeover.js` 仅在 pending/importing 时提供一次性核对与词库修正。移除两项日常编辑器和 fixed-replies 对其 DOM 的依赖，保留其他固定回复入口。页面打开、显式刷新、恢复网络时读取；账号切换清空草稿并隔离迟到响应。

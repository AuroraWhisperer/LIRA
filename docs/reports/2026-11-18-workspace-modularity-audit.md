# LIRA 客户端与服务端模块化审计

2026-11-18。按当天磁盘上的两个开发工作树审阅，包含当时未提交及未跟踪的第一方源码。客户端 HEAD 为 `a6c78d82747d`，服务端 HEAD 为 `3c04ea6565e2`。下文 `Live/` 对应客户端仓库，`Server/` 对应同级 `lira-server` 仓库，路径与行号指本次审计时的版本。

## 结论与处理顺序

建议保留现有模块化单体，优先把已经给出不同结果的业务判断交回同一个模块。按风险分三批，前一批可以独立验收。

| 顺序 | 建议进入的改动 | 能证明改对的结果 |
| --- | --- | --- |
| 一，数据归属与账务 | 桌面歌库相同快照的替换判断、延迟点歌事件的账号归属、官方盲盒的估价身份 | 重启后歌曲 ID 仍关联原记录。切号后新账号保有自己的额度及冷却。官方盒接管中的直送礼物按直送入账。 |
| 二，快照、回执和故障 | 服务端歌库提交后再发版本，客户端盲盒映射接纳回执，官方目录首读与新推送排序，保存或授权文件失败的恢复，自助重置密码的成功判定 | 订阅者只收到已提交版本，两个入口接纳同一映射，慢响应不能回滚奖池，失败重启仍能读到旧授权，重置页只有在服务端明确确认后才清表。 |
| 三，同规则单点维护 | 客户端两份画布布局与两份样式参数、播放时间索引和曲目编码、服务端单笔礼物指标、测试资源清理 | 在原有消费者上检查结果一致，同时减少下一次改规则、排查失败需要追踪的实现数量。 |

代码可读性方面，优先让名字和参数区分“事件捕获时的账号”与“现在登录的账号”，“内容版本”与“发送序号”，“全局官方目录”与“房间在售目录”。这三组概念在本次复现中直接影响数据。规模报告适合作为审查入口，单凭行数无法决定哪段状态或事务应一起移动。

## 覆盖与证据

六个子代理分别复核客户端领域与本地存储、Electron 与原生音频、管理界面、播放与直播画面、服务端后端、服务端网页。主审负责全量文件清单、静态依赖图、相似性分析、跨仓协议、工程和测试代码，并复核候选的调用点与适用条件。

| 检查口径 | 客户端 | 服务端 |
| --- | ---: | ---: |
| Git 已跟踪及未忽略的未跟踪文件，审计开始时 | 3,726 | 2,329 |
| 进入代码、页面、样式、脚本及选定配置扫描的文件 | 2,364 | 1,150 |
| 其中 JavaScript、CJS、MJS，均成功语法解析 | 1,908 | 1,027 |
| 其中运行期 `src/` 与 `public/` 文件，含页面及样式 | 1,513 | 567 |
| 测试、测试夹具及 e2e 代码 | 761 | 537 |
| 原生、安装、脚本、工具及选定根配置 | 90 | 46 |
| 另核对可解析的版本化及未跟踪 JSON，部分与上面重叠 | 64 | 146 |
| 自带规模报告的扫描文件 / 超过提示线 | 2,395 / 26 | 1,076 / 20 |

从 Git 清单辨认项目维护的源文件。对 2,935 份 JS 用 Acorn 解析，在函数体至少 35 个 token 时比较保留字面量和属性名的 token 序列，并增加标识符归一化的一轮。25,330 个达到阈值的函数与回调中，跨文件出现 285 组同 token 函数体，归一化口径为 316 组，两者有重叠。对页面、CSS、C#、NSIS、脚本和测试也比较连续七行有内容的文本窗口。去除 CRLF 差异后有八组整文件相同。这些数字用于找候选，一段生成代码及其内部回调就能贡献多组命中。

客户端依赖图识别到 1,094 个产品模块、2,688 条本地边。用相同识别口径补查服务端 `src/` 和 `public/` 得到 457 个模块、1,022 条本地边。两张图在可静态解析的边上均无环。另查 143 份 HTML 的内联脚本与事件属性，两个内联脚本均可解析。106 份 SVG 的脚本与事件属性扫描没有命中。服务端的浏览器全局注册、页面脚本顺序、动态路径、IPC 和运行时订阅需另查消费者。人工复核集中于各功能区的入口、规则、调用方、已有测试和候选差异，逐行复核的深度随候选风险而异。依赖、二进制、媒体、历史档案、运行库、用户数据库、缓存、发行产物与已有 `output/` 交付文件只按目录用途划界。

## 桌面同步、进程与原生音频

**同账号相同歌库的冷启动拉取会断开已有歌曲关联。** `restorePending` 比较规范化歌曲内容，识别相同内容时只接纳归属。无待传记录的普通拉取却在通过版本检查后无条件替换歌库，删除旧歌曲时会把队列与点歌历史里的 `song_id` 置空。用内存 SQLite、真实 SongStore 与先后启动的两个同步控制器模拟重启，两次云端版本均为 3，歌曲 ID 从 `1` 变为 `2`，原队列及历史行保留了曲名，两处关联从 `1` 变为 `NULL`。证据在 `Live/src/electron/cloud-song-sync-controller.js:20` 与 `:53`、`Live/src/storage/song-store.js:436`。

建议由同一处决定什么时候需要整库替换。同一已确认归属、通过校验且内容相同时，仅接纳同步版本。账号切换和内容真实变化各走应有的替换路径。扩展 `Live/test/cloud-sync/cloud-song-sync-recovery.test.js:129`，覆盖无待传内容的重启，直接断言队列与历史的原 ID 仍能关联到原曲。

| 发现及源码位置 | 实际后果 | 最小改进和验证 |
| --- | --- | --- |
| 本地媒体授权文件。`Live/src/electron/local-media-access.js:44`、`:69`、`:79` | 文件系统替身模拟原文件被截断后写入失败。原进程仍有 1 条授权，重新打开清单变成 0 条。 | 使用已有 `Live/src/electron/atomic-file.js:6` 的同步原子替换。失败后、重试前重开，确认老授权保留、新授权尚未生效。 |
| 上传回执中的盲盒映射。`Live/src/electron/cloud-sync-controller.js:107`、`:328`，共享成功分支在 `Live/src/electron/cloud-settings-sync-controller.js:29` | 相同回执从普通设置入口上传，本地映射变为版本 2、1 项。从礼物互动入口上传，本地仍为版本 1、0 项，设置版本已经推进，随后同步跳过更新。 | 在共用成功分支应用映射，遵守账号及本地修改代次。用同一回执校验两个入口，再让旧回执后到，验证保留新修改。 |
| 首次打开主窗口。`Live/src/electron/desktop-main-window.js:38`、`desktop-readiness-controller.js:127` 与 `:135` | 替身窗口首次加载 `/admin` 失败，再收到就绪及授权通知，总共只有一次加载。首屏直接导航，去重状态仍认为目标路由已到达。 | 请求认证绑定完成后，首屏复用有失败清除行为的导航函数。检验同路由重试一次及迟到的旧失败不得清除新目标。 |
| 电音助手等待组件时停止。`Live/src/electron/audio-assistant.js:27` 与 `:84`、`Live/native/audio-assistant/AudioSession.cs:249` | 在受信 IPC 夹具中暂缓组件准备，依次启动、停止，再放行组件。停止应答成功，worker 收到的命令却只有启动。管理页通常等 ready 才开放开关。 | 停止时作废尚未下发的启动意图，写入 worker 前复核。验证旧意图不再发出，新的显式启动仍能完成。 |
| 设备输入固定关闭音乐处理。`Live/native/audio-assistant/AudioSession.cs:151`、`AudioEngine.cs:113` 与 `:164`、`StemSeparator.cs:116` 与 `:139` | 静态路径显示该会话采样走直通，启动仍构造分离器、加载及校验清单大小 9,415,676 字节的模型并执行预热。 | 仅对本次固定关闭的设备输入省去分离器。歌曲模式支持运行中调强度，需要独立判断。合成 PCM 可检查零模型构造、输出采样相同。耗时收益须另行测量。 |
| 外观与桌面通知持久化。`Live/src/electron/client-appearance.js:25`、`desktop-notifications.js:88` | 两处手写排他临时文件、flush、Windows 短锁重试及清理。下次调整短锁处理会涉及两个实现。 | 两个消费者共用异步文件替换函数，各自拥有串行设置更新及通知副作用。用已有短锁、永久失败及并发设置用例保护。 |

窗口、主 frame 和 origin 的校验已有共同入口，具体页面获准的操作由各 IPC 适配器负责。PCM 播放、采集与 DSP、退出后恢复原声的守护各有独立资源生命周期。对应 `Live/src/electron/ipc/main-window-ipc.js:12`、`Live/native/audio-assistant/PlaybackOutputs.cs:58`、`RouteSession.cs:133`。

## 本机业务与存储

**先修点歌的账号归属。** B 站监听器创建时捕获账号 A。当 A 的点歌事件延迟到切换后的账号 B 才入队，流水根据捕获的 `fanScope` 把归属置空，粉丝归档正确跳过。同一事务却用当前账号 B 写每日额度与歌曲冷却。内存 SQLite 中给 B 设置每日限额 1，处理 A 的延迟事件后，B 的同一观众第一次正常点另一首歌就收到 `USER_DAILY_LIMIT`。入口见 `Live/src/server/bilibili-client.js:24` 与 `:73`，分歧位于 `Live/src/storage/queue-store.js:84`、`:96` 与 `:110`，事务前还在 `Live/src/music/queue-service.js:47` 读取当前账号冷却。

入队时应解析一次事件归属，区分正常本机无账号与旧账号事件。共享队列按现有约定接纳延迟请求，私有额度、冷却预查与写入、粉丝归档使用同一判定。现有队列测试覆盖正常切号，粉丝测试覆盖过期事件。把两个条件放进同一用例，验收 B 的首个合法请求仍成功，且 B 没有 A 的歌曲冷却。见 [每日额度用例](../../test/songs/queue-service.test.js)和[共享队列与粉丝归档用例](../../test/fan-profiles/fan-profiles-music.test.js)。

| 其他发现 | 后果与处理边界 | 聚焦验证 |
| --- | --- | --- |
| 礼物价格到整数分的换算。`Live/src/bilibili/gift/query-service.js:401`、`Live/src/storage/gift-query-store.js:545`，现有契约在 `Live/src/shared/processed-gift-contract.js:416` | 已有异常账本行单价 `-0.25`、总价 `1` 时，明细展示负单价，统计报 `INVALID_GIFT_MONEY`。正常入站已校验。价格复用同一非负规则，盲盒盈亏允许负数、未给出的成本允许为空，各入口保留原错误约定。 | 内存 SQLite 已比较正常、负数和精度超限。回归让明细与统计读同一行受损记录。 |
| 歌词缓存的歌曲身份。`Live/src/music/lyrics-service.js:29`、`Live/src/music/track-contract.js:15`、`Live/src/music/providers/netease-mappers.js:52`、`qq-provider-utils.js:113` | 只给带平台前缀的 `id`，与同时给出裸 `sourceTrackId` 的输入会形成不同缓存键。QQ、网易云 provider 随后却得到相同曲目 ID。将本平台前缀剥离规则用于缓存和 provider，保留对外曲目 ID 与 QQ 数字标识的独立语义。 | 两个平台分别用内存缓存和模拟上游，先提交两种输入、再重复第一种，结果均为两次请求、第三次命中。整改后应只有一次上游调用。 |
| Kimi 型号能力匹配。`Live/src/ai/model-reasoning.js:19`、`Live/src/ai/model-protocol.js:45` 与 `:70` | 能力表匹配已知型号，请求构造部分规则按系列前缀。合成的未列出 K3 后缀无已知能力，却把请求预算从 128 提至 4096。应先明确哪些能力按系列继承，再让协议编码只使用已解析的结果。 | 合成型号只证明本地分支差异。已知型号、未列出的型号及目录显式声明应各有明确预期。 |

设置云同步的空 owner 有“脱离旧基线、等待恢复”含义，歌曲云同步保留原歌库 owner 以决定播种。两者的恢复判断宜独立。投票只认同一观众的首张有效票，评分允许改分，会话层已共用来源检查及截止时间。字体服务生产装配已委托给同一公共资源库。相关入口在 `Live/src/storage/cloud-settings-sync-store.js:12`、`Live/src/storage/cloud-song-sync-store.js:14`、`Live/src/games/interaction-session-service.js:155`、`Live/src/server.js:177`。

## 桌面管理界面

| 发现及源码位置 | 实际差异 | 建议与验收 |
| --- | --- | --- |
| 官方礼物目录。`Live/public/js/admin/gifts/index.js:17`、`artwork-catalog.js:110`、`blindbox.js:247` 与 `:269` | 无房间号冷启动的内存夹具捕获两次相同的本地 GET。新版官方推送先到、旧 GET 后到时，奖池先显示新版再退回旧版。 | 图片索引和盲盒映射共用一次在途全局快照读取，各自处理返回值。由较新的官方推送使旧请求结果失效。用慢首读夹具验证一次 GET 和最终奖池，房间在售目录保留自己的刷新条件。 |
| 账号首读与推送。`Live/public/js/admin/danmaku-tool.js:60`、`danmaku-pk-report.js:139` 与 `:201`、`danmaku-viewer-names.js:230` | 几个面板各自向 bridge 读取并监听账号。初始键为空，先收到断开事件，再收到较早的授权首读，PK 夹具又读取了一次旧账号设置。 | 复用 `Live/public/js/admin/authorized-account.js:20` 的订阅顺序。每次推送均使较早的首读失效。让各业务面板继续管理自己的请求与草稿，验收多个面板共用一次账号首读，断开后旧请求数为零。 |
| 许愿富文本。`Live/public/js/admin/text-box-editor.js:20`、`gifts/wish-text-editor.js:48` 与 `:71`、`gifts/wishes.js:315` | 同一编辑树 `<div>甲</div><span>乙</span>` 在文本框中读成两行，许愿模板及格式片段读成一行 `甲乙`。两种值会用于保存。 | 共用块元素与末尾占位 `<br>` 的换行判断，变量、媒体、格式片段仍由各编辑器处理。在 `Live/test/gifts/frontend-gift-wishes.test.js:703` 补同一例的模板和片段结果。 |
| 摇摇乐首次放置。`Live/public/js/admin/gift-motion-settings.js:126`、`component-preview-canvas-view.js:250`、`component-preview-definitions.js:47` | `2560×1440` 画布上，设置页初次预览建出宽 `2560`、`x=0` 的图层，画布选择器建出宽 `1920`、`x=320` 的图层。高度均为 `420`。使用指南约定默认宽 `1920`。 | 设置页调用现有 `createInitialPreviewItem`，继续优先选中已有同款图层。在宽画布比较两入口，再次预览时检查用户已调尺寸。参见 `Live/public/pages/admin/toolbox/usage-guide-guard-thanks.html:7`。 |
| 点歌板保存反馈。`Live/public/js/admin/theme.js:35`、`queue-theme-view.js:82`、`settings-autosave.js:66` | 参数视图与自动保存同时写同一页脚。夹具中保存失败后继续输入、失焦，提示由错误变为待保存，重试按钮换回普通保存。 | `bindComponentAutosave` 统一驱动页脚，字段视图只负责回填。用现有 `shared/save-status.js` 展示，在失败、编辑、失焦、重试成功的顺序下验证提示与按钮。 |
| 水平标签的键盘行为。`Live/public/js/admin/client-settings.js:14`、`danmaku-tabs.js:9`、`fans/index.js:330`，标记位于 `Live/public/pages/admin/toolbox/fan-profiles.html:11` | 静态接线显示设置页和弹幕页都维护方向键、Home/End 和单一 Tab 停靠点，粉丝档案只同步选中标记与显隐。 | 现有 `Live/public/js/admin/forms.js:36` 已有同类按键处理并使用特定选择器。提取适用的焦点与按键行为供三处复用。各页保留自己的切换回调，仅触发一次切换，用键盘验证焦点与可见面板一致。 |

弹幕功能页和画布已经复用 `Live/public/js/shared/danmaku-parameter-controls.js:41`，两个收藏入口也已接到本轮未跟踪的 `Live/public/js/admin/danmaku-style-favorites.js:46`。许愿与加班机选择器已共用选项和图片绑定，前者按 `variantId` 筛选，后者要匹配 `giftIdentity` 并支持替换规则。

## 客户端播放、歌词和直播画面

| 发现及源码位置 | 隔离观察 | 建议与验收 |
| --- | --- | --- |
| 歌词失败被缓存。`Live/public/js/playback/services/lyric-service.js:40`、`features/playback-controls.js:241`、`state/actions.js:73` | 请求失败返回 `null`，状态写入空歌词数组。同一曲目对象第二次可获取歌词，仍命中空数组，两次合计仅发出一次请求。 | 区分请求失败、成功返回空歌词和本地曲目跳过查询。再次播放时可重试失败请求，换曲后迟到内容仍须丢弃。 |
| 「玻璃气泡」醒目留言金额样式。`Live/public/js/overlays/danmaku-glass-bubble.js:64`、`Live/public/js/shared/danmaku-text-appearance.js:573`、`Live/public/js/overlays/danmaku-appearance-values.js:24` | 用合成 100、200、499 元消息得到 `blue`、`cyan`、`cyan`。外观的「SC 100–499」字段只对应 `blue`，200–499 元被礼物金额颜色选中。既有样本从 100 跳至 500。 | 外观控件覆盖该区间的两个主题色阶。用独立 200 元消息分别改变 SC 色与礼物色，保留主题自身七档配色。 |
| 场景把渲染异常报成断连。`Live/public/js/overlays/display-source.js:118`、`scene.js:14`、`danmaku-component-source.js:22` | 输出响应 HTTP 200，模拟 `renderer.update` 抛错后仍进入 `disconnect()`，传给 `onError` 的参数为零。排查时缺少故障阶段。 | 共用入口区分读取、解析与渲染失败，记录阶段和可用状态码。连续同态故障只报告一次，继续验证原重连及撤销场景。 |
| 歌词发布去重。`Live/public/js/playback/services/lyric-service.js:129`、`:219`、`Live/public/js/playback/core/initializer.js:79` | 歌词缺值比较用 `undefined`、记录用 `null`，连续三次同步让代次从 1 变 3。有歌词时递增序号参与内容签名，暂停同一位置相隔 250 毫秒又发出一次本地 POST。 | 用相同缺值及业务字段判断变化，发布时才附带顺序号。用假时钟验证静止时的请求数，显式跳转和在途更新继续按原顺序送达。 |
| 旧礼物审计页。`Live/public/js/gift-audit/index.js:42`、`:77`、`:153` | WS 断开后 HTTP 已有新礼物，比较却命中旧缓存并标成 `miss`。切换至空来源 B，来源 A 的礼物又被标成 `match`。此页目前仅保留在源码中。 | 若继续维护此诊断页，HTTP 与 WS 通过一个按来源及 `viewRevision` 更新的入口，换来源时清空，断线比较前核对当前快照。 |
| 互动浮层失效请求的重试。`Live/public/js/overlays/interactions.js:27` 与 `:111`、`Live/public/js/shared/interaction-client.js:22` | 新读取成功后，较早的请求失败，仍在 1500 毫秒后发出第 3 次本地 GET。 | 让成功与失败都复核请求代次。现有顺序用例增加“旧失败迟于新成功”，保留当前请求失败时的正常重试。 |

**三处可直接减掉的维护点。** 在线曲目的音源与歌词请求可以共用现有 `serializeTrackForProvider()`。同一合成 QQ 曲目的歌词请求体缺少音源请求已有的 `sourceSongType`、`sourceMediaId`，真实上游结果需单独验证。全屏播放器、桌面歌词与歌词发布均查找“不晚于当前位置的最后一行”，可共用已有索引函数，各自负责时间偏移和行对象转换。独立歌词页使用三个窗口布局类，却导入含 16 个直接 `@import` 的播放器样式入口，可直接引用已有窗口样式，并验证透明背景。依据依次为 `Live/public/js/playback/services/lyric-service.js:316`、`Live/public/js/playback/utils.js:84`、`Live/public/js/lyrics/desktop-lyric-timeline.js:32`、`Live/public/js/playback/ui/fullscreen.js:305`、`Live/public/pages/overlays/lyric-window.html:10`、`Live/public/css/playback/desktop-lyric.css:1`。

每款固定弹幕的卡片结构与运动由主题拥有，公共 feed 管理布局及移除。礼物导出与直播横幅已经共用 `createGiftBanner()`，导出等图片就绪、直播接收增量，各有独立的时序。对应 `Live/public/js/overlays/danmaku-message-renderer.js:65`、`gift-export.js:14`、`gift-feed.js:81`。

## 同一份显示契约有两套手写实现

客户端画布布局的区域限制、老配置补齐、分辨率缩放和拖动规则有两个编辑点。两份布局逐行比对只在 `CANVAS_PRESETS` 导入及模块导出上不同。组件样式参数也有同样情况，字段、能力表、校验、默认值、按样式编辑的函数均相同，差别为模块语法。浏览器预览和本地场景保存分别经过这两份实现，修改一边可能导致能预览的设置无法保存，或显示与保存采用不同几何规则。现有一致性用例均通过。证据见 `Live/public/js/shared/danmaku-layout.js:70`、`Live/src/shared/danmaku-layout.js:70`、`Live/public/js/shared/component-style-parameters.js:77`、`Live/src/shared/component-style-parameters.js:79`。实际消费者有 `Live/public/js/overlays/danmaku-region-editor.js:1`、`Live/src/server/scene-components.js:10`、`Live/src/server/clock-contract.js:3`。

建议按主题在客户端各维护一份纯计算源。Node 接入可沿用本仓纯 ESM 被 Node 读取的先例，确认导入链和打包后再收薄兼容入口。若选用已有的本地生成方式，应能用只读 `--check` 发现过期产物。保留特权入口对外来配置的完整校验。现有 `Live/test/danmaku/danmaku-layout.test.js:110`、`Live/test/scenes/component-style-parameters.test.js:69` 及保存和输出的集成场景可以保护迁移。服务端兼容目录有单独生命周期，本次比较的弹幕效果能力表在桌面有 47 款、服务端有 25 款，例如桌面额外拥有 `neon-glass`。按服务端 ADR-0118，桌面新样式由本机负责。

## 服务端业务与事务

| 发现及源码位置 | 已复核的后果 | 最小改进和验证 |
| --- | --- | --- |
| 谁算官方盲盒。`Server/src/modules/gifts/gift-client-catalog.js:229`、`Server/src/lib/gift-blind-box-config.js:159` 与 `:197`、`Server/src/modules/streamer/cloud-state.js:246`、`Server/src/modules/bilibili/gift-valuation.js:188` | 设置写入和接管按官方分类的名字或 ID 排除私有项，估价却只从有普通礼物奖池关系的盒子建立排除集。内置清单有一个官方盒 ID 无该关系。模拟目录更新后租户旧配置仍在的窗口，同名及同 ID 的写入均被拒绝，估价却将直送礼物记为盲盒产物，产生 2 元成本、1 元盈亏。 | 共用官方盒名称与 ID 判定，奖池关系继续单独用于产物匹配。覆盖“目录已更新、租户旧项尚待归档”的新礼物组，验证直送礼物的估值。 |
| 歌库版本发布。`Server/src/modules/streamer/song-library-sync.js:89` 与 `:91`，提交后回调先例在 `Server/src/modules/admin/streamers.js:114` | 内存库中外层事务回滚后歌曲和版本均停在 1，订阅者已经收到版本 2。触发条件是已有外层事务。普通 HTTP 路径直接调用写入服务。 | 让最外层成功提交的一方发布版本。扩展 `Server/test/song-library-sync.test.js:59` 的嵌套回滚场景，直接观察通知次数与版本。 |
| 同一笔礼物的整数分贡献。`Server/src/modules/streamer/gift-statistics.js:75`、`gift-overview.js:60`、`Server/src/lib/gift-summary-contract.js:102` | 三条路径重写大航海金额、已知及未知盲盒成本和盈亏。四笔合成输入当前公共结果一致，计 5 件、1,500 分、盈亏 −400 分。 | 只抽取单笔已验证礼物的公共贡献，保留概览的大航海笔数、日汇总的未知成本件数以及各自的输出。期望值继续手算。 |
| 查询 worker 的概览时间窗口。`Server/src/modules/streamer/gift-query-result.js:47` | 结果校验用空概览推导字段，对起止时间只验证能否解析。把 `today` 的两个端点对调，校验仍通过。 | 在信任 worker 返回前逐项对照原请求的起止时间。保留负盈亏及各指标约束，加入一条错误窗口被拒绝的用例。 |

Device 与公开画面共用 SSE 写缓冲，各自拥有凭证、租户准入、过期和释放条件。租户主进程的连接租约与查询 worker 的只读事务分别管理关闭时机。证据在 `Server/src/lib/sse-writer.js:35`、`Server/src/lib/device-sse.js:78`、`Server/src/routes/public.js:83`、`Server/src/storage/tenant-connection-cache.js:28`、`Server/src/storage/gift-ledger-queries.js:52`。

## 服务端网页与小游戏

| 发现及源码位置 | 当前结果 | 最小改进和验证 |
| --- | --- | --- |
| 自助重置密码误判成功。`Server/public/admin/password-reset.js:47`、`streamer-password.js:152`、`Server/public/shared/http-client.js:23` | 对真实提交回调分别模拟 HTTP 200 的 HTML 和 `{ "ok": false }`，两种都显示重置成功、清空表单并跳往登录页。管理端设置密码已有严格成功条件。 | 复用已有 JSON 请求处理，仅当 `ok === true` 时清表并跳转。用 `Server/e2e/password-reset-design.spec.js:142` 的入口验证失败时保留输入且可重试。 |
| 同一首歌的搜索文本。`Server/public/streamer/song-library.js:178`、`Server/public/song/filter-model.js:85`、`request-presentation.js:282` | 搜索由 `e` 加组合重音写出的 `Café`，主播中心可以匹配预组字符的歌名，公开歌单漏掉。 | 在 `Server/public/shared/chinese-text.js:11` 复用 NFC 搜索归一化。用两种写法验证两页命中相同，显示文本和勾选条件保留原值。 |
| 主播公开地址。`Server/public/admin/streamer-list.js:32`、`detail.js:274`、`streamer-create-dialog.js:29` | Admin 列表自行拼 HTTPS 和固定域，详情及创建提示也各自拼域名。已有二维码案例的规范地址含 HTTP 和端口 `9443`，列表链接丢失端口。 | 三处消费服务端 `Server/src/lib/streamer-public-url.js:4` 推导的地址。复用带端口案例校验链接及提示，区分具体主播地址与固定官网导航。 |
| 活动五连组合门槛。`Server/public/gifts/blind-box-probability-data.js:123`、`Server/scripts/build-blind-box-game.cjs:272` 与 `:375`、`Server/test/gift-blind-box-probabilities.test.js:549` | 活动规则与构建器各写一次触发礼物与数量。现有对账只遍历已配置组合的游戏池，整池漏配时会跳过该池。 | 让活动资料与构建输入共用确认过的触发规则。用应支持的活动清单验证实际构建结果，生成的 JSON 继续由构建器交付，奖品及结算由游戏拥有。 |
| 礼物目录的页码。`Server/public/gifts/url-state.js:75`、`gift-variants.js:274`、`standalone-effects.js:34`、`catalog-view.js:432` | 同一个小数页码 `1.5` 在不同路径被截到第 1 页、保留为小数或原样转发。合成 150 条特效，每页 72 条，特效页实际返回第 37–108 条。 | 在 URL 状态入口统一正整数解析，各数据源按自身总页数裁剪。用多页数据同时核对页码、首条和兼容请求参数。 |

九个服务端网页目录中，`games/v1/runtime` 的玩法 JS 由页面直接加载，`public/overlay` 留有供开发与契约测试使用的源码。Admin 与主播端已经共用礼物工作区并各自传入相应的接口，官网与美术页也共用页头。依据为 `Server/public/games/game.js:272`、`Server/public/admin/gifts.js:41`、`Server/public/streamer/gift-workspace.js:379`、`Server/public/site/site.js:335`、`Server/public/art/app.js:314`。

## 工程复用与检测成本

- **Electron 测试的退出与临时目录清理**。七个测试文件里有 14 段语义一致的收尾回调，包括先关闭该测试的应用、核对目录位于仓库 `tmp/` 下，再移除隔离目录。现有 `Live/test/helpers/shared-electron.js:10` 已负责启动环境，`Live/test/helpers/scratch-directory.js:12` 已负责创建临时目录，其删除函数当前直接调用 `rmSync`。建议给这批测试共用一个小型生命周期 helper，保留路径核验、执行顺序和每例独立目录。各自的 IPC、场景入口和行为断言留在原用例。例见 `Live/test/desktop/ai-persona-editor-electron.test.js:14`、`Live/test/desktop/fixed-reply-editor-electron.test.js:109`、`Live/test/desktop/welcome-editor-electron.test.js:44`。验收时覆盖启动中途失败和正常关闭，检查进程退出后才清理该例目录。
- **设备礼物事件流的测试连接**。epoch 与清空历史测试各维护一份相同的 HTTP 流连接、首包就绪与结束监听。现有测试 helper 又实现了可指定路径与请求头的版本。第三处连同独立测试库一起初始化，直接导入会附带数据库与清理钩子。最小做法是把这一个无状态的连接函数放到现有纯 HTTP 测试辅助层，由三个位置传入自己的路径、头和服务器。保持撤销及跨租户清空的断言独立。证据在 `Server/test/device-gift-epoch.test.js:88`、`Server/test/device-gift-history-clear.test.js:53`、`Server/test/support/device-gift-api.cjs:102`。改后重跑前两份测试和原 helper 的礼物 API 消费方。

## 跨仓规则与合理独立的实现

- **点歌设置**。把服务端工作树 `Server/docs/protocol/fixtures/settings-input.json` 中与桌面 16 个点歌字段相关的 218 个输入逐项送入两边的规范化函数。78 个合法输入经桌面序列化后全部等于服务端的规范值。140 个线上拒绝输入中，139 个也被桌面本地函数拒绝，另一个是字符串 `"[]"`。本地设置接受 JSON 文本并序列化成数组，服务端要求线上输入直接使用数组。可在下次正式更新契约锁时复用服务器拥有的样例校验 wire 值，场景内继续保留本地字符串与服务端严格类型两种适配。证据在 `Live/src/shared/song-request-settings.js:46`、`Live/src/shared/song-request-settings.js:72`、`Server/src/lib/streamer-sync-settings.js:144`、`Server/test/settings-input-contract.test.js:69`。
- **有来源校验的弹幕代码**。`Live/scripts/sync-danmaku-style-options.cjs:7` 从本地浏览器定义生成 Node 选项。`Live/scripts/sync-danmaku-source.cjs:15` 对双仓的渲染核心使用固定摘要并显式导入。两个只读检查实际通过。新增桌面样式各自的画法按本机规则维护。
- **独立的礼物统计基准**。`Server/scripts/lib/gift-query-baseline.js:1` 明确冻结优化前的查询。`Server/scripts/benchmark-gift-ledger.js:122` 和 `:162` 以它计算已知答案再对照新实现。保留这份基准可以检出结果漂移，将它改调当前查询会使比较失去独立性。
- **下拉菜单的双端外壳**。两仓 CSS 有较多相同声明。`Server/public/shared/select-menu.js:1` 说明服务端对表单事件、fieldset 和裁剪容器做了适配，`Live/public/js/shared/select-menu.js:333` 还处理桌面弹出层的切换事件。各自拥有发布和浏览器交互，通用改动可对照相同键盘场景，样式行数不足以证明需要跨仓组件依赖。

## 本次运行的检查

| 检查 | 结果和覆盖边界 |
| --- | --- |
| 客户端 `npm run verify:architecture`，服务端使用仓库 Node 运行 `test/architecture-governance.test.js` | 分别 30/30 与 10/10，通过了各自现有的模块边界和架构检查。两个规模脚本分别给出 26 和 20 项人工审阅提示。 |
| 客户端 `danmaku-layout`、`component-style-parameters`、`settings-contract` 三个测试文件 | 35/35。覆盖预览与保存契约一致性、迁移兼容、设置同步及原子校验。 |
| 服务端 `settings-input-contract.test.js`、`song-library-sync.test.js` | 分别 3/3、25/25。后者当前的嵌套回滚用例可补提交后通知断言。 |
| 客户端点歌、歌库恢复与粉丝归档的定向用例 | 7/7。说明正常重启、切号和已有归档路径的基线。本文的组合条件用隔离夹具另行验证。 |
| 子代理分区定向检查 | 桌面与同步 40/40、管理 UI 23/23、播放及画面 29/29、后端 AI 7/7。服务端网页差异使用合成输入检查实际回调及纯函数，浏览器用例在此作为后续回归入口。分区与主审的检查可能重叠。 |
| 两个弹幕来源 `--check`，点歌字段跨仓样例 | 渲染核心与本工作树服务端摘要一致，Node 选项与生成源一致。点歌 16 字段、218 个输入的比较见上文。 |
| 客户端对当前 Server 的固定契约检查 | `node scripts/verify-server-contract.js D:\Work\lira-server` 按设计拒绝当前 `3c04ea65`，客户端锁定 `67119e81`。从锁定提交的 Git 对象读取 10 份夹具，SHA-256 全部与锁相符。当前服务端文件中有 8 份仍相符，`daily-bots-v1.json`、`fan-facts-v1.json` 已不同。此处只证明夹具字节和版本条件，两个工作树的正式互通仍需配套版本验收。 |

本次交付为审计报告及索引。行为证据来自源码、已有定向测试、内存 SQLite、模拟文件系统、进程和接口夹具。真实账号、外部服务、整套桌面与流媒体软件、实机音频、打包发布的端到端验收均在这次证据范围之外。产品说明、现行契约和操作指引沿用各自版本。整改时的回归场景与行为归属见各条目。

## 六项整改复核（2026-11-18）

两个独立 Codex 对话分别从客户端和服务端工作树复核了交付时列出的六项。以下记录修复及实测结果，上文保留审计当时的发现。

| 项目 | 复现与结果 |
| --- | --- |
| 1. 云歌库与歌曲 ID | 同一账号两次下载相同的版本 3，原先队列和点歌流水的 `song_id` 都从 `1` 变成 `NULL`。现在普通下载与待传恢复共用 SongStore 的事务，同归属且同步内容相同保留原行。切到另一账号，即使内容完全相同也解除旧关联。切回有待传记录的账号覆盖了相反顺序。[歌库恢复回归](../../test/cloud-sync/cloud-song-sync-recovery.test.js) |
| 2. 切号与延迟点歌 | 监听器已捕获 A，额度为 1 的 B 接手后，A 的延迟事件曾占用 B 的额度和单曲冷却。随机候选过滤、点名预查和事务记账现在都使用捕获账号。实测 A 的合格旧请求仍可排入共享队列，B 正常点第一首，同日再点才触发上限。[跨账号队列回归](../../test/songs/queue-service.test.js) |
| 3. 官方盲盒估价 | 普通奖池为空时，原估价仍取旧私有盒价 15 元、产物价 9 元。服务端把设置校验、接管归档和估价接入同一官方身份匹配。实测改名同 ID、同名换 ID 两种情况下，直送 25 元礼物均按 25 元入账，盒成本为空。 |
| 4. 画布布局与样式参数 | Node 与浏览器原先各自维护相同的布局、预设及参数校验。现在原 CommonJS 入口加载同一纯模块。真实 Electron 主进程从隔离 `app.asar` 加载成功，浏览器检查覆盖透视、滤镜重置和切换样式。[画布布局](../../public/js/shared/danmaku-layout.js) · [组件样式参数](../../public/js/shared/component-style-parameters.js) |
| 5. 官方目录与房间在售 | 冷启动官方目录从两次 GET 合为一次。官方推送先到时，图片和奖池都保留新版。房间在售先到时，慢 GET 补齐官方奖池和全量独有礼物的图片，同款礼物保留房间新图。该场景实测一次官方 GET、一次房间 POST。[面板生命周期](../../test/gifts/frontend-gift-panel.test.js) · [奖池刷新](../../test/gifts/frontend-blindbox-mapping-refresh.test.js) |
| 6. 歌词行与单笔礼物贡献 | 三个歌词入口共用有序时间查找，同毫秒取最后一行，原有时钟、显示偏移和返回类型各自生效。服务端统计、概览与日汇总共用整数分计算。两件单价 1.01 元的产物共 202 分，成本 315 分时盈亏为 −113 分，未知成本单独计数。[歌词行查找](../../public/js/shared/lyric-line-index.js) |

点歌问题多次出现的原因在于，不同环节曾对同一事件使用两种账号来源。监听器和粉丝归档使用接收时的身份，随机选歌、歌曲冷却和每日额度则读取处理时的活动账号。两者通常相同，因此只测正常切号或只测延迟粉丝归档都能通过。新增回归把「捕获 A、切到 B、处理 A、然后 B 自己点歌」放在同一个 SQLite 场景内，并给 B 预置歌曲冷却，分别验证读取与写入。现在旧回调沿用共享队列的容量和去重规则，账号私有的次数、单曲冷却及粉丝归档按同一规则判定。已经发生的错账与丢失的歌曲引用缺少可靠的归属记录，原数据保留。

改动与定向验证均已完成，范围、运行结果和工作树版本记录在[六项整改验收](../../specs/plans/archive/2026-11-18-modularity-six-fixes.md)。

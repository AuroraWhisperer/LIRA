# 客户端重复审计：逐项核实与修改记录

日期：2026-11-23。原报告：用户指定的本机文件 `C:\Users\Tom\.gemini\antigravity\brain\9e80b947-ace5-47de-8fa3-012ac69c8103\client-duplication-audit.md`。

**2026-11-24 勘误。** 礼物审计输入占位和签到抽签段落当时尚未修改。独立预览的月渡花汀配置、播放歌单选择器类型、独立歌词窗口的样式依赖和周表输出尺寸也有误述。下面对应条目已注明原状和修正时间。指南链接、弹幕分组、状态显示、公共样式和桌面工具的后续验证与处理见[第二轮逐项复核](2026-11-24-client-duplication-review.md)。

核实基线为客户端提交 `9c9138fa8ad8feb3d5b33e26c8891b8ea3d0d50c` 加开始时的未提交修改；工作树原有礼物导出、桌面样式和相关文档改动已保留。开始前差异与状态保存在根 `tmp/duplication-audit/`，不纳入产品。本文源码路径均相对仓库根目录，代表本次完成时的工作树，非已提交版本。

按用户要求忽略原等级，以下沿用原编号与子项，区分事实是否成立、是否应当合并以及实际修改。目录重复、同屏零增量文本、同一合同的机械实现已收口；独立输入合同、安全边界、加载入口和生命周期不同的实现保留，并逐项说明理由。原文没有列明全部位置的泛化数量，不据此宣称所有未列位置都已被证明有问题。

主要结果包括：礼物查询只保留一个设置入口、指南转向唯一详解、删除废弃样式及弹幕协议、共同画布校验与富文本选区、头像和敏感参数安全校验、原子写入/Cookie快照/登录窗/订阅机制复用。正常设置键、持久化格式和公开路由保持；两个 IPC 入口补齐了管理页路径检查。完整判定如下。

## 一、文本与状态


## 1.1 主界面与独立工具页

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 1.1.1 实时榜单 | 同意。`shared/live-rankings-view.js` 的空态与底部状态确实重复。增加可选 `statusExternallyRendered`，管理页启用，让全局加载/相同全局错误只显示在页头；有数据的卡片才显示延迟状态，独立浏览器源仍显示自身错误，不依赖管理页页头。 |
| 1.1.2 全民 K 歌 | 同意。`wesing-service.js` 无歌曲时隐藏 track meta，恢复原有歌词操作引导，右侧消息只保留检测错误、无歌词、未配置等信息；正常等待/同步不再重复。标题与播放状态仍承担曲目位置及播放状态定位。 |
| 1.1.3 礼物审计页 | 部分同意。11 月 23 日删除了面板头重复复制提示和底部图例。原文把输入占位也记为完成，实际到 11 月 24 日才精简，完整步骤在帮助区。HTML 初始空态与 `gift-audit/index.js` 清空或重置后的空态各有调用时机。 |
| 1.1.4 投票/评分规则 | 同意。`live-components/interactions.html` 将共享规则渲染到可见正文，移除紧邻重复问号/规则列表；保留首次有效投票与结束后显示均分等补充规则。仍由 `shared/interaction-rules.js` 提供共同文案。 |
| 1.1.5 歌曲信息空态 | 同意。`now-playing.js/html` 顶部保留模式与示例歌曲操作引导，两张卡片改为“暂无歌曲”/“暂停时隐藏”的简短占位。 |
| 1.1.6 队列标题 | 同意。`queue-popup.js` 只有存在待确认请求与主队列两个分区时才渲染内部队列标题；单一主队列不再重复顶栏名称及数量。 |
| 1.1.7 礼物全选提示 | 同意。`gifts/history-tools.js` 完整全选时清空选择 notice，部分选择时保留说明。未改用户已有的 `gifts/history.html` 改动。 |
| 1.1.8 自动保存残留（四组） | 同意手动保存残留，拒绝删除真正的加载/失败状态。queue-theme、danmaku、now-playing、interactions 的重试按钮静态默认 hidden，文案为“重试保存”；移除 queue-theme-view、danmaku-overlay-settings、now-playing 覆盖按钮名称，以及 interaction-appearance 编辑时“未应用”写入。`bindComponentAutosave` 继续控制重试与保存状态；必要的首次加载状态仍保留。 |
| 1.1.9a 歌词预览胶囊 | 同意。`desktop-lyric-renderer.js` 在基础歌词画布自己已展示空态时隐藏预览头状态，保留有歌词及其他显示模式下的状态。 |
| 1.1.9b 导入双警告 | 不同意完全删除。静态说明解释替换语义，`song-import-update.js` 检查结果给出本次将删除的实际数量并要求确认，是新的破坏性操作决策证据，不能因部分字样重复移除。 |
| 1.1.9c 点歌板说明与占位符 | 部分同意。queue-theme 标题相关帮助删掉重复同步句，保留默认标题等例外。多个控件的“留空则不显示”等 placeholder 面向不同输入位置，且不保证同时处于阅读区域；它们是就近字段说明，不应单纯为减少字面相同删除。 |
| 1.1.9d 播放抽屉按钮 | 同意。`drawer.js updateActions` 只切换静态按钮容器显隐，不再原样重建 HTML，保留按钮节点、监听和焦点身份。 |
| 1.1.9e 最近播放副标题 | 同意。移除“近期播放过的歌曲”同义副标题。 |

## 1.2 百宝箱功能页

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 1.2.1 动态抽奖 | 同意。规则 details 默认折叠，删除与左侧字段重复的九条规则，保留说明及 `#ug-dynamic-lottery` 完整规则链接。表单就近限制仍保留。 |
| 1.2.2 点赞/分享/关注 | 部分同意。三个开关问号合并为分组下方的一条云端、随机、30 秒、缺少互动人不发送规则；三个抽屉开头去除同一规则。词库最多 30 条、每条 120 字和清空不发送仍留在各自互斥编辑器，编辑时需要现场判断有效性，不能当作六段同屏刷屏。 |
| 1.2.3a 点歌回复 | 同意冗余层次。主页面总说明压缩并链接运行范围，示例抽屉不再重复“系统生成/无需词库”及关闭开关不改变规则；保留示例的 @ 行为、仅失败回复与需要客户端在线等执行语境。 |
| 1.2.3b PK/串门黑名单 | 部分同意。移除两个子开关旁“可以分别开启”的句子，欢迎总说明不再复述黑名单范围，范围留在黑名单编辑区。PK 总开关解释总行为、展开后的子项解释具体作用，非完全等价，保留。 |
| 1.2.3c 时段欢迎 | 部分同意。压缩问号的重复编辑提示，保留北京时间、可用区间、切换保留数据等规则；下方提示说明当前编辑模式，不将不同职责的两条内容合成模糊说明。 |
| 1.2.4 text-box | 同意。保留“保存和放弃修改均作用于整个场景”，删除逐句改写的问号。 |
| 1.2.4 gift | 同意。三处金额问号改为一条共享说明，三个输入通过 `aria-describedby="giftEffectThresholdHelp"` 关联，保留可访问说明。 |
| 1.2.4 games | 不同意当作零增量同屏重复。开始按钮旁说明下一步会挑词，独立选词 modal 的说明提供题词私密性、确认才计时及词库复用规则；进入 modal 后需要就近说明。分类“独立抽取工具/转盘”是导航分组，展开卡片“主播自定义内容/转转盘/独立运行”是控件及来源属性，不应删除标题破坏层次。 |
| 1.2.4 performance | 同意。三项占用指标移除重复 LIRA 前缀，保留独立品牌标签。 |

## 1.3 使用指南与新手引导

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 1.3.1 滚动礼物外观 | 同意。gifts 指南的整段外形/纹理介绍改为滚动礼物章节链接，保留导出 PNG 的静态例外。完整样式说明由 guard-thanks 的滚动礼物章节负责。 |
| 1.3.1 礼物答谢/查询 | 同意。gifts 指南压缩为用途与 danmaku-replies 对应章节链接，删除旧查询开关截图，配合单一控制入口更新文案。既有 gifts overview 截图明确标为旧版，并说明查询开关已改跳转，不伪称截图与当前相同。 |
| 1.3.1 月底冲刺 | 同意。gifts 保留统计页设置目标/重置操作，水晶球换算与直播组件详细说明改为 `#ug-sprint-overlay` 链接。 |
| 1.3.2 两张点歌截图 | 同意。shortcuts 移除 public-overlay-queue、public-overlay-songs 两张重复大图与说明，链接 `#ug-song-overlays`；configuration 保留唯一主说明。 |
| 1.3.2 更新截图 | 同意。reference 移除 toolbox-desktop-update 重复图和重复日志提示，链接现有 `#ug-reinstall` 主说明。 |
| 1.3.3 云端范围 | 同意。getting-started 以新锚点 `#ug-cloud-runtime` 承载完整范围；同篇邻近重复段、danmaku-replies 总介绍和功能页压缩为结论与链接。保留关闭客户端的撤销/已提交请求限制。 |
| 1.3.3 旧弹幕源/本机在线 | 同意重复介绍，保留排错结论。toolbox-danmaku-gifts、FAQ music/broadcast 改为结论+`#ug-obs`，reference 合并相邻两份迁移步骤，保留本机状态与迁移特有提醒。 |
| 1.3.3 字体库 | 同意。configuration 新锚点 `#ug-font-library` 归口下载、缓存、未就绪规则；playback 与 danmaku 指南链接过去，弹幕章保留该功能字体列表与中文字形回退。 |
| 1.3.3 礼物保留期 | 同意。gifts 最近礼物段新增 `#ug-gift-records`，删除该篇邻近复述。查询指南保留累计统计的含义并链接保留规则；FAQ records 去掉泛化的“90 天”句，链接主说明。保留用户原有 10000 条/时区/保留期更新。 |
| 1.3.3 电音接线 | 同意。software 与 FAQ music 的重复接线长文改为即时结论和工作区音频助手章节链接，保留更改前关闭处理、选择处理后输出等必要操作。 |
| 1.3.4 云端范围成对照搬 | 已按 1.3.3 收口到 `#ug-cloud-runtime`。 |
| 1.3.4 豆包排错成对照搬 | 同意。danmaku-ai 常驻长段压缩为提示及 `#ug-doubao-recovery` 链接，guide 保留完整验证与上下文恢复步骤；测试使用独立会话的说明仍保留。 |
| 1.3.4 动态抽奖规则 | 已按 1.2.1 收口到完整指南，功能页只保留就近操作与链接。 |
| 1.3.4 游戏说明/键位 | 不同意一律移走。游戏页内画板快捷键是直播主持时直接执行的操作，指南中的准备流程面向首次学习；打开指南查快捷键会中断当前主持，两处用途不同。 |
| 1.3.4 礼物答谢变量 | 不同意删掉功能页问号。它在编辑器旁解释 `{称呼}`、`{礼物}`、`{金额}` 的真实替换、@ 行为、120 字与四段上限；属于编辑所需的按需说明，非常驻长段刷屏。指南为首次设置提供完整上下文。 |
| 1.3.4 礼物特效 ID 示例 | 不同意。功能页的可替换数字 ID 是直接复制/发送的命令示例，只有两句即时提示；符合报告自己提出的“1–2 句即时操作提示”标准。 |
| 1.3.4 导入表格填写 | 不同意整段迁走。现有规则本就在默认折叠 details 内，包含表头别名、字段分隔、空值、清空范围等输入期间需要查询的契约。指南是独立导入操作流程；把字段规则移走会降低表格填写可用性。 |
| 1.3.5 OBS/直播姬 | 同意。两套同样的添加步骤合并，保留 OBS“浏览器源”和直播姬“浏览器”的命名差异，平台 B 站与直播软件角色不混用。 |
| 1.3.5 getting-started | 同意。保留账号操作主说明，后面移除重复“没有切换账号按钮”，保留退出登录等安全操作。 |
| 1.3.5 danmaku-replies | 部分同意。欢迎定制文案里的草稿与旧服务器提示改为引用上方说明。原文误记签到抽签段落已完成，实际到 11 月 24 日才合并自动保存说明并链接运行范围。其他编辑器有不同的草稿生命周期、兼容与写入限制。 |
| 1.3.5 AI 四遍测试连接 | 不同意原数量和零增量判断。当前命中含图注“未测试连接”，它说明截图状态，不能视作又要求测试；配置完成后的测试、启用触发前测试分别对应操作阶段。保留真实验证步骤。 |
| 1.3.5 gift wish | 部分同意。许愿文字版两次列举工具栏功能确有冗余，前面改为操作引导，完整字体/描边/阴影/恢复默认说明集中后段。保留 token 操作、样式继承、收礼状态色、统计周期等不同规则。 |
| 1.3.5 song | 部分同意。新增编辑章节的批量导入长步骤改为 `#ug-song-import`；移除超量提示中的重复上限/处理步骤和同步章节重复编辑入口，保留独有的不可自动截断、网页只读。手工编辑、表格导入、强制覆盖同步、点歌规则、随机点歌分别有独立操作与风险，拒绝按“多处跨节自复述”笼统删减。 |
| 1.3.5 新手第 9 步/结束 | 同意。结束弹窗不再重复紧前一步的帮助入口。 |
| 1.3.5 新手第 5 步 | 不同意删掉整表替换提醒。新手导入引导处于即将执行破坏性操作的语境，提醒未列旧歌会删除有明确防误操作价值。 |
| 1.3.5 新手第 6 步 | 同意。删除逐一朗读十个菜单名，保留分组展开、右侧调整预览及下一步画布关系。 |

## 1.4 错误与状态文案

| 原文子项 | 判定、证据与处理 |
| --- | --- |
| 授权服务器无效响应、响应过大、超时、网络、会话标识、背景地址提示重复 | 同意。多处 `new RemoteLicenseError` 的同一码及中文消息完全相同。已在 `src/electron/license/remote-license-error.js` 添加按错误码查找的默认消息表；`device-authentication.js`、`license-manager.js`、`license-transport.js`、`gift-protocol.js`、`license-response-utils.js` 移除重复字面量。保留“无效汇总”等专用上下文消息、远端错误码消息以及自定义过大响应提示；状态、retryable、retryAfterMs、index、fieldErrors 不变。 |
| 周表导出长校验消息重复 | 同意文案重复，校验本身需要保留：原始 data URL 长度、解码字节、PNG头预检和实际解码尺寸承担不同防护。已在 `weekly-schedule-export-controller.js` 用三个本地常量归一单图字节、读取失败、尺寸错误消息，没有删除任何校验。 |
| component-preview 初始占位被改成另一句 | 同意。`public/pages/component-preview.html` 已统一为 JS 首次渲染的“正在连接客户端…”，避免启动时跳字；加载占位仍保留供脚本启动前显示。 |
| 五个覆盖层的断线提示不同 | 不同意据此统一成一套状态文案。实际调用是 `danmaku-component-source.js` 的嵌入来源、`danmaku.js` 的本机/云端合成状态、`gift-sprint.js` 的进度来源和 `overtime.js` 的加班状态；它们不是同屏重复渲染，同一“断线”也不等于同一恢复动作。原文未逐列五个位置，已核实的几处没有重复订阅/输出，保留各自文案。 |

## 二、入口、交互与视觉组件

## 2.1 入口与职责

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 2.1.1 查询开关 | 同意。礼物页改为“查询回复 → 前往弹幕互动设置”，删除另一套控制器初始化；`admin/index.js` 通过现有主页面、功能、子标签点击入口跳转并聚焦唯一开关。`gifts/interaction-controls.js` 删除 surface 分支，仅服务 danmaku 的查询/答谢控件。`danmaku-tool.js` 调用与原 suite fixture 同步。相关 tooltip/guide 不再声称两个开关同步。 |
| 2.1.2 盲盒共享主题 | 同意入口重复，纠正“静默”描述：原页面已经写明共享。按建议保留共享键与兼容契约，`settings-blindbox.js` 只渲染专属紧凑/翻页选项；blindbox.html 用已有主页面跳转机制到点歌板统一改字体/配色，指南同步。不创建独立主题 schema。 |
| 2.1.3 外部网页入口 | 同意。overlay-addresses 的网页区域只留网页歌单，移除主播中心、礼物图鉴、网页游戏、官网卡片；既有百宝箱对应入口保留，移除 ID 已检查无代码消费者。 |
| 2.1.4 礼物效果来源 | 部分同意“综合来源可能重叠”，不同意把当前所有来源当成同一 URL。两款内置效果的独立 URL 带 `giftStyle`，综合 `/gift-effects` 汇总启用效果。toolbox/gift-effects 的地址区补充综合源包含全屏感谢/大航海感谢、无需重复添加的说明；overlay-addresses 原本已有对应说明。不同特效与导入样式保留各自设置流程。 |

## 2.2 控件与展示

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 2.2.1 价格预览 | 同意。删除 library.html 的纯文本镜像容器及 song-editor 写入，长度计数/有效性验证保持。没有另造价格渲染器。 |
| 2.2.2 AI 平台 | 同意。删除 danmaku-ai 同名 Badge/第二问号，同步删除 ai-assistant-config-view 对这些节点的写入和孤立名称表；保留 select 与差异化 AccessNote。 |
| 2.2.3 指南搜索/进度 | 同意。search 索引过滤已包含在 article/details/步骤内的嵌套节点，保留父节点全文；点击仍定位命中段并打开所属 details。新增现有 browser suite 中的嵌套步骤回归案例。去掉互补“还剩 N%”节点和 JS，保留进度条/已读比例及 ARIA。 |
| 2.2.4 搜索平台 | 同意。移除禁用伪输入框，playback-bar 在搜索 placeholder 显示当前平台，顶部真实平台选择保持。 |
| 2.2.5 画布按钮 | 同意。blindbox、gift-sprint、heart-box-collection 三处局部按钮改“在画布中调整”，侧栏通用入口保持“打开画布”；相关指南标签同步。 |

## 2.3 设计系统与视觉组件

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 2.3.1 两份旧确认弹窗 | 同意。查明原选择器无 HTML/JS 消费后删除 `playback/dialogs.css`、`playback/panels/confirm-dialog.css` 及入口 import；尾部 `playback-home-result-title` 同样无消费者。现役 `components/confirmation-dialog.css` 保留。 |
| 2.3.1 playlist-picker | 同意迁出响应式杂项文件，已独立为 `playback/playlist-picker.css`。可滚动列表、选择项、独立尺寸和移动布局属于歌单选择器自身。它使用 `<div role="dialog">`，原文误称原生 dialog。 |
| 2.3.2 游戏卡片 | 同意。draw/wheel 相同的折叠头、摘要、展开图标及详情规则合到 `toolbox/games.css`，分组使用原选择器；三个 760px 媒体块合并，独有规则保留。没有另造组件 API。 |
| 2.3.3 dialog 遮罩 | 同意默认值重复。在 `admin/layout.css` 的 `:where(dialog[open])::backdrop` 设置默认主题背景，删除 11 处相同声明。保留 component-preview、component-styles、danmaku-library、text-box 的不同遮罩浓度：这些值实际影响预览背景可见度，不能只因都是半透明黑而当作无效声明。 |
| 2.3.4 抽屉 | 同意公共几何、进入过渡、打开状态及头部布局重复。新增 `components/drawer.css`，由 `styles-base.css` 加载；礼物与播放 owner 保留宽高、dock 留白、z-index、遮罩透明度、padding 与 Electron no-drag 差异。 |
| 2.3.4 Toast | 同意图标定位、底板和 mask 重复。归入 `admin/toasts/system.css`，以 `--toast-icon` 选择图标，保留原业务 class；成功/警告 SVG 各保留一份，播放和礼物专属图标保留。无独有规则的 `toasts/ai.css` 删除，入口同步。 |
| 2.3.4 Switch | 同意公共引擎重复。时钟两开关接入 `switch-control` / `switch-track`；删除 gifts 的重复焦点环，将 component-preview/text-box 点击层公共规则收至 `components/switch-control.css`。保留时钟 36×20、14px 圆点/16px 位移及其他紧凑控件的尺寸差异，不统一所有小开关尺寸。 |
| 2.3.4 视觉隐藏 | 同意。八组选择器的 position/1px 尺寸/overflow/clip-path 收到 `styles-base.css`；保留原 class API 与局部 margin/padding/border/white-space。`.sr-only` 旧 clip 改为 clip-path，仍保持辅助技术可读而视觉隐藏。 |
| 2.3.4 滚动条 | 不同意“逐字复制且应统一”的整体判断。歌词手动滚动条的 fallback 为半透明白，播放器为 `#8c8984`；隐藏滚动条规则分别约束不同容器，不能提升为所有滚动区域的默认值。没有建立覆盖不同滚动职责的全局工具规则。 |
| 2.3.4 Spinner | 部分同意形状相似，不同意整块等价。盲盒 16px/2px/800ms、抽屉 28px/3px/700ms，尺寸、边框和周期都不同，保留各自短规则。 |
| 2.3.4 details 箭头 | 同意。advanced/settings 完全相同的伪元素与展开旋转合到 `desktop-lyric/settings.css`，保留原选择器及各自 summary 布局。 |
| 2.3.4 表格空单元格 | 同意共性。盲盒/礼物历史的 table-cell、高度、边框、背景、居中、颜色和 padding 只保留 `admin/responsive.css` 一处；盲盒独有的 `border-radius: 0` 留在原 owner。 |
| 2.3.4 手写 primary 按钮 | 对应礼物页重复刷新入口随单一查询入口调整已删除；一并删除失去消费者的 primary、summary、controls CSS，没有重建另一套按钮基类。 |

## 三、代码与样式

## 3.1.1 弹幕预览目录与旧消息协议：同意，已修改

- 核实：覆盖层预览在 HTML 重列样式，与共享配置相比缺少 wireframe、astral、glass-bubble、horizontal-charm。更正：`moonlit` 在 `DANMAKU_STYLE_OPTIONS` 中，同时有资源包用途和兼容预览，不能以管理页内置目录推断它缺少配置。`danmaku-editor:*` 在当时的管理端没有消费者。
- 修改：`public/pages/overlays/danmaku.html` 删除硬编码样式目录与画布尺寸选项，保留空容器；`public/js/overlays/danmaku-preview.js` 仅进入预览时依据 `DANMAKU_STYLE_OPTIONS`、`CANVAS_PRESETS` 构建菜单。删除旧 Apply/Close 控件和 `danmaku-editor:*` 收发逻辑。
- 保留：当前 `component-preview:*` 集成与独立 `?preview=1` 预览入口；生产弹幕源不会动态创建这些菜单。
- 证据：最终源代码搜索无 `danmaku-editor:`；现有 local-preview 和 overlay 用例通过。

## 3.1.2 三个富文本编辑器：部分同意，已抽取共同选区内核

- 三处的当前选区判断、保存恢复、原子节点边界扩选，以及 wish/text-box 的临时标记选区替换确实重复。
- 新增 `public/js/admin/rich-text-selection.js`，由 `gift-thanks-text-editor.js`、`gifts/wish-text-editor.js`、`text-box-editor.js` 共享；选区由 editor 的 ownerDocument 获取，临时标记仅用于定位本次插入节点。
- 不同意把所有 `beforeinput/copy/cut/paste/drop` 和光标纠正一并视为同一引擎：答谢模板、心愿富文本片段和文本框段落有不同的原子类型、换行/粘贴格式与序列化规则。三个 editor 继续拥有各自内容合同及事件策略，公共模块只操作 DOM Range。
- 验证：text-box-editor 与 frontend-gift-wishes 行为测试通过，覆盖 token 格式化、选区和序列化。首次临时标记使用 randomUUID 在无 secure-context 测试页不可用，已改为模块内递增标记，复测通过。

## 3.1.3 两套拖拽排序：不赞同“完全同构”和此次通用化建议

- 相同部分确实包括 pointer capture、ghost、FLIP 和结束清理，但并非报告描述的“只注入 1D/2D 与 ghost 即可”。
- `component-preview-layer-drag.js` 是水平可变宽图层：按稳定中点插入，使用列表水平滚轮/边缘滚动，提交前还原原 DOM 位置，由 controller 接受排序结果；有 inert 防护和提交错误反馈，ghost 在 body 中并去掉数据/无障碍标识。
- `world-clock/city-drag.js` 是二维卡片：最近中心定位，滚动祖先和裁剪视口决定垂直自动滚动，使用 moveBefore 保留状态，提交当前已移动的 DOM；pop-over ghost 进入顶层，Escape 捕获时阻止传播，resize 取消，结束后恢复城市按钮焦点。
- 如果强行共用，除了定位/挂载，还要把滚动容器、DOM 提交/回滚、焦点、取消传播、resize 和异常策略都变成协议。这会新增一个跨领域交互层并掩盖现有职责。两处实现保留；没有重复注册或同时运行同一拖拽器的证据。

## 3.1.4 插入画布并预览：同意，已修改

- 四个入口此前都准备注册项、同步当前画布、查找/插入元素后打开预览；仅样式库入口统一经过场景校验。
- 新增 `public/js/admin/canvas-item-entry.js` 的 `openOrCreateCanvasItem`。`component-style-client.js`、`gift-guard-thanks.js`、`gift-motion-settings.js`、`live-rankings.js` 均调用该入口；统一画布准备、同步、查找、容量限制、插入后 `validateSceneDocument`、controller.edit 和打开预览。
- 调用方仍提供类型匹配、尺寸/定位和 appearance 构造，避免把各组件业务默认值移入通用层。满画布仍允许复用已经存在的组件。
- `scene-template.js` 导出 `MAX_NON_TEXT_BOX_SCENE_ITEMS = 32`；校验器、插入入口、画布视图使用同一个常量。场景版本、类型和数量合同保持不变。
- 验证：guard-thanks 浏览器预览测试通过；其旧测试场景只有 canvas/items，现更新为有 schemaVersion/id/title 的有效场景，符合真实校验合同。gift-motion VM fixture 改为 mock 新入口，原有保存、冲突协调和自动保存四项行为保持通过。

## 3.1.5 JSON 响应解析：同意等价路径，保留错误/取消合同

- 全绕过的八个模块已使用 `readApiResponse`：start-animation、component-preview-remote、ai-assistant-config-view、clock-card、gifts/display-settings、interactions、live-rankings-client、text-box-media。
- playback/content/loader、features/radio-mode、operations/cache-operations、operations/playlist-operations 及 home/import/stream/match/search/lyric services 等已有注入解析器的模块，保留原解析器和请求生命周期，改为共享 `assertApiResponse`；blindbox-analysis、blindbox-stats 和 WeSing 同样复用。
- 保留特殊合同：AI 未提供错误码时仍补 `HTTP_${status}`；远端预览 HTTP 成功但业务失败仍归为终止重试的 400；clock/opening 仍校验必需 data；失效请求的 generation/取消检查仍在原位置。
- 不机械替换：`gifts/blindbox.js` 部分旧接口允许不带 ok 的载荷，只拒绝显式 false；歌词同步部分失败是 break/停止本轮而非抛错；无需读取响应体的写操作不能额外强制 JSON。这些均不是等价的 `assertApiResponse` 调用。
- 验证：frontend-json-response、AI providers、admin runtime/toolbox、live-rankings-client、playback provider/cache/radio 相关测试通过。

## 3.1.6 大量共享小工具：按实际合同收口

| 子项 | 核实、修改及保留理由 |
| --- | --- |
| 大航海中文等级映射 | 同意。新增 `shared/bilibili-guard-labels.js` 的冻结 `GUARD_LABELS`，精确复用总督/提督/舰长映射于 admin fans、queue、games、danmaku 与各样式。各调用方保留无等级时显示观众/空串的区别。 |
| 上舰动作文案/角色名 | 不同意一律合并。样式分别使用开通了、感谢开通、续费守护等组合；英文 role（governor/admiral/captain）、罗马数字和 artwork 身份不是中文标签的同一合同。共享等级事实，不统一创作文案或素材键。 |
| guard aurora 的 enterMs | 同意。card 不再重复 aurora 入场时间表，通过 `auroraRenderer.enterMs(tier)` 读取 aurora 已有分级表。卡片整体 holdMs 继续由播放调度层持有。 |
| DOM 节点工厂 | 部分同意。新增 `shared/dom-element.js/createTextElement`，替换合同完全相同的一组弹幕样式节点工厂（document 参数、className 赋值、String(text)）。其他工厂还有不同默认 document、null/undefined 处理、属性、布局或领域装配，不能按名字 node/element 全仓替换。 |
| B 站头像地址及代理 | 同意，含实际校验漂移。`shared/bilibili-avatar.js` 增加 `normalizeBilibiliAvatarUrl`，统一要求 HTTPS、.hdslb.com 子域且无 username/password。gift-banner、danmaku、games、scene-extra-client 复用；独立 scene 输出仍保留其明确样例路径白名单与直接 URL 交付合同。token/url 使用 URLSearchParams 编码；查询语义不变。 |
| overlay-utils 重复 shared 与经典脚本壳 | 部分同意。生产页面没有经典脚本消费者；改为 ESM，escapeHtml/font-family 直接复用 shared，原 overlay-utils-module 保留导出门面。没有删除仍被消费的色彩/滚速/低功耗函数。hexToRgb/hexToRgba 的非法输入回退、coercion、opacity 合成与 parseHexColor 不同，保留兼容包装；overlay-theme 对有效 primary/accent/background 仅解析一次。 |
| 金额格式化 | 部分同意。10 个完全相同或仅固定两位小数的 amount 函数使用 `shared/display-format.js/formatDanmakuAmount`，保持 ¥、zh-CN、非负有限值、无效值 —。保留其他样式的 CN¥、CNY ¥、空串/no-symbol、最少 1 位、数额相关精度以及不同负值规则；不得因都叫 amount 改变视觉合同。 |
| FNV-1a | 同意可本地维护模块中精确重复的 codepoint 算法。新增 `shared/string-hash.js/hashCodePoints`，用于 comic/prismatic/random-position/sinking-feed/window。各消费方保留自己的 seed 字段和 PRNG 算法。renderer-core 是 ADR-0020 固定源码快照，已撤销最初的抽取，保留权威源码及摘要，不能仅为去重修改桌面快照或更新锁。advanced-lyric-variation 使用 UTF-16 charCodeAt，与 codepoint 迭代的非 BMP 字符结果不同，未强行替换。 |
| 头像容错 | URL 校验与代理已统一；各样式不同 fallback 节点/形状和显隐仍归各 renderer，避免用共享错误 UI 覆盖外观合同。 |

验证：overlay-shared-helpers 增加凭据 URL 拒绝和 token 编码语义断言；danmaku overlay/renderers/random-position/sinking、gift-feed、guard-thanks、song-board 测试通过。random-position 的旧 data URL import 不支持新相对依赖，改为原生 file URL import，维持同 realm 行为断言。

## 3.1.7 其他子项逐一结论

| 子项 | 结论与处理 |
| --- | --- |
| 5 处 ARIA Tab 导航 | 同意，新增 `shared/tab-navigation.js/bindTabNavigation`，client-settings、danmaku-tabs、forms、fans/forms、desktop-lyric 共用 click/方向键/Home/End 导航。面板切换、滚动和高级编辑器装卸仍在各 owner。 |
| 3 套资源下载 Toast 订阅器 | 不同意合成同一订阅策略。audio 有安装/失败重试与首事件状态；fonts 按 completedAt 去重并显示文件/字节进度；catalog 有启动/后台分期、陈旧阶段拒绝及初始静默规则。三者已共用 toast 展示层，来源事件状态机不同，不存在三个监听器重复消费同一个流的证据。 |
| confirmation-dialog / gift-audit escapeHtml | 同意，改为调用 shared/html-escape；保留很薄的 String(value ?? '') 边界，避免把原先可显示的 0/false 变为空串。 |
| 颜色混色/透明度 | 不同意直接互换。advanced lyric 混合 alpha 后输出 rgba；weekly-schedule 输出不透明 hex 且权重方向不同；desktop lyric 对 transparent 透传并钳制 opacity。已共用 parseHexColor 的位置保留，不引入会统一不同输出合同的混色函数。 |
| gift-motion renderSaveStatus/createAutosave/bindCopyUrl | 不同意现有实现可直接替换。当前 gift-motion 没有 renderSaveStatus 的重复显示状态函数；其自动保存为 180ms、检查各 effect 字段有效性、保存后 while dirty 排空后续编辑；通用 autosave 是 600ms wanted/generation/IME 流程。复制按钮会返回当前 effect 对应变体尺寸，且不触发待保存草稿。现有行为测试明确覆盖这些合同，不能借去重改变保存时序或提示尺寸。 |
| queue-utils formatSuperChatPrice | 同意，直接复用并 re-export shared/display-format 中已有函数。 |
| blindbox 金额 / desktop 下载显示 | 不同意直接换为 display-format：盲盒收益允许负数、无 ¥、固定两位；formatMoney 会把非正数压为 ¥0.00。桌面下载速率 B 整数/KB 一位/MB 两位，与 formatBytes 随数额决定精度、最多 TB、负值 -- 的合同不相同。 |
| gift-feed / gift-wish 超时 fetch | 同意，新增 `shared/json-request.js/requestApiData`。共享 10 秒、外部 signal 联动、读 body 完成后 finally 清理；保留老浏览器源 Chromium 兼容方式和各领域错误提示。 |
| guard MEDALLION_CENTER/PARTICLE_OFFSET_X | 同意，card 直接导入 guard-thanks-stage 的已有常量，删除重复定义。 |
| 3 处 playback formatTime | 不同意“逐字同义”的结论。playback/utils 接收秒；WeSing 接收毫秒且 service 有 finite numberValue 回退，diagnostics 直接 Number(value || 0)。常规有效数据输出近似，但原有异常值和输入单位不同，未用通用替换静默改变合同。 |
| clamp / numberValue / clockNow | 局部短表达式重复成立，但不赞同仅为 1–3 行数学/平台读取创建跨模块业务抽象。现有实现包含 parseFloat 与 Number、整数舍入与连续值、不同 fallback 的区别；没有一个统一的业务范围或时钟语义可安全作为此次共享 owner。 |
| 3 处日期 YYYY-MM-DD | 不同意把相同字符串形状当成同一日期政策。礼物日报按上海业务日；planner 使用本机日历；weekly-schedule 的 week 运算采用 UTC 日期对象且 today 使用本机日期。保留各自时区/日历 owner，不用共享 formatter 隐藏时区。 |
| 8 处 Hex 正则 | 不同意仅凭重复次数统一。color-picker input 为严格 6 位；danmaku color sequence 接受 6/8 位；guard particle 先扩展短色值、去 # 后校验并回退白色；通用 parseHexColor 接受 3/6/8 位。允许值和输入阶段不同。原报告未逐列 8 个位置，不能将未指明部分当成已证明的同一合同。 |
| 3 处 getSourceName | 未接受全量替换。getSourceName 支持 wesing；播放操作里的二元 qq/netease 名称处于已经限制平台的写歌单合同，渲染标题附带“歌单/歌词”等专属措辞。现有二元分支与扩展源标签不构成完整同义函数；报告也未明确列出 3 个调用点，不宣称不存在所有重复。 |
| savedStyle() | 同意。component-resource-settings-panel 改用 createResourceStyleSettings 返回的 savedStyle()，删除重复挑选已保存样式逻辑。 |
| 同面板重复 1000ms 轮询 | 不同意，事实不成立。component-resource-settings-panel 没有调用 createResourceStyleSettings 返回的 mount()；两者是替代挂载路径，各自拥有 visible/abort/dispose 生命周期，并非一个面板启动两个计时器。 |
| 两处五层歌词 DOM | 相似骨架真实，但不赞同把独立文档骨架当成重复运行。一个是独立歌词窗口页面，一个是管理页局部预览，容器、属性和周边上下文不同，已经消费同一歌词 renderer。合并静态骨架需要另加异步构建/渲染阶段，当前无漂移或双渲染问题支持这项改变。 |
| playlist liked / playlist-tracks 删除 | 同意，合并为同一确认、请求、响应、刷新流程；playlist 选择、确认文字、toast/error 文案仍按原 action 提供。 |
| component-style-library 两种删除 dialog | 同意，模块内共享 confirmRemoval。pack/style 提供各自说明和请求 action；取消按钮统一自动聚焦，删除中阻止 Escape 与 dispose 提前关闭。没有新增通用 dialog 框架。 |
| start-animation 四个媒体处理器 | 部分同意：重复 JSON 解析已收口。其余分别上传/移除音频/人物图片，输入校验、FormData、播放资源更新和确认步骤并不相同；尾部两句 update+render 不构成应合并的完整工作流。 |
| history-view/history 三个 DOM helper | 字面重复成立；不采纳独立通用模块建议。get/setText 是 1–3 行局部 DOM 操作，getSortableHeaders 是本页选择器；controller 与 view 的职责已经分开。为几行私有访问器新增模块会扩大耦合/导出面，未解决漂移、重复事件或请求问题。 |
| welcome / pk 词库行 | 相似呈现成立，整块逐字相同不成立。welcome 行归当前词库/时段 domain，changed(key)；PK 有 supported 禁用状态与独立 draft/revision/autosave，标签和删除提示也不同。保留各自行装配及闭包，避免用多回调通用行把不同草稿生命周期合并。 |
| song-library-filters | 同样的 Set/排序/select 填充成立；语言 parser 不接受 &，歌手 parser 接受 &/＆，各自 optionsChanged cache 键和“全部”选项不同。短局部 select 呈现未引发错误/漂移，暂不为此再增加带 parser/cache/文案配置的通用层；两个 parser 保持分开。 |
| gift-audit 两张表 | 不赞同整块合并。气泡解析是 userName/giftName/comboCount，WS 是 user_name/gift_name/num/total_price/created_at，列数 5 与 7，空态、数量/价格回退不同。共用 escape 已完成，比较两种来源本就是页面目的。 |

## 3.2 CSS 覆盖、动效与独立入口

| 原项 | 核对结论、修改或保留原因 |
| --- | --- |
| 3.2.1 fullscreen-visuals | 部分同意。删除 20 条确实被同选择器后续规则覆盖的声明；原定位、max-width、布局和封面色等仍生效。原文“约100行全盘无用”不成立，整段删除会改变方形唱片机。 |
| 3.2.1 WeSing 三媒体块 | 部分同意。删除 1180/980px 的完全重复规则；600px 只删被后置规则覆盖的 stage/console padding、radius、min-height，保留 heading、歌词、布局和 offset 独有规则。不是三个块都可以直接整段删掉。 |
| 3.2.1 player 前置声明 | 部分同意。清理 header/user-and-health 中 player/cover 的前置重复，仍有效的 justify-content、font-weight、flex 移至 `playback/player.css`；删除对 grid 无效的 flex-direction。保留小屏真实 grid 布局。 |
| 3.2.1 fixed-replies viewport | 部分同意。清理同 selector 无条件后置覆盖的 preview padding/flex-basis、reply gap/padding、heading margin、actions padding、song examples margin；删除 libraries 两成员都已覆写的 padding-top。更具体作用域的覆盖与基础值是正常变体，不一并删除。 |
| 3.2.1 weekly-schedule-art | 同意有效覆盖部分。删除同文件 14 条被后置规则覆盖的属性；保留仍有效的 edition 布局和模块高度。 |
| 3.2.1 标题/说明 | 同意。删除 song-workspace 对 ui-page-title 的逐字重复、gift drawer 标题/说明重复以及 toolbox shell 重复 h2 属性。 |
| 3.2.1 component-preview-page | 部分同意。清理 scene-editor 已提供的 display/padding，stage 只保留独有 radius；两个菜单和两套样式卡片共性使用分组规则，保留菜单宽度/边框/按钮交互、卡片高度/对齐/过渡差异。棋盘背景的颜色和网格比例不同，保留预览页的实际效果。 |
| 3.2.1 danmaku-tool | 同意。删除 reply-target 被后置同 selector 覆盖的三个属性，其余布局保留。 |
| 3.2.1 歌词 roma | 不同意视为死代码。translation/roma 的共享基础声明仍用于两种行；roma 再覆盖字体与 opacity 是有意变体，删共享基础会改变 translation。 |
| 3.2.1 PK fieldset | 不同意整段死代码。mode/conditions 共用 fieldset reset，mode 再设专属 padding；两者并非同一个选择器被无条件重写。 |
| 3.2.1 overtime | 删除重复 gap 规则；保留共用图片 44px 与特定行 42px 的尺寸变体。 |
| 3.2.1 fan-profiles | 不同意整段删除。actions 与错误区共用基础规则后使用具体场景覆写，基础值仍服务其他实例；并非所有命中的属性都死。 |
| 3.2.1 select-menu | 不同意当作紧邻无效覆盖。popover/non-popover 及 multiselect 有独立定位和滚动契约，保留其选择器差异。 |
| 3.2.1 license 按钮 | 不同意把 hover/active 当作重复死覆盖；它们是不同交互状态。基础重置的真正重复另见 3.2.3。 |
| 3.2.2 非覆盖层关键帧 | 部分同意。三个相同菜单进入动画归为 `styles-base.css` 的 `ui-menu-enter`。没有把其他同形动画一律更名：`topbar-refresh-spin` 被 settings-operations 依名字查询，`other-feature-panel-enter` 被 usage-guide-layout 依名字结束；confirmation、license、now-playing 还有独立加载与交互生命周期。只看帧体相同不能证明动画身份与加载依赖可删除。 |
| 3.2.2 弹幕机制关键帧 | 同意。6 个 entry-clock 归为 `danmakuEntryClock`、13 个 enter-opacity 归为 `danmakuEnterOpacity`，定义在 `danmaku/motion.css`；dark-moon 三份同帧 reveal 合为原 `darkMoonReveal`。保留各款时长、延迟、曲线和 transform；共享 feed 不按这些旧名称判断。 |
| 3.2.2 reduced-motion | 不同意“一次性收口23块”的做法。规则真实范围包含 item、子元素、伪元素，`!important` 使用也不同；wireframe 等还将移动时长变量设零。motion.css 在主题导入中段，普通 none 规则移动后会被后续主题 animation 覆盖；扩大为全局 none 又会改变原来的作用范围。保留每款样式降级与共享机制降级各自的职责，不用减少行数换取隐含动画变化。 |
| 3.2.3 gift-audit | 部分同意。独立页加入 styles-base 和公共 Toast CSS，删除约80行 Toast 拷贝；保留 audit 的顶部位置/最大高度。其面板、表单、按钮和表格并非约160行逐字重复，紧凑尺寸与管理页不同，未整套替换为 admin CSS；补 `button` min-height 为0保持原有尺寸。 |
| 3.2.3 license | 删除已由 styles-base 提供的 box-sizing、margin/font-family、button/input font 继承与 cursor。不同意把 neutral 相近色板与无边框按钮强行合并：授权窗颜色为自己的入口设计，按钮 44×36/圆角，桌面壳 46px/整高/直角，hover 和 transition 也不同；不是整块等价。 |
| 3.2.3 Reset/字体栈 | 部分同意实际共享的透明 body。抽 `.overlay-body` 至 `overlays/body.css`，base.css 与 gift-effects 均引用。不同意把17套页面 reset/40多处字体栈整体移成单一默认：固定导出画布、可滚动队列、全屏动画的 overflow/尺寸责任不同；像素、美术字和系统中文回退也有不同消费者。没有将独立源强制依赖管理页样式。 |
| 3.2.3 gift-effects 冗余加载 | 同意。gift-effects 仅需通用 overlay-body，不需要点歌/歌库主题，已替换 base.css 为 body.css；自身 effects、guard 和字体依赖保留。 |
| 3.2.3 队列大航海配色 | 同意三套插画主题完全相同。按原选择器合到 base.css 各主题 import 后，避免被主题默认 medal 颜色覆盖；主题美术部分继续独立。 |
| 3.2.3 开播 Canvas | 同意公共几何、显示及隐藏其他图层重复。归入 opening.css，保留 pixelated 与两种背景差异，删除 opening-pixel/opening-moon-fan 两文件及 import。 |
| 3.2.3 重复 Token | 同意 control accent 和 light 硬编码同值，改引用相应 accent；删除 song-layout 四个 root 同值别名及 danmaku-tool 两处重复边框 token。核对祖先作用域和实际计算样式后删除，不按变量名字相似批量清理其他主题 token。 |
| 3.2.3 重复 import | 11 月 23 日把 rich-text-toolbar 的两条管理页路径集中到 styles-admin。当时误判独立歌词窗口需要整套播放样式。11 月 24 日核实其只需 `playback/desktop-lyric.css`，并去掉播放入口里重复的确认框和字体导入。 |

## 3.3.1 原子写文件和重命名

| 原文子项 | 判定、证据与处理 |
| --- | --- |
| device-key-store / license-state-store / doubao-session / dynamic-lottery-auth-store 同步原子写入 | 同意。均为同目录临时文件后 rename。已全部复用 `writeAtomicFile`，统一 UUID、`wx`、0600、finally清理。device-key-store 原来已经具有这些保证；doubao 和 lottery 原来已有 finally，并非完全没有清理。license-state-store 原 PID 临时名且无 finally 的问题成立。外层目录创建、加密、字段过滤、Cookie flush 顺序保留。 |
| client-appearance / desktop-notifications 异步写入和 Windows 重试 | 同意。`atomic-file.js` 新增 `writeAtomicFileAsync`、`renameWithRetry`；两模块使用同一实现，保留 `wx`、flush、最多5次尝试、50/100/150/200ms间隔、EPERM/EBUSY范围、临时文件尽力清理、成功rename后才更新内存的语义。 |
| audio-component-files 目录发布重试 | 同意相同机械重试部分。复用 `renameWithRetry`，显式保留这里额外允许的 EACCES；替换旧目录、回滚和路径验证仍归音频组件所有。 |
| desktop-user-data 目录迁移同步重试 / 建议 renameSyncWithRetry | 不同意直接合并。`publishMigrationDirectory` 在每次失败后额外检查目标已经存在就停止，目的是不覆盖竞争产生的新分区；同步等待发生在启动迁移阶段，其他四个同步文件写入原来并无重试。保留这个唯一带迁移停止条件的短循环，不新增单一调用方的“通用同步重试”或改变所有凭据写入的等待策略。 |

## 3.3.2 共享工具

| 原文子项 | 判定、证据与处理 |
| --- | --- |
| license-transport 的 readResponseText | 同意主体重复，但不是完全等价：授权层还限制解码后UTF-8字节，且既有注入响应支持 getReader。已将流读取移交 `src/shared/response-body.js`，为共享读取补齐 getReader迭代/取消/releaseLock；授权层只保留解码后预算复核。content-length预检、流超限立即停止、BOM与跨块UTF-8均由现有预算测试验证。 |
| hasCredentialQuery 漏 sessdata/bilijct | 同意，真实规则漂移。`license-public-values.js` 改用 `isSensitiveFieldName`，覆盖大小写和下划线规范化后的SESSDATA/bili_jct。扩展已有IPC测试，确保相对背景地址与HTTPS预览地址都不把这两种查询参数交给渲染进程。 |
| 错误码/索引/LicenseState重复 | 同意。复用 `normalizeErrorCode`、`normalizeErrorIndex`、`LicenseState`。为保持公开错误码契约，原本不能含首尾空白的IPC错误码仍拒绝空白，不因共享函数会trim而放宽。 |
| welcome-settings-contract 已引入却重写 normalizeWelcomeMessages | 同意。V1 `welcomeParameters` 复用该函数，保留V1字段白名单与错误码；未合并V1/V2协议。 |
| license-overlay-ipc / scene-cloud-controller Overlay URL校验 | 同意。`src/shared/remote-url-policy.js` 新增 `normalizeRemoteOverlayUrl`，两个入口复用HTTPS、DNS、无凭据、无query/hash、固定16字符overlay路径约束；各入口保留自己的错误类型和后续SSE URL构造。 |
| license-manager 长延迟改用 createCancellableDelay | 不同意直接替换。授权重试在每段唤醒后以 `renewalNotBefore - Date.now()` 重算剩余时间，同时检查授权生命周期；共享delay按已安排的segment递减remaining。休眠/时钟变化时两者不等价，直接替换可能在唤醒后继续等待已过期的剩余时段；保留截止时刻语义。 |

## 3.3.3 Preload 与 IPC

| 原文子项 | 判定、证据与处理 |
| --- | --- |
| preload 13处订阅封装 | 同意。抽为文件内部 `subscribe(channel, withPayload)` 工厂；所有公开桥仍逐方法硬编码通道，未暴露通用channel参数。保留无效callback空退订、只移除自己的listener；2个无载荷事件仍不传数据，其他事件仅传payload而剥离Electron event。扩展原有订阅测试验证这两个边界。 |
| daily-bot/dynamic-lottery-auth/gift-interaction 来源检查 | 同意复用，部分原文需纠正：daily-bot已有比默认注册器更窄的`/`、`/admin`、`/settings`名单。主窗口注册器支持明确`allowedPaths`，保留daily-bot范围；另外两个接入标准管理页名单，补上此前缺失的pathname约束。用例增加同源`/license`拒绝验证。 |
| desktop-notifications-ipc/planner-reminder-ipc 样板 | 同意。主窗口注册器接管已存在的参数数量校验和指定路径名单，两模块只保留各自通道和action绑定。仅`/admin`及返回错误码保持一致。 |
| gift-export/weekly-schedule 导航销毁取消 | 同意这两个完全相同的监听所有权代码。新增 `ipc/navigation-cancellation.js`，提供重复绑定去重和成对解绑。导出控制器仍分别拥有cancel/dispose。 |
| playback-output/screen-color-picker 取消守卫也应全部统一 | 不同意四者全部等同。播放输出额外处理render-process-gone且保留inPlace导航；取色器连主frame原地导航都取消，同时拥有显示器事件、多个子窗口、超时、焦点恢复。以上两个保留独立生命周期，未让导出helper承载一串不同策略开关。 |
| fixed-reply/viewer-name 授权代际护栏 | 不同意仅因4行代次比对相似就合并。fixed-reply先校验响应再核对代次，并向本地投影发布settings+revision；viewer-name在sanitize前拒绝旧代次并返回各种记录/列表结果。调用边界的代次检查是显式安全要求，不移到一个会掩盖不同响应/发布时机的通用包装器。 |

## 3.3.4 成对模块与其他子项

| 原文子项 | 判定、证据与处理 |
| --- | --- |
| bilibili-auth/music-auth-manager 加密Cookie快照 | 同意共同存取机制，不同意“整文件相同”。新增 `cookie-snapshot.js` 收口加密写入、恢复与元数据读取；`cookie-details.js` 收口domain匹配。保留平台分区、快照路径、音乐payload.platform、音乐任一authCookie和B站全部关键Cookie的登录差异，以及B站明文旧文件删除和账号资料拉取。 |
| 两个扫码登录窗口 | 同意窗口/导航/Cookie保存/完成检查/关闭流程重复。新增 `login-window.js`，两入口只提供各自config、认证操作和诊断回调。音乐窗口经desktop-auth-controller使用原有脱敏writeLog，不再直接console.log原始error；两者统一标题拦截和关闭请求去重。原文“音乐漏防重入”不准确：原本已有loginCheckInFlight，缺的是loginCloseRequested。B站默认静音和诊断摘要保留，音乐不强制静音。 |
| 系统通知管理与清理 | 同意。新增 `system-notifications.js` 管理每个调用者自己的通知集合、点击回主窗口、close/failed监听和统一clear；礼物阈值/启用后时间界线与日程定时/唤醒/禁止过期重放各留原owner。去掉planner中两份相同清理循环。 |
| 离屏 PNG 导出整条管线 | 礼物导出按块生成可变尺寸透明图，允许多文件和部分成功，并用 `wx` 防覆盖。周表导出单张 **1920×1080** 图片，使用专用隔离 session、请求白名单、令牌、用户选择的文件和原子替换，并校验溢出。原文误写为 3840×2160。两者的写盘与重试策略各有用途。11 月 23 日共用宿主导航取消，11 月 24 日补齐 PNG 头和尺寸校验。 |
| 六处授权账号归属校验 | 不同意整体合并。cloud-sync账号键含accountName+数值streamerId并叠加自身生命周期；fan-profile持久scope是origin+streamerId、每次授权另外有generation/context UUID；scene接受字符串或正整数streamerId并投影scope+epoch；daily-bot的UUID还清空接管草稿；lottery派生私有hash namespace并携带AbortSignal；guard-expiry只拥有临时登录来源代次。它们要守护不同资源，直接统一会改变持久scope或失效时间。 |
| desktop-logger / terminal-log | 不同意“重新实现了同一日志能力”。已共用 `log-rate-limit`、`log-redaction`、`log-size-limit` 和 `formatLogLine`。剩余包装区别是真实契约：console hook需保留原终端输出、只落特定info、可卸载并识别method；desktop按scope/Error分类，uncaught-error强制写入，并随run重置序列。保留各自预算实例与入口策略。 |
| audio-assistant / playback-output JSON-Line RPC | 不同意整块同构。助手由state消息判ready并发布状态；start允许45秒续候且超时先EOF保留恢复责任。输出用ready/fault、5秒超时kill、4项队列背压、stream generation、PCM序号、stop合并，关闭等待也不同。抽一个可配置RPC骨架会把不同恢复/顺序规则混入同一状态机。 |
| desktop-update-controller / update-manager重复状态 | 同意。更新状态现在仅由update-manager持有；controller通过getUpdateState读取并推送，外部错误通过reportUpdateError委托同一归一化路径。controller只保留启动检查定时器和安装前排空钩子。保留公开desktop IPC状态形状，更新失败/重试和退出装配测试通过。 |
| 四处中文错误透传过滤与public-error.js | 不同意“已有可直接替换的同义共享工具”。`src/shared/public-error.js` 当前只提供 `createPublicError(message,statusCode)` 工厂，不提供中文识别/旧错误分类。fan-profile消费跨service/validation/transfer的旧Error，gift-export另有文件错误映射；将其替换为publicMessage读取需要逐个改变生产者的公开错误契约，不能仅作为重复清理机械替换。保留当前四个入口行为；未把这个事实误称为统一的安全错误白名单。 |
| 管理页路径白名单 | 同意相同默认列表。新增 `src/shared/admin-page-paths.js`，供server装配、desktop-request-auth、main-window-ipc、resource-integrity、client-appearance使用；单模块额外许可/license或更窄列表仍由调用者指定，未合并信任检查本身。 |
| 本地音频扩展名白名单 | 部分同意。新增 `electron/local-audio-formats.js`，统一本机选择器、允许路径存储和local-media协议的扩展名/MIME；协议仍保留独立的realpath和授权二次校验。第四处`src/server/opening-contract.js`是开播素材上传准入，属于独立消费合同，保留它而不让上传允许范围随着本地播放器解码格式自动扩大。 |
| B站关键Cookie集合 | 同意四个本机消费者同一协议字段集合。新增 `src/shared/bilibili-auth-cookies.js`，用于bilibili-auth、dynamic-lottery-auth-store、dynamic-lottery-session、guard-expiry-auth；登录成功判据、UID长度、持久/临时分区、指纹算法仍各自保留。 |
| 十处主窗口安全send | 不同意整个“安全send”同构。resource-integrity另查实际webContents和管理页精确origin/path；license/font/gift事件各做不同public DTO过滤；导出进度绑定发起任务窗口；最大化事件属于窗口创建者；播放退出发送后还等待ACK。`!isDestroyed`几行重复不能替代这些不同的安全/生命周期归属。保持显式调用，未新增包装所有消息的广播层。 |

## 四、原报告列出的合理分离

同意原报告第四节所列的合理分离，保留对应边界：

- **安全与特权**：前端校验与主进程 IPC 校验各自保留，preload 继续显式白名单，local-media 保留真实路径二次检查；app.asar、O_NOFOLLOW 防 TOCTOU 和含 pdb 的外置组件各自使用对应的 SHA-256 校验流程，不合并其安全模型。
- **互斥或互补界面**：音频助手顶栏与悬浮球按位置互斥，紧凑 Popover 与完整配置页职责不同；桌面窗口控制与浏览器关闭按钮各按运行环境显示；组件附近复制与地址总表、点歌队列导入播放器与全局队列导入点歌保留各自入口；盲盒亮色卡片的局部前景变量仍用于防止暗色主题影响可读性。
- **独立覆盖层与兼容**：OBS 和哔哩哔哩直播姬的独立浏览器源页面、各弹幕款式的入场位移、ADR-0020 固定 renderer-core、无凭据 imported-danmaku 沙箱、场景双缓冲与编辑预览继续分开；欢迎设置 V1/V2、no-op desktop:gift-display 以及经典脚本 license.js 的兼容责任不因去重删除。

## 五、验证、文档与交付范围

### CSS 验证范围

- 修改前 CSS 保存在根 `tmp/duplication-audit/baseline-css`，包含用户原有修改；它仅作本次比较，不替换 Git 基线。
- 独立 Electron 43 窗口使用专属 userData/sessionData，运行只包含管理页 markup 的本地样式夹具；精确路由 HTTP 200 后加载，未导入 LIRA 启动入口、未访问真实账号或重启用户应用。
- 同一份 9,778 节点 markup 对比修改前后36个计算属性，宽/窄窗口检查；归一夹具相对资源 URL、扣除视觉隐藏 clip→clip-path 后，只有新 clock class 的预期边框差异及窄窗口无效 flex-direction 清理。最后别名/表格精简后复查只剩 clock 两节点。此检查不能代替真实授权桌面全流程。
- 原生 dialog backdrop、抽屉与 Toast 的13个节点/伪元素样本计算值一致，并目视检查隔离窗口。自有 Electron 窗口与 HTTP fixture 已关闭。
- 浏览器抽屉回归补载新的公共 drawer CSS，保留原有点击、焦点、Tab 断言。弹幕真实播放、独立浏览器源和其他组件复用现有 browser 组，最终结果见集中验证。
- 集中桌面回归发现时钟接入公共 switch 后缺少透明 input 点击层，导致开关不可点击；已将 `.clock-toggle-field.switch-control input` 纳入公共点击层规则。`resource-style-settings-electron.test.js` 整文件 2/2 通过，验证开关实际操作与保存，日志为 `tmp/duplication-audit/clock-switch-retest.log`。
- 未为纯颜色、间距、文案或静态选择器新增快照断言；保留现有功能性测试。技术文档更新加载归属，使用指南已随入口变更同步。

### 集中验证

下表保留整组首次运行的真实结果，并列出失败修复后的定向复验；这些分批结果不合称为“一次完整套件全部通过”，重叠测试也不累计为独立总数。最终源码冻结后执行语法及架构门禁。

| 检查 | 实际结果与后续处理 |
| --- | --- |
| `npm run check` | 最终 1,927 个 JavaScript 文件通过，见 `syntax-closeout.log`。 |
| `npm run verify:architecture` | 最终 29/29 通过，见 `architecture-closeout.log`。修正 ESM 检测器把合法 import/re-export 源名当作未声明变量的误报；以真实模块链接及未声明执行引用验证检测能力。新模块的仅注释 catch 改为显式返回，并移除已经没有空 catch 的旧基线项，未扩大豁免。 |
| `npm run verify:contracts` | 10 份固定服务契约通过，见 `contracts-gate.log`。 |
| `npm run test:contracts` | 10 文件、110/110 通过，见 `contracts-final.log`。使用锁定提交 `67119e81a3f5f49470ed2b191f6552556d0a704e` 的隔离 server 检出，未修改相邻服务端工作树或锁文件。 |
| `npm run test:browser` | 66 文件，初轮 425/426 通过，见 `browser-final.log`。唯一失败是旧礼物双入口夹具把同一个查询开关初始化两次；更新为现有单入口后整文件 18/18 通过，保留每次操作一次写入及查询/答谢互不污染断言。该组包含弹幕实际播放的 50 项动效检查。 |
| `npm run test:offline` | 584 文件，初轮 5,195/5,200 通过，见 `offline-final.log`。五个失败分别为固定弹幕源码快照、计划 Status 格式、不合法头像夹具、VM 缺少 URL API、Toast class 整串比较。已恢复固定快照、改正计划格式并同步夹具；相关六文件含真实 Electron 鉴权共 37/37 通过，见 `frontend-expanded-retest.log`。头像拒绝后游戏页面仍显示空图片的实际遗漏也已修复并增加回归。期间文档检查另受任务外变更影响，最终已通过，见下文。 |
| `npm run test:desktop` | 25 文件，初轮 64/69 通过，见 `desktop-final.log`。五个失败已逐项定位：时钟开关点击层缺失、头像夹具域名、心动盲盒按钮旧名称、ASAR 夹具漏公共 drawer CSS、跨窗口收藏同步竞态。时钟整文件 2/2、共享画布整文件 4/4、ASAR 与收藏定向 2/2 通过；鉴权用例包含在上行 37/37 中。见 `clock-switch-retest.log`、`shared-canvas-appearance-final.log`、`electron-desktop-fixture-focused.log`。 |
| `npm run verify:docs` | 最终 10/10 通过，见 `docs-closeout.log`。本任务计划已归档；运行期间出现的任务外 API 文档差异曾造成失败，最终检查时已消除，详见下文。 |

收藏测试的失败不是靠反复运行消失的：临时响应屏障证明桌面已收藏时，外部画布仍为 `[cream,coffee]`；释放同一读响应后变为 `[signal,cream]`。正式测试等待外部画布自身的 `aria-pressed` 更新，再断言排序；未加入固定延时、重试或放宽排序要求。受控验证 1/1 通过，见 `electron-favorites-race.log`。

共享 JSON 解析迁移还曾使 HTTP 200 非 JSON 响应携带 `status=200`，被远端预览误判为终止连接。已先补业务回归复现，再在预览适配器保留原解析失败重试语义；预览与恢复两个文件 10/10 通过，见 `frontend-remote-repro.log`、`frontend-remote-retest.log`。

以上日志均位于仓库根 `tmp/duplication-audit/`。其他前端/Electron 定向验证覆盖 Cookie 恢复、登录窗口、原子写入、订阅清理、IPC 来源、通知、更新状态及导出，相关批次记录分别为 `frontend-final-tests.log`、`frontend-motion-retest.log`、`electron-focused.log`、`electron-auth.log`、`electron-pinned-contract.log`、`electron-final-leaves.log`、`electron-empty-catch-focused.log`。

### 文档门禁期间的任务外变更

本任务开始时 `docs/reference/backend/api.md` 没有未提交差异；执行期间该文件出现大幅修改，本任务及三个分工代理均未编辑它，HTTP 路由文件也未由本任务修改。中间一次检查因文档缺少既有的三条路由而失败：`GET /api/bilibili/dynamic-lottery/state`、`POST /api/bilibili/dynamic-lottery/tasks`、`POST /api/bilibili/dynamic-lottery/tasks/action`，见 `docs-corrected.log`。这些任务外改动始终保留，未为通过检查而覆盖或撤销；最终复验时 API 文档已恢复匹配，文档门禁 10/10 通过，见 `docs-closeout.log`。

### 静态界面检查

`impeccable detect --json public` 执行一次，输出 121 条提示（112 warning、9 advisory），见 `impeccable-detect.json`。复核其中十个无初始 src 的图片标签，均与 HEAD 相同且由 JS 赋源，在赋源前自身或父容器隐藏；可逐字匹配的样式提示在修改前快照已存在。未确认本次新增错误，也未据此声称全部媒体或对比度均已通过运行验证；未扩展清理历史视觉偏好。

### 同步与边界

技术参考同步到 `docs/reference/frontend/{app,pages,overlays}.md` 和 `docs/reference/desktop/{main,preload,windows,auth,update}.md`，记录入口、共享模块和安全检查归属。用户指南、相关问号和新手引导随实际入口变更修改；截图重复处改为链接，保留的旧礼物总览图明确标注旧版和入口变化。内部机械抽取不改变操作步骤，因此没有为其新增重复指南或截图。

测试只调整失效的模块注入、有效场景夹具和已删除的双入口预期；保留保存失败/竞态、每次动作一次写入、拖拽/焦点和授权等有效行为断言。新增覆盖集中在实际发现的头像凭据拒绝、敏感参数、订阅边界、嵌套搜索和解析失败重试，不为普通样式或文案逐项增加快照。

使用的 Electron 样式窗口、浏览器上下文和 HTTP 夹具属于本次隔离验证，已关闭；固定 server 检出核对路径、提交和干净状态后已移除，没有重启用户正在运行的 LIRA。未使用真实账号登录、连接真实直播、打包、安装或发布，不把样式夹具当作完整授权桌面验收。临时材料保存在根 `tmp/duplication-audit/`，没有进入产品差异。未提交、暂存或创建分支。

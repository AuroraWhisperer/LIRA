# 使用文档补充方案审阅（2026-09-22）

审阅对象：[客户端使用文档补充方案.md](客户端使用文档补充方案.md)。核对当前客户端、相邻服务器工作区和文档实际引用的图片。

**结论：方案方向合理，素材数量充足，但尚未达到“截图完整、入口一眼可辨、说明准确”的发布条件。不能认定已经没有遗漏或文字错误。**

本次只新增审阅报告，未改动方案、正式手册、截图或产品代码。逐图查看了全部 98 处引用的图片；对裁切、错误状态等重点问题放大查看原图，并对照相关页面与实现。没有启动用户的客户端、登录真实账号或执行发送、导出、更新等操作；也没有重新验证 DeepSeek 等第三方线上界面。

## 1. 文件层面的检查结果

- 98 处图片引用均存在；88 张候选 WebP 都有正文引用，没有孤立候选文件。
- 第六章指向 `shot-*` 的跳转目标均存在。
- 附录 D 的 88 张图片标注宽高全部与真实图片一致。
- 候选素材总计 3,455,908 字节，最大单张 75,912 字节，符合文档的体积目标。
- 有 4 对内容完全相同的文件：A8/B1、B5/B7、D9/D10、E1/E15。因此 98 个图位对应 94 种不同图像。复用没有问题，但图位数不能充当覆盖完整性的证据。
- 使用真实界面加隔离示例数据来做操作说明图是合理的。只要状态符合产品逻辑、必需控件齐全并标明示例，就不必每一张都依赖真实生产账号。涉及操作成功的承诺仍需另外验证。

## 2. 优先修正的文字与事实

下列位置指方案中的行号，便于与当前版本对照；源代码行号可能随工作区继续修改而变化。

| 编号 | 方案位置 | 问题与影响 | 建议改法与证据 |
| --- | --- | --- | --- |
| T1 | 4.3，第 310 行 | 把“收藏”一概列为只保存在本机、换电脑要重做，混淆了 LIRA 本机播放记录与音乐平台账号歌单。 | 改为“点歌队列、播放队列和 LIRA 的本机播放历史保存在本机；QQ 音乐、网易云的我喜欢/收藏歌单由对应平台账号提供，换电脑后需重新登录平台。”证据：`public/js/playback/services/home-service.js:87`、`src/music/providers/qq-provider.js:278`、`netease-provider.js:175`。 |
| T2 | 8.2，第 665 行 | 要求介绍网页端礼物流水“导出”，但当前主播中心礼物流水只有查询、筛选和分页，没有导出入口。 | 删除网页端导出步骤；需要导出 PNG 时，指向客户端的“礼物 → 查看全部 → 选择记录 → 导出所选”，同时保留 D6 尚未完成导出实测的限制。证据：服务器 `public/streamer/gift-workspace.js`、`gift-ledger.js`；S3 实图。 |
| T3 | 2.3，第 112 行 | “自动答谢礼物：模板怎么填”要求编写不存在的操作。当前该功能只有启用开关，没有主播可编辑的答谢模板。 | 改为开关位置、答谢对象、消息示例与服务器持续运行条件。不要混入进场欢迎/自定义关键词回复的模板操作。证据：`public/pages/admin/gifts/page.html:35`；服务器 `src/modules/danmaku/gift-interaction-service.js:219` 调用固定格式化器 `src/lib/gift-interaction-format.js:132`。 |
| T4 | 2.6 第 165 行；B2 第 503 行；B4 第 505 行 | 队列操作写成“置顶/移除/查看详情”；实际按钮是“置顶或取消置顶/复制歌名/删除”。B4 又把内嵌歌曲表单叫成弹窗。 | 按实际标签改写，并解释图标。B2 的附录图注已经写对，应同步前面的要求。B4 改为“点歌 → 歌库中的新增歌曲表单”。证据：`public/js/admin/queue.js:108,128,129`；B2、B4 实图。 |
| T5 | 4.1，第 238 行 | 展示板默认字体大小写为 40 px；当前默认值与截图均为 28 px。 | 改为 28 px。证据：`src/storage/settings-defaults.js:73`、`public/js/admin/display.js:101`；B10 实图。 |
| T6 | 2.4 第 139 行；E6 第 551 行 | 要求在“深色面板”参数图里出现“停留 2–30 秒”，但固定位置深色面板不显示这个控件。 | 将停留时间移到“全屏随机样式”说明，并为该状态另拍图。证据：`public/js/admin/danmaku-overlay-settings.js:54` 仅对 outline/cream/glow 显示停留时间；E6 实图。 |
| T7 | 2.2 第 94 行；A10 第 496 行 | 要求主播找顶栏文字按钮“退出程序”，但 Electron 桌面模式隐藏该按钮，只显示右上角关闭窗口按钮。另外“LIRA 账号没有退出登录界面”未限定客户端，网页主播中心有退出登录。 | 写成“桌面客户端没有切换/退出 LIRA 账号的入口；关闭客户端使用右上角 ×。直播账号的退出登录在点歌 → 设置；网页主播中心另有退出登录。”证据：`public/css/desktop/theme.css:76`、A10、S2 实图。 |
| T8 | 5.6，第 418–425 行 | 标成“可复制的模板”，却没有先登录直播账号、填写房间号的前提，并把保存设置后的反馈固定写成“弹幕监听已开启”。当前客户端没有这条固定状态文案，保存也不等于连接成功。 | 增加前提，写“保存后检查右上角直播间连接状态；仍显示未设置直播间或连接异常时，按提示排查”。不要把开启接收直接等同于连接成功。证据：`public/js/admin/state-renderer.js:53` 显示实际 `live.message`；`src/server/bilibili-runtime.js:165`。 |
| T9 | 2.4，第 132 行 | 将动态和视频链接并列后统一介绍“关注作者/点赞/转发”，容易让人以为视频也支持全部条件。 | 明确视频仅支持评论与关注；点赞/转发条件不能照搬到视频。E8 右侧规则已写明“视频仅支持评论与关注，暂不支持可靠核验视频点赞和分享名单”。 |
| T10 | S1 第 589 行；S1b 第 1594 行 | 要求截“忘记密码入口”，图注也写“‘忘记密码’后的重置表单”，实际登录页链接文案为“使用重置码”。 | 写“忘记密码后，联系管理员获取重置码；在网页登录页点击‘使用重置码’”。证据：服务器 `public/admin/login.html:82`；S1、S1b 实图。 |
| T11 | FAQ，第 617 行 | “会持续发送”“高风险、现在零提示”不准确。当前操作发送固定 15 条，并在开始、进度和完成时显示提示；并非无限循环。 | 写“一次发送钓鱼 10 条、打劫 5 条，间隔 5 秒，发送完毕自动结束；不要误触”。保留必要提醒，删除“零提示”的事实判断。证据：`public/js/admin/danmaku-tool.js:159–174`。 |
| T12 | 基线第 7、15 行；维护第 690 行；证据第 742、745 行 | 当前手册已拆成壳文件和四个正文分片；“usage-guide.html 1291 行、77 KB”和只在该文件搜索同名文案的维护方式已过时。 | 当前壳文件 70 行，正文在 `usage-guide-getting-started.html`、`usage-guide-features.html`、`usage-guide-configuration.html`、`usage-guide-faq.html`。更新编辑位置，或明确旧数字仅为拆分前历史基线。12 节这个逻辑章节数仍成立。证据：`public/pages/admin/toolbox/usage-guide.html:51–54`。 |
| T13 | 2.4，第 148 行 | 性能页写成“电脑/LIRA 两种视图”，容易让人找一个不存在的切换入口。当前是同页六张卡片。 | 改成“同页分别显示电脑整体和 LIRA 的处理器、显卡、内存占用”。证据：`public/pages/admin/toolbox/performance.html`；E21 实图。 |
| T14 | 3.1、6.4、第十章 | 3.1 已说明 12–19 只是素材编号，6.4 却继续写“第 12/13/14 节（新）”；第十章仍把“网页端截图能否提供”等已完成事项列为阻塞。 | 6.4 统一写内容块/最终章节名；第十章改成当前仍需处理的事项。S 组已有本地示例，不应再笼统写成尚无截图。 |

已经确认合理的要点包括：P0 的水晶球 100 元、恢复默认背景、循环/往返滚动三项纠错；客户端两类登录码的区分；本机源与服务器弹幕姬的运行边界；主播中心四个分区；管理员截图不进入主播手册。用户名与密码规则也与当前登录页一致。这些无需推翻重写。

## 3. 截图完整性：必须处理的具体问题

| 图位 | 实际问题 | 最小处理方式 |
| --- | --- | --- |
| B11 | 只完整显示前 7 个地址；“场景与氛围”下面只露出加班机/礼物特效的顶部，地址和复制按钮被截断，开播画面/萌时钟未显示；底部还有大片白区。 | 按正常窗口分上、下两张，拍全 11 项；保留“点歌 → 浏览器源”页签。不能以当前图验收“11 个地址”。 |
| E1 | 图名为四组导航，但“软件与帮助”组只露出标题，设置、性能、使用文档、桌面更新四项没有显示。 | 单独拍完整侧栏，或上下两图。E15 可继续复用当前图说明礼物边框。 |
| E10 | 只显示数字炸弹和五子棋，没拍到你画我猜、转盘；投票/评分另有 E10b/c。 | 至少补你画我猜设置/画板及转盘入口，和 E10b/c 组成连续步骤。 |
| E8 | 除“未登录”外，还出现“操作未完成”“请在 LIRA 桌面客户端使用动态抽奖”。这不是正常桌面入口图。 | 修正截图环境中该功能的可用状态后补拍；当前图只适合解释此错误，不能教正常设置流程。 |
| E14b / E14c | 按钮已是“下载更新”或“重启并更新”，状态文字仍是“等待检查更新”。演示数据缺少状态文案，画面自相矛盾。 | 使用完整、相互一致的更新状态补拍。`supplement.cjs:65–66` 未提供 message，而 `public/js/desktop.js:286–290` 缺省显示等待检查。无需为了截图执行真实安装。 |
| E19b / E19c | 设置图的“档案管理”只有标题，没有三项操作；新建表单的标签区域被裁切，其他表单页签内容未展开。 | 设置页补下半张并保留“粉丝档案 → 设置”；新建表单按需要分基本信息/生日偏好/提醒，不要用一张残缺图充当完整表单。 |
| S6 | 最重要的 OBS 地址与复制按钮在图片最底部被切断。 | 向下滚动另拍地址区，保留左侧“直播弹幕姬”选中态。 |
| F3a | 处于默认背景状态，只有上传按钮，没有 P0 要教的“恢复默认背景”。 | 使用示例背景，拍到当前背景、上传和恢复默认三个要素。 |
| B13 / C7 | B13 只显示基础字体设置的一部分；描边、透明度、逐字等下方设置没覆盖；C7 是空白等待播放，不能展示歌词效果。 | B13 补下方相关分组；C7 配真实可显示的示例歌词。单独补 C5 全屏歌词，不能互相替代。 |
| D8 | 只拍了“按观众看”视图。三种视图按钮存在，但其他两种视图的列与分页未展示。 | 若正文要解释每种视图的列，需补“按盲盒看”“开盒记录”；分页在有足够示例记录时拍。 |
| E3 / E6 / E7 | E3 没有“应用到直播画面”；E6 是固定样式且没有停留时间；E7 没展开 AI 平台下拉框，也未展示正常填写后的测试结果。 | 按“选样式 → 调参数 → 应用”和“选择平台 → 配置 → 测试”拆图，分别保留对应操作按钮。 |
| E18 | 下方音乐上传、音量等控件没拍全，预览还是暂停状态。 | 加下半张控件图；只有需要解释效果时再补启用后的预览。 |
| S5 | 图注承诺歌曲、名称、背景与分享，但本图仅拍到分享和歌曲，名称/背景在下面；F3 已提供部分补充。 | 改图注并明确链接 F2/F3；若要讲歌单外观精细设置，再展开 F3 的“歌单外观”补图。 |

D1 的标题“礼物页整页”与实际上半页不一致，但下半页已有 D9/D10，可以修改命名和编排，不必强行拼一张过长全页图。D9/D10、A8/B1 等重复图同理，可以复用并分别标重点。

## 4. 仍然缺的操作状态

方案 D.2 已承认 C5、E9、B5/B6/C1/E2 成功连接、D6 导出成功，以及部分远程状态未完成验证。应继续保留这些限制，不能因已有 88 张候选图而改成全部完成。

此外，新增文字要求中还有以下视觉缺口，尚未被 D.2 完整列出：

1. **播放内容抽屉**：当前 C6 是播放队列，不能代替有“浏览内容/返回/播放全部/换一批”的内容抽屉；也没有展开的点歌匹配诊断图。
2. **点歌确认通知**：没有“下一首播放/跳过”的悬浮确认图。截图脚本还主动隐藏了 `#pendingConfirmPopup`，因此不能把它算在已拍状态里。
3. **弹幕回复与辅助设置**：签到、抽签、自定义关键词、欢迎、PK 播报等设置入口/展开状态没有对应图。
4. **粉丝详情与提醒**：E19 只有列表，未选中档案；没有档案详情和提醒页。E19b 的备份入口也不能代替备份恢复结果。
5. **导入结果和同步成功**：B12 只有输入界面；F2a 显示“暂时无法读取”和“本机尚未同步过歌单”。若正文教判断成功，还需相应反馈图和导出表格示例。
6. **加班机主控制区**：E11 只有规则编辑；初始时间、开始/暂停、关闭、最近结算尚无对应图。
7. **本机投屏效果与 OBS 操作**：当前 F 组主要是网页歌单、盲盒、弹幕预览、礼物许愿；没有点歌板/展示板效果图，也没有“添加浏览器源 → 粘贴地址 → 设置宽高”的 OBS/直播姬操作图。既然正文要面向初学者，应至少给一条完整的投屏操作示例。六种点歌板风格是否全部配图仍可按内容需要取舍。

并非每个字段都必须配图；入口、关键动作和操作结果已经清楚的地方可以只写文字。应按上面的流程缺口补图，不必继续追求固定张数。

## 5. 怎样做到“一眼知道是哪一页”

当前整窗图通常能辨认顶层页签，部分百宝箱图还保留左侧选中项，方向是对的。但 B2/B4/B6/B9/B10/B11、C2/C4/C7、D2–D6、E3–E7/E11/E19b、F2/F2a/F3a、S3/S4b 等局部图没有完整入口上下文；C7 尤其容易被误认成“播放页”，实际截自“点歌 → 桌面歌词设置”。

采用一个统一规则即可：

- 每个新流程先放一张带导航与选中页签的定位图。
- 后续特写保留面板标题；图片上方直接写入口，如“客户端 → 点歌 → 导入导出 → 网页歌单同步”，并注明“局部”。
- 对只有图标的动作补短标签或逐项序号说明；目前 B2 用一个“1”圈住三个按钮，读者仍不知道哪个是复制。
- 客户端与网页端都出现的功能明确标“客户端”或“网页主播中心”。F 组投屏效果则标画面名称，不要把预览设置页叫作纯投屏输出。
- 图上的状态必须自洽，示例图也不能混合“等待检查”和“可以安装”等互斥状态。
- 面板很长时按操作拆图，避免内部滚动容器截掉底部。直接增加窗口高度不保证容器内容全部出现在元素截图中；B11 和 E19b 已显示这个问题。
- A3/A4 的规则浮层在整窗缩放后偏小，发布时可在保留“注册 LIRA”标题的前提下放大；以手册实际展示宽度检查文字，而不只看原图像素。

## 6. 逐图审阅台账

“可保留”仅表示该图能说明所注明的界面内容，不代表操作已经成功实测。“补上下文”可通过配套定位图或清晰的入口图注完成；不必全部重拍。“演示”不是缺陷，但不能充当操作成功证据。

| 编号 | 当前图片 | 判断 | 要处理的内容 |
| --- | --- | --- | --- |
| A1 | [查看原图](images/usage-guide/A/client-login-window.webp) | 可保留 | 注册页、字段、主按钮齐全；发布时解释 1–4 对应步骤。 |
| A2 | [查看原图](images/usage-guide/A/client-login-existing-mode.webp) | 可保留 | 登录已有账号选中态及短效登录码清楚。 |
| A3 | [查看原图](images/usage-guide/A/client-login-username-help.webp) | 放大重点 | 浮层已拍到；整窗留白较多，手册缩放后规则文字偏小。 |
| A4 | [查看原图](images/usage-guide/A/client-login-password-help.webp) | 放大重点 | 密码规则浮层完整；建议保留注册标题并放大规则区。 |
| A5 | [查看原图](images/usage-guide/A/client-login-activation-code.webp) | 可保留 | 局部仍有注册 LIRA 标题；激活码框与说明已突出。 |
| A6 | [查看原图](images/usage-guide/A/client-login-preparing.webp) | 演示可用 | 准备中与进度可辨；保留演示标记，不称为真实初始化验证。 |
| A7 | [查看原图](images/usage-guide/A/client-login-failed-retry.webp) | 演示可用 | 错误信息与重试连接齐全；属于连接错误。 |
| A7b | [查看原图](images/usage-guide/A/client-preparation-failed.webp) | 演示可用 | 准备未完成与重试/返回登录齐全；应与 A7 区分。 |
| A8 | [查看原图](images/usage-guide/A/client-main-first-open.webp) | 可复用 | 与 B1 完全相同；这是有示例数据的主界面，不是未配置的首次空态。 |
| A9 | [查看原图](images/usage-guide/A/client-tour-bubble.webp) | 可保留 | 高亮、气泡、进度、下一步均存在。 |
| A10 | [查看原图](images/usage-guide/A/client-topbar-status.webp) | 修正文案 | 有导航和 ×；没有文字退出程序按钮，状态为未设置直播间。 |
| B1 | [查看原图](images/usage-guide/B/song-queue-overview.webp) | 可保留 | SC、点歌队列、七个页签齐全；可共用 A8。 |
| B2 | [查看原图](images/usage-guide/B/song-queue-item-actions.webp) | 补标签/上下文 | 显示置顶、复制、删除；没有详情。保留点歌队列标题并分别标三图标。 |
| B3 | [查看原图](images/usage-guide/B/song-library-list.webp) | 补上下文 | 列表和筛选清楚，但歌库页签已滚出视口；需定位图。 |
| B4 | [查看原图](images/usage-guide/B/song-library-edit.webp) | 修正文案/上下文 | 这是内嵌表单；补点歌→歌库入口，不叫弹窗。 |
| B5 | [查看原图](images/usage-guide/B/song-settings-account.webp) | 仅入口 | 未登录状态；与 B7 完全相同，不能覆盖本机已登录。 |
| B6 | [查看原图](images/usage-guide/B/song-settings-room.webp) | 仅入口/补上下文 | 未配置直播间，没有房主资料；补设置页签与成功状态。 |
| B7 | [查看原图](images/usage-guide/B/song-settings-rules.webp) | 可复用 | 六项规则和保存按钮齐全；与 B5 共用并分别标重点。 |
| B8 | [查看原图](images/usage-guide/B/song-theme-styles.webp) | 补上下文 | 六种风格按钮齐全，但点歌板页签已滚出；需要入口说明。 |
| B9 | [查看原图](images/usage-guide/B/song-theme-detail.webp) | 补上下文 | 风格参数基本齐全；保留具体风格名，底部按钮边缘勿裁切。 |
| B10 | [查看原图](images/usage-guide/B/song-board-settings.webp) | 补上下文 | 展示板四项和保存按钮齐全；当前默认字号是 28。 |
| B11 | [查看原图](images/usage-guide/B/song-overlay-addresses.webp) | 需补拍 | 前 7 项完整，后 4 项未完整拍到；见第 3 节。 |
| B12 | [查看原图](images/usage-guide/B/song-import-export.webp) | 需补结果 | 有导入表单，云端歌曲显示读取失败；补导入结果/同步成功，入口页签需保留。 |
| B13 | [查看原图](images/usage-guide/B/desktop-lyric-appearance.webp) | 需补下半部 | 只显示基础字体部分；描边、透明度、逐字等未覆盖。 |
| C1 | [查看原图](images/usage-guide/C/playback-platform-tabs.webp) | 仅入口 | 三个平台与登录按钮清楚；没有音乐平台成功登录状态。 |
| C2 | [查看原图](images/usage-guide/C/playback-search.webp) | 补上下文 | 搜索框、数量、搜索/清除齐全；有需要再补搜索结果。 |
| C3 | [查看原图](images/usage-guide/C/playback-wesing-cache.webp) | 仅配置入口 | 缓存路径和检测/时间调整可见；实际歌词与播放状态未验证，路径可改为通用示例。 |
| C4 | [查看原图](images/usage-guide/C/playback-player-bar.webp) | 补标签/上下文 | 未播放控制栏；图标需说明，折叠入口不在此局部图中。 |
| C6 | [查看原图](images/usage-guide/C/playback-queue-drawer.webp) | 可保留 | 队列、导入、清空、移除可见；拖动操作仍需文字说明；不能替代播放内容抽屉。 |
| C7 | [查看原图](images/usage-guide/C/playback-desktop-lyric-preview.webp) | 需补播放态/定位 | 空白等待播放；来自点歌→桌面歌词设置，不能当全屏歌词效果。 |
| D1 | [查看原图](images/usage-guide/D/gift-page-overview.webp) | 改范围名称 | 只拍礼物页上半部；下半部可用 D9/D10 接续。 |
| D2 | [查看原图](images/usage-guide/D/gift-auto-thanks.webp) | 演示/补上下文 | 开关和服务器运行提示齐全；无可编辑答谢模板。 |
| D3 | [查看原图](images/usage-guide/D/gift-danmaku-query.webp) | 演示/可合并 | 与 D2 范围高度重复，主要增加标注；明确礼物页入口。 |
| D4 | [查看原图](images/usage-guide/D/gift-recent-and-all.webp) | 补上下文 | 最近礼物和查看全部完整；说明来自礼物页。 |
| D5 | [查看原图](images/usage-guide/D/gift-history-drawer.webp) | 补选中态 | 筛选和列表齐全，但选中 0 条、导出按钮未启用；最好展示选中后的下一步。 |
| D6 | [查看原图](images/usage-guide/D/gift-export-workspace.webp) | 未完成成功验收 | 仅预览与保存设置；没有真实保存/打开文件夹结果，原文已披露运行错误。 |
| D7 | [查看原图](images/usage-guide/D/gift-wishes.webp) | 需配 D7b | 周期、样式、进度可见，底部复制地址未入镜；完整流程需搭配 D7b。 |
| D7b | [查看原图](images/usage-guide/D/gift-wishes-text.webp) | 补上下文 | 动态占位符、文字预览及底部地址可见；注明百宝箱→礼物姬→礼物许愿。 |
| D8 | [查看原图](images/usage-guide/D/gift-blindbox-analysis.webp) | 需补视图 | 只展示按观众看；按盲盒看、开盒记录及有效分页未覆盖。 |
| D9 | [查看原图](images/usage-guide/D/gift-blindbox-leaderboard-settings.webp) | 可复用 | 参数齐全；与 D10 完全相同，按重点配说明。 |
| D10 | [查看原图](images/usage-guide/D/gift-sprint.webp) | 可复用 | 冲刺数据和重置本轮齐全；与 D9 共用。 |
| E1 | [查看原图](images/usage-guide/E/toolbox-nav.webp) | 需补拍 | 四组导航不全，软件与帮助四项未显示。 |
| E2 | [查看原图](images/usage-guide/E/danmaku-connection.webp) | 仅未连接态 | 有连接区和入口；没有成功连接状态。 |
| E3 | [查看原图](images/usage-guide/E/danmaku-styles.webp) | 需配操作图 | 九种样式齐全；应用到直播画面按钮不在本图。 |
| E4 | [查看原图](images/usage-guide/E/danmaku-send.webp) | 仅入口/补上下文 | 输入和 Ctrl+Enter 可见，但发送按钮不可用，没有发送结果。 |
| E5 | [查看原图](images/usage-guide/E/danmaku-blacklist.webp) | 补上下文 | 屏蔽设置控件齐全；需标明弹幕姬面板。 |
| E6 | [查看原图](images/usage-guide/E/danmaku-params.webp) | 修改要求/补图 | 固定深色面板没有停留时间；另截全屏随机状态与应用按钮。 |
| E7 | [查看原图](images/usage-guide/E/ai-assistant-config.webp) | 需补关键状态 | 配置表单存在；六个平台下拉选项未展开，没有正常测试结果。 |
| E8 | [查看原图](images/usage-guide/E/dynamic-lottery-setup.webp) | 需补拍 | 桌面专用功能不可用的错误状态，不宜作为正常设置截图。 |
| E10 | [查看原图](images/usage-guide/E/toolbox-games.webp) | 需补下半部 | 只有数字炸弹/五子棋；你画我猜和转盘未入镜。 |
| E10b | [查看原图](images/usage-guide/E/toolbox-voting.webp) | 演示/补上下文 | 投票表单和内置预览齐全；标明小游戏→投票与评分。 |
| E10c | [查看原图](images/usage-guide/E/toolbox-rating.webp) | 演示/补上下文 | 评分范围和结果示例齐全；不能当实际评分成功证据。 |
| E11 | [查看原图](images/usage-guide/E/toolbox-overtime-rule.webp) | 补定位/主控制区 | 规则编辑清楚；图内无加班机页面定位，未覆盖计时器主控制。 |
| E12 | [查看原图](images/usage-guide/E/toolbox-gift-effects.webp) | 可保留 | 导航、礼物 ID、测试、投屏地址、触发示例齐全。 |
| E13 | [查看原图](images/usage-guide/E/toolbox-planner.webp) | 建议补示例内容 | 页面位置清楚，但日程、备忘、待办全空，勾选/分类结果看不到。 |
| E13b | [查看原图](images/usage-guide/E/toolbox-planner-event.webp) | 可保留 | 新建日程字段与保存齐全；配 E13 使用。 |
| E14 | [查看原图](images/usage-guide/E/toolbox-desktop-update.webp) | 演示可用 | 等待检查状态、自动更新、目录入口一致。 |
| E14b | [查看原图](images/usage-guide/E/toolbox-update-download.webp) | 需补拍 | 下载更新按钮与等待检查更新状态冲突。 |
| E14c | [查看原图](images/usage-guide/E/toolbox-update-ready.webp) | 需补拍 | 重启并更新按钮与等待检查更新状态冲突。 |
| E15 | [查看原图](images/usage-guide/E/gift-frame-settings.webp) | 可复用 | 设置与预览按钮可见；与 E1 完全相同，不等于已展示动效。 |
| E16 | [查看原图](images/usage-guide/E/gift-feed-settings.webp) | 可保留 | 选中页签、四档金额、行数/速度/最低金额、预览与地址齐全。 |
| E17 | [查看原图](images/usage-guide/E/toolbox-clock.webp) | 可保留 | 导航、六种样式、预览、时间选项和地址齐全。 |
| E18 | [查看原图](images/usage-guide/E/toolbox-opening.webp) | 需补下半部 | 音乐上传/音量等未完整入镜；预览处于暂停状态。 |
| E19 | [查看原图](images/usage-guide/E/toolbox-fan-profiles.webp) | 需补详情/提醒 | 入口、列表、筛选齐全；无选中档案详情，没有提醒页。 |
| E19b | [查看原图](images/usage-guide/E/fan-profiles-settings.webp) | 需补下半部/定位 | 档案管理只有标题，三项管理操作未显示；设置页签也被裁掉。 |
| E19c | [查看原图](images/usage-guide/E/fan-profiles-create.webp) | 需补表单内容 | 基本信息底部标签区被裁切，生日偏好/提醒页签内容未拍。 |
| E20 | [查看原图](images/usage-guide/E/toolbox-settings.webp) | 可保留 | 账户与网站、登录、找回密码提示及导航清楚。 |
| E21 | [查看原图](images/usage-guide/E/toolbox-performance.webp) | 仅检测入口 | 六张卡片均等待检测；不能说明检测后数据，且没有两视图切换。 |
| F1 | [查看原图](images/usage-guide/F/public-song-page.webp) | 可保留 | 移动端标题、歌曲、搜索和筛选入口齐全；未展开筛选或复制结果。 |
| F2 | [查看原图](images/usage-guide/F/public-song-page-qr.webp) | 补上下文 | 分享与二维码完整；局部无法直接看出网页主播中心，配 S5 定位。 |
| F2a | [查看原图](images/usage-guide/F/client-song-page-link.webp) | 仅入口/补成功态 | 显示暂时无法读取、尚未同步；需客户端→点歌→导入导出路径。 |
| F3 | [查看原图](images/usage-guide/F/public-song-page-appearance.webp) | 可保留/补展开态 | 网页导航、名称和背景完整；歌单外观折叠，精细设置未展示。 |
| F3a | [查看原图](images/usage-guide/F/client-song-page-background.webp) | 需补背景状态 | 默认背景导致恢复默认背景按钮隐藏；补已上传示例背景后的状态。 |
| F4 | [查看原图](images/usage-guide/F/public-overlay-blindbox.webp) | 示例效果可用 | 排行、金额、布局完整；图注注明透明背景及示例记录。 |
| F5 | [查看原图](images/usage-guide/F/public-overlay-danmaku.webp) | 内置预览可用 | 含样式选择侧栏，是预览页；不要当作实际 OBS 纯投屏截图。 |
| F6 | [查看原图](images/usage-guide/F/gift-wishes-overlay.webp) | 示例效果可用 | 卡片和文字状态齐全；兜底图标使礼物难区分，正式示例可补礼物名/正常图片。 |
| S1 | [查看原图](images/usage-guide/S/server-manage-login.webp) | 修正入口文案 | 实际链接是使用重置码；图内无浏览器地址栏，图注要明确网页登录入口。 |
| S1b | [查看原图](images/usage-guide/S/server-password-reset.webp) | 可保留 | 重置字段及返回登录齐全；修正“忘记密码按钮”说法。 |
| S2 | [查看原图](images/usage-guide/S/server-manage-overview.webp) | 可保留 | 主播中心标题、四个分区与退出登录均可辨。 |
| S3 | [查看原图](images/usage-guide/S/server-manage-gift-ledger.webp) | 补上下文 | 筛选、列表、分页齐全；失去侧栏后应注明主播中心→礼物流水。 |
| S4 | [查看原图](images/usage-guide/S/server-manage-analytics.webp) | 示例可用 | 有导航、概览和趋势；与 S4b 配套说明构成。 |
| S4b | [查看原图](images/usage-guide/S/server-manage-gift-composition.webp) | 补上下文 | 构成卡完整；样例只有普通礼物，无法说明多类型对比效果。 |
| S5 | [查看原图](images/usage-guide/S/server-manage-song-page.webp) | 修改范围图注 | 只显示分享与歌曲；名称/背景使用 F3，二维码使用 F2。 |
| S6 | [查看原图](images/usage-guide/S/server-manage-danmaku.webp) | 需补拍 | 底部 OBS 地址和复制按钮被截断。 |
| S7 | [查看原图](images/usage-guide/S/admin-registration-code.webp) | 仅维护者 | 入口图可用；未生成码，不作为已发码或有效期结果证据。 |
| S7b | [查看原图](images/usage-guide/S/admin-short-login-code.webp) | 仅维护者 | 短效登录码入口可用；不纳入主播手册。 |
| S8 | [查看原图](images/usage-guide/S/admin-device-list.webp) | 仅维护者 | 设备状态与撤销入口可用；没有执行撤销。 |
| S9 | [查看原图](images/usage-guide/S/admin-reset-code.webp) | 仅维护者 | 授权与重置码入口可用；没有生成码的结果。 |
| R1 | [查看原图](../public/img/usage-guide/install-existing-user.webp) | 旧版需替换 | 显示点歌助手 3.2.5 与当前 LIRA 不同；不宜作为当前安装器主图。 |
| R2 | [查看原图](../public/img/usage-guide/install-existing-location.webp) | 旧版需替换 | 同为旧产品名/版本；安装路径还包含个人 Windows 用户名。 |
| R3 | [查看原图](../public/img/usage-guide/uninstall-lira.webp) | 补上下文 | 只显示 Uninstall LIRA.exe 文件名，无法告诉小白从哪里找到它。 |
| R4 | [查看原图](../public/img/usage-guide/deepseek-login.webp) | 第三方旧素材 | 可解释登录大致位置；未复核线上当前界面，二维码不应引导读者扫描截图登录。 |
| R5 | [查看原图](../public/img/usage-guide/deepseek-email-later.webp) | 第三方旧素材 | 提示完整，标题能识别绑定邮箱；配 R4/R6 说明位置。 |
| R6 | [查看原图](../public/img/usage-guide/deepseek-api-keys.webp) | 第三方旧素材 | API keys 页面与创建入口可辨；已遮盖列表。 |
| R7 | [查看原图](../public/img/usage-guide/deepseek-create-key.webp) | 第三方旧素材 | 创建表单完整；配 R6 使用。 |
| R8 | [查看原图](../public/img/usage-guide/deepseek-copy-key.webp) | 第三方旧素材 | 复制按钮和密钥安全提示清楚；密钥主体已遮盖。 |
| R9 | [查看原图](../public/img/usage-guide/deepseek-usage.webp) | 第三方旧素材 | 余额/用量可辨，但显示个人金额和使用记录，建议换示例或遮盖无关数字。 |
| R10 | [查看原图](../public/img/usage-guide/deepseek-recharge.webp) | 第三方旧素材 | 充值入口可辨；金额、活动、账号片段不作为当前规则，发布时去除无关信息。 |

## 7. 修订完成后的验收标准

1. 第 2 节事实错误全部修正；写清客户端和网页端边界，按钮文案能在当前界面找到。
2. 第 3 节的裁切与互斥状态问题处理完；每项“必须有”均有实际图片或明确配套图位。
3. 第 4 节按实际正文补关键操作链；保留仍未实测的状态，不写成已验证成功。
4. 单独看图片和紧邻图注，能回答“客户端还是网页端、哪个页面、点哪个按钮、现在是什么状态”。
5. 在正式手册实际展示宽度下检查文字可读性；重新核对图片链接、尺寸和章节跳转。维护者素材、旧版图与正式主播操作图明确区分。

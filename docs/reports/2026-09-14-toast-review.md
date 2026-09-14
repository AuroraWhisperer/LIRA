# LIRA Toast 全量审查与修改建议

- 审查日期：2026-09-14，Asia/Shanghai。
- 对象：当前工作树，LIRA 4.1.3，HEAD `5dc43ff`；包含工作树已有修改，不代表已发布安装包。
- 交付状态：下方审查证据保留为修复前记录；2026-09-14 已完成本轮代码修复，实施与验证状态见 §0。
- 产品目标：Electron 桌面客户端。独立礼物对账页作为单独的辅助页面检查。
- 方法：源码与调用链检查、38 项现有聚焦测试、12 个隔离逻辑场景、原始 CSS 在 Chromium 中的样式测量及截图观察、颜色对比度计算。
- 验证边界：模拟 DOM、计时器、登录桥、HTTP 和 WebSocket，不接触真实用户数据；样式检查采用 1280×720 的 Chromium 内容区域，未操作真实 Electron 客户端，也未完成屏幕阅读器或系统减少动态效果的实机测试。

## 0. 实施状态（2026-09-14）

本轮落实 27 项，未更改认证、更新安装、价格/账本、对账匹配及持久化协议。实施计划：[Toast 修复计划](../../specs/plans/archive/2026-09-14-toast-fixes.md)。历史章节中的“实际”“复现”均描述修复前状态。

| 项目 | 已实施内容 | 验证依据 |
| --- | --- | --- |
| B01、U04（礼物） | 产物为标题，盲盒为来源；事件 ID 稳定 key，累计数量原位更新 | 名称不同/相同/缺失、转义及 ×1→×2 回归 |
| B02 | 业务去重区分版本+阶段，显示层同版本原位推进 | available→downloaded 立即到达及过期后到达、重复阶段回归 |
| B03–B05 | 健康检查同 key 更新（含抛错）；旧提示绑定产生时的平台；登录结果分已登录/未完成/暂时无法确认 | 两种状态反转、旧 QQ 提示在网易云下操作、认证三态回归 |
| B06、U01–U05、V01/V03/V04 | 共享通知控制器绑定节点/计时器；幂等关闭、交互暂停、真实按钮、语义分级、受控播报、可视空间调度、长文换行与可滚动、统一退出/reduce；CSS 排序保持键盘焦点 | 隔离时钟/DOM、公用 API 回归、浏览器焦点/Enter 操作；Electron 离屏渲染与 Chromium 几何测量 |
| B07 | 自有错误文案的保存调用关闭 API 自动提示，默认行为保留 | 设置开关一次失败只弹一条、状态回退、默认 API 错误及 payload 契约回归 |
| B08/B09、V06 | 无解析/拉取失败停止核对；辅助页单条原位更新；成功背景加深 | 无礼物/取数失败/可靠空响应回归；三次连续提示同节点、长文无溢出；白字与 #246b59 对比度约 6.32:1 |
| U06 | 盲盒和词库现有输入校验就地显示、关联说明并聚焦，修改后清理 | 字段说明保留与清理回归，既有词库编辑/保存交错测试 |
| V02/V05/V07 | 富卡片宽度恢复 360–420px；两处状态图标中心修正；基础圆角/阴影/标题层级统一，保留业务配色 | 6 类长字符串测量、默认及最小尺寸混合通知截图检查 |
| C01 | 本机账号/云端条件留在账号区；歌曲本地保存与云端说明分开；清空统计留在结果区；盲盒移除文案保留待确认状态 | 账号文案契约迁移到页面说明；保留清空部分失败恢复测试及服务器返回统计 |
| C02/C03 | AI 最近一次测试的回复/错误在各测试区保留；toast 同 key 摘要；导入按返回计数区分四类结果 | AI 自动保存和测试先后契约、详情保留；导入全成功/部分失败/全失败/全重复回归 |
| C04/C05 | 减少打开标签页、加载编辑表单和转盘开始的重复提示；指南更正为应用右上角的应用内礼物提示 | 聚焦差异审查、使用指南测试 |

验证记录：

- 聚焦测试：145 项通过（包含通知业务、公共生命周期、真实浏览器焦点/独立对账、既有 AI/账号/词库/播放器及清空恢复契约）。
- `npm run check`：719 个 JavaScript 文件语法检查通过；`npm run verify:docs`：5 项通过；`git diff --check` 无空白错误。
- 架构检查：模块依赖、ESM、legacy/空 catch 冻结规则通过；行数基线检查仍报告任务开始前已有的 `public/css/admin/workspace/song.css`（781 行未登记 review）及 `public/css/license.css`（735 行超过 702 行基线）。未改这两个文件或放宽登记。
- Electron 43.2.0：临时 userData、独立静态页面、离屏软件渲染；1280×720 与 1024×680 混合通知均保留错误与动作，末条底边分别约 676.4px 与 590.1px；动作双次触发只执行一次。不是加载真实业务客户端的实机验收。
- Chromium：6 类富卡片的连续长标题/URL 无横向溢出；reduce 下动画 none、transition 0s、transform none；浏览器回归确认新通知不丢失动作按钮焦点，Enter 可触发。
- Impeccable 检测只有一项既有直播图标弹性曲线风格建议，本轮保留该装饰及业务特色；不把风格建议视为功能失败。
- 未操作真实账号、更新安装或直播；完整客户端交互、系统屏幕阅读器及硬件加速下的动效手感仍待实机体验。原始报告的读屏限制继续适用。

## 1. 结论与优先级

建议处理 **27 项**：9 项行为问题、6 项交互问题、7 项样式与动效问题、5 项文案与反馈建议。其中 **P1 3 项、P2 19 项、P3 5 项**。

优先解决错误的礼物名称、过期的接口检查结果、登录提示与实际打开平台不一致，再修复通知去重、计时与堆叠。视觉调整以统一基础规格和改善阅读为目标，保留礼物、大航海等已有业务特色。

优先级表示本轮建议的修改顺序，不是安全漏洞等级：

- **P1**：先修；用户看到的信息或执行的动作与实际状态不一致。
- **P2**：随后处理；通知遗漏、重复、不可读、难以操作，或重要结果表达不充分。
- **P3**：最后处理；设计一致性、降噪和说明文案，具体样式允许调整。

证据标记：**L** 为真实模块配合隔离依赖的逻辑复现；**R** 为原始 CSS 在 Chromium 中的渲染测量；**S** 为源码及调用链确认；**D** 为设计建议。R 不等同于 Electron 实机验收。

| ID | 优先级 | 修改项 | 证据 |
| --- | --- | --- | --- |
| B01 | P1 | 盲盒通知把盲盒名当成开出的礼物名 | L、S |
| B02 | P2 | 同版本下载完成提醒被去重过滤 | L、S |
| B03 | P1 | 新的接口检查结果被旧 toast 拦截 | L、S |
| B04 | P1 | 旧登录提示可能打开另一个音乐平台 | L、S |
| B05 | P2 | 未登录也出现成功造型的 Cookie 刷新提示 | L、S |
| B06 | P2 | 礼物批量淘汰误清理其他通知的去重键 | L、S |
| B07 | P2 | 一次设置保存失败弹出两条错误 | L、S |
| B08 | P2 | 对账前提不足时仍给出成功或漏记判断 | L、S |
| B09 | P2 | 独立对账页的多条 toast 完全重叠 | R、S |
| U01 | P2 | 普通通知缺少成功、警告、错误分级 | R、S、D |
| U02 | P2 | 阅读及操作期间仍自动消失，缺少关闭入口 | L、S、D |
| U03 | P2 | 系统提示无总量约束，与礼物争抢可视空间 | R、S、D |
| U04 | P2 | 同一操作的进度和完成状态没有原位更新 | L、S、D |
| U05 | P2 | 动态通知缺少统一的无障碍播报语义 | S、D |
| U06 | P2 | 表单校验过度依赖远离输入位置的 toast | S、D |
| V01 | P2 | 长字符串溢出或被无提示裁切 | R、S |
| V02 | P3 | 多种声明宽度被公共 360px 上限覆盖 | R、S |
| V03 | P2 | 进退场生命周期和堆叠移动不一致 | L、S、D |
| V04 | P2 | 减少动态效果适配不完整，存在 transition: all | S、D |
| V05 | P3 | 播放器两个状态图标明显偏左 | R、S |
| V06 | P2 | 对账成功提示的文字对比度不足 | 计算、R、S |
| V07 | P3 | 富信息卡片的基础视觉规格需要统一 | R、S、D |
| C01 | P2 | 账号、同步和清空结果过长，不适合短暂显示 | R、S、D |
| C02 | P2 | AI 测试详情只短暂出现在 toast 中 | S、D |
| C03 | P2 | 导入结果缺少成功、部分失败的摘要区别 | S、D |
| C04 | P3 | 可直接观察到的页面操作产生额外提示 | S、D |
| C05 | P3 | 使用指南对礼物通知位置与形态的描述不准确 | S |

## 2. 检查覆盖范围

关键词扫描覆盖 `public/js/`、`public/css/`、`public/pages/`，命中 49 个 JavaScript 文件、9 个 CSS 文件、2 个 HTML 分片；其中包含入口、依赖注入及转发文件，不能将这个数量当作独立通知类型或业务场景数量。另检查了相关状态契约、辅助分析模块、窗口尺寸和现有测试。

| 通知家族 | 当前实现与状态 | 当前停留时间 | 覆盖情况 |
| --- | --- | --- | --- |
| 普通操作、校验、错误 | `toast()`、`showError()` → `showStackedToast()` | 2600ms | 逐类检查保存、复制、导入、删除、设置、播放、小游戏、引导调用 |
| 播放器登录引导 | `playback-login-toast`，整卡点击进入登录 | 5200ms | 登录动作、平台切换、键盘处理、样式 |
| 播放队列为空 | `playback-empty-queue-toast` | 4200ms | 触发条件、引导文字、样式 |
| 音乐接口检查 | `playback-health-toast-good/warn` | 均为 3800ms | 连续结果变化、成功与异常样式 |
| 音乐登录窗口关闭 | `music-cookie-refreshed-toast` | 3600ms | 已登录与未登录结果、图标 |
| AI 测试 | `xiaomi-ai-test-toast-good/warn` | 成功 3600ms；失败 5200ms | 模型回复、错误详情、长内容 |
| 直播刷新 | `admin-live-refresh-toast` | 2800ms | 结果文案、图标入场、呼吸光、减少动态效果 |
| 桌面更新 | `desktop-update-toast` 及 `good` | 有更新 3000ms；无更新 4200ms | available → downloaded、点击入口、样式 |
| 礼物事件 | 普通、免费、大航海、盲盒、高价值五种外观 | 3200ms；最多保留 6 条礼物 | 名称、金额展示、数量变化、批量插入和淘汰 |
| 礼物图片更新 | `gift-catalog-update-toast`，进度/完成/部分失败/失败 | 进度持续显示；结束后 2600ms | 单节点更新、结束移除、启动静默规则 |
| 独立礼物对账 | `gift-audit/view.js` 的 `showToast()`，ok/warn | 2500ms | 输入与数据前提、重叠、颜色和动效 |

Bilibili 协议中的 `USER_TOAST_MSG*` 是礼物事件命令，不是本轮要改的界面 toast。没有把它列为 UI 缺陷，也没有将授权页的固定状态提示或 OBS 礼物特效混入本报告。

## 3. 行为问题

### B01 · P1 · 盲盒名与产物名混用

位置：[public/js/admin/gifts/notification.js:99](/D:/Work/Live/public/js/admin/gifts/notification.js:99)。

- 复现：同一条记录包含 `gift_name=测试产物`、`blind_box_name=测试盲盒`。
- 实际：标题为“测试盲盒 x1”，副标题为“测试观众 送出盲盒 · 开出 测试盲盒”；实际产物名完全没有展示。
- 修改：明确使用盲盒字段表示购买的盒子，使用礼物字段表示开出的产物。建议组织成“测试产物 ×1”与“测试观众 · 来自测试盲盒”，或保持盲盒为标题、在副标题写正确产物。
- 验收：盲盒名与产物名不同、相同及盲盒名缺失均能正确展示；继续使用现有转义处理；不改价格计算、账本或礼物结算。

### B02 · P2 · 下载完成通知被同版本去重

位置：[public/js/desktop.js:129](/D:/Work/Live/public/js/desktop.js:129)、[public/js/desktop.js:148](/D:/Work/Live/public/js/desktop.js:148)。

- 复现：收到版本 A 的 `available`，等该 toast 完全消失，再收到版本 A 的 `downloaded`。
- 实际：没有下载完成 toast。业务层 `desktopUpdateNoticeKey` 只记版本，公共 toast 的 key 也没有区分更新阶段。
- 修改：区分版本和阶段，或用一个可更新通知从“发现更新”推进到“下载完成”。只修改其中一层 key 不足以覆盖所有时序。
- 验收：同版本两个阶段都可表达；相同阶段重复事件保持去重；快速下载与超过首条停留时间的下载均验证。仍由更新页执行安装，保留现有重启确认。

### B03 · P1 · 接口检查失败后仍展示上一次成功

位置：[public/js/shared/utils.js:143](/D:/Work/Live/public/js/shared/utils.js:143)、[public/js/playback/operations/provider-operations.js:123](/D:/Work/Live/public/js/playback/operations/provider-operations.js:123)。

- 复现：同平台第一次检查通过，在 3800ms 内第二次检查返回异常。
- 实际：模块最新健康状态已经是失败，但 toast 仍显示“接口检查通过／第一次通过”。相同 key 被直接忽略。
- 修改：状态类通知收到新结果时更新同一节点的标题、正文、语义类型及计时；不能把“同一对象的新状态”当成重复事件丢弃。
- 验收：通过→失败、失败→通过都显示最新结果；同内容重复触发不增加卡片，并给用户足够时间阅读本次反馈。

### B04 · P1 · 登录提示文字与打开的平台不一致

位置：[public/js/playback/operations/provider-operations.js:161](/D:/Work/Live/public/js/playback/operations/provider-operations.js:161)、[public/js/playback/operations/provider-operations.js:192](/D:/Work/Live/public/js/playback/operations/provider-operations.js:192)。

- 复现：在 QQ 音乐下触发“请先登录QQ音乐”，切换到网易云，再点击仍存在的 QQ 提示。
- 实际：登录桥收到 `netease`。提示文字生成时读取平台，点击回调执行时再次读取可变的当前平台。
- 修改：动作绑定提示产生时的平台，或切换平台时关闭已经过期的登录提示。登录结果也应与发起的平台对应。
- 验收：提示上写的品牌、实际登录桥参数、完成后的结果文案一致；不能因旧 toast 操作当前另一平台。

### B05 · P2 · 未登录也显示成功造型的 Cookie 提示

位置：[public/js/playback/operations/provider-operations.js:166](/D:/Work/Live/public/js/playback/operations/provider-operations.js:166)。

- 复现：登录窗口正常关闭，刷新后的 `loggedIn` 仍为 `false`。
- 实际：仍弹绿色对勾卡片“Cookie 已刷新”，正文只说明登录窗口已关闭。
- 修改：以发起平台的认证结果表达“QQ音乐已登录”“尚未完成QQ音乐登录”或“暂时无法确认登录状态”。用户关心的是能否使用账号；技术上的 Cookie 刷新不应承担登录结果反馈。
- 验收：已登录、关闭但未登录、状态查询失败分别表达。这里没有证明 Cookie 刷新操作本身失败，也没有发现认证绕过；问题是用户操作结果的表达。

### B06 · P2 · 礼物淘汰时误删其他卡片的去重键

位置：[public/js/shared/utils.js:174](/D:/Work/Live/public/js/shared/utils.js:174)。

- 复现：同一批连续加入 8 条不同礼物，推进 180ms，再直接请求仍在显示的第 3 条礼物通知。
- 实际：第 3 条出现两份。第 7、8 次插入会给旧节点重复安排移除；移除回调每次删除集合里第一个 `gift:` key，而不是被移除节点自己的 key。
- 修改：节点、key、计时器建立明确的一一对应；移除操作幂等；同一旧节点不能重复清理，旧计时器不能删除后来重建节点的状态。
- 验收：批量 8 条、10 条、连续多个批次后，保留节点与活跃 key 一致；仍显示的相同 key 不重复创建。
- 影响边界：当前礼物业务入口还有 `giftNoticeKeys` 去重。上述复现确认的是公共显示层状态错误，不等于正常直播一定会出现重复提示，更不等于重复入账。

### B07 · P2 · 同一次保存失败出现两条错误

位置：[public/js/shared/utils.js:221](/D:/Work/Live/public/js/shared/utils.js:221)、[public/js/admin/settings-form.js:51](/D:/Work/Live/public/js/admin/settings-form.js:51)、[public/js/desktop.js:84](/D:/Work/Live/public/js/desktop.js:84)。

- 复现：开启礼物提示时，设置接口返回错误“测试网络故障”。
- 实际：同时出现“测试网络故障”和“保存失败：测试网络故障”。`api()` 已提示并重新抛出，业务 catch 又提示一次；文本不同导致公共去重无效。
- 修改：一次操作明确由一层负责展示错误。有定制错误反馈的调用方应能关闭默认提示；迁移时保留其他依赖 `api()` 自动提示的调用方行为，不能直接删掉所有默认错误提示。
- 验收：开关保存失败只出现一条有上下文的错误，开关仍按现有逻辑回退；普通依赖默认错误反馈的调用方也能看到失败。

### B08 · P2 · 对账前提不足时仍给出判断

位置：[public/js/gift-audit/index.js:119](/D:/Work/Live/public/js/gift-audit/index.js:119)、[public/js/gift-audit/index.js:157](/D:/Work/Live/public/js/gift-audit/index.js:157)。

- 复现一：输入非空的空气泡容器，实际解析到 0 条礼物。toast 却说“所有气泡礼物均在 WebSocket 中有记录”，而表格已经提示未解析到礼物。
- 复现二：有 1 条有效示例气泡、服务器缓存为空、拉取记录失败。页面显示加载失败，但 toast 继续报告“发现 1 条疑似漏记礼物”。
- 修改：区分“未识别礼物”“记录获取失败，暂时无法核对”“核对完成”。满足输入与数据前提后再表达匹配或疑似漏记；不在本任务中重写匹配算法。
- 验收：两种不足条件均不输出确定的核对结果；有可靠数据时继续报告真实匹配结果。

### B09 · P2 · 对账页多条 toast 完全重叠

位置：[public/js/gift-audit/view.js:129](/D:/Work/Live/public/js/gift-audit/view.js:129)、[public/css/gift-audit.css:310](/D:/Work/Live/public/css/gift-audit.css:310)。

- 实测：连续显示三条不同文案，三者坐标完全相同：`top=16px`、`left≈587.2px`，宽度约 `105.6px`。
- 原因：每次追加独立的 fixed 节点，没有替换或堆叠规则。快速点击“加载示例”“解析对比”等动作会互相遮挡。
- 修改：这个辅助页面优先采用一条通知原位替换，或接入明确的堆叠规则。可以共享行为，但不必为此导入整个 Admin 样式体系。
- 验收：连续三次提示能看到最新结果，没有多份文字和背景重叠；关闭动画和播报行为一并与基础规则对齐。

## 4. 交互与通知规则

### U01 · P2 · 增加明确的语义分级

位置：[public/js/shared/utils.js:134](/D:/Work/Live/public/js/shared/utils.js:134)、[public/js/shared/utils.js:243](/D:/Work/Live/public/js/shared/utils.js:243)、[public/css/admin/toasts/system.css:19](/D:/Work/Live/public/css/admin/toasts/system.css:19)。

“设置已保存”和“保存失败”目前共用相同深绿样式；普通校验也走同一路径。建议由调用方明确指定普通信息、成功、警告、错误，使用图标、文字和颜色共同表达，错误默认保留更长时间。不要根据字符串里有没有“失败”等字样猜类型。

验收：同一个保存操作的成功、部分生效、失败可一眼分辨；文字本身也能独立说明结果；原有 `toast(message)` 调用保持兼容。

### U02 · P2 · 阅读和操作期间暂停计时，提供关闭入口

位置：[public/js/shared/utils.js:155](/D:/Work/Live/public/js/shared/utils.js:155)、[public/js/shared/utils.js:193](/D:/Work/Live/public/js/shared/utils.js:193)。

公共实现只有 click/keydown 行为，没有悬停或聚焦暂停。隔离测试中，即使节点仍是活动焦点，3000ms 的动作提示也会在 3180ms 被移除。桌面更新需要点击却只显示 3 秒，“已经是最新版本”反而显示 4.2 秒，轻重顺序也不合理。

建议：成功短提示 2–3 秒；错误和较长结果 5–8 秒；带动作提示至少留出更充分时间并在悬停、聚焦时暂停，提供可访问的关闭按钮。必要操作还应在原页面保留稳定入口。这些时长是设计起点，不是无障碍标准规定的固定值。

验收：鼠标移入或键盘聚焦后不会突然消失；恢复计时不会重复绑定；关闭后焦点不落到无效节点；点击动作不会重复触发请求。

### U03 · P2 · 统一可视空间预算，保护操作结果

位置：[public/css/admin/toasts/system.css:7](/D:/Work/Live/public/css/admin/toasts/system.css:7)、[public/js/shared/utils.js:165](/D:/Work/Live/public/js/shared/utils.js:165)。

普通通知没有数量限制，礼物有 6 条限制，全部在同一列顶部插入。在 1280×720 内容区域，3 条单行操作结果加 6 条双行礼物卡片，最后一条的底部到达 **744.6px**，已经超出屏幕。复现延长了样例停留时间便于测量，未修改样式或卡片高度。

建议：普通操作结果最多同时显示约 3 条，并为错误和带动作提示保留优先空间；高频礼物单独计数、更新或排队。总高度仍须受当前内容区域约束，不能只给两类各设上限后继续无限相加。具体放在同列还是分区属于设计选择。

验收：在 Electron 默认及最小窗口中，业务通知同时到来不会把失败提示推出可视区；不要以简单隐藏溢出、直接裁掉操作入口代替管理策略。

### U04 · P2 · 同一操作采用一条可更新通知

位置：[public/js/playback/operations/playlist-operations.js:161](/D:/Work/Live/public/js/playback/operations/playlist-operations.js:161)、[public/js/playback/operations/playlist-operations.js:201](/D:/Work/Live/public/js/playback/operations/playlist-operations.js:201)、[public/js/admin/gifts/notification.js:112](/D:/Work/Live/public/js/admin/gifts/notification.js:112)。

删除歌单歌曲时，“正在删除”和“已删除”是两条不同文案，会同时存在；耗时超过 2.6 秒时，“正在删除”还会在任务结束前自行消失。同一礼物记录从 ×1 更新为累计 ×2，也会同时显示 ×1 与 ×2 两张卡片。

建议：操作生命周期使用稳定身份，原位更新进度、成功或失败，完成后再开始结果停留计时；同一个礼物记录更新累计数量与金额时更新原卡片，不在显示层自行推算结算增量。礼物图片更新已有单节点控制器，可保留这一行为。

验收：进度→成功、进度→失败各只有一条卡片；同一记录数量更新不展示多个累计状态；不同事件仍可各自通知。这是展示层调整，不涉及账本去重。

### U05 · P2 · 补齐播报语义和动作语义

位置：[public/pages/admin/document-end.html:1](/D:/Work/Live/public/pages/admin/document-end.html:1)、[public/js/shared/utils.js:146](/D:/Work/Live/public/js/shared/utils.js:146)、[public/js/gift-audit/view.js:129](/D:/Work/Live/public/js/gift-audit/view.js:129)。

公共容器和普通节点没有 `aria-live` 或状态角色；图片更新节点单独设置了 `role=status`，不能覆盖其他提示。可点击节点已有 `role=button`、tabindex、Enter/Space 处理，不能把它误判为完全无法用键盘操作。

建议：给操作结果建立受控的状态播报区域；紧急错误才使用更强的播报方式，高频礼物不要逐条抢占朗读。动作与关闭入口采用真实按钮，装饰符号不进入可访问名称，保持可见的聚焦状态。Chromium 样本的可访问树已经包含部分 CSS 装饰字符，后续应避免把它们作为额外正文朗读。

验收：屏幕阅读器能获知保存、失败和进度完成；不会因礼物流或进度每次增加而持续打断用户；保留现有键盘能力。这一建议依据 [W3C 状态消息说明](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)，实机朗读尚待验证。

### U06 · P2 · 校验信息跟随输入位置

位置：[public/js/admin/settings-blindbox.js:91](/D:/Work/Live/public/js/admin/settings-blindbox.js:91)、[public/js/admin/danmaku-libraries.js:69](/D:/Work/Live/public/js/admin/danmaku-libraries.js:69)。

盲盒名称、成本、ID、产物格式校验只有 toast，用户需要回到表单寻找对应问题。词库的部分校验已经聚焦了缺失字段，应保留这项已有行为。

建议：字段附近显示可持续阅读的错误，提交时聚焦首个错误字段，并关联错误说明；toast 只承担整体提交结果。只呈现已有校验结果，不新增重复的业务规则或替代服务器校验。

验收：错误提示不会在用户修改前消失，能明确定位字段；键盘提交与鼠标提交得到一致反馈。

## 5. 样式、动画和可读性

### V01 · P2 · 长字符串溢出或被静默裁切

位置：[public/css/admin/toasts/system.css:19](/D:/Work/Live/public/css/admin/toasts/system.css:19)、[public/css/admin/toasts/ai.css:34](/D:/Work/Live/public/css/admin/toasts/ai.css:34)、[public/css/admin/toasts/gifts.css:97](/D:/Work/Live/public/css/admin/toasts/gifts.css:97)。

合成连续英文字符串后的实测如下；这是布局边界测试，不代表真实用户名称都允许相同长度。

| 样本 | 卡片宽度 | clientWidth / scrollWidth | 结果 |
| --- | --- | --- | --- |
| 普通长错误 | 360px | 359 / 848px | 白色文字伸出深色卡片，产生横向溢出 |
| AI 长响应 | 360px | 359 / 755px | overflow:hidden 直接截掉内容 |
| 长用户名 | 360px | 359 / 704px | 用户名被直接截掉，没有省略或详情提示 |

建议：正文支持必要的断词，网格文字子项可收缩；重要错误保留可阅读的摘要，较长详情通过页面查看。限制行数时使用清楚的省略表示，不能只靠 overflow:hidden 掩盖文字。

验收：连续错误码、模型名、URL、长中英文混排不突破卡片边界；关键结论与动作完整可见；需要的完整详情仍可找到。

### V02 · P3 · 宽度声明与实际效果冲突

位置：[public/css/admin/toasts/system.css:21](/D:/Work/Live/public/css/admin/toasts/system.css:21)、[public/css/admin/toasts/desktop-update.css:5](/D:/Work/Live/public/css/admin/toasts/desktop-update.css:5)、[public/css/admin/toasts/ai.css:5](/D:/Work/Live/public/css/admin/toasts/ai.css:5)。

业务类分别声明 380、390、400、410、420px 的宽度，但公共 `max-width:360px` 始终生效。所有被测富信息卡片实际均为 360px；普通短消息则按内容宽度展示。

建议：确定富信息卡片的有效宽度规格，再统一对应 width/max-width。可以采用共同的 360px，也可以为带动作或详情的通知保留较宽规格；不要保留表面不同、实际失效的声明。

验收：声明的宽度与 computed style 一致，长内容仍遵循 V01；不必把“已复制”等短消息强制放进大卡片。

### V03 · P2 · 入场、退场与堆叠移动缺少一致生命周期

位置：[public/js/shared/utils.js:193](/D:/Work/Live/public/js/shared/utils.js:193)、[public/js/admin/gifts/catalog-update-toast.js:123](/D:/Work/Live/public/js/admin/gifts/catalog-update-toast.js:123)、[public/js/admin/gifts/catalog-update-toast.js:147](/D:/Work/Live/public/js/admin/gifts/catalog-update-toast.js:147)。

- 普通卡片过渡 150ms，公共逻辑固定等待 180ms 再删除；直播卡片覆盖为 240ms，更新卡片 transform 为 220ms、opacity 为 180ms。
- 图片更新节点创建时已经带 `show`，没有建立入场前状态；结束时移除 `show` 后同一回调立即 remove，退出动画没有显示机会。隔离计时复现确认 2600ms 时节点直接消失。
- 插入和删除时只有当前卡片做 opacity/transform 过渡，其他卡片因正常布局重排而直接换位置。

建议：由统一生命周期管理入场、停留、离场和真正移除；使用共享时长或明确的动画完成机制，减少动态效果时也能正确结束；其他卡片平滑移动。建议以 180–220ms 入场、140–180ms 离场、6–8px 位移为调试起点。

验收：没有瞬间消失、遗留空位、移除后旧计时器误伤新卡片；连续插入时位置变化连贯。不能仅凭 CSS 时长差就断言每个通知肉眼可见地卡顿，例如更新卡片的 opacity 在 180ms 已完成；实际手感仍需 Electron 验收。

### V04 · P2 · 减少动态效果只覆盖了部分装饰

位置：[public/css/admin/toasts/system.css:41](/D:/Work/Live/public/css/admin/toasts/system.css:41)、[public/css/admin/toasts/live.css:40](/D:/Work/Live/public/css/admin/toasts/live.css:40)、[public/css/admin/toasts/live.css:102](/D:/Work/Live/public/css/admin/toasts/live.css:102)、[public/css/gift-audit.css:320](/D:/Work/Live/public/css/gift-audit.css:320)。

直播图标和呼吸光已有减少动态效果分支，但公共位移、更新卡片缩放以及对账 slideDown 没有对应处理。直播卡片还使用 `transition:all`。

建议：为通知基础层覆盖减少动态效果；装饰旋转、缩放和循环关闭，按需求保留极短淡入淡出；显式列出要过渡的属性。直播图标可以保留一次轻量入场，呼吸光是否常驻属于低优先级设计选择，不能误写成当前缺少任何关闭循环的适配。

验收：系统偏好为 reduce 时，所有通知类型都遵守统一规则且正常移除。该检查参考 [Web Interface Guidelines 的动效规则](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)，不是要求引入动画框架。

### V05 · P3 · 两个播放器图标中心位置偏移

位置：[public/css/admin/toasts/playback.css:266](/D:/Work/Live/public/css/admin/toasts/playback.css:266)、[public/css/admin/toasts/playback.css:290](/D:/Work/Live/public/css/admin/toasts/playback.css:290)、[public/css/admin/toasts/playback.css:368](/D:/Work/Live/public/css/admin/toasts/playback.css:368)。

- 接口异常底座：left=18、width=40，水平中心为 38px；警告字符中心定位在 30px，偏左 8px。
- Cookie 提示底座：left=16、width=36，水平中心为 34px；对勾中心定位在 28px，偏左 6px。

原始样式截图也能观察到偏移。建议图标与底座共享同一布局容器或明确中心坐标，再做必要的光学微调。

验收：两者不再贴近底座左侧，图标基线与周围状态图标协调，不牵连替换所有业务图标。

### V06 · P2 · 对账成功提示对比度不足

位置：[public/css/gift-audit.css:8](/D:/Work/Live/public/css/gift-audit.css:8)、[public/css/gift-audit.css:323](/D:/Work/Live/public/css/gift-audit.css:323)。

成功 toast 使用白字 `#ffffff` 配 `#4caf93`，按 sRGB 相对亮度公式计算约 **2.672:1**。字号为 0.82rem，在 16px 根字号下为 13.12px，属于普通文本；[W3C 最低文本对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 对普通文本的参考门槛为 4.5:1。

建议局部调整成功 toast 的文字颜色或背景深度，保留可识别的成功语义。不要为了一个 toast 改掉整个对账页共用的绿色变量。

验收：普通成功提示达到至少 4.5:1；颜色也不成为唯一状态信号。

### V07 · P3 · 基础视觉规格不够统一

位置：[public/css/admin/toasts/system.css:19](/D:/Work/Live/public/css/admin/toasts/system.css:19)、[public/css/admin/toasts/playback.css:1](/D:/Work/Live/public/css/admin/toasts/playback.css:1)、[public/css/admin/toasts/live.css:2](/D:/Work/Live/public/css/admin/toasts/live.css:2)、[public/css/admin/toasts/desktop-update.css:59](/D:/Work/Live/public/css/admin/toasts/desktop-update.css:59)。

目前圆角为 12/14/16px，多种图标底座尺寸和左侧留白并存；更新卡片浅色、标题 18px，其他富信息通知大多深色、标题 15px。阴影也各自定义，批量显示时视觉分量较重。

建议统一基础圆角、正文层级、图标区与内边距关系和阴影强度；是否为更新保留更强标题和浅色表面，应当是有明确用途的例外。保留礼物、大航海、盲盒的业务配色，不需要把所有卡片重新设计成同一主题。

验收：同一轻重级别的提示有一致的文字层级与节奏；成功、警告、礼物类型仍可分辨。这个条目是设计建议，不是运行错误或已测得的性能问题。

## 6. 文案与反馈内容

### C01 · P2 · 长结果应保留详情，toast 只承担摘要

位置：[public/js/admin/settings-auth.js:124](/D:/Work/Live/public/js/admin/settings-auth.js:124)、[public/js/admin/settings-auth.js:154](/D:/Work/Live/public/js/admin/settings-auth.js:154)、[public/js/admin/settings-operations.js:110](/D:/Work/Live/public/js/admin/settings-operations.js:110)、[public/js/admin/settings-blindbox.js:137](/D:/Work/Live/public/js/admin/settings-blindbox.js:137)。

账号登录提示把账号作用域、云端凭据、直播间启用条件合成整段文字，仍只停留 2.6 秒；清空全部数据一次列出七类统计；“已保存移除”也不够自然。

| 场景 | 建议的 toast 摘要 | 必须保留的信息 |
| --- | --- | --- |
| 直播账号本机登录完成 | “直播账号已在本机登录” | 在账号区域持续说明：只作用于当前 LIRA 账号，云端保存及直播间配置启用后的实际连接状态 |
| 直播账号退出 | “直播账号已在本机退出” | 云端退出是否已同步、同步成功后停止监听、不会回退为匿名采集的既有说明 |
| 歌曲本地保存 | “歌曲已保存到本地” | 网页结果以云端同步为准，不能改成“已同步” |
| 移除盲盒配置 | “盲盒移除已保存，等待服务器确认” | 保留尚待服务器确认的状态，不得提前声称远端已生效 |
| 全部数据清空完成 | “已清空共 N 条数据，配置已保留” | 在结果区域展示各类删除数量，依据服务器返回值，不在前端重新判断清空是否成功 |

验收：摘要短且准确，详细条件或统计有稳定阅读位置；缩短 toast 前先安排详情落点，不能直接删除云端生效条件。现有账号文案契约测试需随展示位置调整，而不是删除其语义保护。

### C02 · P2 · AI 测试详情需要可回看

位置：[public/js/admin/ai-assistant-settings.js:229](/D:/Work/Live/public/js/admin/ai-assistant-settings.js:229)、[public/js/admin/ai-assistant-settings.js:409](/D:/Work/Live/public/js/admin/ai-assistant-settings.js:409)。

成功 toast 包含模型名和实际回复，只有 3.6 秒；页面成功状态只写“连接正常”，并不保留该回复。较长回复还会触发 V01。失败信息已有页面状态反馈，应保留。

建议 toast 使用“DeepSeek 连接正常／测试未通过”以及简短下一步；最近一次测试的模型、回复和错误详情放在测试区域可查看。同一次测试状态变化原位更新，避免旧成功与新失败卡片并列。

验收：toast 消失后仍能找到测试依据，长回复不会把通知撑大或截掉关键错误；不修改服务调用、密钥处理或模型测试语义。

### C03 · P2 · 导入摘要应反映部分失败

位置：[public/js/admin/import.js:22](/D:/Work/Live/public/js/admin/import.js:22)、[public/js/admin/import.js:38](/D:/Work/Live/public/js/admin/import.js:38)、[public/js/admin/import.js:44](/D:/Work/Live/public/js/admin/import.js:44)。

页面详细结果已有新增、重复、失败计数，但 toast 恒为“Excel 导入完成”或“导入完成”。这句并不等于声称每行成功，然而当前绿色外观和缺少摘要区别容易让人漏看失败。

建议直接使用返回的 `inserted/duplicate/failed`：全部成功显示新增数量；部分失败使用警告并提示查看失败行；全部失败明确“本次未导入歌曲”；重复跳过单独说明。保留现有详细结果区域。

验收：全成功、部分失败、全失败、全部重复四类结果准确，统计依据不变。

### C04 · P3 · 减少对明显页面动作的重复说明

位置：[public/js/admin/onboarding.js:499](/D:/Work/Live/public/js/admin/onboarding.js:499)、[public/js/admin/songs.js:361](/D:/Work/Live/public/js/admin/songs.js:361)、[public/js/admin/games-wheel.js:190](/D:/Work/Live/public/js/admin/games-wheel.js:190)。

“已打开导入导出标签页”“已加载到编辑表单”“转盘开始转动”等场景，在对应内容已经明显变化时，可以使用目标区域的反馈，减少右上角提示。若动作发生在另一个不可见窗口或画面，仍可能需要 toast，不能机械删除。

保留用户难以直接确认的“复制成功”、异步保存结果、远端同步结果和失败提示；开关也不能因为外观已切换就省略保存失败反馈。

验收：减少打扰后用户仍能确认异步动作是否完成，没有静默失败。

### C05 · P3 · 使用指南中的位置描述需要纠正

位置：[public/pages/admin/toolbox/usage-guide.html:563](/D:/Work/Live/public/pages/admin/toolbox/usage-guide.html:563)。

指南写“右下角弹出桌面通知（Toast）”，实际共享容器位于右上侧 `top:70px; right:24px`，这些节点是应用内通知，不是系统通知中心的原生通知。

建议以最终采用的布局更新说明，使用“应用内礼物提示”等不易误解的名称；保留通知开关不影响礼物记录的既有含义。

验收：指南与实际位置一致，不暗示应用关闭后仍会收到系统通知。

## 7. 建议落地顺序与边界

1. **结果和动作准确性**：B01、B02、B03、B04、B05、B07、B08。先补对应回归，再调整产生通知的业务层；只改展示判断、身份和文案，不改认证或更新协议。
2. **公共通知生命周期**：B06、U01–U05、V01、V03、V04。先明确去重与更新的区别、计时和退出规则，再迁移具体调用。涉及共享计时、并发和资源归属，实施前应按仓库 PLANS.md 建立正式计划。
3. **具体页面反馈与辅助页**：B09、U06、C01–C03、V06。账号条件、AI 回复、导入明细先有稳定落点，再缩短 toast；对账页保持独立资源入口。
4. **视觉收敛和说明**：V02、V05、V07、C04、C05。复用现有字体、颜色和圆角 token；保留有意义的业务例外。

实现应继续使用原生 JavaScript ES modules 和 CSS。公共行为归共享工具或其直接拥有的通知模块；业务状态由各自模块决定；CSS 延续已有 system/ai/playback/live/desktop-update/gifts 的归属。无需新框架、运行时依赖、通知服务、数据库或持久化通知中心。

建议的行为基线：

| 情形 | 显示策略 | 消失策略 |
| --- | --- | --- |
| 复制、明确成功的手动保存 | 简短结果，避免重复卡片 | 约 2–3 秒 |
| 警告、失败、部分完成 | 有语义区分的摘要与可找到的下一步 | 约 5–8 秒；阅读时暂停；必要详情留在页面 |
| 需要点击的登录/更新提示 | 明确动作，绑定产生提示时的对象 | 充分操作时间，悬停和聚焦暂停，可关闭 |
| 正在处理的操作 | 同一节点更新；短操作可只在按钮显示忙碌状态 | 操作完成后再计时 |
| 高频礼物 | 按事件身份原位更新，受总可视空间约束 | 以既有 3.2 秒为起点，结合优先级和队列 |

这些数值和布局是后续设计起点，不是新增的已接受产品规范。

## 8. 实际验证记录

### 8.1 现有测试

执行以下命令，**38/38 通过**：

```powershell
node --experimental-vm-modules --test --test-reporter=spec test/admin-style-ownership.test.js test/frontend-admin-shell.test.js test/frontend-gift-catalog-update.test.js test/playback-provider-operations.test.js test/frontend-blindbox-admin.test.js test/gift-audit-page.test.js
```

这些测试覆盖样式归属、顶部栏间距、部分通知调用、礼物图片更新状态、对账页面解析等；通过不代表覆盖了全部通知生命周期或实际阅读体验。没有运行仓库全量测试，因为本轮没有改运行代码。

### 8.2 定向复现

审查脚本在系统临时目录运行，载入真实模块，模拟 DOM、时钟、平台桥和数据响应。以下是最终完成运行的 12 个逻辑场景；不是新加入仓库测试套件的测试。

| 场景 | 关键输入或时序 | 实际观测 | 对应项 |
| --- | --- | --- | --- |
| 盲盒名称 | 产物名与盲盒名不同 | 显示“开出测试盲盒”，没有实际产物名 | B01 |
| 更新阶段 | available → 提示过期 → 同版本 downloaded | 下载完成没有新通知 | B02 |
| 礼物数量变化 | 相同记录 ID：×1 → ×2 | 两张卡片同时存在 | U04 |
| 接口检查变化 | 通过 → 同 key 失败 | 状态为失败，toast 仍显示通过 | B03 |
| 登录对象变化 | QQ 提示 → 切网易云 → 点击旧提示 | 登录桥参数为 netease | B04 |
| 未完成登录 | 窗口关闭，认证 false | 成功造型“Cookie 已刷新” | B05 |
| 批量礼物淘汰 | 8 条 → 180ms → 重发仍显示的 key | 第 3 条变成两张卡片 | B06 |
| 设置保存失败 | 返回单个“测试网络故障”错误 | 原始错误与“保存失败：…”两张卡片 | B07 |
| 图片更新完成 | 结束 → 2600ms | 立即没有节点，未留退出过渡时间 | V03 |
| 操作提示聚焦 | activeElement 为 toast → 3180ms | 聚焦节点依然被移除 | U02 |
| 对账零解析 | 非空 HTML，解析 0 条 | toast 声称全部有记录 | B08 |
| 对账数据失败 | 有效气泡 1 条、空缓存、获取失败 | 仍提示“发现 1 条疑似漏记” | B08 |

### 8.3 渲染与计算

- 用当前原始基础 CSS 和六个 toast CSS 模块构建隔离样本，检查了普通消息、所有主要富信息样式和长内容边界；没有加载实际 Admin 页面或真实业务连接。
- 1280×720 Chromium 内容区域：6 条礼物和 3 条操作结果的最后一张卡片到达 744.6px；对账三条提示坐标完全相同。
- 长内容的 clientWidth/scrollWidth、富信息卡片 360px 实际宽度、两个图标的坐标差见 V01、V02、V05。
- 对账成功提示 `#ffffff` / `#4caf93` 对比度为 2.672:1。
- 截图用于观察现有样式，没有把隔离样例误当作真实 Electron 客户端截图。

### 8.4 后续实施的聚焦验收

- 公共层：重复 key 更新、旧计时器失效、批量淘汰、关闭幂等、悬停与聚焦暂停、reduce 模式、超量通知以及长文本。
- 业务层：盲盒字段、同版本更新阶段、接口检查状态反转、平台切换后的旧登录入口、取消登录、单次错误反馈。
- 内容层：本机与云端条件不丢失、AI 详情可回看、导入四类结果、对账数据不足不误报。
- Electron 实机：默认及最小窗口、连续礼物同时发生操作失败、用键盘点击和关闭通知、实际读屏、系统减少动态效果，以及真实动效手感。窗口参数源见 [src/electron/main.js:597](/D:/Work/Live/src/electron/main.js:597)。
- 修改后按涉及的契约运行聚焦测试及必要的架构检查，检查最终 diff 与 `git diff --check`；不以通过现有静态样式测试代替交互验证。

## 9. 已有合理行为与结论限定

- 顶部 `70px` 偏移已经避开应用栏，不需要为统一而随意改回贴顶。
- 普通文字使用 textContent，标题和礼物业务数据使用现有转义；本轮没有确认现有调用存在未转义注入，不应借机扩大为无依据的安全整改。
- 登录类 toast 已有键盘激活，图片更新已有状态角色，直播装饰已有部分 reduce 适配；报告要求补齐覆盖，不是宣称这些能力全部缺失。
- 图片更新保持单节点、首次初始化/目录检查/零下载静默，且清理订阅和结束计时器，这些行为应保留。对应事实记录在 [前端架构文档](/D:/Work/Live/docs/architecture/frontend/app.md:90)。
- 礼物五种外观可以继续承担识别作用；不必统一抹平成一种颜色，也不需要无差别更换字体和图标。
- 操作分组、时长建议、消息限量和视觉统一是设计建议，需要在后续实现中结合实际窗口验证；本报告没有把所有建议提升成已接受规范。
- B06 的确定结论限于公共显示层去重状态；V03 的确定结论包含图片更新直接移除，但不宣称所有过渡时长差都能被肉眼感知。
- 未发现新问题的普通保存、复制、音质切换、小游戏结果等文案，可通过公共层改进受益，不需要逐一重写所有调用方。

## 10. 文件归属索引

| 文件或文件组 | 本轮修改建议归属 |
| --- | --- |
| `public/js/shared/utils.js`、`public/pages/admin/document-end.html` | B03/B06/B07、U01–U05、V01/V03/V04 的公共行为与基础语义 |
| `public/css/admin/toasts/system.css` | 公共外观、类型、文字边界、空间和动效 |
| `public/js/desktop.js`、`public/css/admin/toasts/desktop-update.css` | B02、U02、V02/V03/V07 |
| `public/js/playback/operations/provider-operations.js`、`public/css/admin/toasts/playback.css` | B03–B05、U02、V01/V02/V05 |
| `public/js/playback/operations/playlist-operations.js` | U04 进度到结果的原位更新 |
| `public/js/admin/gifts/notification.js`、`public/css/admin/toasts/gifts.css` | B01、B06、U03/U04、V01/V07 |
| `public/js/admin/gifts/catalog-update-toast.js` | V03；保留已有单节点状态与清理契约 |
| `public/js/admin/ai-assistant-settings.js`、`public/css/admin/toasts/ai.css` | C02、U01/U04、V01/V02 |
| `public/js/admin/settings-operations.js`、`public/css/admin/toasts/live.css` | C01、V03/V04/V07 |
| `public/js/admin/settings-form.js`、`public/js/admin/settings-auth.js`、`public/js/admin/settings-blindbox.js` | B07、U06、C01 |
| `public/js/admin/danmaku-libraries.js` | U06；保留已有首个缺失字段聚焦行为 |
| `public/js/admin/import.js` | C03；沿用现有导入详情 |
| `public/js/admin/onboarding.js`、`public/js/admin/songs.js`、`public/js/admin/games-wheel.js` | C01/C04 的局部文案和反馈取舍 |
| `public/js/gift-audit/index.js`、`public/js/gift-audit/view.js`、`public/css/gift-audit.css` | B08/B09、U05、V04/V06 |
| `public/pages/admin/toolbox/usage-guide.html` | C05 |
| 其他关键词命中的入口、注入、保存/复制/播放调用方 | 已检查使用方式，主要由公共层改进覆盖，暂不要求逐文件重写 |

原始审查清单与证据保留供追溯；本轮实际修复和验证状态以 §0 为准，不能将隔离验证等同于完整实机验收。

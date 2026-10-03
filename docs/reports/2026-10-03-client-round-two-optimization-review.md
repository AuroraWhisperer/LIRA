# LIRA 客户端第二轮优化审查

日期：2026-10-03。按[第二轮优化审查提示词](2026-10-03-client-round-two-optimization-prompt.md)执行。性质为审查与建议，不是实施记录或已批准的重构计划。

实施补记（2026-10-03）：用户随后授权核验并修复。A1–A6 已按当前代码重新确认并处理，无消费者的 `refreshEnhancedSelect` 一并移除；123 项定向测试、仓库快速检查与隔离 Electron DOM 验证通过。详情见[修复与验证记录](../../specs/plans/archive/2026-10-03-client-round-two-fixes.md)。以下保留修复前的审查基线与测量，两项待测线索仍未作为确定缺陷处理。

本轮收敛出 **6 项主要发现**：1 项资源生命周期缺陷、3 项可减少运行工作的优化、1 项同职责复用、1 项已取消入口的遗留代码。另有 1 项低收益清理和 2 项待测线索。业务代码没有修改。

## 1. 基线与覆盖

- 仓库：`D:/Work/Live`；HEAD：`c86894bd`；Node：`v24.15.0`。
- 以当前工作区为准，开始时已有 44 个变更路径，含未跟踪的大航海感谢模块；这些内容全部保留。HEAD 本身不能复现未提交内容。
- 对 `src/`、`public/js/`、`public/css/`、`public/pages/`、`scripts/`、`test/` 内 1,490 个 JS/CJS/MJS/CSS/HTML 文件建立文本 SHA-256 基线；其中 642 个为 `src/` / `public/js/` 生产 JavaScript。
- 候选扫描包含连续 12 条归一化非空、非整行注释代码、名称/导入/入口文本引用。得到 9 对跨文件重复片段候选。窗口重叠，**不能据此计算重复率或累加重复行数**；文本检索也不能替代完整的语义引用分析。
- 未访问 LIRA Server 仓库、真实用户数据、Cookie、设备令牌或上游服务；未启动、重启用户应用。

| 范围 | 本轮人工深入检查 | 覆盖限制 |
| --- | --- | --- |
| Admin、共享前端 | 初始化、StateService/差异分发、动态下拉框、礼物面板/图片/盲盒、粉丝档案旧快捷链路；核对画布替换 inspector 的调用点 | 其他管理模块只做候选扫描；未逐函数审计全部 143 个 Admin 文件 |
| Playback、歌词 | 内容加载器的分页/缓存和过期结果边界；共享歌词内容签名及帧调度 | 未做音频设备、长时播放、歌词 FPS 测量 |
| Overlay | 已共享的主题/工具、队列滚动内部调用、gift-feed 的变更签名和可见性控制 | 未进行 OBS/直播姬浏览器源实测 |
| Electron | Cookie 转换复用、两个登录窗口的差异、两处 IPC 来源检查 | 其他同步控制器、更新器及主进程仅列入扫描，不宣称生命周期已全面验收 |
| 内嵌本地后端 | 排名身份提示转换/消费者、历史轮询差异、礼物推送到 renderer 的路径；存储重复候选的事务与迁移边界 | AI、其他音乐服务、领域算法和存储性能未逐项深入验证 |
| HTML/CSS、工程 | 粉丝快捷弹窗及样式、相关测试和运行副作用、旧报告建议是否已经落实 | 不做全站 CSS/资源清理、构建/安装器或跨仓契约验收 |

这是“全范围候选扫描 + 重点调用链复核”，不是 642 个文件逐行人工审完。

## 2. 主要发现与处理顺序

“优先、普通、后续”表示建议处理顺序；只有确认的功能/资源缺陷使用 P 级严重性。

| 编号 | 类型与证据 | 结论 | 收益 / 风险 |
| --- | --- | --- | --- |
| A1 | P2 缺陷；静态链路 + 隔离复现 | 动态下拉框移除后保留 document 监听和实例闭包 | 优先；控制长会话资源增长，涉及共享控件清理 |
| A2 | 运行开销；隔离复现 | 礼物子视图丢失字段级分发，诊断更新也重建两个列表 | 优先；减少无关 DOM 工作，必须保留通知和数据修正 |
| A3 | 运行开销；隔离复现 | 高价礼物图标在判断金额前先查完整目录 | 优先作为小改动；可直接前移纯条件，影响面较小 |
| A4 | 运行开销；隔离复现 | “我喜欢”每页 concat 重复复制前面所有歌曲 | 普通；减少长列表分配，不更改请求和分页规则 |
| A5 | 同职责重复；静态确认 | 在线榜与粉丝榜各维护一份相同的身份提示转换 | 普通；收敛维护点，不宣称性能改善 |
| A6 | 遗留代码；规格 + 当前引用链确认 | 已取消队列入口，快速档案弹窗链路仍残留 | 后续；减少失效分支，需保留正常档案编辑/展开 |

### A1：移除动态下拉框不会释放外部监听

**位置与调用链：** [select-menu.js](../../public/js/shared/select-menu.js#L292) `enhanceSelect()` 第 292 行为每个 select 添加匿名 `document.pointerdown` 监听，第 296 行还向所在 form 添加 reset 监听。第 299 行创建实例 observer；第 309 行 `installSelectObserver()` 只处理 addedNodes，没有移除处理或实例 dispose。

实际重复创建入口有两个：[fans/index.js](../../public/js/admin/fans/index.js#L276) `openForm()` 第 281 行替换 `fanEditorFields.innerHTML`；[component-preview-canvas-view.js](../../public/js/admin/component-preview-canvas-view.js#L170) `select()` 先销毁 inspector、替换子节点，再在第 198 行调用 `enhanceSelects()`。前者的 form 和 document 都比单次创建的 select 活得更久。

**证据：** 用真实 `select-menu.js` 和合成 DOM 创建、增强并移除 1 / 10 / 100 个 select，向 document observer 投递对应 removedNodes。document 上残留的 pointerdown 监听分别为 **1 / 10 / 100**，最终 body 子节点数为 0。该监听闭包持有 state、wrapper、select，WeakMap 不能消除 document 对闭包的强引用。form reset 也是需要处理的同类引用，但本次计数复现只测了 document 监听。

**最小建议：** 在共享 select owner 内统一管理外部监听与清理。可以把 document 监听收敛到单一活动菜单，也可以提供幂等实例销毁；无论采用哪种方式，都要处理持久 form 上的 reset 监听和实例 observer。调用方继续使用同一套增强控件。

**必须保持：** 动态 option 更新、程序设置 value/selectedIndex、form.reset、键盘选择、Escape/Tab、点击外部关闭及焦点回到触发器。DOM 包装和移动也会产生 removedNodes，不能把仍然 `isConnected` 的节点当成真正销毁；重复增强不能叠加控件或监听。

**验证：** 当前下拉框语义/溢出测试通过，但没有保护重复创建/销毁。实施时补充对应生命周期用例，并在 Electron 的粉丝表单和画布切换中确认交互。这里证明了监听留存，不提供实际堆内存增长量或卡顿结论。

### A2：已有 changedKeys，但礼物内部仍整体重建

**位置与调用链：** [state-renderer.js](../../public/js/admin/state-renderer.js#L33) 在 gifts、giftSprint、liveStatus、bilibiliDiagnostics、settings 任一变化时调用 renderGifts；[app.js](../../public/js/admin/app.js#L159) 只将 state 传给 [gifts/index.js](../../public/js/admin/gifts/index.js#L17) `renderGiftPanel()`。后者第 36、39 行每次都调用 `renderGiftRecentList()` 和 `renderBlindBoxList()`。

**实际成本：** 最近礼物在 [recent.js](../../public/js/admin/gifts/recent.js#L238) 重写 innerHTML，并重新检查图片与动画观察对象。盲盒在 [blindbox.js](../../public/js/admin/gifts/blindbox.js#L30) 重读配置、合并排序目录并重写 innerHTML；全部条目折叠时第 124 行还会再次写入提示文本与列表。

**证据：** 真实 StateRenderer、礼物面板函数与列表实现，合成固定礼物/盲盒数据，连续投递 20 次仅 `bilibiliDiagnostics` 改变的状态。得到 **最近礼物 20 次、盲盒 innerHTML 40 次写入**。40 次来自此次“其余盲盒全部折叠”的夹具；不代表所有场景固定两次。上层已有 JSON 差异比较，所以完全相同的快照不会触发；问题是其他字段确实变化时的过度分发。

**最小建议：** 延续现有差异分发，在礼物 owning renderer 内按依赖更新：诊断只更新诊断行、直播状态更新相应状态、最近礼物和图片版本改变才更新礼物列表，盲盒由配置/目录/在售范围/展开状态及映射状态驱动。优先给现有调用链传递必要变更信息或在子视图建立准确输入签名，不新增第二套状态服务。

**必须保持：** `notifyNewGift()` 的通知去重与合并更新；表单先于礼物渲染的顺序；图片目录更新；盲盒在售切换、映射状态、展开按钮和用户未保存配置。不能因为面板隐藏就直接跳过整个 renderGiftPanel，这会连带跳过礼物通知；不能只看记录 ID，礼物数量/金额修正也必须刷新。

**验证：** Admin 状态分发/乱序、盲盒映射与目录相关基线测试通过。实施后追加“只改诊断/直播状态不重建列表；改数量/目录/配置确实刷新”的定向断言，并核对通知。尚未测量 Electron 的耗时或帧率。

### A3：低价礼物无须先查询高价图标

**位置：** [recent.js](../../public/js/admin/gifts/recent.js#L341) `getHighValueGiftArtwork()` 先调用 `findGiftArtwork()`，随后才判断 `unit_price` 是否有限且达到 1,000 元。最近礼物渲染与 Toast 图片选择都会使用它。

**证据：** 旧记录缺少 variantId 时，`findGiftArtwork()` 第 25 行先将目录 Map 的 values 展开再 filter。真实模块载入 2,000 项合成目录，对 50 条单价 1 元、没有 variantId 的礼物调用该函数，**枚举了 100,000 个目录条目，50 次结果均为 null**。有 variantId 的记录走直接 Map 查询，不能把上述线性扫描成本套到所有礼物上。

**最小建议：** 把现有金额判定提前到 giftId 整理和 `findGiftArtwork()` 之前。不需要新增缓存或共享模块，也不需要改变目录格式。

**收益与约束：** 不展示高价图标的记录直接返回；保持单价判断（不能改成总价）、1,000 元边界、NaN/Infinity 处理、唯一身份匹配和图片兜底。此处目录查询只读，无须为无结果分支执行它。

**验证：** 现有 `gift-banner-feed` 用例保护了相邻的 variant/歧义与大航海图标规则，但没有覆盖此函数的早返回成本。实施时直接验证低价/无效价格不查目录，999.99、1000、缺图和身份歧义仍按原规则返回；不依赖大规模计时基准。

### A4：分页拼接反复复制历史前缀

**位置：** [playback/content/loader.js](../../public/js/playback/content/loader.js#L267) `ContentLoader._fetchLikedTracksAll()` 在每次请求后执行 `allTracks = allTracks.concat(tracks)`，连最终空页也会再复制一次。

**证据：** 复用现有“超过 50 页仍能完整载入”的输入规模，真实 loader 读取 5,100 首、每页 100 首和最终空页，共 52 次请求/concat。累计复制已有数组前缀 **132,600 项**，各 concat 输出数组累计 **137,700 项**。这是合成数据的逻辑复制量，不是实际内存字节数或网络耗时。

**最小建议：** 保留局部结果数组，按顺序将本页条目追加进去，例如逐项 push，消除逐页复制前缀；无需并发分页。按固定页大小，当前拼接随页数呈二次增长，追加可降为摊销线性累计工作。

**必须保持：** 平台选择、offset 前进规则、页签名去重、重复整页停止、错误处理及条目顺序。不能随便添加总页数上限，也不能删除 `seenPages`；它是防止上游重复页的保护。

**验证：** 现有 `frontend-playback.test.js` 的完整分页、重复页和过期搜索用例均通过。实施后重跑这些场景即可作为主要功能保护；本轮没有改数组实现。

### A5：两种排名维护相同的身份提示映射

**位置：** [online-rank-poller.js](../../src/bilibili/danmaku/online-rank-poller.js#L89) 第 89 行、[fans-medal-poller.js](../../src/bilibili/danmaku/fans-medal-poller.js#L127) 第 127 行 `toIdentityHint(userMeta)`。两者函数体文本完全相同，分别由第 65、103 行送入 `sink.ingestHint()`。

**实际重复：** 两种来源都经过 `extractBilibiliOnlineRankUserMeta()`，再转换 uid/name/avatarUrl、guardKnown/level、medalKnown/fansMedal。两份代码今后需要同时维护同一字段映射，当前没有证据表明结果错误。

**最小建议：** 在本地 `src/bilibili/danmaku/` 内建立一个有明确语义的纯转换函数，供这两个 poller 调用。用户信息服务的 evidence 模块承担归一化和证据权重，不能把原始排名 DTO 的组装反向塞进 facade；也不应加入通用 `src/shared/utils.js`。

**必须保持：** `currentRoomVerified === true` 的精确判断和缺灯牌时的 null。`source: online_rank/fans_rank`、上下文、扫描进度/退避/取消和在线名单替换仍归各 poller。`history-poller.js` 的 uid/name 来自另一种输入，不直接替换为同一完整映射。

**验证：** 两份现有 poller 测试通过，涵盖分页、证据提交、旧结果拒绝、停止后的计时器行为。未来只提取纯转换，保留这些测试并核对未知/已核实房间身份；不合并轮询器状态机。

### A6：取消入口后的快速档案分支仍在

**依据：** [粉丝档案规格](../../specs/fan-profiles.md#L34) 的 2026-09-19 要求明确取消点歌队列中的档案入口。当前 queue 实现与该要求相符。[frontend/app.md](../reference/frontend/app.md#L9) 仍描述 queue 传身份到快捷详情，属于需要与规格/实现对齐的陈旧说明。

**位置与引用核验：** [fans/index.js](../../public/js/admin/fans/index.js#L643) 的 `showQuickDetail()`、返回对象 `openQuick()` 和第 670 行 `openFanQuickProfile()` 仍在。全仓生产源码、页面、脚本与测试没有该导出的消费者；`initFanProfiles()` 的外部调用仅初始化，未读取其返回对象。唯一打开快捷弹窗的链路由此失去入口。

关联残留包括第 16/19 行取得并挂载 quick dialog、第 39 行 returnFocus、editProfile 的 showQuick 参数、quick 专属关闭/返回队列分支、轮询中的 quick.open，以及 [fan-profiles.html](../../public/pages/admin/toolbox/fan-profiles.html#L162) 的快捷 dialog。[fan-profiles-editor.css](../../public/css/admin/toolbox/fan-profiles-editor.css#L1) 和 [fan-profiles.css](../../public/css/admin/toolbox/fan-profiles.css#L33) 仍含快捷选择器。

**最小建议：** 按已取消入口的事实清理这条内部 UI 分支、专属 DOM 和 CSS 选择器，并修正上述陈旧文档。不要重新接回产品入口来“复用”它，也不能把正常档案页和快捷弹窗共用的 `expand` 动作、editor、detail 渲染或整个样式规则一并删除。部分逗号分组 CSS 仍服务正常编辑器，只能移除失效选择器。

**收益与风险：** 减少不可达 UI 与焦点/详情迁移分支，维护收益为主；不声称运行速度明显提高。无需改私有 IPC、`find` 领域动作或存储格式。

**验证：** 粉丝档案两个前端测试文件共 25 项通过，覆盖当前/归档切换、编辑失败、选择竞态、轮询和详情渲染。清理后需再跑这些用例和页面组合检查，确认正常编辑器、展开/收起、关闭及焦点正常；本轮没有做 Electron 操作验收。

## 3. 低收益与待验证项

| 项目 | 已知事实 | 本轮处理意见 |
| --- | --- | --- |
| `refreshEnhancedSelect()` | [select-menu.js](../../public/js/shared/select-menu.js#L331) 第 331 行导出只出现于定义；现有 option 更新走 observer | 可在 A1 同一 owner 工作时顺带核对并去掉这个未用入口，约 6 行；不值得单独建设清理工具或宣称提速 |
| StateService 快照序列化 | [state.js](../../public/js/admin/state.js#L192) 对各字段的新旧值 JSON.stringify，用来抑制无变化渲染 | 它有实际正确性/去重价值。先测真实快照大小、频率和序列化耗时，再判断是否缓存签名；HTTP/WS 混合更新和原地变化会影响失效规则，不列为确定缺陷 |
| 礼物 banner 目录查找 | [gift-banner.js](../../public/js/shared/gift-banner.js#L31) 每次 resolveGiftArtwork 线性过滤目录 | 有按目录版本建立索引的可能，但 gift-feed 已按行签名跳过无变化更新。先测新建/变化行的实际比例；recent 的旧图保留、允许格式和名称归一化与 banner 不完全相同，不能直接共用整份解析器 |

## 4. 已核实不应重复实施或不应机械合并

- **旧 Cookie 重复已经收敛。** `bilibili-auth.js` 与 `music-auth-manager.js` 均使用 `cookie-details.js`。两个登录窗口虽有相似收尾，但 B 站有 loginCloseRequested 与诊断等差异，不能顺手合并整个登录生命周期。
- **旧 overlay 主题/工具建议已有实现。** blindbox、queue-theme 使用 `applyOverlayTheme`；queue-utils 从 `overlay-utils-module.js` 取得工具。保留经典脚本适配职责；不再报告为“完全未复用”。
- **动态抽奖事务已经共享。** 两个 store 都用 `dynamic-lottery-transaction.js`。残留校验片段中 `requiredText` 默认上限分别是 128 / 512，不能因同形而互换；跨领域事务 owner 也不能机械合并。
- **Theme getter、Logger class、queue-scroll 内部导出不是整段死代码。** 它们由聚合属性、模块内部或实例化链消费；单文件名称命中不能证明可以删除实现。
- **CJS 与 ESM 的弹幕规则副本有运行时边界。** style-options 存在源函数及行为一致性测试；layout 的现有测试主要验证 Node 规则。双副本仍有维护成本，但本轮不为了去重新增构建步骤或跨仓模块分发，也不将两者一概称为已完整双端验收。
- **schema 与 migration 的重复不能按普通模板删除。** 一个服务当前初始化，一个保护已有数据库演进；历史迁移需要保持可重放。
- **两处 IPC 来源检查不是可以删掉的一侧校验。** 粉丝隐私数据和礼物导出分别守各自入口，已有 `hasExactOrigin` 可复用。为消除十余行重复引入新授权抽象，收益不足以优先于本轮局部优化。
- **已有保护继续保留。** 工具箱动态加载有初始化去重和失效结果检查；gift-feed 复用行节点并用签名控制更新；共享歌词有内容签名、30fps 门控和隐藏暂停。这些区域不应再新增平行实现。

## 5. 验证结果与复现边界

| 检查 | 实际结果 |
| --- | --- |
| 4 组隔离复现 | 全部确认当前行为：监听残留、无关列表重建、低价图标提前查询、分页 concat 复制量 |
| 10 个定向测试文件 | 58 项：57 通过、1 失败、0 跳过 |
| 粉丝档案 2 个前端测试文件 | 25 项全部通过 |
| 文档治理检查 | `npm run verify:docs`：9 项全部通过；另核对两份新文档的 25 个本地链接和行号范围 |
| 源码基线复核 | 1,490 个源码/测试/页面/样式文件与读取时的摘要一致；本轮仅新增两份文档并修改报告索引 |
| 最终差异检查 | `git diff --check` 通过；检查本次文档内容与 `git status --short`，原有改动保留 |

**已有失败：** [ui-surface.test.js](../../test/ui/ui-surface.test.js#L40) 的 Toast 标题断言要求 `font-size: var(--type-size-card-title)`，当前 [toasts/system.css](../../public/css/admin/toasts/system.css#L101) 为 `calc(var(--type-size-card-title) + 2px)`。该 CSS 在任务开始就有未提交改动；测试与样式均与本轮源码基线一致。这是当前工作区已有不一致，没有为了审查变绿改测试或回退样式，不能据此推断应撤回用户的字号调整。

首组实际命令：

```powershell
node --experimental-vm-modules --test --test-concurrency=4 test/admin/admin-state-renderer.test.js test/admin/admin-state-ordering.test.js test/admin/frontend-admin-runtime.test.js test/playback/frontend-playback.test.js test/gifts/frontend-blindbox-mapping-state.test.js test/gifts/gift-banner-feed.test.js test/bilibili/bilibili-user-info-pollers.test.js test/bilibili/bilibili-fans-medal-poller.test.js test/ui/ui-surface.test.js test/ui/frontend-select-menu-overflow.test.js
node --experimental-vm-modules --test --test-concurrency=2 test/fan-profiles/frontend-fan-profiles.test.js test/fan-profiles/frontend-fan-profiles-view.test.js
```

临时脚本及输出集中在 `tmp/client-round-two-2026-10-03/`：`scan.cjs` / `scan.json`、`unused.cjs` / `unused.json`、`probe.cjs` / `probe.json`、两份测试日志与源码摘要。运行复现：

```powershell
node --experimental-vm-modules tmp/client-round-two-2026-10-03/probe.cjs
```

复现使用真实函数，DOM/请求等外部边界为合成夹具：没有真实网络、没有读取真实用户数据库，也没有写入正常页面。本次结果不能换算成用户机器的 CPU、堆内存或 FPS；通过的既有测试也不等于尚未实施的优化已经安全。

## 6. 后续建议

如另行进入实施，先单独修 A1 并验证动态创建/释放；A3 可作为范围最小的一项优化；再处理 A2 的精确依赖分发和 A4 的数组追加。A5/A6 以维护收益为目标，分别保留身份语义及现有档案功能。每项改完再做直接相关验证，不将六项混成一次大重构。

本轮新增提示词、报告并更新报告索引；未修改运行代码、设置、公开协议或测试，没有提交、分支、构建或发布操作。

# 客户端职责归属与拆分粒度审查

日期：2026-11-10。范围：`D:\Work\Live` 当前工作区，HEAD 为 `4c31515e`，包含开始审查时已有的未提交改动。没有审查 `D:\Work\lira-server` 的实现。审查阶段只新增报告与索引；用户随后批准直接整改，实施状态与验证见本文末尾。

## 结论

保留 **4 项拆分或职责归位建议、3 项可合并或移除中间层的建议**。最值得先处理的是礼物图片目录归属和盲盒映射/统计的生命周期；合并项的收益较小，适合在相关功能改动时完成。以下是维护性判断，不表示这些位置已经发生功能故障，也不要求全仓库重构。

| 编号 | 当前位置 | 建议 | 顺序 |
| --- | --- | --- | --- |
| S1 | `admin/gifts/recent.js` | 将共用的礼物图片目录、索引和订阅从最近礼物视图移出 | 优先 |
| S2 | `admin/gifts/blindbox.js` | 拆开映射编辑与盈亏统计，各自保留完整请求和清理生命周期 | 优先；先明确 S1 的目录归属 |
| S3 | `admin/component-preview-canvas-view.js` | 将组件初始布局规则归回组件定义，提取完整图层条视图 | 随画布功能调整 |
| S4 | `server/api-context.js` | 将 AI 菜单同步判断、游戏观众合并归回应用拥有者 | 随对应领域调整 |
| M1 | `admin/gifts/sprint.js` + `sprint-overlay.js` | 合为同一个 Admin 月底冲刺面板模块 | 可顺手合并 |
| M2 | `admin/component-style-parameters.js` | 内部消费者直接引用已有 shared 实现，收回纯转导出壳 | 可顺手处理 |
| M3 | `bilibili/danmaku/realtime-state.js` | 可收回 `DanmakuClient.getRealtimeState()`，减少对整个 client 的穿透 | 可选、低收益 |

前端路径均相对于 `public/js/`，后端路径均相对于 `src/`。以下证据描述审查时的实现，不作为当前路径和职责的事实表；后续变更按 [PLANS.md](../../PLANS.md) 记录兼容约束与验收。

## 方法、覆盖与判断标准

依据[模块化规范](../architecture/engineering/modularity-standard.md)、[变更路由](../architecture/engineering/ai-workflow.md)和[现有债务记录](../architecture/engineering/modularity-debt.md)，检查实现、生产调用方、已有测试与兼容说明。

- 使用仓库已有依赖分析器扫描 `src/` 和 `public/js/`，得到 **1,057 个 JavaScript 模块、2,522 条静态本地依赖边**，未发现可识别的导入环。
- 深入复核了礼物 UI、画布预览、API 门面，以及授权、云同步、桌面入口、歌词渲染等较大模块和多个短模块。没有逐行穷举全部源码；CSS、HTML、原生代码、打包脚本和服务器实现不属于本轮深入审查范围。
- “唯一调用方”仅指产品 JavaScript 静态导入；对合并候选另查了测试、页面与维护文档引用。计算路径、HTML 入口和运行时回调不由静态图完整覆盖。
- 复核了 [11 月 9 日报告及整改状态](2026-11-09-module-granularity-review.md)，没有把已完成的歌词服务、播放队列、字体工具及两处包装清理重新列为待办。
- 大文件只用于筛选。判断拆分依据是独立变化原因、不同消费者或可独立拥有的生命周期；判断合并依据是能否减少跳转和内部状态穿透，同时保留协议、权限、事务及取消边界。

## S1：最近礼物视图还拥有其他界面依赖的图片目录

**证据：** [recent.js](../../public/js/admin/gifts/recent.js) 当前 385 行。

- 第 12–46 行维护目录索引及按身份查图，第 176–253 行负责目录请求、失败后的等待、快照合并、版本防回退和事件订阅。
- 第 113–174 行负责最近礼物网格、可见卡片与扫光计时，第 262 行开始生成最近礼物 DOM。
- [notification.js](../../public/js/admin/gifts/notification.js) 第 6 行为 `getGiftToastArtwork` 导入这个视图；[blindbox.js](../../public/js/admin/gifts/blindbox.js) 第 74、254 行通过它获取盲盒图标和加载图片目录。
- 第 383 行在模块求值时直接初始化目录。因此，其他界面为图片查询导入最近礼物视图，也会进入目录初始化路径。这是代码可见的依赖和初始化耦合，本轮没有将其推断为已发生性能故障。

**处理：** 在 Admin 礼物区域建立一个明确的图片目录拥有者，整体接管索引、请求合并、快照版本及订阅。最近礼物、通知和盲盒映射消费这一能力；最近礼物只保留卡片展示与其动画资源。初始化和销毁由 Admin 装配入口显式连接，不再依靠导入视图触发。

已有 [gift-image.js](../../public/js/shared/gift-image.js) 继续拥有图片来源和加载能力。另一个 [gift-banner.js](../../public/js/shared/gift-banner.js) 的目录 reader 使用条件版本、不同输入字段及占位语义，不能直接把两套 resolver 或缓存强行合成一个。先迁移这三个 Admin 消费者，不增加通用资源管理框架。

**保持与验收：** 目录更新不能被慢请求覆盖；复用 giftId、改价和 variant 身份不能串图；失败可重试，合法空目录仍缓存；初始化不得新增重复请求或订阅。已执行 `frontend-recent-gifts.test.js` 和 `gift-artwork-identity.test.js` 的相关覆盖；跨仓库图片契约用例受下文版本条件限制。实施时更新 [Admin 参考](../reference/frontend/app.md) 与 [页面模块说明](../reference/frontend/pages.md) 的归属，操作步骤不变。

## S2：盲盒映射与盈亏统计有两套独立生命周期

**证据：** [blindbox.js](../../public/js/admin/gifts/blindbox.js) 当前 512 行。

- 第 31–260 行负责高级映射编辑、官方奖池转换、在售目录与切房请求排序，状态包括 `officialBlindBoxes`、`saleRoomId`、`saleCatalogRevision`。
- 第 272–487 行负责盈亏统计的可见性、请求取消、dirty 状态、统计表、进入分析页及 observer 清理；数据请求是 `/api/gifts/blind-box-stats`。
- 第 503 行开始又独立安装目录/房间设置/登录变化监听。映射部分与统计部分的请求、状态和触发来源不同，只是在同一 IIFE 内。
- 两组消费者也不同：[settings.js](../../public/js/admin/settings.js) 使用映射编辑；[gifts/index.js](../../public/js/admin/gifts/index.js) 渲染礼物区域，统计部分还自行在 DOM 就绪时启动。

**处理：** 现有模块保留映射编辑与其房间请求；把统计完整迁到一个统计面板模块，包括可见性、请求、渲染和 dispose。不要再把每个统计请求、渲染函数与计时器拆成多层。两者通过明确初始化接线共享 S1 的图片目录能力。

**保持与验收：** 映射草稿不能被快照覆盖；切房后旧请求失效；统计隐藏时停止请求，重新显示恢复；分析页开关和键盘操作保持。已执行 `frontend-blindbox-mapping-state.test.js` 与 `frontend-blindbox-mapping-refresh.test.js`；实际拆分时还需验证统计面板的显示/隐藏、取消与卸载，不能用映射测试代替这部分。技术归属更新 [app.md](../reference/frontend/app.md)，用户界面不变则无需改指南。

## S3：画布视图混合组件布局规则与图层条实现

**证据：** [component-preview-canvas-view.js](../../public/js/admin/component-preview-canvas-view.js) 当前 504 行，主要逻辑集中在一个 mount 闭包。

- 第 236 行 `add()` 同时决定背景/浮动弹幕铺满、浏览器等比缩放、水平弹幕及 gift-swing 底部对齐、默认名称和 shared/independent 外观。修改某个组件的初始布局，需要改通用画布视图。
- 第 299–377 行 `renderLayers()` 负责图层条 DOM、菜单定位、锁定/隐藏/删除和菜单键盘操作。
- 同一个闭包还接线文档模型、撤销重做、参数面板、发布、恢复及保存状态。这些协调状态需要集中，但具体图层条 DOM 和组件布局策略不必都在其中。

**处理：** 优先把组件初始布局规则归到已有组件预览定义/组件能力，由画布消费计算结果。图层条及其菜单可作为一个完整视图提取，接受当前条目、选中项和操作回调。文档、选择、手势取消和历史操作继续由现有协调者及 [scene-document-model.js](../../public/js/admin/scene-document-model.js) 持有，不用一个宽 context 把闭包变量搬到多个文件。

**保持与验收：** 一次用户操作仍对应一次历史记录；锁定项不能误删/移动；增加组件的尺寸、对齐、外观归属不变；键盘和菜单焦点不回退。已执行 `scene-document-model.test.js`；布局策略和实际 DOM 尚未重新验收，实施时复用 `canvas-editing.test.js` 中新增、锁定、拖动、撤销等相关场景。更新 [app.md](../reference/frontend/app.md) 的模块归属；无新操作步骤。

## S4：API 门面仍包含两小段应用规则

**证据：** [api-context.js](../../src/server/api-context.js) 第 157–164 行不只是转发 AI 配置，还读取前后配置、判定 `isAiReady`、比较触发词，并决定云设置同步。第 270、275–289 行自行合并在线榜和最近发言观众，做 UID 去重、名字与时间选择及排序。

因此，AI 菜单规则和游戏候选规则变化都会修改通用 API 装配模块。`game-routes.test.js` 为验证观众合并，需要创建包含 songs、queue、superChats、gifts、overtime 等无关空能力的 API context，这是当前测试接线成本的具体表现。

**处理：** AI 的“配置成功后通知菜单变化”归回 AI 应用入口，通过窄回调连接现有 [cloud-sync-runtime.js](../../src/server/cloud-sync-runtime.js) 的菜单签名判断；游戏观众投影归回 [game-runtime.js](../../src/server/game-runtime.js) 所在应用能力。API context 保留原有公开形状和能力映射。无需把整份 context 再拆成每个字段一层 facade，也不要把云同步依赖放进 AI 领域服务。

**保持与验收：** 无关 AI 设置不能多触发上传；配置失败不能发送成功通知；同 UID 合并、无 UID 排除、最近时间排序及房间/账号失效规则不变。已执行 `game-routes.test.js`；AI 变更应复用 `test/cloud-sync/danmaku-menu.test.js` 和 `test/ai/ai-routes.test.js`，本轮未运行这两套。实现后同步 [server-core.md](../reference/backend/server-core.md)、[API 参考](../reference/backend/api.md) 中受影响的归属说明；HTTP 和用户指南无需因内部搬移改变。

## M1：Admin 月底冲刺面板可以合并

**证据：** [sprint.js](../../public/js/admin/gifts/sprint.js) 共 23 行，写入四个统计字段后立即调用 `sprint-overlay.js`（已合入 sprint.js） 的预览渲染；后者 26 行，还注册同页的复制地址、打开预览按钮。两者消费同一个 `giftSprint` 快照，没有各自的请求、状态机或取消生命周期。

**处理：** 合入现有 `sprint.js`，保留面板初始化和快照渲染两个清晰入口，让 `gift-assistant.js` 与 `gifts/index.js` 使用同一拥有者。名字里的 overlay 在此指 Admin 页面上的预览与来源入口；真正的 [overlays/gift-sprint.js](../../public/js/overlays/gift-sprint.js) 有独立浏览器源生命周期，继续独立，公共文字渲染也继续复用。

**取舍：** 这是减少一次无边界收益的跳转，收益小，没有必要单独发起大重构。实施时复用 `test/admin/canvas-gift-components.test.js` 的冲刺预览与复制入口场景，保持按钮监听只注册一次；更新 [pages.md](../reference/frontend/pages.md) 的文件说明即可。本轮没有运行该浏览器套件。

## M2：样式参数转导出没有增加能力

**证据：** `admin/component-style-parameters.js`（内部转导出已移除） 全部 3 行，只从 [shared/component-style-parameter-view.js](../../public/js/shared/component-style-parameter-view.js) 导入并原样导出 `mountStyleParameters`。两个生产消费者是 `browser-source-preview.js` 和 `clock-preview.js`。该层没有策略、校验、状态或生命周期；检查的维护文档中未找到必须经此层调用的约束。

**处理：** 两个消费者直接导入已有 shared 实现，移除不再需要的内部中转。若另有已发布模块 URL 的兼容使用，保留有明确退出条件的旧入口，而非直接断开兼容。不要为了去掉一层转导出再增加一个新入口。

**验收与同步：** `component-preview-registry.test.js` 当前对旧路径设置了 mock，迁移时应调整真实拥有者的装配。本轮该套件通过；无需为三行转导出单独造一个测试。没有字段、操作或公开页面 URL 变化时，技术合同和用户指南无需编辑。

## M3：realtime-state 可收回 client 方法，但优先级最低

**证据：** `danmaku/realtime-state.js`（已收回 client） 共 22 行，唯一生产调用方是 [DanmakuClient.getRealtimeState()](../../src/bilibili/danmaku-client.js)。第 559–560 行仅 `return getRealtimeState(this)`。辅助模块读取整个 client 的 socket、鉴权 trace、API UID、房间/主播身份和三项连接代次字段，没有独立输入契约或资源。

**处理：** 可以将计算收回已有 client 方法，使内部字段读取留在其拥有者内。保留 `getRealtimeState()` 的公开返回结构和调用方式；不改变 server runtime 层对就绪状态的再约束。也可以暂时保留现状，此项维护收益有限，不应为了少一个文件冒重连行为风险。

**保持与验收：** socket 打开不等于 B 站鉴权成功，历史轮询 connected 不能充当实时就绪；room/account/connectionKey 语义保持。当前 `test/danmaku/danmaku-client.test.js` 已直接通过 client 方法覆盖这项行为，本轮已运行。实施时更新 [弹幕参考](../reference/backend/bilibili/danmaku.md) 中的判定 owner，无需新增仅检查转发的方法测试。

## 应保留的边界

| 位置 | 保留理由 |
| --- | --- |
| `src/electron/main.js`、`src/server.js` | 主要是显式装配、初始化失败清理与启停顺序。把步骤搬成接受整个 context 的函数，并不能减少职责耦合。 |
| `license-manager.js`、`remote-gift-controller.js` | 授权/来源代次、串行操作、取消、续期和重试需要一个状态拥有者；已有协议、history、恢复规则模块承担独立部分。 |
| 三类 `cloud-*-sync-controller.js` | 设置冲突、歌单 outbox 和 B 站凭证生命周期不同，不能因方法名字相似统一成万能同步器。 |
| `desktop-lyric-renderer.js`、`danmaku-feed.js` | 已有样式、时间计算、渲染等分工；播放时钟、当前词、队列和清理仍需一致，不按行数继续切碎。 |
| 短 IPC、route、store、consumer 模块 | 即使只有二十行，也可能隔离鉴权、传输、事务或跨领域能力；单一调用方不足以证明过度拆分。 |
| `scene-source.js`、`scene-output-events.js` | 分别固定来源协议参数、通知错误合同，独立边界有实际价值。 |
| `admin/local-font-library.js` | 虽然只是转导出，但参考文档和测试明确保留旧模块入口的兼容性；不能按 M2 一起删除。 |
| 城市目录、样式声明、历史迁移注册 | 数据量、完整迁移顺序及单款样式的独立变化原因不同于业务代码复杂度。 |

`shared/utils.js` 的剩余主题聚合、`scene-runtime.js` 中的房主资料补充缓存、`ws.js` 中传输与快照策略的组合可在对应行为变化时继续评估。本轮不将这些位置列为必须拆分：进一步拆分的收益尚不足以抵消新增接线或状态分散成本。

## 验证与限制

| 实际执行 | 结果 |
| --- | --- |
| 仓库现有依赖图分析器 | 1,057 模块、2,522 本地依赖边，无可识别导入环 |
| `npm run verify:architecture` | 29/29 通过 |
| 下列九文件聚焦运行 | 69 个用例通过；一个契约测试文件在加载夹具时失败，尚未执行其断言 |
| `npm run verify:docs` | 首次 10/10；最终 9/10，另一并行任务新增计划的状态标题未被校验器识别，见下文 |
| 报告链接与候选源码核对 | 33 个相对链接全部有效；9 个候选源码文件与复核后记录的哈希一致 |
| `git diff --check` | 通过；已检查报告新增内容、索引差异与工作区状态 |

聚焦命令：

```powershell
node --experimental-vm-modules --test test/gifts/frontend-recent-gifts.test.js test/gifts/frontend-recent-gifts-contract.test.js test/gifts/gift-artwork-identity.test.js test/gifts/frontend-blindbox-mapping-state.test.js test/gifts/frontend-blindbox-mapping-refresh.test.js test/admin/scene-document-model.test.js test/admin/component-preview-registry.test.js test/games/game-routes.test.js test/danmaku/danmaku-client.test.js
```

契约限制：`frontend-recent-gifts-contract.test.js` 通过 `readServerFixture()` 要求服务器版本 `67119e81a3f5f49470ed2b191f6552556d0a704e`，默认使用的 `D:\Work\lira-server` HEAD 为 `57caa12706103ca3770cf7b49a5c6c8bb805ad12`，报 `SERVER_CONTRACT_REVISION_MISMATCH`。本轮没有修改锁文件、切换服务器版本或跳过断言来获得通过，不能把该结果描述为图片契约验证通过。

文档限制：首次文档校验全部通过。最后核对期间，另一任务新增了 `specs/plans/2026-11-10-audit-correctness-fixes.md`，其 `状态：In Progress` 标题未被现有校验器识别，导致活动计划状态检查失败，其余 9 项通过。本轮没有改写该任务的计划；此报告及索引的链接有效。这些结果是运行时工作区快照，不能将首次通过替代最后一次结果。

没有运行全量套件、Electron 或浏览器 UI 验收，也没有测试尚未实施的重构。依赖图、候选源码哈希和日志保存在仓库 `tmp/responsibility-audit-2026-11-10/`，均为本轮审查辅助材料。

测试源码、现行技术合同和用户指南保持原状，因为本轮产品行为、接口和操作步骤未变；每项建议已列出未来实施时需要同步的拥有者与保护。此次交付只新增本报告及报告索引条目，不把建议写成已实施事实。

## 后续实施（2026-11-10）

用户批准的七项整改已在当前工作区实现；职责、兼容约束及最终验证记录在[已完成的实施计划](../../specs/plans/archive/2026-11-10-module-responsibility-refactor.md)。126 项聚焦和 21 项浏览器测试通过，含此前受版本限制的图片契约；架构 29/29、文档 10/10 和 JavaScript 语法检查通过。上面的行号、调用关系和验证限制保留为审查时证据；现行拥有者以同步后的 reference 为准。

## 追加复核：场景资料读取生命周期

用户要求继续核实并直接处理后，对原可选候选、API 装配、预览工厂及短模块的调用关系做了定向复核。新增确认一项：`scene-runtime.js` 内嵌的房主资料缓存没有被 runtime 的 `dispose()` 清理。现有场景夹具复现了销毁后仍启动一次排队读取，以及在途结果仍调用已销毁通知能力的问题。

缓存、去重、公共字段投影与清理现归 [scene-room-profile.js](../../src/server/scene-room-profile.js) 持有，组合根只装配。底层读取没有取消接口，已开始的请求允许结束但结果失效；未开始的调用被阻止。40 项聚焦、29 项架构及相关语法检查通过；文档 9/10，唯一失败来自另一活动计划的状态标签格式。范围与验证见[追加实施记录](../../specs/plans/archive/2026-11-10-scene-room-profile-ownership.md)。

本次未确认新的合并项：短模块中的预览会话、设置同步/确认、保存反馈、画布轮询和主题卡片分别有独立状态、边界或实际共用消费者；加班机预览工厂还隔离桌面装配与浏览器预览。`ws.js` 的连接/帧处理与现有 projection 边界、`shared/utils.js` 的剩余兼容入口保持原状。以上为已检查范围，不表示逐行审查了全仓库。

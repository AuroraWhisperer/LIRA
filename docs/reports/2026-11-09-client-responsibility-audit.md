# 客户端职责与模块拆分三轮审计

日期：2026-11-09。范围：`D:\Work\Live` 当前工作树。审计基于 HEAD `af8744657f1b23e90caa815078cfbaa31114d4eb` 及开始时已有的 266 项未提交状态，不能仅用该提交重现本次工作树。

实施跟进（同日）：用户随后要求直接修复，两项建议已完成职责归位、相关回归与独立复核，详见[实施与验证记录](../../specs/plans/archive/2026-11-09-client-module-split.md)。下文保留实施前的审计结论与证据。

## 结论

只保留 **2 项“十分建议”**：通用表单中的播放器工作区，以及公共弹幕 feed 中的样式私有判定。两项都存在可以沿真实消费者证明的职责耦合，且可通过有限的职责归位改善；不是因文件长度或追求抽象数量提出。

这两项是结构整改优先级，不代表已经证实线上故障。本轮只审计和记录，未实施业务拆分。特别是，通用表单导入播放模块不会在加载时开启音频，不能把静态依赖描述成已有性能或权限故障。

不建议继续机械拆分 Electron 启停、授权/礼物同步、AI 回复协调、WeSing 捕获、场景发布、加班结算和原生音频会话。这些范围中最关键的状态、取消、事务和清理已有明确拥有者，进一步分散存在反向增加风险的可能。

## 判定方法与覆盖

采用三个并行子代理加主代理，先按领域排查，再从调用方、失败路径和测试隔离反查，最后交换领域及对候选做反方复核。历史报告只作定位线索，以当前代码重新判断。

保留建议必须同时满足：有独立变化原因；有当前消费者或私有规则泄露的具体证据；存在能减少依赖的窄边界；提取不会拆散状态、事务或取消的所有权。单纯文件长、函数多、分支多、可以单测、可以新增文件均不充分。

静态清单覆盖 `src/` 与 `public/js/` 的 **1,044 个 JS 模块、2,498 条可识别导入边**，另审阅 14 个原生 C# 文件的职责分布及工程入口。现有规模扫描覆盖 2,306 个源/样式/页面/测试等文件，产生 17 个提示；它们不是 17 个缺陷。数据目录、生成式样式配置和迁移注册表均按用途复核。审计并非对所有文件逐行穷举，静态导入图也不覆盖任意计算路径或运行时回调。

| 方向 | 覆盖的主要拥有者与调用链 | 结果 |
| --- | --- | --- |
| Electron，102 个 JS | main/lifecycle/window、preload/IPC、授权、远端礼物、云同步、粉丝控制器、场景事件、音频桥 | 未保留新拆分项 |
| 后端业务，195 个 JS | AI、Bilibili/礼物、音乐/Provider/WeSing、粉丝、游戏、加班 | 未保留新拆分项 |
| Admin，236 个 JS | app/forms/settings/state、画布/组件预览、歌库/队列、粉丝、礼物、歌词、互动/加班/工具箱 | 保留 A |
| 其余前端，289 个 JS | playback、lyrics、overlays、shared、desktop/license、gift-audit | 保留 B |
| 本地应用与基础层，222 个 JS | server/HTTP/WS、settings、场景、素材包、storage/事务/迁移、fonts/resources/shared | 未保留新拆分项；重点模块经换领域复核 |
| 原生与工程入口 | 音频协议/会话/设备/DSP/恢复；发布验证、安装器分工、测试编排与资源导出 | 未保留新拆分项；未执行设备或发布操作 |

工作树摘要、文件清单、导入图、规模报告和主代理测试日志保存在仓库根 `tmp/client-responsibility-audit-2026-11-09/`。

## A：将播放器工作区从通用 FormsService 完整提取

**建议等级：十分建议。优先顺序：第一项。**

### 已确认的职责耦合

[forms.js](../../public/js/admin/forms.js) 第 84–233 行管理播放器 dock 偏好、全屏开关、焦点约束、Escape/Space 快捷键、输出设备准备，以及队列/音量浮层联动。第 23–78 行及第 238 行以后承担表单绑定、tab 和设置回填。

工作区只由 [app.js](../../public/js/admin/app.js) 第 168 行初始化，第 303 行将关闭回调交给播放器；回调最后用于 WeSing 切换。与之不同，`desktop-lyric.js` 使用 range 绑定，`theme.js` 使用参数换算，`state-renderer.js` 使用回填，`settings.js` 使用设置相关辅助方法。这些表单消费者都因导入 FormsService 而静态依赖 `playback/features/output-device.js → native-output.js`。

播放器交互/焦点/设备准备与表单换算/回填具有独立变化原因。现有服务将二者放进同一个对象与依赖图，通用表单不能脱离播放实现被加载和理解。已有表单测试递归加载播放模块，但没有证据表明它们因此必须模拟真实音频；本建议不以夸大的测试成本为依据。

### 最小边界

将上述工作区方法整体提取到一个 Admin 播放器工作区拥有者，由现有 `app.js` 装配并传递关闭回调。`getCloseQueuePopup`、`releaseFullscreenFocus`、dock 偏好和开关顺序随之迁移。FormsService 保留表单职责，删除只为工作区服务的 imports；不添加永久透传壳或泛化 UI 管理器。

现有 [playback/ui/fullscreen.js](../../public/js/playback/ui/fullscreen.js) 的 `FullscreenPlayer` 负责歌曲、封面、歌词和外观绘制。直接把工作区控制塞入该类会再次混合职责，不推荐。

### 防回归边界

- 保持本机 dock 偏好键、默认收起状态和初始化顺序。
- 全屏开关的 `inert`、ARIA、焦点恢复及队列/确认浮层的可交互范围保持原语义。
- 播放器尚未初始化时的关闭队列 fallback、收起时关闭音量面板、WeSing 切换关闭全屏仍由同一工作区拥有者完成。
- 保持 Space 准备输出、等待后核对音源、播放失败反馈的现有顺序。它和 `playback-controls.js` 的 toggle 分支语义不同，首批不要顺带合并。
- 只在原装配位置初始化一次，确认提取没有重复事件绑定。

已有基线：`frontend-admin-runtime`、`frontend-admin-startup`、`desktop-lyric-settings`、`frontend-queue`，本轮 14/14 通过。实施后重跑这些保留行为，并进行一次针对实际工作区开关、焦点释放、Space 输出准备及 WeSing 回调的聚焦验证。当前基线不构成尚未实施的拆分验收。

## B：把弹幕样式私有判定归回样式拥有者

**建议等级：十分建议。优先顺序：第二项。**

### 已确认的职责耦合

[danmaku-feed.js](../../public/js/overlays/danmaku-feed.js) 的公共消息队列、布局和生命周期中还包含三组样式私有知识：

| 位置 | 当前私有规则 | 维护影响 |
| --- | --- | --- |
| 第 182、528 行 | `append` 和快照选择分别判断 `harbor`，再调用已有 `isHarborGiftVisible` | 同一资格规则的接线有两个入口，变更时必须保持一致 |
| 第 343–365 行 | 识别 `prismatic/snowfox` 的 SC/舰长卡，决定先缩小字号重排 | 某款卡片的适配策略变化必须编辑所有样式共用的测量函数 |
| 第 486 行 | 随机布局直接读取 `stardustAnchor` 私有 DOM 属性 | 公共定位拥有者知道某一个 renderer 的私有输出协议 |

[动效职责约定](../reference/frontend/danmaku-motion.md) 第 9 行明确区分样式视觉决策和公共位置计算/执行，直接支持固定 feed 中适配策略的归位。Stardust 随机布局的依据是私有协议耦合，不把仅针对固定/有序 feed 的文字扩大为所有全屏规则。

这不是所有新样式都必须修改 feed 的结论。当前渲染选择层和数据化样式能力已经支持许多独立变化；本建议只收回上述已存在的例外。

反方复核还确认：[danmaku-renderer-core.js](../../public/js/overlays/danmaku-renderer-core.js) 第 68–72 行已经拥有同一组 `prismatic/snowfox` 舰长卡分类，feed 又独立识别一次。将适配能力附着在已有渲染选择上，能减少这类规则分叉。Harbor 的金额算法本来就只有一份，问题是两个入口中的样式选择，不将其描述为算法重复。

### 最小边界

由现有样式/渲染选择层决定消息资格、内容适配能力和位置锚点，feed 在原同步位置读取窄能力或调用纯谓词。Harbor 已有规则函数，应复用它，使 `append` 和快照选择使用同一已选资格判断。

公共 feed 继续拥有 `renderedEntries`、ResizeObserver、实际测量、字号二分搜索、zoom、随机坐标、同批布局、动画打断、计时、淘汰及 destroy。只把“何时采用此行为”的样式选择移走，不能把测量/布局整个下放到样式。

不复制 feed、不建立插件系统、不更改 `createDanmakuMessageRenderer` 返回节点的现有合同。也不把完整风格表或宽可变 context 塞回 feed 作为改名后的耦合。

本评级仅适用于上述有限归位。如果实施方案必须新增注册框架、大改 renderer 返回合同或迁移 feed 生命周期，应收缩方案并重新判断收益，不能借此建议扩大重构。

### 防回归边界

- 快照与增量追加使用相同资格判定，继续保留 SC、礼物阈值及排列顺序；过滤仍在 DOM 创建和容量裁剪之前发生。
- 样式能力必须同步得到，布局仍按当前“重排/测量 → 缩放 → 定位”时序执行；不得增加网络请求、订阅或异步排版。
- 长 SC/舰长卡、随机锚点、安全边距、缩放与越界淘汰保持原结果。
- 密集到达时的动画续接、文字稳定、过期删除和销毁清理留在单一 feed 拥有者。

已有 `danmaku-overlay-renderer.test.js` 覆盖随机 SC、Harbor 快照/增量过滤及删除不重建；本轮在渲染方向 63 项基线内执行通过。真正实施时须重跑相关 Node/VM 场景及既有 `danmaku-feed-motion.test.js`、`danmaku-overlay-fullscreen.test.js` 浏览器场景，观察实际播放中的密集追加、长卡重排和销毁。本轮未改变视觉行为，没有启动浏览器证明一个尚未实施的修改。

## 已反证并排除的主要候选

| 候选 | 当前证据与保留理由 |
| --- | --- |
| `main.js`、`server.js`、domain/API 装配 | 窗口、退出、协议、领域服务均已有 owner；剩余是显式接线、部分初始化失败清理和释放顺序。导入多不等于职责违规 |
| license manager、remote gift、fan profile controller | 协议、history、retention、数据规则已有模块；token/账号代次、cursor fence、串行提交、abort/drain 需要统一 owner |
| scene-cloud-controller 的 DTO 校验 | 可独立提取，但目前只有一个 ingress，校验不捕获连接状态；未发现重复权威或足够隔离收益，未列优先项 |
| AI、WeSing、Bilibili user-info、游戏、加班 | 生成/协议/规则/缓存/画布/结算已分别归属；队列提交、播放证据、消息融合、回合时钟与恢复仍需同一状态 owner |
| Admin state、画布 controller/view、fans/index | HTTP/WS 顺序、发布事务、账号代次或选中项生命周期是实际协调职责；已有 request/publication/model/view/transfer 等分工 |
| 其他播放器、歌词 renderer、场景 source | 现有请求代次、时间轴、逐字动画、staging/commit/revoke 和 cleanup 共同形成完整生命周期，未发现值得优先新增的状态边界 |
| scene-shared-appearance、scene-components | 统一受限外观适配和显示投影；明确拒绝夺取桌面草稿权威，并复用各类型验证。拆成各组件自行写入反而容易产生第二写入方 |
| component-style-library、component-library-transfer | 媒体、install、archive、manifest/身份映射及 storage 已分出；剩余围绕同一 pending/账号/文件完整性/提交边界。标准素材包与备份包契约不同，不合并 ZIP 流程 |
| settings-service | 完整校验 → prepare → 提交 → apply → 通知，是一个应用操作的顺序；不因涉及多个领域而拆散 |
| storage 迁移、清库、scene store | 迁移注册不是业务杂糅；多库清理的提交/回滚结果及发布事务有专属协调拥有者。保留同步事务与部分失败语义 |
| resource-library 与 font-library | 生产中 font library 已委托同一个 resource library 初始化/状态/订阅，旧字体路径承担兼容读取；不存在据此应拆的新双下载权威 |
| AudioSession、Program、PlaybackOutputContext | 设备/DSP/采集/恢复已分层，Start/Stop/Tick 与同一会话取消/释放相互约束。不同管道协议不因相似循环合并；独立 class 不必只为文件数搬家 |
| 发布与工程编排 | 验证和脱敏已有专属模块；digest、缺件与重试保护同一已验证产物。拆成共享可变发布 context 的步骤无明确收益 |
| 城市目录、样式 schema、静态 HTML/CSS | 数据量或完整视图不是拆分依据；本轮未发现需升级为高优整改的可执行职责混杂 |

## 实际验证与适用限制

以下是本轮真实执行的现有基线，文件间没有重复运行。测试通过支持现有边界和行为判断，不证明职责单一，也不证明未来重构无回归。

| 验证批次 | 命令/测试文件 | 结果 |
| --- | --- | --- |
| 静态边界 | `npm run verify:architecture` | 29/29 |
| Electron | `node --test`：scene-cloud-controller、remote-gift-controller、license-manager-renewal、fan-profiles-ipc、electron-shutdown | 144/144 |
| 后端业务 | `node --test`：ai-assistant-lifecycle、bilibili-user-info-service、netease-provider、fan-profiles-domain、games、overtime-service、wesing-lifecycle | 130/130 |
| Admin | `node --experimental-vm-modules --test`：frontend-admin-runtime、frontend-admin-startup、desktop-lyric-settings、frontend-queue | 14/14 |
| 渲染 | 同上 VM 参数：desktop-lyric-renderer、playback-home-lifecycle、output-device、danmaku-overlay-renderer | 63/63 |
| 本地应用与存储 | `node --test`：database-maintenance、data-clear-all-recovery、scene-service、cdn-resource-library | 86/86 |

合计 **466 项通过**。未新增测试，未运行完整产品套件、真实账号/上游、用户 Electron 实例、浏览器实播、声卡或安装发布验收。已核对测试使用合成输入或隔离缓存/数据库；本轮没有业务修改，以上测试不是拆分完成的声明。

技术参考及用户指南保持当前实现描述：尚未发生接口、模块拥有者、页面、设置或操作步骤的实际变化。新增本报告和[审计计划记录](../../specs/plans/archive/2026-11-09-client-responsibility-audit.md)。

文档门禁 `npm run verify:docs` 为 **9/10**。唯一失败是 `docs/reports/2026-11-05-continuous-audit.md` 中指向历史 `tmp/continuous-audit-2026-11-05/` 材料的链接缺失；该旧报告哈希与审计开始时一致。本任务文档的文件链接另外核对通过；保留全局失败结果，未修改门禁、旧报告或伪造缺失材料。

最终工作树摘要对比及 diff 复核确认，本次增量仅为本报告、归档计划和两个索引；产品源码、测试、运行配置及原 staging 未变。`git diff --check` 已执行通过。没有把 266 项既有工作树状态当作本次产出。

原样测试命令如下，执行均在仓库根目录；未执行的实施后浏览器验收不在此列：

```powershell
npm run verify:architecture
node --test test/scenes/scene-cloud-controller.test.js test/gifts/remote-gift-controller.test.js test/license/license-manager-renewal.test.js test/fan-profiles/fan-profiles-ipc.test.js test/desktop/electron-shutdown.test.js
node --test test/ai/ai-assistant-lifecycle.test.js test/bilibili/bilibili-user-info-service.test.js test/music/netease-provider.test.js test/fan-profiles/fan-profiles-domain.test.js test/games/games.test.js test/overtime/overtime-service.test.js test/wesing/wesing-lifecycle.test.js
node --experimental-vm-modules --test test/admin/frontend-admin-runtime.test.js test/admin/frontend-admin-startup.test.js test/lyrics/desktop-lyric-settings.test.js test/songs/frontend-queue.test.js
node --experimental-vm-modules --test test/lyrics/desktop-lyric-renderer.test.js test/playback/playback-home-lifecycle.test.js test/playback/output-device.test.js test/danmaku/danmaku-overlay-renderer.test.js
node --test test/storage/database-maintenance.test.js test/storage/data-clear-all-recovery.test.js test/scenes/scene-service.test.js test/desktop/cdn-resource-library.test.js
```

## 实施顺序与停止条件

先单独完成 A，并验证工作区行为及表单依赖已分离；再独立完成 B，并验证快照/增量、真实布局和销毁。两项都应保留现有公开合同，不夹带播放逻辑合并、样式视觉调整或新功能。每项实施后同步对应 frontend reference；用户步骤未改变时不改指南。

不将其余排除项自动升级为后续重构列表。只有新需求、真实故障、重复规则或新的独立状态拥有者出现时再复核。持续审计的收敛条件是主要领域有覆盖、候选经过反证、最小边界和验证缺口明确，而不是不断制造新的拆分建议。

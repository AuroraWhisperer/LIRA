# 客户端代码职责与拆分粒度复核

日期：2026-11-09。范围：`D:\Work\Live` 当前工作树，基于 HEAD `f16db44e` 及开始时已有的 114 项未提交状态。本轮只审查，不修改产品实现，也未审查另一个工作区 `D:\Work\lira-server`。

> 后续整改：用户随后要求并行直接修复。S1、S2、M1、M2、M3 已完成，283 项相关行为、29 项架构、10 项文档检查及 1,826 文件语法通过，详见[整改验收记录](../../specs/plans/archive/2026-11-09-module-granularity-fix.md)。下文保留整改前的审查证据与验证结果，行号、模块职责和“本轮”均指审查阶段。

## 结论与优先级

建议保留 **5 项**：2 项职责归位、1 项协调层合并、2 项薄包装收回。它们是维护性改进，不是已证实的功能故障，也不建议发起全仓库拆分。

| 编号 | 建议 | 优先级 | 最小处理范围 |
| --- | --- | --- | --- |
| S1 | 拆开 `lyrics-service.js` 的歌词与音乐目录/歌单行为 | 优先整理 | 歌词获取/解析保留；首页、歌单查询与写入放到一个目录服务；匹配入口归已有 matcher |
| M1 | 合并播放队列的 `queue-operations` 与 `queue-coordinator` | 优先整理 | 收入现有 coordinator；保留 QueueManager 与 state actions |
| S2 | 收窄前端 `shared/utils.js`，先移出纯字体规则 | 随相关功能处理 | 让纯渲染消费者脱离 UI/请求聚合入口；保留必要的既有导出兼容 |
| M2 | 去掉 `provider-health.js` 的重复转发 | 顺手收回 | 调用已有 registry.healthCheck；不另造音乐健康服务 |
| M3 | 去掉 `gift-wish-image.js` 的单行适配 | 顺手收回 | 使用调用方已经导入的 setGiftArtwork，保留 format 参数 |

“优先”仅表示这五项之间的结构整改顺序。没有证据要求立刻重构授权、持久化或桌面生命周期。

## 方法与覆盖

依据[模块化规范](../architecture/engineering/modularity-standard.md)、[变更路由](../architecture/engineering/ai-workflow.md)及[遗留边界](../architecture/engineering/legacy-boundaries.md)，先建立当前产品 JavaScript 清单，再核对候选的实现、生产调用方和已有测试。

- 静态清单覆盖 `src/` 与 `public/js/` 的 **1,058 个模块、2,529 条可识别的本地导入边**，包括未跟踪的新文件。
- 现有规模扫描覆盖 2,331 个文件，给出 18 项提示。提示包括数据目录、CSS 和测试，不等同于 18 个职责问题。
- 深入复核音乐服务/路由、播放队列协调、共享工具、场景适配、云同步、桌面启停以及近期新增的周表模块。并非逐行穷举全部模块；原生 C#、构建与发布工具不在本轮深入审查范围。
- “唯一调用方”指图中的生产静态导入；对保留的合并项另查了产品、测试和文档引用。静态图不覆盖任意计算路径、HTML 入口或运行时注入。
- [此前同日审计](2026-11-09-client-responsibility-audit.md)的播放器工作区和弹幕 feed 两项已完成处理。当前 `app.js` 使用 `player-workspace.js`，feed 已不直接识别此前列出的样式私有规则，因此没有再次列为待办。

审查期间检测到 `admin/desktop-lyric.js` 和周表的 editor、editor-fields、renderer 有并行修改；本轮未修改这些文件。五项建议对应的源码与清单基线一致，周表的保留判断另核对了最新模块边界。以上清单数值是生成时的快照，不表示整个工作区已冻结。

拆分要求能指出独立变化原因和实际消费者；合并要求能减少中间层，同时保持状态、事务、协议和安全边界。行数与单一调用方都只能筛选候选。

## S1：歌词服务实际承担了音乐目录、歌单写入和匹配入口

**证据。** [lyrics-service.js](../../src/music/lyrics-service.js) 共 286 行，但包含几组独立行为：

| 当前位置 | 实际职责 |
| --- | --- |
| 第 50 行 `searchMusicTracks` | 搜索参数与 Provider 搜索 |
| 第 69 行 `getMusicHomeContentWithCache` | 推荐、每日、电台、喜欢、创建/收藏歌单、最近播放；推荐缓存按授权区分 |
| 第 167 行 `getMusicTrackLyricsWithCache`、第 206 行 `parseLyricPayload` | 歌词缓存、抓取和解析输入 |
| 第 186 行 `writeMusicPlaylistTracks`、第 231 行 `annotatePlaylistMembership` | 歌单修改、喜欢列表会话失效和歌曲归属查询 |
| 第 214 行 `matchMusicTrackCandidates` | 候选匹配输入与评分结果封装 |

[music-routes.js](../../src/server/routes/music-routes.js) 第 68、75、82、103 行分别通过 `context.music.lyrics` 查询首页、增删歌单和进行匹配；这不是文件命名上的猜测。对应的 matcher、Provider 歌单测试也直接导入这个歌词模块。歌词缓存规则变化与歌单写入/账号缓存变化需要触碰同一个拥有者。

**建议。** 将搜索、首页/歌单查询、歌单写入及其 membership helpers 作为一个完整的音乐目录服务提取；保留歌词获取/解析服务；把匹配输入入口归回已有 [song-matcher.js](../../src/music/song-matcher.js)。由 [music-runtime.js](../../src/server/music-runtime.js) 装配，并收窄 API context 的能力命名。不要把每个首页 action 拆成一个文件，`mapWithConcurrency` 也可以留在其实际使用模块。

**取舍。** 现有统一门面在代码量上仍可管理，因此不是紧急重写项；收益是让歌词解析、账号相关目录缓存和歌单写入可以独立维护。单纯改名能改善发现性，却不会解除这些变化原因的耦合。提取时不再给每项能力增加一层永久透传门面。

**必须保持。** HTTP 路径和结果不变；推荐缓存的授权 key 与回写前账号检查不变；歌单详情不读旧后端缓存；写入后的 liked-session 失效不变；空歌词不缓存。`compatibilityService` / `initLyricsService` 是已记录的兼容入口，其处置应明确迁移条件，不顺手删除。

**相关保护。** `test/playback/playback-home-lifecycle.test.js`、`test/music/song-matcher.test.js` 本轮已跑；实施时还应按实际移动范围运行 `test/lyrics/lyrics.test.js` 和 QQ/网易云 Provider 的歌单场景。技术文档归 `docs/reference/backend/music/services.md`、`docs/reference/backend/server-core.md` 与 `docs/reference/backend/api.md`；用户操作保持不变，无需改使用指南。

## M1：播放队列的一次操作被分成两层应用协调

**证据。** 原 `queue-operations.js` 69 行，只有 [queue-coordinator.js](../../public/js/playback/core/queue-coordinator.js) 一个生产静态调用方（整改后已并入该文件）。后者当时第 19–29 行向前者传入 9 项依赖；这些依赖在上层同样可用。

- 清队列/启动集合：内层负责失效导入、重置音频、清理当前项与 pending，并调用 QueueManager；外层再重建随机顺序、保存、播放和补充电台。
- `appendPlaybackTracks`、`insertPlaybackTracksNext`、`rebuildPlaybackShuffleOrder` 等在外层再转发一次；QueueManager 已经承担实际队列操作。
- 两层没有独立资源或独立生产消费者。它们共同描述一次队列操作的时序，修改时需要跨两处理解保存与播放的位置。

当前链路：`controller → queue-coordinator → queue-operations → QueueManager / stateActions`。

**建议。** 将 queue-operations 收入现有 coordinator，形成 `controller → queue-coordinator → QueueManager / stateActions`。保留 QueueManager 的队列规则和 stateActions 的状态写入边界，不把这两者一起合并。移除只为转发而存在的方法与依赖装配；无需新框架或通用动作执行器。

**取舍。** 内层有实际行为，不能简单删除；需要整体迁入原位置对应的操作。一次操作的同步准备和异步播放仍保持原顺序。这比把所有 playback handlers 合并更窄，也不会扩大 controller 的职责。

**必须保持。** 清队列使旧请求失效；取消清理不改变状态；确认待选不打断当前音频；跳转失败不抢占播放权；随机顺序、保存次数和电台补充时机不变。现有 `test/playback/playback-queue-behavior.test.js` 通过真实播放装配覆盖这些核心流程，本轮已跑。实施后按移动范围补跑 stream recovery / radio 场景，先查现有覆盖再决定是否新增测试。技术文档归 `docs/reference/frontend/playback.md`；用户操作不变。

## S2：前端共享工具仍把纯字体规则与 UI、请求入口连在一起

**证据。** [shared/utils.js](../../public/js/shared/utils.js) 虽只有 119 行，仍同时包含 DOM 表单读写、剪贴板 fallback、字体 fallback、携带 Admin token 的请求、错误提示、debounce 和数值归一化，并聚合对话框、toast、格式化等导出。

[now-playing-renderer.js](../../public/js/shared/now-playing-renderer.js) 第 2 行只为 `withMultilingualFallback` 引入它，因此纯字体拼接的依赖路径包含 confirmation-dialog、toast 和 JSON 请求辅助。另一个实际消费者是 Admin 的 [queue.js](../../public/js/admin/queue.js) 第 279 行。静态依赖存在不代表模块加载时已经发请求、显示弹窗或发生性能故障，本轮没有作这些推断。

**建议。** 首先把字体 fallback 归入一个无 DOM/请求依赖的、主题明确的字体文本模块，迁移上述消费者；之后仅在相关修改时将已有纯工具消费者导向其拥有者。`html-escape.js`、`display-format.js`、`json-response.js`、`toast.js` 等已经存在，应直接复用，避免重新实现。

**取舍。** [遗留边界](../architecture/engineering/legacy-boundaries.md)明确允许 utils 保留既有 UI/请求消费者的具名兼容导出。因此本建议不是一次性删除 utils，也不是每个十行函数各建一份 service。请求与错误通知本身可以作为一套有明确 UI 语义的能力保留。classic overlay 的独立入口另有兼容合同，本轮不顺带迁移。

**相关保护。** 现有 `test/ui/frontend-pure-utils.test.js` 本轮已跑，但它尚未覆盖提议中的字体入口；实施时可在现有用例中加入真实字体模块加载及空/指定字体结果检查，不新增测试基础设施。技术文档更新上述遗留边界及受影响的 frontend owner 文档即可，无使用步骤变化。

## M2：音乐健康检查包装重复了 registry 已有规则

**证据。** 原 `provider-health.js` 第 7–9 行只是在 platform 非空时 normalize，然后转发 `registry.healthCheck`。但 [provider-registry.js](../../src/music/provider-registry.js) 第 54–56 行本来就拥有同样的单平台 normalize 与全平台 Promise.all 分支。唯一生产调用方是 [music-routes.js](../../src/server/routes/music-routes.js) 第 29 行；整改后路由直接使用 registry，原包装文件已移除。

**建议。** 路由直接调用已有 `context.music.registry.healthCheck(platform)`，移除包装文件及其导入。合并的目标是现有行为拥有者，不把 normalize 复制到路由，也不将 `stream-resolver.js` 一并删除：后者确实承担 track 和播放选项的归一化。

**取舍与保护。** 收益小但边界明确。保留非法平台的 400 语义、空平台返回数组、单平台返回对象；实施时使用现有 Provider/API 测试验证。更新 `docs/reference/backend/api.md` 和音乐服务参考中的源码链接，用户接口不变。本轮未为删壳另造测试或实际修改路由。

## M3：许愿图片包装没有额外策略

**证据。** 原 `gift-wish-image.js` 全部 5 行，只将 `setGiftWishTextImage(image, source, format)` 转为 `setGiftArtwork(image, source, { format })`。唯一生产调用方 [gift-wish-card.js](../../public/js/shared/gift-wish-card.js) 已在第 1 行直接导入 setGiftArtwork，第 86 行再调用这层包装，第 98 行则直接使用同一个底层函数；整改后两处均直接调用，原包装文件已移除。

**建议。** 第 86 行直接使用已有的 `setGiftArtwork(image, wish.imagePath, { format: wish.textImageFormat })`，删除包装文件与重复导入。动态/静态图片、缓存、异步旧结果保护仍由 gift-image 拥有，不合并到底层 renderer。

**取舍与保护。** 这是低风险的小型收回，不值得单独发起一轮大重构。实施时检查文字版静态 PNG/动态原图的现有许愿与 gift-image 覆盖，并更新 `docs/reference/frontend/pages.md` 对该适配器的描述。本轮没有运行许愿浏览器用例，也没有声称图片运行时已重新验收；用户步骤不变。

## 不建议拆分或合并的代表

| 候选 | 当前保留依据 |
| --- | --- |
| `src/electron/main.js`、`src/server.js` | 大量代码是资源创建、显式装配与停机顺序；窗口、授权、同步和业务已有 owner。再切成接受宽 context 的 startup steps 不能自动改善边界。 |
| `remote-gift-controller.js`、`license-manager.js` | generation、账号/来源、串行提交、续期/重试和 abort 必须一起判定；history、retention、协议及错误策略已有独立模块。 |
| `cloud-settings-sync-controller.js`、`cloud-song-sync-controller.js`、`cloud-bilibili-sync-controller.js` | 分别负责设置合并/菜单、歌库 outbox/恢复、凭证与会话版本约束；函数名都叫 upload/reconcile 不意味着适合统一成一个同步器。 |
| `canvas-data-poller.js` 及各 `*-canvas-data.js` | 各自拥有请求取消、订阅开关或不同数据源的生命周期；不是只有转发的小文件。 |
| `scene-source.js`、`scene-output-events.js` | 前者拥有输出协议的版本、增量参数和 cursor 适配；后者固定场景错误合同。即使短，也隔离了具体协议。 |
| `license-operations.js`、`src/overtime/index.js` | 是领域能力的明确装配/公开门面；不能用“只转发”一概删除，迫使消费者散读内部模块。 |
| 新增 `weekly-schedule/` | model、存储、素材读取、字段视图、共享画布 renderer、导出页有不同消费者或运行边界；editor 的保存代次、上传代次与导出快照仍需同一协调者。 |
| `desktop-lyric-renderer.js` 与样式渲染模块 | 当前已有时间轴/设置/样式/行过渡分工；保留共同播放时钟、逐字状态和销毁所有权，不因 735 行继续切分。 |
| `src/shared/utils.js` | 混合主题仍属已记录债务，但 helper 无上层依赖。按相关任务逐步归位，不为本轮清单批量迁移所有消费者。 |
| 城市目录、样式选项、迁移注册与单个样式实现 | 数据长度、单个版本/样式的独立变化理由和完整迁移步骤需要按用途判断，不能据行数或单调用方机械拆合。 |

`api-context.js` 中 AI 配置触发菜单同步、游戏观众投影等局部逻辑也值得在下次相关改动时归位，但当前证据不足以把整个 API facade 拆成一批新模块，未计入优先五项。

## 实际验证与后续边界

| 本轮执行 | 结果 |
| --- | --- |
| `node scripts/check-modularity.js` | 完成；18 项规模提示，非失败 |
| `npm run verify:architecture` | 29/29 通过 |
| `node --experimental-vm-modules --test test/playback/playback-queue-behavior.test.js test/playback/playback-home-lifecycle.test.js test/music/song-matcher.test.js test/ui/frontend-pure-utils.test.js` | 62/62 通过 |
| `npm run verify:docs` | 10/10 通过 |

静态清单、工作树基线和测试日志在 `tmp/module-granularity-review-2026-11-09/`。这 101 项测试包含 91 项架构/行为检查与 10 项文档检查，不证明尚未实施的拆合无回归。本轮未运行完整套件、真实账号、设备、Electron 或浏览器 UI 验收。

本轮只新增此审查报告和报告索引条目。测试实现、技术合同与用户指南保持原状，因为运行行为、公开接口及使用步骤未变；每项建议已列明未来实施时需要同步的测试和文档。此报告不是已接受的架构决策或实施计划；实际拆合前应按 `PLANS.md` 明确 owner 变更、兼容约束和验收范围。

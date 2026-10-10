# 客户端结构整改与第二轮复审

日期：2026-10-10。对应[首次审查 R1–R10](2026-10-10-client-structure-review.md)及[整改计划](../../specs/plans/archive/2026-10-10-client-structure-remediation.md)。用户要求先确认问题真实存在，实施有价值的修改，再检查遗漏；本记录区分功能缺陷、可证实的重复工作与没有充分收益证据的进一步重构。

## 结论

现有 Electron、内嵌后端、领域服务、存储和前端职责适合继续作为模块化单体维护。本轮修复三项功能缺陷，并减少有实证的重复构造、渲染、轮询、读取和权限校验代码。没有发现需要新增服务、框架、依赖或全面拆分目录的理由。

全部十项已逐条核验并作出处理决定。R4 的最大保存间隔、R8 的容量索引/异步维护不属于已确认需求，没有扩张实施。第二轮由未负责对应实现的代理交叉审查，另补出了“取消发生在等待共享续期阶段”的关闭缺口并修复；最终复审未发现新的阻断问题。

## 逐项处理

| 项目 | 复核与实际修改 | 关键证据 |
| --- | --- | --- |
| R1 场景取消与关闭 | 确认功能缺陷。`scene-cloud-controller` 将 signal 传至授权门禁和设置 HTTP；取消可结束当前调用者对共享续期的等待，其他调用者仍可完成续期。 | 设置请求期间 dispose 会 abort 并排空；续期悬挂时，真实 main 关闭链仍执行 runtime stop、发出播放 flush 并等待确认。五秒退出期限、数据库关闭顺序和凭据隔离不变。 |
| R2 歌单缓存 | 确认功能缺陷。`lyrics-service` 去掉可修改歌单详情的第二份后端缓存，沿用播放器已有缓存和后台刷新。 | 真实 ContentLoader → service → 合成 Provider：删除最后一首后，强制刷新和后续普通读取均为空；旧磁盘条目不再影响结果。推荐歌单缓存保持。 |
| R3 机器人上下文 | 确认功能缺陷。daily-bot 页面 owner 采用授权生命周期 generation。 | 同账号 token 续期保留页面、草稿及丢失回执重试；重新授权、撤销及换号仍拒绝旧上下文。 |
| R4 保存快照 | 确认重复构造。保存通知仅标记待保存和递增 sequence，实际发送或显式 flush 时捕获最新状态。 | 40 次进度通知、1000 首合成歌单，提前曲目序列化从 80000 次降为 0；发送时构造一次。保留 1500ms 防抖、失败重试和旧回执拒绝；没有新增 maxWait。 |
| R5 播放列表渲染 | 确认重复 DOM 工作。通用 render 不重建搜索结果；队列关闭时不渲染，打开时补齐，可见时比较实际展示字段。 | 暂停及无关 WeSing 状态不重建队列/搜索列表；原地修改曲目、候选理由、歌单游标和隐藏期间变更均正确更新。未引入整对象 JSON 签名或新状态框架。 |
| R6 资源面板轮询 | 确认可见性判断缺口。两个现有轮询入口使用真实 DOM 可见性，覆盖祖先页面隐藏。 | 隔离 Electron 覆盖 inactive 主页面、hidden 子页、返回后恢复、未保存字号草稿及 dispose 清理。保留现有一秒计时器，没有全局调度器或 observer。 |
| R7 场景读取 | 确认重复状态构造。`getDisplayData` 内按需共享惰性读取函数，传到 extra display 的实际消费者。 | 歌词与冲刺组合使用一次本地快照；纯云弹幕不读本地完整状态；下一次调用重新读取；异步输出仍复查账号代次与来源权限。公共外观读取保持独立 owner。 |
| R8 缓存裁剪 | 部分建议值得立即实施：预算内跳过排序。 | 预算内排序 0 次，超限排序一次并按最旧文件精确回收。同步目录统计仍保留，以维持原 50/300MB 容量规则；没有实测卡顿证据，不建立额外索引或放宽上限。 |
| R9 IPC 复用 | 确认同合同重复。fan-profile 与 gift-export 复用现有 `createMainWindowIpcRegistrar`。 | 主窗口、主 frame、精确 origin、管理路径、返回封装和导出导航取消/销毁保持；不同权限的 daily-bot、license 等未被合并。 |
| R10 存储边界 | 确认目录归属与门禁缺口。requester target store 原样移至 storage，更新装配/调用者；SQL 检查识别 receiver 与点号间换行。 | 原查询、返回和随机请求行为不变；新增跨行检测回归。未改动的 overtime store 实际有 23 处，原正则只识别 8 处；据实校正旧额度 21 为 23，不代表新增 SQL 债务。 |

主要所有者为 `src/electron/license/`、`src/electron/*controller`、`public/js/playback/`、两个资源设置面板、`src/server/scene-*`、`src/music/lyrics-service.js` / `music-cache.js`、`src/storage/requester-target-store.js` 和对应测试。

## 第二轮审查与保留项

交叉审查覆盖关闭顺序、授权/取消/重试组合、IPC 权限、缓存刷新、持久化版本、可变队列输入、Admin 订阅与轮询生命周期、场景投影和存储装配。它不是对仓库每一行代码的证明。

R1 的第一次修复只打通 HTTP signal，仍可能在 HTTP 发出前等待共享续期。补充回归先重现该问题，再验证取消只释放当前等待者、不取消共享续期，并清理 abort listener；关闭组合测试明确检查播放 flush 的真实确认流程。

以下保留为低优先级观察，不视为本轮未修复缺陷：

- `PlaybackBar` 的固定大小封面在普通渲染时仍有重复更新。
- 选中 WeSing 的部分状态路径会重复更新一次标题。
- 加班机公共外观读取有自己的生命周期，完整 `getOutput` 可能读取两份完整状态。R7 仅保证本次 `getDisplayData` 投影复用，没有承诺外观与数据跨异步边界的原子快照。以后若有开销证据，可优先增加专用外观读口。

本轮未测得这些观察导致的 CPU、帧率或用户体验问题，不据此扩大为状态框架、通用缓存或跨职责合并。

## 验证证据

工作区同时有其他任务修改通讯、B 站事件、画布、导入等内容。最终整体验证使用完整隔离源码快照；复制前后哈希一致，依赖复用本机已安装 `node_modules`，测试采用临时目录、内存数据库和合成账号。快照不是新提交。

- 基线 HEAD：`eeedb1440a3123ffde0200e3ddd0ff9f4090ac88` 加快照时工作区改动。
- 最终快照：`tmp/client-structure-review/final-snapshot-20261010-v2/`。
- 2593 个文件的 SHA-256 清单：`tmp/client-structure-review/verification-snapshot-manifest.json`；首轮清单保留为同目录的 `verification-snapshot-manifest-first-run.json`。
- 服务端契约夹具：已有隔离 checkout `tmp/guard-accompany-contract/`，固定提交 `01fb2b47d5e081f5dd559933991ade4819eb3428`；没有切换用户的服务器工作区。

| 检查 | 结果与范围 |
| --- | --- |
| 关闭/续期定向测试 | 58/58，通过独立复验；其他桌面相关初轮 137/137。 |
| 音乐缓存与首页 | 51/51。 |
| 播放与持久化 | 九个文件 93/93；独立复审相关四个文件 70/70。 |
| 资源设置 Electron | 2/2，包含祖先隐藏生命周期回归。 |
| 场景显示与 runtime | 初轮 33/33，扩大交叉复审 98/98。 |
| 授权操作/SQL 边界/随机歌曲组合 | 48/48；并行通讯实现完成后上传确认用例也通过。 |
| 全量失败修正后的并发复验 | 请求权限、资源面板、授权续期/关闭和场景八个文件，并发 8，156/156。 |
| `npm run verify:architecture` | 快照 27/27。 |
| `npm run verify:contracts` | 固定服务端版本的 10 项夹具通过。 |
| `npm run check` | 首轮快照 1433 个 JavaScript 文件全部实际检查；最终当前工作区 1433 个文件通过，复用源码/环境哈希匹配的缓存。 |
| `npm run verify:docs` | 快照及最终报告/归档后的当前工作区均 10/10。 |
| `npm test` | 最终快照主体 4227/4227，加串行原生进程所有权 5/5，共 4232 项；失败、取消、跳过均为 0。 |

定向验证结果有重叠，不相加为独立用例总数。首轮全量为原生进程所有权 5/5，主体 4222/4225；3 项失败有明确原因：两个授权重验证测试的模拟上传成功回执缺少新契约要求的 count，另一个 Electron 夹具提供 getProfile 而页面已读取 getState。后者单独运行同样失败，不是并发偶发；同步夹具后保留原授权、隔离及回执断言，不增加超时或改变生产权限。上述 156 项通过后才重新固定源码并进行第二轮全量。

全量输出保存在根 tmp 的 `client-structure-review/all-tests.log` 和 `all-tests-final.log`。最终 37 个本任务源码/测试文件与快照一致，受测源码在运行期间没有变化。唯一后续非本任务源码区差异为 `test/license/license-ipc.test.js` 的模拟回执同步，当前文件已定向 5/5；全量结果仍明确归属上述快照。已检查本任务差异、`git diff --check` 和工作区状态；临时证据均留在忽略的 tmp，测试启动的 Electron 进程已退出。

最终全量及契约命令在快照目录执行，设置 `LIRA_SERVER_ROOT=D:/Work/Live/tmp/guard-accompany-contract` 后运行 `npm test`、`npm run verify:contracts`；语法及归档后的文档检查在原工作区执行 `npm run check`、`npm run verify:docs`。补充验证命令为 `node --experimental-vm-modules --test --test-concurrency=8 test/desktop/desktop-request-auth-electron.test.js test/desktop/resource-style-settings-electron.test.js test/license/license-manager-revalidation.test.js test/license/license-manager-renewal.test.js test/desktop/electron-shutdown.test.js test/scenes/scene-cloud-controller.test.js test/scenes/scene-display.test.js test/scenes/scene-runtime-events.test.js`。

## 文档与范围

已同步桌面生命周期/认证/IPC、播放器、Admin、overlay、音乐服务、存储及弹幕参考中的相关事实和移动路径。入口、操作步骤和用户可见限制没有改变，因此本任务未修改 README、用户指南、内置 usage-guide 或交互引导。测试新增真实回归，纯目录移动和相同 IPC 校验复用沿用既有行为测试。

为合并当前工作区检查，移除了并行 packet decoder 修改已消除的空 catch 旧额度，规范了另一活动计划的状态标记，并同步两个 Electron 夹具的本地授权快照读口；未改写该解码实现或扩大其需求。其他任务的业务、测试、文档、素材与暂存改动保留。

未验证真实 B 站/音乐账号、OBS/哔哩哔哩直播姬实播、长时负载、CPU/内存/FPS 或发布安装包。本轮性能证据是合成输入下的操作计数与行为回归；没有声称真实桌面提速比例。未提交、发版或操作用户正在运行的客户端。

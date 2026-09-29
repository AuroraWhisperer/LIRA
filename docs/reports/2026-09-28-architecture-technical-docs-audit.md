# 架构与技术文档更新审查

> 历史记录：本文的发现、建议和验证仅对应文内日期/基线，不是当前缺陷或执行清单。现状见 [技术参考](../reference/README.md)，剩余工作见 [计划索引](../../specs/plans/README.md) 与 [未结项台账](../../specs/plans/open-items.md)。原结论和后续执行记录保留，不据此恢复未获批准的提案。


审查日期：2026-09-28。基线：LIRA 客户端 5.0.8，`D:/Work/Live`，HEAD `0284d38f1712be5f51b1fe510f1ed1cb36313797`。审查开始时工作区干净。

本报告用于安排现有架构与技术文档的更新，不改变产品需求、架构决策或运行时行为。代码证据描述当前实现；若与已接受规格或 ADR 冲突，应记录冲突，由相应 owner 处理，不能直接把实现改写成新的需求。

## 1. 结论与范围

现有文档的主要问题是：新功能和模块拆分的说明已经局部补入，但总览、原有表格、导航及代码引用没有同步更新。应先纠正会误导开发者的运行边界与契约，再整理内容归属，最后扩大已有文档校验的覆盖范围。

本次范围为架构目录、相关技术说明、规格索引及它们对应的客户端实现。服务器职责通过客户端调用边界和既有服务器协议引用核对；没有据此宣称独立服务器或生产部署完成全面审查。

条目分为三类：

- **确定错误**：当前文档与可定位的代码、注册表或同一文档内的事实矛盾。
- **契约缺项**：实现已存在，但所属技术文档未完整记录调用或状态约束。
- **组织建议**：信息已有，只是分散、重复或缺少导航，不代表功能缺失。

更新优先级：P1 为身份、边界和状态判断可能被误读；P2 为契约完整性、开发定位或维护成本问题。这里的优先级针对文档修订，不是运行时漏洞评级。

执行边界：先修正确定错误，再补会影响调用、权限或数据安全的契约缺项；组织建议按实际定位困难决定是否执行。无需一次完成全部条目，也不以新增文档、全量字典或自动生成工具作为事实纠错的完成条件。

## 2. 第一轮已确认事项

### DOC-01：总览没有准确呈现客户端与服务器职责（P1，确定错误）

**需要更新**：[架构首页](../architecture/README.md)、[组件图源](../architecture/diagrams/components.d2)、[项目全貌图源](../architecture/diagrams/overview.d2)、[本地服务核心](../reference/backend/server-core.md)。图源修改后须同步现有 SVG、PNG。

当前问题：

- 首页仍写本地 Bilibili 获取通道暂停。实际 `createBilibiliRuntime` 仍创建并启动本地客户端，服务于弹幕、点歌、SC、用户信息和本地互动。
- 组件图仍把礼物检测、签到、抽签放入本地后端，没有表达 LIRA Server 和 Electron main 的远端调用、SSE 接收及本地投影。
- 本地服务核心仍用“全部业务领域服务”和“本地礼物 detector 暂停”等旧措辞；礼物领域文档已经说明原始检测实现删除、权威处理在服务器。

代码证据：[bilibili-runtime.js](../../src/server/bilibili-runtime.js) 的 `replaceClient` 调用链、[domain-services.js](../../src/server/domain-services.js) 的 `messages.handleDanmaku`、[remote-gift-controller.js](../../src/electron/remote-gift-controller.js)、[礼物领域文档](../reference/backend/bilibili/gift.md)。签到／抽签命令在本地返回 `cloud-owned`，不在客户端重新执行业务。

更新要求：

1. 保留“Electron 主进程同进程内嵌本地模块化单体”的模型，另外画清 LIRA Server 的职责。
2. 区分本地 Bilibili 弹幕输入、服务器权威礼物、云端机器人，不能合成一条所有事件都走远端的链路。
3. 标出 renderer → 受限 IPC → main → Device API，以及 main → SSE/pull → SQLite 投影 → 本地 HTTP/WS 的边界。
4. 图中只放稳定的 owner、协议方向和存储归属，易变端点／表／模块数量链接到所属注册表。

验收：每条跨进程或跨端连线可对应实际调用方和入口；没有把已经删除的检测器画成本地运行组件；没有把拟议共享源码方案画成已部署能力。

### DOC-02：页面打开方式与当前管理鉴权不符（P1，确定错误）

**需要更新**：[页面与 URL](../reference/frontend/pages.md) 的入口表、[构建运行模式](../reference/engineering/build.md)、[本地服务核心](../reference/backend/server-core.md) 的独立 Node 模式说明。

页面入口表仍把手动浏览器访问、`AUTO_OPEN_ADMIN=1` 和旧书签列为管理页的正常打开方式。[http-utils.js](../../src/server/http-utils.js) 的 `servePageOrAsset` 对非展示页、非登录页 HTML 检查管理凭据；没有有效凭据时返回 401 与“请从桌面应用打开管理页面。”。

更新要求：逐项说明 Electron 管理页、登录页、本地展示页及独立 Node 调试入口的用途、是否需要凭据、凭据来源和不支持的桌面能力。`?desktop=1` 是页面表现参数，不能写成授权来源。保留独立启动命令，但不能将其描述成匿名可用的完整 Web 管理产品。

验收：入口表与 `servePageOrAsset`、[access-policy.js](../../src/server/access-policy.js)、[desktop-request-auth.js](../../src/electron/desktop-request-auth.js) 一致；401/403 的解释不会引导开发者误判 localhost 不可达或关闭保护。

### DOC-03：IPC 注册表与桥接概述不完整（P1，确定错误／契约缺项）

**需要更新**：[IPC 文档](../reference/desktop/preload.md)、[通信文档](../reference/frontend/comms.md)、架构首页的 IPC 摘要。

[preload.js](../../src/electron/preload.js) 当前暴露八个命名空间：`dailyBots`、`fanProfiles`、`giftExport`、`songAssistantDesktop`、`musicAPI`、`bilibiliAuth`、`dynamicLotteryAuth`、`liraLicense`。通信文档仍写四个，IPC 文档部分段落仍用“新增第五个”等历史叙述。

按 preload 中的静态 `ipcRenderer.invoke` 字面量去重，可得到 65 个 invoke 通道；这不是包含全部事件和动态 action 的 IPC 总数。以下七个完整通道名未在声称全量的 IPC 文档中列出：

- `gift-export:prepare`、`gift-export:configure`、`gift-export:save`、`gift-export:cancel`、`gift-export:open-folder`。
- `license:get-pk-report-settings`、`license:update-pk-report-settings`。

相关能力在其他段落或主进程文档有所描述，不能把这项缺漏解释为整个功能没有文档。另有 12 个来源链接仍指向已不存在的 `src/electron/ipc/desktop-ipc.js`，实际 owner 为 [update-ipc.js](../../src/electron/ipc/update-ipc.js)。

更新要求：

1. 以命名空间／领域分组维护唯一通道表，覆盖 invoke、renderer → main 消息、main → renderer 事件。
2. 每项列出桥方法、方向、参数类型／范围／可空性、成功 DTO、公开错误、handler owner 和直接消费者。
3. 明确哪些允许 `/license`，哪些只允许管理页面；记录主窗口、主 frame、精确 origin 与授权代次检查。
4. `dailyBots.invoke`、`fanProfiles.invoke` 等复用通道须有 action 表，不以一个通道名代替各 action 的输入和返回契约。
5. 列出异步事件订阅／取消，以及账号切换、导航、关闭后迟到结果的处理。

验收：preload 实际通道与文档双向核对；已存在的业务说明被引用或归并，不在 `main.md` 和 `preload.md` 复制两套字段表。

### DOC-04：Admin 模块加载说明落后于 ESM 实现（P2，确定错误）

**需要更新**：[前端模块地图](../reference/frontend/pages.md) §4.1、[Admin 应用](../reference/frontend/app.md) 的入口／初始化说明。

模块地图仍写“全部为 Classic Script + 少数 ES Module 混用”。实际 [document-end.html](../../public/pages/admin/document-end.html) 以 `type="module"` 加载 [index.js](../../public/js/admin/index.js)，[app.js](../../public/js/admin/app.js)、[queue.js](../../public/js/admin/queue.js) 等已使用显式 import/export，兼容访问集中在 [legacy-admin-bridge.js](../../public/js/admin/legacy-admin-bridge.js)。

更新要求：说明 ESM 入口、常驻模块、[toolbox-lifecycle.js](../../public/js/admin/toolbox-lifecycle.js) 的按需加载、状态渲染 owner、兼容桥的有限职责；重新核对旧“按顺序 import 全部模块”的清单。不能因为仍有兼容全局就把全局注册当成新功能推荐模式。

验收：从入口跟踪直接 import 和 lazy import，可在文档找到初始化／释放 owner；不会引导新增重复初始化、重复订阅或扩大遗留全局依赖。

### DOC-05：抽奖库迁移版本表自相矛盾（P2，确定错误）

**需要更新**：[存储文档](../reference/backend/storage.md) §4 的 `lotteryDb` 行与迁移来源链接。

文档正文已记录 v2，但版本表仍为 v1。[dynamic-lottery-migrations.js](../../src/storage/dynamic-lottery-migrations.js) 实际有两个迁移步骤：创建初始表、为 `lottery_evidence` 增加 `display_name TEXT`。迁移表的老代码定位仍指向已经拆分的 `database.js` 大段行号。

更新要求：统一为 v1–v2，注明新增列的可空性、历史行行为、读取消费者；基础五库的迁移引用 [database-migrations.js](../../src/storage/database-migrations.js)，抽奖库引用独立迁移模块。数据库初始化、部分失败与资源释放约束继续由原 owner 文档说明。

验收：逐库迁移版本与实际注册步骤一致；迁移表不能只更新标题而遗漏字段、索引和兼容行为。

### DOC-06：易变数量在多个地方发生漂移（P2，确定错误）

**需要更新**：架构首页及两张 D2 图的手工计数。

| 事实 | 旧描述示例 | 当前证据／建议 |
| --- | --- | --- |
| 本地 HTTP | 15 模块、90 或 92 端点 | 实际 `ROUTE_MODULES` 为 19 模块、135 个方法／路径组合、124 个不同路径；明确统计口径 |
| 运行时依赖 | 3 个 | [package.json](../../package.json) 有 4 个，包含 `@clamber_l/crypto`；首页直接链接构建文档 |
| 数据库 | 图中 5 库 26 表，首页 6 库 36 表 | 内存库迁移确认六库共 44 张业务表，另有各库 schema_version；总览移除表数，表清单随 schema 核对 |
| WS 管理快照 | 首页 16 字段、图中 15 字段 | 所属 [ws.md](../reference/backend/ws.md) 已写 17 字段；总览不复制字段数 |
| 展示页 | 5／11／13 等混合数字 | 以 `OVERLAY_PAGES`、URL 映射及页面用途区分；能力 scope 不等于都应列为用户可添加的 OBS 源 |
| IPC | 33 通道、4 个桥 | 以完整通道／桥注册表为准，避免混算 invoke、事件和 action |

验收：每类事实只有一个完整清单；其余位置用描述和链接，不通过手动同时维护多个数字来维持一致。

### DOC-07：文件链接和代码行号失效（P2，确定错误）

第一轮对架构目录 52 篇 Markdown 扫描，排除代码块和行内示例后确认 15 处失效文件链接：

| 文档 | 位置／数量 | 应修订为 |
| --- | --- | --- |
| `backend/api.md` | 约第 380 行，1 处 | `../../../specs/gift-ledger-projection-sync_design.md` |
| `desktop/main.md` | 约第 308 行，1 处 | `../../../specs/gift-ledger-projection-sync_design.md` |
| `desktop/preload.md` | 约第 117–129 行，12 处 | 实际 `src/electron/ipc/update-ipc.js` 的相对链接 |
| `backend/bilibili/gift.md` | 约第 162 行，1 处 | `../../../../specs/gift-ledger-projection-sync_design.md` |

另外确认 13 处代码链接的起始行号超过目标文件长度。例如存储文档引用 `database.js#L337`，目标文件只有约 115 行；通信文档引用 `settings.js#L327`，目标文件只有约 142 行。这只统计明显越界，不能据此认为其余行号都仍指向正确符号。

更新要求：优先链接当前 owner 文件并写函数／导出名；需要固定行号证据时标明审查基线。逐项核对“文件存在但函数已移动”的情况，不能只修能被扫描器发现的链接。

验收：全文本地链接可解析；技术符号确实在指向文件内；图表的源和渲染产物保持一致。

### DOC-08：ADR 导航未覆盖后续决策（P2，确定错误／组织建议）

架构首页只列到 ADR-0013，目录实际已有 ADR-0014～0020。应补上导航，并展示 Accepted、Superseded、Proposed 等实际状态。

特别注意 [ADR-0019](../architecture/adr/0019-stable-gift-source-owner.md) 对旧礼物来源身份的替代关系，以及 [ADR-0020](../architecture/adr/0020-shared-danmaku-source.md) 仍为 proposed。后者不能写进“已经实施的共享架构”。历史 ADR 保留决策过程，不整体改成现状说明。

验收：导航涵盖全部决策文件；冲突或替代关系有双向定位；提案状态不等于功能未实现缺陷。

### DOC-09：owner 路由表对新领域过于宽泛（P2，组织建议）

**需要更新**：[ai-workflow.md](../architecture/engineering/ai-workflow.md)。

粉丝档案、云端机器人、动态抽奖、云同步／远程礼物恢复和资源完整性检查目前主要落入 Electron、Server、Admin 等大类，无法直接定位跨层 owner、所属契约和针对性测试。

更新要求：为需要独立定位的领域补稳定 route ID，或细化现有行；每行保留实际 owner、唯一契约位置、直接消费者、少量有代表性的聚焦测试。不能仅按文件名相似性合并职责，也不必给每个小工具建立新路由。

验收：从领域任务能直接找到持有状态／事务／生命周期的模块，而不是从 `main.js` 开始重新搜索整个仓库。

### DOC-10：跨端协作说明需要收敛（P2，组织建议）

优先在架构首页或现有主进程文档增加简短的协作概述与链接，将散落在主进程文档、礼物文档和规格中的跨端总流程连接起来；只有现有章节无法清楚承载时，再考虑独立成文。字段表仍留给各自唯一契约 owner。

需要串联的主题如下，已有准确说明直接链接：

- 认证账号、稳定 `streamerId`、origin、设备会话和本地 scope 的关系；账号切换、续期、撤销的差异。
- settings／songs／Bilibili 三类同步的权威方、本地编辑、dirty/revision、持久待上传快照以及冲突处理。
- 礼物 SSE、final cursor、history bootstrap、epoch、投影事务及幂等消费者之间的关系。
- 云端签到／运势、欢迎／PK／礼物回复等设置的归属，以及关闭客户端不等于关闭云端业务。
- 本地展示能力与服务器 overlay capability 的差异，renderer 可以取得哪些展示地址、不能取得哪些凭据。
- 旧服务器能力缺失、网络异常、账号切换、应用退出时的返回与恢复路径。
- 服务器协议／fixture 的权威位置、客户端 pin 和契约验证方式。

验收：协作概述提供流程与职责导航，不另抄一套 API、IPC、schema 和错误码清单；从每条边可追踪到唯一契约文件。

## 3. 技术细节的按需核查项

下表用于检查本次修订涉及的契约，不要求每篇文档或每个端点补齐所有列项。优先说明调用者必须知道的约束，以及容易误用的权限、状态和数据行为；简单内部实现可链接 owner，已有正确内容直接复用。仅记录实际适用的分页、重试、取消、回滚等行为，不借文档补全新增产品要求。

| 类型 | 按适用范围核对的技术细节 |
| --- | --- |
| HTTP | 方法／路径、principal、请求参数类型／范围／默认值、分页和排序、成功 DTO、错误状态与公开码、二进制例外、幂等／并发要求、handler 和直接消费者 |
| IPC | bridge／通道／方向、payload 与 action、返回 DTO、sender/frame/origin/page 校验、授权代次、事件订阅清理、取消和迟到响应规则 |
| WS／SSE | 握手与鉴权、topic 和权限的差异、消息类型／字段、初始恢复、快照与增量关系、顺序／重复／缺口、大小预算、重连和关闭 |
| 存储 | 文件与目录 owner、表／列／约束／索引、迁移版本、事务原子性、租户／来源隔离、数据清理与保留范围、兼容导入、回滚和损坏时行为 |
| 生命周期 | 创建者、启动前置条件、状态转换、订阅／timer／请求 owner、取消与 whenIdle、部分初始化失败清理、关停顺序与超时 |
| 前端 | 页面与模块入口、状态 owner、数据投影、常驻／按需初始化、重复进入和释放、表单草稿与远端更新竞争、用户可恢复错误 |
| 音乐／歌词 | provider 输入输出、音源与歌词模型、单位与时钟、缓存键／有效期、付费／加密音源处理、认证来源、播放快照版本与恢复 |
| 构建／发布 | 运行时与依赖来源、脚本与平台要求、打包范围、hook 时序、产物命名、完整性清单、签名现状、更新／发布的前置验证 |
| 测试 | 命令与筛选规则、环境依赖、隔离方式、契约输入、覆盖到的行为、明确未验收的范围；不能把文件存在当成行为已验证 |

## 4. 反向核查记录

初稿完成后从代码注册表与实际 owner 反查所属文档。第二轮发现统一追加到本节；不会把“未运行实机／生产验收”自动转换成文档或产品缺陷。

第二轮从注册表、preload、schema/migrations、设置默认值、领域控制器和构建脚本反查，补充以下 12 项。下面的测试链接是后续修订的证据入口；实际执行过的验证单列于 §6。

### DOC-11：HTTP 通用约定遗漏二进制响应和局部预算（P2，确定错误／契约缺项）

**需要更新**：[api.md](../reference/backend/api.md) §0，而非只修改单端点表。

当前总则写“除歌库 CSV/XLSX 下载外全部为 JSON”，但同文已经列出 QQ 加密播放流；[bilibili-routes.js](../../src/server/routes/bilibili-routes.js) 的头像代理也直接返回图片。正文的 16 MB 全局请求体上限没有在总则说明 interactions 的例外；[api-routes.js](../../src/server/api-routes.js) 对 `/api/interactions/` 使用 **16 KiB** JSON body 预算。

更新要求：区分 JSON envelope、文件下载、图片代理和媒体流；注明 `Content-Type`、缓存、Range／206／416、错误在响应开始前后如何表达，以及 413 的连接关闭行为。局部预算在总则链接到领域条目，不能让调用者把统一 16 MiB 当作所有接口的承诺。

证据入口：[qq-encrypted-stream.js](../../src/music/qq-encrypted-stream.js)、[http-utils.js](../../src/server/http-utils.js) 的 `readRawBody`／错误映射、[QQ 流测试](../../test/music/qq-encrypted-stream.test.js)。音频的 64 MiB 与上游读取 30 秒限制已在音乐服务文档中说明，应引用，不重复造表。

验收：总则与每个二进制端点没有矛盾；区分入站 JSON 字节预算、上游响应字节预算、下载文件大小和流读取超时。

### DOC-12：设置 API 的校验描述不再完整（P1，确定错误／契约缺项）

**需要更新**：[api.md](../reference/backend/api.md) §2 和其引用的设置键说明。

当前表述在列出部分特殊字段后称“其余一律 String()”，遗漏 [settings-contract.js](../../src/server/settings-contract.js) 中已经存在的规则：

| 字段／组 | 当前实现 |
| --- | --- |
| 云同步布尔键 | 只将 true／false、1／0 及对应字符串归一化为 `'true'`／`'false'`，其他输入无效 |
| `queueLimit` | 整数 1–300；字符串必须为十进制数字，可有首尾空白 |
| `userCooldownSeconds` | 整数 0–3600；不接受任意 Number() 可解析表达式 |
| `roomId` | 非空但无法规范化的输入失败，不能笼统描述成总会清洗成功 |
| 礼物边框、盲盒映射、互动外观 | 分别委托专属 normalizer，有枚举／结构／数值约束 |
| `weSingCachePath`／`weSingLyricOffsetMs` | 专属归一化；保存前还需准备采集配置，准备失败返回 400 |
| 未知设置键 | 仍按 defaults 白名单忽略；不要把这一点误改成拒绝未知键 |

[settings-routes.js](../../src/server/routes/settings-routes.js) 的顺序是完整 normalize → WeSing prepare（需要时）→ `setMany` → apply（需要时）→ Bilibili configure／广播 → 按 `changedKeys` 判断云同步。调用 configure 不等于每次都实际重建连接；运行时仍判定是否需要替换。

更新要求：把上述字段的输入类型、范围、字符串存储形态、失败状态和批量原子性写清；不得将 renderer 的控件范围当作服务端校验事实。尤其要说明一个非法字段会使整次 patch 不提交。

验收入口：[settings-contract.test.js](../../test/settings/settings-contract.test.js)、[settings-bootstrap.test.js](../../test/settings/settings-bootstrap.test.js)；检查失败请求没有部分设置写入，也没有先启动新的采集器。

### DOC-13：WS“reason 枚举全集”实际上只有少量旧条目（P2，契约缺项）

**需要更新**：[ws.md](../reference/backend/ws.md) §3.1，并核对 [comms.md](../reference/frontend/comms.md) 的消费者说明。

现有表只列 connect 与 Bilibili／live 的少数原因。当前代码还有：

- `settings`、`theme:preset-applied`。
- `songs:save/delete/toggle/import/import-xlsx`、`cloud:songs`、`cloud:settings`。
- `queue:add` 及 `queue:${action}`、`superchat:${action}`。
- `gift:wishes`、`gift:sprint:reset`、`gift:clear-recent`。
- `database:clear-gifts`、`database:clear-all`、`database:retention` 及数据清理路由生成的原因。

这些不是纯日志文字。[state.js](../../public/js/admin/state.js) 根据部分 reason 决定歌库重载或礼物通知，所以漏记会影响开发者判断广播后的副作用。生产入口分别为 [song-routes.js](../../src/server/routes/song-routes.js)、[queue-routes.js](../../src/server/routes/queue-routes.js)、[data-routes.js](../../src/server/routes/data-routes.js)、[server.js](../../src/server.js)、[runtime-transport.js](../../src/server/runtime-transport.js)。

更新要求：按领域维护完整字面量与动态 action 模式；动态值继续链接合法 action owner，不把任意字符串视为契约。列明触发提交点、消费副作用、快照合并是否保留单一 reason；不要借补表新增客户端行为。

验收入口：[快照契约测试](../../test/transport/websocket-snapshot-contract.test.js)、[状态排序测试](../../test/admin/admin-state-ordering.test.js)、[运行时事件发布测试](../../test/server/runtime-event-publication.test.js)。

### DOC-14：数据库诊断字段被错误归入普通状态快照（P2，确定错误）

**需要更新**：[storage.md](../reference/backend/storage.md) §4 结尾。

文档写可从 `/api/state` 的 `schemaVersions` 查看版本。实际 [server.js](../../src/server.js) 的 `getState()` 只有现行 17 个业务字段，不含该字段；[system-routes.js](../../src/server/routes/system-routes.js) 原样封装此状态。版本信息在 [data-routes.js](../../src/server/routes/data-routes.js) 的 `GET /api/database/stats` 和 [api-context.js](../../src/server/api-context.js) 构造的受管理鉴权保护的 health 详情中。

更新要求：写成真实诊断入口，明确 health 匿名结果与管理详情不同；不能为了符合旧文档而把诊断数据添加到全局或展示页快照。

六个独立内存库按真实基础 schema 和迁移运行后的核对结果：

| 数据库 | schema key | 当前版本 | 业务表数 |
| --- | --- | --- | --- |
| songDb | song_db | 7 | 20 |
| superChatDb | super_chat_db | 1 | 1 |
| giftDb | gift_db | 14 | 8 |
| musicDb | music_db | 1 | 5 |
| checkinDb | checkin_db | 1 | 1 |
| lotteryDb | lottery_db | 2 | 9 |

44 个业务表名均能在存储 owner 文档中找到。因此本项是版本表／诊断入口修订，不应写成“六库表结构完全未记录”。内存库验证不替代旧用户数据升级、列约束或所有索引的全面验收。

### DOC-15：关停时序只列两个控制器，遗漏现有资源 owner（P1，契约缺项）

**需要更新**：[desktop/main.md](../reference/desktop/main.md) §7，交叉引用资源检查与粉丝档案等局部生命周期。

当前正文只写 dispose／等待远端礼物和云同步两个控制器。实际 [main.js](../../src/electron/main.js) 的 `requestDesktopShutdown` 还包括：

1. 开始关闭时停止资源检查，并保留 `integrityStopped` Promise。
2. dispose readiness，注销系统 resume，以及抽奖授权、礼物互动、导出、档案和云机器人 IPC。
3. dispose 动态抽奖授权；对 `remoteGiftController`、`cloudSyncController`、`fanProfileController`、`desktopAuth` 调用 dispose。
4. 等待资源检查、动态抽奖授权及上述控制器的 whenIdle，再停止内嵌 runtime。

部分 IPC disposer 自己拥有 controller 清理，例如 [daily-bot-ipc.js](../../src/electron/ipc/daily-bot-ipc.js) 和 [gift-export-ipc.js](../../src/electron/ipc/gift-export-ipc.js)；文档不能把每个 dispose 都机械变成额外一次调用。5 秒总兜底、单次终结和 renderer flush 的既有说明继续保留。

更新要求：用资源表标明创建点、取消入口、是否有排空 Promise、数据库依赖、晚完成保护，以及正常／超时／更新安装路径的差异。顺序图须体现数据库关闭前的等待边界。

验收入口：[electron-shutdown.test.js](../../test/desktop/electron-shutdown.test.js)、[resource-lifecycle-electron.test.js](../../test/desktop/resource-lifecycle-electron.test.js)；这些是文档证据入口，本次未启动 Electron 执行它们。

### DOC-16：构建配置表与同文发布流程描述冲突（P2，确定错误／契约缺项）

**需要更新**：[build.md](../reference/engineering/build.md) §1、§3，保留 §7 已有的准确说明。

- §3 的 `afterPack` 仍写“仅移除 default_app.asar”。实际 [after-pack.js](../../scripts/after-pack.js) 还拒绝直接 builder 发布并生成资源清单。
- 配置表缺 [after-sign.js](../../scripts/after-sign.js) 的清单重算和 [verify-client-installer.js](../../scripts/verify-client-installer.js) 的 `artifactBuildCompleted` 验证入口；这些内容已经在 §7 出现，应该统一，不再相互冲突。
- 与 package scripts 的精确键名比较，命令表未列 `verify:modularity`、`refresh:gifts`、`sync:gifts`、`test:offline`、`test:browser`、`test:desktop`、`test:installer`、`test:contracts`。测试分组细节可链接测试文档，维护脚本应标明读写／联网用途。

更新要求：完整画清打包 → afterPack 清单 → 可选签名 → afterSign 重算 → NSIS 产物 → 产物资源验证 → 发布入口复验。资源摘要验证和发布者签名验证是不同保证，不把存在 `afterSign` 当作正式签名验收已经完成。

验收入口：[packaging-scope.test.js](../../test/engineering/packaging-scope.test.js)、[client-installer-integrity.test.js](../../test/engineering/client-installer-integrity.test.js)、[publish-release.test.js](../../test/engineering/publish-release.test.js)。本次没有打包、签名或发布。

### DOC-17：测试文档的“全部测试清单”承诺与实际清单不符（P2，契约缺项）

**需要更新**：[test.md](../reference/engineering/test.md) 的覆盖口径和清单维护方式。

递归扫描当前 `test/` 得到 435 个 `*.test.js`；按完整仓库相对路径匹配，278 个未在该文出现。示例包括 Admin 状态排序／渲染、工具箱生命周期、AI 上下文／响应预算和资源生命周期测试。这是文档引用覆盖统计，不是断言这些测试未执行或这些行为未覆盖。

现行文档开头和 §2 声称“全部测试文件清单／唯一成表处”，但表格实际只列部分。可选择由 [run-tests.js](../../scripts/run-tests.js) 的发现规则派生文件索引，或明确改为“按领域的重点行为与测试入口”，并提供完整发现方式。用户需要的技术细节应放在环境要求、核心断言、失败含义和未覆盖边界上，而不是用过期的大表制造全覆盖印象。

验收：分组、目录筛选、Node／VM／浏览器／Electron／安装器依赖与 runner 一致；帮助文件、fixture 和探针不误计为普通测试入口。证据：[test/README.md](../../test/README.md)、[run-tests.test.js](../../test/engineering/run-tests.test.js)。

### DOC-18：设置索引的范围与首页承诺不一致（P2，确定错误／组织建议）

**需要更新**：[storage.md](../reference/backend/storage.md) §7 及架构首页对“settings 全表”的描述。

当前 `DEFAULT_SETTINGS` 有 226 个键；以精确键名检查，133 个未在存储文档出现。该文表头明确是“键（代表）”，且有 `desktopLyric*`、`storybook*` 等家族描述，因此不能将 133 直接当成没有任何说明的功能数。不过它不足以充当首页承诺的逐键技术字典。

优先将首页“settings 全表”改为“设置分组与存储约定”，并把存储文档中过时的完整键表引用修正为 `settings-defaults.js`；校验规则继续链接 `settings-contract.js` 和领域 normalizer。以下信息重点补充到涉及同步、私有状态、迁移或非显然限制的设置，普通外观键不要求再人工复制一份全量字典：

| 列项 | 示例／目的 |
| --- | --- |
| 精确键名、类型、默认值 | 区分字符串布尔、数字字符串、JSON 文本，避免消费者自行猜测 |
| 合法值与归一化 owner | 链接 `settings-contract.js`／对应领域 normalizer，不复制多套校验算法 |
| 权威方和同步范围 | 本机设置、云端 scope、只读投影、兼容遗留键分别说明 |
| 修改入口和消费者 | 哪个表单／IPC／HTTP 写入，哪些 renderer／runtime 消费 |
| 迁移与版本标记 | 如各风格 RangeVersion、queueStyleSettingsVersion，注明一次性转换条件 |
| 清空／导入导出行为 | 是否保留、是否包含路径或私有归属、是否出现在 HTTP／WS |

额外分区记录未进入 defaults 的内部持久键，例如 `cloudRoomAccountKey`、`cloudSongSyncPending:<hash>`，不得把它们混入可编辑的公开设置表。现有云同步持久化说明已经覆盖这两个例子，应保留并链接。

验收：默认键可通过 `settings-defaults.js` 完整查询，关键设置的约束可追踪到所属文档和校验 owner；私有动态键另有规则；“代表项”与“全量字典”的标题和实际内容一致。

### DOC-19：音乐装配表仍指向旧缓存目录（P2，确定错误）

**需要更新**：[music/services.md](../reference/backend/music/services.md) §2 的 lyricsService 装配参数及旧 server.js 位置说明。

当前表写 `<data>/music-api-cache`、`<data>/music-lyrics-cache`。实际 [data-paths.js](../../src/shared/data-paths.js) 的 `resolveDataPaths(dataDir)` 返回 `<data>/cache/music-api-cache`、`<data>/cache/music-lyrics-cache`，再由 [runtime-config.js](../../src/server/runtime-config.js) 和 [music-runtime.js](../../src/server/music-runtime.js) 传入。

更新要求：音乐文档只说明逻辑缓存职责、缓存 key／TTL／裁剪和调用参数；物理目录以 storage 的目录树为唯一完整清单。标出旧目录迁移由 data-directory-migration 拥有，避免维护者把已迁移目录误当成当前写入位置。

验收：业务数据、browser profile、可再生 cache、logs、updates 的位置与 [ADR-0016](../architecture/adr/0016-separated-client-data-lifecycles.md) 和路径计算器一致；不能机械替换字符串后留下旧 owner 链接。

### DOC-20：礼物 wire DTO 的旧封闭清单与扩展说明冲突（P1，确定错误／组织建议）

**需要更新**：[bilibili/gift.md](../reference/backend/bilibili/gift.md) §6.1、§9，与首段身份扩展和 §5 展示扩展合并核对。

§6.1 仍以“仅允许”列旧字段集合；同文其他位置已经分别记载 `giftVariantId`／`blindBoxVariantId` 和 `gift.display`。实际 [processed-gift-contract.js](../../src/shared/processed-gift-contract.js) 的 `validateGiftDisplayWire` 接受四种严格集合：基础、基础＋成对身份、基础＋display、基础＋身份＋display；后续 `canonicalizeGiftDisplay` 才负责内部归一化和金额派生，不能把两层约束混为一谈。

应补成单一版本／能力表，至少包括：

- `X-Lira-Gift-Identity: 1`、`X-Lira-Gift-Display: 1` 的独立协商；SSE 的特效协商另有 `X-Lira-Gift-Effects: 1`，不混入记账 DTO。
- `display` 的完整 `{version:1, avatarUrl, guardLevel}`，两个展示值的 null 语义、头像来源约束、等级枚举；禁止字段继续明确排除。
- wire 校验与内部 canonical 对象的区别，整数分派生字段不是再次发给 wire 白名单的字段。
- pull/history 的 512 KiB 响应预算、每页最多 200 条、page token 最长 4096、epoch 最长 128；这些是客户端接收约束，不据此扩展服务器承诺。
- 历史导入与 live final 的消费者资格、连续 cursor 和来源代次，不只列 HTTP 路径。

来源：[remote-gift-reads.js](../../src/electron/license/remote-gift-reads.js)、[remote-license-client.js](../../src/electron/license/remote-license-client.js)、[processed-gift-contract.test.js](../../test/gifts/processed-gift-contract.test.js)。

§9 标题仍为“Accepted，实施中”，而相关完整投影实现和其他文档已描述其当前行为。应区分“已存在的 bootstrap／恢复机制”和仍延期的首次历史确认／暂停等增强；不能把一个笼统状态套在整个能力上。状态更新须对照规格验收，不能仅因存在代码就把所有增强标记完成。

### DOC-21：IPC 细节需要按 action、页面和响应形态记录（P1，契约缺项）

这是 DOC-03 的进一步核对，不能只补齐通道名就关闭。

| 已核对到的差异 | 应记录的契约 |
| --- | --- |
| `daily-bots:invoke` 与 `fan-profiles:invoke` 页面白名单不同 | 前者允许 `/`、`/admin`、`/settings`，后者还允许 `/songs`；不以“都是管理页”代替精确范围 |
| 档案通道有多个领域 action | controller 的 open／auto-update-status／sync-guard-roster，加上 profile-service 和 profile-transfer 分派的 CRUD、提醒、合并、抑制、备份、旧流水操作，都应有参数与返回说明 |
| 档案公开错误并非统一错误码 | IPC 会返回受限中文文案；身份冲突可附 `existingId`。来源非法仍为 `IPC_SOURCE_INVALID` |
| 礼物导出 save 与其他方法的封装不同 | `save` 返回 controller 的结果，其他方法封装 `{ok:true,data}`；不能给全组写一个不准确的统一返回型 |
| 还有未列入事件表的 `gift-export:progress` | 记录 progress payload、任务识别、取消后行为、订阅解除；preload 中九个静态 on 通道有这一项未以完整通道名出现 |

档案 DTO 的细节也应可查，例如 [validation.js](../../src/fans/validation.js) 已限制 alias 100、summary 300、notes 20000、nextTopic 2000；tags 最多 30 项、每项最多 50；formerNames 最多 3 项、每项最多 200。这里的文本长度按 JavaScript `String.length`，即 UTF-16 code unit，在 `trim()` 前检查；tags 的项数也在过滤空值和去重前检查。不能改写成 UTF-8 字节、可见字符数或处理后的项数。typed identity、会员观察、backup v1、预览摘要与 revision 校验也应分别定位到 owner。

礼物导出应补已存在的任务约束，例如 [gift-export-controller.js](../../src/electron/gift-export-controller.js) 的条目数 1–10000、合并时每图最多 39 行、`viewRevision` 变化使旧任务失效，以及部分保存失败和取消的结果；这些不应由调用方从 UI 猜出。

来源：[fan-profile-ipc.js](../../src/electron/ipc/fan-profile-ipc.js)、[daily-bot-ipc.js](../../src/electron/ipc/daily-bot-ipc.js)、[gift-export-ipc.js](../../src/electron/ipc/gift-export-ipc.js)、[profile-service.js](../../src/fans/profile-service.js)、[profile-transfer.js](../../src/fans/profile-transfer.js)。验收入口：[fan-profiles-ipc.test.js](../../test/fan-profiles/fan-profiles-ipc.test.js)、[daily-bot-controller.test.js](../../test/bots/daily-bot-controller.test.js)、[gift-export-controller.test.js](../../test/gifts/gift-export-controller.test.js)。

### DOC-22：Markdown 标题锚点也有失效，文件存在检查发现不了（P2，确定错误）

在文件链接检查之外，用标题 slug 候选扫描并人工对照确认两处：

- 架构首页首段指向 `#事实地图`，实际标题是“事实地图(单一事实源归属)”，自动锚点包含括号内文字。
- 测试文档的两仓回归段指向 `build.md#持续集成`，目标章节已经改成“本地发布验证”。

更新要求：修复当前锚点与“托管检查”旧措辞；以后章节改名同时查找入站引用。链接检查区分文件目标、Markdown 标题锚点、代码行号三类，不把存在同名文件当作完整通过。

### 4.1 已核对正确的部分

以下结果用于限定修订范围：

| 范围 | 本次确认 | 不能外推为 |
| --- | --- | --- |
| 本地 API 注册 | 19 模块／135 方法路径组合与 API 文档双向一致 | 所有参数、响应和错误文案都已正确 |
| SQLite 表名 | 六库 44 个业务表名均在存储文档出现，内存迁移版本已核对 | 真实历史数据升级和每个索引都已实机验证 |
| 管理快照 | `getState()` 的 17 个顶层字段与 ws.md 当前表一致 | 总览中的旧字段数或全部 reason 也正确 |
| WS 传输预算 | 256 KiB 入站帧／消息、2 MiB 待发送、30 秒 ping、90 秒超时、1 秒关闭回收与代码常量一致 | 本次进行了真实网络压力测试 |
| QQ 解密流 | 音乐服务文档已经记录 pipeline 背压、取消、30 秒主动读取期限和 64 MiB 预算 | 实际 QQ 上游当前对所有账户可用 |
| 资源完整性 | build.md 发布流程、update.md 和 preload.md 已有实现说明 | 原构建配置表一致或正式签名安装验收已闭环 |
| 配置环境变量 | `src/` 内静态 `process.env.NAME` 扫描未发现完全不在架构文档出现的名称 | 动态访问、脚本变量及每个默认值已全量核准 |
| 云同步持久状态 | storage.md 已记录私有账号归属和按账号保存的歌曲待上传快照 | 这些私有键应进入公开设置字典 |

### 4.2 覆盖与后续修订落点

| 核查面 | 实际采用的方法 | 本报告条目 |
| --- | --- | --- |
| 架构／客户端与服务器 | 主入口、Bilibili 装配、远端控制器与当前领域文档交叉核对 | 01、10、20 |
| 页面／身份 | 静态服务鉴权、overlay scope、preload 与 IPC 白名单 | 02、03、21 |
| HTTP | 实际 ROUTE_MODULES、通用 body／响应、设置和诊断 handler | 06、11、12、14 |
| WS | getState、广播调用点、传输常量和消费端副作用 | 06、13 |
| 存储 | 六个内存 SQLite 的基础 DDL＋真实迁移、表名与默认键索引 | 05、14、18、19 |
| 生命周期 | main 的 shutdown／dispose／whenIdle 调用与文档序列 | 15 |
| 前端 | Admin ESM 入口、兼容桥、按需工具初始化与模块说明 | 04、09 |
| 音乐／AI | 音乐缓存路径与解密流、QQ 方法边界、AI 工具注册及工具说明抽查 | 19；其余抽查未形成新增确定错误 |
| 构建／测试 | package scripts、三个构建钩子、测试文件发现与文档声明 | 16、17 |
| 可追踪性 | 52 篇架构 Markdown 的文件链接、越界代码行号、标题锚点和 ADR 导航 | 07、08、22 |

这是两轮审查的覆盖记录，不是全仓逐函数行为证明。Bilibili／音乐上游协议的线上有效性、生产服务器、真实账号登录、OBS 展示和正式安装器验收不属于这次只读文档核查。

## 5. 更新顺序与交付验收

1. **纠正事实**：DOC-01～08，以及 DOC-11～16、19～22 中的确定错误和相互矛盾描述；按注册表／导出／迁移步骤核对。
2. **补足关键契约**：根据 DOC-03、12、13、18、20、21 补影响调用、权限或数据一致性的字段、异常、时序和限制，优先更新已有 owner 文档。DOC-03 与 DOC-21 合并修订和验收，保留编号用于追踪。
3. **按需整理归属与导航**：DOC-09～10 优先通过现有路由行、章节和链接解决定位问题；只有仍有明确缺口时才新增路由或文档，避免为统一形式搬动已有正确内容。
4. **维护检查**：修订 DOC-17 的测试发现／覆盖口径，优先明确为重点测试入口并链接 runner 的完整发现方式。链接检查先覆盖本次修改及相关入站引用；扩大现有检查可后续单独处理，不为人工语义审查建立复杂生成系统。

本轮修订完成标准：本轮选定条目有处置记录；涉及的协议／存储／状态描述能追踪到当前 owner 和证据；修改的图文一致；未实施提案仍标为提案；现有校验与受影响链接检查通过。其余条目保留待办，不因组织建议未执行而阻塞已完成的事实纠错。

## 6. 验证与限制

初稿前和补查完成后均运行 `npm run verify:docs`：7/7 通过，其中本地 HTTP 方法／路径与文档双向一致。通过结果不证明请求／返回字段、IPC 或全部架构文档链接都正确；现有链接检查只覆盖选定文件。执行时 Node 给出既有 `MODULE_TYPELESS_PACKAGE_JSON` 提示，未导致测试失败。

第一轮另执行只读代码注册表提取、架构 Markdown 链接和越界行号扫描。第二轮再次核对注册入口和缺项，增加标题锚点扫描、设置键／测试文件／script 索引比较，以及六个 `DatabaseSync(':memory:')` 的真实 schema/migration 验证；内存数据库均在 finally 中关闭，没有创建磁盘数据库。

### 6.1 统计口径与复核入口

以下是审查基线的统计快照，不能直接作为后续版本的固定数量断言：

| 统计 | 来源和提取方式 | 排除项／限制 |
| --- | --- | --- |
| 19 模块／135 方法路径／124 路径 | 从 `api-routes.js` 的实际 `ROUTE_MODULES` 取各模块 `routes` 的键；方法路径去重后，再移除方法取路径去重。现有 [governance-docs.test.js](../../test/engineering/governance-docs.test.js) 的 `registeredApiRoutes` 使用同一注册入口 | 不把文档中的 LIRA Server Device API、静态页面或 WS 当成本地 HTTP 路由 |
| 8 个桥／65 invoke／9 on | 从 `preload.js` 提取 `exposeInMainWorld`、`ipcRenderer.invoke`、`ipcRenderer.on` 的静态字符串并分别去重 | 不将同一 invoke 内的 action、`send` 消息或 main-only 内部事件合并计数 |
| 226 默认键 | 读取 [settings-defaults.js](../../src/storage/settings-defaults.js) 导出的 `DEFAULT_SETTINGS`；逐键查找 storage.md 字面量 | 家族通配说明不算逐键命中；内部动态键不在默认键集合内 |
| 435 测试文件 | 递归扫描 `test/` 中以 `.test.js` 结尾的文件；用完整仓库相对路径与 test.md 比较 | 这是文档索引覆盖，不是已执行测试数量、断言数量或代码覆盖率 |
| 六库／44 业务表 | 对独立内存库执行 [schema.js](../../src/storage/schema.js) 的基础 DDL、真实迁移和索引初始化，再查 `sqlite_master`；抽奖库用独立迁移入口 | 排除 `schema_version` 和 SQLite 内部表；没有读取磁盘上的用户数据 |
| 52 篇／15 处断链／13 处越界起始行 | 递归扫描 `docs/architecture/**/*.md`，按源文档目录解析本地目标；代码锚点另与目标文件行数比较 | 按引用出现次数统计；排除代码块／行内示例，标题锚点另外人工确认；未越界不代表符号定位正确 |

报告自身的 102 个本地文件链接全部可解析，22 个 DOC 编号无重复，尾随空白检查和 `git diff --check` 通过。新增文件另以 `git diff --no-index --check` 检查，未报告空白错误；该命令返回 1 表示新文件相对空文件存在差异。最终审阅仅针对本报告；工作区中其他同时进行的改动保持原样。

### 6.2 未执行的验收

没有启动真实客户端、使用用户数据库或连接生产服务。本报告中的测试文件链接主要为后续维护导航，不能理解为本次已运行这些测试。

以上为审查完成时的记录：当时只新增审查材料，正式文档和业务实现尚未修订。后续文档修订另记于 §7，业务实现保持不变。


## 7. 首轮文档修订记录（2026-09-28）

本轮只修订文档与现有 D2/SVG/PNG 图表，不修改产品需求、已接受决策、运行时实现或用户数据。保留审查基线统计，不将其改成随版本漂移的固定断言。

| 条目 | 本轮处置 | 剩余范围 |
| --- | --- | --- |
| DOC-01 | 已修订首页、本地服务核心、Admin 礼物说明和两张架构图：区分本地弹幕输入、服务器权威礼物、云端机器人；标出 renderer preload、main、Device API、SSE/pull 与本地投影 | 未对生产服务器做运行验收 |
| DOC-02 | 已修订页面入口与 Node 调试模式，明确管理凭据来源、登录/展示页例外、桌面能力边界及 401/403 含义 | 无本轮待办 |
| DOC-03 / DOC-21 | 已纠正桥数量叙述、集中列出当前命名空间，修复更新 IPC 的 owner 链接；通信文档明确典型示例口径 | **待补全** invoke/send/on 注册表、action 参数/DTO/错误、页面白名单、导出事件和取消/代次契约，不能据此关闭条目 |
| DOC-04 | 已修订 ESM 入口、常驻与按需模块、初始化/释放 owner、状态渲染与有限兼容桥说明 | 无本轮待办 |
| DOC-05 | 已统一 lotteryDb v1–v2，补可空列、历史行、索引不变与读取方，迁移链接指向各自 owner | 无本轮待办 |
| DOC-06 | 已移除首页与两图的易漂移数量，改为所属文档/注册表链接；修正 server-core 旧路由模块数量描述 | 各领域契约的完整性仍按对应条目跟踪 |
| DOC-07 | 已修复报告确认的 15 处失效文件链接与 13 处越界起始行；对相关移动符号追至当前 owner，并修复相邻的同类旧定位 | 未宣称所有未越界行号都已逐符号复核；本轮链接扫描不是语义证明 |
| DOC-08 | 已补齐 ADR-0001～0020 导航及状态，标注身份/目录/数据布局的替代关系；0020 保持 Proposed | 历史 ADR 正文未重写 |
| DOC-17 | 已将手工清单明确为重点行为与测试入口，链接 runner 的完整发现方式及环境分组 | 无需新增生成索引 |
| DOC-18 | 已修正首页与存储文档的“全表”承诺，默认键链接指向 settings-defaults；保留内部持久键分区，链接校验 owner | 涉及同步、迁移和非显然限制的关键设置逐项补充仍待后续契约轮处理 |
| DOC-19 | 已修正音乐缓存参数与物理目录，装配/配置/迁移分别链接当前 owner | 无本轮待办 |
| DOC-22 | 已修复两处确认的标题锚点及“托管检查”旧措辞 | 未扩大为全仓标题锚点语义审查 |
| DOC-09 / DOC-10 | 保留待办；本轮首页增加边界概述，但不算完整跨端协作导航 | 后续按实际定位需要细化 owner 路由及同步/授权/恢复导航 |
| DOC-11～16 / DOC-20 | 保留待办 | HTTP 二进制与预算、设置校验、WS reason、诊断存储、退出顺序、构建钩子、礼物 wire DTO 等按原条目修订 |

### 本轮验证与限制

- `npm run verify:docs`：7/7 通过；仍有既有 `MODULE_TYPELESS_PACKAGE_JSON` 提示。
- 对架构 Markdown 排除代码块与行内示例后检查本地文件目标、代码链接起始行，并核对本轮修复的标题锚点；D2 节点链接指向存在的文档。
- 两张 D2 均成功编译为 SVG；当前 D2 0.7.1 的内置 PNG 驱动下载返回 404，改用项目已有 Playwright Chromium 按 SVG 根 viewBox 尺寸输出 PNG，检查文字、边界与连线后关闭专用浏览器。未启动 LIRA 或接触真实账号/数据库。
- 测试文档中的 `node scripts/run-tests.js all --list` 仅用于验证发现入口，不表示执行了全部测试；本轮不运行产品全量套件、安装器或生产服务器验收。
- 最终核对触及的文档 diff、`git diff --check` 与工作区状态；原有 `public/` UI 改动保留。


## 8. 全部条目修订与验收（2026-09-28）

按后续“继续完成”的要求，已完成 DOC-01～22 的文档修订。§7 是首轮历史记录，下表取代其待办状态；完成范围是本报告要求的事实纠错、契约补充与导航，不包括另行延期的产品增强。没有为适配旧文档修改运行时行为、规格状态或服务器工作区。

| 条目 | 最终处置与证据 |
| --- | --- |
| DOC-01 | [首页](../architecture/README.md)、[本地服务核心](../reference/backend/server-core.md) 和两张 D2/SVG/PNG 已区分本地 Bilibili、main 远端代理、服务器权威礼物、云端机器人、本地 SQLite 投影与 HTTP/WS 消费。首轮已编译并目视检查图表。 |
| DOC-02 | [页面入口](../reference/frontend/pages.md)、构建与 server-core 明确 Electron 管理凭据、登录/展示例外及 Node 调试限制，desktop=1 不作为授权。 |
| DOC-03 | [preload](../reference/desktop/preload.md) 按领域重建唯一通道表，桥方法/载荷/DTO/错误/handler/消费者可查；静态双向核对65 invoke、9 on、0 send，无遗漏或多列；与 DOC-21 合并验收。 |
| DOC-04 | [Admin](../reference/frontend/app.md) 和 pages 已按 ESM 常驻入口、toolbox lazy import、状态渲染及有限 legacy bridge 记录初始化与释放职责。 |
| DOC-05 | [storage](../reference/backend/storage.md) 迁移表统一 lottery v1–v2，记录 nullable display_name、旧行 NULL、读取方及索引不变，基础/独立迁移链接分开。 |
| DOC-06 | 首页和图表删除易漂移计数，保留稳定 owner 与清单链接；统计不再散落复制。 |
| DOC-07 | 修复原报告确认的失效路径与越界行号，迁移/装配/IPC 引用当前 owner；本轮进一步移除过时 main/package 行定位。所有架构 Markdown 与本报告重新扫描文件目标和代码起始行。 |
| DOC-08 | ADR-0001～0020 已索引状态与替代关系，0020 继续 Proposed；不重写历史决策。 |
| DOC-09 | [ai-workflow](../architecture/engineering/ai-workflow.md) 新增档案、每日机器人、动态抽奖、云同步、礼物恢复、资源完整性六条稳定 route ID，列真实 owner、契约、直接消费者和聚焦测试；治理校验通过。 |
| DOC-10 | 首页增加协作导航，连接身份/代次/本地 scope、三类同步、礼物恢复、云端业务、两类展示 capability、错误/退出和服务器协议 pin；字段仍由原 owner 文档维护。 |
| DOC-11 | [api](../reference/backend/api.md) 总则区分 JSON/CSV-XLSX/头像/QQ媒体，明确16 MiB与16 KiB入站预算、Range/206/416、头前头后错误和413回收；QQ流12项测试通过。 |
| DOC-12 | api 设置表补全布尔/整数/房间/领域 normalizer、盲盒结构预算、WeSing prepare、字符串持久化与整批校验/事务边界；settings-contract/bootstrap 测试通过。 |
| DOC-13 | [ws](../reference/backend/ws.md) 列出实际 reason 及合法 action 后缀、生产者、Admin 副作用；说明 microtask 仅保留最后 reason。字面量 producer 扫描无漏项，快照/排序/发布测试通过。 |
| DOC-14 | storage 将 schemaVersions 定位到管理数据库统计与授权 health；匿名 health 和业务快照边界明确，没有添加新诊断字段。 |
| DOC-15 | [main](../reference/desktop/main.md) 关闭序列与资源表覆盖 readiness、resume、IPC、完整性、抽奖授权、四个待排空 controller、无独立 drain 的导出/每日机器人；区分更新安装与手动重启。shutdown 测试及隔离 Electron 资源探针通过。 |
| DOC-16 | [build](../reference/engineering/build.md) 补齐 scripts；三个 hook 与发布图一致，资源摘要不冒充发布者签名；打包范围、安装器资源验证和发布流程测试通过（使用合成产物，没有构建/安装/发布真实版本）。 |
| DOC-17 | [test](../reference/engineering/test.md) 明确代表性入口及完整发现方式，保留五类依赖分组；没有把列出文件数当执行数或覆盖率。 |
| DOC-18 | storage §7补关键默认值/同步与本地归属/写入与消费者/迁移检查点/清空与导入导出；defaults 外的 giftDisplayConfig、giftExport* 与真正私有 cloudRoomAccountKey/cloudSongSyncPending 分开说明。 |
| DOC-19 | [music/services](../reference/backend/music/services.md) 缓存参数改为 data/cache 下路径，链接 runtime-config/music-runtime/data-directory-migration；完整目录树仍只在 storage。 |
| DOC-20 | [gift](../reference/backend/bilibili/gift.md) 统一四种 wire 字段集合、独立能力头、display、金额精度与内部 Cents、响应/分页预算、历史和 live 消费者资格；现有恢复与延期增强分开。锁定 fixture 和 processed-gift 契约测试通过。 |
| DOC-21 | preload 补完整每日机器人/档案 action 表、UTF-16文本限制、typed identity、会员依据、backup v1嵌套记录、revision/digest；导出 save 外层、progress、39行/10000条、任务失效和部分保存可查。档案IPC/机器人/导出测试通过；逐项 action 扫描无遗漏。 |
| DOC-22 | 修复原两处锚点与入站历史引用；重组 preload 后同步修复 Admin 导出说明入站锚点。最终按文件、Markdown heading、代码行号三类检查，不把文件存在等同于锚点有效。 |

### 8.1 实际验证

- `npm run verify:docs`：7/7通过；覆盖本地HTTP注册双向一致、治理链接、路由表真实路径及规格索引。
- 12个聚焦测试文件：settings-contract、settings-bootstrap、websocket-snapshot-contract、admin-state-ordering、runtime-event-publication、electron-shutdown、resource-integrity-bridge、packaging-scope、client-installer-integrity、publish-release、fan-profiles-ipc、gift-export-controller，共88项通过。
- processed-gift-contract、daily-bot-controller、resource-lifecycle-electron 共11项通过；QQ encrypted stream另12项通过。合计111项聚焦测试，无失败或跳过。既有 MODULE_TYPELESS_PACKAGE_JSON / VM Modules 提示不影响结果。
- 真实 Electron 43.2.0 探针使用现有隔离 fixture、临时 profile/session、随机端口和合成数据，验证展示连接重连/导航释放、媒体释放及销毁后零窗口/WebContents；没有启动用户的 LIRA 实例或读取用户数据库。
- 默认 `verify:contracts` 首次因旁边服务器检出HEAD不同而失败。随后在临时独立检出中使用锁定提交 `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b`，以 LIRA_SERVER_ROOT 执行：10份fixture摘要全部通过；未改锁文件、未重置服务器工作区。
- preload静态invoke/on与文档双向比对，daily-bot-controller/profile-service/profile-transfer action比对、package scripts比对、WS字面量producer比对均无遗漏。53篇文档的2567个本地引用、591个代码起始行定位、24个标题锚点扫描无问题；`git diff --check`及新增报告空白检查通过，已审阅任务文档diff与最终status。

### 8.2 范围与清理限制

本次完成文档修订，不代表生产服务、真实账号/B站上游、正式签名安装器或全仓运行行为验收。首次历史下载确认/暂停/继续等产品增强继续按原未结项记录跟踪，ADR-0020不实施。没有创建分支、提交、标签或发布；原有public界面修改保留。

测试创建的临时服务器检出位于 `C:/Users/Tom/AppData/Local/Temp/lira-docs-contract-44fff1c95b4f42168f92202a42b49648`。完成测试后尝试以校验过的绝对路径删除，工具安全策略拒绝该删除命令；没有换工具绕过，目录保留供手动清理。该目录不在项目diff中。

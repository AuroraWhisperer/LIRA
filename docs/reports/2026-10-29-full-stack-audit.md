# 客户端与服务器持续代码审计

日期：2026-10-29。历史审计于2026-10-31收尾；同日独立复核后的纠正与修复状态见下节。依据：[本次审计提示词](2026-10-29-full-stack-audit-prompt.md)。本报告保留发现时证据，不替代现行规范；用户已另行授权修复，执行入口为[双仓审计修复计划](../../specs/plans/archive/2026-10-31-full-stack-audit-remediation.md)。

## 当前复核与修复状态（2026-10-31）

独立复核确认原3,553项清单、5份补充输入、20份当前修订及809条收尾导航记录的数量和摘要一致。清零表示已登记范围闭合，不表示所有文件均逐字审阅、所有运行路径通过或生产验收完成。原始收尾凭证冻结保留；修复后的源码不再要求匹配修复前摘要。

复核发现客户端 `docs/examples/background-style/lira-pack.json` 被目录过滤遗漏。该文件在基线HEAD已存在，`test/scenes/component-styles.test.js:338` 将它用作真实维护测试输入；现已补读完整原文并核对消费断言，单列为第6份补充输入，不重写原3,553项分母或旧收尾凭证。补充证据见 `tmp/audit-remediation-2026-10-31/supplemental-background-manifest.json`。原报告的全范围完成声明应按此纠正理解。

修复前复核未发现足以撤销F-001—F-044的明确误报；当次仅重新执行F-001/002/003/029/032/041六项隔离诊断，其余为代码及历史证据核对。F-011管理预览失真、F-013偏移草稿丢失统一归P3，保留原P2的历史分级；修复前分布为P1 1项、P2 17项、P3 26项。P1为进程级高影响问题，P2为主要功能/数据正确性问题，P3为局部交互、低概率兼容或维护工具问题；等级不意味着发生频率已经实测。

F-038—F-040属于维护工具，D类包含文档漂移、测试证据及待验证事项，均不得混称生产安全漏洞。F-033的DST前提、F-037的损坏存储前提继续保留。后续修复沿用现有owner、事务、请求代次与草稿状态；没有为元数据全文见证追加全项目审计，也没有把风格偏好升级为功能需求。

### 本次授权修复结果

F-001—F-044的源码与对应针对性回归现已修复验证，双端共有F-021/F-042分别完成。逐项owner、实现路径和日志见[修复计划](../../specs/plans/archive/2026-10-31-full-stack-audit-remediation.md)，新凭证为 `tmp/audit-remediation-2026-10-31/final-receipt.json`，四分区 `remediation-summary.json` 保存具体断言和命令。后文“未修复/未实施”是发现时的历史记录，不能作为修复后的现状。

| 分区 | 对应条目与当前验证 |
| --- | --- |
| Server | F-001/011/014/021/022/024/037/042：隔离候选17份Node文件190/190、11份浏览器文件166/166通过；候选与原树2,534份源码摘要一致。 |
| Client runtime | F-002—010、F-012/013/015/017/018/019/025：既有后台、存储、桌面、播放及浏览器发送套件完成；恢复备份和历史恢复点共享规范化投影，自动发送在账号/房间变化后停止。分批执行有重叠，不叠加为唯一测试数。 |
| Client UI | F-020/021/023/026/027/028/030/031/032/033/034/035/036/041/042/043/044：124/124、73/73和17/17三批通过，包含真实隔离Chromium场景与样式检查，执行计数有重叠。 |
| Root | F-016/029/038/039：25/25；指南与游戏结束文案20/20；F-040隔离Electron验收退出0，覆盖“今天52条”、原生导出及105条滚动/来源清空；遗漏manifest消费测试1/1。 |
| 整合 | 最终客户端1,686文件语法检查和29项架构检查通过；文档与两仓差异门禁结果另记新凭证。原失败过程日志保留，不与最终成功混计。 |

**运行环境边界：** F-001的manifest和锁文件已使用修复版 `body-parser 2.4.0`，隔离候选已验证；原服务器工作目录 `node_modules` 仍为 `2.3.0`。本次未重装正在使用的依赖、未部署或重启用户服务，因此不能声称运行中的服务器漏洞已经消除。其余检查均使用合成数据和自有隔离进程，没有真实B站账号、OBS/哔哩哔哩直播姬或硬件实播验收。

D-002/003/004/009/010/011/012/014的已确认漂移已同步；D-005按现行明确规范统一两端实现与边界矩阵，仅显式 `option.source=2` 作为重复附带提示。D-006在实际并发批次等待稳定呈现与合法清理后通过，D-007现版排版用例已复验，D-008仍并入F-036。D-001其余公告按已确认可达条件分流。D-013已观察正常追加与设置重建：共享top动效运行并清理、正文保留、重建不重播；当前协议及ADR未要求专属入场标记，故裁定无已证实产品缺陷，不据源码注释新增动画功能。

## 历史 Goal 与收尾结果（2026-10-31，修复前）

本次以[聊天2“说明 Goal 与子代理协作”](codex://threads/01a18d7c-b37f-79b2-85be-f35d260441a7)第400批为主线，只沿用[聊天1](codex://threads/01a19142-faf6-7b23-a9ec-bd7f8fe3a1d7)已经核实的补充成果。Goal 已纠正为“补完剩余范围、按根因去重、只记录不修复，报告与证据一致后结束”；不承接额外零新增全项目复核轮。实际 Goal 已设置并回读，最终状态与检查结果见当前聊天及本次收尾凭证。

**剩余源码审计已完成。** 起点 `remaining-review-queue-2026-10-31-continued-16.json` 的809条证据导航疑点现全部闭合，剩余0；它们不是809份从未读过的代码。可靠旧全文按原有见证强度复用，明确局部只补真实缺口。主代理与三个 GPT-6.1 Sol / max 子代理按实际进度转交未读范围，没有追加全量源码复核。

| 本次证据分区 | 完成路径 |
| --- | ---: |
| 主代理管理前端 | 124 |
| 主代理服务器E2E | 42 |
| 子代理服务器其余 | 218 |
| 子代理客户端其余前端 | 147 |
| 子代理客户端测试 | 203 |
| 转交的客户端测试 | 64 |
| 主代理管理测试 | 5 |
| 转交的管理测试 | 6 |
| 合计（无重复、无漏项） | 809 |

新增确认缺陷0项；已有F-001至F-044仍全部未修复（P1 1项、P2 19项、P3 24项），D-013待验证、D-014已确认未修及全部旧失败/拒绝边界保留。完成是范围与证据闭合，不表示代码没有缺陷，也不把未验证事项记作通过。

原始3,553项清单、冻结coverage和历史批次保持不变。一次最终摘要核对显示3,533份同原始摘要，另外20份为已有独立审阅证据的客户端修订，全部仍匹配第400批当前摘要；没有意外源码变化。5份补充输入沿用第216批完成证据，摘要均未变化。原文、结构化业务语义、局部和自动证据仍分列，旧间接摘要见证不升级为逐次读取即时见证。

服务器 `public/games/v1/runtime/blind-box-data.json` 以不遗漏业务字段的448行完整语义视图闭合：30池、79档（73个启用）、14种有序schema和29字典；1,045个不同不透明十六进制值（1,095次出现）的原值另存并核对映射，未逐位人工阅读，不能称9,123物理行RAW全文。5份补充输入中4份完整结构化语义、1份RAW全文的原边界保持。媒体真实性、外部来源、实时赔率及实际播放均未因此获得验收。

本次没有运行产品或业务测试，也没有执行真实Electron/浏览器或上游账号操作，历史测试成功数不增加，旧浏览器失败及pin/PK夹具限制不消除。只更新审计报告、提示词和根目录tmp证据；产品实现、维护测试、技术契约和用户指南均不变，因为没有实施行为修复。收尾文档门禁 `npm run verify:docs` 10/10通过，两仓 `git diff --check` 均通过；工作区状态、审计文档差异和实际输出单独存入下述凭证，不混入历史业务测试成功数。

最终入口：`tmp/full-audit-2026-10-29/finish-from-thread2-2026-10-31/` 内的 `merged-reviews.jsonl`、`coverage-overlay-final.json`、`final-merge-check.json`、`remaining.json`、`checkpoint.md` 与 `final-receipt.json`。后文保留历史批次当时的“进行中/尚缺/下一步”作为证据，不代表本次仍有未读队列；当前状态以本节及最终凭证为准。

## 范围与执行约束（原审计）

- 客户端：`D:\Work\Live`；服务器：`D:\Work\lira-server`。两端均有既有未提交修改，审查工作区实际文件；保留既有内容，不修改业务代码。
- 两端维护中源码、页面、CSS、C# 原生助手、脚本、测试、构建/部署配置与契约纳入清单。依赖、运行数据、生成物、二进制素材和历史归档不作为自有源码逐行审查。
- 规范由各仓文档入口确定；历史审计用于去重，已整改项不重新报告为当前问题。
- 自动扫描、人工调用链审查与隔离复现分别登记。未完成的模块保持待审，不能把全量索引/搜索说成全量人工审查。
- 不控制用户正在运行的应用、不使用用户私有数据、不登录上游账号，不提交、发布或修改现行安全边界。测试只使用隔离进程、目录和合成账号；只在具体协议疑点需要时读取匿名公开接口，记录请求范围，隔离回放与公开查询分开说明。
- 按用户追加的“不要过度审查”执行：先覆盖未审代码；只有具体疑点才追加深入复现。风格偏好、不可达假设和规范接受的取舍不计缺陷，不把候选视角变成每个文件必须重复执行的固定清单。

## 执行计划与证据（原审计）

1. 建立文件摘要基线和覆盖台账，运行只读静态检查；验证：清单可按仓库和模块统计。
2. 按信任边界、调用/参数、业务状态、持久化、异步生命周期、模块化与容量等角度持续审查；验证：每项发现有 owner、调用链、反证与具体触发条件。
3. 对重要发现运行隔离复现或已有针对性检查，维护去重报告；验证：证据可重复，未验证项明确列出。

基线、逐文件覆盖、静态线索和命令结果位于 `tmp/full-audit-2026-10-29/`。原有逐批记录保持历史边界；本次补缺口完成状态见当前收尾结果，不追加全项目复核轮。

### 基线与自动覆盖

- 客户端 HEAD：`7caf830e66d913f615a6cca5d63718db65c668ab`；服务器 HEAD：`87f1c0de95f6b3096b79307923b43e436311742e`。摘要取自当前文件而非 HEAD 内容；未提交状态保存在本地 `baseline.json`。
- 文件清单合计 3,553 项：初始代码清单 3,291 项，先补入锁文件、systemd/cron、环境示例与机器可读协议/fixture 共 79 项，再通过未纳入扩展名清单复核补入 176 个 SVG、Nginx 示例与 6 个无扩展名配置，共 183 项。客户端 2,235 项：后端 485、前端 927、原生 16、工程 73、测试 733、其他配置 1；服务器 1,318 项：后端 284、前端 384、工程 54、测试 523、机器契约 73。
- 2,648 个 JavaScript 文件完成 AST 解析与静态 import/require 图提取，解析错误为 0、静态图未检出环。此结果不覆盖动态依赖，不替代 Node/Electron 运行语义或逻辑正确性。
- 前端静态命名 import/export 对照未发现缺失导出；198 个 JSON 文件解析通过。都属于自动覆盖，不能充当这些文件的语义审查。
- 全清单完成模式扫描；HTML sink、定时器、参数转换、空 catch 与凭据字面量命中均仅作线索。非测试凭据命中位于测试浏览器配置与基准脚本，尚无真实秘密泄漏证据，不在报告输出字面量。
- 未解析的相对路径主要来自测试字符串/虚拟夹具，另有浏览器路由映射；带版本查询串的 import 已按 URL 语义处理，不能按物理路径直接判缺失。
- 176 个 SVG 完成主动内容与引用模式扫描：504 处资源引用均指向本文件已有 ID，未命中脚本、事件处理属性、foreignObject 或外部资源；不代表完成 XML/视觉验收。Nginx 示例及无扩展名配置继续按实际职责人工追踪，不因补入清单自动算作审完。

- 补充范围：服务器文档入口将5份版本化 `gift-import/*.json` 列为礼物种子与玩法构建输入，旧索引却按目录整体排除。已核对受版本控制的5个路径并保存当前摘要到 `supplemental-data-queue-stage-163.json`，另行待语义审阅；不覆盖原3,553项基线，也不把摘要/解析算人工完成。160批只对其中媒体清单做自动核对，不能据此关闭补充队列。

## 已确认发现（修复前记录）

### F-001 [P1] 服务器压缩请求解析可以使进程在返回成功后退出

- **位置与调用链：** 服务器 `package-lock.json:200-201` 锁定 `body-parser 2.3.0`；`src/routes/auth.js:42`、`src/routes/admin-auth.js:10`、`src/routes/streamer-auth.js:23` 在登录验证前调用默认启用解压的 `express.json()`。`src/app.js:93` 的 API 限流和登录限流只限制频率，不拒绝首个压缩请求。`src/server-lifecycle.js:108-118` 只观察未捕获异常，保留 Node 的非零退出行为。
- **触发与证据：** 使用仓库专用 Node 24.15.0、当前安装的 Express/body-parser，在独立回环端口和子进程中发送有效 gzip JSON、零字节与后续 100 KiB 尾数据。先收到 `response=200`，随后 Gunzip 发出未处理的 `Z_DATA_ERROR`，子进程退出码为 1。普通尾数据的三个对照场景未退出，说明不能用任意压缩请求概括触发条件。命令：`node tmp/full-audit-2026-10-29/repro-body-parser.cjs`；完整结果：`body-parser-repro.json`。
- **影响与边界：** 从当前路由和中间件顺序看，登录前可达，可中断该进程服务的所有租户。复现的是项目所用解析栈，未调用真实应用或生产服务器，未验证线上反向代理和已部署版本。
- **外部核对：** [维护者公告 GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) 与 [修复提交](https://github.com/expressjs/body-parser/commit/1260c38) 确认受影响的 2.x 版本小于 2.4.0；本地复现与其机制一致。
- **最小修复方向：** 在独立依赖更新任务中将实际解析依赖锁定到修复版本，保持现有认证、请求大小与限流顺序。若产品不接受压缩请求，可评估在现有解析入口显式禁用解压；不能以捕获后继续运行业务代替修复。沿用 `test/management-body-admission.test.js`、`test/device-request-protection.test.js` 等入口覆盖，在隔离子进程增加退出与存活断言；按依赖消费者扩大回归，并核对工程依赖说明。当前未修改依赖。

### F-002 [P2] 客户端 RSS 重复解码会让合法转义文本中断整个搜索

- **位置与调用链：** 客户端 `src/ai/tools/web-search-tool.js:73-82` 先将 `&amp;` 解码，再匹配数字实体并直接调用 `String.fromCodePoint()`；`parseRssResults()` → `search()` → `src/ai/ai-assistant-service.js:386-408` 的本地 `web_search` 路径会传播异常。此处只对配额错误提供回退。
- **触发与证据：** 上游 HTTP 200 返回合法 XML，某项标题包含 `literal &amp;#1114112;`。一次 XML 解码后本应保留字面文本 `&#1114112;`，当前实现再次解释它并抛出 `RangeError: Invalid code point 1114112`；后续有效 item 也无法返回。直接解析和完整工具调用均已使用合成 RSS 与替身 fetch 复现，真实网络调用为 0。命令：`node tmp/full-audit-2026-10-29/repro-ai-rss.cjs`；结果：`ai-rss-repro.json`。
- **影响与边界：** 使用 Chat Completions 本地搜索的 AI 回答可能因单条结果文本失败。未证明真实 Bing 结果已经触发；不影响由模型服务托管的 Responses 搜索，也不导致宿主进程退出。
- **最小修复方向：** 在 RSS owner 中按单次实体解码处理转义，校验数字码点，不让一项文本导致整个工具崩溃；不要仅捕获 RangeError 后静默清空全部结果。仓库 `src/shared/xlsx-codec.js:60-61` 已有数字码点范围校验可作实现参考，其 XLSX 职责不应直接变成搜索依赖。扩展已有 `test/ai/ai-tools.test.js:325-360` 的实体用例，覆盖双重转义、无效数字与有效后续项。结果字段与操作入口不变，用户指南无需新增步骤；内部实现参考按修复后的保证核对。

### F-003 [P2] 暂停发生在 AudioContext 恢复期间时，旧启动会在 stop 之后重新打开设备

- **位置与调用链：** 客户端 `public/js/playback/features/native-output.js:74-85` 在 `setSinkId()` 后检查 epoch，但 `await context.resume()` 后直接发送 `open`，只在回执后再次检查。`pause()` → `stop()` 会先递增 epoch、清空 stream/opening 并发送 `stop`。main 的 `src/electron/playback-output.js:85-110` 按实际到达顺序执行，C# `PlaybackOutputContext.cs:54-75` 在 open 时创建并启动输出。
- **触发与证据：** 选择原生输出时，将 `context.resume()` 延迟；等待期间暂停音频，再完成 resume。真实前端模块向替身桥发送的顺序是 `['stop', 'open']`，最终 `audio.paused === true`、`currentId === ''`，而替身原生端仍处于 open。`select()` 末尾虽再次 stop，但 stream/opening 已清空，因此没有补发停止。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/repro-native-output-cancel.cjs`；结果：`native-output-cancel-repro.json`。
- **影响与边界：** 取消后的启动仍取得原生输出，界面没有保留对应 stream，设备可能一直被占用到下一次启动、窗口导航或应用清理。没有验证真实驱动的独占行为，不能声称已在声卡上发生锁死。现有 `test/playback/native-output.test.js:65` 已明确暂停时应释放原生输出，但 fixture 的 `resume()` 立即完成，未覆盖这个等待点。
- **最小修复方向：** 在 `resume()` 返回后、发出 `open` 前沿用既有 epoch/disposed 核查，不增加新控制器或修改 PCM/IPC 协议。扩展已有 native-output 测试的延迟恢复场景，并保留 main 的串行与迟到回执覆盖。此内部取消修复不改变用户操作与外部字段，指南无需新增步骤；桌面实现参考核对暂停/恢复说明即可。

### F-004 [P2] 加班机规则保存失败后，新规则仍已生效且未更新 revision

- **位置与调用链：** 客户端 `src/overtime/overtime-service.js:174-180` 先调用 `store.replaceRules()`，再 `commit('rules', ...)`；`src/storage/overtime-store.js:81-121` 在独立事务中提交整表替换，后续状态更新不是该事务的一部分。第二步保存失败时，`src/server/routes/overtime-routes.js:61-64` 的 handler 经 `overtimeRoute()` 返回错误，`public/js/admin/overtime.js:178-195` 保留未保存状态；规则表却已是新值，现有连接也没有收到更新。
- **触发与证据：** 在隔离数据库中先保存加 10 秒的规则，再改为加 120 秒；以 SQLite TEMP trigger 只拒绝第二步的状态写入。调用抛错，但规则变为 120、revision 保持 3、通知为 0；移除故障后，一份礼物将 60 秒变为 180 秒，而保留原规则应为 70 秒。实际迁移、规则 store、领域服务与礼物结算均参与复现，未使用真实数据。命令：`node tmp/full-audit-2026-10-29/repro-overtime-rules-atomicity.cjs`；结果：`overtime-rules-atomicity-repro.json`。
- **影响与边界：** 第二次数据库写入或提交失败时，用户看到保存失败，后续礼物却按新规则加减时间；规则快照与 revision/广播不一致。故障来自注入，未声称真实磁盘上已发生。已有 `test/overtime/overtime-state-failures.test.js` 覆盖时间、启停、背景等失败，未覆盖规则先提交后状态失败。
- **最小修复方向：** 由现有 overtime store 在同一事务中提交规则与候选状态/revision；提交成功后再替换内存状态、调整定时器和广播，保留现有 DTO 与整表替换语义。扩展上述失败测试，断言规则、状态、通知整体成功或整体保持旧值，并验证失败后的真实礼物仍使用旧规则。修复需同步 `docs/reference/backend/overtime.md` 的保存和事务事实；用户步骤未变，指南无需新增操作。

### F-005 [P2] 云恢复期间的正常续期会使桌面跳过授权工作恢复

- **位置与调用链：** 客户端 `src/electron/desktop-readiness-controller.js:29-47` 在等待云恢复前捕获 token 的 authorization epoch，完成后要求完全相同；`src/electron/license/license-manager.js:461-480` 每次成功续期都会递增这个 epoch，但 `setState()` 在同为 authorized 时不通知监听者。因而旧恢复被丢弃，又没有新恢复替代。现有 `getAuthorizationGeneration()` 已区分授权生命周期与 token 更换。
- **触发与证据：** 真实 license manager 与 readiness controller，替身远程授权和可控云恢复 promise；在恢复等待期间执行真实 manager 安排的续期回调。续期后仍 authorized，生命周期 generation 未变，epoch 从 1 变为 2，状态通知为 0；云恢复成功后 `resumeAuthorizedWork()` 调用为 0。未续期的对照调用为 1。以受支持的 30 秒 TTL 核对定时器为 15 秒，复现确定性执行回调，没有等待真实时间或连接网络。命令：`node tmp/full-audit-2026-10-29/repro-readiness-renewal.cjs`；结果：`readiness-renewal-repro.json`。
- **影响与边界：** 授权后的云同步跨过一次续期，就可能跳过其后本地工作的恢复；`src/server/authorized-work.js:4-19` 负责远程目录刷新及本地 Bilibili 重连。先前暂停的连接不能依靠这条恢复路径重新启动，直到新的授权状态变化、手动连接或重启。默认 TTL 为 10 分钟，触发也可以来自较长恢复或请求中的重新验证；不能把它描述成每次启动必现。没有验证真实桌面长时运行或上游连接。
- **最小修复方向：** 用稳定的授权生命周期与 owner 约束恢复，或在同 owner 续期后重新安排当前恢复；继续拒绝撤销、换账号和 dispose 后的旧工作，不简单移除所有检查。扩展 `test/desktop/desktop-readiness-controller.test.js`，结合真实 manager 的无重复 authorized 通知语义，覆盖续期保留恢复和真正换账号取消恢复。技术事实同步 `docs/reference/desktop/main.md`；用户步骤不变，指南无需新增操作。

### F-006 [P2] 本地场景缓冲丢弃已验证的大航海动作与陪伴天数

- **位置与调用链：** 客户端 `src/electron/scene-cloud-controller.js:331-345` 校验并保留 `guardAction` / `guardAccompanyDays`，main 将事件交给 `scene-runtime.receiveCloud()`；`src/scenes/cloud-display-buffer.js:17` 的 gift 白名单只保留购买等级等旧字段，丢弃这两个新字段。场景与本地弹幕展示从该缓冲读取，再由 `scene-danmaku-display.js` 交给现有主题卡片。
- **触发与证据：** 向真实 scene cloud controller 输入合成 SSE：购买等级 3、`guardAction: 'renew'`、`guardAccompanyDays: 360`。入口标准化事件保留两个事实，本地场景快照不再包含它们；数量、138 元总额和购买等级仍保留。复现使用真实两个模块、内存 ReadableStream 和替身远端，网络请求为 0。命令：`node tmp/full-audit-2026-10-29/repro-scene-guard-metadata.cjs`；结果：`scene-guard-metadata-repro.json`。
- **影响与边界：** 青雾、流霞等主题的本地场景输出丢失已知的续费/开通与天数，显示通用感谢或省略天数；`public/js/overlays/danmaku-mist.js:26-32` 可直接说明这一降级。服务器直接输出与本地合成预览不经过这个丢字段点，不能拿它们的正确显示证明本地实时链路完整。`docs/reference/frontend/overlays.md` 已要求 Electron 投影及场景缓冲保留这两个可选事实。
- **最小修复方向：** 在 buffer 的既有展示白名单保留已校验的两个字段，继续排除 UID、凭据和 raw packet，不重新推算动作或天数。扩展 `test/scenes/scene-display.test.js` 的展示字段用例，并让已有 controller 与 buffer 集成覆盖断言最终快照，而不只断言入口标准化事件。现有技术契约已要求保留，无需更改契约含义；用户操作与指南不变。

### F-007 [P2] 粉丝备份校验丢弃规范化身份，恢复后同一 UID 会重复建档

- **位置与调用链：** 客户端 `src/fans/profile-transfer.js:45-89` 调用 `profilePatch()` 校验身份，却返回原始 backup；`validation.js:22-32` 的身份校验会 trim UID。预览 `profile-transfer.js:98` 和写入 `:135` 又使用未经规范化的 identity。`fan-profile-store.js:179-184` 原样保存 JSON 与 identity key，后续平台事实按规范身份查找时无法匹配。
- **触发与证据：** 在隔离数据库导出一份完整备份，把其中 UID 改为两侧带空格的同一值，再预览并恢复。预览接受、恢复成功，存储值仍带空格；按正常 UID 查询返回 null。一份后续正常会员事实自动创建另一份档案，最终同一实际 UID 有两份资料。使用真实 backup/service/store/事实消费者与已有 fixture，未使用真实数据或网络。命令：`node tmp/full-audit-2026-10-29/repro-fan-backup-identity.cjs`；结果：`fan-backup-identity-repro.json`。
- **影响与边界：** 手工修改、外部产生或不规范的备份通过当前校验后，会使平台更新和私有资料分裂，既有身份冲突预览也按原值查找。正常由当前程序原样导出的规范备份未证明会自行产生此值；不涉及跨账号授权绕过。已有 transfer 测试验证正常身份恢复，未覆盖校验返回值与实际持久值一致性。
- **最小修复方向：** 在备份 owner 中建立一致的规范化结果供唯一性检查、预览和恢复共同使用，或在预览阶段拒绝非规范身份；保留原始依据、修订和合法 v1/v2 兼容，不直接用 `profilePatch()` 覆盖整份备份而丢失只读事实。扩展 `test/fan-profiles/fan-profiles-transfer.test.js`，验证规范 UID 查询和后续 membership 不产生第二份档案。现有身份契约含义不变，需核对恢复说明；用户指南操作无需改变。

### F-008 [P2] 非法备份屏蔽键可持久写入并使粉丝黑名单无法打开

- **位置与调用链：** 客户端 `src/fans/profile-transfer.js:87` 仅检查 suppressions 为不超过 300 字符的字符串，`:145` 原样写入；`src/fans/profile-service.js:371-374` 读取黑名单时直接 `JSON.parse(key)`。前端 `public/js/admin/fans/transfer-ui.js:94-118` 先读取整张名单才能提供解除屏蔽操作。
- **触发与证据：** 在其他字段完整的备份中放入 `suppressions: ['synthetic-invalid-identity-key']`。预览和恢复均成功，屏蔽键已持久化；再调用 `suppression-list` 抛 `SyntaxError`。后续 backup 仍导出该坏键，表明不是一次性响应问题。命令：`node tmp/full-audit-2026-10-29/repro-fan-backup-suppression.cjs`；结果：`fan-backup-suppression-repro.json`。复现使用隔离数据库和真实应用服务，无网络和真实数据。
- **影响与边界：** 一个格式错误的备份标记会阻止整张当前账号黑名单的读取，正常解除屏蔽入口也无法展示。当前程序自己产生的 key 是规范 JSON；前提是用户导入含坏键的备份，不能表述为普通浏览黑名单必然失败。现有备份/黑名单测试使用合法键，未覆盖这个结构缺口。此项与 F-007 分开：F-007 丢弃规范化值而破坏身份唯一性，本项缺少键结构校验而产生持续读取错误。
- **最小修复方向：** 恢复预览前校验每个键是合法的 typed identity 元组，并通过现有身份规则验证其结构与规范值；非法输入在任何快照或数据库写入前拒绝。扩展 transfer/blacklist 现有测试，断言拒绝坏键且旧屏蔽名单、快照数量和可读取性不变。不要用静默跳过坏标记的办法解除原有有效屏蔽。既有数据格式和用户操作不变，技术/用户说明无需增加新入口。

### F-009 [P2] 自动发送批次在切换账号或房间后继续使用新上下文

- **位置与调用链：** 客户端 `public/js/admin/danmaku-tool.js:159-200` 仅在开始时读取发送状态，之后每五秒提交一个只带 `message` 的请求；`:111` 的账号变更监听只刷新界面，不取消批次。`src/server/routes/bilibili-routes.js:119-122` 与 `src/server/api-context.js:149` 直接委托发送器；`src/bilibili/danmaku/sender-service.js:106-128` 排到执行时重新读取当前账号和房间。该路径未提供已有的 `assertSessionCurrent`，也没有批次归属校验。
- **触发与证据：** 首条使用合成账号 101、房间 201，随后在五秒等待中切换账号、房间或同时切换，并执行真实账号变更监听/刷新。三个场景均继续发完 15 条，其中后 14 条使用新的账号或房间；界面最终仍提示批次完成。不切换的对照全部使用原上下文，点击停止的对照只发一条。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/repro-danmaku-batch-owner.cjs`；结果：`danmaku-batch-owner-repro.json`。
- **影响与边界：** 用户为开始时确认的目标启动一次批量操作，切换后剩余消息却迁移到新目标。复现使用未改动的前端循环和真实发送服务，DOM、相邻控件、HTTP 桥和上游发送为替身，真实网络及真实弹幕发送均为 0；不是 Electron 或线上验收。AI、点歌/关键词自动回复走另一条已绑定会话的路径，不能将本项扩展为它们都缺少取消。现有发送会话测试通过，前端批次测试覆盖手动停止，均未覆盖批次期间的账号/房间切换。
- **最小修复方向：** 在该批次的 owner 绑定开始时确认的发送会话；账号或房间变化时终止剩余任务，并在排队后、实际发送前复核，复用已有会话校验能力。若需要携带上下文断言，应在服务器侧与当前授权状态核对，不能把客户端 UID 当授权凭据。扩展现有前端批次和发送会话测试，保留正常 15 条及手动停止对照；修复时同步技术参考和自动发送指南，说明切换会终止旧批次。当前未实施修复或修改接口。

### F-010 [P2] 网易云喜欢列表使用未生效的分页参数，重复首页后被当作加载完成

- **位置与调用链：** 客户端 `src/music/providers/netease-provider.js:168-174` 将喜欢列表的分页委托给 `getPlaylistTracks()`；`:223-234` 把 offset 写到 `/api/v6/playlist/detail` 的 `s`，直接返回 `playlist.tracks`，没有实际切页。`public/js/playback/content/loader.js:237-286` 每批请求 100 首，发现页签名重复即正常结束，再将所得列表写入当前平台缓存。
- **上游核对与复现：** 2026-10-29，从[网易云公开榜单](https://music.163.com/discover/toplist?id=3778678)取得公开歌单 ID 3778678，匿名读取同一[歌单详情接口](https://music.163.com/api/v6/playlist/detail?id=3778678&n=100&s=100)。`n=100`、`s=0/100` 的两次请求均 HTTP 200、业务 code 200，`trackCount=200`，却返回完全相同的 100 个曲目 ID。未登录、未携带 Cookie、未下载音乐或执行写入；结果在 `netease-public-probe.json`。将记录的页 ID/总数与合成标题回放到真实 Provider → lyrics service → ContentLoader 后，加载结果和缓存均只有 100 首，且没有错误或不完整标记；正确分页的对照得到并缓存 200 首。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/repro-netease-liked-pagination.cjs`；回放结果：`netease-liked-pagination-repro.json`，回放网络请求为 0。
- **影响与边界：** 偏移量并未在所测实际接口上获取下一批；当喜欢歌单返回同样的响应形态时，超过首批的歌曲被遗漏，结果又按正常完成缓存。尚未使用私人账号喜欢歌单验证，不能把公开查询和离线集成回放表述为所有账号必然截断于 100 首。现有 `test/music/netease-provider.test.js:15-27` 直接替换 `getPlaylistTracks()`，只断言 offset 传递；前端分页/账号失效测试也未覆盖该上游行为。接口参数传对与取得下一页是不同保证。
- **最小修复方向：** 在 Provider owner 按实际可验证的协议实现分页，例如使用已有曲目 ID 列表分批读取详情，或取得完整快照后切片；沿用当前账号、加载会话、响应大小和请求预算。保留前端重复页保护，不能通过删除保护来无限请求相同首页。扩展既有 Provider 与首页集成覆盖，使用相同首页、总数超过单批的固定夹具，断言后半列表可达且不重复。修复时同步 `docs/reference/backend/music/netease-provider.md` §7.7/§7.9 和前端加载说明，校正当前“上游实际分页”事实；操作入口不变，用户指南无需新增步骤。当前未实施修复。

### F-011 [P3，原P2] 背景上传的迟到响应把管理页预览改回已删除的旧版本

- **位置与调用链：** 服务器管理页 `public/streamer/manage.js:367-390` 的上传监听未锁定背景控件或协调在途请求，任何成功响应都会立即 `renderBackground()`；`public/streamer/manage-api.js:1-8` 和 `public/shared/http-client.js` 直接等待各自请求，没有统一顺序约束。`src/modules/song-page-background/service.js` 的 `saveBackground()` 每次成功替换后删除旧版本文件。`manage.js:343-358` 随后按响应 URL 更新预览与元信息，不重新确认当前保存值。
- **触发与证据：** 连续上传两次合成 PNG，让第一次保存成功后的响应延迟到第二次响应之后交付。第二次完成时预览与当前保存值一致；释放第一次响应后，预览改回第一份 URL，仍提示“背景已更新”，但当前数据库记录及文件都为第二份，第一份文件已不存在。顺序上传的对照始终一致。命令：`D:/Work/lira-server/runtime/node/node.exe D:/Work/Live/tmp/full-audit-2026-10-29/repro-server-background-editor-order.cjs`；结果：`server-background-editor-order-repro.json`。
- **影响与边界：** 请求响应乱序时，管理页显示的背景与实际直播/公开歌曲页保存值不一致，并引用已失效的版本。公开路由 `src/routes/public.js:239-244` 也会拒绝非当前版本；这来自代码和既有版本测试，复现本身未执行浏览器取图。复现加载未修改的完整背景控件代码段，使用真实保存/读取服务、隔离 SQLite 与临时文件；周围 DOM 和 API 传输为替身，真实网络请求为 0。没有证明线上已发生，也不涉及跨账号权限或数据库内容被旧响应回滚。现有背景和外观测试覆盖后端替换、失败保留及 HTTP 权限，未覆盖背景控件的并发响应顺序。
- **最小修复方向：** 由背景控件统一协调上传、删除及读取，复用已有操作锁/禁用与恢复模式，使同一控件的请求按确定顺序完成，必要时重新读取当前保存状态。不能仅以请求发起序号推断服务器最后提交值。扩展管理页现有夹具，断言响应交错后预览与最终保存值一致，并保留正常上传和失败后可重试的覆盖。此修复可保留现有 HTTP 与持久化契约；用户操作入口不变，指南无需增加步骤，核对处理中提示即可。当前未实施修复。

### F-012 [P2] 快速返回同一首歌时，旧歌词请求的失败会清空新歌词

- **位置与调用链：** 客户端 `public/js/playback/features/playback-controls.js:195-205` 在开始播放后异步加载歌词，完成时仅把 `track.id` 交给 `stateActions.setLyrics()`；`public/js/playback/state/actions.js:72-75` 只比较当前歌曲 ID，并把 null 转为 `{ lines: [] }`。`services/lyric-service.js:40-69` 将加载错误转为 null。上一首入口由 `core/event-handlers.js:104` 绑定，`playback-controls.js:341-354` 可正常从历史返回同一 ID，因此同 ID 不足以证明响应属于这次播放。
- **触发与证据：** 播放 A 时保留第一次歌词请求，播放 B 后通过真实 `playbackPrevious()` 返回 A。第二次 A 请求成功，当前歌词已为新结果；随后第一次 A 请求失败，当前歌词被清空，真实歌词发布服务先发布 `ready`，再发布空时间轴与更高 generation 的 `empty` 状态。A→B 后不返回 A 的对照保留 B 歌词。两个场景音频均继续播放。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/repro-playback-lyrics-return.cjs`；结果：`playback-lyrics-return-repro.json`。
- **影响与边界：** 在首次歌词尚未完成、快速切回同曲且旧请求失败的交错下，较新的成功歌词被旧失败覆盖；后续状态/时间轴版本机制会把这份错误状态作为新状态发送，不能在下游自动纠正。复现使用未修改的播放控制、状态动作、歌词控制与加载/发布服务，音频及 HTTP 响应为替身；没有真实网络、服务器、WebSocket 或 Electron 验收，不声称音频停止或线上已经发生。`src/music/lyrics-service.js:162-178` 只缓存完成结果，不把同曲全部请求合并为唯一完成；现有播放器集成夹具 `test/helpers/playback-app.js:194-198` 立即返回空歌词，没有覆盖这一延迟失败组合。
- **最小修复方向：** 由现有播放/歌词加载 owner 记录完成归属，接受歌词前核对当前有效加载，不能只比较歌曲 ID；保留正常失败反馈和同曲重播能力。扩展现有播放器或歌词加载夹具，覆盖 A→B→A 的旧失败、较新成功与不同歌曲对照，并检查发布的时间轴/状态。修复时核对 `docs/reference/frontend/playback.md` 的加载与结果归属说明；HTTP、持久化字段和操作入口无需变化，用户指南不需新增步骤。当前未实施修复。

### F-013 [P3，原P2] 全民 K 歌偏移保存的旧回包会擦除正在编辑的新值

- **位置与调用链：** 客户端 `public/js/playback/services/wesing-service.js:72-88` 将 input 写入 `pendingLyricOffsetMs`，change 再读取控件值发起保存；`:187-193` 在保存完成或失败时无条件清空 pending，并强制重画。`renderOffsetInputs(true)` 的 `:315-319` 即使控件正在编辑也会改写其值。`src/server/routes/wesing-routes.js:29-31` 将请求参数交给采集器保存，服务器无法恢复从未提交的新草稿。
- **触发与证据：** 通过实际初始化所绑定的数字输入框 input/change 处理函数，先提交 100 毫秒，保留其响应；在同一框中输入 700，尚未提交时释放前次成功响应。700 被改回 100，pending 变为 null；随后 change 发出的第二个请求仍为 100。先完成前次保存、再输入的对照发出 `[100, 700]`；交错场景为 `[100, 100]`，均未报错。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/repro-wesing-offset-draft.cjs`；结果：`wesing-offset-draft-repro.json`。
- **影响与边界：** 用户在保存等待期间继续调整偏移，会丢失较新的未提交输入，并可能收到与原值相同的成功保存结果。复现加载未修改的 WeSingService、真实绑定事件及共享歌词渲染模块，DOM、时钟和延迟 HTTP 为替身；未连接服务器、真实 K 歌、设备或 Electron，结果中的保存值是替身状态。已有 `test/playback/playback-wesing.test.js:172-197` 只验证 live status 不覆盖 pending，没有覆盖前次保存完成时的新草稿。本项与 F-011 的已提交背景预览乱序、F-012 的播放结果归属不同：这里首先丢失的是尚未提交的编辑值。
- **最小修复方向：** 在现有偏移编辑 owner 中区分已提交值与随后产生的草稿；仅由仍拥有该草稿的保存完成负责确认或回退，保留较新输入，避免旧完成强制重画活动控件。可参考同模块 `saveCachePath()` 的草稿确认方式，并覆盖多个在途保存与失败路径，不新增通用状态框架。扩展上述现有偏移测试，断言保存中编辑、旧完成及后续 change 保留并提交新值，保留正常顺序对照。修复时核对 `docs/reference/frontend/playback.md` 的参数保存说明；HTTP、持久化字段和操作入口可保持，用户指南无需新增步骤。当前未实施修复。

### F-014 [P3] 管理列表的迟到轮询会覆盖禁用后的新状态

- **位置与调用链：** 服务器 `public/admin/app.js:33-43` 的读取请求序号只保护连接状态提示，仍将旧结果返回调用方；`:276-285` 的 `loadStreamers()` 无条件替换主播和监控列表。五秒轮询从 `:421-431` 进入；`:609-617` 的禁用操作通过 `refreshAfterAction()` → `refreshAll()` 另读新列表。`pendingMutations` 只阻止启动新的轮询，不能阻止操作前已发出的读取稍后覆盖新状态。
- **触发与证据：** 冻结一次操作前的轮询响应，其内容为 active；随后通过真实页面 click 处理函数提交 disabled，并完成操作后的新读取，此时列表为 disabled。再释放旧轮询，列表及按钮改回 active 对应的“禁用”，连接提示仍为“数据加载正常”，替身后端仍为 disabled。先完成轮询再禁用的正常顺序对照保持 disabled；两种场景各只有一个 PATCH。命令：`D:/Work/lira-server/runtime/node/node.exe tmp/full-audit-2026-10-29/repro-admin-list-stale-read.cjs`；结果：`admin-list-stale-read-repro.json`。
- **影响与边界：** 操作已成功时，管理员仍可能看到过期账号状态与相反的操作按钮；下一次成功轮询可纠正。没有后端授权恢复、跨租户访问或自动二次写入证据，因此按低优先级的界面一致性问题记录。复用现有 `test/admin-live-state.test.js` 的 VM 夹具，加载未修改的 HTTP、管理页面及列表脚本；DOM、请求与后端状态均为合成替身，无网络或真实账号操作。现有请求序号测试只断言连接提示，详情页的独立序号也不保护全局列表。
- **最小修复方向：** 在现有列表读取 owner 中确认结果仍属于最新请求，并在操作结果刷新时使较早读取失效；继续保留正常轮询和失败反馈，不增加通用调度层。扩展上述现有测试，断言操作前轮询迟到不能覆盖操作后的新列表，同时保留正常顺序对照。修复时核对管理页相关验收说明；HTTP、持久化和用户操作入口无需改变。当前未实施修复。

### F-015 [P2] JSON 字符串弹幕资料会把已知舰长改成已确认非大航海

- **位置与调用链：** 客户端 `src/bilibili/utils/user-meta-extractor.js:35-40` 直接将 `info[0][15]` 交给只接受对象的 `readFirstObject()`，没有像头像/表情解析器一样解码 JSON 字符串；`:41-64` 仍会依据旧粉丝牌元组的目标 UID 产生已核验的缺省身份。`MessageHandlers.handleDanmaku()` → `roomIdentityFromMeta()` → `UserInfoService.ingestHint()` 将其作为当前房间事实写入缓存，`src/bilibili/danmaku/feed-buffer.js:27-44` 再将错误等级投影给弹幕消费者。现行 `docs/reference/backend/bilibili/protocol.md` §6.1 明确允许 `danmakuOptions` 为对象或 JSON 字符串。
- **触发与证据：** 使用现有用户元数据测试中的情况：观众佩戴其他房间的粉丝牌，`user.guard.level=3` 表示本房间舰长。保持 UID、房间、头像及全部字段一致，对象形式交付 `{guardVerified:true, guardLevel:3}`；只将扩展资料改为 `JSON.stringify()` 后，头像仍正确，却交付 `{guardVerified:true, guardLevel:0}`。先交付对象再交付字符串时，真实用户信息服务中的缓存也从已知 3 改为已知 0，真实 feed 输出同步变为 0。命令：`node tmp/full-audit-2026-10-29/repro-danmaku-json-identity.cjs`；结果：`repro-danmaku-json-identity.json`。
- **影响与边界：** 受支持的消息格式变化会错误降低客户端身份，影响弹幕输出及读取该快照的消费者；已有缓存不能防止这次覆盖。这里只使用合成消息、当前生产解析/处理/缓存/feed 模块并暂时抑制控制台诊断，未连接 Bilibili 或 Electron，也未估算上游出现频率。服务器拥有独立身份解析与权限判断，没有服务器授权、跨租户访问或礼物账本被改写的证据。现有 26 项解析/身份测试通过，但 JSON 用例只检查头像，舰队身份用例只提供对象，没有覆盖两者组合。
- **最小修复方向：** 在现有元数据解析 owner 中支持同一 JSON 对象形式，继续保留当前房间目标匹配及 unknown/已知缺席的区别，不另建身份缓存。扩展 `test/bilibili/bilibili-user-meta.test.js`，验证同一资料的对象/字符串交付等价，以及已有舰长身份不会因格式转换被清为已知 0；保留其他房间粉丝牌排除和正常缺席用例。修复时核对上述协议参考和弹幕身份参考；现行格式约定已正确，用户操作及指南无需新增步骤。当前未实施修复。

### F-016 [P2] 成组设置分条提交，操作报错后仍留下部分变更

- **位置与调用链：** 客户端 `src/server/opening-service.js:33-38` 在文件发布后分别调用 `settings.set()` 写入媒体文件名和显示名；实际 API context 将该方法绑定到 `src/storage/settings-store.js:162-168` 的单条写入，两条设置没有共同事务。`POST /api/opening/music` 经 `opening-routes.js:10-16` 进入此提交点；`http-server.js:151-155` 与 `opening-media-http.js:25-29` 只允许读取当前选中的文件，因此先写入的新文件名会立即撤销旧地址。
- **触发与证据：** 在临时真实 SQLite 中先选择一个音频，再用临时 trigger 让下一次 `openingAudioName` 写入失败。通过带测试管理令牌的真实本地 HTTP 上传合法 multipart：返回 500、`ok:false`，但当前文件名已经变化，显示名仍是旧值，广播次数为 0；旧文件仍在磁盘，其地址却返回 404，新选中文件返回 200。正常写入对照返回 200、新显示名和一次 settings 广播。相同失败条件下，现有批量设置事务的对照保持两项值不变。命令：`node tmp/full-audit-2026-10-29/repro-opening-media-settings.cjs`；结果：`repro-opening-media-settings.json`。
- **影响与边界：** 设置写入失败的请求仍改变了活动选择，而消费者没有收到相应广播，随后使用旧地址的读取会失败。没有旧文件被删除或数据库损坏的证据，也未证明已缓冲的音频会立即中断。复现使用生产 HTTP/路由、设置 store 和媒体服务，以及两套新建数据库；许可状态为夹具，音频为合成字节，未启动 Electron、播放声音或使用用户数据。本次直接验证经典音频上传；其他样式/人物媒体由相同保存 helper 处理。现有 17 项相关检查通过，但文件失败用例只覆盖 rename 发生在任何设置写入前的情况，上传用例的内存设置替身没有覆盖第二键写入失败。
- **同类调用面补证：** `src/storage/theme-store.js:183-194` 的预设应用也循环调用同一单键 setter，`theme-routes.js:33-37` 在成功后才广播。该 API 仍在正式路由表与当前参考中。临时真实 SQLite 中保存合法外观快照，再让第二项 `themeAccent` 写入失败：生产路由 handler 返回 400、`ok:false` 且未广播，但 `themePrimary` 已切换、`themeAccent` 仍旧，连接重开后混合状态仍在。同一故障下现有批量 setter 完整回滚；解除故障后正常应用返回 200 并广播一次。正常保存/同名覆盖/改名/删除、播种幂等和字段白名单也通过。结果见 `repro-theme-preset-atomicity.cjs/json`。这是同类提交缺口的另一处调用面，合并补证于 F-016，不另计新根因。复现调用生产路由 handler 与合成 context，没有真实 HTTP、桌面或视觉验收；当前管理界面的静态预设卡片另走批量设置保存，未证明该界面存在此故障。
- **最小修复方向：** 将文件名与显示名通过现有 `settings.setMany()` 作为同一次选择提交，成功后再广播，保持既有媒体文件保留策略。主题 API 应先收集允许的预设字段，再一次调用现有 `settingsStore.setSettings()`，保持 `appliedKeys` 与成功后广播的既有约定。扩展 `test/overlays/opening-media-store.test.js` 的持久化失败覆盖，并通过上传/读取入口断言失败时原选择、原名称和旧地址保持可用，同时保留正常替换对照；主题应用也应有中途失败/正常应用的存储回归。修复时核对 `docs/reference/backend/server-core.md` 的媒体职责和 `docs/reference/backend/api.md` 的上传、主题应用约定；字段、URL、schema 和用户操作步骤可保持。当前未实施修复。

### F-017 [P3] 本地音频清单写盘失败后，相同文件重选成功却不再持久化

- **位置与调用链：** 客户端 `src/electron/local-media-access.js:43-49` 先把新路径加入内存集合，再调用 `persistAllowedPaths()`；写入抛错时没有恢复集合或保留待写状态。`src/electron/ipc/music-ipc.js:40-60` 的选文件入口直接调用此 owner，后续重选同一路径因 `changed=false` 跳过写盘，返回 `{ok:true, files}`。播放器 `public/js/playback/local/manager.js:50-93` 消费这一结果并解析本地 URL。
- **触发与证据：** 在独立临时目录先保存一个原有音频授权，再让选中第二个文件时的清单写入仅失败一次。经注册了实际主窗口来源门禁的生产 IPC handler 调用：第一次抛 `EACCES`，内存已允许该文件；错误解除后重选返回成功，当前 URL 解析与最近文件列表也包含它，但清单总共只尝试写入一次，磁盘仍不含新路径。用同一数据目录重新创建清单 owner 后，该文件解析为 `not-allowed`，最近历史不再包含它；正常写入对照可恢复。命令：`node tmp/full-audit-2026-10-29/repro-local-media-persistence.cjs`；结果：`repro-local-media-persistence.json`。
- **影响与边界：** 临时写入故障后的重试给出成功结果，却没有恢复跨启动授权，用户之后需要再选文件。原有授权仍保留，音频文件未被删除；没有权限绕过、音频内容丢失或真实应用重启验收的证据。复现使用真实临时文件和生产授权/IPC 模块，窗口、对话框与一次写入异常为替身，冷加载由重建 owner 验证；未控制用户的 Electron。40 项相关既有检查通过，但没有覆盖持久化失败后重选同一文件。
- **最小修复方向：** 在清单持久化成功后发布新内存集合，或在失败时回滚/保留待写状态，让同一路径的重试仍能提交。扩展现有 `test/desktop/local-media-access.test.js`，验证一次失败、相同文件重选、磁盘内容及重新创建 owner 后的可用性，并保留原有路径授权对照。继续遵守逐文件 allowlist、扩展名和精确来源约束；无需新服务、格式、权限或用户操作步骤。修复时核对 `docs/reference/desktop/main.md` 的持久化清单说明。当前未实施修复。

### F-018 [P2] 多工作表 XLSX 的导入结果随 ZIP 条目顺序改变

- **位置与调用链：** 客户端 `src/music/song-file-codec.js:16-29` 在 ZIP 目录选择回调中记住首个 `xl/worksheets/sheet数字.xml`，没有读取 `xl/workbook.xml` 的工作表列表和关联关系。新增入口 `src/server/routes/song-routes.js:138-151`，以及预览/应用入口共用的 `readUpdateInput():25-29`，都直接消费这一结果。工作表应通过工作簿引用定位；[Microsoft 官方读取说明](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/how-to-get-worksheet-information-from-a-package)展示了相应的工作簿列表结构，不能据 ZIP 物理顺序推断页签。
- **触发与证据：** 由程序现有导出器生成合成歌曲工作表，补齐第二表的内容类型与关联，在工作簿中将“当前歌库”排第一、“旧表”排第二。生成两份文件，所有部件名和内容逐项完全相同，仅改变 ZIP 条目顺序。实际解析器在新增模式与 `preserveMissing:true` 模式下，前者读出“旧表歌曲”，后者读出“当前歌库歌曲”；单表对照正常。独立 openpyxl 读取两份文件均得到相同页签顺序和首表歌曲。命令：`node tmp/full-audit-2026-10-29/repro-xlsx-worksheet-order.cjs`；结果：`repro-xlsx-worksheet-order.json` 与 `repro-xlsx-worksheet-order-independent.json`，两份合成文件位于 `xlsx-worksheet-order/`。
- **影响与边界：** 有多个歌库表或归档表的有效 XLSX 可能导入另一张表，打包工具改变条目顺序也可能改变结果。预览仍可让用户发现内容不符；没有实际执行用户歌库替换、控制 Excel 或证明数据已经丢失。本次是生产编解码器及调用链证据，不是完整桌面操作验收。32 项既有资源边界检查全部通过；其中“first worksheet”用例只验证首个匹配 ZIP 条目的选择，没有包含工作簿列表和关联关系，不能覆盖此语义差异。独立读取器提示默认样式缺失来自原导出夹具，不影响本次歌曲与页签核对，未将其另报为缺陷。
- **最小修复方向：** 在现有编解码 owner 中按工作簿列表及内部关联定位要导入的首个工作表，保持现有解压、条目数与文本额度。扩展现有 `test/songs/xlsx-codec-limits.test.js` 或 `song-file-codec.test.js`，验证工作簿首表与文件编号不同、同一部件集合改变打包顺序仍导入同一表，以及单表对照。同步 `docs/reference/backend/music/services.md` 的选择语义；用户说明应明确多表时读取哪一表，无需引入完整表格框架或新服务。当前未实施修复。

### F-019 [P3] 旧默认清理会在重启时删除当前保存的规则文案

- **位置与调用链：** 客户端 `src/storage/settings-migrations.js:10-24` 按两个固定字符串清空 `overlayRule3/4`，没有一次性迁移检查点；`settings-store.js:50` 每次 bootstrap 都调用它，正式启动 `src/server.js:164` 进入该流程。当前点歌板主题仍通过 `queue-theme-config.js:8-11,32-36` 收集这些可编辑字段，经 `component-settings-save.js:12-17` 的 `/api/settings` 保存；服务接受这些字符串，没有将它们定义为禁用文案。
- **触发与证据：** 在独立临时 SQLite 新库完成启动迁移，四个现有检查点均为当前版本。通过生产 `applySettingsPatch` 和真实 settings store 保存规则 3“同一观众 10 秒冷却”、规则 4“按队列顺序演唱”，返回实际变化键，关闭并重开连接后原文仍在库中。随后 bootstrap 将两项持久值清空；重新保存，再重开和启动仍清空。相同文字放在规则 1/2、以及规则 5 的普通自定义提示均保留。首次旧库迁移对照仍能正常清除历史默认。命令：`node tmp/full-audit-2026-10-29/repro-legacy-rule-clearing.cjs`；结果：`repro-legacy-rule-clearing.json`。
- **影响与边界：** 新库或已升级用户主动保存这两段合法提示后，重启无法保留，影响限于这两个提示字段。复现使用生产保存服务、校验和启动迁移，监控/广播回调为替身；只操作合成数据库并已清理，没有控制用户桌面、实际发送弹幕或进行完整界面重启验收。8 项现有 bootstrap 检查全部通过，但重复启动用例没有覆盖当前用户主动保存这两段文字，不能据其通过排除此问题。
- **最小修复方向：** 将旧文案清理纳入明确的一次性迁移，完成后的保存不再按内容重新判定为旧默认；检查点与清理在现有启动事务中一起提交，保留失败回滚和重试。修复时按历史升级条件区分新库与旧库，不能仅凭文字猜测当前用户意图。扩展 `test/settings/settings-bootstrap.test.js` 的新库保存、重开、重复保存及旧库首次迁移对照，并更新 `docs/reference/backend/storage.md` 的迁移检查点说明。用户编辑步骤可保持。当前未实施修复。

### F-020 [P3] 大航海冲突处理的迟到回包会重新打开已离开的档案

- **位置与调用链：** 客户端 `public/js/admin/fans/index.js:490-495` 将 `resolve-membership` 的返回值直接赋给当前档案，随后刷新列表并显示详情；返回列表的 `:317-325,372-374`、切换归档的 `:329-341,376-380` 已清空选择并递增选择代次，但此分支不检查它。同文件“特别关注”的 `:523-530` 已核对代次及档案 ID。`docs/reference/frontend/app.md:87` 明确由这一 owner 拒绝迟到显示。
- **触发与证据：** 在实际模块和现有 UI 夹具中，通过真实临时 SQLite 建立待核实的大航海冲突，点击“采用这次记录”，只延迟已成功处理的 IPC 回包。此时返回列表不发新请求，详情已清空；释放回包后，原档案被重新打开。切到“已归档”的第二场景同样重开仍属于当前范围的原档案，列表请求和归档按钮却保持归档范围。两场景各只写一次、原冲突正确解决、另一份档案不变。立即回包后再离开、延迟特别关注回包和处理失败三个对照均不重开。命令：`node tmp/full-audit-2026-10-29/repro-fan-membership-selection.cjs`；结果：`fan-membership-selection-repro.json`。
- **影响与边界：** 用户离开详情后仍可能被迟到结果带回旧档案，归档范围还会与详情不一致。未发现写错档案、丢失资料或跨账号访问，因此按界面一致性问题记录。复现复用现有 DOM/实际前端模块与业务服务，合成 IPC 交付屏障；没有测量真实 Electron 调度或发生频率。主进程处理同步执行，返回列表是本地动作，本例不要求两个主进程写入倒序。现有27项前端检查全部通过，其中迟到保存检查覆盖特别关注，尚未覆盖冲突处理；弹窗保存期间的取消/关闭锁定已提供反证，不另报竞态。
- **最小修复方向：** 在现有选择 owner 中沿用代次和档案 ID 检查，只有仍属于当前选择的处理结果才能替换详情；保留已成功的大航海处理和必要列表刷新。扩展 `test/fan-profiles/frontend-fan-profiles.test.js` 的现有延迟回包夹具，覆盖返回列表、切换归档及正常顺序对照，不新增状态框架。修复应满足现行前端归属契约，IPC、存储字段及用户步骤无需变化。本项独立于服务器管理列表轮询的 F-014，没有共享修复点。当前未实施修复。

### F-021 [P2] 下拉框搜索回车会误提交外层表单

- **位置与调用链：** 服务器 `public/shared/select-menu.js:318-331` 在原表单内创建搜索 input，`:374-389` 在焦点仍处于搜索框时提前返回，Enter 没有经过 `preventDefault()`。`public/admin/index.html:391-406` 的发码表单使用此搜索单选；`activation-target.js:1-26` 默认值为0，并保留此前选中的有效主播。`public/admin/app.js:507-518` 接到原生 submit 后立即按当前 select 值 POST `/api/admin/activation-codes`。客户端 `public/js/shared/select-menu.js:327-342` 有相同分支；实际点歌板主题 `queue-theme.html:8,42,514` 将字体搜索和保存放在同一表单，`queue-theme-view.js:45` 的 submit 经 `component-save-feedback.js:3-6` 保存有修改的草稿，`theme.js:31` 发起设置请求。
- **触发与证据：** 加载实际管理页、脚本和共享控件，用既有浏览器夹具提供两个合成主播。打开下拉搜索“Audit Beta”，直接按 Enter：默认状态发出 `{streamerId:0}`，预先选中 Alpha 时发出 `{streamerId:1}`；两场景均触发一次表单提交、没有 input/change 选择事件，搜索结果 Beta 从未被选中。先用方向键聚焦 Beta 再按 Enter 的对照正确选中2，只产生一对选择事件、没有提交或 POST；Escape 对照也不提交。命令（服务器目录）：`node scripts/run-with-node.cjs D:/Work/Live/tmp/full-audit-2026-10-29/repro-select-search-submit.cjs`；结果：`select-search-submit-repro.json`。
- **客户端桌面验证：** 复用现有隔离 Electron 夹具，保留真实 preload、请求鉴权、sandbox 和 context isolation，数据、会话及 SQLite 指向仓库 tmp；匿名 `/admin` 为401，桌面授权状态正常。加载实际主题片段与 owner，用正常设置快照初始化，再通过真实控件将标题字号30改为31。搜索“得意黑”后直接 Enter：触发一次 submit 并发出保存字号31的设置 POST，字体仍为原来的 Microsoft YaHei；此前没有保存请求。Escape 不增加提交，方向键再 Enter 只选中字体，明确点击保存才提交包含新字体的第二份草稿。两个设置请求均被拦截返回合成500，没有到达后端或真实用户设置。四场景与截图记录在 `client-select-enter-stage-76.json`，不计入现有测试数量；自有 Electron 已关闭，54988端口释放。
- **影响与边界：** 搜索菜单的键盘操作可变成未打算发起的凭据生成或草稿保存请求；前者沿用搜索前的目标或默认新主播目标，后者可能提前提交其他尚未确认的主题修改。服务端按已选目标正常处理，不是授权或租户隔离绕过。所有发码请求均被隔离夹具拦截返回400，没有执行后端发码、签发或使用真实凭据。服务器12项共享菜单/价格菜单、客户端7项菜单生命周期和3项展示板检查全部通过，但原搜索用例先把焦点移到选项再回车，没有覆盖搜索框自身的隐式提交。客户端只确认上述有修改草稿的主题表单，不扩大到全部字体页面；同根合并，不新增编号，也不同于 F-014/F-020 的迟到结果归属。
- **最小修复方向：** 在两端现有共享控件各自的搜索键盘处理处拦截 Enter 的默认表单提交，保留文本输入、方向键选择及显式操作按钮；不要在授权 API 或所有页面全局禁用 Enter。扩展现有菜单测试及实际授权页、桌面主题表单夹具，覆盖默认目标、已有目标、未保存草稿、搜索框 Enter 和方向键选择对照，断言没有额外写请求。核对服务器 `docs/requirements/shared-select-menu.md:32-34` 和授权页验收；沿用两端既有事件契约，API、持久化与用户操作步骤无需改变。当前未实施修复。

### F-022 [P3] 仿推特样式把协议中的 ISO 时间当成数值，消息时分不显示

- **位置与调用链：** 服务器 `public/overlay/danmaku-twitter.js:144-151` 的 `identityMeta()` 用 `Number(item.timestamp)` 再构造 Date；普通消息、礼物和 SC 均经 `fillIdentity()` 调用它。公开 OpenAPI 的 `DanmakuEvent`、`GiftEvent`、`SuperChatEvent` 都要求 `timestamp` 为 `string/date-time`。实际生产投影 `src/lib/bilibili-danmaku.js:196,223,289-292` 输出 ISO 字符串，`public/overlay/app.js:234,414` 原样传入。ISO 字符串转 Number 得到 NaN，合法时间被当作缺失值。
- **触发与证据：** 在隔离 Chromium 中加载实际服务器 overlay HTML、CSS 和模块，使用受控 EventSource 交付三个真实纯投影函数的合成输出；没有连接账号或真实 SSE。固定时区为 Asia/Shanghai，时间为 `2026-10-30T04:34:00.000Z`：普通弹幕、礼物、SC 的元信息分别只有 `@Spectator` 或 `@Gift`，没有时分。相同聊天事件仅改成数值 `1793334840000` 就显示 `@Spectator · 12:34`；等价的带偏移 ISO 字符串仍缺时间，非法时间对照仍被隐藏。六场景断言通过、页面异常为0，正文、礼物数量和金额正常；结果及已检查截图为 `twitter-iso-time-stage-81.json/.png`，自有 context/browser 已关闭。
- **影响与边界：** 正常公开事件在此样式下丢失预期的消息时间标签，属于参数格式与显示逻辑不匹配；没有证据表明正文、排序、结算金额或持久记录改变。本批五款样式的现有浏览器测试全部通过，但只检查内容、节点保留、撤回和清理，没有断言消息时间。额外六场景不计入现有测试数量。仅确认服务器旧在线源，不因客户端有同类样式而扩大范围。
- **最小修复方向：** 在现有仿推特元信息格式化处按协议解析 ISO 日期，保留需要的数值兼容和非法时间不显示行为；不改变 SSE 字段、后端生产格式或引入时间库。扩展现有 `e2e/overlay-added-styles.spec.js` 的 Twitter 场景，用固定时区/时间断言 ISO 时间标签及数值对照。现行协议已经正确，技术契约与用户步骤无需改变。当前未实施修复。

### F-023 [P3] 同一密钥自动保存后，模型查询和已显示的选项会静默失效

- **位置与调用链：** 客户端 `public/js/admin/ai-assistant-settings.js:308-317,329-342` 将密钥输入框当前值纳入模型查询的服务签名，`351-356` 的选项回调也复用该签名。700 ms 自动保存成功后，`104-120` 调用 `ai-assistant-config-view.js:90-94,270-275`，及时清空已提交的密钥明文输入；有效凭据没有被用户更换，但签名中的草稿从原值变成空串，后续 `isCurrent()` 为 false。
- **触发与证据：** 使用现有 `ai-settings-fixture.js` 加载实际三个前端模块，控制合成响应与虚拟 700 ms 时钟。新密钥保存先完成、模型成功后返回时，两个有效候选被丢弃，选项为0，按钮已可点击但提示仍为“正在从当前模型服务获取可用模型…”。模型先返回、保存完成后再点第二项时，两个候选仍可见，点击却不改变当前模型或关闭菜单。保存前完成选择、使用已保存密钥进行同样延迟查询的对照均正常；真正换成另一密钥的负对照仍正确拒绝旧结果。五组断言通过，证据为 `repro-ai-model-secret-commit-stage-87.cjs`、`ai-model-secret-commit-stage-87.json/.log`，没有真实网络、账号或密钥。
- **影响与边界：** 影响 API 模式下“输入新密钥后立即获取模型”的现有可用操作，可能留下过时的获取提示或无响应候选；重新获取或手动填写可恢复。当前指南 `usage-guide-ai.html:103-112` 先等“已保存”再获取的路径可避开，因此列为低优先级。未发现密钥丢失、越权、错误账号调用或后端查询错误；未测真实桌面出现频率。现有50项设置测试通过，但草稿查询、提交后清空及旧请求隔离分别测试，未覆盖同一密钥提交与查询的重叠顺序；五组诊断不计入50项。
- **最小修复方向：** 在现有保存与模型查询 owner 间区分“同一凭据已提交”与用户真正更换服务，使正在处理的查询和候选项使用一致的凭据代次；真正失效时同步结束加载提示。仍须保存确认后及时清除密钥明文，并保留更换地址、协议、账号或密钥时拒绝旧结果的保护，不能简单删除 `isCurrent()` 或把明文留在输入框。扩展现有草稿查询/密钥测试，覆盖先后两种完成顺序及真正换密钥对照；保持 API、持久化和当前指南步骤。当前未实施修复。

### F-024 [P3] 首页同页返回导航后，语言状态与正文、控件不同步

- **位置与调用链：** 服务器 `public/site/public-locale.js:85-88` 在 `popstate` 时只重新读取语言并调用本模块的 `renderLocale()`；后者更新根元素、`data-en` 文案和公开工具链接。首页自身使用 `data-i18n`，其词典、标题、描述、语言下拉与 CN/EN 提示由 `site.js:163-190` 更新，但目前只在初始化和下拉 change 时应用，没有接入历史导航的语言变化。
- **触发与证据：** 在自有隔离测试服务器返回200的实际首页，用独立 Chromium 上下文打开 `/?lang=zh-CN`，点击首屏“查看客户端功能”产生 `#scene-songs` 历史项，再通过现有下拉选择 English；语言模块将当前项改为 `?lang=en#scene-songs`。正常执行浏览器返回后，URL、共享语言和 `html.lang` 均为 zh-CN，工具链接也带 zh-CN，但下拉仍为 en、提示 EN、标题为 `LIRA · Live tools`，正文和描述仍为英文。以英文起始、切中文后返回也得到对称的错配。共保存八个状态快照，包含正常选择、前进对照及刷新后恢复一致；页面异常为0，截图已检查。证据为 `site-locale-back-stage-111.json/.png` 和 `qa-site-locale-stage-111.md`，没有修改 DOM/派发伪造历史事件或接触真实账号。
- **影响与边界：** 现有锚点、语言下拉与浏览器返回即可触发，页面显示的语言、辅助技术语言标签及后续工具链接语言出现分歧；刷新或再次切换语言可恢复，列为低优先级。未发现认证、业务数据或设置落盘损坏，也未证明其他浏览器引擎或生产站点已出现。现有两份首页/导航文件20项通过，其中语言用例覆盖直接选择与重载，导航用例覆盖跨页面返回，未覆盖本次同页历史与语言替换的组合；八个诊断快照不计入20项。
- **最小修复方向：** 将历史导航得到的语言变化交付给已有首页翻译 owner，使词典、元数据、控件和链接走一致的语言应用流程；保留 URL 语言优先级与 `emit:false` 的递归保护，不增加第二套翻译状态或合并职责不同的模块。扩展现有 `public-homepage-preferences.spec.js`，覆盖双向语言切换后的同页返回，并核对前进、刷新及各呈现字段一致。现行同步语言要求无需改变，也无需新增用户操作步骤；当前未实施修复。

### F-025 [P3] 可选自动打开管理页的异步启动失败未按预期降级

- **位置与调用链：** 客户端 `src/server/admin-launcher.js:9-15` 在 Windows 上调用 `spawn('cmd', ...).unref()`，但没有监听子进程的 `error` 事件；`19-21` 的同步 `try/catch` 不能接收异步启动错误。实际调用位于 `src/server.js:412-422`，服务进入 ready 后、显式开启 `AUTO_OPEN_ADMIN=1` 时执行。
- **触发与证据：** 使用 Windows 原生 Node 24.21.0，在自有隔离子进程中把 PATH 和工作目录指向空测试目录；先确认 `cmd` 查找返回 ENOENT，才调用实际 helper，保证没有启动浏览器。同一环境关闭选项时退出0，开启时退出1，stderr 为 `Unhandled 'error' event` / `spawn cmd ENOENT`，helper 没有输出现有手动降级日志。结果与脚本保存在 `admin-launcher-stage-118.json/.log`、`repro-admin-launcher-stage-118.cjs`；仅修改复制给测试子进程的环境，没有改系统 PATH、操作系统文件或用户应用。
- **影响与边界：** 可选的自动打开操作存在使已启动服务异常退出的路径，而非走已有降级提示；触发依赖显式开启及命令无法启动，按低优先级记录。默认关闭对照正常，没有证据表明正常 Windows 环境、真实 Electron 会话或生产用户已经遇到；不涉及远程命令注入、认证放宽或资料损坏。相关运行时/参数29项和抽奖服务/路由11项现有测试均通过，没有覆盖本次原生启动失败。预检与两个诊断对照不计入现有测试累计。
- **最小修复方向：** 在现有 launcher 接收子进程异步 `error` 并复用手动提示，保留同步异常处理及 detached/unref 行为；不新增全局异常吞噬器或启动框架。扩展已有 `server-modules.test.js`，覆盖异步启动失败及关闭选项对照。HTTP/IPC、持久化和用户步骤不需改变；当前未实施修复。

### F-026 [P2] 实时状态重建规则列表后，重新选择礼物只修改已移除的旧节点

- **位置与调用链：** 客户端 `public/js/admin/overtime-gift-picker.js:192-195,359-362` 保存并回传原规则 DOM 节点；`overtime-status-view.js:44-45` 在表单尚未标脏时根据新快照重建列表，`overtime-rule-editor.js:328-339` 随后仍修改旧节点并标脏。`overtime.js:25-30,92-94` 提示选择成功，保存却从当前列表读取。生产礼物结算的 `overtime-service.js:246-249` 发布含 `rules` 的完整快照；`admin/state.js:80-86` 接受较新 revision 后交给同一事件处理链，触发条件可由正常实时更新满足。
- **触发与证据：** 在自有隔离 Electron 夹具中，使用真实 preload、请求鉴权和原加班机 HTML/模块；将夹具专用入口切到加班机，API 与事件使用合成数据。保存的“舰长”规则处于干净状态时打开“重新选择礼物”，交付 revision 2 的同规则快照，再点击“提督”：原节点 `isConnected=false`，旧节点变为 `guard-2`，当前列表仍为 `guard-3`，提示却为“已选择 提督，原规则设置已保留”。点击保存发出的实际请求体仍为“舰长”及 `guard-3`，固定加时300秒未变。请求被夹具拦截成功响应，没有写真实后端。无中间更新的对照会显示并提交 `guard-2`；事先产生未保存草稿的对照保留原节点，也提交 `guard-2`。三类结果与输入见 `overtime-reselect-state-stage-125.json`、`overtime-reselect-inputs-stage-125.json`，本机截图已检查，页面异常为0。
- **影响与边界：** 重新选择可能被静默丢弃，提示与实际保存对象不一致；未保存草稿保护本身仍有效，缺口在弹窗开启与规则重建之间。已有7项礼物选择器检查通过，但夹具替换了状态视图和规则编辑器，没有覆盖真实模块之间的节点失效。独立诊断不计入7项。保留 context isolation、sandbox 和关闭 Node integration，匿名管理页仍为401；使用独立数据/会话/SQLite目录，合成授权到期后只通过夹具已有续期入口恢复。未连接真实 Bilibili、未验证完整生产启动或真实 WebSocket 网络交付，不涉及越权或历史结算损坏。
- **最小修复方向：** 在现有选择器与规则列表 owner 之间校验、同步目标生命周期，使确认操作作用于当前列表中的同一规则；目标已删除或变化时明确提示，不能修改脱离列表的节点后仍报成功。保留真实草稿保护、完整礼物身份及原规则参数，不以永久标脏或禁止所有实时更新替代目标检查。扩展现有选择器/规则编辑集成覆盖，包含弹窗期间快照、无更新和已有草稿对照，并核对可见字段与保存请求一致。API、持久化格式及用户操作步骤无需改变；当前未实施修复。

### F-027 [P3] 同一账号重新登录后，旧外观回包会使后续保存持续被拒绝

- **位置与调用链：** 客户端 `public/js/admin/danmaku-overlay-settings.js:65-70` 等待读取后，只比较账号字符串便替换 `binding`；`component-config-controller.js:80-81` 随后虽会拒绝旧 generation 的配置，却不能撤销此前的绑定赋值。下一次保存经 `danmaku-overlay-settings.js:72-76` 提交旧绑定，`src/server/danmaku-appearance.js:29-33` 正确返回 `DANMAKU_OWNER_CHANGED` / 409。
- **触发与证据：** 让旧登录的成功读取回包延迟，退出后重新登录同一账号，先接收新登录的回包，再交付旧回包。真实未修改的前端设置/控制器与外观服务在隔离复现中提交 generation 1，而当前 owner 已是 generation 2；保存返回 false，草稿保留 `bubble`、存储仍为 `signal`。直接重试仍失败；手动重新读取后保存成功。正常顺序对照使用 generation 2 并成功。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/agent-client-131/repro-appearance-binding.cjs`；结果：`agent-client-131/appearance-binding-repro.json`，主代理复核执行同样通过。
- **影响与边界：** 特定迟到回包顺序下，新登录后正常编辑无法保存，需额外重新读取恢复。配置本身被控制器代次屏障保护，服务器也拒绝旧绑定，没有跨账号写入或已保存配置丢失。普通 token 续期不改变这里使用的授权 generation，不属于触发条件。DOM、账号通知、传输与存储为合成夹具，没有真实网络、账号或 Electron 验收。
- **最小修复方向：** 在读取 owner 中同时核对该次读取所属的控制器/授权代次，再接收绑定和配置；不能移除服务端绑定校验，也不应让普通续期清空有效草稿。扩展现有 `test/danmaku/server-danmaku-settings.test.js`，覆盖同一账号退出重登、旧 GET 晚于新 GET、重复保存及重新读取恢复。当前 API 与外观契约已要求代次隔离，含义无需改变；用户操作不变，指南无需新增步骤。本次只记录问题，未实施修复。

### F-028 [P3] 歌词自动保存期间的旧快照会擦掉新的智能匹配设置

- **位置与调用链：** 客户端 `public/js/admin/desktop-lyric.js:142-148` 在接收设置快照时，无条件调用 `loadWeSingLyricSettings()`，而样式字段有 `dirty/saving` 保护；`:261-269` 直接重置歌词源和智能匹配控件。`:105-125` 虽串行排队保存，第二次保存仍从已被回填的 DOM 收集字段。`src/server/settings-service.js:26-29` 在写入后广播设置，生产快照可在首个 HTTP 保存结束前到达。
- **触发与证据：** 修改字号并触发第一次保存，在请求尚未完成时关闭全民 K 歌智能匹配，再交付第一次保存后的设置广播及响应。真实前端模块与 `applySettingsPatch()` 的隔离复现中，广播前复选框为 false，广播后回到 true，第二个排队请求也提交 `'true'`；最终控件与持久值均为 true。正常顺序对照的第二个请求及最终值均为 `'false'`，两者字号都正确保存为 60。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/agent-desktop-lyric-135/repro-wesing-draft.cjs`；结果：`agent-desktop-lyric-135/wesing-draft-repro.json`。
- **影响与边界：** 用户在自动保存期间的新智能匹配选择静默丢失，后续保存不会自动恢复原意。复现使用真实设置标准化和“保存→广播→响应”顺序，DOM、传输及内存设置为合成，没有浏览器、Electron、真实账号或数据库验收。同函数也回填歌词源，但本次运行直接验证的是智能匹配开关；不扩大为所有歌词参数都会丢失。此项与 F-013 的播放器单曲偏移保存不同，owner、交付入口及最小修复均独立。
- **最小修复方向：** 将这两个设置纳入既有表单的草稿/在途保护，保留干净状态下的外部快照回显，避免旧快照改写本轮后续输入；不改广播协议或移除服务端校验。扩展已有 `test/lyrics/desktop-lyric-settings-runtime.test.js` 的自动保存和 WebSocket 同步用例，覆盖首次在途、后续新选择和最终第二次请求体。用户操作与接口不变，指南和现行契约无需增加步骤；实现与测试修复均未在本次审计执行。

### F-029 [P3] 互动外观恢复默认后提交空补丁，未恢复却提示已应用

- **位置与调用链：** 客户端 `public/js/admin/interaction-appearance.js:117-119` 的恢复默认操作复用 `fill()`；`:38-45` 同时替换表单草稿与 `saved` 基线。随后 `:129-134` 按草稿和这个错误的新基线计算差异，得到空补丁，读取原设置后仍显示“已应用”。
- **触发与证据：** 已保存红色文字、24px 字号及自定义标题时，点击“恢复默认”，再点击“应用样式”，期间没有新的权威快照。真实前端 owner、共享标准化与设置服务的隔离复现中，草稿先显示默认文字颜色 `#172b3a`，实际 POST `/api/settings` 却是 `{}`；保存值仍为红色/24px，表单回到红色，状态为“已应用”。正常手工修改同一颜色的对照会提交正确字段并保存成功。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/agent-client-interactions-140/repro-appearance-reset.cjs`；结果：`agent-client-interactions-140/appearance-reset-repro.json`，主代理复核执行通过。
- **影响与边界：** 现有恢复按钮没有实现其预期恢复结果，成功提示与实际保存值不一致。设置 API 正确接受空补丁且没有丢失原存储；问题在前端把默认草稿误当已保存基线，与 F-016 的成组写入原子性不同。DOM、传输与内存设置为合成，没有真实浏览器、Electron、账号或落盘验收。后来恰好到达的设置推送可能重建基线，但正常操作不能依赖该偶然顺序。
- **最小修复方向：** 恢复默认只填草稿，保留实际已保存基线；只有权威读取、保存确认和状态同步才能替换基线，同时保留现有脏字段合并与显式应用。扩展现有 `test/games/frontend-interactions.test.js`，从非默认状态验证恢复后的真实补丁、保存回读与提示，并保留手工修改和失败保留覆盖。接口、持久格式和用户步骤不变，技术契约及指南无需新增操作。本次未修改实现或测试。

### F-030 [P3] 盲盒 JSON 保存的迟到成功回调会擦除新草稿

- **位置与调用链：** 客户端 `public/js/admin/settings-blindbox.js:183-203` 提交文本框当前 JSON，等待保存后在 `:200` 无条件把 dirty 设为 false，再重新读取状态；`:248-252` 在此期间产生的新输入本已标记 dirty。真实 `FormsService.fillForm()` 的 `public/js/admin/forms.js:243-244` 因保护标记被清除、且焦点已移开，将较新的草稿替换为上次提交值。
- **触发与证据：** 提交合法配置 A，在保存等待期间输入不同的合法配置 B，然后移开焦点再收到 A 的成功回执。真实未修改的设置 owner、表单服务与设置标准化/应用服务中，回执前 B 为 dirty，回读后文本框变回 A、dirty=false，B 从未被提交；无后续编辑的对照正常保留 A。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/agent-settings-150/repro-blindbox-draft.cjs`；结果：`agent-settings-150/blindbox-draft-repro.json`，主代理独立执行通过。
- **影响与边界：** 普通编辑交错会丢失尚未提交的盲盒配置草稿。已提交的 A 正常保存，没有数据库回滚或跨账号影响；DOM、传输和内存设置为合成，未做真实浏览器/Electron或用户落盘验收。现有失败保存用例保护了失败草稿，但没有覆盖旧请求成功时的新输入；当前点歌设置已按提交值比较再清除 dirty，提供同仓反证。本项是独立的盲盒编辑 owner 缺口，不重复 F-013、F-016、F-027–F-029。
- **最小修复方向：** 捕获实际提交前的编辑内容或编辑版本，只在草稿未继续变化时清除 dirty；权威回读继续保护较新输入。不要拿压缩后的 JSON 与原始格式化文本直接比较。核对共用该编辑框的添加/删除路径，但本次直接复现仅限保存按钮。扩展现有 `test/gifts/frontend-blindbox-mapping-refresh.test.js` 的草稿覆盖，加入迟到成功、编辑与失焦，并保留失败/null兼容场景。接口、存储格式和操作步骤不变；技术参考及指南无需新增流程。本次未修复实现。

### F-031 [P3] 仿推特弹幕在正常场景源中无法读取房主资料

- **位置与调用链：** 客户端 `public/js/overlays/scene-danmaku-display.js:11` 把授权场景的房间交给 `danmaku.js:223-239`，后者仍直接请求受保护的 `/api/bilibili/room/profile`，且只从 `window.__API_TOKEN__` 取凭据。`src/server/page-assets.js:87-93` 按现行安全边界不给 componentPreview 子页注入独立源凭据，场景 renderer 也使用 `sandbox=allow-scripts`；`api-routes.js:109-114` 因没有 principal 正确返回401。
- **触发与证据：** 发布正常仿推特弹幕图层，用正式 `/scene?id=…#token=…` 地址打开；授权场景 roomGuard 与本地可用资料均为合成房间1234。实际隔离 Chromium、真实HTTP/场景/页面鉴权链中，独立 `/danmaku?source=component` 的 profile GET200，显示已知姓名与 `@900001`；正常场景输出GET200，但无凭据子框架的同一资料GET401，顶部持续为“当前房主 / @读取失败”。后续两轮输出刷新仍不恢复，资料 owner 只被独立源调用一次。命令：`node --test tmp/full-audit-2026-10-29/agent-scene-twitter-profile-157/scene-profile-http-repro.test.cjs`；脱敏结果：`agent-scene-twitter-profile-157/scene-profile-http-repro-result.json`，主代理独立复验通过。
- **影响与反证：** 已确认影响限于该场景样式的房主资料区，未证明弹幕交付、存储或授权失效。复现没有拦截路由、注入请求头、给子页传 token 或放宽策略；房间与资料端口为合成，无真实Bilibili、Electron、OBS/直播姬或头像下载验收。现行 `overlays.md:591` 的房间匹配/中性回退和 `:893/899` 的无凭据子页是正确约束，但没有接受同房间资料可用时始终401。既有2项profile单测通过，只覆盖注入的loader；独立源200也排除了端口、资料不可用和房间不匹配。不同于 F-022 的时间格式问题。
- **最小修复方向：** 在既有本地场景显示 owner 核对当前本地房间与授权roomGuard后，经现有显示通道投影允许的房主公共字段；具体字段与缓存/刷新归属应在修复任务确定。保留无凭据子框架、HTTP准入和Electron主框架约束，不把独立overlay/admin token下发给子页，也不新增远程LIRA Server资料协议。扩展现有场景/资料集成夹具，覆盖同房间正常显示、不同房间中性回退和资料失败；同步本地显示字段技术参考。用户仍用原场景地址，指南无需新增操作。本次未修改业务代码。

### F-032 [P2] 合法长时长在编辑器中无法往返，阻断整表规则保存

- **位置与调用链：** 客户端 `public/js/admin/overtime-rule-model.js:97-115` 无条件把加减时间的小时限制为999；`overtime-rule-effect-editor.js:168-201` 会把已保存1000小时显示到max=999的控件，却没有保存原合法值的路径。`overtime.js:178-190` 先整表readRules再提交，因此一行超出控件范围会阻止其他规则修改。初始时长同类缺口位于 `overtime-time-view.js:77-115`：格式化1000小时得到 `1000:00`，自身解析器只接受1–3位小时。
- **触发与证据：** 真实纯后端校验器接受1000小时，即3,600,000秒，规则和时间的上限均为315,328,464,000秒；持久化列与快照链未额外截到999小时。真实未修改的规则editor/model渲染该合法规则后，readRules抛“小时应填写0–999的整数”，尚未发送保存请求；时间view也拒绝自己显示的 `1000:00`。999小时规则和时间的正常对照均能往返。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/agent-overtime-ui-159/repro-ui-boundaries.cjs`；结果：`agent-overtime-ui-159/ui-boundary-repro.json`，主代理独立执行通过。
- **影响与边界：** 只要存在一条受支持的长时长加减规则，保留它时整表保存即被本地拒绝，修改另一行或启用/排序也受阻。现行 `docs/reference/frontend/app.md:391` 明确要求超出999小时控件范围的服务端合法值以只读/原值方式保留，不能把控件上限当后端合同。复现使用真实纯校验与ES模块、合成DOM；服务/store/路由调用链为静态核对，未启动加班服务、数据库、HTTP或真实计时操作。3项既有定向检查通过，但未覆盖此边界。不同于 F-004 的事务失败和 F-026 的旧节点重选。
- **最小修复方向：** 在现有时长编辑/读取owner落实已接受的合法值保留合同；未修改超出控件范围的值应可原样提交，正常编辑与最大值仍由服务端合同决定，不下调后端上限。扩展现有rule-editor/frontend用例，验证大于999小时的规则/初始时间往返和其他行修改，并保留999小时对照。当前技术合同已经要求保留；修复时核对初始时间用户说明，无需引入新工作流。本次未实施修复。

### F-033 [P3] 编辑黑名单备注会改写夏令时重复时段的未编辑到期时间

- **位置与调用链：** 客户端 `public/js/admin/song-request-user-blacklist.js:3-12` 将毫秒时间格式化为不含offset的本地日期，再用Date解析；`:39-44` 在任意一行的UID、备注或时间输入后重新解析全部行。原时间属于回拨时第二次出现的本地时刻时，解析后的第一次出现并非原瞬间。`settings-form.js:112/124` 原样提交这个新JSON；后端标准化接受合法整数时间，`src/music/song-request-policy.js:28-37` 按绝对时间决定是否继续拦截。
- **触发与证据：** 保存的合法到期值为 `2026-11-01T06:30:00Z`，在隔离子进程 `TZ=America/New_York` 中显示为第二次01:30。没有操作该到期框，只修改第三行备注，真实editor发出的第一行到期值变成 `05:30:00Z`，提前3,600,000毫秒，真实normalizer仍接受。第一次01:30和普通日期对照不变；相同数据与操作在 `TZ=Asia/Shanghai` 全部不变。真实策略在06:00Z对原值返回 `REQUESTER_BLACKLISTED`，对改变后的值允许请求。脚本：`agent-song-settings-165/repro-user-blacklist-fold.cjs` 与 `repro-blacklist-save-status.cjs`，主代理分别独立复验两种时区及策略，均退出0。
- **影响与边界：** 用户随后正常保存该草稿，会让未编辑的一名用户提前一小时解除限制；合法时间可由另一时区的同账号同步或现有API提供。本项仅确认特定回拨重复时段，不泛化到普通中国时区操作。复现使用真实ES模块、normalizer/policy及合成DOM，没有真实浏览器datetime控件、Electron、云同步、HTTP或数据库保存，也没有改系统时区。现行 `frontend/app.md:305` 约定本机时区编辑并转毫秒，`backend/api.md:333` 接受整数时间，没有允许无关编辑改变原瞬间。两份结果JSON和root日志保留于 `agent-song-settings-165/`。
- **最小修复方向：** 每行保留已保存的原始毫秒时间，在该行到期输入实际改变前保持原值；只解析真正编辑的新本地时间，避免修改另一行/备注时重解释已有瞬间。扩展现有user-blacklist用例，覆盖回拨的第二次时刻、第一时刻/普通日期/上海对照及后续提交，保留最大日期与永久值覆盖。不增加日期框架、不改毫秒协议或权限规则；技术参考核对未编辑值保留，用户步骤不需变化。本次未实施修复。

### F-034 [P3] 删除点歌屏蔽词后仍显示已保存

- **位置与调用链：** 客户端 `public/js/admin/song-request-blacklist.js:20-24` 只改隐藏字段和dirty标记，`:46-50` 的删除按钮调用它却不发input/change；真实 `settings-form.js:88-95` 只在这两类事件中把保存状态改为“有未保存修改”。当前实际HTML将隐藏字段、词条按钮和保存栏放在同一表单，按钮type为button，点击本身不会产生输入事件。
- **触发与证据：** 先正常保存含两个词条的设置，再直接删除第一条，不继续键入。实际editor与实际form的隔离组合中，隐藏值从两条变为一条、dirty=true，但提示仍“已保存”、合成API写入仍只有此前一次。普通输入冒泡的正向对照立即改为“有未保存修改”，没有额外保存请求。命令：`node --experimental-vm-modules tmp/full-audit-2026-10-29/agent-song-settings-165/repro-blacklist-save-status.cjs`；结果 `blacklist-save-status-and-policy.json`，主代理复验通过。
- **影响与反证：** 按钮产生的未提交删除与已保存反馈不一致，可能让用户误以为删除已生效。草稿dirty保护和显式保存仍正常，没有确认自动丢失、后台写错或迟到响应覆盖。相邻UID编辑器 `song-request-user-blacklist.js:48` 已发隐藏字段冒泡input，给出了同仓约定；输入事件正向对照也排除了form反馈处理器本身失效。复现为合成DOM/API，浏览器冒泡按现有夹具模拟；没有真实页面/HTTP/数据库或Electron验收。
- **最小修复方向：** 词条草稿变化通知现有表单，沿用隐藏字段冒泡input的模式，让添加/删除和键入共享已有保存状态；不改为自动保存或增加第二个状态owner。扩展现有词条/form覆盖，先成功保存再删除，断言提示未保存、dirty保留、请求数不增加及再次显式保存成功。接口、存储和用户操作不变，现行技术契约和指南无需新增步骤。本次只记录审计证据。

### F-035 [P3] 放弃文本框修改后，旧上传回包仍把图片插回草稿

- **位置与调用链：** 客户端 `public/js/admin/text-box-media.js:93-95` 等待图片上传后，仅检查面板级signal和disabled再调用composer插入；`text-box.js:170-176` 放弃当前场景草稿，`:106-136` 在原实例仍存在时保留面板。`text-box-preview.js:79-91` 回填已保存内容却不取消媒体任务，真正的面板dispose才在media `:118` 中abort。旧上传因此仍属于可用面板，却已不属于用户保留的编辑。
- **触发与证据：** 已保存文本框A有一项未保存改名，开始合法图片上传，在回包前点击现有“放弃修改”。真实workspace、preview/media/editor及场景controller的隔离组合先还原A名字/图片0、dirty=false、提示“已保存”，但上传signal未abort；释放旧回包后A图片变1、dirty=true、提示“文本框有未保存修改”。正常上传对照只向A插入；切换到B会dispose并abort，即使合成传输仍返回也不插入、场景保持干净。诊断 `agent-text-box-media-177/repro-discard-upload.test.cjs` 为一个容器三场景；主代理全文阅读脚本、真实模块/HTML及现行合同，逐字节复制到独立root-replay后重新执行，退出0、无pageerror。原结果和root结果分别保留，均不混入维护测试累计。
- **影响与边界：** 已明确放弃的旧上传会重新产生未保存内容，用户后续显式保存可能带上这张意外图片。本例没有自动保存、正式输出改变、真实图片HTTP写入或持久化清理失败；仅确认实际文本框工作区入口，不扩张到未复现的其他画布入口。浏览器/本机HTTP/内存场景服务由既有隔离fixture拥有，上传与图片响应为合成数据；未控制用户应用、读取用户资料或运行Electron。主代理复验 `root-replay/root-repro.log` 为1项临时诊断通过2535.4762ms，源字节一致证据另存。
- **最小修复方向：** 在显式放弃/草稿替换边界使旧媒体插入任务失效，复用现有取消和面板生命周期，并在插入前核对所属编辑代次；保留普通编辑期间的合法上传与切换实例时的释放。扩展现有文本框/场景夹具，覆盖同ID放弃、正常完成、切换释放及传输忽略abort的对照，断言内容、dirty、提示及无额外保存请求。既有放弃语义、图片权限/持久化和用户步骤保持；技术参考核对取消边界即可。本次未实施修复。

### F-036 [P3] 文字展板允许六个Unicode字符，原生输入却只容纳三个emoji

- **位置与调用链：** 客户端 `public/js/admin/overtime-rule-effect-editor.js:74-82` 将码点上限6直接写为原生text input的maxLength；该属性按UTF-16单元限制输入。真实 `overtime-rule-model.js:23-26` 与后端 `src/overtime/overtime-contract.js:211-221` 均按Array.from码点计数。现行 `specs/overtime-text-display_design.md:5/21/34` 要求允许输入并保存1–6个Unicode字符，六个补充平面emoji是后端接受的合法值。
- **触发与证据：** 使用既有component-preview HTTP夹具，加载未修改的真实rule editor，按正常按钮展开已保存规则，再通过原生键盘输入 `😀😃😄😁😆😅`。实际Chromium只留下前三个，长度为6个UTF-16单元/3码点，input.validity.tooLong仍false，真实readRules返回这个缩短值，后端也接受。原生text insertion得到相同结果；六个汉字完整录入。程序化加载已保存六个emoji仍能完整往返，说明旧159批的假DOM/回填结果不能证明实际键入可用。ASCII七字符的对照只允许六个，后端明确拒绝七字符输入。
- **影响与边界：** 用户无法通过该控件输入合同支持的六个补充平面字符，输入可能无错误提示地只保留前三个；不声称所有Unicode内容或输入法失败，也不声称已有保存值会自动截断。命令 `node --test tmp/full-audit-2026-10-29/agent-overtime-native-181/repro-display-native-input.test.cjs`，实际1项临时诊断通过2242.9453ms；结果 `native-input-result.json` 与日志同目录。原生键入/文本插入、真实editor/model及纯后端校验均参与，未执行保存HTTP、数据库、计时结算、剪贴板访问或Electron。初版诊断遗漏展开折叠行而超时，终止后保留原脚本/日志，补上真实展开操作后通过；该准备错误不算产品失败或维护测试执行。
- **最小修复方向：** 在所属输入控件落实与model/后端一致的码点限制，保持正常编辑、组合输入和服务端控制字符校验；不能直接把码点数当原生UTF-16 maxLength。沿用现有原生编辑器夹具，覆盖六个汉字、六个补充平面字符、混合文本、七码点拒绝及保存回填。假DOM不具备此约束，不能只用其证明修复。现行Unicode要求与用户操作无需改变，不改API或存储格式。本项由D-008升级确认，本次未修复。

### F-037 [P3] 损坏的特效JSON假值绕过目录完整性拒绝

- **位置与调用链：** 服务器 `src/modules/gifts/gift-variant-catalog.js:148-160` 解析 `effect_json` 后使用 `effect &&` 决定是否校验，`false`、`0`、空字符串因此直接进入 `:182` 的DTO。`gift-variant-store.js:9-29` 的列是无JSON类型约束的TEXT。`gift-client-catalog.js:80-94` 将其放进schema 3成功响应；`src/routes/gifts-public.js:161-176` 没有异常时沿正常缓存响应路径序列化。当前 `docs/protocol/gift-variants.md:345` 和 `test/gift-variant-catalog.test.js:440-460` 已明确要求非法存储特效拒绝整个目录。
- **触发与证据：** 先用真实writer在隔离内存库写入合法特效，再只把该列改为JSON文本 `false`、`0`、`""`。同一个真实 `createGiftClientCatalogQueries().listClientCatalog(3)` 均返回 `ok:true/schemaVersion:3` 及相应标量，完整 `GiftCatalogV3Response` 校验均拒绝。合法writer对象、SQL NULL、JSON null通过；`{}` 正确抛出 `CATALOG_INVALID`。同一预热reader的 `total_changes` 从4到10，外键检查无异常，不是旧缓存结果。子代理一次七对照，主代理用项目Node24.15.0独立重放七对照一致；证据为 `agent-effect-integrity-219/effect-integrity-observations.json` 和 `root-effect-integrity-replay-220/supported-node/effect-integrity-observations.json`。这14个观察不计维护测试。
- **影响与边界：** 前提是已存在非法持久化值；正常同步及迁移writer只构造对象或null，未找到正常上游写入标量的入口，也未读取真实目录数据库。该读取路径会把违反契约的数据当成成功目录；从路由与公开页校验器看，可沿正常可缓存响应路径交付后被消费者拒绝，未进入应有的完整性错误处理。服务层DTO已实际重放，HTTP/浏览器后果仅由源码追踪，未实际发请求或宣称生产事故、账务丢失、鉴权绕过。首次主代理重放被默认Node24.21.0的既有版本检查提前拒绝，0个数据库查询观察；原失败记录保留，使用现成受支持运行时重放，没有改运行时保护。
- **最小修复方向：** 在目录reader按 `effect !== null` 判断是否需要执行现有验证，保持合法null；不要把其他JSON假值静默当作无特效。扩展上述已有损坏特效用例，覆盖三种标量及SQL/JSON null对照，并检查完整schema 3响应。现行技术合同已经要求拒绝，含义与用户步骤无需改变；D-010是对象内URL的schema口径问题，修复位置不同。本次仅审计，尚未修复。

### F-038 [P3] 指定截图镜头会重新选回清单中的暂缓项

- **位置与契约：** 客户端 `scripts/usage-guide-shots/capture.cjs:215–217` 先排除 `skip`，随后 `--only` 又从未过滤的 `SHOTS` 重新选择。`manifest.js:12` 明确非空 `skip` 应跳过；102–135行的E8/E9/E2/C1/F5因真实动态、登录态或服务器侧能力而暂缓，均缺少可执行镜头的type/viewport。README36–37说明可列出这些暂缓项及原因，没有强制执行约定。
- **触发与证据：** 给正常可运行的历史Chromium工具传入等号形式 `--only=E8 --port=0`，215行的过滤结果被217行覆盖，暂缓E8进入执行列表且绕过无匹配返回。子代理全文审阅与主代理选段独立核对一致，证据 `finding-f038-adjudication-stage-232.json`；这是源码确认，没有执行capture、应用、浏览器或生成PNG。
- **影响与边界：** 该维护命令会误尝试暂缓镜头。仅在种子/API/runtime/浏览器、导航、截图与PNG读取均成功时，136–139行缺type回落到admin，197–201行先留下错标的临时候选图，再在205–206行读取缺失viewport时报错；更早失败会阻止这些后果。错误汇总最终设置exitCode1，不能称静默通过。默认过滤、`--list`及优先Electron补图路径不受此选择分支影响，未观察到正式指南改写或真实账号操作。
- **最小修复与同步：** 在已有 `selected` 上应用only过滤，保留skip约束；暂缓ID单独选择应无可执行镜头，不启动采集服务或浏览器。当前没有匹配的选择器测试，应在对应Node工具覆盖中检查暂缓、可执行和混合ID以及list，隔离runtime/browser并验证暂缓项不启动。README现有暂缓说明与等号语法可保留；未来修复同步选择器覆盖即可，不增加强制模式或伪造账号状态。当前未修业务、测试、契约或指南。

### F-039 [P3] 补图工具的浏览器启动失败会绕过已启动监听的清理

- **位置与触发：** 客户端 `scripts/usage-guide-shots/web-supplement.cjs:84–101` 在86行先await HTTP fixture，87行await Chromium启动，88行才进入清理try。前提是Playwright模块成功加载、fixture已成功监听，随后launch拒绝，例如浏览器可执行文件未安装；Playwright模块本身缺失会更早失败，不属于此路径。
- **证据与后果：** 启动拒绝直接跳过98–101行的server关闭，105–108行仅打印错误并设置exitCode1。已全文的 `web-fixture.cjs:205–209` 在listen完成后返回真实127.0.0.1随机端口HTTP server，两个模块没有unref或另一条失败清理。按默认Node监听生命周期推导，报错后仍保留的监听可能使命令无法自行退出。子代理全文与主代理选段独立核对，证据 `finding-f039-adjudication-stage-238.json`；没有实际启动监听/浏览器、注入故障或观察进程挂起。
- **反证与边界：** 浏览器成功启动后，try内的newPage/截图异常会进入既有finally，条件是browser.close正常完成。fixture取得前失败也不能套用本结论。此问题仅属维护CLI的启动错误清理，监听为loopback合成网页服务；不是F-038的镜头选择错误，也没有生产服务、账号或真实数据泄漏证据。
- **最小修复与同步：** 从fixture取得后即用其生命周期finally包住浏览器创建与采集；浏览器仅在已创建时关闭，并独立保证fixture关闭，不用强制退出代替清理。未定位到匹配的启动拒绝清理测试；未来用合成launcher拒绝和临时监听验证close与有界退出，无需真实浏览器或用户数据。README已要求调用方关闭fixture，修复只需落实该既有责任并补对应覆盖，用户步骤与技术合同含义不变。当前仅记录、未修业务或测试。

### F-040 [P3] 礼物流水验收的相对时间样例会让“今天52条”产生假失败

- **位置与调用链：** 客户端 `scripts/verify-gift-history.cjs:29–36` 将105条合成记录放在实际当前时间之前1–105秒，奇数下标的52条匹配“小明/小花”。236–242行设置这两个条件、点击今天，再固定等待52条和已选52条。`history-tools.js:108–112` 按UTC+8当前自然日填写起止日期，`history-filters.js:45–55` 换算北京时间日界；实际insert覆盖值及查询lower bound均沿原字段传递。
- **可达反例与证据：** 若fixture-1在中国午夜后00:00:30写入，其104秒偏移落在前日23:58:46；同日点击今天就应排除该条，因此52个匹配样例最多剩51个。每条各自读取Date.now，不需要假设播种共享一个固定now；跨午夜播种/点击也有同一问题。子代理全文与主代理选段及数据流独立核对，证据 `finding-f040-adjudication-stage-244.json`。这是源码与日历反例，没有运行Electron、注入时钟或观察当前失败。
- **影响与反证：** 维护验收可能在正确的今天筛选下超时/失败，正常日间的52条成功不能排除该边界。UI与查询均使用UTC+8，问题在合成记录和断言所选日未绑定，不是生产时区、日期筛选或分页逻辑错误；没有真实流水丢失或用户数据操作。
- **最小修复与同步：** 使用同一个显式合成参考日/时刻驱动播种、fixture asOf和renderer今天，使105条样例在该日内保持预期排序与52个匹配。保留生产筛选与52/选择断言，不用跳过今天或放宽查询掩盖假失败。未来为午夜前后补稳定样例/时钟覆盖；不改变产品字段、默认值或用户步骤，验证说明仅在修复后需要时交代合成时钟。当前未修改脚本或测试。

### F-041 [P3] 媒体装饰的旧播放失败回调会静音新视频或访问已清空元素

- **位置与调用链：** 客户端 `public/js/overlays/component-media.js:80` 的两层 `play().catch()` 均引用可变的工厂变量 `art`。57–64行清理时把它置空，74–80行换来源时再指向新元素；`component-preview-client.js:49` 在真实配置消息中调用update，28–37及67–72行在dispose/pagehide清理。共享 `component-media-style.js:15–34` 接受合法视频与0–1音量，`createMediaElement():10–18` 按当前音量设置新元素的muted。
- **触发与复现：** 视频A的首次play或静音重试仍待决，随后清空、换图/换视频或销毁，A再拒绝。使用未修改的真实factory与纯normalizer、合成DOM/video/Promise，在既有Node24.15.0执行 `D:/Work/lira-server/runtime/node/node.exe --experimental-vm-modules tmp/full-audit-2026-10-29/agent-overlay-foundations-303/diagnose-media-decoration.cjs`，最终exit0。当前元素拒绝的对照正常静音重试；其余五场景分别观察到清空后的null.muted异常、换图后的play不存在、新视频B由未静音/1次play变为静音/2次play、dispose后的null.dataset异常，以及旧重试拒绝给B错误写入playbackFailed。结果 `agent-overlay-foundations-303/media-decoration-result.json`，父代理独立源码与完整诊断脚本核对见 `finding-f041-adjudication-stage-307.json`。
- **反证与边界：** caller的configuration/disposed检查保护它自己的await流程，不能包住独立的void play回调；loading.abort也未给这两层回调绑定元素身份。正常当前视频的静音重试应保留。playbackFailed未发现产品消费者，故只计内部错误标记，不声称显示了错误提示；重复play调用不证明回到开头。未加载真实媒体、启动浏览器或观察真实音频/画面、崩溃、频率与数据丢失；合成进程捕获未处理拒绝，最终移除监听且每场0剩余timer/0 I/O。
- **最小修复与同步：** 捕获本次播放的元素，并在首次拒绝及重试拒绝两处确认仍是当前有效元素；清空/替换/销毁后的旧结果直接忽略，保留当前视频的静音重试。只捕获旧节点而不做身份检查可能重新播放已移除视频，不能作为完整修复。在现有前端VM测试方式下补当前失败、clear、换图、换视频和dispose的迟到拒绝回归，断言不修改新元素且无未处理错误；不改独立event-player职责或公开schema。内部身份/生命周期修复不改变字段、默认值或用户步骤，未来修复时核对媒体渲染职责说明即可。当前仅更新审计材料，未修实现、测试、契约或指南。
- **执行计数：** 共2次合成诊断启动：首轮替身style缺setProperty，在第72行、play观察前退出；补齐替身后第二次完成6场景。首轮是夹具准备失败而非产品回归，结果JSON中的diagnosticExecutions=1只表示完成的那次。维护测试新增执行与PASS计数均0。

### F-042 [P3] 自定义气泡背景会给独立SC卡片的外壳加上普通弹幕底色

- **位置与调用链：** 服务器 `public/overlay/styles/bubble.css:223` 的自定义背景选择器只排除 `.is-gift`，仍匹配 `.draw-danmaku-item.is-superchat`；其specificity(0,4,1)高于 `superchat.css:2` 透明外壳规则的(0,3,1)。后者首行明确声明普通弹幕/礼物样式不绘制SC，外壳保留20px padding。`danmaku-superchat-renderer.js:41` 实际生成item+is-superchat，内层独立sc-bubble，不设置外壳background；core63–67直接分派SC，app62–90/103–109调用外观设置，style-options451–455在透明度非100时启用customBackground。
- **客户端同因范围（第345批源码）：** 客户端 `public/css/overlays/danmaku/superchat.css:1` 自身声明普通弹幕/礼物不绘制SC，2–20要求外壳透明；同目录 `bubble.css:209` 的custom-background规则只排除is-gift，specificity(0,4,1)仍高于SC透明规则(0,3,1)。客户端renderer-core9–10/65–67/89提供默认draw-danmaku-item并在普通礼物分支前返回SC；SC renderer41、96–100/118–119生成item+is-superchat并只添加内层气泡，没有is-gift或外壳inline background。当前style-options459/463在背景透明度非100时设置opacity变量及customBackground标志，正常bubble+SC+50可达同一源级级联冲突。父345复核实际客户端选段并绑定前后摘要，证据 `finding-f042-client-extension-stage-345.json`；这是F-042去重后的范围扩展，不另编号或提高优先级。
- **客户端证据边界与同步：** 本轮只确认源码选择器、实际类别/分派和参数交付，未启动客户端、执行renderer或测量CSSOM/像素；第315批服务器夹具不能借为客户端运行证据。默认100不启用该自定义规则，SC内层配色仍属独立owner，不声称实测内层色彩或可见面积。未来在客户端既有外观/渲染测试补100/非100外壳断言及普通弹幕/礼物对照，保留内层配色独立验证；本轮未改业务、维护测试、现行契约或用户指南。
- **触发与复现：** legacy气泡浏览器源收到正常SC，背景透明度设50，无额外用户样式。父315在既有Node24.15.0启动仅builtins的自有回环HTML/CSS夹具，先核对精确路由HTTP200，再用CUA后台IAB加载真实overlay.css完整导入链；35份实际CSS摘要均与原始服务器清单一致。匹配真实root/child类别的合成DOM，100→50→100对照中SC外壳由transparent/none变为rgba(28,30,47,0.467)+普通气泡渐变，再恢复transparent/none；padding始终20px，普通弹幕对照正常响应设置。证据 `sc-background-stage-315/computed-style-observation.json`、父裁定 `finding-f042-adjudication-stage-315.json`。
- **反证与边界：** 默认100不触发，0端点透明只是源码推论，本次未执行。SC内层实心卡片可能遮住外壳中部；此次夹具的scSurface实测为空，合成inline palette未生效，故不声称内层配色损坏或保持正确。CSP为可能原因推断，过滤控制台日志未给独立确认。协议109–115约束内层SC配色/中性文字，没有明确外壳透明度条款；预期依据当前SC owner的显式隔离注释和透明声明。实际证明CSS外壳绘制冲突，未执行真实SC renderer、生产页面、OBS/直播姬或Electron像素验收，不涉及金额、历史、鉴权、丢消息或崩溃。
- **最小修复与同步：** 在普通气泡自定义背景owner的相关选择器排除is-superchat，保留普通弹幕/礼物透明度和SC子卡片配色，不用全局!important或统一主题掩盖职责。未来扩展现有overlay-style-options/overlay-superchat用例，覆盖100/50外壳背景并保留独立子卡片配色断言；所读测试选段目前分别检查普通弹幕100→0和SC子卡片，不代表已搜索全部断言。仅审计材料新增条目，测试/现行契约/指南未改；未来修复时核对SC说明，只有产品意图需要公开外壳规则时再澄清协议。
- **执行计数：** 1次自有夹具进程、1次IAB导航、3个状态对照；38次自有loopback请求为2次HTML、35次CSS及1次停止POST，均200。0外部网络、产品JS/config/env/DB、真实账号/媒体/字体或用户应用操作；已关闭tab及server，进程exit0。维护测试新增执行/PASS均0，CSS加载摘要不计人工全文。子312保留未编号候选的原始交付，由父315单独裁定，不回写为子代理已执行浏览器。

### F-043 [P3] 月渡花汀开场文字显式清空后被组合层补回默认文案

- **位置与可达调用链：** 客户端 `public/js/overlays/opening.js:299`、300和302–303对title/subtitle/footer执行cleanText(...) || 月渡默认值，混同显式空串与缺省。场景资源moonlit-opening的真实文本input不设required，scene-extra-preview96–142把String(input.value)交target.edit，159–188以draft[key] ?? 默认回显；scene-item-controller20–50传patch/赋值而非把空串删除。shared/scene-extra-components22–28/185–188允许这些字段缺省；scene-components107–112/116–152接到normalizeSceneExtraConfig，其text检查只限制类型、最大长和控制字符，scene-extra-config34/44仍返回空串。shared/opening-appearance29–39最后用显式own字段覆盖默认，因此空串能到达组合层。
- **触发与源码结论：** 使用正常月渡花汀开场资源，将标题、副标题或页脚文案清空并应用配置。opening352–355把resolveOpeningAppearance结果交mergeConfig，使用空query参数；299–303随后改回默认标题/副标题/页脚，320直接返回。底层opening-moon-fan-art362/375/397本来用??区分空串，标题可不再绘制默认书法素材；组合层先替换后，这个能力无法生效。现行overlays.md312明确“清空后保持为空”；既有opening-moon-fan.test.js97–132直接给runtime传空subtitle/footer，130仅断言默认页脚不存在，未经过组合merge，也未验证空标题。父源码裁定见finding-f043-adjudication-stage-324.json。
- **反证与边界：** 缺省字段仍应使用默认值，非空自定义文案正常；name不受这三处fallback影响。classic/legacy及URL查询覆盖各有兼容语义，不据月渡清空要求全部改掉。mediaStyle走另一分支。这里确认的是实际参数流的确定性替换，仅源码审阅，没有执行保存、VM、浏览器、画布、媒体或真实桌面；不声称存储的空串被覆盖、保存失败或已观察到像素结果。
- **最小修复与同步：** 在月渡开场组合owner区分缺省和显式合法空串，保留标题/副标题/页脚空值及原有缺省默认、classic页脚兼容。编辑端与参数校验已接受并保留空串，无需强制用户填写或改存储格式。沿现有opening-style/opening-independent-settings等merge测试补resolve→merge的空串、缺省及非空对照，并保留现有底层页脚断言；本轮只搜索这些其余测试，不冒领全文或执行。当前技术说明已写明预期，未来修复应使实现符合说明并核对相关指南；本审计不改业务、维护测试、现行契约或用户步骤。
- **范围与执行：** 子318候选C318-001保持未编号、优先级null的原始交付，父324独立裁定为F-043/P3。父279物理行读事件、278唯一行均是本轮已读owner/测试的复看，opening312重复一次；normalizer47行确实全文，其余按选段登记，测试97–132不是整个文件/用例。全部产品、维护测试及诊断新增执行0。

### F-044 [P2] 世界地图扩展城市目录的错误时区会让所选城市显示另一地区的时间

- **位置与可达调用链：** 客户端 `public/js/admin/world-clock/city-catalog.js:413` 把布拉格的zone写为America/Chicago，889把澳门写为America/Fortaleza；第7行声明该字段是zone。`cities.js:3-5` 将tuple原值投影到城市对象，69–73只覆盖60个既有ID，两个ne-ID不在覆盖范围。`index.js:328-348` 的搜索选城把这些ID加入当前列表，259/268将CITY_BY_ID中的zone交给clockAt，282–287及297–307用于列表和详情时间；`time.js:7-17` 直接将zone交给Intl.DateTimeFormat，未按经纬度修正。因此通过正常搜索选择这些扩展城市即可到达错误时间显示。
- **外部反证与实际隔离对照：** [IANA 2026f的zone1970.tab](https://data.iana.org/time-zones/tzdb-2026f/zone1970.tab) 第137行把布拉格代表坐标列为Europe/Prague，第213行把澳门代表坐标列为Asia/Macau。使用服务器仓现有完整路径Node24.15.0（ICU78.2、内置tz2026a）实际执行一次仅builtins的Intl诊断，从已原文审阅的两个JSON tuple取值，固定时刻2026-01-15T12:00:00Z：布拉格目录zone输出06:00，参考zone为13:00，相差−7小时；澳门分别09:00和20:00，相差−11小时。证据world-clock-zone-diagnostic-stage-351.json、finding-f044-adjudication-stage-351.json。这里没有把Node内置tz版本说成2026f，也没有将公开来源的三次工具查询数冒称底层HTTP请求数。
- **根因与现有覆盖：** 错误但可被Intl接受的地理zone已进入生成目录。`scripts/generate-world-clock-cities.js:57` 选择匹配GeoNames值或NaturalEarth回退，59只校验IANA标识可构造，不能证明该标识属于该城市。现有`test/admin/world-clock.test.js:81` 的全表构造检查与104–105的布拉格搜索存在性断言都不能拒绝这两条错误配对；其他城市的定点/季节断言不等于所有城市地理正确性。本轮未读取或重新生成上游输入，不能断言每条错误来自哪一个原始记录或匹配分支。
- **影响、反证与边界：** 影响是所选城市的当地时间、日期与时差信息失真；未证明持久偏好损坏、跨租户问题或数据丢失。旧60城显式覆盖、合法时区别名、同一国家多时区及相同offset都不能只凭名称差异判错；本条确认的是两个没有被覆盖的扩展ID及固定日期的实际不同结果。6442条tuple原文全文已读，但没有为全部城市的地理/译名/时区、全年DST或来源/许可真实性作认证；子349其余同族线索不按22个新问题或全部已确认计数。客户端、桌面页面、地图/GPU与天气未运行，显示影响由实际源码调用链推导；未导入catalog/formatter/其他产品模块，未接触用户偏好或账号。
- **最小修复与同步：** 在离线数据生成/输入owner修正可信城市到时区的映射并重新生成目录，保留稳定城市ID、既有偏好和合法别名/多时区语义，不在UI补小时或新增运行时服务。扩展现有world-clock测试与适当生成器fixture，覆盖这两个位置、固定日期输出或等价IANA zone，并保留ID/坐标/搜索约束。现行`docs/reference/frontend/app.md:409-415`拥有数据来源、生成和本地偏好说明，未来修复若改变匹配规则或命令须同步核对；无新操作时不新增用户步骤。本审计只记录问题及覆盖建议，未改业务、维护测试、现行技术契约或指南。
- **范围与执行：** 347–350的80份新原始全文中，349目录6451物理行/54块确实原串完整可见；父351另选6个源路径293行读事件/11块，其中11目录行重叠，额外282唯一行。cities.js88行是旧69全文的当前复看，不是新闭合；time/index/test/generator只按实际选段登记。当前产品规范Markdown另读14行/2路径，不扩原3553清单。新增1次内置Intl诊断、0维护测试，累计5778次维护通过不变；公开IANA查询不冒充应用联网。F-044为新确认P2，未修复。

## 待验证与改进建议（原始记录）

### D-001 其余依赖公告按实际使用条件分流

2026-10-29 的 `npm audit --ignore-scripts --json`：客户端 0 项；服务器 5 个包。其中 body-parser 已单列 F-001，不能把 5 个包说成 5 个已复现的应用漏洞。

- `proxy-addr 2.0.7` 公告为 Critical，但 [维护者说明](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) 的触发条件是特定 IPv6 信任子网配置。当前 `src/config.js:46-47` 只接受数字 0/1；没有建立该公告在现有配置下可触发的证据，不能据此声称已绕过 IP 限流。
- `fast-uri 3.1.7` 由开发依赖 AJV 引入；未进入应用运行依赖。`ip-address 10.5.0` 的运行消费者为 express-rate-limit：其 `ipKeyGenerator()` 先调用 Node `isIPv6()`，仅对已验证 IPv6 构造 Address6，subnet 比较的双方均是 Address6；未发现应用将任意正文送入该包，也未调用受影响的 link-local/NAT64 分类。对应[大输入诊断公告](https://github.com/advisories/GHSA-h3mg-xc3c-68pw)和[zone 匹配公告](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5)的任意长字符串条件未建立。
- `qs 6.16.0` 的已找到消费者是 Express/body-parser 的 parse；自有源码没有 `qs.stringify(..., { arrayFormat: 'comma' })`，不满足[该公告](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)的 stringify 前提。依赖升级仍可降低维护风险，但这些项不计作新增已确认应用缺陷。原始清单保存在 `server-npm-audit.json`，依赖树由 `npm ls ip-address qs fast-uri --all --offline` 复核。

### D-002 客户端技术参考仍描述旧的五秒礼物收尾

客户端 `docs/reference/backend/bilibili/gift.md:167` 与 `docs/reference/backend/overtime.md:133` 仍写服务器按五秒静默收尾；当前服务器 `gift-detector.js:20` 为 6,000 ms，且已接受的 `docs/architecture/decisions/0107-six-second-gift-combo-continuations.md` 和当前协议明确六秒等待、final 不可变、迟到差额新增结算段。应在后续文档同步任务中核对并修正这两处事实，避免按旧时间设计客户端重复收尾或错误验收。本项是文档漂移，不另算代码缺陷，当前未改写现行规范。

### D-003 辅助页面、规则弹窗和新手引导的说明漂移

- 客户端 `docs/reference/frontend/pages.md:214` 仍把礼物审计页标为内联脚本；当前页面通过 `public/js/gift-audit/index.js` 加载 ES Module，现有页面测试也明确要求无内联行为。`docs/reference/frontend/app.md:468` 还列出事件重放、手动投递，而当前 HTML 和入口处理函数提供的是粘贴解析、读取记录及交叉比对；后续应按当前入口核对说明，无需据此新增功能。
- 服务器 `public/games/v1/runtime/blind-box-view.js:226` 的规则仍写历史只看“当前倍率”。已接受 ADR-0103、当前规范和 `blind-box-history.js` 都按当前盲盒合并全部倍率；既有浏览器用例也明确断言此行为。实现符合现行范围，需同步规则文案以免用户误解。此项仅记录低风险说明漂移，不另计功能缺陷，当前未改现行文档或界面。
- 客户端 `docs/reference/frontend/interactive-tour.md:29` 写未完成等待操作不能进入下一步；`interactive-tour.js:388-394` 只防止步骤仍在渲染时前进，完成检查用于更新提示状态。当前页面指南 `usage-guide-getting-started.html:198` 以及配置末步 `interactive-tour-config.js:181` 都明确允许跳过，并提醒之后补齐设置。应修正参考中的阻止语义，使其与现行操作说明一致；不能据这句话新增强制登录或设置门槛。本批23项相关检查通过，但不是实际平台登录验收，不另计代码缺陷。
- 客户端 `public/js/overlays/games.js:286` 在你画我猜结束时固定写“五局结束 · 最终排行”，但配置页、当前指南和领域模型允许 1–12 局。使用实际领域模型完成 1、5、12 局，再将公开状态交给现有游戏页 VM bundle，三种结束提示均写五局，旁边局次分别正确显示 1/1、5/5、12/12（`repro-game-finished-copy-stage-82.json`）。这是低风险界面文案漂移，不影响轮数、积分或结算；可在呈现 owner 使用实际总局数或通用结束文案。合入本项，不新列功能根因，不据此收窄赛制。该复现不是完整浏览器或 Electron 画面验收。
- 客户端 `docs/reference/backend/music/services.md:373` 仍说请求者定位查询 `requests`；当前 `requester-target-store.js:12-15` 查询独立的 `random_request_history`，与 `storage.md:240` 的 v13 迁移说明及清队列、重启后保留回复对象的现有用例一致。后续应同步表名及保留语义，不应据旧说明恢复对已清理流水的查询。本批相关51项检查通过，不另列功能缺陷，未改写现行参考。

- 客户端 `docs/reference/frontend/app.md:399` 仍说歌词表单收集 12 个 `desktopLyric` 键，并用旧 `desktop-lyric-preview.js:26-29` 定位春动常量；当前收集逻辑按完整默认项遍历，后者行号已指向状态处理。应随对应文档同步核对键范围和实际 renderer owner，不能据旧说明收窄现有参数。只登记说明漂移，不另计产品缺陷。
- 服务器 `docs/requirements/system-rules.md:1521` 要求礼物搜索栏仅以边框颜色提示焦点；当前 `public/gifts/styles/activity-controls.css:117-124` 使用整条 2px 轮廓和透明边框，`e2e/gift-search.spec.js:54-59` 明确断言后者。这是现行要求与实现/断言不一致，应按接受的焦点设计协调；测试通过本身不能替代目标要求，本次未擅自改 CSS、测试或要求文案，不另列功能缺陷。

- 服务器 `docs/requirements/system-rules.md:2662` 要求英文游戏目录明确提示入口为中文玩法；当前 `public/games/catalog.js:95-98` 只显示“Play”，`e2e/game-catalog-previews.spec.js:94` 也明确期望该文案。游戏内部仍保持中文，符合语言边界；是否缺少入口提示属于现行要求与呈现待协调项。不能据测试通过省略要求，也不能据此擅自添加游戏翻译或改变 Host/入口协议。本次只记录差异，没有新增已确认玩法缺陷。

### D-004 首页时间窗的注释错误描述为互斥

服务器 `src/lib/gift-overview-windows.js:18-19` 称每条记录只属于一个时间窗，且时间窗互不包含；实际 `yesterday` 完整包含在 `recent7Days` 中。当前 `docs/protocol/management-api.md:544-545` 明确要求这种包含关系，聚合 owner 会将昨日记录同时计入两者，现有 `test/streamer-overview-api.test.js:183-184` 也验证该行为。建议只修正注释，说明“今日、前七天、再前七天”覆盖读取范围，昨日另作重叠视图；不要据错误注释改变正确的统计逻辑。本项是低风险代码说明漂移，不另计功能缺陷，当前未修改源码或契约。

### D-005 大航海重复通知的缺失 source 规则与两端现行实现不一致

服务器 `docs/requirements/system-rules.md:1594` 要求使用 `readObjectValue` 空值选择，并明确 `option.source` 缺失时不额外按顶层 `data.source=2` 丢弃；`docs/requirements/acceptance-criteria.md:2100-2104` 也要求这种结果。当前客户端 `src/bilibili/parsers/gift-command-utils.js:6-12` 和服务器 `src/lib/bilibili-guard-membership.js:10-13` 都使用直接的 `option.source ?? data.source`。实际调用两端生产 helper 的五组对照中，option 或 source 缺失时均回退到顶层并判为重复，空串和显式 0 则均保留；服务器现有 parser 测试还明确断言缺失时判为重复。结果见 `check-guard-source-contract.json`。

这是已确认的规格/实现不一致，尚无证据证明该类真实上游包属于主订单或 companion，不能直接计为漏收入、两端不兼容或新增应用漏洞。后续需按当前需求确定缺失与空串各自语义，再同步规范、fixture 和两端断言，不能只改一端或以绿色测试替代规范。本批未改现行规则或业务行为。

### D-006 三处浏览器断言未等待呈现和允许的清理稳定

第123批七份现有弹幕浏览器文件实际执行64项：61通过、3失败。`e2e/overlay-layout.spec.js:59` 首次读取画布位置，`overlay-snowfox.spec.js:56` 即时读取动画对象数，`overlay-harbor.spec.js:66-81` 则在布局清理前记录总消息数，再要求人数更新后保持该数。原批次收据为服务器 `tmp/verification/runs/2026-10-30T13-29-48-112Z-26a144ee/browser.json`，没有改断言或重跑后掩盖失败。

独立 Chromium 观察使用原始素材与合成 SSE：画布变量已正确写入，最初读到 `{x:1000,y:980,width:1920,height:1080}`，两帧后及200ms时均为预期 `{x:40,y:440,width:560,height:600}`；`styles/motion.css:117-123` 的全局0.01ms过渡在首次渲染前仍有 width/height/transform 对象。雪狐的直接对照没有重现对象残留，追加观察则捕获到减少动效为 true 时 feed 上两个0.01ms的 `column-gap` / `row-gap` CSS 过渡，稳定后为0；原失败只记录数量2，没有对象类型，不能据对照断言它们就是原次的两个对象。海湾在不发送任何人数更新时，也从11条变为10条：唯一被移除的是底边已位于画布上方 `-10.5625px` 的旧系统提示；此后七次人数切换均保持10条。该清理符合固定列表只移除完全越界旧项的现行职责，没有据总数变化确认人数更新丢用户消息。

证据为 `overlay-canvas-live-stage-123.json`、`overlay-harbor-live-stage-123.json`、`overlay-snowfox-live-stage-123.json` 与 `overlay-snowfox-observer-stage-123.json`，原失败截图、trace 和稳定画布截图均已检查。建议在现有用例等待目标几何/布局稳定后再取基线，人数切换继续核对存活消息身份和内容不被重建，减少动效继续拒绝持续可见动画；不能简单降低数量、移除有效断言或用固定等待掩盖问题。这里只登记测试时序改进，未新增产品漏洞，也未以独立诊断代替原并发批次通过；三处原用例仍为未修复、未复验。四个自有诊断上下文与浏览器已关闭，诊断不计入现有测试累计。

### D-007 排版测试失败后源码继续变化，旧结果不能代表当前版本

本次恢复时先发现 `test/danmaku/danmaku-typography-browser.test.js` 偏离初始摘要；完整读取并执行当时的 205 行测试，结果为 1 通过、1 失败。运行前后测试摘要均为 `fbaa1c45…`，失败断言为青雾普通礼物请求字号 18、实际测得 30（`:196`）；原日志 `client-typography-tests-stage-134.log` 和 `typography-stage-134-revision.json` 保留，不修改断言或把失败改记通过。

随后观察到测试、青雾 CSS 和样式参数模块发生外部修改。新版普通礼物选择器仍指向正确正文；针对当时变化后源码的独立普通/舰长 sender × 18/30/40 六组测量均正确，但没有冻结整个诊断期间的源码，也未复验完整测试文件。失败瞬间的 CSS 未单独取摘要，因此不据此确认旧失败原因、当前产品缺陷或已修复。精确观测摘要、时间辅助证据与边界见 `stage-134-delegated.json`；其他并行弹幕修改按 `revision-queue-stage-138.json` 待新版本复核。第123批 D-006 的三处原失败仍独立保留。

第146批补充了当前修订的完整复验：全文读取210行排版测试（`4092690a…`）、474行前端参数、408行Node参数及295行青雾CSS，保存原字节快照；三次捕获的全部20项相关输入摘要相同，并与第139批队列一致。当前完整参数测试17项、完整排版测试2项共19通过、0失败（`agent-typography-revision-146/current-revision-tests.log`，6,211.7217ms）。这证明所选当前修订通过相应检查，不把旧 `fbaa…` 运行改记通过，也不声称审计者修复了旧原因。四项新修订全文审阅单列在 `revision-queue-after-stage-146.json`，其他16项只核对了测试输入摘要，仍需人工审阅；不以当前绿色结果替代真实桌面保存、动效播放或全20项验收。

第151/153批再补齐其余16项当前修订人工复核：11份CSS共3,274行声明，及feed、spooky、主入口、帮助片段与1,080行播放测试全文；所有20项输入仍与146批摘要相同。sketch的9份长SVG以保留行号声明和解码XML结构核对，不冒称人工评审美术路径。当前完整motion文件52项通过（`agent-danmaku-runtime-revision-153/current-motion-tests.log`，50,492.6387ms），包括实际打断、密集播放、文本稳定和缩放像素。`revision-queue-after-stage-153.json` 的20项当前摘要全文复核均完成，未把它们直接加到原始覆盖数，也未改写旧失败；真实桌面保存、真实直播和推流应用验收仍未包含在这些证据中。

### D-008 已确认并归入F-036

第159批只确认了码点/原生maxLength单位差异与程序化回填，未验证真实键入。第181批使用既有隔离浏览器夹具和真实editor/model，完成原生键入、文本插入、汉字/ASCII及已保存值对照，确认合法六个emoji只能录入三个。该线索现已归入F-036/P3，不再计为待验证问题；原159批的证据范围和历史诊断结果保留，未追改为当时已完成原生验收。

### D-009 启动失败清理顺序的技术文档漂移

客户端 `docs/reference/backend/server-core.md:176` 写明先停止runtime、关闭数据库和listener，再删除本实例的token/runtime文件；实际 `src/server.js:437-445` 先进入quiescing并删除这两个文件、清空sessionToken，再等待领域资源和HTTP listener释放。这是当前实现事实的顺序差异，没有据此确认未授权访问、端口复用或数据丢失。

现有 `test/server/server-cleanup-failures.test.js` 完整源码核对了最终释放、原始错误保留、重试和单次退出，但没有断言中间文件删除顺序；本批没有执行该测试。后续修复应先确认接受的生命周期顺序，再同步所属技术参考；不在只读审计中选择移动代码或改写规范。D-009不设业务缺陷严重级别，不增加F条目，用户操作说明无需新步骤。

### D-010 特效对象的schema允许空媒体URL

服务器 `docs/protocol/public-gifts-api.openapi.json:1574-1591` 的 `GiftVariantEffect` 要求两个URL键，但引用的 `GiftEffectMediaUrl:524-528` 允许null。现有纯Ajv helper的两次独立四对象核对均接受有效对象、mp4Url:null、layoutUrl:null，拒绝sourceEffectId:0对照；没有运行维护测试或HTTP。展开对象、日志与三项输入前后摘要见 `agent-public-gifts-schema-217/` 和 `null-effect-schema-stage-218-result.json`。

对实际特效对象，服务器reader `gift-variant-catalog.js:149-160` 拒绝空/非可信URL；公开礼物页的 `public/gifts/gift-variant-validation.js:195-227,528` 也拒绝，实际fetch链调用该校验器。这里的消费者属于服务器公开网页，不是Electron客户端。缺素材时整段effect:null、metadata保留effectId属于合法行为，不能全局收紧共享nullable URL。只确认schema较宽，没有据两个空URL对象确认生产坏包；F-037另有存储标量的独立重放。后续在GiftVariantEffect两个属性收紧非空约束并扩充既有schema helper对照即可，保留其他nullable媒体投影；本审计不修改规范或产品。

### D-011 画布区域列表及缺失区域兼容说明滞后

服务器 `docs/protocol/public-overlay-api.md:236` 的对象形状只列14个region键，兼容补齐只列moonlit/floating/comet/starlight，并称其他缺失拒绝。当前共享 `src/lib/overlay-layout.js:6–20,50–71` 定义25个区域、允许16个已知缺省区域并补齐；公开OpenAPI的OverlayLayout组件286–417列25个properties与9个旧必需键。完整added-styles样例含25个区域；同章232/242本身也明确允许prismatic/whiteframe缺省，故不能把236旧列表当当前完整合同。

仅登记技术文档漂移，不另加F或优先级。应将此处区域/兼容说明与当前owner或机器字段表对齐，保留未知键、边界校验与旧九区域输入；不要求缩减当前25区域，也不要求为账户本地新增样式建立服务器镜像。证据 `schema-layout-drift-adjudication-stage-244.json`：12样例与629 helper契约测试全文、owner选段61行、公开schema原始286–440选段；未运行validator/HTTP/浏览器，也未宣称3184行schema全文。本审计未改现行契约、业务或指南。

### D-012 SC 显示样式描述保留旧数量

服务器 `docs/protocol/public-overlay-api.openapi.json:2518` 的 `SuperChatEvent.description` 仍写只由六款固定样式显示。当前同属服务器的协议正文 `public-overlay-api.md:109` 已写支持SC的固定样式与青雾mist随机区域；实际 `public/overlay/app.js:401–405` 按不支持的随机/飘窗类型排除，renderer-core65–66交给SC renderer，后者58–65有twitter/ripploid/mist分支。旧六款颜色说明只限定其配色处理，不能作为“只有六款支持”的反证。

仅记录说明漂移，不新增F或优先级。后续将该description与已有能力规则对齐，避免固定旧数量；保留事件DTO、场次检查、不支持类型和撤回语义，不推断全部25样式都支持，也不要求镜像账户本地桌面样式。证据 `schema-superchat-drift-adjudication-stage-249.json`，来自完整公开schema、必要owner/协议选段与旧全文复用；没有当前播放、浏览器、validator或测试执行。本审计未改现行OpenAPI、业务、测试或指南。

### D-013 服务器专属入场标记与正常追加链的接线待验证

服务器Ripploid291注释声称只有append获得data-live-entry，292起用该标记启动wipe/文字/身份层；Twitter650起的分层时序也依赖它。第320批实际所读app114–137/210–221、feed33–71/126–184和message-renderer20–41没有看到标记赋值，public/overlay的JS/HTML字面量搜索也未找到producer。该线索有具体追加链，仍不能把搜索当所有代码/动态属性的全文证明。

反证是feed245–297仍有WAAPI行top移动，onfinish取消并清理motion，不能称完全无动画或无限spinner泄漏。现行public-overlay-api154–162明确要求两样式公开渲染、配置与造型，未明确该专属入场时序；源注释不足以单独确定legacy兼容要求或实际可见影响。父325只保留待验证项，不列F或优先级。后续先明确服务器motion预期，再按需要在正常append与snapshot播放中观察实际feed/renderer的class、动画和清理，保留共享移动对照；本轮未执行，也未把D-006/D-007旧失败改写成成功。证据deferred-d013-adjudication-stage-325.json。

### D-014 弹幕外观的联网同步与保存步骤说明滞后

客户端内置维护指南 `public/pages/admin/toolbox/usage-guide-reference.html:7-16` 把“弹幕姬已应用的样式和参数”列入随LIRA账号联网同步，并在14行要求旧“应用到直播画面”操作；18–25的本机清单没有该项。相关 `usage-guide-faq-broadcast.html:24` 明确指向“组件 → 弹幕姬”，也要求这个旧名称。当前正常面板 `public/pages/admin/live-components/danmaku.html:22,256` 说明外观保存在本机，按钮为“保存外观”；`public/js/admin/danmaku-overlay-settings.js:74,96,108` 与本地 `/api/danmaku/appearance` adapter一致。`src/server/scene-runtime.js:23` 将本地songDb store传给外观owner，`src/storage/danmaku-appearance-store.js:4-18` 按owner_scope在本地表读写；接受的 `docs/architecture/engineering/ai-workflow.md:44-48` 也明确本地外观、共享参数和旧服务器源的独立兼容边界。账号隔离的本地行不能据此描述为账号云同步。

反证与边界：旧输出预览 `public/pages/overlays/danmaku.html:237` 确实存在“应用到直播画面”，不能泛称全产品没有此按钮；FAQ27的场景结构修改仍需“保存并应用”，组件默认参数也不应据旧文案自动重发整个场景。OBS指南同时区分本地独立组件/场景与服务器弹幕地址，不能用legacy保存接口来解释未限定范围的本机外观备份分类。影响是用户换机时可能错误期待登录同一账号恢复外观，或在当前组件面板寻找旧动作；未复现实际换机、设置丢失、错误租户写入或保存失败，不另计代码F或优先级。

后续仅需在获授权的文案修复中对齐本机保存范围与当前按钮，保留且明确区分legacy远端设置和场景结构发布；不要为旧说明新增云同步、削弱账号归属或改变正确发布行为。添加具体备份/迁移步骤前，应核对现有支持能力。现行技术契约已正确表达归属，不需要修改实现合同；可按现有指南/markup检查保护分类和按钮名称，但字面断言及Markdown门禁不能认证真实桌面持久化。证据 `guide-appearance-drift-adjudication-stage-376.json`：372指南全文，父53行重叠重检，六份旧同SHA FULL上下文586物理行去重，另读现行规范7物理行；新增产品/测试/诊断执行0。本审计只登记说明漂移，未修改业务、测试、现行契约或用户指南。

### 已排除的线索

- 第332批礼物流金额标签线索排除：shared/scene-extra-components143–146的阈值以分存储、标签以元展示；实际scene-extra-preview98区分cents字段，113–115把输入min/max/step除100，125将编辑值乘100四舍五入，201读回时除100。不能只看字段定义认定金额放大100倍。仅源码反证，未运行控件/金额测试，也未修业务。证据root-partial-closures-332-review.json/C332-GIFT-FEED-CENTS-LABEL。

- `validSegment(text)`、`requestScene(action)`、`membershipConflicts(candidate, records)` 等少传参数由实现明确处理，不能按 JavaScript 形参数量判错误。
- 客户端 SVG 素材响应具有 `sandbox; default-src 'none'`；网页素材使用不带 `allow-same-origin` 的脚本 sandbox。没有仅因允许 SVG/HTML 就确认脚本取得桌面权限。
- Bilibili 凭据并发写入在现有 `test/credential-lifecycle.test.js` 明确采用“最后成功提交”语义；旧请求后完成不能脱离该契约直接判为竞态缺陷。
- 原生播放输出中的 `async void open` 虽然可在 C# 内部等待，但 main 的 `src/electron/playback-output.js` 串行等待每条命令回执；未建立跨 open 的迟到 catch 停掉新输出的真实可达链，暂不报告为缺陷。
- `StorageManager.saveState()` 的防抖 promise 有悬空线索，但未发现生产调用；实际保存 owner 是 `operations/state-persistence.js`，不能把旧方法的局部行为当成当前队列保存故障。
- 关闭礼物监听后，已接收 progress 仍结算 final 并在弹幕连接保留时显示，是 `test/independent-monitoring.test.js` 明确行为，不是关闭开关失效。
- WeSing monitor 在同实例 stop/start 间有旧 child 回调线索，但实际 capture engine 每次激活重新创建 monitor，并用 lifecycle version 丢弃旧样本；未建立生产同实例重用路径，不报进程泄漏。
- 每日机器人词库更新不递增开关 revision，是当前协议保留已记录结果与待发回复的明确要求；不能按其他配置的失效规则误判旧回复仍可发送。导入的完整快照、结果、receipt 和 takeover 在同一 immediate transaction 内提交，超时回收逐租户隔离；本批未确认部分提交缺陷。
- 评分的稳定事件 ID 整场保留用于防止同一事件重放，`interaction-rating-pressure.test.js` 明确验证 50,000 条带 ID 消息及结束后清理；当前真实入口不伪造稳定 ID。该选择有容量成本，但不能在不保留去重语义的情况下直接要求 FIFO 淘汰，也不能把普通重复分数误报为重复加权。
- 醒目留言手动删除通过 `superchat-receipt-migration.js` 的删除触发器保留去重凭证，不是单看 `superchat-store.setStatus()` 就能判定删除后会重放；`domain-services.js` 的清空入口也明确清除撤销批次。恢复使用 savepoint，现有失败测试验证留言和凭证一起回滚。
- 旧 `IdentityCache.resolve()/remember()` 有按昵称回退的线索，但生产身份入口由 `UserInfoService` 按 UID 合并，兼容缓存只经 `storeMerged()` 等接口使用；未找到旧合并函数的生产调用，不能据其局部行为确认同昵称用户继承舰长身份。
- 礼物审计缓存按 ID 首次接收，但真实最近记录查询仅返回 `final + gift_stats_eligible`；已完成事件不可变，因此未建立“首次缓存 progress 后漏掉 final 数量/金额”的真实链。清空按钮也明确只清空气泡与比对结果，不据此要求清空捕获缓存。
- 客户端盲盒统计/分析明确采用本机自然日，历史流水的北京时间边界是另一个接口的合同；现有测试覆盖本机时区切换和夏令时日期长度，不能将两类日期规则强行统一。

### 已执行的仓库检查

| 检查 | 实际结果 | 证明边界 |
| --- | --- | --- |
| 客户端 `npm run verify:architecture` | 29/29 通过 | 现有静态架构约束，不等于业务逻辑无缺陷 |
| 客户端 `npm run verify:docs` | 10/10 通过 | 此时的导航和结构，不是所有说明的语义一致性 |
| 客户端 `npm run verify:contracts` | 失败：要求服务器 `67119e81a3f5f49470ed2b191f6552556d0a704e`，实际为 `87f1c0de95f6b3096b79307923b43e436311742e` | 基线不匹配；未改锁文件、未重置服务器，不能宣称跨端契约门禁通过 |
| 两端 npm 依赖扫描 | 成功读取公告清单 | 不安装、不自动修复、不证明生产版本 |
| F-001/F-002 隔离复现 | 符合缺陷行为断言 | 解析栈/工具级，不是生产或真实桌面验收 |
| F-003 隔离复现 | 取消后实际调用顺序为 stop → open | 真实前端模块 + 替身桥，不使用声卡 |
| F-004 隔离复现 | 保存抛错但新规则已生效，revision/通知未更新 | 隔离 SQLite + TEMP trigger 故障注入，实际礼物结算验证 |
| F-005 隔离复现 | 续期后仍 authorized，云恢复完成却未恢复本地工作 | 两个真实模块、替身远端与定时器，不调用真实网络 |
| F-006 隔离复现 | SSE 入口保留动作/天数，本地场景缓冲输出丢弃 | 两个真实模块、合成内存 SSE，不连接上游 |
| F-007/F-008 隔离复现 | 不规范身份导致重复建档；坏屏蔽键恢复成功后读取失败 | 实际备份、持久化和消费者，隔离临时数据库 |
| F-009 隔离复现 | 账号/房间切换后，剩余 14 条迁移到新上下文 | 真实前端循环与发送服务，五个对照场景，替身 DOM/HTTP 桥/上游，无真实发送 |
| F-010 公开查询与隔离回放 | 200 首公开歌单的两页相同；客户端正常结束并仅缓存 100 首，正确分页对照为 200 首 | 匿名只读官方接口；集成回放无网络，不证明私人账号或所有上游响应形态 |
| F-011 隔离响应乱序复现 | 第二次背景已保存且旧文件已删除，第一次响应仍覆盖预览；顺序对照一致 | 生产背景控件代码段与真实保存服务，替身 DOM/传输、隔离 SQLite/文件，无真实浏览器或网络 |
| F-012 隔离歌词返回复现 | A→B→A 后旧 A 失败清空新歌词，并发布空时间轴/新代次 empty；A→B 对照保留 B | 真实播放/状态/歌词加载和发布模块，音频/HTTP 替身，无网络、服务器、WebSocket 或桌面 |
| F-013 隔离偏移草稿复现 | 保存 100 期间输入 700，旧成功响应将活动控件重置为 100，后续仍提交 100；正常顺序提交 700 | 真实 WeSingService 与初始化事件、共享歌词模块，DOM/时钟/HTTP 为替身，无服务器持久化、网络或桌面 |
| F-014 管理列表迟到读取复现 | 禁用及新列表刷新完成后，旧轮询将列表从 disabled 改回 active；正常顺序保持 disabled，两者各一次写入 | 复用现有 VM 夹具与实际管理脚本，合成请求/DOM/后端状态，无真实账号、网络或后端授权变化 |
| F-015 JSON 弹幕身份复现 | 同一资料改为 JSON 字符串后，交付、缓存和 feed 的已知舰长等级均从 3 变为 0，头像保持一致 | 当前生产解析、消息处理、用户信息服务和 feed；三组合成顺序，未连接平台或桌面 |
| F-016 开播媒体设置失败复现 | 上传返回 500，但选择已替换、名称仍旧且没有广播；旧文件未删除而旧 URL 返回 404，新 URL 返回 200 | 生产 HTTP/上传/设置/媒体链路、临时真实 SQLite 与第二键失败注入；正常替换及已有批量事务对照，无用户数据或真实播放 |
| F-016 主题预设 API 同类补证 | 第二键失败时返回 400，但第一键已持久化；重开连接仍混色，批量 setter 对照保持原值 | 生产路由 handler、theme/settings store 与真实临时 SQLite；正常 CRUD/应用、白名单、重复播种和批量回滚对照；不是实际桌面或当前静态预设卡片故障 |
| F-017 本地媒体清单重试复现 | 一次写盘失败后，同一文件重选返回成功且当前可解析，但不再写盘；重建 owner 后为 not-allowed，正常对照可恢复 | 生产清单/IPC 门禁和真实临时文件，合成窗口/对话框及一次写入故障；原有授权保留，不是实际 Electron 重启或音频播放验收 |
| 客户端 AI 工具、原生输出前端与 IPC 现有测试 | 17/17 通过 | 表明现有覆盖未捕获 F-002/F-003，不能作为其反证 |
| 客户端 WebSocket 资源与分块完整性 | 14/14 通过 | 包括空 continuation、UTF-8 分块、24/168 小时模拟及墙钟偏移，不是真实长时在线 |
| 服务器认证、凭据生命周期与 Device SSE | 51/51 通过 | 先执行同范围 `verify --plan`，再执行四个完整 Node 文件；未跑浏览器/生产 |
| 客户端播放快照、加班保存失败与礼物原子导入 | 49/49 通过 | 四个完整现有文件；未包含新增故障复现断言 |
| 客户端桌面就绪、授权续期/恢复/激活候选密钥 | 56/56 通过 | 四个完整现有文件；未覆盖 F-005 的跨模块等待时序 |
| 服务器独立监听、连接生命周期、启动隔离、礼物展示 | 47/47 通过 | 四个完整现有文件，使用仓库专用 Node 与 verify；不是真实 B 站在线验收 |
| 客户端场景云事件与展示缓冲 | 80/80 通过 | 两个完整现有文件；入口字段用例与 buffer 用例分开，未捕获 F-006 的跨层丢失 |
| 客户端礼物保留/恢复 | 13/13 通过 | 现有完整保留测试，含重启、增量、过期快照、迟到 final 和资格冻结 |
| 服务器礼物汇总、保留、Device 交付与维护 | 27/27 通过 | 四个完整现有文件，先 plan 后 verify；物理清理只操作测试数据库 |
| 客户端粉丝备份、事实同步与黑名单 | 22/22 通过 | 三个完整现有文件，未覆盖 F-007/F-008 的非规范备份输入 |
| 服务器发送调度、每日机器人运行/存储与固定回复 | 57/57 通过 | 四个完整现有文件，先 plan 后 verify；不代表真实 B 站发送或长时在线验收 |
| 客户端动态抽奖服务、采集、结果与请求调度 | 19/19 通过 | 四个完整现有文件，使用合成上游；未验证真实账号名单完整性 |
| 客户端小游戏、绘画、投票评分与转盘 | 46/46 通过 | 四个完整现有文件，含 24/168 小时虚拟评分、墙钟变化及互斥；未运行桌面视觉验收 |
| 客户端 AI 账号会话、模型适配与对话连续性 | 49/49 通过 | 四个完整现有文件，合成 OAuth/签名与模型响应；未登录真实账号 |
| 客户端播放持久化与状态动作 | 24/24 通过 | 两个完整现有文件，使用 VM 模块与隔离夹具；首次命令遗漏 `--experimental-vm-modules` 导致夹具无法加载，补正后通过，该启动错误不计产品缺陷 |
| 服务器盲盒结算、存档与公共游戏外壳 | 46/46 通过 | 三个完整现有文件，先 plan 后 verify；使用替身 IndexedDB 与 DOM，不代表真实浏览器视觉验收 |
| 客户端礼物许愿领域与路由 | 22/22 通过 | 两个完整现有文件，覆盖周期、身份、失效边界与格式迁移；未新增桌面视觉检查 |
| 服务器礼物活动发现与同步发布 | 40/40 通过 | 三个完整现有文件，先 plan 后 verify；合成官方脚本/规则与临时目录，不抓取真实活动或调用抽取操作 |
| 客户端醒目留言解析、删除与撤销 | 14/14 通过 | 两个完整现有文件，临时数据库，含撤回、重启去重、清空与恢复失败回滚 |
| 服务器目录发布、完整性边界、特效身份与标准化 | 23/23 通过 | 四个完整现有文件，先 plan 后 verify；隔离数据库和合成来源，不验证线上目录完整性 |
| 客户端歌词解析、请求恢复与来源切换 | 26/26 通过 | 四个完整现有文件，VM 模块与替身请求；未运行真实音乐客户端或桌面歌词窗口 |
| 服务器欢迎阶段、生命周期与 PK 播报/历史 | 40/40 通过 | 四个完整现有文件，先 plan 后 verify；合成事件、时钟、上游与数据库，不发送真实弹幕 |
| 客户端欢迎设置、PK 账号归属与控件 | 18 项通过，另 1 个测试文件加载受阻 | `pk-report-settings-ipc.test.js` 在加载服务器 fixture 时遇到上表同一固定版本不匹配；该文件中的 2 项用例未执行，不计通过，未改固定值或绕过门禁 |
| 客户端 AI 人格、共享提示规则与设置保存 | 69/69 通过 | 两个完整现有文件，使用隔离存储和 DOM/请求夹具；不证明真实模型能抵御所有提示词注入 |
| 服务器开播问候、房间变更与监听集成 | 52/52 通过 | 四个完整现有文件，先 plan 后 verify；合成会话、发送调度和时钟，不发送真实弹幕 |
| 客户端远程礼物目录、图片缓存与身份合并 | 34/34 通过 | 四个完整现有文件，替身 HTTP 与临时文件；包括同 ID 不同身份、失败保留、下载容量与停止后迟到响应 |
| 服务器进场、上舰解析与到期查询 | 16/16 通过 | 三个完整现有文件，先 plan 后 verify；合成协议与账号，未验证真实 B 站分页和资料完整性 |
| 服务器账号命名、管理员改密与主播资料写入 | 42/42 通过 | 三个完整现有文件，先 plan 后 verify；隔离数据库/HTTP/哈希夹具，未修改真实账号 |
| 客户端弹幕发送、会话取消、回复与去重 | 36/36 通过 | 四个完整现有文件，合成账号和发送；未覆盖 F-009 的前端跨请求批次归属 |
| 客户端弹幕重连、用户资料与榜单轮询 | 33/33 通过 | 四个完整现有文件，替身连接/请求与时钟，不代表真实平台长时在线验收 |
| 客户端 QQ/网易云歌单、响应与桌面音乐账号 | 54/54 通过 | 四个完整现有文件，替身请求/分区；现有分页用例未覆盖 F-010 的实际上游响应形态 |
| 服务器管理查询、历史、租户视图与设备凭据授权 | 25/25 通过 | 四个完整现有文件，先 plan 后 verify；隔离数据库和请求，不修改真实设备或账号 |
| 客户端首页分页、刷新、缓存与账号代际 | 10/10 通过 | 一个完整现有文件，VM 模块和替身响应；覆盖账号失效、旧响应和缓存归属，不是上游分页验收 |
| 客户端组件配置、批量保存、保存确认与场景文档模型 | 64/64 通过 | 四个完整现有文件，VM 模块；覆盖冻结提交、保存中编辑、确认、失败/重试、预检及几何/模板，不是桌面视觉验收 |
| 客户端画布发布、场景 SQLite 与本地 HTTP | 49/49 通过 | 三个完整现有文件，隔离数据库、加密器及回环服务；覆盖乐观版本、原子发布、归属、删除和失败保留 |
| 客户端共享外观、图层通知、预览通信与授权接口 | 36/36 通过 | 四个完整现有文件，合成时钟、请求及回环服务；增量响应保留 ack，重放只执行一次，旧页面 attachment 被拒绝 |
| 客户端共享参数、恢复草稿与预览续期 | 32/32 通过 | 三个完整现有文件，VM 模块/合成授权；续期保留预览，重授权、换账号、撤销与释放使旧能力失效，恢复不持久保存浏览器网址 |
| 服务器外观设置、账号能力与私有过滤路由 | 13/13 通过 | 两个完整现有文件，先 plan 后 verify；隔离账号与 HTTP 服务，验证旧配置兼容、非法写入不产生部分更新、跨账号和撤销拒绝 |
| 服务器过滤缓存、观众查询与外观参数/布局 | 23/23 通过 | 五个完整现有文件，先 plan 后 verify；验证租户缓存、上游等待后的账号/房间检查和参数边界，未登录真实平台 |
| 客户端素材库、索引恢复、备份迁移与清理 | 41/41 通过 | 四个完整现有文件，隔离文件/数据库及回环服务；含损坏 ZIP、错误入口、撤权、索引失败、恢复续作和锁定重试 |
| 客户端网页/CSS 素材上传、引用与读取 | 27/27 通过 | 一个完整现有文件，合成二进制流和回环服务；覆盖路径、分块、配套文件、页面隔离、权限重查和安装失败回收 |
| 客户端原生素材选择与目录收集 | 8/8 通过 | 一个完整现有文件，替身 dialog 与临时文件；验证个人目录/链接/深度边界和返回形状，未打开真实 Electron 文件选择框 |
| 服务器歌曲页背景、缺失版本与外观保存 | 20/20 通过 | 四个完整现有文件，先 plan 后 verify，临时目录固定在仓库 tmp；不覆盖 F-011 的前端响应乱序，也不是浏览器视觉验收 |
| 客户端测试选择、语法缓存与打包依赖 | 35/35 通过 | 三个完整现有文件，隔离夹具与合成 ASAR；覆盖重复/错误选择、旧运行结果、原生测试顺序、缓存输入变化及缺失依赖，不生成真实安装器 |
| 服务器验证范围、运行时、输入失效与预检 | 36/36 通过 | 四个完整现有 Node 文件，先 plan 后 verify；使用临时 Git 仓库与报告/执行替身，未运行浏览器或部署 |
| 客户端发布编排、重试与日志脱敏 | 20/20 通过 | 一个完整现有文件，构建、签名验收、Git 和 GitHub 命令均为替身；未构建、创建标签、上传或发布 |
| 客户端播放恢复、队列、账号失效与电台补歌 | 86/86 通过 | 四个完整现有文件，VM 模块、合成响应/音频与时钟；未覆盖 F-012 的同曲歌词延迟失败，不是实际设备或音乐账号验收 |
| 服务器星座/航线状态与独立清理 | 33/33 通过 | 三个完整现有 Node 文件，先 plan 后 verify；固定随机向量、合成存档与存储替身，包含清理后继续结算和累计成本边界 |
| 服务器成名之路与唤灵契约规则 | 31/31 通过 | 两个完整现有 Node 文件，先 plan 后 verify；覆盖纯状态转换、随机边界、奖励/消耗和存档矛盾，未运行游戏浏览器呈现 |
| 客户端导入、匹配、搜索、显示组件与缓存 | 34/34 通过 | 两个完整现有文件，VM 模块/DOM 与合成存储、响应；覆盖先去重后限批、失败重试、同歌不同请求、搜索顺序及 12/24/168 小时加速缓存回收，未运行桌面视觉验收 |
| 服务器秘宝合成、玲珑宝斋与合成工坊核心 | 57/57 通过 | 三个完整现有 Node 文件，先 plan 后 verify；固定随机输入、合成存档，覆盖费用/概率/保底结转、跨日保留、版本进度、历史与非法输入，无真实交易或浏览器运行 |
| 客户端输出设备、变速、播放器外观与 Provider 归属 | 21/21 通过 | 四个完整现有文件，替身音频/设备/IPC、DOM 与存储；不是实际声卡、ASIO 或桌面外观验收 |
| 服务器成名之路礼物库存与凭证 | 7/7 通过 | 一个完整现有 Node 文件，先 plan 后 verify；合成状态与固定随机，验证累计库存、结算唯一性和存档校验，未运行 view 或动画 |
| 客户端全民 K 歌设置、状态与播放诊断界面 | 11/11 通过 | 两个完整现有文件，VM/DOM、请求和导出替身；未覆盖 F-013 的保存完成与新输入交错，没有实际采样或写出诊断文件 |
| 客户端答谢/固定回复编辑与礼物交互同步 | 24/24 通过 | 两个完整现有文件，包括既有无外网 Chromium 夹具中的参数块、撤销、纯文本粘贴、失败保留和换账号检查，以及 main/IPC 模块测试；不是实际 Electron 授权或 B 站发送验收 |
| 服务器答谢模板、金额、分组、设置与 HTTP 入口 | 82/82 通过 | 六个完整现有 Node 文件，先 plan 后 verify；隔离 SQLite/回环服务、合成账号/礼物/时钟，含租户隔离、重开持久化、非法保存不部分提交和分段预算；无真实上游发送 |
| 客户端每日机器人词库与账号交错 | 5/5 通过 | 一个完整现有文件，既有 Chromium 路由夹具，覆盖搜索/分页、版本冲突、保存中继续编辑和换账号丢弃旧结果；云端桥和响应为替身 |
| 服务器工坊/宝斋页面与状态集成 | 36/36 通过 | 三个完整现有 Playwright 文件，先 plan 后 verify；真实隔离服务器与浏览器，独立数据目录/临时端口，含版本切换、进度/库存/记录、保存失败重试、快速替换动画和已有尺寸断言；不连接生产账号，未人工逐屏视觉验收 |
| 客户端欢迎参数、词库与用户欢迎词编辑 | 21/21 通过 | 一个完整现有 VM/DOM 文件，覆盖独立草稿、保存中继续编辑、版本能力、回包确认、非法参数与换账号；本批新执行，未重跑先前受阻的 PK fixture 或真实桌面 |
| 客户端礼物审计页面、解析与交叉比对 | 6/6 通过 | 一个完整现有 VM/DOM 文件，包含真实 ES Module 连接和 snapshot.state 消费；WebSocket、HTTP 和 DOM 为替身，未运行真实桌面或 B 站气泡采集 |
| 服务器盲盒媒体、播放队列、后台推进与历史 | 32/32 通过 | 四个完整现有 Node 文件，先 plan 后 verify；替身视频/图像/时钟与存储，含取消、迟到解码、八次容量、后台时间跨片段、缓存/格式失败及历史保留；本批未运行依赖完整媒体素材的浏览器播放用例 |
| 客户端盲盒分析工作区、日期与查询范围 | 16/16 通过 | 两个完整现有文件，隔离 SQLite、VM/DOM 和可控时钟，含单月日历、查询防抖/取消、日期校验、跨月与夏令时；不是真实 Electron 视觉验收 |
| 客户端礼物历史、恢复、选择、导出与查询 | 36/36 通过 | 六个完整现有文件，隔离 SQLite、VM/DOM 和既有无外网 Chromium 夹具；覆盖游标/版本绑定、排序、取消、跨页选择、冻结导出与部分失败；导出桥为替身，未写出真实桌面文件 |
| 服务器点歌命令复制、排队与提示生命周期 | 15/15 通过 | 一个完整现有 Node 文件，先 plan 后 verify；替身 DOM、时钟与剪贴板，覆盖去重、容量/等待期限、失败恢复及焦点归属；未写入系统剪贴板或发送 B 站弹幕 |
| 服务器公共歌单、歌手筛选与长列表呈现 | 26/26 通过 | 两个完整现有 Playwright 文件，先 plan 后 verify；独立数据目录/临时端口，浏览器路由提供约 5,000 首歌曲的合成快照，覆盖滚动、筛选、焦点、尺寸变化与缺失 observer；不证明真实账号/后端查询或剪贴板集成 |
| 客户端礼物导出控制器与 IPC 边界 | 10/10 通过 | 一个完整现有文件，临时目录固定在仓库 tmp，验证目录/文件防覆盖、取消、来源失效、部分失败保留和非法 IPC 来源；BrowserWindow、PNG 捕获及文件选择器为替身，未执行真实 Electron 渲染脚本 |
| 服务器密码重置码的读取与操作归属 | 13/13 通过 | 一个完整现有 Node 文件，先 plan 后 verify；VM 与延迟响应，覆盖换主播/标签、请求序号、旧操作完成及已删除主播的明文清理，无真实账号 |
| 服务器改密、移除与页面秘密清理 | 16/16 通过 | 两个完整现有 Playwright 文件，先 plan 后 verify；隔离服务和浏览器路由夹具，覆盖重复提交、确认/取消、失败重试、迟到结果、明文清理和已有尺寸断言，API 与剪贴板为替身 |
| 服务器管理状态与审计格式的既有缓存结果 | 2 个文件的有效成功结果被 verify 复用 | 先 plan 再 verify，输入未变，0 文件重新执行；不增加本次执行的测试计数，也未覆盖 F-014 的列表回包交错 |
| 客户端礼物卡片、身份资料、展示参数与滚动状态 | 56/56 通过 | 五个完整现有文件，VM/可控时钟和既有无外网 Chromium 夹具；覆盖历史金额累加、合并后门槛、头像并发/期限、午夜/来源失效、条件读取、换行更新、节点复用及一万条记录的可见行上限，不是真实 Electron 或直播软件运行验收 |
| 服务器礼物工作区、日期筛选与快照下钻 | 20/20 通过 | 两个完整现有 Playwright 文件，先 plan 后 verify；独立服务/临时端口和路由合成数据，覆盖查询/分页状态保留、日期校验/键盘、首尾日期、快照过期/重试和迟到下钻隔离，不证明真实账号或后端统计计算 |
| 客户端礼物面板、冲刺与目录更新提示 | 15/15 通过 | 三个完整现有文件，VM/合成事件与既有无外网 Chromium 夹具；覆盖按变化键渲染、连接状态、冲刺重连/重置、目录旧启动响应、单提示更新及退出清理，不是真实采集或 Electron 授权验收 |
| 服务器礼物构成与趋势计算 | 16/16 通过 | 两个完整现有 Node 文件，先 plan 后 verify；合成记录与公开契约夹具，覆盖已知/未知成本、完整分母、版本身份、字段校验、日期桶、空值/均值和曲线不越界，未连接真实平台 |
| 服务器礼物构成图、独立范围与动画清理 | 17/17 通过 | 一个完整现有 Playwright 文件，先 plan 后 verify；隔离服务与浏览器路由，合成记录经实际统计模块派生，覆盖两类管理界面、完整占比、迟到结果、范围保留、快速切换/减少动效、错误恢复与安全文本，无真实账号和生产数据 |
| 客户端盲盒映射、主题与许愿文案编辑 | 50/50 通过 | 四个完整现有文件，VM 和既有无外网 Chromium 夹具；覆盖房间切换/错房重试、配置草稿保留、精确主题、文案参数块、撤销/格式、纯文本粘贴及来源失效，剪贴板事件及保存为合成替身，不是真实 Electron 授权验收 |
| 服务器采集账号存储、扫码与授权提交 | 8/8 通过 | 三个完整现有 Node 文件，先 plan 后 verify；隔离文件/身份库、合成上游与延迟提交，覆盖加密/重开、错误替换保留、取消/过期/权限复核、二维码归属及仅一次保存/刷新，无真实 Cookie、扫码或公开上游请求 |
| 服务器管理设备的 IP 信息读取 | 2/2 通过 | 一个完整现有 Node 文件，先 plan 后 verify；仓库 tmp 内的数据库与回环服务，上游位置查询为替身，验证允许字段、认证、当前存储 IP 与失败降级，不改变设备授权状态 |
| 服务器采集账号与管理礼物页面 | 12/12 通过 | 两个完整现有 Playwright 文件，先 plan 后 verify；隔离服务/临时端口和合成接口，覆盖页面权限、扫码取消/迟到、错误恢复、主播切换及礼物页状态保留，不是生产账号或真实扫码验收 |
| 客户端字体下载、缓存、菜单与实际字形 | 19/19 通过 | 六个完整现有文件，合成下载、仓库临时目录与本地 HTTP/无外网 Chromium；覆盖源地址及摘要/体积校验、样式更新次序、可用字体及旧选择保留，并实际加载九个内置字体和多语言/字重回退；本地字体枚举为替身，不是 Electron 系统权限或公网下载验收 |
| 服务器首页统计、舰长快照同步与到期接口 | 18/18 通过 | 四个完整现有 Node 文件，先 plan 后 verify；隔离数据库、worker、回环服务与合成上游，覆盖整日时间窗、租户范围、整数金额、并发同步/取消/超时、房间变更、过期快照和撤销复核，无真实账号或生产数据 |
| 服务器首页、舰长名单与管理导航 | 21/21 通过 | 一个完整现有 Playwright 文件，先 plan 后 verify；隔离服务和路由夹具，覆盖初次同步、缓存保留、计数/涨幅、到期状态、导航及失败恢复，不证明真实平台账号或公网接口行为 |
| 客户端授权、桌面与音乐 IPC | 21/21 通过 | 三个完整现有文件，以假的 ipcMain、窗口、远端和系统目录打开操作验证真实注册器；覆盖窗口/主帧/来源、参数与返回字段白名单、错误脱敏、账号代次及资源检查限制，未控制真实桌面窗口、打开用户目录或修改系统剪贴板 |
| 客户端授权重试、唤醒与设备指纹 | 13/13 通过 | 三个完整现有文件，使用可控时钟、假的 powerMonitor/系统命令/safeStorage 和仓库临时目录；覆盖重试耗尽与期限、恢复/移除监听、密钥密文持久化和指纹仅输出摘要，不是实际机器指纹采集或 Electron 加密存储验收 |
| 服务器歌单标题与二维码接口 | 42/42 通过 | 两个完整现有 Node 文件，先 plan 后 verify；隔离身份/租户库、回环服务、合成头像和上游，覆盖标题校验/默认值/独立保存、认证、二维码校验/修复/替换恢复、头像限制和上下文变更，无真实平台账号或公网下载 |
| 服务器共享房间与账号资料缓存 | 5/5 通过 | 一个完整现有 Node 文件，先 plan 后 verify；注入租户上下文、时钟和上游，验证公共读取不查询登录资料、同域请求合并、失败独立重试及替换/删除后丢弃旧结果，未访问真实身份库或平台 |
| 服务器二维码预览、导出与独立解码 | 18/18 通过 | 一个完整现有 Playwright 文件，先 plan 后 verify；在仓库临时目录生成实际二维码，用合成头像和路由替身验证 PNG 导出/预览一致、jsQR 独立解码、迟到转换隔离、blob 释放、失败重试及应用 CSP；复制接口为替身，不是系统剪贴板验收 |
| 客户端抽奖与舰长到期专用账号 | 22/22 通过 | 四个完整现有文件，假的 Electron 会话/窗口、合成凭据与仓库临时目录；覆盖独立分区及加密快照、临时账号清理、身份切换/取消、正常续期、串行登出、IPC 来源和公开字段，未打开真实登录窗口或读取用户 Cookie |
| 客户端通用 Bilibili 登录与 Cookie 转换 | 19/19 通过 | 四个完整现有文件，以假的 safeStorage、会话、窗口和上游验证快照/旧明文清理、无加密时不降级、登录完成/失败的监听清理、子帧失败、导航限制及公开资料结果，不是实际 Electron 登录或系统加密存储验收 |
| 客户端主题、原生提醒、每日机器人与档案 IPC | 35/35 通过 | 四个完整现有文件，仓库临时目录、可控时钟及假的通知/窗口/业务服务；覆盖主题串行原子保存与失败保留、提醒校验/去重/唤醒/释放、主帧与参数限制、账号上下文及迁移重试，不发送系统通知或访问真实档案 |
| 客户端桌面凭据操作队列与诊断 | 9/9 通过 | 一个完整现有文件，以 VM 和合成云端/账号检验真实控制器；覆盖退出期间的旧读取、排队写入复核、交互登录不被后台导入打断、身份往返、取消及固定安全日志，无真实网络、Cookie 或登录窗口 |
| 服务器凭据提交、WBI 与上游发送 | 48/48 通过 | 两个完整现有 Node 文件，先 plan 后 verify；VM 上游、内存租户/身份库和假的 WebSocket，覆盖跨库失败后的停旧连接/重试、租户事务回滚、凭据快照失效、公开 WBI 缓存与一次刷新、认证 UID/租户范围、取消及错误响应体释放，未连接 Bilibili |
| 客户端在售礼物解析与快照 | 7/7 通过 | 一个完整现有文件，合成面板/配置、可控时钟及仓库临时目录；覆盖红包/大航海购买项排除、未知 ID 保留、同名产物按价格匹配、房间校验、缓存与旧快照兼容，无公网请求或真实直播间数据 |
| 服务器活动身份、归档与目录发布 | 26/26 通过 | 三个完整现有 Node 文件，先 plan 后 verify；隔离目录库、合成主源/房间/效果及回环 HTTP，覆盖身份重用、投影/归档事务、独立奖池、错误关系拒绝、缓存新鲜度、索引读和完整响应 ETag，未连接平台 |
| 服务器种子、房间补全与活动估值 | 37/37 通过 | 五个完整现有 Node 文件，先 plan 后 verify；仓库临时清单/数据库和合成采集源，覆盖历史种子去重、资源不跨身份继承、主源/零值保留、采样上限与并发、歧义保持未知、实付与标价区分，以及已结算身份/金额冻结，无真实账号或外部请求 |
| 客户端盲盒、礼物特效与答谢配置 | 35/35 通过 | 四个完整现有文件，合成请求、VM、广播替身与隔离 SQLite；覆盖配置归一化、缓存与并发加载、旧设置兼容、特效阈值、预览参数及答谢字段投影，未启动桌面或播放素材 |
| 服务器盲盒来源、发布容量与概率 | 39/39 通过 | 四个完整现有 Node 文件，先 plan 后 verify；合成上游与隔离数据库，覆盖完整身份匹配、关系持久化与回滚、容量满时延后新奖池、维护快照概率及收益计算，不验证平台当前实时概率 |
| 客户端弹幕资料、礼物身份与交付 | 26/26 通过 | 三个完整现有文件，合成元数据、protobuf 与内存用户信息服务，覆盖头像/表情安全地址、身份提示和当前房间证据；未覆盖 F-015 的对象/JSON 联合情况 |
| 服务器特效命令与 Device 传输 | 4/4 通过 | 两个完整现有 Node 文件，先 plan 后 verify；合成主播/设备、隔离数据库和回环 HTTP/SSE，覆盖完整数字命令、按租户订阅、能力协商与不写礼物账本，未请求上游 |
| 客户端平台辅助服务与自定义回复 | 28/28 通过 | 六个完整现有文件，合成 fetch、可控时钟及隔离 SQLite；覆盖 WBI 共享/失效代次、房间舰徽人数与取消、名单分页、获胜者资料回退、诊断脱敏，以及云端精确命令不重复触发本地回复，无真实平台请求 |
| 服务器礼物查询、称呼与机器人状态 | 99/99 通过 | 四个完整现有 Node 文件，先 plan 后 verify，全部实际执行；隔离数据库、真实查询 worker 和合成发送时钟，覆盖查询容量/结算等待、历史清空与代次、日期标签、称呼持久化及排队确认、独立监控开关，未发送真实弹幕 |
| 客户端本地实例、生命周期与 overlay HTTP | 39/39 通过 | 四个完整现有文件，隔离临时目录、回环 HTTP 和测试创建的 Node 子进程；包含真实 Windows TCP/进程归属查询、同 socket 令牌交付、PID 复用拒绝、请求排空和页面能力/字段投影，无跳过项，不控制用户运行中的应用 |
| 服务器 overlay 接入与版本资源 | 5/5 通过 | 两个完整现有 Node 文件实际执行，先 plan 后 verify；隔离数据库、合成租户、回环 SSE 与临时资源，覆盖租户/IP/全局上限、失败及断开后的释放，以及资源版本、启动快照和条件缓存 |
| 服务器 overlay 礼物图片的既有成功结果 | 1 个文件有效缓存，未重跑 | verify 复用 `overlay-gift-image.test.js`；另全文核对其生产 helper 与测试，按已结算完整身份选择无凭据 CDN 地址，不增加新执行计数 |
| 服务器入口、配置、关闭与诊断 | 70/70 通过 | 十个完整现有 Node 文件，先 plan 后 verify，全部实际执行；隔离生产模式子进程、数据库、回环 HTTP 与合成时钟，覆盖导入不启动资源、原始 Host 边界、HTTPS/Secure Cookie、配置数值、关闭顺序/期限及日志隐私，无真实部署或上游请求 |
| 客户端开播媒体与独立配置 | 17/17 通过 | 四个完整现有文件，隔离目录、回环 HTTP、八个流测试子进程和 VM；覆盖路径/签名、样式槽位、清除选择、打开/读取失败及中途断开，未覆盖 F-016 的第二键提交失败，未验证实际音频或动画播放 |
| 服务器密码重置、设备证明与历史分页 | 23/23 通过 | 六个完整现有 Node 文件，分两组先 plan 后 verify，均实际执行；隔离数据库、合成密码/密钥、回环 HTTP/SSE，覆盖一次性与尝试上限、旧登录失效、原始证明拒绝且不消耗 challenge、条件续期、分页令牌绑定/轮换/过期、固定快照和租户清库，不连接真实账号或上游 |
| 客户端歌库导入、歌曲匹配与冷却 | 90/90 通过 | 七个完整现有文件，内存/仓库临时 SQLite、VM 和假的 Provider；覆盖预览与提交绑定、容量/重复项、替换回滚与关联保留、旧界面响应丢弃、CSV/XLSX 文本策略、匹配门槛/版本及冷却持久化与账号隔离，未执行真实桌面导入或音乐平台请求 |
| 客户端桌面资源、媒体与目录迁移 | 40/40 通过 | 八个完整现有文件，仓库临时目录、真实文件/SQLite WAL、Windows junction、VM 与 Electron 替身；覆盖来源/路径/Range、唯一请求头监听、迁移锁/失败保留、资源清单/读取变化/取消/期限及状态投递，无跳过项；未覆盖 F-017，不是实际打包应用验收 |
| 服务器传输包、礼物解析与检测恢复 | 53/53 通过 | 四个完整现有 Node 文件，先 plan 后 verify，全部实际执行；合成压缩包/protobuf、多产物夹具、隔离数据库与可控时钟，覆盖解码拒绝/诊断、身份和数量兼容、六秒等待、租户隔离、提交回滚与发布失败恢复，未连接 Bilibili 或证明上游零丢失 |
| 客户端日志写入、整理与桌面诊断 | 21/21 通过 | 六个完整现有 Node 文件共20项，加一个真实 Electron 43.8.3 用例；覆盖脱敏后的控制台/文件一致性、UTF-8 长度、轮转/过期、旧错误提取与失败保留、来源和监听清理，以及测试页面错误/Promise 拒绝/预加载失败/加载失败/渲染进程崩溃落盘；临时用户目录、隐藏测试窗口和自建回环页面，不加载 LIRA 主入口 |
| 服务器估值复用、映射与通知隔离 | 40/40 通过 | 五个完整现有 Node 文件，先 plan 后 verify，全部实际执行；合成目录/protobuf、隔离 SQLite、可控时钟及假的 WebSocket/发送队列，覆盖身份匹配复用、映射/冻结/恢复、迟到差额及未知成本、正式监听不选旧配置、批量分发和答谢失败/满载时账本一致性，不发送真实弹幕；已有活动匹配和答谢成功结果未重跑 |
| 客户端远端礼物游标、恢复与提交 | 40/40 通过 | 五个完整现有 Node 文件，隔离 SQLite、假的授权 API/SSE 与时钟；覆盖稳定账号身份、跨账号旧响应丢弃、分页/epoch 校验、事务回滚、提交后效果失败、静默对账和重连取消，不连接真实服务器或启动桌面 |
| 服务器礼物交付与卡片资料读取 | 20/20 通过 | 四个完整现有 Node 文件，分两组先 plan 后 verify，全部实际执行；隔离租户/数据库和回环 HTTP/SSE，覆盖字段白名单、分页缺口与已裁剪前缀、空 outbox 水位、连接接管/清理、今日资料分页与修订失效，不访问真实直播间 |
| 服务器 IP 归属查询与资源限制 | 17/17 通过 | 两个完整现有 Node 文件，先 plan 后 verify，全部实际执行；仅使用假的两家 HTTP 响应、合成 HTML/地址与可控时间，覆盖非公网拒绝、回显地址、字段投影、正文上限、共享并发/排队超时、独立缓存及过期重试，无真实外网查询 |
| 天气工具的既有成功结果 | 有效记录，未重跑 | 核对 `client-ai-output-tests.log` 与原批次记录，天气配额耗尽、空地点、连接格式错误、发送前取消和发送后取消仍由现有成功结果覆盖，不增加执行计数；本批另对天气工具和密钥 codec 做语法检查，未验收真实天气账号或系统加解密 |
| 客户端音乐登录窗与屏幕取色 | 9/9 通过 | 两个完整现有 Node 文件，VM、Electron/屏幕/图像替身与合成状态；覆盖初次加载前关闭、最终鉴权失败、子框架失败、Cookie 突发合并、取色 IPC 来源/参数、缩放坐标、取消后旧捕获丢弃和资源清理，未打开真实登录页或截取用户屏幕 |
| 服务器昵称注音字典边界 | 3/3 通过 | 一个完整现有 Node 文件，先 plan 后 verify，实际执行；核对全部3,500个本地常用字、14个名字补充字和已知歧义/字典缺口，无远端查字；既有欢迎阶段及机器人成功结果未重跑 |
| 服务器歌曲字段、事务与快照预算 | 51/51 通过 | 五个完整现有 Node 文件，先 plan 后 verify，全部实际执行；隔离 SQLite、合成租户/凭据及回环 HTTP，覆盖 canonical 投影、Unicode 截断、描述性价格、5,000首、版本/来源标记失败回滚、实际 UTF-8 JSON 快照8 MiB预算、缓存失效及六个正式写入口的413，无真实账号或完整桌面同步 |
| 客户端系统指标与硬件资料 | 13/13 通过 | 一个完整现有 Node 文件，使用假的命令、时钟与硬件；覆盖 GPU 启动耗时/超时、静态缓存与结果复制、按需温度、显存饱和值、系统版本、显示器缩放/刷新及字段投影，未调用真实 PowerShell、NVIDIA 驱动或桌面应用 |
| 服务器礼物查询 worker、快照与维护 | 32/32 通过 | 五个完整现有 Node 文件，先 plan 后 verify，全部实际执行；假的与真实 worker、隔离数据库、合成2万行数据和八租户，覆盖配额/轮转/期限/取消、崩溃次数、读句柄释放、清空/删除交错、签名/加密快照、固定成员分页与日期边界，无真实租户或部署验收 |
| 客户端 overlay 能力投影 | 13/13 通过 | 一个完整现有 Node 文件，内存游戏 owner、VM 和真实共享礼物 banner 模块；覆盖各 scope 的快照/HTTP/WS 白名单、嵌套字段隔离、游戏答案/评分阶段隐藏、总额/表情/撤回及配置字段，不是实际浏览器源播放验收 |
| 服务器云端状态提交与协调 | 30/30 通过 | 四个完整现有 Node 文件，先 plan 后 verify，全部实际执行；隔离/内存 SQLite 与假的目录、监控和登录验证，覆盖租户事务、镜像失败、显式清房、异步连接复核/保留/释放、配置兼容、官方接管及单租户协调失败，不访问真实平台账号 |
| 客户端 XLSX 编解码资源边界 | 32/32 通过 | 一个完整现有 Node 文件，内存 ZIP/DEFLATE/XML 与假的导入上下文，覆盖实际解压额度、目录/CRC/描述符、稀疏列/行/文本预算及失败后无写入；另用两份合成双表文件与独立读取器确认 F-018，不计入现有测试通过数 |
| 服务器账本查询与索引迁移 | 8/8 通过 | 三个完整现有 Node 文件，先 plan 后 verify，全部实际执行；隔离/内存 SQLite，覆盖跨字段金额聚合、未知成本、房间/身份/水位范围、待定对象、六千行深分页与同时间游标、只读连接，以及索引重复初始化/备份恢复不改账本和 epoch |
| 客户端全民 K 歌缓存、采集源与歌词兜底 | 39/39 通过 | 四个完整现有 Node 文件，合成 UTF-16/QRC、受限大文件读取替身与假的歌词 Provider；原生用例在 Windows 编译并执行生产 C# 遍历，仅替换 COM 设备来源，覆盖多设备/其他进程/设备失败和峰值，不操作真实播放器、声卡或账号 |
| 服务器礼物互动持久化重开 | 2/2 通过 | 一个完整现有 Node 文件，先 plan 后 verify，实际关闭并重开隔离 SQLite，覆盖一秒/六秒停机、设置/账本/去重保留、旧答谢不恢复、剩余 final 静默期、旧会话/epoch 回调失效和新答谢启动静默；旧业务组通过结果复用未重跑 |
| 客户端设置启动事务与检查点 | 8/8 通过 | 一个完整现有 Node 文件，隔离真实 SQLite、故障触发器与连接重开，覆盖默认值稳定、版本写入失败回滚/重试、字体仅迁移一次和用户字号保留；另有生产服务保存后重启的 F-019 合成复现，不计入既有测试数 |
| 服务器歌曲价格文本迁移 | 2/2 通过 | 一个完整现有 Node 文件，先 plan 后 verify，内存/隔离真实 SQLite，覆盖 REAL→TEXT、原行与索引保留、重复初始化和表达式索引重建失败后恢复原 schema；未扩展为任意手工修改 DDL 的兼容保证 |
| 客户端保留期、清空矩阵与运行时恢复 | 14/14 通过 | 三个完整现有 Node 文件，隔离真实 SQLite、故障触发器、提交/回滚替身及真实领域上下文，覆盖 dry-run/期限边界、最长歌曲冷却、配置保留、默认行回滚、部分提交、暂停所有权、重载/恢复失败和成功重试；不使用用户库或运行中的桌面应用 |
| 服务器 SC 最小存储与观众采样保留 | 8/8 通过 | 两个完整现有 Node 文件，先 plan 后 verify，隔离租户 SQLite、合成 SC/采样与日期替身；覆盖仅保存不透明去重键、重开/租户隔离、旧 SC 内容原子移除、1,000 条边界/旧库升级、重复初始化及清理失败回滚；称呼相关旧99项结果复用未重跑 |
| 客户端主题字段归属 | 1/1 通过 | 只按名称筛选一个既有 Node 用例，真实 HTML/CSS 与 VM 配置模块验证当前风格字段隔离、独立字体和持久化白名单；其余同文件用例未执行，F-016 补证的临时 SQLite 脚本另计 |
| 服务器 Admin/云端房间兼容 | 11/11 通过 | 一个完整现有 Node 文件，先 plan 后 verify，隔离数据库、替身监控/登录验证及回环 HTTP；覆盖共享 revision、监控原位更新、相关写入回滚、可选字段保留、规范房间优先、凭据适配等待，未调用真实平台 |
| 客户端加班机参数与数量边界 | 15/15 通过 | 两个完整现有 Node 文件，隔离 SQLite、假时钟、随机数替身和 VM；覆盖时间/因子/总权重边界、图片 origin 迁移、十万件完整结算与去重、超限整笔 pending 和提示，不是桌面或浏览器源播放验收 |
| 服务器礼物显示资料与迁移 | 4/4 通过 | 一个完整现有 Node 文件，先 plan 后 verify，隔离租户 SQLite、合成 V2 包和回环 HTTP/SSE；覆盖可靠身份来源、未知资料保留、迁移重复执行、可选能力和组内资料冻结；特效开关复用既有云端状态组结果 |
| 客户端外部网易云/QQ 采集与原生读数 | 27/27 通过 | 三个完整现有 Node 文件，假监控/时钟/歌词与 Windows 编译执行的生产 C# 读取逻辑；覆盖时钟交接、seek/暂停、迟到结果、停止、快照隔离和合成内存的签名/身份/读数边界，不读取真实播放器或系统媒体会话 |
| 服务器备份 worker 交接与关闭 | 6/6 通过 | 一个完整现有 Node 文件，先 plan 后 verify；假计时器/worker 事件及一个真实 worker，覆盖不重叠、禁用、失败重试、空完成、关闭等待和隔离路径的独立 SQLite 快照；另四个入口的语法检查不计入测试数 |
| 客户端数据目录迁移与桌面资料保留 | 22/22 通过 | 三个完整现有 Node 文件，临时文件/日志故障、假的启动环境及真实 Electron 子进程；覆盖迁移续作、冲突/活动服务、日志有限重试和持锁时序，实际验证默认及音乐分区 Cookie、localStorage、safeStorage 和第二实例锁，不迁移真实用户资料 |
| 客户端 QQ 加密流代理 | 16/16 通过 | 一个完整现有 Node 文件，真实 Node/WHATWG 流、假的 fetch/时钟/解密器；覆盖实际正文偏移、无效范围、64 MiB 实收额度、断开、读超时、背压和释放，不验证真实 CDN、QMC 算法或音频播放 |
| 客户端共享外观契约与效果生命周期 | 27/27 通过 | 三个完整现有 Node 文件，含四项真实隔离 Chromium 测试；覆盖逐样式范围/默认值、镜像、Unicode/字体、配置及投影往返、效果目标、飘窗动画组合、像素/透明区域、隔离 iframe、动态消息和清理；独立只读镜像检查不计入27项 |
| 客户端机器人默认值与命令归属 | 4/4 通过 | 一个完整现有 Node 文件，隔离 SQLite，覆盖默认词库完整/去重及本地精确命令不写库、不回复；另有五种时间输入经生产解析器、价格文本0经 CSV 和 Unicode 截断的合成检查，不计入4项；旧90项导入/匹配结果复用 |
| 客户端显示通知与前端恢复 | 46/46 通过 | 两个完整现有 Node 文件，本地通知响应/时钟替身与前端 VM/WHATWG 流；覆盖访问重验、合并、容量、撤销、迟到读取、版本回执、大小/时间边界、退避及清理；旧49项发布/HTTP结果复用，不是本次真实网络或浏览器验收 |
| 客户端粉丝档案页面选择与操作交付 | 27/27 通过 | 一个完整现有 Node 文件，现有 DOM 夹具及隔离 SQLite；另五场景的生产冲突处理/选择复现确认 F-020，合成 IPC 交付延迟，不计入27项，也不是原生 Electron 调度验收 |
| 客户端歌库编辑与筛选 | 25/25 通过 | 三个完整现有 Node 文件，含12项真实隔离 Chromium 检查；覆盖5000行、事件委托、编辑草稿、删除/替换后的完整列表语义、筛选候选和文本参数；请求与后端状态为替身，旧90项导入/匹配证据复用 |
| 客户端世界地图时间与生命周期 | 24/24 通过 | 三个完整现有 Node 文件，11项时区/目录/标签布局、8项天气假时钟及5项真实隔离 Chromium；覆盖换日、夏令时、排序/取消、菜单目标与实际 CSS 动画，地球及天气在浏览器中为替身，未验收真实 GPU 或气象服务 |
| 客户端共享直播歌词渲染与换句 | 24/24 通过 | 三个完整现有 Node 文件，20项 Node/DOM/动画替身及4项真实隔离 Chromium；覆盖时间定位、预载逐字、连写文字、可见行、隐藏/seek、换句续接及实际填充/暂停/对齐/换行/配色；未连接真实播放器或推流应用 |
| 客户端公共弹幕布局与生命周期 | 60/60 通过 | 三个完整现有 Node 文件，51项真实隔离 Chromium 动效播放及9项随机/飘窗 Node 检查；覆盖双向滚动、缩放、密集混合消息、文本像素、打断、过期、重排和销毁；不代替真实直播与人工审美验收 |
| 服务器旧在线弹幕布局与清理 | 74/74 通过 | 两份完整 Node 文件21项及两份完整浏览器文件53项；先同范围 plan 再 verify，隔离数据库/进程与合成 SSE/消息，覆盖密集到达、重连、停播、撤回、首次截止时间、随机淡出与飘窗；不要求镜像客户端样式，也不是线上验收 |
| 服务器礼物目录校验与展示分组 | 21/21 通过 | 三份完整 Node 文件新执行，另一份完整目录文件复用有效记录且不重计；实际浏览器模块与合成目录检查筛选/分页、完整证据分组、改名改价、原身份详情和输入保留；未作真实目录、网络或视觉验收 |
| 服务器礼物目录页面与历史导航 | 50/50 通过 | 三份完整现有浏览器文件，实际页面/模块与合成 API；覆盖搜索次数、筛选分页、兼容入口、快照保留、多次访问的独立位置、加载/失败及迟到资料；不作为真实目录或生产权限验收 |
| 服务器共享下拉与表单提交 | 12/12 通过 | 两份完整现有浏览器文件，覆盖原生值/验证/事件、选项刷新、禁用、挂载与移动价格菜单；另四场景的实际管理页隔离复现确认 F-021，不计入12项，所有发码请求拦截拒绝 |
| 客户端共享下拉与保存表单 | 10/10 通过 | 两份完整现有文件：7项 VM 菜单生命周期和3项真实隔离 Chromium 展示板检查；另四场景的授权 Electron 实际主题表单检查扩充 F-021，设置写请求全部拦截拒绝，不计入10项 |
| 客户端引导与初始化顺序 | 23/23 通过 | 两份完整现有 Node/VM 文件，覆盖首次展示记录、当前步骤配置、定位、退出面板及启动/失败恢复；源代码另检查异步代次和实际调用方，不代替真实 B 站登录或整页桌面交互验收 |
| 服务器旧在线源的参数与消息渲染 | 9/9 通过，另两份完整文件有效复用 | 四份 Node 文件同范围 plan 后 verify，实际新执行渲染器两份共9项，参数合同两份复用且不重计；覆盖字面原文、既有金额、表情类型、价格配色、图片失败与移除清理，不是本批新增的浏览器播放验收 |
| 服务器礼物原图来源复核 | 两份完整 Node 文件有效复用 | 同范围 plan 后 verify 实际执行0项；严格版本身份与币种匹配提供来源反证，未把未使用的图片回调直接报告成舰徽错误，复用不重计 |
| 客户端主播工作台与提醒交付 | 44/44 通过 | 七份完整现有 Node/VM 文件，覆盖旧版迁移、原记录保留、草稿/失败重试、日期/时区、只读粉丝日历与账号代次，以及主进程调度/IPC；原生通知和时钟为替身，不是实际操作系统通知或整页 Electron 验收 |
| 服务器五款新增固定样式 | 5/5 通过 | 一份完整现有浏览器文件，实际页面/资源与合成 SSE/资料，覆盖普通消息、礼物、上舰、SC、改参节点保留、撤回、密集到达和停播；另六场景的生产时间投影/真实 DOM 对照确认 F-022，不计入5项，其他样式源文件不因测试通过而自动算人工完成 |
| 客户端游戏管理、绘画与动态抽奖呈现 | 36/36 通过 | 五份完整现有 Node/VM 文件，覆盖局次题词、观众重试、画笔序列与撤销/恢复、独立抽奖授权和规则参数、暂停/继续、结果证据及取消；未启动客户端应用或连接上游。另三场景的真实规则/VM 呈现对照归入 D-003，不计入36项 |
| 服务器礼物特效预览与失败交互 | 8/8 通过 | 一份完整现有浏览器文件，真实页面与原生媒体暂停/切换 AbortError、合成 API/媒体门；普通执行首轮未生成报告，带子进程退出记录的同范围诊断执行通过，原始提前退出原因未查明，不能据此宣称该间歇问题已解决；不代表真实远端 MP4 完整播放验收 |
| 客户端独立转盘草稿与输出入口 | 6/6 通过 | 三项现有 Chromium 片段测试覆盖草稿、失败保存、广播与重连，三项 Node/VM/真实 page-assets 检查覆盖 ESM 入口、控制绑定及可嵌入的 200 页面；全页授权 Electron、真实直播和转动视觉未验收，上一批 limits 用例不重计 |
| 客户端电音助手呈现与状态交付 | 23/23 通过 | 三份完整现有 Node/VM 文件，覆盖本机偏好/位置、来源/声道、版本化参数串行写入、输出切换等待中的取消、可见性与错误/恢复反馈；桥接、设备和 DOM 为替身，不是实际驱动、音频或 Electron 弹层验收 |
| 服务器组件效果所有权与滤镜 | 一份完整 Node 文件有效复用，另五组 DOM 诊断通过 | 同范围 plan 后 verify 复用参数合同，实际新增既有测试为0；独立 Chromium 使用当前模块验证应用、连续重配、阴影分类、新/移除消息、原样式及优先级还原和释放，五组不计入测试累计。不是整页 SSE、时钟、外部框架或所有样式验收 |
| 客户端 AI 配置、订阅与模型列表 | 50/50 通过 | 一份完整现有 Node/VM 文件，实际控制器和合成 HTTP/时钟；覆盖保存/草稿、密钥隔离、模型服务请求归属和账号入口。另五组重叠时序对照确认 F-023，不计入50项；测试源码仍只局部人工复核，不因全文件执行而标记逐行完成 |
| 客户端样式库、共享资源参数与原生页面 | 29/29 通过 | 三份完整现有文件：23项配置控制器、4项隔离存储/权限与2项授权 Electron 检查。验证草稿、确认顺序、资源不可替换、失败重试、独立默认值、重开和隐藏祖先暂停轮询；导入/媒体编辑代码另作调用链检查，未执行整份733行浏览器库测试 |
| 服务器礼物卡片与盲盒期望呈现 | 63/63 通过，另一份完整 Node 文件有效复用 | 两份完整现有浏览器文件，真实页面/样式与合成目录，覆盖金额/身份链接、中英文、声明宽度、基础/五盒口径、说明浮层、导航及无额外请求；当前上游活动价格和真实账户不在本次验收内，947行测试源码只局部人工复核 |
| 客户端随机歌曲条件与元数据快照 | 24/24 通过 | 两份完整现有 Node 文件，纯筛选、实际临时歌库/队列和 SQLite 连接；覆盖组合、分隔符、单向别名、失败不改业务状态、5000首固定别名处理、事务回滚及跨连接失效。未调用上游或真实发送弹幕 |
| 客户端动态抽奖内容链接与上游边界 | 13/13 通过 | 一份完整现有 Node 文件，合成响应和字节流；覆盖字符串 ID、精确来源、逐跳短链、不转发凭据、账号变化及响应上限。没有真实登录、采集或开奖 |
| 客户端视频、文本图片与礼物图片 HTTP | 7/7 通过，另11个 HTTP 场景通过 | 两份完整现有 Node 文件，实际隔离服务器及流；覆盖 Range/HEAD、格式/大小/路径/链接、能力与 Origin、连接替换后的慢上传。临时礼物路由探针另验 GET/HEAD、缓存/CORS、非法文件及方法，不计入现有测试累计，不代表浏览器视频播放验收 |
| 客户端浏览器源 URL 加密与发布 | 8/8 通过 | 一份完整现有 Node 文件，内存 SQLite 与合成 AES-GCM codec；覆盖保存/发布/重开、输出重绑定、失败保留原状态、先鉴权后解密、未变快照与场景/项身份校验。不是实际系统 safeStorage 或外部网页兼容性验收 |
| 客户端启动保留期维护与停止 | 5/5 通过 | 一份完整现有 Node 文件，受控定时器与维护端口；覆盖现行开关/策略、小时维护、失败后重试、25ms 续批与停机撤销，未删除真实数据 |
| 服务器小游戏目录与渐进预览 | 38/38 通过 | 两份完整 Node 文件实际执行33项，一份完整浏览器文件执行5项；覆盖清单、只读副本、Host 链接/短地址、本地端口、逐图解码、失败/减少动效、三种现有视口及真实重载缓存。没有新增游戏行为、上游请求或生产部署 |
| 客户端到期标记、陪伴观察与点歌汇总 | 25/25 通过 | 四份完整现有文件，受控请求/IPC 与隔离 SQLite；覆盖完整名单和隐私、同房主短号、到期失效、账号/房间变化、独立平台天数、汇总迁移回滚、备份及时间回退。没有读取真实名单或用户数据库，部分测试源码仍仅作选段复核 |
| 客户端 WeSing 时钟、监听与诊断 | 29/29 通过，另两套运行时各5个观察场景 | 三份完整现有 Node 文件，受控监视器/时钟和合成 QRC。另用真实 fs.watch 在 Node 及 Electron 内置 Node 模式观察文件变化与目录删除，未复现候选未捕获异常，不计入现有测试累计；不代表所有文件系统错误、完整 Electron 界面或实际音频验收 |
| 客户端只读歌曲身份与 QRC 实体 | 5/5 通过 | 两份完整现有 Node 文件，实际隔离只读 SQLite/合成历史与纯函数；覆盖当前曲目匹配、时长/旧记录拒绝、数据库字节不变和既有实体顺序。没有访问真实音乐客户端或凭据，也不作为任意 XML 兼容性证明 |
| 客户端数据库初始化与抽奖历史回执 | 23/23 通过 | 两份完整现有 Node 文件，故障注入与实际隔离 SQLite；覆盖部分打开/PRAGMA/迁移/关闭失败、原错误保留、重开、级联删除、其他账号与暂停进度保留、清理及回执失败整体回滚。不是全部历史版本迁移组合验收 |
| 客户端歌曲待同步快照与恢复 | 29/29 通过 | 两份完整现有 Node 文件，实际临时存储与合成云端；覆盖歌库变更同事务捕获、私有元数据、账号/变更确认、重启、漏通知、迟到上传/拉取和显式空库。没有连接真实云端账户 |
| 客户端用户冷却与 API 月度预算 | 12/12 通过 | 三份完整现有 Node 文件，内存 SQLite 与受控时钟；覆盖 Map 重排、恢复/未来时间/回退、内存与落盘失败边界、固定正配额、跨月及已发送失败计数。未调用第三方 API |
| 客户端远程根地址及图片来源边界 | 21/21 通过 | 两份完整现有 Node 文件，合成请求与临时目录；覆盖 HTTPS/DNS/root、凭据/路径/IP 等拒绝、固定端点、取消与响应边界、同源图片和恢复后的来源绑定。共享函数仅作语法规则，不代替调用方的授权与来源判断 |
| 服务器共享帮助浮层与详情生命周期 | 43/43 复验通过 | 一份完整现有浏览器文件，当前共享组件/样式与合成目录；相关章节覆盖 hover/触屏/Enter/Escape、焦点、视口、无额外请求、卸载/返回后单节点及页面错误为空。43项是本次再次执行，不是新增的独立用例 |
| 客户端时钟档案与场景扩展数据 | 32/32 通过 | 两份完整现有 Node 文件，配置往返、参数验证、内存 SQLite、VM/API 和受控异步数据；覆盖账号/来源变化、条件快照、旧慢读及定向失效。未验收实际直播软件中的时钟动画 |
| 客户端世界时钟温度与调度 | 19/19 通过 | 两份完整现有 Node 文件，合成天气页面、受控时钟和实际隔离 HTTP；覆盖坐标/单位/新鲜度、整点缓存、退避/容量/关闭、管理权限及前端迟到结果与城市变更。未访问真实 MSN 或验证当前天气 |
| 服务器共享颜色字段与选择器 | 11/11 通过 | 一份完整现有浏览器文件，当前组件与合成外观 API；覆盖保存/重开/放弃/重置、单次事件、输入验证、拖动、模拟取色、禁用/导航/移除/克隆、既有视口及触屏。未实际取屏幕颜色或写入用户设置 |
| 客户端自动名单依据共享与迁移 | 7/7 通过 | 一份完整现有 Node 文件，旧库升级与隔离临时数据库；覆盖逐条观察和历史判断不变、重复迁移、编辑展开、备份恢复、跨账号模板回收及失败回滚。未连接真实平台 |
| 客户端礼物删除、统计交付与投影重置 | 31/31 通过 | 四份完整现有 Node 文件，受控事件、时钟和隔离 SQLite；覆盖批量参数、4万行整体回滚、每批保留期清理、来源范围、共享元数据重置回滚、冻结资格及非统计消费者重试。测试源仅选段人工复核 |
| 客户端随机点歌历史与回复对象 | 51/51 通过 | 两份完整现有 Node 文件，隔离 SQLite 与合成请求；覆盖清队列/重启、最近十条及额外有效回复对象、迁移幂等、写入失败回滚和筛选失败不替换对象。未连接真实弹幕或平台 |
| 服务器手账、幽灵便笺、花与信笺旧在线源 | 5/5 复验通过 | 一份完整现有浏览器文件，包含另两款既有样式对照；覆盖安全正文、礼物/SC、外观更新保留节点、撤回、密集到达和结束清理。合成事件/头像/资料，未验收实际 OBS 或直播姬引擎 |
| 服务器首页偏好与公开工具导航 | 20/20 通过 | 两份完整现有浏览器文件，当前页面和合成礼物 API；覆盖语言直接切换/重载、主题/字体、Cookie、禁用存储、无脚本和跨页导航。额外同页历史诊断确认 F-024，不能因这20项通过而判定该路径正常 |
| 服务器礼物说明、角色与图片辅助模块 | 9/9 通过 | 三份完整现有 Node 文件，包含四项图片 DOM 替身、两项活动身份及三项静态安全检查；未请求真实 CDN。权益卡浏览器表现引用103批未变源码的既有证据，不重计43项 |
| 客户端礼物身份绑定与规则迁移 | 13/13 通过 | 两份完整现有 Node 文件，隔离 SQLite、受控时钟及前端模块替身；覆盖重用 ID/改价、精确绑定、旧规则待重选、重放和重启。另三组内存迁移诊断确认字段保留、幂等和注入失败回滚，不计入13项 |
| 客户端每日机器人、固定回复与屏蔽参数合同 | 16/16 通过 | 三份完整现有 Node 文件，合成远程适配器和 frame/账号状态；覆盖条件词库摘要、换账号迟到结果、窄补丁、响应私有字段剔除及固定 Device 地址。未验收真实 Electron 或跨端 fixture 字节一致性 |
| 客户端本地弹幕外观、布局与场景交付 | 24/24 通过 | 四份完整现有 Node 文件；内存/临时 SQLite、VM 与实际隔离 HTTP，覆盖一次迁入、归属、完整保存、布局与类型、外观更新不重发场景和事件。运行时391行源码仅选段复核，未验收真实 Electron |
| 客户端场景迁移与持久化约束 | 10/10 通过 | 一份完整现有 Node 文件，真实旧版结构、独立 SQLite 连接和重启；覆盖原始数据/凭据保留、活动预设可空、归属、乐观修订与失败回滚。既有名单及展示证据引用不重计 |
| 客户端礼物展示窗口与旧视频入口 | 5/5 通过 | 两份完整现有 Node 文件，受控事件、隔离样式库与实际 loopback HTTP；覆盖身份/样式去重、200条上限、账号清空、准备与消费、安装重定向、HEAD/Range及移除后旧引用。不代表视频解码或直播软件验收 |
| 客户端运行时适配、参数与抽奖路由 | 40/40 通过，另原生启动失败诊断确认 F-025 | 六份完整现有 Node 文件；合成上下文、可控计时器、内存 SQLite 与隔离 HTTP，覆盖账号/修订/幂等、参数边界、公开错误裁剪和兼容菜单。设置测试源码仅选段；独立原生子进程对照不计入40项，不代表完整 Electron |
| 客户端词库与默认配置数据 | 30/30 通过 | 两份完整现有 Node 文件，实际游戏与历史默认配置校验；词库摘要另核对9类各100条，不重计。测试源码仅选段，默认价格不作为平台实时价格依据 |
| 服务器歌单页头与控制台导航 | 35/35 通过 | 两份完整现有 Chromium 文件，先 plan 后 verify，隔离静态服务/API替身；覆盖头像/链接限制、慢资料不阻塞、五个工作区、历史/草稿/焦点和既有尺寸。外部链接请求被拦截，不代表真实账号、Admin授权或全部桌面行为 |
| 服务器固定字表与客户端原生锁文件 | 服务器3/3通过，原生部分静态核对 | 字表完整字符串核对3,500项、唯一性及消费绕过规则；固定在线来源本批不可读取，未宣称远端字节一致。原生依赖锁与项目、locked restore/publish入口一致，未执行NuGet恢复、原生编译或设备检查 |
| 服务器首页吉祥物、动效与录屏交付 | 20/20通过 | 一份完整现有 Chromium 文件，先 plan 后 verify；脚本1,053行与所属535行样式全文审阅，覆盖静态像素、实际指针、离屏恢复、既有尺寸、七段本地录屏解码/变化和偏好降级。两张吉祥物截图已检查，未验证真实平台账号 |
| 服务器旧在线源样式与画布 | 64项中61通过、3失败；两份Node文件有效复用 | 六款样式、徽章/画布模块与四份相关CSS入口全文审阅，消费者仍按选段登记。原浏览器失败保留，布局稳定和越界清理对照见D-006；有效Node复用及额外诊断不增加执行计数，未宣称七份文件全部通过 |
| 客户端原生验证脚本 | 静态全文核对，未执行原生检查 | 补读76行脚本余部，与既有构建前提、桥接重启/恢复和检查入口核对；没有运行NuGet恢复、编译、实际播放或设备测试，不增加测试计数 |
| 客户端加班机礼物选择与规则更新 | 7/7通过，另三类真实Electron对照确认F-026 | 完整现有选择器文件及夹具，隔离API/事件；真实加班机模块对照无更新、干净列表更新与已有草稿，并核对实际拦截的保存请求。额外诊断不计入7项；跨端固定版本合同未执行，F-026未修复 |
| 客户端组件与开播样式选择器 | 3/3通过 | 两份完整现有文件，其中两项使用隔离Electron；验证文本框当前副本、独立配置、逐样式草稿、导入样式保存失败/重试与画布媒体配置。未验收真实设备、平台账号或完整生产启动 |
| 客户端开播编辑与画布交付 | 18/18通过 | 两份完整现有文件，17项受控VM检查与1项Chromium集成；覆盖读取阻断、保存排队/失败重试、迟到同步、预览复用和正式输出。内存SQLite/合成设置及桌面桥替身，不代表真实Electron启动或音频设备验收 |
| 服务器五款旧在线样式与素材引用 | 静态核对，未新增播放检查 | 五份CSS共1,686行的布局声明，9个内联SVG做解码/XML结构核对，22处本地URL对应13个现有文件；不把矢量路径结构等同美术几何/像素验收，也未复验D-006原失败 |
| 服务器版本化素材快照 | 一份完整Node文件有效复用，新增执行0 | 先同范围plan后verify；完整审阅47行owner和67行测试，复用嵌套素材修订、启动字节快照、immutable/304及no-store404检查。应用挂载仍为选段，缓存复用不增加累计执行数 |
| 客户端画布拖拽、参数和预览重试 | 4/4通过 | 按名称运行两份文件中的四个既有用例；真实Chromium、合成桌面桥与内存SQLite，覆盖栏内提交/取消/撤销、无效参数、场景草稿和连接重试，非真实Electron验收 |
| 客户端外观与账号代次 | 29/29通过 | 四份完整现有VM/DOM文件；另用真实前端控制器与外观服务确认F-027，诊断不计入用例数；绿色已有测试未覆盖同账号重登的旧GET绑定副作用 |
| 服务器登录与重置页面 | 20/20通过 | 同范围plan后verify，两个完整浏览器文件实际运行、复用0；使用合成认证响应和自有隔离服务器，覆盖原始密码、单飞、错误保留、成功清空、CSP及既有视口，不代表真实登录或管理正文视觉验收 |
| 服务器字体资源与维护脚本 | 5/5通过，另复用2个完整文件 | 三文件同范围plan后verify，song-font-assets实际执行5项；console-font-assets与public-font-preload有效复用、不重复计数。未运行资源生成或下载，不能代替所有构建脚本的干净环境验收 |
| 客户端变化中的排版测试 | 1通过、1失败，保留原结果 | 完整执行时测试摘要前后未变，但其后测试及依赖继续外部修改；六组青雾专项测量属于诊断，不代表完整文件转绿，详见D-007 |
| 客户端歌词设置与来源控制 | 12/12通过 | 两份完整现有VM测试，合成DOM/传输；另以真实settings-service广播顺序确认F-028，不计入已有测试数，未验证真实桌面、账号或落盘数据库 |
| 服务器礼物页面样式与导入 | 静态核对，无新增测试执行 | 九份HTML/CSS全文及直接DOM选段，八个导入目标存在、主文件摘要未变；没有具体产品疑点而不重复浏览器，静态检查不代表视觉或播放验收 |
| 客户端礼物交互与默认外观 | 20/20通过 | 四个完整现有文件，18项非浏览器检查与2项Chromium集成；覆盖守护感谢草稿/预览、会话取消替换、共享外观和画布数据。F-029另由真实设置服务的合成复现确认，不混入已有测试数 |
| 服务器游戏目录与公共外壳 | 25/25通过，另复用1个完整文件 | 两份完整Node文件先同范围plan后verify，目录文件实际25项，公共页面文件有效复用；模板、Host/资源准入和目录契约已追踪，没有新增浏览器或玩法验收 |
| 客户端手动云端同步界面 | 9/9通过 | 完整UI测试中的9项，合成桥/DOM/存储；确认只交付授权generation、取消不发送、读取确认后完整歌库及错误计数。共同日志另2项帮助用例只计入下一行 |
| 客户端表单、时钟与帮助控件 | 7/7通过 | 2项帮助检查、4项按名称筛选VM用例和1项完整共享控件浏览器场景；覆盖当前输入保护、dock状态、时钟单帧显式保存、标签/弹窗焦点及帮助事件。未执行全部layout/clock套件或真实Electron |
| 客户端当前排版修订 | 19/19通过 | 两个完整文件实际执行，20项相关输入前后摘要一致；四项当前文件全文审阅并保留字节快照。历史失败原样保留，范围详见D-007 |
| 客户端粉丝表单与自动更新提示 | 28/28通过 | 完整view文件25项及仅按名称筛选的3个editor用例；合成SQLite/VM，覆盖字段、北京时间、草稿与单次通知消费，不等于完整详情/归档套件或真实账号验收 |
| 服务器性能脚本与游戏专属样式 | 静态核对，无新增测试执行 | 三个基准及三个helper全文、三份CSS共1,474行全文；核对隔离/测量边界和DOM/状态/取消链，没有执行基准、生成资源或重跑视觉套件 |
| 客户端设置表单、账号资料与安全操作 | 40/40通过 | 九个完整现有文件，合成DOM/桥/API/时钟/存储；真实清空、关机、重启、登录均未执行。F-030另有真实表单和设置服务的隔离草稿复现，不混入已有测试数 |
| 客户端当前主题与播放修订 | 52/52通过，19项排版结果仅复用 | 11份CSS声明与5份运行时/测试/帮助当前全文复核，20项摘要稳定；完整motion文件实际运行52项。SVG结构不是美术/像素验收，旧D-006/D-007失败保留 |
| 服务器捕获与维护CLI | 29/29通过 | 三个完整现有文件，同范围plan后verify均实际执行；全部合成SQLite/传输/WS/配置，未运行真实捕获、账号创建或目录同步，未读取真实凭据 |
| 客户端状态路由、直播提示与性能展示 | 16/16通过 | 三个完整文件12项与仅按名称筛选的4项metrics/hardware；合成端口/硬件/时钟，没有真实硬件采样或Electron界面验收 |
| 服务器跨仓歌曲往返脚本 | 静态核对，实际运行0项 | 主脚本454行及隔离/路径支持全文，核对合成凭据、独立数据根、端口0和进程等待清理；未启动脚本或应用。其Node/controller加浏览器的能力不等同Electron IPC/TLS/部署验收 |
| 客户端场景房主资料 | 2/2通过，另有独立缺陷诊断 | 完整profile单测实际执行；真实隔离Chromium正常独立源200、场景子页401确认F-031，临时诊断及主代理复验不加入已有测试累计数 |
| 客户端加班规则与时长控件 | 3/3定向通过 | 唯一editor用例全部执行，frontend仅选2项；真实纯校验/editor/model的6个观察另计诊断，当时确认F-032、保留D-008；第181批另确认F-036，临时诊断不重计 |
| 服务器游戏数据与素材声明 | 14/14通过 | 六个完整现有本地文件检查，6份清单259条做完整结构化语义审阅；盲盒原始JSON只人工读1–75，其余为全量自动解析/紧凑投影。声明不等于外部许可证明，没有联网、应用或玩法执行 |
| 客户端开播画布设置与传输 | 8/8通过 | 两个完整现有HTTP/VM文件，合成媒体/设置与独立回环服务，验证样式隔离、附件权限、上传中撤销和错误元信息；画布面板源全文与既有Electron用例选段另作静态核对，未新跑Electron |
| 客户端富文本工具栏与编辑器 | 17/17通过 | 完整现有Chromium文件，选区格式/字体/透明色、原生撤销、素材、长粘贴、快速切换、像素及重挂清理；路由200后导航，独立上下文和合成内容，未操作真实剪贴板/用户场景 |
| 客户端点歌设置、黑名单与背景 | 18/18通过 | 四个完整VM/纯模块文件13项、仅按名称选中的背景2项及完整展示板Chromium文件3项；F-033/F-034另有隔离时区/form诊断与root复验，不加到测试累计 |
| 客户端本地算分、输出与下载入口 | 9/9通过 | 两个完整文件8项及仅一个预览依赖用例；公式/上限/共享订阅和纯工厂边界核对，无真实设备切换、下载、浏览器或账号操作 |
| 服务器礼物身份关系和显式特效输入 | 7/7通过，另复用1文件 | 12条确认绑定原始全文、273身份/37关系/247引用及6奖励完整结构化语义；实际effect-binding文件7项，概率文件有效复用不重计；版本化输入不加入旧基线 |
| 服务器冻结盲盒输入与国庆结算 | 5/5通过，另复用1文件 | 225variants/30关系/24概率表及全部嵌套字段无损语义视图完整审阅；国庆完整文件实际5项，engine成功缓存复用，未执行builder或下载媒体 |
| 服务器游戏样式补齐 | 静态审阅，无新增执行 | 成名8份、宝斋6份及唤灵/工坊/秘宝3份CSS共4,619物理行全文；按各玩法真实DOM/状态/有限反馈与取消选段核对，不混用几何合同或宣称视觉/玩法验收 |
| 服务器大种子与媒体账本 | 完整语义审阅，无新增维护测试 | 种子九个非记录根字段、2归档与2681/2681主记录全部完整语义；九个阅读组互斥且补集为空；媒体账本441条字段/映射完整。未称原始284128行全文，未验媒体本体、当前上游真实性或许可 |
| 客户端预览样例、参数与被动注册 | 21/21通过 | 两完整VM文件12项及两完整画布Chromium文件9项；真实样例/正式输出过滤、输入单位、预览循环与清理及无子页管理请求，旧全文叙述回查不重计，非真实Electron |
| 服务器直播间监控连接与交付 | 23/23通过 | 四完整现有文件，先同选择plan后execute，显式合成environment避免读取真实.env；FakeSocket/内存数据，handshake仅连接自有本机TCP，无B站或部署验收 |
| 客户端使用指南交互与布局 | 41/41通过 | 两完整VM/静态文件19项与两完整Chromium文件22项；六模块累计全文、实际root/search HTML与四测试正文完整，历史只在内存；lightbox仅静态逻辑审阅，非真实Electron或全产品文案认证 |
| 客户端工具页导航与懒加载 | 21/21通过 | 两完整VM/静态文件；源码核对分组hidden/inert、当前选项、失败导入重试/部分初始化恢复及卸载，完整shell CSS/HTML另属静态证据，不冒称原生焦点、移动布局或动画验收 |
| 工程、管理样式与礼物/设备契约源码 | 静态审阅，新增执行0项 | 第222–225批补齐实际源码范围并复用旧全文；未运行诊断采集、modularity/pin门禁、维护测试、密码学诊断或浏览器，不能把断言源码当作当前运行证明 |
| 指南截图工程/样式、管理样例与安装器测试 | 源码审阅，新增执行0项 | 第228–231批完成明确正文范围；F-038选择器错误按源码确认，未运行截图、安装、卸载、NSIS、应用、浏览器、密码学或外部请求 |
| 管理测试补齐、加班样式、补图与机器人样例 | 源码审阅，新增执行0项 | 第234–237批按实际全文/补集/选段登记；F-039是启动错误清理的源码结论，未启动监听、浏览器、应用、测试或真实发送 |
| 机器人测试、礼物样式、维护脚本与overlay协议 | 源码审阅，新增执行0项 | 第240–243批完成明确正文/补集；F-040为维护时钟边界，D-011为文档漂移，没有CLI、Electron、网络、数据库或播放执行 |
| 组件样式、礼物样例、资源脚本及局部补齐 | 源码审阅，新增执行0项 | 第246–250批按原始全文、既有范围复用和实际选段登记；D-012仅为SC说明漂移，没有生成素材、构建、ZIP、CLI、应用、网络或validator执行 |
| UI与礼物测试补齐、WeSing诊断源码、剩余小协议 | 源码审阅，新增执行0项 | 第253–256批补齐五份旧局部并审阅明确的新正文；没有运行诊断、CLI、真实日志采集、测试、DB/HTTP、validator或播放 |
| 盲盒样式、Device测试、依赖锁与大型契约分段 | 源码审阅，新增执行0项 | 第259–263批记录完整与局部范围；C262-001经独立核对排除，没有normalizer/激活/Ajv、npm、安装、业务测试、DB/HTTP、密码学或应用执行 |
| 提示样式、服务器依赖锁与两份大契约续审 | 源码审阅，新增执行0项 | 第266–270批补齐两个旧局部；Device与Management继续按实际正文记录PARTIAL，没有业务测试、安装、validator、DB/HTTP、密码学或应用执行 |
| 共享提示生命周期、Admin测试与大契约路径补齐 | 源码审阅，新增执行0项 | 第273–279批读全Management路径段并保留组件局部状态；补齐toast和两份测试辅助文件，没有浏览器、CLI、产品测试或账号操作 |
| 歌词页面/样式与两份大型契约全文闭合 | 源码审阅，新增执行0项 | 第282–286批补齐Device/Management全部原始正文；本地引用定位只是阅读后元数据核对，Welcome错误数组疑点排除，没有validator、业务测试或运行验收 |
| 歌词设置片段、歌词/鉴权测试与装饰资源 | 源码审阅，新增执行0项 | 第289–293批62个原始文件全文：3份HTML、13份测试及46份文本资源；SVG XML核对仅作源码元数据，未执行测试、渲染或访问外部来源 |
| 歌词渲染样式、画布/管理端测试与剩余资源 | 源码审阅，新增执行0项 | 第296–300批52个原始文件全文：8份CSS、3份HTML、11份测试、28份SVG及2份JSON；本轮没有XML解析、产品测试、浏览器或媒体操作 |
| 浏览器源基础、授权页与服务器样式/测试 | 源码审阅；合成VM诊断2次 | 第303–307批补齐34个原始文件全文；首次诊断为替身准备失败，最终6场景确认F-041；没有维护测试、浏览器或真实媒体执行 |
| 背景渲染、AI/机器人测试与SC样式 | 32份原始全文+2份局部；1次CSSOM诊断 | 第310–315批全文5805物理行/5837 helper；父315真实CSS+合成DOM的100/50/100对照确认F-042外壳背景冲突，0维护测试执行，未验证子卡片配色或直播平台像素 |
| 展示逻辑、AI/Bilibili/设备测试与剩余服务器样式/声明 | 76份完整原始正文，含1份累计全文；新增执行0 | 第318–322批完整范围12815物理行/12882 helper，本轮新读12732、复用旧83；另补齐此前2份局部文件；源码链确认F-043，专属入场接线D-013待验证 |
| 展示页CSS/HTML、站点资源声明与礼物/Bilibili测试 | 94份原始全文；新增执行0 | 第328–331批11258物理行/11352 helper；另补完此前2份局部，金额分/元线索由现有控件双向换算排除，没有新F/D |
| 队列/歌单展示、点歌页/字体与礼物/桌面测试源码 | 70份原始全文；新增执行0 | 第335–338批14085物理行/14154 helper；无新增局部或支持正文，没有新F/D，字体文本声明核对不含二进制或运行验收 |
| 服务器剩余页面、鉴权/监控与桌面测试、客户端弹幕样式 | 73份原始全文；10份当前修订旧全文复用，新增执行0 | 第341–344批新读13882物理行/13955 helper；父345确认F-042客户端同因源码范围，0客户端运行，复用修订不计原始覆盖触及 |
| 客户端展示/共享/时钟目录与服务器公共界面/游戏测试 | 80份新原始全文；1次内置Intl隔离诊断，维护测试0 | 第347–350批17141物理行/17221 helper、167块；父351确认F-044两条城市时区错误，未启动客户端或产品模块；6442条城市原文不等于全表地理正确性认证 |
| 播放器/基础控件/桌面/主题与授权、公共页面测试源码 | 87份新原始全文；新增执行0 | 第354–357批16491物理行/16578 helper、148块；测试、helper及真实Electron探针均只读声明，未运行或借旧PASS，0新F/D |
| 百宝箱/展示样式与场景、存储、传输、发布、欢迎测试源码 | 80份新原始全文；新增执行0 | 第360–363批21736物理行/21816 helper、178块；含Ripploid1471物理行全部长路径原文；模拟长时与人工报告不计实际PASS，0新F/D |
| 工作区/共享样式与页面、领域测试、礼物/展示e2e及SVG素材 | 156份新原始全文；新增执行0 | 第366–369批18978物理行/19083 helper、231块；含75份SVG且51份无末换行；模拟测试与静态路径不当运行验收，0新F/D |
| 页面/指南、同步与媒体测试、服务器游戏测试及素材声明 | 134份新原始全文；新增执行0 | 第372–375批21613物理行/21736 helper、241块；父重检53行重叠，另读规范7行；确认D-014说明漂移，0新F |
| 客户端礼物/弹幕/UI/工程测试与服务器礼物/口令夹具 | 153份新原始全文；新增执行0 | 第378–381批35716物理行/35869 helper、281块；另重检旧FULL调用方71行；0新F/D，44F与D-014未修、D-013待验 |
| 七份礼物刷新夹具与Electron主入口/同步控制器 | 7份限定完整业务语义；3份累计原文闭合；新增执行0 | 第384–387批：原文2385物理行=新2034+旧351；夹具源141055行仅尺寸，语义投影9239行/101块，RAW子段100行另列；0新F/D |
| 授权、音乐、服务器身份入口与客户端迁移/清理owner | 76份RAW FULL范围：恢复旧全文49、新整份15、累计补齐12；新增执行0 | 第390–393批：完整13525物理行/13601 helper＝新读5257行/66块＋复用8268；新增触及0，0新F/D；16份旧测试3917行仅历史上下文 |
| AI、服务器授权路由/官网与弹幕共享CSS | 39份原始完整范围；当前sketch累计RAW闭合、twitter旧RAW复用；新增执行0 | 第396–399批：41份完整10348物理行/10389 helper，新读2147行/34块；26份旧原始全文恢复、13份原始补齐；历史153规范化声明保留，最新20份当前RAW另列；0新F/D |

## 轮次与覆盖

第一轮：信任边界、认证与参数入口，进行中。后续轮次检查业务状态、数据恢复、异步生命周期、模块职责、容量与测试有效性。

当前完成的是全量自动索引与若干人工追踪批次。`coverage.json` 的 `manually-reviewed` 表示已按登记视角追踪到该文件，不表示该文件所有视角或每行都审完。其余保持 `automated-only` / `inventoried`，不能按关键词命中或测试通过自动升级为人工完成。

原始摘要台账累计人工追踪触及客户端 2,220 / 2,235 项、服务器 1,318 / 1,318 项，共 3,538 项。本轮第396–399批处理41份文件，新增触及0：39份原始摘要一致的完整范围中，26份恢复旧RAW FULL证据、5份新读整份、8份按旧局部补齐；另1份当前sketch由规范化阅读补齐原文、1份当前twitter旧RAW FULL单独复用，不强行通过原始摘要guard。39份原始范围9274物理行/9313 helper＝新2138＋旧7136（6216旧全文、920旧局部）；当前sketch291/292＝新9＋旧282，twitter783/784为旧全文复用。41份完整尺寸10348物理行/10389 helper＝本轮新读2147行、34个完整可见RAW块＋复用8201行，41个helper末空项不算源码。主范围40份9565/9605与单列twitter复用783/784不能混算为41份新读。两个服务器旧全文测试611行仅作当前同SHA的历史断言上下文，fresh支持/规范正文、产品与维护测试执行均0。sketch旧151规范化display与原始snapshot除274–281/285九行外完全相同，旧282个字面行复用，九条percent-encoded SVG实际原文已读；故最新current-revision-overlay-stage-400.json记录20份当前RAW FULL，而153历史19RAW＋1normalizedSketch、旧151声明和原始3553台账均未改写，不认证几何、像素、视觉或播放。原始未标触及15项（客户端前端14、测试1）仍有独立当前修订证据，不能补写原摘要触及；无当前队列证据的原始未标项为0仍不等于全审完成。原导航1537项仅扣除本轮39份已裁定原始范围，尚1498项原始全文声明不确定；两份当前版本另列，已有20份当前RAW路径不作为自动重读队列。1498不是从未阅读，394的515导航候选也未自动晋级。当前0新F/D，44项F和D-014全部未修复，D-013待实际legacy时序/播放；F-001/F-002/F-024及其旧失败不因源码全文或旧PASS关闭。当前产品、维护测试、诊断、导入、VM/eval/child、DB/配置/.env、业务加密、XML解码、HTTP/WS、浏览器/Electron、公网、媒体/字体和原生设备执行0；自有fs、SHA、JSON、区间与历史映射仅为审计元数据，维护通过累计5778不变，文档门禁另计。395/400各一次3553源码比较仍为已知客户端20项原摘要差异、服务器0，实际退出1不是全部不变通过；未重建分母或baseline。此前388的7份夹具保留opaque字面量边界的限定完整业务语义，216补充输入和287/332闭合边界不变；跨端pin/PK fixture、旧340/343/358/370/372/379/388/394恢复与72拒删/125eval拒绝均保留。本轮元数据搜索截断未见部分0credit并定点恢复；根端准备脚本一次编译前SyntaxError已留档，改用格式化脚本完成，无业务源码/测试/比较/登记或门禁重放。提示词未改，沿用第9/11/12条；业务、维护测试、现行技术契约和用户指南未修改，Goal继续进行。

第四批检查 AI 模型/订阅与豆包会话、刷新和取消、工具续接与历史、配置/诊断持久化、播放快照/歌单与迁移注册，以及服务器公共游戏外壳和盲盒存档结算，新增已确认缺陷为 0。账号代次、结果交付、响应上限、事务与已有覆盖提供了反证；没有为了增加数量而把有限缓存、未暴露配置或隐藏按钮的不可达分支升级为缺陷。

第五批检查礼物许愿的周期窗口、明细/日汇总/非整日贡献合并、前后端保存及展示，服务器活动脚本/规则解析、身份匹配与目录发布，以及醒目留言的解析、删除/撤回/撤销与迁移。新增已确认缺陷为 0。活动脚本只按文本解析，来源与 API 家族受约束；已有正确行为与有意的兼容路径不另列“优化问题”。

第六批检查目录发布事务、特效候选与布局缓存、受信来源和素材清单，客户端歌词解析/缓存/时间轴/来源仲裁，以及欢迎、回访与 PK 播报的设置、入口、取消和持久化。新增已确认缺陷为 0。目录数据库事务、旧快照保留、来源切换与账号归属约束已有实现和针对性覆盖；没有把尚未建立实际影响的参数差异或已明确限制的采集容量列为缺陷。后续继续未覆盖的模块，不重跑已经充分验证的路径。

第七批检查开播问候和房间变更播报、AI 人格导入/编辑与提示规则/设置保存、客户端远程礼物目录和图片缓存、进场与上舰解析，以及舰长到期查询的独立账号和分页发布。新增已确认缺陷为 0。已有实现按完整礼物身份隔离图片回退，限制受信下载来源、字节数和并发；到期查询重新核对账号/房间并在列表完整后发布。人格作为 JSON 数据进入公共规则后的风格区，编辑和保存由现有请求队列及配置事务处理；这些是代码与夹具层证据，不将其扩展为模型安全、真实账号或桌面界面的全面保证。

第八批检查客户端弹幕连接/重连、发送与分段会话、去重、用户身份和榜单/历史轮询，以及服务器账号命名、身份数据库、管理员改密和主播资料写入。新增确认 F-009：前端批量自动发送没有沿用自动回复已有的会话约束，切换账号或房间后继续将剩余消息发到新上下文。其余疑点按调用方排除；例如生产身份合并不使用旧昵称回退方法，管理员改密会在哈希等待后重新核对权限和密码版本，不能按孤立 helper 或单次前置检查误判。

第九批检查 QQ/网易云 Provider 的账号读取、歌单定位/读写、加载会话、上游请求和前端首页加载/缓存，以及服务器管理设备、租户视图、历史、歌曲操作和对应路由。新增确认 F-010：单测中传递了 offset，不代表当前上游取得了下一页；匿名官方响应与离线跨模块回放共同确认该参数使用缺口。其余账号代际、加载归属和设备撤销链已有实现与针对性覆盖，未据孤立参数转换或 UI 状态猜测新增缺陷。此批没有运行真实 Electron、登录账号或调用真实写入。

第十批检查组件草稿控制器、批量提交、场景模型/编辑/发布/恢复、预览会话和共享参数，以及服务器外观设置、只读能力、过滤缓存、观众查询和参数归一化。新增已确认缺陷为 0。组件提交先冻结全部快照，各 owner 分别确认；场景发布在 SQLite 内复核 revision、输出版本及共享尺寸。预览增量读仍返回确认序号，重试命令保留回执，正常续期使用稳定归属，换账号/撤销使旧能力失效。规格明确要求保留本次涉及的共享草稿，包括已移除图层；放弃操作也覆盖这些 owner。仅静态阅读了浏览器界面 fixture，本批未运行浏览器或 Electron，不把 VM、回环 HTTP 和 SQLite 测试扩大为视觉或真实直播验收。

第十一批检查素材库安装/更新/软删除、索引恢复、备份归档/校验/恢复、引用清理、网页资源路径与原生文件选择，以及服务器歌曲页背景和外观的前后端调用。新增确认 F-011：背景保存服务已正确替换文件，管理页却可能被旧响应覆盖。素材恢复的隐藏登记、场景事务和稳定副本身份属于已明确的可续作合同；主索引提交后的恢复副本失败仅降低恢复能力。已有校验、权限复核与补偿证据充分的路径不要求额外重构，本批也未执行真实浏览器、Electron 或账号操作。

第十二批检查两端测试选择、结果归属、缓存键和输入追踪、服务器按消费者选择浏览器文件的映射，以及客户端打包依赖、完整性清单、发布编排和原生构建入口。新增已确认缺陷为 0。服务器在运行前后核对输入，拒绝缺失/不完整报告，对动态或未知依赖保守失效；客户端语法缓存绑定实际 Node 和文件内容，发布流程校验最终产物摘要并限制重试范围。定向读取了服务端备份/日志轮转配置及部分发布准备入口，没有运行备份、安装、原生构建或部署。测试文件部分只追踪相关断言，完整执行与人工逐行审查仍分别记账；文件范围诊断、明确允许的跳过和已接受的指纹边界不因孤立表象列为缺陷。

第十三批检查播放器组合根、事件与动作适配、播放/流重试/上一首、队列转换、电台补歌、音乐账号失效和歌词结果交付，以及服务器星座回响、同行航线、唤灵契约与成名之路的状态核心，追踪了共享星座/航线 view 的保存及反馈清理。新增确认 F-012：同曲 ID 只能识别歌曲，不能识别这次歌词加载的完成归属。其余流解析与恢复有请求代次校验，电台以队列身份隔离重开后的结果；游戏同步提交结算后再播放反馈，独立清理保留累计校验证据，没有要求将不同玩法合并为统一状态机。仅执行隔离模块与现有 Node 测试，游戏视觉、实际音频设备和上游账号仍未验收。

第十四批检查播放器导入/匹配/搜索/待确认/首页动作、缓存、歌单操作、渲染协调、播放条/队列/抽屉和参数格式化，以及服务器秘宝合成、玲珑宝斋、合成工坊的核心与秘宝合成 view/记录入口。新增已确认缺陷为 0。导入按请求 ID 与创建时间去重，失败允许重试，过滤已处理项后再限批；搜索丢弃旧代次，队列渲染比较模板实际使用的原始值，避免原地更新后不刷新。游戏的保底结转、历史兼容、三工坊独立进度与双版本共享进度各有明确合同；秘宝合成先保存再反馈，长按在松手、取消、失焦、隐藏和成功等入口停止。`shell.clearButton` 也由共享壳显式提供，不能只看局部 `controls` 写法判定缺字段。未执行浏览器视觉、真实歌单写入或上游账号操作。

第十五批检查全屏歌词与定位、本地文件重新选择、播放器外观/字体、输出设备和变速、Provider 状态协调、全民 K 歌设置/诊断与共享歌词/参数控件，以及服务器成名之路呈现/弹窗/弧线和唤灵契约呈现。新增确认 F-013：旧保存完成会清空较新的未提交偏移草稿。全屏歌词在等待输出后复核音源，输出设备按在途任务与版本协调，字体及观察者在页面退出时清理；游戏先提交状态再反馈，弹窗和隐藏/退出清理不再次结算。旧 HTTP 登录 helper 未找到实际生产调用，不能据其孤立路径列为登录故障。仅执行模块夹具与 Node 测试，真实控件、动画和设备仍未验收。

第十六批检查礼物答谢模板的文本/参数块编辑、示例预览、桌面桥、账号队列、云端校验/保存、模板读取、分组完成与发送文本冻结。新增已确认缺陷为 0。两端便携模板模块按换行归一后内容一致；桌面主进程只提交窄字段，模板与两个开关互不覆盖，服务器在当前租户读取文案并于入队前生成完整分段。120 码点的编辑上限与四段/40 UTF-16 的发送预算是不同保证；首段完整称呼、金额块和超长整条跳过均为已接受协议，不按这类有意约束新增问题。已有 Chromium 编辑夹具通过，不扩大为 Electron 或真实发送验收。

第十七批检查云端完整匹配/定时回复、每日词库、欢迎参数及多词库/用户欢迎词的前端协调，以及服务器玲珑宝斋与合成工坊的完整 view。新增已确认缺陷为 0。各编辑 owner 保留保存中产生的新草稿，换账号清除原账号结果，缺少新版本能力时禁用对应功能；每日词库响应使用独立的 `library`，不会把开关状态误替换为词库。宝斋两版共享进度、工坊三版独立进度和清理行为由各自合同决定，没有按外观相似要求合并。除模块检查外，本批新执行了 36 项真实隔离服务器/浏览器游戏测试；浏览器测试进程已结束，临时端口 58165 已确认关闭，未控制用户运行中的应用。

第十八批检查礼物审计页的解析/比对/快照消费、盲盒分析工作区/日期选择/聚合查询，以及服务器盲盒媒体准备、播放队列、后台推进、舞台呈现和虚拟历史。新增已确认功能缺陷为 0，另记录 D-003 说明漂移。媒体准备串行解码、校验已登记视频/WebP 的摘要并保留 PNG 回退，离开时取消请求与释放 blob；队列预留绑定代次，事务失败释放，关闭动画不撤销已保存结果。后台推进采用已接受的时间继承规则，历史按盲盒聚合全部倍率并有界读取。日期 owner 与已完成礼物查询提供了反证，没有将本机自然日、不可变 final 缓存或已接受的玩法差异列为缺陷。本批仅新增模块与隔离存储测试，没有把先前其他游戏的浏览器通过结果扩展为盲盒真实媒体验收。

第十九批检查礼物历史分页/恢复/排序、拖选/跨页全选、导出预览与选择快照、SQL 查询事务/缓存、最近礼物及展示设置，以及服务器点歌命令复制、歌曲/歌手虚拟列表和移动筛选草稿。新增已确认功能缺陷为 0。历史游标绑定筛选条件与视图版本，选择由服务端实际来源和当前版本约束，旧请求及旧导出任务的完成不能覆盖当前状态；展示保存时禁用表单，后台设置合并保留未保存字段。歌单筛选保留原始歌曲对象和编号，复制按原始集合解析，提示保留焦点并处理回收行。新增 77 项针对性检查通过；本批公共歌单浏览器测试使用本地合成快照，不是生产数据或真实剪贴板验收。进程已结束，临时端口 49748 已确认关闭。

第二十批检查礼物导出的冻结输入、IPC 来源、目录选择、隐藏渲染窗口、文件写入/取消及尺寸边界，以及服务器管理页的目标选择、账号操作、密码重置/设置/清理、列表轮询和审计格式。新增确认 F-014，限于迟到列表覆盖操作后的显示状态。其余导出路径固定，输出独占创建，取消及来源版本在异步节点复查，失败保留已成功文件；规范明确不承诺撤回正在完成的文件写入，没有将该边界升级为缺陷。管理密码操作固定目标并在关闭/导航/退出时清理页面秘密，移除确认失败不会误报删除成功。新增 39 项针对性检查通过，另两个未变文件由验证器复用有效结果；浏览器夹具未连接真实账号或写入系统剪贴板。测试进程已退出，临时端口 53278 已确认关闭。

第二十一批检查礼物身份资料分页/缓存、头像补全、同人同礼物卡片聚合、滚动展示状态及参数兼容，以及服务器礼物工作区、历史分页缓存、查询快照下钻、日期选择和图表控件。新增已确认问题为 0。卡片按已接受的 UID/礼物 ID/名称规则合并，逐条历史金额以整数分累加，正门槛在合并后严格比较；未知身份与旧日期记录保持独立。头像读取限制并发和等待，迟到结果不改变已返回快照。滚动行在换行边界应用新集合，隐藏/来源切换/退出清理状态，重复通知复用节点。服务器历史和统计共享查询快照，分页及下钻用请求代次隔离，返回原分析保留原页缓存；没有按文件行数要求拆分具有既有职责边界的 owner。新增 76 项检查通过，所有进程已结束，临时端口 61329 已确认关闭。

第二十二批检查服务器构成图、趋势/曲线、圆环过渡及共享统计聚合，以及客户端礼物提示、冲刺状态/浏览器源、图片目录更新提示与组件初始化。新增已确认问题为 0。当前管理契约要求三类礼物互斥，名称不参与分类；已知零成本与未知成本区分，后者不被补为零成本。受限分组与“其他”继续使用完整分母；图表缺失分类显示不可用，数据不完整时不把未知日期补成零，月图显示上限不裁剪汇总。独立构成范围保留已提交搜索条件，以请求代次拒绝旧结果。客户端面板按变化键更新，目录提示先订阅再读取并在退出时解除；未为相似视图额外引入抽象。新增 48 项检查通过，测试进程均已退出，临时端口 52886 已确认关闭。

第二十三批检查盲盒映射目录/在售来源、精确主题、许愿参数块和格式编辑，以及管理采集账号的页面、二维码服务、加密文件存储、授权提交及管理礼物/IP 呈现。新增已确认问题为 0。房间刷新串行跳过已替换上下文，错房结果不应用；许愿参数块按整体复制/剪切，粘贴先转纯文本，样式操作保留未选行和撤销历史。采集账号是明确授权的全局副本，二维码按发起管理员归属；替换/取消/移除和提交前权限复核阻止旧写入，文件独占准备、最终检查后同步替换。管理礼物视图绑定创建时的主播，销毁中止旧读取；IP 地图按合法坐标延迟创建且保留不变内容。新增 72 项检查通过，测试进程已结束，临时端口 61015 已确认关闭。

第二十四批检查客户端字体目录/下载/缓存、HTTP 与 IPC 交付、样式替换、共享/本地字体选择和加载提示，以及服务器首页统计、舰长名单快照同步、到期呈现与管理导航。新增已确认功能缺陷为 0，另记录 D-004 错误注释。字体源逐跳校验并限制下载体积，文件与索引按顺序发布，旧选择保留到字体可用；实际 Chromium 字形检查覆盖内置字体及多语言回退，未将模拟的本地字体权限等同于 Electron 授权。首页按正确的包含时间窗聚合；名单同步按主播/房间合并在途任务，调用方取消相互隔离，提交前复查房间。新增 58 项检查通过，测试进程已结束，临时端口 54260 已确认关闭。本批未改变业务源码、现行契约、用户指南或测试预期。

第二十五批检查客户端授权 IPC 的公开字段、歌单/背景参数、桌面/音乐入口、协议规范化、远端适配与重试/唤醒/指纹辅助模块，以及服务器歌单标题、二维码存储/头像派生、页面 PNG 转换和房间/登录资料共享缓存。新增已确认问题为 0。特权调用由各自注册器约束窗口来源和可用主帧，固定回复另复查账号代次；没有把职责不同的 IPC 注册器强行合并。标题独立保存，二维码仅接受认证身份、固定文件和许可头像；失败保留可恢复副本，过时页面转换及资料结果不能覆盖新上下文。新增 99 项检查通过，包含实际二维码 PNG 导出与独立解码。测试进程已退出，临时服务端口 3217 已确认关闭；签名协议夹具因既有跨端基线不匹配而未重复执行，不能据本批结果宣称跨端协议全部通过。业务源码、现行契约、用户指南和测试预期未改变。

第二十六批检查剩余六个客户端 IPC 适配器及账号/主题/提醒 owner、通用登录窗口与凭据队列、公开资料刷新和诊断，以及服务器凭据校验/提交、Device 云路由、revision 事件、WBI 与上游请求/发送。新增已确认问题为 0。抽奖账号独立保存，舰长到期账号临时登录后只交云端；账号切换与取消在异步节点复核，正常续期保留同账号上下文。主题失败保留已提交状态，提醒先整批校验，再按期限调度并清理通知与监听。通用账号页面用请求代次丢弃旧资料；没有凭局部异步函数缺少检查就忽略其调用方保护。服务器跨库失败后先停止旧连接、恢复后重试，是现行明确契约，不要求两库原子性；WBI 只共享公开材料，租户 Cookie 和发送快照保持绑定。新增 133 项检查通过，均为隔离测试；测试进程已退出。本批未修改业务源码、测试预期、现行契约或用户指南。

第二十七批检查客户端在售面板/配置解析、缓存与组合入口、头像地址和同步统计消费者，以及服务器活动身份归档、种子/房间来源、同身份元数据补全、目录分类/发布、价格与变体估值。新增已确认问题为 0。同 ID 的不同名称/价格/币种/背包身份按契约归档，兼容投影不替代完整历史；补全不跨身份覆盖非空字段或零值，普通收入及明确实付成本不被目录标价改写。HTTP ETag 对完整响应序列化，包含目录排序和新鲜度变化，不能因业务摘要排除观测字段就判为漏更新。采样有房间/分区/并发上限，失败来源保留诊断而不编造数据；无证据的奖池来源保持未知。新增 70 项检查通过，已有客户端混合目录缓存用例复用旧结果而未重复运行。CLI 刷新脚本仅静态检查，未读取用户配置或执行刷新；测试进程已退出。本批未修改业务源码、现行契约、用户指南或测试预期。

第二十八批检查客户端盲盒配置、礼物特效加载及事件、边框与大航海答谢配置、设置写入和广播消费者，以及服务器盲盒来源、关系持久化、完整发布事务和概率展示/收益汇总。新增已确认问题为 0。目录满时只延后新奖池，已维护关系及其他元数据继续更新；真实写入失败仍整体回滚。完整身份约束阻止跨活动套用概率，共享概率只计一次，缺失或非法概率不生成精确汇总。当前礼物事件的异步交付在解析前后复核上下文，旧版未调用的构建器不能据此判为现行事件格式冲突；设置入口限制已知键，答谢配置的内部回退不构成任意设置写入。新增 74 项隔离检查通过，概率数据仅阅读来源及结构，并由已有完整快照测试验证，未逐条人工核实 734 行数据或实时活动。测试进程已退出；未启动桌面或验证实际特效播放。本批未修改业务源码、现行契约、用户指南或测试预期，行为未变，无需同步这些内容。

第二十九批检查服务器兼容目录查询、筛选/分页/详情、服务与运行时组合、特效命令及其订阅调用方，以及客户端包解析门面、protobuf、礼物身份提示、弹幕/用户资料解析、缓存和 feed 交付。新增确认 F-015：单个解析器的合法输入和联合调用的合法输入不一致，导致资料格式转换被误解为已核验的身份消失。服务器目录查询复用此前未变化的测试结果，没有重复运行或增加测试计数；不同目录 schema、展示投影和命令入口继续按各自契约判断，不要求合并模块。新增 30 项现有检查通过，并补充 F-015 的合成集成复现；这些通过结果不包含该缺失用例。测试进程已退出，回环 SSE 由测试关闭。本批只新增审计证据，未修改生产实现、测试预期、现行契约或用户指南；对应修复的测试与文档核对位置已记录在发现中。

第三十批检查客户端 WBI、错误提示、房间输入/舰徽人数、舰长名单、获胜者资料、自定义关键词与云端精确命令交接，以及服务器礼物弹幕查询、日历命令、观众称呼、直播答复会话、最近弹幕缓冲和机器人状态设置。新增已确认问题为 0。查询按可信请求者/房主、水位和汇总版本冻结范围，取消与清空使旧结果和排队答复失效；没有将暂时查不了报告为零。称呼是独立持久偏好，先保存再尽力确认是明确契约，不能按发送失败不回滚判为事务缺陷。舰徽人数独立于监听开关，换房及停机丢弃旧回包；公开签名材料有共享请求、期限和按实例失效保护。关键词设置在写入入口解析，云端精确命令不会再触发本地 AI/关键词回复。新增 127 项检查通过，包含真实查询 worker 的关闭；未连接平台或启动桌面，全部测试进程已退出。本批只更新审计证据，生产实现、测试预期、现行契约和用户指南均未改变，既有说明无需因审计新增操作步骤。

第三十一批检查客户端本地实例证明、Windows 进程归属、监听与清理、请求排空、固定页面组合、静态文件和 overlay 引导/受限 HTTP，以及服务器 overlay 资源快照、接入配额、礼物图片身份与相关调用方。新增已确认问题为 0。本地关闭凭据仅交给已验证的同一 TCP 连接，强制清理再次确认 PID、创建时间与实际入口；旧运行文件不能指向任意 PID。停机调用方先停止接纳，再等待已接纳请求，不能据内部 drain 方法缺少通用重开能力要求新增状态机。页面组合路径固定，overlay 能力、管理凭据、HTML 沙箱和静态资源跨域分别约束。服务器带版本资源读取启动快照，接入失败、断开及重复释放不会泄漏配额，礼物图片不按同名/同 ID 猜测。新增 44 项检查通过，另有一个服务器图片测试文件有效缓存复用；Windows 测试确实执行，隔离子进程及 HTTP/SSE 已结束。未启动或重启用户应用，也未验收完整 Electron 退出及 OBS/哔哩哔哩直播姬播放。本批仅新增审计记录；生产实现、测试预期、现行契约与用户指南未变，无需同步操作步骤。

第三十二批完整检查服务器入口、配置与生命周期模块，追踪生产资源装配、Host 页面与 API 挂载、配置原点/管理链接、运行时版本门和日志清洗/预算。新增已确认问题为 0。管理边界先检查原始 Host，不接受转发 Host 替代；正文只在具体路由的鉴权或配额后解析。健康检查确有轻量身份库读取，但按契约不证明所有租户或上游健康，未要求它遍历租户。生产配置约束环回监听、Secure Cookie 和公开管理原点；有界数值保留已接受的小数语义，不强行统一为整数。关闭共同等待业务、发送、备份、目录及 HTTP，再关库，重复信号共享任务，五秒失败退出是明确期限；致命异常监听只诊断，不吞掉退出。新增 70 项检查通过，测试的生产子进程及目录库均重定向到临时根，已全部退出。仅核对代理头和回环 HTTP，未验证真实 TLS、反向代理部署或公开平台。本批只更新审计记录，现行实现、测试预期、契约和用户步骤未变。

第三十三批检查客户端开播参数、样式独立设置、媒体 multipart 校验、文件发布/读取、普通与画布入口、API 分发/运行时绑定及设置 store，新增确认 F-016。图片采用大小/签名校验，媒体读取仅允许已选中的槽位；打开前消失、打开/读取失败和客户端中断已有独立处理，HEAD 不发送实体。画布入口在异步读取后再次验证其预览会话，未将不同入口的授权职责合并。新发现位于文件成功发布后的两项设置提交边界，文件流保护不能覆盖这个失败阶段。新增 17 项既有检查通过，另以真实 SQLite 和 HTTP 做正常/失败/批量事务对照；临时数据库、流子进程和 HTTP 均已结束。本批只新增审计证据，生产实现和测试预期未改；修复涉及的现有测试、技术参考及无需改变的用户步骤已写入发现。

第三十四批追踪服务器公开密码重置、原始设备证明校验、会话签发、历史记录投影、分页令牌和账本一致性检查，新增已确认问题为 0。重置码的消耗、密码和登录版本在同一事务提交，哈希计算后仍检查码是否有效；设备入口先验证原始字段，再归一化和验签。历史令牌绑定已认证的主播、设备和授权版本，限制用途、有效期与密钥轮换，分页固定锚点/恢复游标，锚点或 epoch 变化要求重建，不能以客户端租户参数替代认证身份。新增 23 项既有检查通过；已存在的管理员界面与改密成功结果没有重跑。证明校验的正常与失败流程、快照和清库使用隔离数据库及回环服务，均已结束；没有把这些结果描述为生产部署或全量授权组合验收。本批只更新审计记录，现行实现、测试预期、契约与用户步骤未变。

第三十五批完整检查客户端导入字段/CSV/XLSX 编解码、预览计划与提交、歌曲匹配及两类冷却模块，并追踪管理页输入/预览/确认和 store 事务。新增已确认问题为 0。预览绑定当前歌曲、分类、原始导入内容与替换选项，提交在事务内重算；空表、冲突或无效行拒绝整批操作，失败恢复删除项、更新及关联，匹配歌曲保留 ID。界面用输入代次丢弃旧预览，仅提交确认过的内容，列表刷新失败仍说明本地已保存。歌曲候选先校验标题关系，版本、歌手/时长冲突与不可播标记继续限制自动接受；冷却按入队时间和账号 scope 使用，不因清队列/换歌库而重置。新增 90 项既有检查通过，使用内存/临时库与替身，没有新增并行实现或为纯函数路径搭建桌面自动化；完整测试执行不等于所有测试源码已逐行审阅。本批只更新审计证据；技术参考已对照，生产实现、测试预期与操作流程未变，无需改动现行指南。

第三十六批完整检查桌面运行时适配、入口错误处理、路径解析/旧目录迁移、字体权限、媒体请求头/CORS、本地媒体协议、资源读取与检查状态机及 preload，并追踪主进程/IPC 的接线和本地文件管理器，新增确认 F-017。路径 allowlist、音频扩展名、精确来源及主 frame 校验继续有效，未把授权保存失败误报为权限绕过。资源检查按现行只读诊断契约拒绝不安全路径、比较句柄/路径身份、合并重复检查并阻止取消后的迟到状态，范围不扩展为防篡改认证。旧目录迁移先持来源锁和检查 runtime，失败不发布半份目录，已有目标保留。新增 40 项既有检查通过，另运行实际清单/IPC 的正常与失败重试对照；临时数据与任务均已结束，没有启动用户应用。本批只新增审计证据，生产源码、测试和现行技术参考/操作步骤未改，修复影响已记录在发现中。

第三十七批完整检查服务器传输包解码、Web/V2/开放平台礼物解析、protobuf/标量工具、输入边界、发送者展示及大航海重复通知 helper，追踪 monitor 到既有 detector 的调用和参数归属；新增确认代码缺陷为 0，记录规格待核对项 D-005。4 MiB buffer/解压输出和深度限制、坏压缩块后的独立 frame、严格认证响应与固定诊断均有覆盖；未把每个包的限制扩大解释成全连接累计资源保证。V2 重复产物列表逐项解析、已知 UUID 字段保持字符串，正式监听复用已解码对象并省略不用的 raw JSON，不重复序列化。检测前统一累计数量/有效单价，六秒静默、事务 final/delivery、失败重试和已提交结果的恢复保持既有职责。新增 53 项现有检查通过；两端 helper 的五组 source 对照证明当前行为一致，规范文字另需对齐意图。仅使用合成包、隔离数据库和可控时钟，没有访问真实直播间或改写规范/测试，未将上游补偿能力列入本批验收。

第三十八批完整检查客户端桌面 logger、诊断监听、独立状态对象、终端镜像、日志整理及共享大小/频率限制，复核已有脱敏器和主进程接线，新增确认问题为 0。日志先脱敏再输出，格式化失败只保留安全占位；最终 UTF-8 长度、轮转、正常/错误保留期和单 writer 频率分别受当前契约约束。旧错误提取失败保留源记录待重试，不将有界日志解释成完整历史保证。普通与错误写入共享 run/序号，诊断只采集精确本地来源，远程页面内容排除，销毁/退出释放监听；致命异常仅通过 observer 记录，默认进程处理继续。20项 Node 检查与一个真实 Electron 43.8.3 检查均通过，后者仅启动独立脚本、临时用户目录、隐藏测试窗口和回环页面，实际覆盖预加载、页面/Promise、加载和渲染进程失败落盘及夹具凭据脱敏，未启动 LIRA 主入口或控制用户窗口。当前日志设计计划仍有后续范围，不将未完成的未来方案自动当作现有实现缺陷。本批只更新审计记录，源码、测试预期与用户步骤未变。

第三十九批完整检查服务器估值、盲盒配置合成/匹配与通知证据模块，追踪正式 monitor、detector 和答谢注册/提交的边界，新增确认问题为 0。新组依据已接受的活动和官方/私有 V2 关系定价，已有组在目录/设置变化及恢复时保留依据；迟到正增量通过数量、价值及可空成本偏移形成补充结算段，不重写旧 final，不将早期未知成本补扣到新段。通知 sidecar 另行验证数量、订单 token、身份和免费证据，不把付费解析器的兼容默认当成购买证据，也不阻断账本提交。官方基线尚无版本与活动元数据暂不可用是不同状态；ADR-0037 明确前者 `applied=false`，后者可继续使用有效 V2 匹配，未据此扩展无基线推断或重新启用旧名称映射。新增40项既有检查通过；先前活动估值和答谢检查仍有效，未重复执行。仅使用隔离数据库、合成目录和可控传输/发送队列，全部结束；现行实现、规范、测试和用户操作均未改，无需为本批新增操作指南。

第四十批完整检查客户端远端礼物来源键、恢复规则及保留窗口编排，服务器礼物 broker、交付服务、身份/去重 helper、卡片资料服务与 store，并追踪授权响应校验和现有控制器调用。新增确认问题为 0。正式游标持久化属于 SQLite，JSON store 为旧兼容 helper，不能把未使用路径当作现行故障。网络字段类型在授权 API 边界校验，恢复层检查连续性与 epoch，不重复实现解析；过期分页令牌重启分页，失效 epoch/游标才重建投影。已裁剪前缀与真正缺口分别处理，空 outbox 保留已分配水位。broker 投影冻结且按字段能力序列化，回调异常彼此隔离；返回订阅数量是现有约定，不冒充投递确认。专用卡片资料响应按认证租户及北京时间今天分页，修订读取与数据位于同一快照，修改/回滚/外部连接、日期及租户变化均有对应检查。新增60项既有检查全部通过，仅使用合成数据、隔离数据库、假的远端和回环 HTTP/SSE，全部进程与连接已结束；未验证真实上游或完整桌面流程。本批仅更新审计记录，源码、测试预期、现行技术契约与用户步骤未变。

第四十一批完整检查客户端天气工具、密钥 codec 和服务器两家 IP 归属查询/投影模块，局部追踪配置保存、运行时注入、工具参数及管理员设备读取。新增确认问题为 0。密钥经注入的 safeStorage 加解密，不可用时拒绝保存，无明文回退；调用方保留方法绑定，不能以假设的解构调用要求改造。天气每次实际请求前计配额，发送前取消不计数，已发送后的失败不退还；非当天天气按当前契约返回三日预报，不擅自扩展日期接口。IP 来源只取已有设备连接记录，外发规范化公网 IP，无应用凭据；固定来源、拒绝重定向并核对回显，两家结果独立投影，坐标必须成对，未知精度不推断。共享并发、排队期限、响应体和缓存均有界，单个来源失败不丢设备或另一个来源。新增17项既有检查通过，原天气成功记录未重复执行；没有查询真实账号、IP 或天气服务，也没有实际调用系统加解密。本批仅更新审计记录，业务实现、测试预期、技术契约与用户操作未变，无需同步操作指南。

第四十二批完整检查音乐登录窗口、取色主进程/专用 preload/页面，以及服务器昵称注音、名字例外、固定回复设置和每日内置词库，局部追踪认证控制器与设置、欢迎消费者，新增确认问题为0。登录窗拒绝权限、限定平台导航，Cookie 检查合并重叠读取；关闭清理监听并等待已开始保存，账号操作队列再执行退出或替换。取色只接纳已登记临时窗口的精确本地主框架，主进程按对应屏幕图像计算颜色；取消、owner 导航/销毁、显示器变化和释放注册器均结束操作，旧捕获不会再开窗。昵称按字素保留原文，仅追加单一已知读音，未知/多音字保持原样；固定回复布尔开关由上层处理，结构化字段再校验精确键、重复触发词及词库/间隔边界。新增12项既有检查通过；已有57项机器人与40项欢迎/PK组结果保持有效，未重复执行。仅使用替身窗口、合成数据与本地字典，未截取屏幕、登录音乐账号或启动桌面。本批只更新审计记录，现行源码、测试预期、技术契约和用户步骤未变。

第四十三批完整检查服务器歌曲规范化、store、同步事务服务及 Device/Admin 适配，追踪 Streamer 兼容入口、字段/预算夹具和五个现有测试文件，新增确认问题为0。正式调用路径由歌曲服务拥有事务，歌曲、来源标记和 revision 同时提交后发布版本；非法尾项、插入中断或标记失败均保留旧快照。完整 Device 投影按实际 UTF-8 JSON 字节计量，缓存仅复用仍有效的已提交行，外部写入、触发器及事务嵌套使用完整读取。价格保留描述性文本，Unicode 截断遵循既有 UTF-16 上限并保留完整代理对；公开投影只读启用歌曲，管理字段不外露。旧超限歌库仍可读取和逐步删除，新增/编辑遵守完整响应预算。新增51项既有检查通过，包括真实回环 HTTP 上六个正式写入口的超限413和数据/通知不变；未执行真实桌面同步或把该组扩展为全部正文解析器边界验收。本批仅更新审计证据，现行实现、测试、规范及用户操作未变。

第四十四批完整检查客户端系统指标、硬件查询和系统路由，新增确认问题为0。CPU/内存记录自身采样窗口及结束时间，GPU 在命令期限内可晚到；计数器超时或失败保留不可用状态和 null。命令与参数由固定程序及有界数字构成，隐藏窗口、输出和时间均受限制。静态硬件按进程缓存并复制后交付，显示器每次读取，温度仅在明确请求时查询；缺失的 build 修订号、显存饱和值、缩放和默认刷新率保持未知，投影不带序列号字段。新增13项既有检查通过，仅使用命令/时钟/硬件替身，未验证实际驱动、传感器或多 GPU 对应关系。仅更新审计记录，现行实现、测试预期、技术契约和用户操作未变。

第四十五批完整检查服务器礼物查询服务、执行器、既有 worker/日期 helper 和五个测试文件，局部复核清空、删除、保留维护及设备入口，新增确认问题为0。正式调用使用认证或数据库中的数字租户 ID，查询路径由 storage 解析；暂停租约、租户代次和维护队列覆盖旧任务，确认读句柄释放后才允许删除或清空。单个 worker 的排队、租户配额、轮转、含排队期限及崩溃重启均有界，主进程按请求/代次和白名单校验结果；未知异常不跨线程外泄。新快照绑定租户、筛选、asOf 与账本水位，后续旧时间补录或进度转 final 不进入原成员集，分页/日期下钻保持同一快照；旧 v1 游标按已接受的兼容契约保留。ADR-0059 明确允许只读交付水位，未据旧 ADR-0031 的原文字面误报越界。新增32项既有检查通过，实际使用隔离数据库和真实 worker 验证跨租户、原生句柄释放及维护交错；全部结束，无真实直播、用户数据或完整部署验收。本批仅更新审计证据，源码、测试断言、现行规范和用户步骤未变。

第四十六批完整检查客户端 overlay 投影、独立弹幕组件来源与云端显示适配、`harbor` 与 `flower-letter` 两个卡片模块，局部追踪页面入口及既有测试，新增确认问题为0。HTTP、快照和 WS 按 scope 分别选取字段，标量位置拒绝嵌套对象，未知能力关闭；游戏未揭晓答案和评分进行中统计按阶段隐藏，已有公开展示字段仍保留。大航海动作字段缺失的初步线索经正式入口回溯：界面复制的 `/danmaku?source=component` 及场景直接消费云端快照，绕过通用旧 WS 投影；未确认需要将 F-006 扩大到该旧投影，原缓冲丢字段问题及修复范围保持。原始旧礼物行也不应凭未验证字段推算动作。新增13项既有检查通过，使用内存 owner、VM 和共享 renderer，无实际 OBS/哔哩哔哩直播姬或桌面播放。本批只更新审计证据，未修改源码、测试预期、现行契约或用户步骤。

第四十七批完整检查服务器云端状态服务，核对设置保存、固定回复窄补丁、目录接管和异步启用的调用边界，新增确认问题为0。租户库保存规范房间和 revision，身份库旧房间字段为尽力维护的镜像；镜像失败不撤销租户提交，明确清空也不回退旧房间。关联设置写入同一租户事务，提交后再协调运行时与通知；主动启用答谢/查询时，登录验证后再次检查授权、租户连接、版本、房间和身份，连接保留在成功、拒绝及异常后均释放。普通同步操作复用一次连接校验，异步等待后重新确认句柄。私有盲盒写入遵守官方 ID/名称冲突规则，后续官方目录接管持久归档；单个租户协调失败记录安全错误码后继续，身份库整体失败仍向上传播。新增30项既有检查通过，全部使用隔离数据库和替身目录/监控/验证器，未实测真实登录、直播重连或部署。本批仅更新审计记录，业务实现、测试断言、技术契约及用户操作未变。

第四十八批完整检查客户端 XLSX/ZIP/XML 编解码和歌曲文件 owner，局部复核导入入口及技术参考，新增确认 F-018。解压使用实际输出限额并核对输入消费、CRC 与记录范围；XML 单次扫描、稀疏数组及累计文本有界，未凭手写解析器推测压缩包漏洞。工作表选择却使用归档条目顺序，两个内容相同的有效双表包在生产解析器中产生不同歌曲；独立读取器确认它们的首个页签与首表歌曲相同。32项既有检查通过，未重跑第三十五批已经通过的文件编解码用例；新增复现仅使用合成文件、内存解析与独立只读核对，无用户库、Excel 或 Electron 操作。本批只更新审计记录，修复与相应测试/契约/指引调整尚未实施。

第四十九批完整检查服务器账本与礼物聊天查询、账本迁移及三个测试文件，新增确认问题为0。查询使用只读句柄、绑定参数与同事务快照，交付水位限制成员集；明细排除已汇总记录后与固定 revision 汇总合并，保留未知成本和整数分，未把历史空房间兼容或异常库值猜测升级为缺陷。两段游标查询保持相同时间与更早时间的互斥，保留期边界和可分配水位没有在删除后倒退。既有索引迁移检查确认反复初始化、重开与备份恢复保留账本、交付、序列和 epoch；不将其扩展为所有历史版本迁移的完整验收。新增8项检查通过，均为本批新执行文件，旧保留维护27项有效结果仅作补充未重复计数；测试进程结束、临时数据库根已清空。源码、既有断言、技术契约和用户步骤均未改变。

第五十批完整检查客户端全民 K 歌原生监视源、缓存读取与发现、本地歌词仲裁、在线兜底及四个测试文件和夹具，新增确认问题为0。音频源按进程筛选各输出设备会话，单设备失败不覆盖其他设备的活跃状态；无会话保留未知，MSAA 树深度和节点数有界。日志从尾部按 UTF-16 偶数边界分块限额回读，支持跨块拼接，最新歌曲不符时不借用更早同名记录；命中 mid 后只用对应 QRC，无 mid 且同名缓存多份时交给在线匹配。目录发现只查固定候选，当前歌曲与日志时间用于消歧，不创建缺失目录。在线候选先满足歌手、明确版本和时长条件，再比较歌词质量与偏好；每次读取当前设置，单平台失败不压掉另一平台结果。这些职责已有模块分别拥有，未为相似文本处理提出跨领域合并。39项新检查通过，包含实际 C# 编译/执行与合成缓存解密；不等于真实全民 K 歌版本、MSAA 控件树、声卡及在线平台验收。业务实现、现有测试预期、技术契约和用户步骤未改变。

第五十一批完整检查服务器礼物检测存储、互动贡献存储与检测器，局部复核估值及答谢消费者，新增确认问题为0。final 状态和唯一交付记录在同一事务提交，失败保留进度并重新安排可取消的重试计时器，发布发生在提交后；重放不新建交付。互动以持久通知键去重，在独立事务中保存批次和累计区间，已交付偏移先换算，未知数量/成本不被推成已知，答谢前再次核对当前 final 行。检测器导出的方法绑定实例，存储句柄继续由租户数据库 owner 管理，没有新建全局状态或生命周期。新增2项真实数据库重开检查通过：设置与已付账本保留、历史答谢不恢复，旧来源/账本代次不能发送，新工作仍遵守启动静默；这符合现行互动协议与 ADR-0043。此前入账生命周期53项和答谢链82项通过证据仍有效，仅复核未重跑或重复计数。本批只更新审计记录，未修改源码、测试断言、技术参考或用户操作说明。

第五十二批完整检查客户端设置默认值、迁移与 store、启动包装、主题配置/视图及保存服务，局部回溯启动装配、设置校验、主题页面和规则 renderer，新增确认 F-019。默认值插入前保存旧版本并先转换已有字体，独立字体缺失时复制旧值而不覆盖后续选择，速度和风格转换写检查点；整个 bootstrap 在同一事务内完成。盲盒显式空配置保留，旧字符串按已知价格转换且未知值保留，既有35项配置组通过证据复用未重跑。旧默认规则的清理却没有完成标记，在所有当前版本下仍删除用户新保存的两段文字；真实服务保存、数据库关闭重开和再次保存的对照确认 F-019，未扩大到其他文案或业务规则。新增8项启动检查通过，主题入口为静态调用追踪，无真实桌面重启或浏览器视觉验收。本批仅新增审计证据，修复及对应测试/技术参考更新待实施，用户编辑步骤未改变。

第五十三批完整检查服务器歌曲价格文本迁移与两个测试用例，局部复核歌曲库初始化并对照已接受 ADR-0028，新增确认问题为0。旧非 TEXT 列按原表列名显式复制，仅对价格进行文本 CAST；重建、附着索引/触发器和序列恢复在同一事务内完成，已是 TEXT 时不重复重建。价格仍是展示说明，不在迁移中变成金额计算或点歌权限。两个检查通过，表达式索引所需函数缺失时原 schema、数据和索引恢复，未残留中间表；正常初始化两次保留原行。本批未据外部手工增添的跨表依赖或其他无现有生产者的 DDL 假设新增问题，也未将两种夹具通过包装成所有历史库的完整验收。源码、测试断言、技术契约与用户步骤未改变。

第五十四批完整检查客户端保留期、清空操作/协调/结果、维护门面与运行时清空 owner，局部复核路由和领域装配，新增确认问题为0。删除与保留对象由矩阵明确，清歌库先解除队列/历史对歌曲 ID 的引用，当前礼物来源单独重置投影，其他来源与约定保留资料不因函数名“全部”而扩大删除范围。跨库逐次提交的部分失败有明确结果，重建默认行在首次提交前完成；预提交全部回滚后只释放本次取得的暂停，部分提交、回滚或运行状态恢复失败则保留暂停，不广播成功。保留期默认不删业务流水，原始报文清理不删解析结果，dry-run 不写入，最长 999 天歌曲冷却的边界和未来记录保留。新增14项检查通过，包含真实领域运行时的恢复与失败重试；矩阵、保留边界和错误语义已有契约，未另建全局事务或给辅助统计提出未证明影响的重构。本批仅新增审计材料，业务实现、断言、技术契约和用户步骤未改变。

第五十五批完整检查服务器历史写入、SC 去重存储、观众采样保留、称呼存储及历史读取，局部复核监控和称呼调用方，新增确认问题为0。SC 只持久化不透明键，旧内容表在复制键的同一事务中移除，不能把有意的历史内容删除误报为丢失业务记录。观众指标按租户库、ID 倒序保留最近 1,000 条，升级清理与触发器安装、此后插入与裁剪分别保持原子性；同指标一小时内跳过和现有读取顺序是明确契约。称呼是按租户/UID 保存的个人偏好，与上游昵称事实分开，普通重连和礼物清理不删除。新增8项检查通过，覆盖不同租户、真实连接重开和两类清理故障；已有称呼/查询99项结果仅复用未重跑。未实测真实房间轮询、平台发送或生产升级，源码、现行规范和用户操作未变。

第五十六批完整检查客户端持久主题预设 store/路由和静态预设卡片/样式视图，局部追踪迁移播种、API 装配与字段归属测试，新增确认根因为0，F-016 增加一处同类调用面。预设只抽取约定 scope 的外观键，标题/规则/置顶及账号资料不进入快照；同名自定义覆盖、内置项保护和首次外观留档有各自职责，未新增不存在的导入功能。API context 直接传递 store，`this.get` 的绑定没有缺失；卡片使用内置标签与配色，也没有把静态内容当成用户 HTML 注入。预设 API 的逐键应用在真实临时 SQLite 故障下注入确认部分提交，与 F-016 共用缺少批量提交这一同类根因，因此补充证据而不重复计数。当前界面另走已有批量设置，不扩大该 API 结果到常用界面。一个既有字段隔离用例通过，正常 CRUD/播种及失败/重开/批量回滚对照由单独脚本验证；业务代码、现有断言与当前契约均未改。

第五十七批完整检查服务器设备资料、主播查找和规范房间读取 helper，局部回溯认证中间件与实际消费者，新增确认问题为0。profile 从认证后的设备记录取内部主播 ID，权限与撤销检查在路由边界完成，不信任 body 中的租户选择；资料 DTO 仅返回约定身份与由受信配置生成的地址。账号查询由上层先归一化，公开查找仍由调用方拒绝非 active 记录。租户设置中的房间优先于身份镜像，明确空值不会回退为旧房间；不能因资料 helper 本身未重复鉴权或 DTO 不含无关 DAL 字段就推断越权。新增11项兼容检查通过；旧账号命名空间42项、设备证明/历史18项和共享资料5项结果复用未重跑。测试使用隔离数据库和合成验证器/监控，回环 HTTP 已随测试关闭，无真实账号、房间或部署验收。本批仅更新审计证据，技术契约和用户步骤保持。

第五十八批完整检查客户端加班机输入契约、运算 helper 和两份边界测试，局部追踪保存、数量守卫和随机选择调用方，新增确认问题为0。秒与毫秒转换、时间饱和、因子和权重范围有统一边界，group 与 item 按约定确定执行次数；随机总权重只算一次，超限在抽取前整笔保留 pending，不写部分结果或推进倒计时。图片路径按允许的 origin 和目录验证，旧目录迁移由组合根按礼物身份解析；未因独立 helper 的宽松数字转换推断不存在的生产者风险。新增15项检查通过，覆盖十万件边界、重放和服务重建；既有 F-004 保存事务问题不重复登记。本批没有更改实现、测试断言、技术契约或用户步骤。

第五十九批完整检查服务器礼物映射/特效配置读取、展示列迁移和显示资料测试，局部回溯监控工厂与已有云端开关用例，新增确认问题为0。读取器绑定主播数据库，映射缓存同时比较配置和修订元数据的原始值；特效仅接受明确保存的 true，缺省关闭。显示迁移在事务内按列存在性补齐，旧资料保留未知，不从礼物名称补造身份；显示扩展按请求能力返回，组合礼物保留首次可靠资料。新增4项检查通过，已有30项云端状态组中的租户开关证据复用未重跑。映射缓存结论来自代码追踪，未冒充独立运行时压力验证；本批仅增加审计材料，技术协议与用户操作无变化。

第六十批完整检查外部网易云/QQ 采集器、网易云原生引擎读取源码及三份测试，局部复核监控管道、元数据合并和音乐运行时装配，新增确认问题为0。采集器用曲目代次隔离迟到歌词，启停/刷新更新监控代次；时钟无效时隐藏歌词，实际播放意图仍独立参与来源仲裁。SMTC 按约定允许长期锚点，QQ 应用报告速率；采样时钟则检查新鲜度、停滞和整数秒连续性，不将两类时间语义强行统一。原生读取仅请求读权限，限制 PE/段/签名和字段范围，身份在前后两次读取之间变化时丢弃混合样本。新增27项检查通过，C# 用例实际在 Windows 编译生产定位/读取逻辑并使用合成字节数组；没有读取真实播放器、操作播放或验收各客户端版本兼容性。既有监控测试未重跑，本批仅更新审计证据，实现、断言、技术参考和用户步骤未改变。

第六十一批完整检查服务器 Admin 导出门面、审计日志读取、设备错误码 helper、备份 worker 与其运行时和测试，局部复核路由及备份资源关闭，新增确认问题为0。Admin 门面仅装配既有 owner，审计日志的全局读取位于管理员认证之后，固定取最新200行，不从客户端拼接 SQL；错误码 helper 保持业务 code。Worker 仅接收组合根解析的路径配置，父进程把成功消息与实际退出共同作为完成条件，禁止备份重叠，停机取消后续调度并等待本次完成。新增6项检查通过，其中真实 worker 将隔离 WAL 数据库备份为可单独打开且 quick_check 正常的快照；四个新入口另通过语法检查。服务器已触及文件仍有局部和多视角待补齐，本批没有更改生产实现、测试断言、技术契约或用户指导。

第六十二批完整检查客户端数据目录迁移、统一路径计算、礼物初始化脚本和对应迁移/启动/原生夹具，局部回溯桌面及独立服务入口，新增确认问题为0。已接受 ADR-0016 要求只移动已知条目，日志先落盘，同卷重命名后可续作；整批冲突、缺失条目、跳转目录及活动服务在移动前检查，未知文件与业务数据保留。日志发布失败仍保留 pending，有限重试仅替换同一准备文件，不重复移动资料。桌面在原数据根持锁后、ready 前迁移，失败停止启动；服务及初始化脚本在缓存 owner 打开前执行同一迁移。新增22项检查通过，真实 Electron 夹具完成 seed/迁移/重复启动/持锁与第二实例检查，保留默认及音乐分区 Cookie、localStorage 和加密资料；所有路径来自临时根，不加载 LIRA 主应用、不操作用户数据。本批仅新增审计证据，迁移契约、实现、测试断言与用户步骤未改。

第六十三批完整检查 QQ 加密流代理及其现有测试，局部核对 Provider 会话创建/过期与路由传参，新增确认问题为0。Provider 保存短期密钥并只返回本地会话 ID，代理负责正文读取、偏移、解密和释放。200 正文从零开始，206 按有效响应范围定位；字节额度同时检查声明和实收，读取截止不覆盖下游背压等待，断开、拒收和失败均清理监听、正文与 cipher。新增16项检查通过，合成数据验证偏移及生命周期；QMC 算法、实际 CDN 重定向链和播放兼容性仍未验收。本批没有改变 API、测试断言、技术参考或用户操作。

第六十四批检查共享弹幕字段、通用效果参数、控件、效果/滤镜与浏览器源适配模块，局部追踪时钟与网页参数面板调用方，新增确认问题为0。浏览器弹幕合同是源头，Node 生成镜像通过只读检查；通用参数的 Node 与浏览器实现除模块包装外一致，共享段经等值复核。主题参数和通用效果分别按样式档案读写，旧停留时间、默认配色与显式覆盖各有既定语义。输入校验限制类型、范围和色阶顺序，文案按可见字符计数并用 textContent 输出；参数控件没有用原生 maxlength 截断组合 emoji。效果 owner 在重配置时恢复原属性，释放滤镜、观察器和监听；面板调用方也释放订阅。新增27项检查通过，其中四项实际启动隔离 Chromium，验证预设目标、飘窗变换组合、调色像素/透明区域、隔离 HTML 及动态消息效果和清理。这些证据限于隔离预览和合成事件，未扩大为真实桌面账号或推流应用验收。本批仅更新审计材料，业务实现、断言、现行技术契约和用户步骤未改。

第六十五批完整检查共享工具、机器人文案池与旧词库只读适配，局部回溯时间解析、CSV 编解码、礼物金额展示及显式旧数据迁移调用，新增确认问题为0。共享文案供默认设置与旧资料兼容使用，生产签到/抽签命令继续归云端；旧库中的自定义或异常词库保留给显式确认，不静默覆盖。时间的常用秒、毫秒、ISO 与北京时间文本经生产弹幕/SC 解析器归一一致，歌曲价格文本“0”经过实际 CSV 编解码保留，组合 emoji 截断按可见字符处理；这些合成检查另计。新增4项既有检查通过，旧90项导入/匹配组结果复用未重跑。工具行为按实际生产者和调用层契约评估，本批没有改变业务实现、测试断言、现行技术参考或用户步骤。

第六十六批完整检查本地显示通知、场景包装/运行时装配与前端共用读取器，局部回溯场景访问及两个 HTTP 入口，新增确认问题为0。连接先重验访问再占用槽位，交付和心跳继续检查不可变绑定；通知只传固定更新提示，按类型合并，并在慢连接、异常和销毁时释放监听与计时器。前端串行读取、限制事件大小和重连退避，明确撤销会清屏、隔离迟到响应，并继续受控轮询/重连；通知路由缺失或饱和沿用正常输出的轮询退路。新增22项通知及24项读取器检查通过，旧49项发布/HTTP结果继续复用，未重新计数。现有真实 HTTP 证据与本次纯 Node/VM 证据分别记录，未扩大为真实平台或推流应用验收。本批仅增加审计证据，API、实现、断言、技术契约与操作说明未改。

第六十七批完整检查粉丝档案页面 owner、表单提交锁定、操作组合与 IPC 注册，局部追踪上下文、冲突处理、详情按钮及既有测试夹具，新增确认 F-020。冲突处理的回包绕过既有选择代次检查，能在返回列表或切到归档后重新打开原档案；正确的数据库处理和其他档案资料均保留，问题限于页面选择归属。27项现有检查通过，额外五个隔离场景区分两个复现与三个正常/失败对照；未将合成交付屏障称为实际桌面时序测量。弹窗保存的取消与关闭均受锁定，不另报不可达的保存切换问题。业务代码、断言、现行技术契约及用户步骤未改。

第六十八批完整检查歌库表单/列表与分类选择、文件读取和导入替换页面，局部追踪组合根、状态读取与后端参数边界，新增确认问题为0。表格事件委托只绑定一次，行操作使用当前渲染快照；完整列表与筛选结果通过请求参数区分，筛选结果不误清正在编辑的歌曲。保存期间的新草稿保留，价格沿用明确的1000个 UTF-16 单元限制并以纯文本呈现；分类和标签组内并集、组间交集通过既有服务链核对。新增25项检查通过，其中12项真实隔离 Chromium 检查5000行、草稿和筛选；旧90项导入/匹配证据继续复用，导入预览令牌和输入代次不重实现。F-018 仍独立保留，没有将同一选表问题再计数。本批仅更新审计材料，业务代码、测试断言、技术契约和用户步骤未改。

第六十九批完整检查世界地图六个 JavaScript owner，追踪时区/日期、城市偏好和筛选排序、拖动取消、地球绘制与销毁、天气调度，局部核对星空 CSS，新增确认问题为0。时钟使用运行时 IANA 规则处理夏令时和非整小时偏移，换日以北京时间为参照；筛选排序只替换可见槽位，移除按城市 ID 处理。地球按可见性启停，迟到初始化在销毁后释放；天气按现行约定启动及整点后台更新，按城市去重、跳过已移除项，失败保留旧值，pagehide 终止。新增24项检查通过，其中五项真实隔离浏览器只验城市交互与实际星空 CSS，地球/天气使用替身，不能作为真实 GPU/气象服务验收。6452行目录由既有检查验证结构、坐标范围、时区可用性和代表性搜索，仍保持自动覆盖，没有宣称逐城市事实核验。本批未修改实现、断言、现行技术契约或用户指南。

第七十批完整检查直播歌词共用渲染器、参数/默认值、时间轴辅助、样式应用、换句执行和两个入口适配器，回溯共享时钟接口及后端时间轴规范化，新增确认问题为0。管理页预览与浏览器源使用同一视觉 owner，归一化时间轴有排序和预算；逐字预载、版本与内容签名、显式 seek、隐藏停帧和连写文字回退均有现行实现。参数按规范值去重，手动浏览暂停跟随，弹簧限制时间步长，换句先读取被打断的位置和高亮再释放旧动画。新增24项检查通过，其中四项实际浏览器验证慢帧仍连续填充、精确暂停、对齐、空格/换行、缩放轴及继承配色。测试使用合成歌词和隔离回环页面，不是播放器/推流应用集成；没有将通用参数分支或页面生命周期改造成额外框架。本批只更新审计证据，实现、断言、技术契约与用户指南未改。

第七十一批完整检查公共弹幕 feed、消息渲染分派、随机与飘窗位置/生命周期，局部追踪效果范围及普通弹幕、游戏的消费者配置，新增确认问题为0。固定列表从当前位置和速度续接，同批共用样式参数；移动中保留仍可能可见的节点，完成后使用已有测量清理，追加/resize/效果变化才重新适配。快照不重播入场，减少动态效果和销毁清理动画、定时器、观察器与监听；随机位置按实测范围避让并保留稳定点，飘窗按尾缘离开结束、等待有上限。新增60项检查通过，其中51项隔离浏览器覆盖各固定样式的双向打断、原生及非整数缩放、密集混合到达、长 SC、文本像素稳定和清理，另九项 Node 检查随机过期及飘窗。样式专属实现仍保留独立待审范围，自动像素/几何断言不等于人工视觉、真实 B 站或 OBS/直播姬验收。业务实现、测试断言、现行契约和指南未改。

第七十二批完整检查服务器旧在线弹幕的 feed、随机位置、飘窗与消息渲染分派，局部追踪消费者、效果范围及现行协议，新增确认问题为0。首次显示记录 `expiresAt`，改时长只影响新消息，样式重建和淡出保留原截止时间，因而排除了旧消息被全局时长延长的疑点。数量即时受限、同场重连保留节点、移除只清目标并单次回调，停播释放布局与动画；固定移动沿用服务器已有参数，不要求跟随客户端逐款动效。先 plan 后 verify 的实际执行为21项 Node 加53项隔离浏览器全部通过；计划建议的缓存命中数没有当作执行结果。测试使用新端口和独立数据库目录，进程结束且端口不再监听；合成 SSE、图像路由与几何断言不等于线上或推流应用验收。手动清理测试缓存的命令被工具策略以 `blocked by policy` 拒绝，未改用其他方式删除；一份 Playwright 编译缓存保留在服务器 `tmp/full-audit-2026-10-29/overlay-feed-stage-72/`，不进入业务差异。本批未改变实现、断言、现行契约和指南。

第七十三批完整检查浏览器礼物活动校验与展示分组两个 owner，局部核对当前活动协议和已有测试，新增确认问题为0。整包校验覆盖精确字段、身份/内容摘要、类别与奖池成员、概率表、目录全排列、媒体来源和活动证据；失败不替换已有快照。浏览器展示按完整效果/元数据证据分组，改名改价只在证据充分时形成展示历史，未合并业务身份或奖池，原身份链接仍查看原资料。筛选先于计数、价格分桶和分页，输入目录不被改写；盲盒身份也可由独立来源证据确立，未将尚无关系表误判为缺陷。先 plan 后 verify，三份完整 Node 文件新执行21项通过，一份仍有效的完整目录文件复用，不重复计数。实际模块在 Node 的合成目录夹具中执行，未扩大为真实目录或页面验收。本批只更新审计材料，实现、断言、技术契约和用户指南未改。

第七十四批完整检查礼物目录呈现、详情、页面组合根、URL、历史位置与价格适配六个 owner，新增确认问题为0。列表、详情、代码解析及延迟补充资料均检查导航代次，迟到成功与失败不能覆盖新页面；补充内容只在用户未改变滚动时恢复原位置。历史条目有独立 ID，同一礼物的多次访问不共用位置；原版本链接、兼容目录、筛选计数和分页边界保留，DOM 展示使用文本节点。先 plan 后 verify，三份完整浏览器文件50项通过；使用真实页面及受控目录/API，验证加载、错误、返回、多次访问、搜索次数和无效快照保留，不扩大为真实账号、目录或生产网络验收。本批只更新审计材料，业务代码、断言、契约和指南未改。

第七十五批完整检查共享单选控件及价格菜单适配，局部追踪授权目标表单、提交处理与发码入口，新增确认 F-021。搜索框 Enter 提前退出菜单键盘处理，触发原生隐式 submit；实际管理页的四场景隔离复现区分了默认新主播、先前选中主播和正常选择/取消，生成请求全部拦截拒绝。现有两份完整浏览器文件12项仍通过，缺口是焦点留在搜索框时直接回车，不能由已覆盖的选项 Enter 推定安全。原生值/索引、单次事件、表单重置/验证、动态刷新、禁用、挂载、触摸和浮层位置已有实现及证据，没有因复制来源或文件规模另报抽象问题。客户端只参考了同类分支片段，未直接宣称其产品流程受影响。业务实现、现有断言、技术契约与用户步骤未改。

第七十六批完整检查客户端菜单、主题表单绑定及保存反馈，局部追踪真实页面调用，将客户端实际影响并入 F-021，不另计问题。受控 Electron 保留真实桌面授权、preload 和安全选项，实际字体搜索 Enter 会提交其他未保存主题参数；方向键选择、取消和明确保存提供对照。四场景合成请求全部拦截，未写用户数据，截图已检查，自有进程和端口已结束。现有7项菜单加3项实际 Chromium 表单检查通过。本批只更新审计证据，业务代码、断言、契约和用户步骤未改。

第七十七批完整检查引导控制器、步骤配置和定位，追踪管理页初始化与指南重开入口，新增确认问题为0。首次展示先登记、重开不抹历史，加载成功后才自动打开；切换步骤、关闭和重开使旧布局/完成检查失效，刷新按帧合并，页面级单例监听不会每步累积。真实操作状态判断和静态说明分开，未把可跳过的引导视为登录强制门槛；一处技术参考的阻止语义归入 D-003。23项现有检查通过，未连接真实平台、启动第二个桌面实例或扩大验收范围。代码、测试预期、现行契约和页面指南均未改。

第七十八批完整检查服务器旧在线源的样式选项、效果参数、共享消息/SC 渲染与舰徽 helper，局部复核设置 owner 和页面/feed 调用链，新增确认问题为0。白名单、字体引用、颜色、Unicode 字素、金额阈值和逐样式能力在入口校验，合并映射再验证后一次保存并按租户发布；正文保持字面、数量与结算金额不重复相乘，样式分派、图片回退和表情替换不接管队列。随机/飘窗的 SC 排除有消费者及协议依据，不据低层无分支误报；新本机样式不要求服务器镜像。9项渲染检查新执行通过，参数两份完整文件复用有效记录，旧72批的浏览器播放证据不重计。一个图片 binder 透传线索尚未建立当前事件来源和产品错误，保留待追踪而不列为缺陷。业务源码、测试断言、技术契约和指南未改。

第七十九批追完上批图片 binder 透传线索，新增确认问题为0。当前大航海订单保留 `guard` 币种，普通目录版本仅接受 gold/silver 并精确匹配币种，因此不能给该路径提供旧舰徽图片别名；原图入口也要求明确的已结算版本 ID。现有舰徽和头像框另有 CSS/图片更新路径，未建立产品错误，不能按可选参数未传就修补生产代码。两份完整测试同范围 plan 后复用有效成功记录，实际新增执行为0，不重计。此结论限于已追踪的当前来源，不泛化到未来目录或任意外部数据；业务代码、断言、契约和指南均未改。

第八十批完整检查工作台页面 owner、模型、存储、提醒同步、视图、粉丝日历投影和实际 HTML，复核 Electron 提醒调度/IPC 及装配，新增确认问题为0。迁移只精确移除历史内置项并保留旧键，写失败保留草稿，读失败不覆盖损坏记录，持久化成功后才替换提醒；签名和代次拒绝旧回包，主进程保留已触发状态，切页不取消未来提醒，退出由原 owner 清理。只读粉丝日期不写工作台存储，账号/档案变更立即清空并丢弃迟到结果；日期索引按同份快照共用。44项现有检查通过，包括时区变化、500条索引、原生通知/时钟/IPC 替身，未启动用户应用或验收真实系统通知。当前技术参考与工作台指南符合这些语义，无需因本次审计改写。

第八十一批完整检查 RIPPLOID、仿推特及房主资料 owner，局部追踪消息生产与标准化，新增确认 F-022。身份、购买等级、结算金额和颜色有独立参数，文本用 DOM 字面输出，资料请求按房间/代次取消；没有按装饰代码体积要求拆分。正常 ISO 时间却被仿推特格式化函数转成 Number，六场景真实 DOM 对照确认消息时分丢失；同刻数值输入正常，未改服务器日期合同。五款样式的完整浏览器文件5项通过，真实资源、合成消息/资料及隔离服务器，端口与自有浏览器已结束。其他三款渲染器及各款 CSS 仍需人工检查，不能由这份测试推定完成。业务源码、现有测试断言、技术契约和用户步骤均未改。

第八十二批完整检查客户端游戏管理、游戏页与状态流、绘画控制/几何、动态抽奖授权与呈现，以及两份实际管理片段，新增确认功能问题为0。题词按请求/会话/局次交付，快照期间有界缓冲并按连续版本恢复，画笔按会话/局次串行，自己的 append 回声与服务器选择的 undo 分开处理；抽奖页面不接管后端资格与随机排序，当前规则、修订、请求 ID、结果分页与证据保持对应，授权重置和关闭会取消并丢弃旧回包。五份现有文件36项通过，只有 Node/VM、内存领域服务和假 DOM，不冒称实际桌面验收。1/5/12 局的实际规则与游戏页呈现对照确认固定“五局”文案，合入 D-003，未为增加数量另列根因。测试预期、现行技术契约和步骤未改；未读完的压力/核心测试仍记录精确范围。

第八十三批完整检查服务器透明视频合成、特效卡片、可见缩略图队列与独立特效目录，复核目录清场调用，新增确认问题为0。alpha 阈值、历史可见范围与裁切放大有界；原生预览按尝试序号区别预期暂停/切换的 AbortError，单预览释放旧 src，停止帧回调；缩略图有两并发、事件/超时清理、取消与连接性检查，切页先停任务再移除节点。现有浏览器文件8项通过，真实页面/模块和原生媒体拒绝，合成资源与隔离服务器，不是远端素材完整播放验收。首次普通执行在报告生成前退出；同范围增加子进程退出记录的诊断执行正常，原始原因未查明，未重复全量测试、强制缓存或绕过门禁。端口59168与对应自有进程已结束，保留隔离测试产物。业务源码、断言、契约和指南均未改。

第八十四批补齐独立转盘管理、输出页、SVG 样式与现有草稿测试，新增确认问题为0。保存基线按最新广播更新，同时保留本地草稿；脏状态阻止抽取，失败保留修改，待处理/旋转锁住控件，新读取或广播淘汰旧读取。输出端按服务器选定项和权重计算中心角，使用实际剩余时长及减弱动态偏好，不在呈现层重新随机抽取；文本按字面 SVG 节点输出。两份现有文件6项通过，其中3项 Chromium 管理片段、3项 Node/VM/页面路由；没有真实账户、设置写入或用户桌面实例，不推定转动视觉和全部响应顺序已验收。现行草稿/重连参考及指南符合此流程，未改代码、断言或现行说明。

第八十五批完整检查电音助手入口、全量/快捷控件、反馈及两份 HTML，复核原生桥接、输出锁和主页面装配，新增确认问题为0。偏好只保存在本机，原生来源资格决定速度范围；输入/回送切换保留合法选择及断开占位，参数按编辑版本串行提交，初始化按页面可见性触发。等待输出切换时，关歌曲、关助手或释放页面可取消未发出的启动；停止与恢复提示区分真正错误和原生明确延期，重复状态不延长通知。23项现有检查通过，未操作用户设备、真实音频或桌面弹层；插值模板只含固定应用元数据，不按 innerHTML 关键词误报注入。当前参考和路由/重置指南符合实现，业务源码、测试和现行文档未改。

第八十六批完整检查服务器效果修改、滤镜生成和布局几何，局部复核参数入口及主页面生存期，新增确认问题为0。同一 owner 保存/还原内联值与优先级，重配前断开观察并还原，文本与画面效果分别应用，布局使用同一参数的外扩与变换边界。五组受控 Chromium DOM 检查验证合法参数、八次重配保持一个 SVG/两个滤镜、关闭某类阴影保留无关内阴影、新/移除消息的归属以及清除/重复释放；特意补了带 !important 的新连接节点，未将已移除消息假定为会被复用。两张截图已检查，异常和外部请求均为0，自有浏览器已关闭；这不是整页或全部样式验收。参数合同同范围复用一份有效记录，不重计。代码、断言、契约和指南均未改。

第八十七批完整复核 AI 设置控制器、配置视图和订阅控件，检查主表单、开关独立保存、密钥占位与提交、模型菜单、账号动作及当前夹具，新增确认 F-023。现有50项检查通过，保护了新草稿、真正换服务后旧结果/回调失效等行为；五组附加时序对照确认同一密钥提交后清空输入会误使模型查询和候选失效。指南先等已保存的路径可避开，故按低优先级记录；未把它描述为凭据丢失、越权或实际平台故障。修复须协调现有凭据代次，保留及时清空明文和真实变更隔离；不新增通用状态框架。当前未修改业务、测试或指导步骤，也未实际登录、调用外部模型或验证提供方套餐事实。

第八十八批完整检查组件样式客户端、库、媒体编辑器、实例 inspector、请求适配和资源参数面板，复核配置控制器及隔离原生夹具，新增确认问题为0。普通媒体/CSS 的实例外观与配套资源按样式 ID 共享参数有明确边界；更换不改图层几何，锁定项不能替换。列表按读取代次接收，导入检查目标、关闭取消暂存，媒体预览释放 object URL；控制器返回副本并按字段版本保留新编辑，模糊确认时再读 owner。29项现有检查通过，其中两项由独立数据目录、动态端口、真实 preload/请求授权的隐藏 Electron 宿主执行，验证参数、保存失败重试、页面重开和隐藏祖先暂停轮询；未启动用户正常应用。整份库浏览器测试未因源码检查自动视为执行，相关部分保持待验收。技术参考和组件指南符合这些职责，业务代码、测试断言和现行说明均未改。

第八十九批完整检查礼物卡片、盲盒期望计算及视图，按已接受的期望规范复核身份、币种和数值口径，新增确认问题为0。变体与兼容分组保留各自链接/编号，原文用 DOM 文本输出；概率转整数权重且总和必须完整，共享概率组只计一次，未知或改变身份不展示精确汇总。五盒独立模型只加最高组合奖励，按整组比较严格超值、折合每盒价值，展示时才舍入；切换口径不发请求。两份完整浏览器文件63项通过，参数/数值 Node 文件复用有效记录、不重复计数；实际资源与合成目录不代表真实账户或当前活动价格验收。自有端口56139已关闭，保留隔离缓存，未重试旧清理拒绝或宣称83批的提前退出原因已解决。代码、测试、规范与指南均未改。

第九十批补齐随机点歌纯筛选、字段分隔、单向标签别名和元数据快照，复核歌库、命令分派及组合根调用，新增确认问题为0。加号条件必须落在同一首歌，空格优先保留完整歌手名再按 AND 拆分；随机歌手名保留标点与旧导入分隔合同不同，不能合并为同一规则。存储先排除停用歌曲，再由服务处理冷却；没有候选时保留队列、冷却与最近请求人。元数据只按歌库变更令牌缓存，事务内唯一戳避免回滚后重用未提交快照，并感知其他连接提交；不因返回对象就加入无证据的复制框架。两份现有文件24项通过，包括5000首处理边界和实际临时 SQLite；未发送弹幕或连接用户数据。当前随机点歌指南与实现一致，代码、断言、技术契约和指南未改。

第九十一批补齐动态抽奖链接 owner，追踪创建任务的规范化签名和 provider 的请求边界，新增确认问题为0。只接收受支持 B站 HTTPS 主机与路径，ID 保持字符串；短链至多五次逐跳校验且不带 Cookie，正式 API 固定来源并禁止跳转。请求前后按可信账号和会话代次检查，响应体有流式上限；未把 URL 规范化、合法分享参数移除或视频不同的采集能力当作缺陷。整份 provider 测试13项通过，当前面板明确支持动态、BV 和短链并说明视频能力限制；没有访问 B站、使用真实凭据或修改实现及说明。

第九十二批完整检查公开 WebM、礼物图片、文本图片和上传路由，追踪其静态入口与路径、签名工具，新增确认问题为0。单段 Range/HEAD 有实际 HTTP 验证，源码在响应关闭时销毁读取流；图片使用受限文件名、普通文件和字节签名校验，公开读取与管理/画布能力各有职责。画布慢上传和目录异步读取后复核 attachment，替换或失效不能继续写入；上传素材按现行合同持久保存，不擅加自动删除策略或图片解码框架。两份现有文件7项通过，另用实际隔离服务器验收礼物图片11个请求场景，探针不计入既有测试累计。自有服务器已关，相关 scratch 目录归零；这不是浏览器实际视频播放或整页桌面验收，源码、测试及指南未改。

第九十三批完整复核浏览器源 URL codec 和共享配置校验，追踪场景保存、发布、替换输出、读取及显示文档转移的调用，新增确认问题为0。密文绑定 owner/scene/item，写入前验证往返和加密后总大小；发布到持久输出时重新绑定，编码失败保留既有草稿与发布。输出先核对权限，版本未变不重复解密；HTTP/HTTPS 第三方能力地址与导入本地 HTML 分属既有合同，不能因含 query/hash 或允许本机地址就臆测后端任意代理。现有8项内存 SQLite/AES-GCM 检查通过；不代表真实系统凭据保护、第三方页面嵌入或直播软件兼容性验收。相关存储参考和场景操作片段无须随只读审计改写。

第九十四批补齐启动保留期维护 owner，核对领域端口、存储当批返回与启动/停止调用，新增确认问题为0。维护读取当前开关和策略，积压礼物每25ms续批让出事件循环；小时定时和续批均不阻止退出，停止幂等且排队回调不能再访问存储。已有失败隔离和后续重试，不需要另加任务框架或全局重试抽象。整份119行测试的5项通过，时钟及维护端口受控，没有连接或删除用户数据。现行存储参考已说明周期、禁用、续批与停机边界，业务、断言、契约及用户步骤保持不变。

第九十五批完整检查服务器小游戏目录呈现、共享 manifest 校验与后端目录 owner，复核对应测试和隔离配置，新增确认问题为0。启动清单完整验证后提供精确只读条目；卡片使用文本节点，按安全 slug 构造同级玩法 Host，盲盒短标签为明确例外并保留本地端口。预览独立等待解码，失败不遮挡标题和入口，按现行合同复用内容地址图片缓存，不凭旧方案要求改写当前 no-store 清单请求。普通同范围 plan 后 verify 实际执行两份 Node 共33项、浏览器5项，全部通过；计划里的复用不冒充实际复用，也不使用强制开关。端口50168已关，仅保留隔离转换缓存；这一成功不证明83批的提前退出原因已解决，且没有运行生产或真实账号。

第九十六批完整检查到期标记、点歌汇总、平台陪伴/名单共享工具与歌曲汇总迁移，核对存储和 IPC 调用，新增确认问题为0。到期标记核对当前房间/房主、身份等级及新鲜度，不从旧名单推算或写入档案；陪伴天数与购买时长独立，名单完整性、去重和隐藏身份按原合同处理。每页请求的取消由外层闭包传入，不能因共享函数没有再传一遍 signal 而误报。歌曲总次数、三个日期、近30天分类及说明各有口径，未来日桶在时钟回退期间保留但不展示；迁移沿用 runner 事务。四份现有文件25项通过，包括实际临时 SQLite 的失败回滚、重启和备份；没有访问真实 B站或用户数据库。相关规格和存储参考已经描述这些行为，代码、断言与用户步骤未改。

第九十七批完整检查 WeSing 播放时钟、QRC watcher、兼容门面与诊断 owner，追踪引擎接线及停止路径，新增确认问题为0。监听检查和事件各有代次；歌词采用两秒防抖、歌曲日志使用不被连续写入推迟的短延时，停止取消旧回调。诊断复用现有监视器，限制采样并只投影允许字段，结束后按需排他导出。29项现有检查通过。[Node 的 fs.watch 说明](https://nodejs.org/docs/latest-v24.x/api/fs.html#caveats) 提醒平台差异及 Windows 删除目录的错误可能性，但自有目录上 Node24.21 与 Electron 内置 Node24.22 各五场景均未见未捕获异常，普通变化对照正常；最初探针预设退出1的断言被实际退出0推翻，原日志保留，不列为业务缺陷。删除观察窗口400ms、普通变化2500ms；这些附加观察不重计，也不证明所有原生错误或完整 Electron 界面均已验收。临时进程和目录已清理，未使用真实缓存、音频设备或用户应用。

第九十八批补齐网易云客户端只读曲目匹配与共享 QRC 实体解码，复核监视器补全和两种歌词包裹提取调用，新增确认问题为0。最新历史行只作身份佐证，歌名、歌手及时长不匹配时拒绝，不能把另一首历史曲目覆盖当前引擎 ID；旧文件只在数据库不可用时回退，读取不接触凭据。实体解码由共享函数维护，QQ 与 WeSing 保留不同的外层提取合同；测试中的替换顺序是现有兼容行为，未把 RSS 的已确认问题直接复制为另一个缺陷或要求通用 XML 重写。两份现有文件5项通过，包括实际只读 SQLite、禁止写入与文件字节不变；普通实体及已声明顺序通过不等于任意非法 XML 或真实客户端兼容性验收。技术参考与操作入口无需随只读审计改写。

第九十九批完整检查六库连接门面、抽奖迁移/DDL与历史清理 owner，追踪关闭和事务调用，新增确认问题为0。部分打开失败会尝试关闭已持有的全部句柄，关闭错误不覆盖原初始化错误；可选抽奖库失败保持原五库可用。抽奖旧数据按已接受的最新活动规则清理，暂停进度及独立预算保留，最小创建回执阻止旧请求重新开奖；新建和清理同事务，失败保留原树。两份现有文件23项通过，包括实际 SQLite 的 PRAGMA 故障、重开、外键和回执失败回滚。当前参考已明确这些职责和回执增长边界，未扩展历史留存政策或改写旧迁移。

第一百批完整复核歌曲待同步 store 与控制器，追踪歌库保存和两类清空事务，新增确认问题为0。待同步完整快照与歌库变更共同提交，账号键和独立 mutationId 共同限定确认删除；旧确认不会清除新编辑，空库保持明确清空意图。恢复比较内容后才替换歌库，保留未变化库的队列关联；读取云端前后复核归属与当前待同步状态，漏通知也不能被迟到拉取覆盖。两份现有文件29项通过，实际临时 SQLite、控制器重启及合成云端覆盖失败、换账号和旧结果组合。私有待同步行不进入普通设置输出，当前存储参考与实现一致，无须新增同步层或修改用户操作。

第一百零一批完整检查用户冷却与 AI 用量 store 及调用层，新增确认问题为0。Map 头部清理由领域 owner 的删除再插入维持时间顺序；恢复排除未来时间，内存重置与删除持久记录分开，落盘失败保留本次已接受的内存时间并警告。API 配额的正上限来自固定领域类别，低层初次插入的零上限假设不可达；原子 SQL、北京时间月份、上月及未来计数保留与预留/提交各有职责。三份现有文件12项通过，跨月后的失败请求仍计数符合现行保守预算合同。用户冷却、单曲冷却与外部 API 预算未因外观相似而合并，未访问真实数据或第三方服务。

第一百零二批补齐共享远程 URL 语法规则，追踪授权客户端与礼物图片的不同约束，新增确认问题为0。URL 解析后的 IP、localhost、标签、HTTPS 根路径与凭据等检查服务于可配置根地址；图片调用方另核对媒体路径与同源，认证客户端使用固定端点和取消边界。该 helper 不宣称完成 DNS 解析后公网判断或替代调用层授权，未据此追加无既有要求的网络限制或通用策略框架。两份现有文件21项通过，使用合成请求和自有临时目录，覆盖异常根地址、来源恢复和固定请求边界。API 参考已说明 HTTPS/DNS/root 配置要求，源码、断言和用户步骤未改。

第一百零三批完整复核服务器共享帮助组件、样式及旧路径转发模块，检查原生 popover 的输入和生命周期，新增确认问题为0。button 类型避免表单提交，连接保护避免重复本地监听；打开时建立位置监听，关闭或卸载时通过 AbortController 释放，浮层有视口尺寸和滚动边界。现有礼物详情构造文本说明并提供中英文标签，旧入口只转发共享模块。按相同范围 plan 后普通 verify 再次执行完整浏览器文件43项，全部通过，相关章节验证触屏/鼠标/键盘、Escape与焦点、卸载返回、零额外请求和页面错误为空；其余947行测试源仍未全部人工审阅。端口49819已关，仅保留隔离转换缓存；这不是其他浏览器引擎、当前上游价格或真实账户验收，也不证明83批的提前退出原因已解决。

第一百零四批完整检查时钟参数合同、读取路由、场景扩展配置与显示 owner，核对类型注册和现有用例，新增确认问题为0。旧外观字段按当前样式合入独立档案，场景字段遵守声明的类型、范围和步长；配置与业务状态保持分工。歌曲与歌词条件快照分别按 owner/代次/版本更新，播放时钟持续投影；礼物慢读按来源和日期共享，发布缓存前重新核对归属，旧结果不能替换新缓存。两份现有文件32项通过，部分测试源码仅选段复核，不能据此声称全部574/401行已人工审完。没有修改时钟样式、用户设置或场景协议。

第一百零五批完整检查世界时钟温度服务与路由，新增确认问题为0。固定来源请求有超时、重定向与字节上限，验证目标坐标、摄氏单位、页面时间和位置回退；缺少描述时保留有效温度，不推断晴天。同坐标共享请求，缓存对齐整点，容量满且没有可回收项时拒绝新增请求，关闭取消并等待在途工作。两份现有文件19项通过，包括管理权限、整点跨越、失败退避、容量、前端城市变化与销毁后的迟到响应。合成页面和时钟验证不等于真实 MSN 页面当前可用或天气准确性验收；相关接口参考与现有实现一致。

第一百零六批完整检查服务器颜色增强器与选择器，新增确认问题为0。原生 RGB 字段保留值、验证和业务事件所有权，透明度仍由独立设置负责；内部输入事件不冒充业务字段事件，提交只通知一次。禁用、导航、移除、重置与克隆沿用当前关闭/同步逻辑，取色结果检查当前字段归属。相同范围 plan 后普通 verify 执行完整浏览器文件11项，全部通过；覆盖实际页面保存和草稿行为、键盘与触屏、拖动及模拟取色。测试源码250行仍仅作选段复核，未实际采样屏幕或改动生产外观，源码、断言和使用说明未改。

第一百零七批完整检查自动名单依据共享存储和 v14 迁移，核对写入、展开与删除调用，新增确认问题为0。共享条件限制为从未修订、仍采用的纯自动观察；时间、ID、sourceKey 保留逐条记录，模板摘要含账号范围。编辑在保存点中展开原始依据，按账号删除最后引用后回收；读取缺依据时明确失败。完整人工复核215行现有用例并执行7项通过，验证重复升级、历史结果、备份恢复、跨账号及迁移失败的原子回滚；其他调用文件仍仅记录所读区段，未将本批扩大为所有档案行为验收。

第一百零八批完整检查礼物维护、统计交付和共享投影重置三个存储 owner，新增确认问题为0。明确批量删除与分批保留期的事务差异，SQL 参数有界，生产调用中的条件是固定内部表达式；保留期只清本地来源并保留已完成结算审计。来源清空和重建在各自事务内复用元数据重置，但各自保持删除范围与代次失效规则。四份现有测试文件31项通过，覆盖4万行晚期失败、批内失败、清空/重建中途失败及交付资格和重试；测试源仍为选段复核，不以执行完整文件冒称逐行审完。没有连接真实账号或修改任何数据格式。

第一百零九批完整检查随机点歌有限历史与回复对象查询 owner，新增确认功能问题为0，另将旧表名说明合入 D-003。最近十条与额外一条有身份记录分别承担避重和回复目标职责；请求 ID 自增，入队、历史和冷却写入处于同一事务，迁移保留活动队列并幂等收敛旧流水。两份现有文件51项通过，包括清空/重启、匿名请求不挤掉有效目标、迁移回滚和失败筛选保持旧目标。调用与测试仍按所读区段登记，未连接弹幕、启动桌面或新增历史保留需求；本批只更新审计报告与证据。

第一百一十批完整检查手账、幽灵便笺、花与信笺三款服务器旧在线源的拼装与样式，新增确认问题为0。模块复用共享安全文本/表情，负责身份、头像、纸面与装饰，不接管 feed 队列或定时器；三款 CSS 保持主题/字号/透明度及减少动效的职责。相同范围 plan 后普通 verify 复验完整新增样式文件5项通过，包含另两款既有样式对照；源码与测试源已完整读到，调用总入口仍仅按所读区段登记。花与信笺直接解析 ISO 时间，不重复报告 F-022；没有据另一款样式的专属设计给幽灵便笺增加未定义的文案要求。测试端口61530已关闭，仅保留隔离缓存，未连接真实直播软件。

第一百一十一批完整检查首页控制器、共享语言、录屏可见性和首屏主题恢复，新增确认 F-024。存储白名单与失败回退、Cookie 动画归属及焦点、录屏的离屏/静态偏好/失败降级保持现有分工；语言返回路径缺少首页翻译消费者的同步。两份现有浏览器文件20项通过，另在同一自有测试服务器的独立上下文完成双向原生历史复现和前进/刷新对照，避免把绿色用例当作未覆盖组合的反证。导航测试285行完整审阅，首页 HTML、偏好测试与辅助函数仍只登记已读区段，吉祥物脚本未因截图自动算作审完。测试进程已结束、端口57354已关闭，自有诊断浏览器与上下文均已释放；本批没有业务实现、测试预期或现行指南变更。

第一百一十二批完整检查服务器礼物说明、图片、活动角色和权益卡四个辅助模块，新增确认问题为0。中性展示名不替代原始活动身份，角色只用于目录说明，不参与收礼结算；异步角色补全受导航代次限制。图片调用点创建新的容器，不能据假设的复用容器把旧图片错误回调升级为可达缺陷。三份现有 Node 文件9项通过，明确区分 DOM 替身、纯查询与静态断言；权益卡英文价值、编号与概率标签引用103批已通过且摘要未变的浏览器章节，没有重复执行或累加43项。没有访问真实 CDN、修改来源允许规则或业务资料。

第一百一十三批完整检查客户端完整礼物身份、迁移与前端选择键，新增确认问题为0。名称、原价、币种与背包标记参与冻结身份，规则按规范化身份匹配；迁移保留旧规则字段，旧事件不猜身份，原规则等待重选。现有两份文件13项通过，另对真实基线 DDL 和三个旧规则模式运行内存诊断：字段保留、重复执行以及复制后提交前注入失败的结构/数据/版本回滚均符合预期。该诊断不代替完整生产升级或跨端 fixture；依赖既有 pin 的目录测试未重跑、绕过或算作通过。调用与测试只按已读区段登记，未改用户数据库或现行格式。

第一百一十四批完整检查每日机器人、固定回复和屏蔽规则三个共享参数合同，新增确认问题为0。各自保留请求白名单、响应裁剪和领域限制，不把不同职责合成通用验证器；固定回复编辑器的四个字段与自动菜单投影保持分工。条件词库按摘要确认并克隆，页面提交前去除首尾空白，不能据原始 IPC 假设报告正常编辑路径的摘要错配。三份现有文件16项通过，验证主 frame、固定 Device 地址、私有字段剔除、换账号与摘要错误等边界；其中屏蔽 IPC115行完整人工审阅，其余测试仍为选段。现有跨端字节一致性门禁限制保持，业务代码、测试预期、技术契约和操作指南均未修改。

第一百一十五批完整检查本地弹幕外观、存储、布局、画布预设、类型与来源清单，新增确认问题为0。外观绑定实际由 Electron 组合入口传入授权 generation，区别于传输 epoch，普通续期不使草稿过期；一次迁入、失败不写默认及本地行不受远端覆盖保持一致。四份现有文件24项通过，实际隔离 HTTP 验证保存外观只更新共享参数，不重发场景几何、改变事件游标或重放已消费事件。只读来源核验还确认两端指定 core 文件与清单摘要一致；没有写入镜像，也不据单个文件推翻既有全仓 pin 限制。三份参数/类型测试全文审阅，运行时测试与组合入口仍按区段记录，未验收真实桌面会话。

第一百一十六批完整检查粉丝档案、场景与礼物展示三份迁移 owner，新增确认问题为0。增量结构与历史资料分工明确，迁移执行次数由版本 runner 管理；场景发布、凭据、默认尺寸与可空活动预设继续保存各自语义。251行现有存储测试全文复核，10项通过，实际从旧版结构升级并核对重启、原行/凭据、独立连接与注入失败回滚。名单模板与可选展示字段另引用107/108批未变源码的既有证据，不重复执行或累加，也不冒称验证所有生产旧库。没有改变表结构、历史数据或契约。

第一百一十七批完整检查场景礼物窗口与旧视频入口，新增确认问题为0。窗口复用上游已判定资格与带样式后缀的事件 ID，负责投影、去重、账号清空和200条容量，不重复结算。兼容视频入口从已安装受信预设定位不可变资源，暂存不能冒充安装，移除可选库仍保留旧图层引用。两份现有文件5项通过，全文审阅测试中的准备/消费边界及真实 HTTP 的307、HEAD、Range和405；仅核对字节/哈希与入口行为，未扩展为解码或实际直播软件验证。所有自有测试运行结束，业务源码、现有测试、技术参考和用户指南未改。

第一百一十八批全文检查运行时配置、兼容入口、管理页启动、加班导出、菜单投影、取消延迟、点歌参数与两个路由，共九个此前未人工登记的后端文件，新增确认 F-025。宿主仍限 loopback，参数白名单与领域校验保留 owner 分工，取消回调使用当前代次和计时器身份；不对不存在的热切换或无界输入新增要求。六份现有文件40项通过，其中动态抽奖292行测试全文审阅，覆盖租户、修订、幂等、授权变化与公开错误裁剪。原生 Windows 子进程另外确认显式开启自动打开时的异步 ENOENT 未进入降级分支；关闭对照通过，没有打开真实浏览器或改变系统环境。其余调用者与设置测试仍按实际选段记录，源码修复尚未实施。

第一百一十九批全文检查绘画游戏词库与盲盒默认 JSON，新增确认问题为0。现行规范要求九类各100词，生产消费者复制答案与别名后使用；不据浅冻结猜测正常路径可改写原词库，也不把默认资料中的价格视作平台实时事实。两份现有文件30项通过，另有900条摘要观察但不重复计数；测试源码和设置消费者只复核相关区段。客户端后端清单现已全部至少触及，但此前多个文件仍为选段，这不表示全后端逐行或全角度审计完成。

第一百二十批全文检查服务器歌单页头与共享控制台导航，新增确认问题为0。资料请求独立于歌曲加载，头像/外链按现有限制投影，标题以 textContent 交付；导航维护响应式阈值、工作区标签、焦点与浏览器历史，不把页面生命周期监听假定为泄漏。两份浏览器测试源码全文审阅，35项实际通过，覆盖慢资料、异常头像、五工作区、草稿、返回/前进及既有尺寸。测试使用 API 替身，外部链接由夹具拦截；不代表真实账号、Admin授权或完整 Electron，亦未修复 F-024。自有测试进程结束且65364端口已释放，保留所属转换缓存，没有手动清理旧受限目录。业务代码、现有测试断言、技术参考及用户指南均未改。

第一百二十一批检查服务器固定汉字表与客户端原生依赖锁，新增确认产品问题为0。剩余后端/原生条目是打包数据和锁文件，消费边界明确；字表3,500字及唯一性符合本地规则，三项现有检查通过，不因此保证任意昵称读音。固定在线来源本批读取失败，按来源比对未完成记录，不把网络错误算应用故障。原生锁文件与项目依赖版本、目标和现有 locked restore 后 no-restore publish 入口一致；没有恢复包、构建资源或运行实际音频。原生验证脚本只复核入口区段，不能把清单全部触及说成所有原生路径完成。

第一百二十二批全文检查首页吉祥物1,053行脚本及535行所属样式，新增确认产品问题为0。场景保持单次初始化、有限水环/泡泡和礼物、帧间隔与像素比上限，离屏/隐藏/减少动效控制与指针监听成对；样式外的全局减少动效规则也已核对，不因单个文件缺少重复规则误报。579行现有动效测试全文审阅，20项实际通过，包含静态像素、指针/点击、五个既有尺寸、普通滚动与七段本地录屏解码/懒加载。390px静态与1440px点击截图已检查；并未据此验证真实平台账号、全部CSS/HTML或Electron，F-024仍未修复。

第一百二十三批全文检查六款旧在线源样式、徽章表和画布八份JS，以及画布、通用动效、雪狐与CSS导入入口，新增确认产品问题为0，新增测试时序建议D-006。角色投影、礼物资格和金额事实由已有owner交付，主题只安全组合DOM与装饰；不把职责不同的样式强行合并。两份现有Node文件结果有效复用、不重计；七份浏览器文件64项中61通过、3失败。失败后没有重跑整组，而用原trace、截图和自有只读上下文分别观察过渡起点、0.01ms间距过渡及不带人数更新的正常越界清理。原批次仍记录失败，未以隔离观察冒称修复或并发通过；其他浏览器测试源码仍是选段，其他主题CSS尚待全文审阅。自有端口、四个诊断上下文与浏览器均结束，保留所属缓存，业务代码、测试断言、技术参考和用户指南未改。

第一百二十四批补齐客户端原生验证脚本76行全文，新增确认问题为0。既有工程参考明确要求先构建原生资源，脚本沿用locked restore、no-restore publish及桥接初始化、推送、刷新、非法启动恢复、重启持久化和异常设置规范化检查，不把已有前置条件误报成缺陷。这里只审阅脚本与调用前提，没有恢复包、编译资源或运行真实设备，未增加现有测试执行数。

第一百二十五批全文检查加班机礼物选择器、状态视图、规则编辑器、组合根、预览、所属HTML/CSS及选择器测试/夹具，新增确认F-026。生产快照和事件入口仍按相关选段追踪；较新状态会重建干净规则列表，而打开的选择器保存旧DOM节点。7项现有选择器检查通过，但替换了真实状态/编辑模块；另用隔离真实Electron完成无更新、干净更新与已有草稿三类对照，确认提示成功后可见规则及实际保存请求仍为旧礼物。诊断API和事件均为合成输入，所有保存请求被拦截，没有写真实后端；匿名管理页仍为401，原有隔离和授权保留。自有Electron关闭、60879端口释放，额外诊断不计入7项。固定服务器版本合同仅全文静态审阅，既有基线不匹配未绕过；源码修复和相应集成回归尚未实施。

第一百二十六批全文检查组件预览选择器435行、开播样式选择器78行和资源设置owner，新增确认问题为0。文本副本在确认时解析当前条目并复制配置，已移除来源明确失败；样式草稿按会话保留，资源配置从当前API读取，监听与观察器随所属界面关闭。画布与开播组合根仍按实际选段登记，不把调用者触及说成全文完成。两份现有测试源码及夹具全文审阅，实际3项通过，其中2项使用隔离Electron，涵盖文本框、样式草稿、导入保存失败/重试及画布媒体设置。所有自有进程结束；这些检查不替代设备、平台账号或完整生产启动验收，F-026及D-006原失败均未修复。本批只更新审计材料，现有测试断言、技术契约和用户操作说明未改。

第一百二十七批补齐开播设置435行、画布预览493行、预览连接228行及开播数据适配7行全文，新增确认问题为0。保存串行交付当前待提交字段，失败归还未提交内容；同步回包应用前检查草稿和在途保存。画布区分共享外观、独立图层、已发布输出与预览，关闭时释放观察器、快捷键、订阅和所属连接。两份现有测试及相关VM夹具全文审阅，18项实际通过，包括17项受控VM和1项Chromium集成；验证预览复用、正式输出总开关、独立样式层及子页不请求API。这里的桌面桥是已有浏览器夹具，未重复计入前批真实Electron检查，也不保证硬件或完整生产启动。测试进程结束，业务实现、断言、技术契约及用户指引未改。

第一百二十八批核对服务器对白、青雾、绿萌简笔画、流霞和月渡花汀五份CSS，新增确认问题为0。布局声明全文审阅；绿萌的9个长内联SVG另外解码并解析XML，检查标签、内部引用及脚本/事件/外部引用，未逐条人工评审美术路径或渲染像素。22处本地URL映射13个现有素材，均位于真实静态根目录内。流霞金额下半部裁切符合现行明确设计；月渡花汀自定义字体和普通正文颜色由共享高优先级规则交付，不因主题文件没有重复声明误报。共享参数与基础CSS、浏览器测试仍仅按所读选段登记。没有新增浏览器执行或改动样式，D-006原三处失败仍未修复、未复验；源码及规范未改。

第一百二十九批全文检查版本化素材owner47行与测试67行，局部核对应用挂载，新增确认问题为0。素材在启动时形成私有字节快照，嵌套内容参与修订摘要，CSS/JS引用统一改写；版本地址不可变缓存，旧版本、HTML和缺失条目返回不可缓存404，兼容静态入口继续no-cache。相同完整文件先plan后verify，实际为有效复用1份、执行0份，旧成功记录不加入新增计数；没有为追求新结果强制重跑。测试源码使用合成文件和自有loopback服务，当前复用未创建测试服务。静态路径证据不代表远端来源真实性、推流应用或实际播放验收；只更新审计记录，现行测试、契约和指南无需因只读审计而改写。

第一百三十批衔接中断的画布编辑链，全文审阅图层拖拽、画布设置、链接解析、页面入口、组件定义、参数克隆和来源地址七份模块，新增确认问题为0。拖拽先恢复原DOM后只提交一次，栏外/Esc/失焦可取消；初始参数由立即订阅回填，重试按状态退避并响应关闭取消，恢复缓存不保存预览凭据。四项既有定向Chromium用例通过；父视图/模型与大型测试仍按实际选段记录，未冒称完整Electron验收。

第一百三十一批由子代理全文检查八个客户端外观模块与十三个支持文件，确认F-027；主代理复核源码和隔离复现。主题应用、过滤列表和普通草稿保护已有owner/generation屏障，但读取回调内的绑定赋值早于控制器拒绝旧配置，形成独立遗漏。29项既有VM检查通过，不能排除未覆盖的同账号重登组合。参数取整和关系约束已追到领域标准化，不把UI表面最小值差异直接记作新缺陷。

第一百三十二批由子代理全文检查服务器登录/重置HTML、登录及管理正文样式、直接认证JS和两份浏览器测试。20项实际通过，表单先绑定再启用，原始密码不trim，失败保留输入、成功清空并跳固定允许路径；管理Host边界保留。管理正文样式仅静态对照实际DOM，不能据登录页通过宣称工作台全页视觉完成。自有3217端口和浏览器已释放，新增确认问题为0。

第一百三十三批由子代理全文审阅十一份维护构建/配置文件及字体来源、配置owner和三份完整性测试。固定来源摘要、字形覆盖、冻结媒体预算与明确的新字体版本发布前提已核对，未将受信任维护输入假定为公开上传，也未运行生成资源或联网脚本。字体检查实际5项通过、2个完整文件有效复用；生成数据、真实字体视觉和所有平台构建仍未验收，新增确认问题为0。

第一百三十四批复核恢复时变化的排版测试，并由子代理诊断青雾字号。原完整文件1通过/1失败保留；之后发生外部源码与测试修改，当前六组专项测量成功不能替代原文件复验或解释旧失败。已将三项变化输入排除在原摘要登记之外，仅登记十一份未变支持文件的实际全文/局部范围；本批不新列产品缺陷，按D-007保留边界。

第一百三十五批由子代理全文审阅歌词表单、颜色控件及七份支持文件，确认F-028；主代理复核实际服务广播顺序与合成复现。来源选择控件的代次、样式草稿和串行自动保存保护均存在，但WeSing偏好先于保护无条件回填，排队保存继而提交旧选择。12项既有VM检查通过；该模块实际管理直播歌词设置及浏览器源预览，未据旧命名推定独立原生窗口问题。

第一百三十六批由子代理补齐礼物页九份HTML/CSS全文，核对直接DOM构造、隐藏优先级、详情/目录与视频错误状态、响应式指标和素材导入。主文件摘要及八个导入目标有效，没有具体运行疑点而不重复浏览器；搜索焦点要求与实现/断言的措辞差异归入D-003，未另计产品缺陷。此批只有静态证据，不代替视觉或播放验收。

本次续接在当前聊天建立持续goal，并按用户授权使用三名子代理，中央报告/覆盖只由主代理登记。提示词增加按证据调整子任务、跨聊天恢复及并行证据合并规则；旧清单、失败与检查点保留。goal尚未满足全量人工审阅条件，继续优先未覆盖模块，并对变化摘要单独安排复核；不按每批问题配额或固定提示词机械重复审查。

第一百四十批由子代理全文审阅六个礼物交互/外观模块与十三个支持文件，新增确认F-029，主代理复核源码和真实设置服务的合成复现。其他草稿、会话取消、守护预览和共享数据轮询已有归属/代次/清理屏障，不把显式用户预览误当重复后台请求。20项既有检查通过，未覆盖的恢复默认保存缺口另立证据；业务实现未改。

第一百四十一批补齐游戏目录HTML、JSON与四份CSS全文，并全文追踪目录JS/manifest、模板、Host owner、公共语言和既有测试。25项Node检查实际通过、一个完整文件有效复用；只核对静态页面/资源发布和可信目录生产链，未运行浏览器或具体玩法。英文入口的中文玩法提示差异归入D-003，不以代码/测试一致替代现行要求。

第一百四十二批全文检查三个礼物性能基准、三个夹具/隔离/冻结查询helper和清理故障测试。数据路径在导入存储前隔离，统计字段和同步/worker/SSE测量范围已与当前文档核对，合成UID与NULL来源房间由夹具/兼容规则明确处理。未执行基准或测试，不报告性能达标、真实清理或生产环境可比性；新增确认问题为0。

第一百四十三批全文检查手动云同步owner、旧导入门面和238行UI测试，局部核对IPC与同步队列。确认发送授权代次而非筛选行，主进程在队列执行时取完整最新歌库并前后校验归属；对话框中的数量是说明，不承诺冻结确认前的内容。9项UI检查通过，取消无上传、计数异常及错误索引保留均有断言；本机手动记录不代表自动同步或租户授权。新增确认问题为0。

第一百四十四批全文检查通用表单、时钟卡片及参数预览、帮助组件与样式、模块入口和旧桥。4项定向VM、2项帮助检查及1个共享控件Chromium场景通过，覆盖输入保留、dock/弹窗焦点、原生按钮空格行为、时钟单帧更新和显式保存。预览实际由未升级的template内容构造，未为默认factory参数推定可达的克隆缺陷；大型测试只读区段保留准确边界。新增确认问题为0，正常浏览器夹具不当真实Electron证明。

第一百四十六批对外部改变的四项当前排版文件完成全文复核，三次保存的20项依赖摘要一致；17项参数和2项浏览器检查全部通过。前端与Node参数由既有生成合同保持一致，正文/表情大小、主题设计尺寸及整个画布缩放的职责与当前帮助/参考一致。当前通过单独关联新摘要，旧失败不改写、其他16项不因执行过测试自动算人工审完，详见D-007。

第一百四十七批全文审阅粉丝表单、自动提示与五个支持文件，局部追踪领域校验和主进程通知消费。日期按北京时间与独立精度处理，未知计数不当零，失败保留表单，普通轮询在editor打开时暂停；主进程核对context后单次消费通知，前端丢弃销毁后的结果。28项现有检查通过，未重述恢复/屏蔽格式或迟到冲突的既有根因，新增确认问题为0。

第一百四十八批全文审阅活动记录、同行航线及星座回响三份CSS，并对照实际记录/主题DOM与反馈取消owner。样式优先级、复用同一按钮、航线锚点、100ms/300ms入场和隐藏/重置/减少动态清理路径有源码依据。三份摘要及六个资源目标有效；没有具体运行疑点而不重复浏览器，未据静态选择器证明视觉、几何、素材来源或真实玩法完成，新增确认问题为0。

第一百五十批全文核对七个设置模块和十份支持文件，新增确认F-030。主房间/点歌表单分开提交，点歌已有提交值确认保护；监控开关、账号资料、协议加载与确认操作沿用当前owner和失败反馈。40项既有检查通过，盲盒迟到成功清除新草稿的缺口另由真实表单与设置服务复现；真实清空/关闭/重启和账号操作为0。

第一百五十一批补齐11份外部变更CSS当前声明全文，3,274物理行；正文/表情参数、固定设计尺寸、原生比例与实际DOM/画布缩放逐项对照。sketch九份长SVG保存原字节并解码核对结构，未逐坐标或视觉评审。146批19项测试的20输入摘要一致，仅复用而不重计；未新增缺陷或运行浏览器。

第一百五十二批全文审阅六份服务器捕获/维护脚本、三份直接测试及两个支持owner。固定test1目标、只读库/路径与凭据快照、运行内HMAC/限量输出和白名单原子清单均有对应实现。三测试文件29项实际通过，未连接真实Bilibili、读取私有库或执行create-admin/sync/capture。通过合成结果不认证线上ACL、磁盘故障或上游资料完整性。

第一百五十三批补齐feed、spooky、主入口、帮助片段和完整播放测试当前修订，运动合同98行也全文核对。长内容同时缩放设计基准与正文，版式/打断/移除由shared feed拥有，主题保留入口与运动设计；没有新增确认缺陷。完整motion文件52项实际播放检查通过，20项输入运行前后稳定；不是Electron保存、真实直播或人工审美验收。

第一百五十五批全文审阅metrics、直播状态投影与状态renderer及五个支持文件。changedKeys路由与初始化订阅没有新增重复请求；断连优先、真实0与未知值、单次手动采样及轮询释放均保留当前语义。16项实际通过，4项按名称筛选不等于完整toolbox文件；真实硬件和桌面视觉未验收。

第一百五十六批全文检查服务器454行显式跨仓歌曲往返脚本、环境/preload/测试和三个客户端路径/兼容模块。临时根在导入前配置，客户端factory使用dataDir与端口0，清理等待子进程结束；小样本与TLS替身边界明确。实际执行0项，不启动脚本、应用或浏览器；未把开发Node/controller链路写成真实Electron或完整容量验收。

第一百五十七批沿正常场景与独立弹幕源核对23份完整文件、6份局部文件及当前合同，新增确认F-031。当前无凭据子页边界正确，缺的是匹配本地资料的安全交付；主代理复验同一真实HTTP/Chromium诊断。2项既有单测通过仅证明注入loader，独立临时诊断另计，不扩大为弹幕或权限失效。

第一百五十九批全文审阅588行加班UI主模块及所列支持范围，新增确认F-032：后端合法1000小时在实际editor/model与time-view不能往返，999小时对照通过。3项既有定向检查不覆盖此边界。文字展板Unicode/UTF-16长度单位差异另记D-008，程序化回填不等于原生输入验收；没有启动服务、数据库或真实计时。

第一百六十批对六份权属清单全部259条及顶层/共用/衍生声明做结构化语义审阅，重复文案按完整字典索引展示、摘要由自动比对核验，不声称原始逐行或美术几何全文。路径、现有字节和准入清单一致，14项既有本地文件检查通过；没有认证第三方权利或实时远端媒体。9,123行盲盒原始数据仅人工读1–75，30池的完整自动解析与紧凑语义投影不替代未显示字段的人工审阅。辅助媒体账本促成5份版本化输入补充队列；提示词规则10据此调整，旧基线和分母保留。新增确认问题为0。

第一百六十一批全文审阅开播画布设置、API适配、分组、共享外观与轮询小模块，核对实际canvas权限路由和调用者。共享样式设置与场景草稿分工、两种人物图、忙状态和取消已有实现；分组不在每次刷新重建。8项现有HTTP/VM检查通过，无新增确认缺陷；既有浏览器与Electron用例仅作源码核对，不冒称本批新验收。

第一百六十二批全文检查富文本色板/工具栏、文本框editor、纯格式校验和665行现有浏览器文件，许愿调用者只按选段登记。选区、素材、保存与渲染owner没有新重复实现，最近六色仅是UI偏好。17项真实隔离Chromium检查通过，包括透明颜色、字体、原生撤销、快速格式切换、像素和销毁重挂，无新增确认缺陷。

第一百六十五批全文审阅六个点歌设置模块和十三份支持文件，背景控制锁/取消、展示板串行自动保存、屏蔽草稿与冷却字段有直接owner/合同反证，18项现有检查通过。新增确认F-033/F-034分别为本地回拨重复时刻的原瞬间丢失、按钮删除未通知保存反馈；主代理阅读完整诊断及真实HTML，并独立执行纽约/上海和form/策略对照。没有真实保存用户规则或更改系统时区。

第一百六十六批补齐12条显式特效绑定的原始全文，以及关系文件273身份、37关系、247产物引用、6奖励和29 reviewed标记的完整结构化语义。完整身份逐条用当前纯函数重算，包裹/金币差异和12条raw-zero明确例外保留；没有以同名或数字ID冒充身份。7项现有检查实际通过，概率文件有效复用；外部历史来源和许可未认证。

第一百六十七批全文审阅成名之路8份CSS共1339物理行及真实view/dialog/arc支持，按最终导入次序判断比例和状态；pointer-events:none的装饰层不覆盖显式auto的实际按钮。有限800ms圆弧由JS持有取消、当前偏移续接和hidden/reduced完成，预览不重建。静态引用8项有效，无新增缺陷或测试执行，不代替六视口/视觉验收。

第一百六十八批全文检查四个客户端入口/工厂及直接markup/CSS/订阅支持。PK试算遵循本地公式、安全整数和末次取整；输出设置复用music-player owner，缺失当前选择与busy/processing反馈正确；下载行复用既有订阅，关闭toast不丢活动进度；队列工厂无桌面状态依赖。两完整文件8项和单个依赖用例1项通过，没有实际设备、下载或用户状态操作。

第一百六十九批明确仅部分审阅8.8MB大种子：两条archivedVariants全部递归字段、webp迁移及一批9来源roomSampling元数据完整展开，2681主记录只作全量字段统计和当前loader自动核对。归档愚乐/真爱与主整蛊/心意保留各自身份、raw和特效；没有把2683条自动加载成功说成全文审完。主记录与其余刷新/enrichment仍待审，新增测试和缺陷均为0。

第一百七十批对冻结玩法输入全部11根字段、225variant、30关系、24概率表和3补充来源做无损结构化语义阅读。精确键序/空值/数组保留，完整身份重算，opaque摘要/CDN哈希路径以完整映射和结构验证代替人工逐位比较。所有分组成员等值、各档权重和以及已声明帧边界核对通过；16份WebP的1500ms与原生周期分开。国庆完整文件实际5项通过，engine文件有效复用；未执行会下载/生成的builder，未认证远端字节或历史截图。

第一百七十一批全文审阅宝斋6份CSS共1292物理行，按自身双版本/六容器合同核对data-edition、已开禁用、next/settle和独立ledger/result。只复用摘要相同的公共shell选段，不套用成名的可选tier或800ms圆弧。5导入与2图片目标存在，无新增缺陷/测试执行；实际几何、原生输入和玩法未重新验收。

第一百七十二批完整阅读441条媒体账本的非遗漏语义表、三类字段schema、全部声明字典与URL/摘要映射，反向解码逐字段等于原JSON；原始只读1–65，不能称6527原始行全文。198effect/227image/16presentation、字节总量和元数据mediaVersion一致。accepted ADR与builder/测试助手确认账本不公开、媒体副本仅tmp，未读媒体本体、下载或运行应用，新测试0。

第一百七十三批只整理已有审阅证据，不重读业务源码、不新增覆盖。索引明确区分原始全文、完整结构化语义、规范化源码、局部、仅引用/自动与未知；历史全文声明保留摘要见证强弱和原始元数据位置。主代理用PK全文、设置页局部、盲盒自动解析和当前sketch四类控制核对，未发现范围晋级。余下证据缺口作为先回查历史的导航，不据此断言文件从未阅读；提示词新增规则11以防自动重读或虚增完成度。

第一百七十四批分别全文审阅唤灵493、工坊162和秘宝1333行CSS。三个独立生命周期由自身view拥有：400ms翻牌/420ms锁、2秒预览与180ms替换、500/200ms长按，不合并成通用规则。工坊替换先移除召唤reveal，不能据其.65初始缩放误报；秘宝小控件尺寸是明确局部例外。20URL声明映射19目标全存在，新缺陷与运行检查均0，静态证据不等于播放/像素验收。

第一百七十七批全文补齐文本框media121、preview95、workspace216及五份直接支持，复用162编辑器/工具栏与126画布夹具完整证据。确认F-035：同实例放弃后旧上传仍插入草稿，正常完成与切换dispose反证均独立复现。主代理保留子结果并逐字节复制到独立root-replay重跑，未执行真实上传写入或扩张到其他画布入口；新增维护测试0。

第一百七十八批完整审阅剩余五组刷新元数据的15个嵌套对象，并补齐全部35条event-extra主记录。65有序schema、七段全文字典与196URL映射覆盖所选全部字段；身份/历史修正、HTTP provenance和现行上任分组合同分开判断。结合169，九个非记录顶层键和两归档完整；主2681仍远未完成。只读FS/JSON验证12项不计业务测试，未认证外部资料或媒体权属。

第一百七十九批以旧55/78批50行原摘要证据为基础，新读930行使RoomMonitor累计980物理行全文；补读四测试及所列支持。租户在组合/入口固定，run/poll/socket身份、认证、重试、通道取消和已提交礼物交付各有实际屏障，无新增问题。四完整文件23项通过；同选择先plan后execute，经现有导出API注入单独合成environment避免读取真实.env，不能冒称默认CLI或上游验收，缓存0。

第一百八十批全文审阅薄弹幕适配8、样例49、独立参数222、会话18、registry22及实际inspector135和四份测试源码。样例与真实事件、金额/显示缩放、资源样式字段和释放责任分开核对；普通开播控件由专有owner负责，不据初始字段缓存误报。两完整模块文件12项与两完整Chromium文件9项通过，子页不发管理请求、样例过滤不改变正式来源。旧127dialog、131danmaku-preview、130recovery完整叙述回查后复用；173索引未提取不是从未阅读，不重计旧全文。

第一百八十一批只解决D-008具体原生边界，复用既有HTTP夹具和真实rule editor/model，完成展开后的键盘与文本插入。六个emoji只保留三个、六汉字完整、已保存六emoji仍往返，后端七码点拒绝对照正常，确认F-036/P3。临时诊断通过及初次未展开导致的取消各自保留，维护测试计数0；没有保存HTTP、数据库、剪贴板、计时或Electron运行。

第一百八十二批继续完整阅读原主索引0–199全部200条，每条outer与50键raw、全部嵌套count_map/light-dark和可选effect均无遗漏。八段各25条实际输出后才登记完成，新字典全文与旧schema字节等值引用分开，1003URL有完整类/明确地址映射。可逆深等、键序与人工观察账13项静态核验通过；五个名称字面差异仅为已知NFKC/空白等价，不改历史raw。累计235条，剩余2446条精确补集已保存，整体PARTIAL，测试和新原始文件credit均0。

第一百八十三批补齐剩余四份room-monitor测试正文1375物理行及54行clock helper；旧第7批FULL只明确三份生产源，52PASS不是测试源码全文。完整fixtures与43个展开后的源码断言分支已读，但43不算执行结果；旧52也缺当前完整环境/输入见证，只保留历史，不冒称当前缓存复用。没有具体待验证回归需要重跑，新增执行0，既有980行owner及其他四测试不重复审阅。

第一百八十六批完整阅读主索引200–399全部200条。199条raw为50键、索引335为51键并含完整officialRules及app/web banner树，全部outer/raw/nested和80显式effect保留。十个新schema与旧字典字节等值引用分开，1056URL和69opaque摘要有完整映射。初次前两块未返回可读内容时没有记完成，随后完整回读；16静态核验通过，累计435条、剩余2246条精确补集，整体PARTIAL。各次摘要相同只代表离散观测，不冒称期间持续监控；测试/业务文件credit和新缺陷均0。

第一百八十七批补齐使用指南六模块：主文件沿用旧77批310–315六行，其余范围新读，五个子模块全文；实际root/search HTML与四个测试全文。导航/搜索/段落恢复、动画取消和两种目录布局沿当前规范核对，历史仅页内存而非本地持久化，singleton页级监听没有被凭空认定泄漏。19VM/静态与22Chromium实际通过；lightbox关闭仅静态审阅，全部章节文案、真实Electron和完整视觉/无障碍不在新证据内，无新增缺陷。

第一百八十八批回查旧第5批明确全文与当前原摘要，直接复用活动源593和编排器690行；后续166局部重审不抹去旧全文。快照持久化新读446行，与旧28批277–328的52行累计498全文。兼容giftId投影与完整variant发布输入分开，事务内目录/关系/组/run共同提交，派生manifest提交后失败警告；inFlight与停机为等待本轮完成，未误报为立即取消网络请求。只读两段完整测试case，整文件仍局部，旧40/23PASS仅历史，新增执行/缺陷0。

第一百八十九批全文审阅导航423、懒加载66、两测试、两helper及shell起止HTML/CSS，实际app/两个别名初始化器只按选段。两页选中项独立，只有百宝箱注入持久化回调，排除了另一页覆盖偏好的疑虑；分组隐藏为零尺寸/hidden/pointer-none加即时inert，不能只据display:grid覆盖误报可交互。21项VM/静态检查通过，20输入前后摘要一致。旧144help与159/127helper完整证据复用；598行HTML初次输出截断后用四段补全，未把残缺输出记全文。无新增缺陷或实际浏览器/原生能力验收。

第一百九十二批完整阅读主索引400–599全部200条，outer/raw50键及count_map、明暗角标、19个banner树和158显式effect全部保留；9个schema、143opaque摘要和1101URL均有完整映射及旧值字节等值证据。所有八个25条块和字典输出实际可见、无截断，独立重建/原顺序/实际阅读账本/精确补集16静态核验通过。9处名称只为全半角括号差异，身份/effectID不一致0；累计635条、剩余2046条，整体PARTIAL。没有原始284128行全文、媒体、外部许可或新增维护执行/业务缺陷声明。

第一百九十三批回查旧77批引导三个模块510/189/87行明确全文叙述及当前原摘要，直接复用；两份测试与9行helper也有旧全文，173索引未提取出helper不代表从未阅读。现行说明的不能推进措辞已属于D-003，没有重复登记问题或重读完整owner；本批新维护执行和新业务全文阅读均0。

第一百九十四批补齐服务器目录service测试154–284/340–471共263行，与旧412行累计675全文；完整阅读integrity-boundaries150行、activity-sync477行，共新读890行。合成fixture、完整身份隔离、verifiedAt不影响公共version、可选mechanics保留、规则单独补充、TEMP trigger发布回滚与无效目录503/no-store按现行契约核对。生产owner沿用188完整证据，旧40/23通过仅历史，未运行测试或上游。清理/重开断言不等同在途请求立即取消，未新增该要求；source测试472行仍只参考，后续另审。

第一百九十五批补齐客户端后端组合入口579行，与旧明确314行累计893 helper全文；完整阅读现有cleanup-failures测试200 helper行，字体1–150/温度关闭115–131仅为具体异常传播回查。字体pending会收敛初始化错误，温度close等待allSettled，排除了据这两处直接宣称后续DB清理被跳过的疑虑；领域dispose逐步捕获继续。未require或启动真实入口、未执行测试；只确认D-009文档中间顺序漂移，无新业务缺陷，原始摘要相同为离散观测。

第一百九十六批Admin组合根新读1–49/261–351/387–397共151 helper行，与旧50–260/352–386共246行累计397全文。初始化、能力getter注入、五主tab/hash与卸载接线按实际入口和旧导航生命周期证据核对；168旧选段的摘要用175后续全局观测作间接见证，不说成阅读瞬间捕获。根shell-start仅搜索124–192，与189已全文的toolbox/shell-start区分；旧启动/引导/导航测试只作历史，无新执行、无新缺陷或桌面/原生视觉验收。

第一百九十八批完整阅读主索引600–999共400条，398个50键raw、索引700的41键和844的51键及officialRules/完整banner树均保留，355显式effect不补造。20schema、307opaque与1965URL有完整映射；字典和16个25条块均实际可见，16静态表示/有序深等/观察账/精确补集核验通过。354组可比较effectID一致，700原raw没有effect_id，明确不可比较而非补零或判冲突。9处名称仅括号全半角差异，累计1035/2681、剩1646；新增测试与缺陷0，历史资料不认证当前权益或媒体许可。

第一百九十九批全文阅读活动源测试472行和发现测试78行，共550新读行；旧生产源全文及40次测试执行不能转作测试正文阅读。保存证据/规则32预算、身份歧义、匿名固定来源、4app轮转、40chunk文本解析，以及并发请求合并、mutablebuild、失败缓存与256LRU按现行协议核对。超限用例是3MiB Content-Length加空body，只证明声明体积拒绝；15ms卡住正文用例只断言TIMEOUT，没有直接reader取消观察，不宣称真实15秒或流式累计字节验收。旧40PASS仅历史，没有新增执行或生产owner重读。

第二百批完整阅读实际Admin根shell-start330、document-end6、main-end3和song/shell-end7，共346 helper行，全部内联SVG及style/script字面量可见。旧toolbox收尾5行复用，根不存在独立shell-end；五主tab和共享popover按196入口/实际fragment顺序核对。四个选定ID唯一性只作搜索支持，不称所有DOM已验收；composer及结构测试当批只按选段登记，201/208记录后续审阅与历史分类更正。无新执行、缺陷或视觉/Electron/原生命令认证。

第二百零一批实际重检composer1–9/61–86共35行，另有200的10–60共51行；当时按局部记录称为补齐。第208批沿旧lens追溯后，确认31批已经在同一原摘要下全文阅读86行，现更正为选段重检，不能计为新owner缺口完成；实际读过的35行与旧记录均保留，原触及计数不变。结构测试新读25–50/60–178/200–309共255行，与200的54行累计309 helper全文，其证据独立于生产组合器。固定include顺序、允许路径、祖先环检测/重复非环引用及静态目录缓存、局部唯一性/嵌套顺序/主题替换/凭据不嵌入/frame与overlay sandbox只按实际范围审查，未执行测试。字体库174另复用旧24批全文，本次tail24行不算新缺口。提示词第11条补充按旧lenses、简写/行数及分组叙述找证据；后续实际执行该回查，避免只依赖逐文件索引。

第二百零二批从198精确待审补集取最前400条，即原1000–1402排除旧已完整1257/1258/1260；逐条outer/raw/所有嵌套值完整语义阅读，不重计旧三条。选段表示、独立有序深等重建、逐行实际观察账与精确补集16静态核验通过。累计1435/2681：0–1402共1403条及前缀外32条旧event-extra，剩1246条全部嵌套值待审，整份种子仍PARTIAL；没有原始全文、媒体或当前上游权益认证，新增维护执行/业务文件credit/缺陷均0。

第二百零五、二百零九、二百一十三批分别完整阅读400/400/446条新主记录，所有outer/raw/嵌套值、缺键、数组与键序保留；依次累计1835/2235/2681，最终补集为空。205的两条六字段本地图片快照仅比较实际同义字段，历史缺effect_id不补零；209的短raw及缺外层特效不误判冲突；213的四份18键activityOrigins、材料/规则全文和matchEvidence全可见。每批独立16静态表示/有序深等/逐行观察账核验通过，不计维护测试。source SHA始终为各次离散观测的同一57b128…6817，不宣称持续监控或当前概率/权益/媒体许可。

第二百零六、二百一十、二百一十五批完成Admin测试实际缺口：shell108全文、layout新247加旧164累计411，state523和ordering218全文，style-ownership96全文。旧155performance92及认证/renderer/VM/CSS helper明确全文直接复用。有限CSS字符串/导入规则、过滤getter、延迟HTTP/JSON与WS字段/版本/重连/关机错误断言按合同核对；假计时器不证明240/1600毫秒实时时长，假socket/静态选择器不证明认证、原生清理、布局或性能。新维护执行0，无新问题。

第二百零七、二百一十一批完成礼物特效身份84、normalizer124、规则来源356全文；概率测试新214与旧268累计482全文。基础特效与连送候选分开，缺baseMP4不借另一档；图片与特效URL家族、布局、绑定、缺字段不猜、完整身份/历史概率、纯文本规则/图片规则、32页/并发3和缓存/超时按现行合同核对。声明Content-Length/失败次数断言不冒称流式累计字节或取消钩子验证，参考概率不冒称当前上游赔率；旧通过只作历史，新增维护执行0。

第二百零八、二百一十二批补审HTTP/WS/session recovery三测试及transport helper共670 helper行；HTTP utils93全文，scene HTTP新395与旧177累计572全文。完整/缓冲/滴流/继续上传、Host前置与独立WS凭据、半开连接、upgrade首帧、会话401确认刷新和pagehide取消、场景管理/能力/投影回执/不透明Origin与版本冲突断言均按实际fixture核对。生产页面/HTTP owner恢复旧31/157全文直接复用；201组合器的历史分类同步更正。这里只审测试正文，无新TCP/HTTP/浏览器/桌面运行证明。

第二百一十六批主代理另核对169/178的九个元数据根、两个归档与全部九个主记录阅读组：7项结构/版本/索引并集检查通过，35+200+200+200+400+400+400+400+446=2681且无重叠，根键也完整闭合。由实际阅读记录决定整份种子的完整结构化语义状态；自动parse和此闭合脚本不新增人工阅读或维护测试。五份补充输入均完成各自声明范围，其中仅confirmed-effects是原始全文，其余为完整结构化语义；原3553分母不变。

第二百一十七批OpenAPI累计原始全文1741物理行：新1680加207旧61，完整长描述、enum/required/ref/limits/公开私有界限均可见；91本地引用可解析，现有Ajv helper39行全文。只对具体空URL差异追加生产DTO及公开网页消费链选段，纯schema四对象与主代理独立四对象记为D-010；静态引用成功不等于全transitive/runtime验收，没有改写现行schema。

第二百一十九、二百二十批只追具体存储假值候选。生产writer对象/null与无类型CHECK、现有损坏存储拒绝用例构成前提/反证；真实内存schema 3七对照和主代理受支持Node24.15.0七对照一致，确认F-037/P3。默认Node24.21.0首次重放在版本守卫处失败、未进入查询，原日志和空观察保留；没有更改保护或重试已拒绝安全操作。实际临时根均清理，未读用户目录、请求上游、启动应用或修改业务。全部诊断与静态检查均不混入5778次维护测试通过。

第二百二十二批完整阅读客户端七份工程配置/诊断入口225物理行、三份直接测试537行及契约验证器127行，共11份889行；NSIS/组合器/资源与package仅登记实际选段。诊断报告供手动分享，完整错误/事件消息可能含本机路径，现行合同没有匿名化承诺，不据此制造新缺陷。旧31批组合器全文继续复用，201仍是重检。没有运行collector、全仓modularity、pin门禁或这些测试，固定pin历史失败保留。

第二百二十三批两份Admin音频/客户端外观CSS全文604 helper行，色板178–216仅39行PARTIAL；实际DOM/状态与token选段支持不增加owner全文。恢复85批两HTML的complete92/29字面声明和131批八文件分组中的69行外观JS全文，均有原摘要见证，173的unknown没有抹去旧完整证据。新CSS没有资源URL或定时动画声明；这不构成桌面焦点、布局、对比度、播放或性能验收，新增执行0。

第二百二十四批目录测试新读316行加旧224行累计540全文，公共目录契约测试353行新全文，共新669物理行。完整身份/零价、业务版本与观测时间、排除关系、类型化奖励、迁移和HTTP条件断言按各自职责核对；HTTP/header的schema断言不等于实际网络检查。F-037缺失的假值对照及D-010已归既有问题，未重复深挖或重放；旧完整生产/schema/helper证据直接复用，新增执行0。

第二百二十五批设备规范字节与续期两份合成fixture、两份消费测试共471 helper行全文，canonical owner仅23–52/73–137、session仅120–158选段；34批session全文保留，不据此宣称175行canonical owner也已全文。逐字段核对LF/无尾换行、大小写/空白/缺hash和可选renewalSessionId不改签名字节；固定公钥占位符是字节向量，不是合法激活密钥。续期拒绝效果对象与事务源码仅为静态证据，未执行鉴权/回滚或密码学验证，也未自动取得其余OpenAPI/fixture全文。

第二百二十八批六份指南截图工程源码1655物理行/1661原helper全文，固定合成示例、manifest、page tools和Electron/web fixture均按实际副作用审阅；README101行为操作合同。共享DATA_DIR不能并发、保留tmp输出/profile、旧Chromium桥桩只展示不证明功能均有明确边界。只对skip候选追加主代理选段，确认F-038/P3；没有运行seed/capture或应用。五个任务简写.js实际为.cjs，按原清单纠正，缺失路径没有阅读信用；提示词第9条据此收紧派发路径核对。

第二百二十九批指南主样式625、导航487、搜索187、媒体116，共1415 helper全文。187的六JS与两根DOM按相同摘要直接复用；闭合目录/返回的inert、clear/results/floating的base hidden!important和dialog仅open时grid为具体反证。动画/减少动态分支和内嵌SVG字面量完整读到，未访问资源URL、运行浏览器或宣称几何/焦点/性能验收，无新问题。

第二百三十批十份Admin/Streamer机器样例643物理行/653 helper全文；四类身份/资料状态、独立IP提供方、错误列表、13条概览输入/四个窗口与已知/未知成本、负差额、删除/目录归属和固定TTL按现行条款核对。十测试实际230行选段保持PARTIAL，其中六份首次触及；其他规范306行不加入原清单。样例ID/URL/密码/时刻不当真实账号或过期事故；JSON解析不计测试，没有HTTP、DB/config导入、删除或密码学执行。

第二百三十一批七份安装器测试1021 helper全文与工具发现helper38全文；已触及的packaged-app30为明确重检，两个NSIS owner仅28/39行选段。完整阅读确认删除/静默升级、合成目录/锁/链接冲突、唯一进程名/窗口/音频事件、退出后保存与失败回滚断言和实际teardown；归档测试是合成tar而非签名NSIS验收。按当前构建合同核对，未编译/运行安装卸载程序、检查用户工具缓存或控制真实进程，无新增缺陷。

第二百三十四批六份Admin资料/礼物/最近弹幕、删除/目录归属与Device响应测试补齐1840物理行，加230旧135累计1975全文。完整审阅principal/Host、tenant游标与只读查询、缓存/迟到结果、删除/重试/故障触发器、目录归属与补偿、pairing权限及TTL断言；没有实际激活、删除、HTTP或子进程。执行前提另选读87行：普通runner的test-mode只设NODE_ENV/bcrypt，不能替代完整test-environment或保证不读checkout.env，未来运行仍需显式合成环境；这不是已观察的私库访问或新产品发现。

第二百三十五批加班CSS入口7、控制台102、响应式115、规则540、共享162，共926 helper全文。125的“CSS81 FULL”实际是另一个gift-picker，不挪作本批五文件证据；同摘要旧FULL及159 effect/time owner直接复用。hidden/checked/disabled、label/radio/fieldset与820/480条件、160ms及减少动态分支按实际DOM选段核对；F-032合法长时长问题保持原条目，未因54px样式重报。没有URL、浏览器、原生控件、焦点/布局或动画实跑。

第二百三十六批七份Electron补图配方、web补图与WebP转换源码1108物理行/1115原helper全文，228六base与README只绑定同摘要复用。配方E8是具备默认kind/size的未登录设置界面，web选择器始终过滤local，未重复F-038；只对浏览器创建顺序候选追加主代理选段，确认F-039。转换与输出是tmp候选，200KB为目标告警、源PNG尺寸日志不认证输出字节；没有截图、媒体读取/转换或应用执行。

第二百三十七批七份机器人/粉丝事实样例313 helper/306物理行原始全文，六消费测试256行PARTIAL、五规范145行另记。19条点歌认领边界全部读到；旧menuCommands只是兼容显示投影，V1/V2欢迎与可清空UID列表、历史会员观测/较新身份快照、PK布尔开关和每日接管/独立revision按当前合同核对。daily digest仅核对已有断言及算法文字，没有重新计算或执行测试；合成ID/日期/权益不当真实状态。消费文件与OpenAPI没有因fixture/断言自动全文晋级，无新发现。

第二百四十批六份daily/fan-facts/fixed-reply/welcome/PK/cloud-sync测试补齐1966物理行，与237旧256累计2222全文。完整审阅租户与namespace、cursor/epoch恢复、版本/事务/导入幂等、词库和开关独立、调度/取消/替身发送、欢迎列表缺省/清空、云revision-only SSE及并发窄补丁；合成子进程和监听清理只是源码，不是本轮执行。普通runner仍不替代显式test-environment，未导入config/DB或启动HTTP。

第二百四十一批礼物管理两入口及十子CSS共1922 helper全文；417行实际DOM/owner/响应式上下文单列，其中page80–195与responsive234–256是新PARTIAL，旧303/345 JS全文不重复计数。私有卡片固定盲盒配色、兄弟actions与pointer-events、table-wrap实际类、hidden/inert与modal focus、可见性/减少动态的预览接线均有具体反证；未把十二文件当整个级联、像素、性能或播放验收，未访问任何URL。

第二百四十二批七份采集/基准/Electron验证入口1380物理行/1387 helper全文。基准合成库与30个warm样本不代表OS冷cache/网络延迟；真实登录事件捕获是显式维护用途、原UID/昵称/正文不匿名，本轮没有运行或读取账号/log/.env。三个验证只按合成SQLite、局部真实markup/preload/IPC的有限断言审阅；追加主代理种子/今天/UTC+8查询数据流选段确认F-040，未把生产正确筛选改成缺陷，也未运行日期注入。

第二百四十三批十二overlay样例764 helper/752物理行和契约测试629 helper全文；公共schema286–440仍PARTIAL，布局owner仅61行选段。25区域/5新增样式例与旧九区域输入兼容，离线running/liveStatus0/nullsession有明确合同，私有过滤器和公开十类DTO分开，续费/陪伴字段不能替代F-006本地buffer验证。25区域与文档14键/四补齐列表对照后只记D-011；样例解析/字段计数不计测试，无HTTP/SSE/validator或实际播放，也不要求本地新样式镜像服务器。

第二百四十六批八份组件/预览/场景/折叠/富文本/文本框CSS原始全文1750 helper，必要DOM/owner/规范选段分开。旧尺寸标签默认hidden有具体当前入口反证：场景独立标签、文本/心愿预览主动隐藏及资源预览宽高输出，未证明可达信息缺失，不记F。新live-components HTML69、preview-page CSS15与gift-wishes CSS18均PARTIAL；既有充分全文owner直接复用，其余支持范围仍按选段记录，未访问URL或验证像素/焦点/性能。

第二百四十七批二十一礼物协议JSON全文1493物理行/1514 helper，含同步样例四块全部字段及活动规则长行。玩法ID/证据/概率/合成/目录次序、价格/0与unknown、私有身份/映射缺省清空、bootstrap/epoch等按各自owner核对；旧pagination“已读但未标记”不足以充当全文证据，保留原话后补实际缺口。三个消费测试选段188行，其中目录次序29行和留存57行是新PARTIAL触及；schema和存储owner未随样例自动全文晋级。协议已区分规则文字与mechanics等职责，不据样例或统计作真实权益/素材/上游认证，未执行validator/HTTP/DB/测试。

第二百四十八批十份资源/图标/城市生成/打包及Windowlight创作脚本全文988物理行/998 helper。ZIP有限可信条目、UTF8/CRC/偏移、schema2单组件与跨组件套装映射、八输出名与预设、显式替换输出、debug批处理文档要求已核对；没有运行脚本/构建/图像/ZIP或读取实际素材、源数据与输入元数据。69旧cities89是消费owner，与未审6452行目录分开；没有把生成器阅读当产物、地理/许可或导入验收。

第二百四十九批公开overlay OpenAPI补新3028物理行，复用243旧155累计3183全文；81旧时间字段查询明确非全文。完整25样式参数、10类型公共事件、nullable场次配对、兼容字段、身份/媒体/私有边界、组件参数与能力均读到，必要owner217行和协议9行单列；计数/JSON解析只是阅读后记账，没有运行validator。D-011保留，新D-012仅为SC显示说明旧数量；其余两份大OpenAPI、播放与桌面保存仍不能从本文件推得完成。

第二百五十批礼物页与admin响应式补新501物理行，加241旧139累计640全文。监控/本机统计/通知独立键、桥能力存在后显示互动控制、盲盒高级编辑、断点/表格横向容器和抽屉modal/inert选段已核对；旧196只有pageID引用，不冒充全文。仅复用必要既有gift CSS/JS owner，未验证整个级联、窄屏、Electron几何、焦点或实际交互，也未重报F-040/F-030。

第二百五十三批三份组件HTML/画布预览CSS/许愿CSS补新829物理行、复用246旧102，累计931物理行/934 helper全文，主路径新增0。完整五条编码SVG图标字面量没有替代真实几何、像素或运行验收；native fieldset与contentEditable禁用、相邻radio、预览/画布应用职责及当前导航接线有具体反证。新许愿HTML51–81仅31行PARTIAL；充分旧全文owner复用，其余支持按选段或引用单列，不把九个fragment引用自动全文晋级，也不重报246尺寸标签/F-035/F-036。

第二百五十四批两份gift-directory-order/retention测试补新932加旧247的86，累计1018物理行/1020 helper全文，新增路径0。目录投影失败的完整回滚/重试、首张可信图片时钟与发现批次、迁移/恢复、opt-in/ETag，以及留存的分批水位/版本保护/独立统计/迟到明细均按断言源码审阅；没有执行触发器、SQL、查询计划、HTTP或保留任务。目录测试先显式激活合成环境，留存头部本身未做同样激活；这是未来运行前置边界，不是新的实数据操作结论，普通runner/test-mode仍不替代完整环境。

第二百五十五批四份WeSing维护诊断源码全文638物理行/642 helper。缺省缓存发现可读取配置/token并查询loopback，help分支之前也可能做发现；这些只是源码I/O范围，本轮没有运行任何CLI或读取配置/日志/令牌。串行JSONL写入/首错、统一finish、terminal旧状态恢复、provider自有child最佳努力停止与最新日志tail/UTF16/半行清理已核对，不承诺零遗漏、匿名、文件总量或已观察到进程退出。实际provider30行和说明选段单列，没有whole重审其他诊断owner、package-lock或真采集。

第二百五十六批公开歌单OpenAPI、十份剩余非礼物样例及五份消费测试共16份原始全文1283 helper/1267物理行，实际路由/SSE/私有摘要/搜索索引支持216 helper与规范168行分开；新Device摘要测试仅132–161的30行PARTIAL。公开歌单按active路径选择，房主UID/资料与登录账号、弹幕公共DTO及Device私有数据分开；requestPrice是说明文本，完整库含禁用计数区别于公开启用列表。60/IP歌曲、独立profile、600网站与ingress拒绝、SSE逐连接UTF8预算/res.write()首次返回false后的期限、noindex建议语义及QR声明均有源依据。完整Ajv/HTTP/替身时钟/Writable断言仅为源码，未执行；公开歌单全文不使其余两份大OpenAPI、QR解码、真实TLS/反代/媒体/上游或桌面播放自动验收。

第二百五十九批许愿HTML补新120加253旧31累计151物理行全文；两份盲盒分析/日期CSS新全文768物理行，合计919物理行/922 helper。实际分析region、body隐藏播放器/滚动、日期popover及single/range/today/selected状态与现有JS80/60行选段对应，新分析HTML只49行PARTIAL。盲盒分析本机自然日与许愿北京时间零点各有规范，不能按两者不同推导时区缺陷；没有验证原生焦点、弹层几何、视觉或整套统计逻辑。

第二百六十批Device请求防护测试补新655加256旧30累计685物理行/686 helper全文，主路径新增0。合成环境在生产导入前激活，认证先于解析、操作额度、64 KiB/2 MiB/5 MiB和压缩/分块边界、跨租户云状态、正文接收中Session/JTI/epoch失效后保留原数据等按完整断言源码核对。没有进行签名或PNG处理，也未运行HTTP、DB、计时器或测试；测试全文也不等于Device机器契约全文。

第二百六十一批客户端package-lock.json逐块原始全文3757物理行/3758 helper，21块所有字段、URL、integrity、flags/platform/engine可见，末块不可见的旧尝试已补读。300记录含根、299registry解析项、6生产/6开发声明和override匹配属于本地元数据核对；没有下载包字节、核验安装树、运行兼容性、打包或更新公告认证，也不重放F-001/旧依赖告警。package.json既有全文owner的169行支持重读不加新完成，build规范36行只选读且既有修改保留。

第二百六十二批大型Device OpenAPI实际原始选段2781物理行：1–750、3161–4050、5403–5610、5775–5964、8755–9449、10978–11025。覆盖部分私有账号/礼物资料/过滤/观众、激活/配对/challenge/verify、PK/欢迎/旧服务端外观、profile/cloud及对应若干组件；其余路径和组件没有因ref或既有测试晋级全文。DeviceBearer租户选择、三种非Bearer证明入口、逐操作重试、私有字段与revision-only SSE、原密码/公钥/指纹/续期前提按声明审阅；156行实际owner与78行规范单列，没有执行认证或读取凭据。整份12588物理行仍PARTIAL，当前六范围之外9807行并不被本批完成声明覆盖。

第二百六十三批独立选读428行原始源码/91行规范核对C262-001：schema对raw账号限制32，兼容实现trim/lower后校验canonical 2–32的差别成立；但REQ/AC未明确承诺canonical32外侧空白后的raw34是合法wire输入，严格raw DTO文字属于verify。更宽实现本身不足以证明漂移，也未证实更窄wire形状是有意设计；局部长度/字符分支可通过不代表code、密码、名称空间、签名、状态或事务全部成功。候选排除，不设D/F、不改策略、不运行normalizer/Ajv/激活。激活测试只59–70/90–113共36行PARTIAL，Machine71行与262范围重叠不重复计数。

第二百六十六批分析HTML补新141加259旧49累计190物理行全文；七份toast CSS新全文443物理行，共633物理行/641 helper。完整表格/筛选/日期/分页与共享stack、manual popover、compact/detailed、动作隐藏、图片回退和减少动态声明按当前owner选段核对。共享toast源码新20–38/153–177/194–210共61行PARTIAL，通知owner另18行重读；引用、哈希和旧测试不冒充更多正文。没有访问URL、显示通知、读取媒体或验证原生层级、焦点、像素及动画性能。

第二百六十七批Device机器契约补751–3160及5611–5774共2574原始物理行，15块全部可见；复用262旧2781后，唯一范围为1–4050、5403–5964、8755–9449、10978–11025，共5355物理行，剩余7233行仍不在当前正文证据内。每日机器人设置/接管/导入各操作的租户、revision、空preflight与公共receipt，以及布局九必需/十六兼容区域均按声明和四份源215行核对；旧daily测试163全文只复用。组件ref不自动全文晋级，也未执行导入、摘要、normalizer或重试；不重复D-011或重开C262-001。

第二百六十八批服务器package-lock.json原始全文2028物理行/2029 helper，12块。168记录含根、167registry解析项、12生产/6开发声明与package.json一致；better-sqlite3生产安装脚本、allowScripts声明、fsevents可选darwin与ws可选原生peer均按元数据区分。客户端261或F-001旧局部不充当本文件全文。清单64行支持重读、运行时部署合同只选读；没有安装、包字节、原生兼容性、当前公告或发布验收，不覆盖旧依赖问题。

第二百六十九批Management机器契约实际选段1291原始物理行，整份11526仍PARTIAL。覆盖全局HTTPS/原Host/额度声明、首个私有guard-expiry路径、四认证入口、Admin密码/重置码路径及若干组件/错误/存储定义；其他路径和ref组件不随之完成。七份实际源719行和规范76行单列：两种Cookie及audience、冲突/无效会话清理、DB失败传播、管理员重新验证/目标与hash/epoch复核、事务审计，以及一次性重置证明和原始Unicode/bcrypt策略都有具体owner。没有登录、签名、重置、DB或部署执行，canonical DTO宽窄本身不新增发现。

第二百七十批激活测试补新330加263旧36累计366物理行/367 helper全文，新增触及0。完整断言涉及名称空间冲突前回滚、已指派占位身份替换、首次QR持久化与既有QR保留、license/消费后事件失败的原状态恢复，以及新密码策略与旧账号凭证验证的区别。环境activate先于生产导入；mock的cost12约束、触发器清理和状态快照只是源码审阅，没有执行bcrypt、生成QR、SQL、密码样例或任何测试，也不补成padded32 HTTP证明。

第二百七十三批toast源码补252加266旧61累计313物理行全文，三份admin layout/tabs/toolbox CSS新全文555物理行，共868物理行/872 helper。按key更新/迟到关闭、计时暂停恢复、栈与popover/dispose清理、固定图标与显式HTML调用方职责均实际读到；app/forms/theme另54行选段，新theme仅29–43的15行PARTIAL。更具体桌面规则有58px通用topbar的反证，未据静态声明报告几何或焦点问题，也未把一个已逃逸调用方推广为全局XSS验收。没有显示通知、定时器、键盘、浏览器或像素执行。

第二百七十四批Device契约补4051–5402及11026–12588共2915原始物理行，17块全部可见。累计8270唯一范围为1–5964、8755–9449、10978–12588，仍有5965–8754与9450–10977共4318行在当前正文证据外。私有礼物/清空/事实/流、云凭据/歌曲/背景/心跳、词库/到期提醒/日汇总及尾部DTO字段均按合同审阅；九份充分旧全文支持只复用。78的public overlay参数模块130 helper全文与backend同名134 helper文件分开，后者仅查询/哈希不借全文。未执行清空、密码学、normalizer、JSON validator或任何测试，也不重开C262或重复D-011。

第二百七十五批五份Admin e2e源码原始全文1095物理行/1100 helper，包含审计日志、概览、只读目标、静态目录与详情呈现。源码循环展开47例不计执行；mock角色、局部super_admin覆盖、只读GET断言和局部对比度计算分别有明确边界，不能作为后端认证/租户或完整可访问性证明。browser-pages旧全文复用、当前75行重读；两份直接辅助文件先仅111/6行局部，279再闭合。Management read-summary选31行与276重叠，规范49行另记，没有浏览器/HTTP/fixture/DB或页面时钟运行。

第二百七十六批Management契约补201–1025及3230–4149共1745原始物理行，暂累计3036；Admin列表/概览/24小时激活码、服务器歌单外观、房主与登录资料、设备/最近弹幕、删除/兼容凭据、只读摘要/监控及独立采集账号均读到。五份owner源492行和规范52行单列。采集账号的当前角色/UUID所有权、全局代次、三分钟有效期、并发poll共享和同步替换前复核有实际路由/服务/存储依据；保存后的目录刷新是独立异步结果。没有读取凭据文件或运行生成二维码、删除、存储和认证。

第二百七十七批QQ歌单维护工具68物理行/69 helper原始全文，provider133行选段。工具读取环境Cookie、在模块加载后立即启动并请求200份自建、200份收藏和12份推荐，逐组失败继续、外层致命失败退出；本轮没有运行、导入工具或读取实际环境值。公开/私有方法和截断由各自provider负责，源注释的所有歌单不当作完整账号清单保证；占位Cookie与明确诊断用途不转成真实凭据或匿名化结论，未访问上游。

第二百七十八批Management再补1197–3008共1812原始物理行，合并269/276后1–4204连续闭合，44个字面路径定义及security/parameters已读全。云设置/Bilibili/歌曲兼容入口与桌面流程、私有礼物快照/游标/Shanghai与滚动窗口、5 MiB请求和8 MiB歌曲快照、40码点标题、歌单QR/头像/背景候选提交与清理语义分别审阅；实际Streamer路由126行单列，不据声明替代事务/图像或运行验收。全文件仅4848/11526物理行，剩余组件6678行仍PARTIAL，所有ref不会自动补成全文。

第二百七十九批补完两份Admin e2e辅助文件75物理行，合275同轮117累计192全文：详情helper150和ui-controls42。39行详情空白是合成profile/history/reset/gift响应；控制辅助补36行，覆盖native select到listbox/radio的测试接线、筛选打开/应用与导出。固定UID/价格/标题只是fixture，Page/expect调用未执行；两份全文已计入本轮新触及11份，不与旧toast闭合或275的浏览器helper复用混算。

第二百八十二批主题CSS补34加273旧15累计49物理行全文，四份歌词入口/controls/preview/settings CSS新全文841物理行，共890物理行/895 helper。卡拉OK选择、原生label/radio、禁用/错误/隐藏、details、字体/范围与数值、预览背景和viewport/container断点均按实际DOM/owner选段核对；五份支持87行仍按各自范围记录，其中两个新HTML先局部、286再闭合。没有读取媒体/字体或运行Electron、浏览器、键盘、动画、保存，F-028保留。

第二百八十三批Device契约补5965–8754及9450–10977共4318原始物理行，25块全部可见；与262/267/274同摘要8270行无缝合并为1–12588物理行全文，末空行12589不计。机器人导入/事实/欢迎/PK、25种样式覆盖、云设置兼容输入/响应、礼物效果/映射/历史/同步/凭据等字段全部读到，13份充分旧全文支持只复用。Welcome错误数组maxItems14与字段enum16的疑点沿四个owner157行选段核对：工厂仅[]或单项，首错抛出，存储/服务/路由不累积；主代理复看17行同样支持排除，不新增D/F。没有执行normalizer、Ajv、签名、清空、导入或测试，原始全文不自动证明所有消费者和运行边界。

第二百八十四批Management契约独立补5561–8952共3392原始物理行，19块全部可见；交付时只记自身局部，未冒领父代理285范围。覆盖标题/背景尾部、CloudSettings兼容输入与canonical输出、独立flags/缺省保留、25样式选项、设置/凭据/QR及歌曲/只读模型，规范32行单列。已有browser style-options全文复用；同名Node模块仅哈希不借全文，285参数owner新全文由主代理记账。新原始scope只有这份契约，没有产品、validator或DB/网络执行。

第二百八十五批Management其余4205–5373、9141–9910、9956–11302共3286原始物理行全部可见。账号存储失败/删除状态、房主与登录资料、IP双来源与未知半径、礼物安全整数/已知零成本和未知成本/余项分母、固定Shanghai期间、参数/菜单/黑名单与监控扩展字段均按定义审阅；另独立读完backend component-style-parameters133物理行，原78 browser130 helper证据不挪用。规范28行单列。6678新行由284/285无重叠提供，加269/276/278旧4848形成Management1–11526全文；阅读后仅解析JSON核对本地引用定位，无缺失，不称OpenAPI/Ajv或运行验证。

第二百八十六批三份歌词HTML实际补读307物理行，加282同摘要71行形成主HTML128、behavior219、preview31共378全文。主HTML55–113的59行与135旧局部重叠，本轮按重读保留，不额外增加唯一范围；135的JS全文也不当作HTML全文。来源/外部播放器与全民K歌回退、卡拉OK/翻译/可见性/偏移/提示、预览timeline/status与原生标签/字段结构均读到；其余appearance/layout/rendering片段仍只是引用。没有运行保存、来源跟随、播放器、字体或实际场景输出，也不据属性本身新增焦点/Unicode兼容或呈现结论。

第二百八十九批appearance/layout/rendering三份歌词设置片段实际原始全文535物理行/538 helper，5块完整可见，原始/读前/读后摘要一致。原生控制、默认与范围/步长、来源说明、对齐、描边/阴影、背景/renderer、布局及确认重置逐项核对。两个既有owner仅重看55+19行：百分比由displayScale双向乘除、初始化按共享step换算，重置确认后includeWeSing:false，不由HTML显示单位差异推断存值错误。现行说明两段单列。没有实际保存/原生输入/字体/场景或性能验收，F-028保持；既有CSS与其余HTML不重复全文。

第二百九十批六份鉴权/凭据测试实际原始全文1427物理行/1433 helper，11块完整可见；原始/读前/读后摘要一致。覆盖存储错误与无效身份区分、QR到期/撤销/替换、凭据清空generation和最后成功提交、异步lookup后的授权重查、租户monitor登录门槛及Unicode/UTF-8密码兼容。测试中的SQL/HTTP/VM/时间/账号与bcrypt都只读声明，未导入或执行；生产密码策略复用旧全文，255 helper兼容JSON及其他fixture/helper仅引用，不获新全文。旧51/25 PASS等不重计，受控时序断言也不代表所有并发顺序或全局解析准入已验证。

第二百九十一批固定46个资源文件实际原始全文871物理行/873 helper、182228 bytes，48块完整可见：45份flower-letter SVG及guard-icons来源JSON，均匹配原始/读前/读后摘要。按实际末换行记录物理行，不统一用helper减一。路径几何、viewBox/ID/mask/filter/局部引用及来源字段已读，必要img/CSS-mask消费者只记选段；纸片1px中段由既有切片CSS拉伸。阅读后禁用DTD及外部resolver的XML源码元数据核对45份可读、200个文件内ID，无重复/缺失局部引用，无脚本、事件属性、外部URL等所列主动内容。未渲染、栅格化、下载、访问来源或判定像素/几何/版权；官方/无损/WebP等仍是元数据自述，不因源码全文变成来源认证。

第二百九十二批四份歌词测试实际原始全文1256物理行/1260 helper，10块完整可见：publication596、settings234、surface238、desktop-lyrics188物理行。核对设置分组/默认与透明度、共享browser-source连接及退避、状态/时间线的generation/sequence和字节/UTF-16预算、官方试听坐标、发布队列/强制事件、synthetic调度/隐藏/seek/进度缓存等断言与fixture限制。WebSocket/RAF/计时/fetch/DOM皆仅为所读测试配方；没导入运行，也不把词句引用的HTML/CSS/模块升级为新全文。静态Unicode预算不改说码点预算，测试声明帧率不改说测得FPS；F-028及运行边界保留。

第二百九十三批generation-recovery/source-handoff/performance三份歌词测试实际原始全文476物理行/479 helper，5块完整可见。核对timeline fence与一次恢复重试、ack失败处理、外部/内部来源优先与等值timeline/恢复、暂停不重试或排空旧队列、合成慢帧降档/健康帧恢复/隐藏与reduced-motion等断言。临时目录创建、校验父路径后清理、stub monitor及模块导入均只读，未实际触发；不扩张为构造失败时所有清理路径保证。旧131批26 PASS保留而非新执行，算法profile不是CPU/FPS/WAAPI实测，没有新F/D。

第二百九十六批共享歌词渲染、fallback与Moonlit两张CSS实际原始全文956物理行/960 helper，5块完整可见，4份均真实末换行且原始/读前/读后摘要一致。stage/viewport/文字/翻译/隐藏/背景/连续离散高亮/countdown/low-power及reduced-motion声明与必要样式/renderer类接线核对；3个owner仅31+17+8物理行选段，styles末空83行不计物理行。所有font-face、23个Moonlit分片与unicode-range均原文读到，有限语言覆盖声明不等于字体字节、缺字、许可或实际glyph/性能验证。旧70执行与同名服务器Moonlit文件不借作这四份全文；没有加载字体、媒体或浏览器。

第二百九十七批六份管理端/鉴权测试实际原始全文937物理行/943 helper，8块完整可见。受控激活并发、namespace与等待后前置条件、历史页面角色/转义、目标monitor及存储降级、profile/settings提交与故障时序、静态页面职责/资源顺序、IP/登录预算与精确豁免等断言逐项审阅。最后成功提交、best-effort audit和先租户后identity提交的既定边界不被说成跨库原子事务；VM展示角色也不等于后端授权证明。没有导入/执行activation、DB、bcrypt、HTTP、VM或Ajv；被测试引用的HTML、fixture、owner和两份大契约不获新全文，旧PASS不新增计数。

第二百九十八批固定30份剩余资源文本实际原始全文226物理行/248 helper、72319 bytes：28 SVG与Harbor/Notebook两份来源JSON，与291重叠0。所有路径数值、viewBox、局部paint ID和来源注释/字段均完整可见；28 SVG中21有末换行、7无，JSON各1有/无，未统一按helper减一。独立SVG内同名gradient不是页面内ID冲突，没有仅因省略width/height而推断尺寸缺陷。13个消费者仅搜索引用、实际支持正文0；没有XML解析、渲染、解码、网络或原素材访问。来源/作者/描摹/转换等文本只作声明，不据此认证许可或伪造产品缺陷。

第二百九十九批五份画布测试实际原始全文1588物理行/1593 helper，11个逐文件原文块完整可见。browser-source声明显示矩形与内部viewport独立、HTTP(S)校验/无效输入阻止发布、sandbox/no-referrer/无授权转发及布局调整不重连；suite/gift/queue/songlist覆盖独立资源、样本不持久化、父数据通道、样式/预览隔离、导入去重、延迟exchange/link、真实状态投影、字体/卡拉OK/背景与reduced-motion等测试意图。所有Playwright、fixture、ZIP/媒体、临时目录、截图与事件只是所读配方，未运行；不能据测试引用冒领owner全文或当前Electron/浏览器验收。取得资源后才注册的清理不被扩大为所有setup失败保证，也未未经证据复制CLI的F-039影响。

第三百批四份礼物/歌曲Admin CSS原始全文266物理行，加三份对应HTML原始全文504行，共770物理行/777 helper。HTML先作为39行支持，回查无充分旧全文后同轮补465行缺口，最终各自完整且无重叠；独立HTML摘要在初段后/补齐前记录，较早295全局摘要见证单列。原生表单/价格区间与过滤/状态/预览入口、容器布局、focus-visible、hidden/popover/fallback/reduced-motion逐项读到；歌曲owner实际180–244共65行仍局部，hidden先解除再showPopover、关闭恢复ARIA/focus及手动定位有源码接线，未从CSS静态位置推断冲突。礼物许愿引用片段不算新全文，未运行保存/重置/筛选/菜单、真实输入或视觉检查，没有新F/D。

第三百零三批十份浏览器源基础JS实际原始全文751物理行/761 helper，资源/CSS替换与尺寸、导入弹幕、预览外观、工具与自动分页、共享socket连接逐项读到；不能把同名服务器模块、旧测试通过或导入关系借为全文。纯媒体normalizer额外41行全文支持单列，caller选段与其余引用各按实际范围登记。真实media装饰可变art的两层拒绝回调形成具体线索，完成未修改源码的合成VM对照并交父307裁定为F-041；两次诊断启动与最终6场景单列，不冒领维护测试通过、真实播放/音频或浏览器验收。

第三百零四批服务器审计保留/备份/WAL/Bilibili入口、礼物parity、大航海、WBI与mock HTTP等八份测试实际原始全文1289物理行/1297 helper，13个可见块。WAL反例区分quick_check通过与漏掉已提交行，备份失败保留旧快照；跨库共同快照原子性、当前桌面parity与真实上游兼容性不因测试名称成立。UID/guard/honor/金额批次与累计UUID、固定签名向量、fetch/control恢复皆是所读合成断言。parity尾段不可见尝试不计，已分345–430/431–516恢复；无activation/DB/config/VM/HTTP/crypto/维护测试执行，引用guide/helper/owner不获新正文。

第三百零五批十份服务器legacy CSS实际原始全文1831物理行/1841 helper，16块完整可见，cream四条内联SVG原串未投影或省略。各自布局、共享gift覆盖、ranked/identity缩放、已加载图的mask reset、背景alpha及guard分支按现有职责核对，不要求设计统一；floating先于comet等import次序由19行实际选段支持。app32/style-options50行同为局部，共101行；motion只复用123旧全文，不借给当前十份CSS。128旧全文是其他主题，298相关CSS只搜索。没有XML解析、媒体/浏览器或播放检查，既有D-006失败保持。

第三百零六批授权页两份JS、三份CSS及HTML实际原始全文1492物理行/1498 helper，12块完整可见。校验/模式切换/清除凭据/busy/目录准备与返回登录/错误映射、font初态与事件先后、pagehide退订及装饰可见性/减少动效逐项审阅。HTML声明form-action-none CSP、初始禁用及labels/status/progress，CSS含窗口拖拽区域、滚动/隐藏/状态/焦点与尺寸条件；这些不是运行验收。两个Electron owner仅37+51行实际接线，不能据此声称整个IPC鉴权/启动链已重验；本页需要正常Electron预加载能力，没有用普通浏览器替代。未发现新授权缺陷，未重开C262排除线索。

第三百零七批主代理独立复看媒体94、caller61、normalizer22共177物理行，原文与原始摘要相符；caller末空76不计。再完整审阅173行合成诊断脚本及最终JSON/两次日志，区分当前拒绝的正常fallback与五个迟到反例。确认F-041的元素身份/生命周期根因；callback自身错误与误静音新video是证实的合成结果，不扩为native播放回头、真实音频/渲染崩溃或无消费者dataset的UI告警。复看范围与303重叠单列，诊断文件不属原3553代码阅读数，没有父代理重复执行或业务修复。

第三百一十批七份客户端背景/主题JS实际原始全文883物理行/890 helper。颜色矩阵/滤镜分支、Moonlit捕获节点和attempt/disposed防线、Windowlight解码代次/自动轮换/可见性、WebGL资源正常清理、背景组合和主题变量按职责审阅；标准/legacy差别及减少动效仍轮换由现行说明接受，不误报为统一设计缺陷。原始支持3路径31行仅局部，background.html8–18为新增局部触及；现行说明77行在原3553之外。GLSL/SVG原串读到不等于GPU编译、媒体播放或像素/性能验收，无新候选、0执行。

第三百一十一批六份服务器broker/每日机器人/初始化测试实际原始全文1076物理行/1082 helper、10块。租户/revision订阅、账号绑定保存顺序、导入到期回收、固定时钟/调度容量/未知发送、版本/迁移/整批回滚和初始化不加载默认资源等断言逐项核对。credential-stale尾断言只验证持久行数，不能冒称额外无发送断言；初始化child-eval脚本只读未执行。现行要求/协议52行来自原清单外3份MD，不借导入helper、owner或旧PASS当全文；无activation/DB/HTTP/加密/产品或测试执行，无新F/D。

第三百一十二批八份服务器legacy CSS实际原始全文1620物理行/1628 helper、13块；Starlight七条内联SVG原串完整可见。随机双段入场、Ranked accent/缩放/礼物、Starlight装饰、Starveil胶囊、SC root/child、Transparent和Whiteframe分别按现有设计阅读。实际原始支持5路径175行均局部，SCe2e91–114为新增局部触及；app62–90缺即时单文件前摘要，保留后置/中间及旧305离散见证，不补造前置观测。普通气泡custom-background仍匹配SC的源候选由父315单独复现/裁定F-042，子交付仍保留候选和0执行。

第三百一十三批五份客户端AI runtime/delivery/generation/lifecycle/session/service测试实际原始全文1814物理行/1819 helper、12个逐文件块。乱序生成的FIFO交付、分段/房间回声确认、确认后上下文提交、工具提供/撤回/迟到启用、会话代次/取消/关闭/清理与缓存断言逐项读到。3072/4096/384是测试内请求预算，不是已验证的上游模型限制；对抗文本是字面夹具，不是审计指令。AI局部fence不代表F-009通用批量发送已修；未执行模型、工具、网络、DB或测试，也不借导入证明owner全文。

第三百一十四批六份客户端AI context/continuity/verifier/budget/cleanup/coordinator测试实际原始全文412物理行/418 helper、7块。Unicode上下文截断、内存SQLite与固定时钟TTL、观众/房间隔离、分段回声匹配、受控流预算和清理/顺序锁均只审断言；结束命令即使通知未确认仍按排队次序清空，是与普通回复确认提交不同的明确合同，不误报为新缺陷。未启动DB、setInterval、流、缓存替换或产品导入，无新F/D和测试执行。

第三百一十五批主代理实际复看SC42、Bubble80、renderer35、style-options27共184物理行，均局部；其中SC42与renderer29行已在312读过，单列读事件不扩完成数。现行协议109–116八行与312重叠七行。受支持Node24.15仅运行自有builtins HTTP夹具，完整真实CSS导入链在IAB的合成DOM上实测SC外壳100→50→100背景变化，普通弹幕对照正常，确认F-042。scSurface为空使子卡片palette验证不成立；CSP原因仅推论。35份CSS摘要自动核对非人工全文，38次回环请求/1导航与0维护测试分列；已停止自有监听、关闭tab、进程exit0，未读用户数据或启动产品。

第三百一十八批17份客户端时钟、礼物视频/帧/队列、大航海、互动、文本滚动与开场JS实际原始全文2889物理行/2906 helper、26块。播放捕获节点/完成latch、容量/时效/去重、blob/GL资源正常清理、预览代次、时钟Intl/翻牌/单timer、文本签名/可见性、Pixel/月渡绘制与音频轮询按职责审阅，不要求不同风格统一运动。实际支持7路径301行，其中normalizer47行当前全文，其余局部；opening-appearance旧161FULL另行复用，不把本轮25行复看当新FULL。新局部测试/共享字段两路径保留精确范围；现行说明176行在原3553之外。C318-001由父324裁定F-043，0执行。

第三百一十九批13份服务器发送与Device测试累计原始全文3296物理行/3309 helper；实际新读3213行、28块，复用旧34device-auth-flow1–83共83行，旧34/35无差异快照与当前摘要见证单列。发送容量/预测与实际deadline/同房间顺序/凭据暂停/迟到完成/清理、设备激活/续期/恢复/撤销、礼物清空等待后二次授权/epoch/保留投影/SSE资源断言逐项读到。虚拟十分钟、合成TPM声明、service调用、单订阅VM harness不等于真实负载/硬件/Admin入口/其他连接隔离证明；client F-009未因此修复。无新支持owner/规范正文、无activation/DB/crypto/HTTP/VM/测试执行。

第三百二十批23份服务器源实际原始全文2833物理行/2847 helper、43块：Ripploid/Twitter两大样式、两份字体CSS、入口HTML与Comet/Moonlit18份JSON尺寸/来源声明。Ripploid17条长原串实际是d:path几何/关键帧，早期dataURL称呼已更正，未投影、解码、XML解析或渲染；字体unicode/path声明和provenance长prompt原文读到也不是资源加载、真实来源/授权或像素验收。实际追加链与专属入场marker线索见D-013，已有共享WAAPI行移动作为反证。仅源码及元数据记录，子交付保持无编号候选/优先级null/0执行。

第三百二十一批11份客户端AI配置、密钥origin、provider、请求日志/保留、route、ChatGPT/豆包与UI测试实际原始全文2528物理行/2539 helper、19块。内存事务COMMIT回滚/缓存、临时key与origin、provider请求映射、UTF8日志上限/队列丢弃、retention cutoff、路由白名单、PKCE/轮换/取消及SSE完成边界按实际断言审阅。所谓官方endpoint、模型/预算/订阅权限只是本地合成预期，没有据此宣称上游兼容；GET/PUT安全stub和no-innerHTML正则也不是通用脱敏/XSS保证。字面prompt/攻击字符串、VM/crypto/HTTP/清理调用全未执行，引用helper/owner无新全文。

第三百二十二批12份客户端Bilibili代理、WBI重试、发送、网络上限、房主/用户资料、启动、SC、图标、开播回复、去重及packet测试实际原始全文1269物理行/1281 helper、12块。mock fetch/cache/clock恢复、受信头像无Cookie、重签代次、超大流取消/超时、房主与登录UID分离、SC创建/删除与指令去重、live会话分段fence及解压/消息数上限断言读到。send标题提visible mention但只断言reply元数据；room-profile匿名只断言!ok非精确401；签名预期复用owner函数而非独立向量。无上游发送、监听、临时目录、crypto/zlib/大内存/测试操作，不把server或专用sender覆盖借给F-001/F-009修复。

第三百二十三批只补两份已知局部缺口：background.html1–7新7行+310的8–18旧11行，SCe2e1–90/115–221新197行+312的91–114旧24行，当前原摘要及前后摘要相符，分别达18/221物理行累计全文，无间隙重叠、无新增触及。SC配色、完整文字、窄画布/12帧稳定及排除样式是所读浏览器recipe，未实际导航、截图或发事件；未借315自动CSS加载当全文，也未重跑F-042。

第三百二十四批父独立复看opening146、shared appearance11、normalizer47、MoonFan art39及测试36共279物理行读事件、278唯一行（312重复一次）；全部与318当前正文重叠。编辑/校验保留空串、组合||替换和底层??的责任差异确认F-043；测试97–132仅局部且只明确验证默认页脚未绘制，不冒称清空标题集成已覆盖。父单文件摘要是读后见证，较早并行metadata及317全局/318前后摘要分开，不倒填即时读前。无VM/浏览器/保存/画面执行。

第三百二十五批父重看Ripploid46/Twitter30共76物理行，协议154–162九行在原清单外；CSS已在320全文读过，不增加完成数。源时序意图与实际producer缺口有线索，共享行移动和协议未明确专属时序也有反证，故仅新增D-013待验证，不制造新F或泄漏结论。325号finalizer曾只准备未运行，最后收尾使用326，不把准备脚本或读取命令算产品验证。

第三百二十八批26份客户端展示CSS及7份对应HTML实际原始全文3152物理行/3185 helper、36块。时钟11子风格与入口、背景滤镜/窗口场景、媒体定位、开场/Pixel/月渡、礼物/大航海、导入弹幕/互动/许愿/冲刺按各自布局和初始hidden状态审阅；HTML完整SVG/path/SMIL字面值读到，318/310/303真实owner只作既有上下文，不借导入当全文。没有新支持正文或规范正文，source声明不代表像素/字体/动画/原生视觉与推流软件验收；F-041/F-043及D-013未重验。

第三百二十九批20份服务器礼物目录/版本/分类/细节与图效、图片策略/交付、互动构造/免费去重、响应缓存/初始化/关闭、上游重试/超时/同步/统计测试实际原始全文2998物理行/3018 helper、33块。真实与降低限额、默认常量与已填满8192本地预算、受控shutdown等待与实际网络取消、VM失败注入与真实句柄、ETag表示缓存和跨连接写入、日志截断与保留旧目录等断言边界分开；65536生产全局常量未被当作全量负载已跑。旧child app环境override不是完整.env隔离保证。本轮无activation/DB/config/crypto/VM/child/HTTP/测试或真实同步，无新支持owner/规范正文。

第三百三十批31份服务器站点原始全文2915物理行/2946 helper、40块：11份共享/站点CSS、17份SVG及字体/预览捕获/歌曲外观3份JSON声明。SVG原串、字体清单全部689个uiCodePoints条目、capture清单7images/7archives/7animations完整阅读，早期690数量笔误已更正而未扩范围。声明的匿名化、音频、截图完成/来源/授权和字体覆盖不是实际媒体/法律/外部真实性认证；未读取二进制或访问来源。必要consumer/后续响应式反证按实际选段单列，不借引用的全站源码或共享组件为全文。无新F/D，D-013未重开。

第三百三十一批10份客户端Bilibili诊断/粉丝牌轮询/身份缓存/输入压力/点赞/直播状态/runtime/WebSocket/capture/头像桥接测试实际原始全文2193物理行/2203 helper、18块。诊断隐私投影与含身份正文的独立operator command formatter职责不同；假时钟分页/超时、queued auth与room代次、like绝对快照、二进制顺序/旧socket无效、capture写入背压/错误/限额/清理分别审断言。大内存/zlib/16MiB输出与VM/临时目录/登录路径只是测试recipe，未实际执行，未打开真实profile/日志/账号；生产capture工具旧242全文不借为本测试全文。没有新owner或规范正文，未把这些专用fence当F-001/F-009/F-015已修。

第三百三十二批补齐两份326已知局部：MoonFan测试新1–96/133–159共123行+旧97–132共36行，shared/scene-extra-components新1–21/29–184共177行+旧22–28/185–188共11行，分别达159/188物理行累计全文，摘要一致、范围无间隙重叠，不增加触及数。底层测试仍未覆盖F-043组合merge；字段声明将外观与会话/结算/编辑owner分开。额外Admin金额控件96–141/165–208实际91行读事件（120重复一次），前端有读写与约束的cent/yuan换算，C332-GIFT-FEED-CENTS-LABEL据此排除；支持单文件摘要是后置观测，非即时读前。没有新增测试或运行。

第三百三十五批19份客户端队列/歌单展示源码实际原始全文3365物理行/3384 helper、27个可见块：10份基础/风格CSS、7份queue/song布局、主题、滚动与虚拟列表JS及2份HTML。旧310调用搜索、Admin同名模块及server同名源码不能借为目标全文。状态读取代次与样式签名、SC字段、容器缩放、循环克隆/WAAPI重置、变高行锚点/回收/暂停/销毁等按所属职责审阅；Moonlit独立样式由既有resource preset声明，不能仅因base入口未静态导入认定缺失，必要匹配行仅搜索，不计支持正文。没有实际DOM、滚动、字体、内存/帧率、像素、Electron或推流应用验收；无新候选，F-043/D-013未重验。

第三百三十六批20份服务器测试实际原始全文4507物理行/4527 helper、43个可见块。活动规则来源与完整礼物身份、历史种子/盲盒池恢复、流水完整性缓存/迁移回滚、金额投影、元数据/同事务缓存复用、公共路由/ETag、保留维护、同步跌幅/时区排期、URL状态、舰长/环境策略及模拟器断言逐一审阅；旧211activity-adapters只是metadata候选，不借为全文。大种子/PNG/MP4/布局、概率与摘要均为夹具历史断言，未借导入或校验代码升级为大输入原始全文、真实媒体/赔率/上游/性能验收。SQLite/故障注入、VM/eval/data导入、child/HTTP与完整synthetic activation只读配方，没有实际产品/测试运行，也未新增owner/规范正文。

第三百三十七批15份服务器点歌页/布局与字体声明实际原始全文3697物理行/3712 helper、47个完整块，含401340bytes原串：1份HTML、6份页面CSS、四套字体各自CSS与manifest。初始hidden/disabled、脚本顺序、过滤/移动控件、toast、虚拟行高度与响应式规则按源码审阅；字体全部长unicode-range和清单字段均实际读到，不以解析代替原文。另一次纯文本核对确认round/sans/serif/wenkai的32/81/81/121分片顺序、家族及normal/400/swap声明一致，字符并集12329/30890/30928/46490与清单相符，无重复/非法token；不校验字体二进制、cmap/hash/字形、来源真实性或许可权利。旧133builder/test/appearance和330其他清单不能借为目标全文，旧导航被截断不作从未读过的证明。支持正文和产品/浏览器执行均0。

第三百三十八批16份客户端桌面/原生测试源码实际原始全文2516物理行/2531 helper、22个可见块。原生输入/安装退出/DSP与项目锁定依赖、播放输出helper、助手/IPC、更新管理/控制、退出/启动、URL/管理请求头、就绪控制和旧数据迁移测试逐段审阅。原生程序会枚举/打开真实音频端点，Electron配方会启动child并写合成SQLite WAL/复制/锁定数据目录，这些只是被阅读的测试源码，均未执行或触及用户应用/音频/数据。假时钟的退出期限/第一请求意图/flush与drain顺序、frame/session/document身份及redirect去密、授权代次与字体不阻塞等断言不被夸大为真实桌面运行；更新控制器对无效安装不drain也不等于绕过manager校验。packages.lock.json为99物理行且无末换行，其余15份末空helper不计正文；没有新增支持owner或新候选。

第三百四十一批19份服务器此前未标人工触及的frontend原始源码实际全文5466物理行/5485 helper、43个完整块：standalone-effects JSON、admin只读HTML/JS及16份streamer工作区/管理/图表/筛选/历史/响应式CSS。独立特效清单39项（22guardPurchase/8guardGlory/9wealthUpgrade）的全部字段与RGB/alpha裁剪声明读全；checkedOn、nameSource、时长/尺寸/来源URL只是声明，不作媒体/上游/授权真实性认证。只读renderer转义和纯读取请求、CSS导入/加载顺序/hidden/focus/各断点按source审阅；不把HTML只读文案当服务端权限证明，也不因分层样式相似推断重复渲染。旧83 consumer JS全文不能借给1019行JSON。新增支持或规范正文0，运行0。

第三百四十二批20份服务器鉴权/请求准入/提交屏障、tenant租约/备份/缺失存储、监控启动/关闭/状态、代理/overlay/SSE、HTTP错误/qs/crash/health测试实际原始全文3218物理行/3238 helper、33块。身份撤销与慢上传重查、跨tenant隔离/保留既有状态、连接迭代器/事务/租约回收、独立监控进度结算、启动代次与终止、SSE背压/取消和安全错误投影分别按断言边界审阅；默认Node stderr不被当全量脱敏。测试中的child/eval/VM/backup/.env合成夹具/rename/crypto/HTTP仅源码配方，未执行或触及真实数据；Nginx静态字符串断言不代表部署解析/负载。旧47/51 PASS非这些测试正文FULL，新增owner/规范正文0，既有禁用后已接受礼物最终结算排除保持。

第三百四十三批固定26份客户端弹幕CSS采用两类证据：16份原始一致新读RAW FULL2941物理行/2957 helper、21块；harbor/identity/mist/notebook/prismatic/snowfox/spooky/starlight/starveil/whiteframe共10份current修订复用146/151同SHA原串全文2494/2504，不冒领原始baseline正文、不改153队列或冻结覆盖。当前26份累计5435/5461，Cream编码SVG及flower-letter path等新读原串完整可见，无解码/渲染。动效/字体/头像/身份/图案保持各风格职责，不声称实际密集播放或统一风格要求。客户端bubble自定义背景与SC透明owner的同因冲突经父345确认，沿用F-042，无新编号；子343的实际支持新正文0，旧FULL/旧选段/搜索/hash引用分层保留。

第三百四十四批18份客户端Electron/editor/appearance/auth/session/update/font/resource测试源码实际原始全文2257物理行/2275 helper、23块。确认/取消/失败草稿、授权独立词库写入、外观保存/发布/重开、sandbox无父凭据、SC外观参数与样式实例、合成豆包cookie/验证/会话ACK/TTL、更新通知/进度/资源状态、ASAR字体/完整性/生命周期wrapper、许愿样式和Woodland导入/备份几何等断言逐段审阅。wrapper的result.ok不转移为probe全文或实际完整集成证明；测试中真实Electron/Chromium/CDP、128MiB文件/ASAR/ZIP、cookie/存储/媒体/截图/复制/清理操作均未执行。背景重置的颜色偏差容差不冒领独立精确像素断言，Snowfox变量不冒领卡片实色；Notebook等待data-live-entry不关闭server D-013。新增支持或规范正文0，无新候选。

第三百四十五批F-042客户端源码范围裁定读取5个实际路径的7个片段265行：bubble209–235、superchat1–20与343全文重叠47；SC renderer38–80/81–125共88、core55–96/1–54共96为原始一致owner选段，style-options440–473共34为已知当前修订选段。前后摘要一致；原始覆盖只重登记4份一致路径，当前style-options不越过冻结摘要校验。body customBackground、实际SC类别/提前分派、独立SC透明注释和普通气泡高specificity构成客户端源级证据，未运行client DOM/renderer/CSSOM、未借315 server夹具或声称内层实测配色。仅更新同号F-042范围，43项总数不变，D-013及所有旧失败/pin/refusal/exclusions保留。

第三百四十七批28份客户端展示/共享源码（25JS+3HTML）实际原始全文3887物理行/3915 helper、41块。盲盒/加班、弹幕预览与区域编辑、Ripploid、身份图标、答谢风格/取消、互动/队列/歌单设置、文本与场景几何按既有职责审阅；并非要求所有风格显示同一身份信息。Aurora未显示姓名/头像由overlays.md277明确设计反证排除C347-AURORA-NAME，只读该规范1行；指南仅搜索/hash，不冒领正文。旧310/318/335及server同名文件不借为目标全文。无运行或新增F。

第三百四十八批25份服务器game/activity/storage、overlay运动/SC、PK、public locale/song/surface、standalone effects、streamer API/manage/avatar、viewer visits、section/site preferences测试实际原始全文4438物理行/4463 helper、44块。合成VM/HTTP/存储/取消/限流/状态/SSE和静态字符串断言逐段审阅，测试配方未运行；四个局部env变量设置不被当成完整.env隔离。旧312的e2e/overlay-superchat.spec.js24行与本批test/overlay-superchat.test.js200行不是同一路径，旧同名renderer全文也不替代本文件。无新增支持/规范正文、维护执行或F。

第三百四十九批5份客户端时钟目录、两份HTML、CSS和共享设置实际原始全文7224物理行/7229 helper、60块，其中city-catalog.js6451物理行/6452 helper、829297bytes，全部6442条tuple原串经54块完整可见；55/61口头块数笔误以最终54/60见证纠正。旧69目录仅自动解析、旧318导入/片段不借为本次全文。其余4份773物理行/6块，HTML包含OBS和哔哩哔哩直播姬，sandbox预览由实际owner初始化，不因初始无src误报。城市zone疑点由父351裁定F-044；完整原文不认证全部地理、译名、来源/许可或DST。子代理未执行Intl/生成器/浏览器或请求上游。

第三百五十批22份客户端共享颜色/取色、CSS应用、复制、格式化、event bus、字段反馈、文本适配/HTML转义、JSON响应、日志、歌词时钟/调度/性能/逐词动画、播放反馈、modal focus、主题及播放入口实际原始全文1592物理行/1614 helper、22块。读JSON和检查HTTP状态职责、Set/once嵌套发送、歌词anchor与WAAPI清理、节点保留/撤销、focus恢复按实际合同审阅；没有凭泛化的异步保证、未知数字caller、嵌套modal或迟到disposer假设新增缺陷。旧索引引用、server同名helpers和测试字符串不冒领全文；无新支持正文、DOM/原生取色/媒体/IPC/浏览器执行。

第三百五十一批父审F-044：实际源码6路径293行读事件、293父内唯一行/11块，目录11行已由349覆盖，其余282行增加本轮唯一正文；cities88为旧69FULL复看，time25、index89、test47、generator33仅选段。app.md407–419现行规范13行单列。实际一次受支持Node24.15.0纯builtins Intl对照证实两条目录zone与IANA代表zone在固定时刻相差7/11小时；未导入或执行产品formatter/UI/生成器，也未读取下载原GeoNames/NaturalEarth输入，其他可疑条目和具体来源分支未全部确证。三个公开IANA URL通过三次web工具咨询核对，以版本固定2026f表为主要依据；Node自身tz为2026a，公网工具请求与应用网络边界分别记录。新增F-044/P2一项，0维护测试通过、0业务修复。

第三百五十四批29份客户端播放器样式与页面原始全文5971物理行/6000 helper、51块，其中24CSS（含entry）5081/5105、5HTML890/895。按页面/布局职责核对导航、账号/health/WeSing、发现/搜索/匹配、dock/播放器/质量音量、菜单/抽屉/队列、确认框、全屏封面/歌词/翻译/罗马音/跟随、外观选项及30palette声明、媒体条件和减少动态规则；所有实际原串可见。collapsed的opacity/pointer-events不是实际隐藏能力结论，forms203–208、drawer38/50/72及event-handlers232–233的真实搜索命中给出focus迁移/aria-hidden/inert反证；这些owner仅search/hash、不加正文或FULL。旧196page-id1明确搜索引用、71/235其他owner不借为本批全文，无新F/D或桌面/键盘/像素/字体/媒体执行。

第三百五十五批18份服务器公共页面e2e源码原始全文2278物理行/2296 helper、27块，包括16spec及两个指定support共87行，support已经计入主范围一次。品牌/neutral文案/注册页脚、移动控件、首页、歌曲标题/加载失败/请求条件、房间头像与workspace状态的mock、assert、context/route/cleanup按真实范围审阅。429用例只见重试按钮及一次请求而未点击重试；允许合成roster-sync POST的断言不被称为全无写请求。标题/HTTP/字体/CDP/剪贴板/5000合成候选/截图/链接均只读配方；footer注册值只是预期、没有外部真实性查询。旧173索引/同名Node或其他homepage套件不借目标全文，额外支持/规范正文及执行0，无新候选。

第三百五十六批19份客户端授权测试/helper/桌面probe原始全文4962物理行/4981 helper、38块。候选密钥提交/丢失响应、identity epoch与重试coalesce、续期/撤销/终止、IPC与背景/歌曲响应预算、启动UI/密码兼容及visibility、SSE64KiB跨chunk/UTF8和读取取消按合成断言审阅。protocol-e2e的内存fake对activation证明有crypto配方，但auth verify仅检查signature存在，不模拟challenge到期/单用/实际验签；固定pairing日期也不证明到期实现，这些是覆盖限制而非新生产缺陷。两probe使用真实Electron/cookie/safeStorage/HTTP/executeJavaScript及Module._load shim的代码只读未运行；344wrapper不能代替本次probe全文，50/100ms真实等待配方不冒充穷尽时序。helper/两probe纳入19主范围一次，额外owner/规范正文0，44F/旧失败/pin继续保留。

第三百五十七批21份客户端基础/Admin入口/六类控件、桌面shell/update/status、字体、两片段、六SVG和主题JSON原始全文3280物理行/3301 helper、32块。基础token/兼容别名/[hidden]!important、原生输入与展示分工、disabled/focus/invalid/selection、balanced/centered range、单/多选及onboarding分工、确认框/弹窗减少动态、路由滚动owner/更新进度等按实际CSS核对。theme-presets631原始物理行全部读到，14classic和14songBoard与各自label/swatch键一致的JSON元数据核对不计新维护测试/诊断；shared/theme.js350旧全文仅作既有上下文。全部SVG/path和内嵌来源/许可文字、9font-face声明读到，不认证外部来源/许可、字形或像素。通知初始HTML无hidden不被误报，workspace/notifications.css2/19样式owner由目的搜索定位；select-menu.js307及desktop/theme.css26/44也只搜索反证，无新owner正文。173索引无FULL不等于从未读，旧200/223/229/235只搜索、106serverJS与337server页面不借目标全文；当前所有新原文完整，历史导航截断不获正文credit。无新F/D或运行。

第三百六十批27份客户端百宝箱CSS原始全文7985物理行/8012 helper、46块。规划器、游戏目录/轮盘/绘画、AI、开场、固定/自定义/查询/欢迎/答谢、粉丝列表/详情/编辑/冲突、礼物、互动、导览与性能样式按所属状态/容器/滚动/变量职责审阅；固定回复785行编码SVG等原串完整可见，无投影或URL访问。hidden/open/selected/pressed/invalid/disabled/empty与减少动态规则是源码声明，不能当业务鉴权、硬件采样、实际桌面焦点或像素/播放验收。导览允许目标透传与退出确认阻断层各有职责，不凭弹层外观新增统一modal要求。273入口imports、旧229/349/193/77及同名server不借正文FULL，新增支持/规范正文及运行0，无新候选。

第三百六十一批21份客户端场景/存储/传输测试原始全文5853物理行/5874 helper、47块。九份场景测试区分草稿/应用发布、owner/epoch/capability、静态歌词缓存/事件投影、iframe load与组件协议、提交回执/失效及失败保留；四份存储测试逐读老schema/SQL迁移、部分提交/暂停恢复、索引/缓存/双句柄快照；八份传输测试区分HTTP响应字节/取消与WS身份/allowlist/背压/碎片UTF8/关闭。SQL trigger、同步重入、假socket/clock及模拟12/24/168小时只覆盖指定配方，不算真实崩溃/网络/长时堆内存证据。真实HTTP/WS/browser/DB/crypto调用也仅源码未运行；旧生产scene-cloud-controller等不同路径、引用fixture和PASS不借目标全文，额外owner/规范正文0，无新F/D。

第三百六十二批20份服务器release checkout/package/verification/awake、streamer-storage和welcome测试及四helper原始全文4078物理行/4098 helper、44块，其中helper/fixture345物理行只计主范围一次。release-verification1299行含全部嵌入子进程/报告/consumer数组原文；人工报告、recordNodeSuccess和时间估值是控制输入，未冒充本审计PASS或真实CLI/browser执行。候选checkout边界/脏目录/锁/链接/字节归属/撤销证明、存储缺失不自动provision/租户根/迁移rollback、欢迎停止代次/冷却/在途发送占用/访问事实与事务按实际断言核对。account helper旧234/260仅REFERENCE_ONLY、after-resources旧169仅metadata，不能借旧40PASS或生产owner为本批FULL。所有Git/branch/commit/删除/链接/打包/电源/activation/crypto/DB/VM/eval/网络配方均未执行；普通testmode不替代未来完整合成.env隔离，支持/规范正文0，无新候选。

第三百六十三批12份客户端blindbox/overtime、六子games及兼容entry、scene组件/output、Ripploid CSS原始全文3820物理行/3832 helper、41块。Ripploid单份1471物理行/1472 helper、100256bytes经18块原文完整可见，17条超过800字符的d:path原串逐段保留；属性注册、稳定默认帧、data-live-entry分层chat/system/gift/member/SC时序、独立字体、feed缩放、金额scramble/签名/头像与减少动态重置按所属职责审阅，不认证官方demo来源、路径插值/像素/GPU或实际文字稳定性。其余样式按盲盒summary/winners/compact、绘画工具/滚动/身份/结果、加班机容器/票据/低动态、场景只读组合职责核对，不统一配色或强制所有低动态都完全静止。游戏display优先级疑点由games.js176–184同轮设置body.dataset.game与drawGuessView.hidden的真实搜索命中排除C363-GAME-VIEW-HIDDEN，HTML/owner仅搜索、0支持正文；未声称当前UI实测。173无FULL不等于never-read，141/148server、82Admin、320否定范围和343其他CSS不借本组全文；D-013仍为server legacy待验，0新F/D或运行。

第三百六十六批26份客户端工作区/共享CSS及Admin片段原始全文5478物理行/5504 helper、37块，19CSS与7HTML。工作区导航/队列/SC撤回/管理页/通知、点歌参数与地址/请求设置、礼物审计/横幅/心愿/答谢/互动、桌面滚动条和文本声明按所属状态/布局/容器/变量核对，CSS编码SVG及HTML全部内联path原串可见。礼物历史抽屉初始aria-hidden/inert、盲盒与弹幕面板初始hidden、导入预览/云状态、设置/地址按钮和shell-start组合片段逐读；shell-start由其他片段闭合，不把非独立页当标签缺陷。当前styles-base179仅搜索/摘要，规则语义复用357同SHA旧425物理行RAW FULL的全局hidden!important反证，0新支持正文/触及。OBS与直播姬作为推流软件区别于B站平台；展示URL未打开，剪贴板/删除导入/导出/保存/授权/焦点/字体/像素与动画均未执行。固定26主范围无旧FULL借用，无新候选。

第三百六十七批36份客户端领域测试原始全文7336物理行/7372 helper、63块，6动态抽奖/12粉丝/7游戏/11加班。证据收集/截止/账号epoch/配额重试/事务原错、typed身份与租户/手工私有字段/增量事实cursor/歌唱统计与请求证据、快照/恢复/撤销/抑制/名单、游戏分发/主播角色/重放去重/加权轮盘及加班外观回执/倒计时修订/持久化故障按实际断言审阅。候选日期oracle复用membership计算而独立枚举日期，只证选择等价；fan-sync空推进页由stub consumer接受，仅测控制器分页，真实信封校验另有suite；部分game-route输入已由stub净化，仅证路由映射。可靠事件ID按会话完整保留是明确设计，不新增FIFO要求；局部旧schema重建不证明所有历史schema。canonical恢复、状态保存失败用例不关闭既有非规范身份或replaceRules第二次保存发现。VM/eval/SQL trigger、真实loopback runtime与模拟12/24/168小时/50000消息均只读配方，0执行/新PASS/新支持正文，无新候选。

第三百六十八批19份服务器礼物/展示e2e原始全文5018物理行/5037 helper、46块，9份overlay与10份礼物/管理分析/主播统计布局。完整mock snapshot/活动与名称历史/身份哈希、未知分类/日期/来源、图表独立范围与请求代次、分页缓存/失败保留、图片fallback、双语/窄屏及弹层切换/减少动态、SSE429重试/pagehide、剪贴板降级/拒绝重试、各展示样式身份/文本/表情/SC/期限和像素截图配方逐读。overlay-preview包含真实Express loopback与finally关闭逻辑，仍未执行；local asset/CDN fulfillment、fake EventSource/clock与选定尺寸不等于当前网络/字体/原生触摸/legacy CEF/桌面像素或tenant鉴权验收。SC子卡断言不证明F-042外层已修复；图表或样式断言不关闭D-013。旧312的starveil/sketch仅文件名搜索，以及同名Node测试/生产owner/PASS均不借目标FULL。0fixture/owner/规范正文扩读，0运行/新候选。

第三百六十九批75份客户端静态SVG原始全文1146物理行/1170 helper、257825bytes、85个唯一可见原文块：world-clock星图1、花笺45、礼物3、雾爪1、Twitter预览1、ranked锚1、雪狐7、spooky12、绘画光标2、加班素材2。父32份407物理行/35块与子43份739物理行/50块互不重叠，原75清单未变，摘要和全文范围闭合后一次登记；51份无末换行，只有24个合成末空helper。花笺纸片top/middle/bottom、独立渐变/pattern/clip、舰长/提督/总督及其他heart/leaf/anchor/postmark全部复合transform与长path原串可见；数千字符的spooky-web路径及四份独立portrait配色均原文审阅，最长alert-web单行8670字符。SVG本地片段引用、静态几何和注释里的来源URL分别处理，未见可新增的活动/外部引用问题；未访问来源URL或做XML/path解析、alpha/接缝/几何/渲染/版权与真实性认证。四块读输出在上下文截断时未可见，已保留丢失见证并精确重读，89次实际调用仅85块可见唯一范围授予证据，不双计文件/行。历史广域导航截断不作全文证据；聚焦回查291SERVER素材、320SERVER Ripploid CSS、330SERVER素材与当前CLIENT public/img不同，不借同名FULL，也不把173unknown当never-read。0新支持/规范正文、运行或候选。

第三百七十二批36份客户端HTML原始全文4012物理行/4048 helper、48个唯一可见块。AI provider/授权/工具/persona、弹幕发送/固定/欢迎/每日/PK、更新/性能/特效/开场、使用指南各topic、组件预览与danmaku/games/lyric/scene输出文档均含完整SVG/path/字符串原文；fragment/include和另读目标各自归属，不从入口引用借全文。347答谢指南只是搜索，187根指南/search全文不代topic，82Admin games不同于当前overlay games。初次replies99helper输出048d72中段外层截断不计正文，经1–50/51–98两块可见补齐，49次reader仅48块唯一归属。指南reference账号联网分类及FAQ组件按钮与当前本机owner矛盾，父376确认D-014；legacy预览按钮和场景结构发布为反证，其他运行/诊断/删除/登录/导入步骤仅作为文字审阅未执行。0新F/新支持正文，旧三份FULL399行上下文与父支持去重计，不新增触及。

第三百七十三批34份客户端cloud-sync/server/settings/shared/music/lyrics/wesing测试原始全文8146物理行/8180 helper、74块。账号/room归属与mutationId迟到回执/待同步恢复、429/定时/SSE队列/失效、外部歌词provider/时长/播放源代次、QQ/网易监控子进程重试与watchdog、safeStorage快照/分区/URL/token投影、运行资源借用/停止/health proof、日志脱敏/回环深对象、欢迎IPC降级/字段边界、K歌缓存/QRC/进度/录制/诊断/清理逐读。完整PowerShell/XML/SQL/VM/child配方不执行；同签名库oracle只证接线，safeStorage替身不证OS加密，原生脚本regex不证真实播放器，假时间倒退不当单调播放事实。server-smoke单case env未显式恢复但文件进程与后续显式目录限制所能证明的影响，无具体产品缺陷不升级。0owner/fixture/规范正文扩读、0运行/新候选。

第三百七十四批20份服务器游戏e2e/Node测试及七helper原始全文8845物理行/8865 helper、71块。九spec覆盖盲盒预载/展示/模拟、管理数据流、名望、六游戏重置/离线、契约及两版treasure合成；逐读完整IndexedDB/存档迁移/配额rollback/跨页锁、长按/取消/余额/保底/北京时间/隔离、焦点/有限视口/像素/CDP/截图/离线配方。七主helper为e2e38物理行与test/support635行，共673只计主范围一次；四Node测试还包括blindbox存储、两类文档治理、mascot合成DOM/RAF。RGB三通道不认证所有透明合成对比度，稳定节点数不证全部内存生命周期，文字/正则文档治理不证语义和真实权限。旧174 spirit/treasure及240 HTTP/song snapshot只引用，生产owner/PASS不借本组FULL。isolation-probe完整嵌套-e/activation/DB/backup字符串仍未运行，不重试125eval/72删除。0新支持/规范正文、运行或候选。

第三百七十五批44份客户端素材声明原始全文610物理行/643 helper、95204bytes、48块，39JSON与5SVG，11份无末换行、33末空helper。窗光完整v6斜视与保留v5窗帘prompt/1920×1080合成/四场景四receiver，纸鹤12项新旧silk/loop/flag/用户参考/atlas记录，月色brush/scroll/徽章/landscape配方、harbor/notebook/guard/API来源、五礼物预览映射、woodland四长prompt、nautical三动图摘要/帧数、queue四代配色/尺寸及gift-wish预览/主体分别按实际字段审阅；所有长prompt与本地SVG gradient/use/path原串可见。生成指令是数据未执行；provider/request/sourceSHA/尺寸/alpha/帧数/来源作者与“无损/像素保留”均是声明，未访问URL或打开图像、archive、生成器、decoder/renderer/许可来源认证。旧291/298/320SERVER路径与248包装脚本不借CLIENT素材全文；宽导航截断无正文信用，聚焦六条历史命中后再全读当前44，0新F/支持正文/运行。

第三百七十八批47份客户端礼物/overlay测试原始全文9880物理行/9927 helper、92个完整可见块。礼物身份/类别与签名快照、ETag304/定时/图像补全与停止代次、统计/愿望/保留/原子导入/撤回receipt迁移、remote SSE重连和游标追赶、礼物框/特效队列/GL资源释放、guard感谢/背景/开场/页面翻页/共享token/文本滚动，以及overlay HTTP/WS先后与drawing/lyrics空状态逐读。完整SQL/VM/eval/浏览器/CSSOM/PNG/截图/字体/媒体/Blob配方不执行；有限fake几何、同构签名oracle、资源集合或普通文本escape替身不认证真实GPU/性能/权限/XSS/崩溃原子性。来源pin不运行、不绕过，318 opening-style只引用，108其他测试/服务器同名/生产owner不借FULL。2369/2634宽命中导航未全部显示，实际只核对67精确scope、14叙述、27选定grouped及1–25补充；回查不足不称never-read。47份前后/当前/原始摘要及92块逐行witness一致，0额外支持正文/新候选/运行。

第三百七十九批34份客户端弹幕/Admin/UI/bot测试原始全文9069物理行/9103 helper、60个完整可见块。组件预览/草稿/保存代次与授权替身、侧栏偏好、Bilibili连接/心跳/回退/缓存、当前房间与legacy消息身份/SC/礼物、固定/随机feed/本机预览/快照稳定、参数/外观/IPC、调色器/采样/范围/EventBus/复制/Toast/字体与基础控件逐读；fake尺寸/样式regex、内存事务、模拟token、SourceTextModule/Chromium配方保持源级边界，不关闭真实native输入/scene集成/F-042/D-013/跨端pin失败。renderer511–680的9237e9中段和681–818的69fa3f整个text项丢失，各授0信用，经511–595、596–680、681–817三个可见块补齐；62次reader仅60块唯一正文。admin-danmaku-markup79旧server-owned注释仅D-014相关文字，80–83约束工具组合层，不证明远端保存；不另新增F/D或重读owner。34份原始/前后摘要一致，0额外支持正文/运行。

第三百八十批50份客户端工程/fixture/helper/播放/点歌测试原始全文9087物理行/9137 helper、90块。asar完整性与事件循环、pinned danmaku、ESM静态边界/脱敏/签名及Authenticode subject、文档/路由/架构结构断言、Electron字体/每日bot/guard/Doubao/资源/桌面overlay/媒体探针、AI/OIDC/同步/remotegift/IPC/路由/ESM bundle等25份主fixture/helper，以及播放drawer/flush/快照writer高水位/迟到回执/卸载、队列SC undo/滚动/主题/响应式、随机点歌/输入补全/别名/存储事务逐读。25份指定fixture/helper计主范围一次，无额外支持正文；旧62 shutdown harness只有无数值范围partial，不臆扣旧重叠，当前完整1–527另有证据。签名/PowerShell/证书/归档/VM/native probe/SQLite/临时清理/HTTP等均为未执行配方；静态文档10旧PASS不等于语义正确或修复D-014，107条grouped元数据外层丢失后完整重显，不借导航作正文。50份原始/前后摘要一致，0新候选/运行。

第三百八十一批22份服务器礼物/口令JSON夹具原始全文7680物理行/7702 helper、249003bytes、39块。两套完整历史概率表/锁定0/5.5档/别名与八池恢复、Bozai完整API样本、GGBond只截图成员声明/失败官方pool返回、灵珑/源初/共振/星石配置及完整嵌入JS/HTML、同ID改名/展示界限/同特效而不同身份、九项room增量/元数据42映射/三规则页、中秋/国庆含组合奖励/修仙，以及28条合成口令的Unicode/字节/弱口令/控制字符/旧账号兼容向量逐读。捕获的roomID不是授权边界，HTTP200/PNG140×140/verified与SHA只是历史数据；脚本/HTML不执行、不解析产品输入、不联网/OCR/解码/算收益或认证实时概率。调用方222–292另重检71行：旧梦幻夏日两个34968按名称明确映射34982/34988，不能由fixture错误ID直接推成产品缺陷。复用同SHA旧211概率482、336星石226、199源初472，共1180行上下文；71行完全落在旧FULL，0新增触及/闭合。170国庆fixture实为metadataOnly，194/199/290引用和247不同protocol路径不借FULL；22原始/前后摘要一致，0新F/D/运行，七份大型seed-refresh快照另留待审。

第三百八十四批服务器10-03刷新夹具完成限定业务字段与有序结构语义，源61135物理行/61136 helper、2360448bytes只作尺寸。实际原文1–100共100行，另61个完整可见语义块/4335显示行覆盖20roots、77有序schema、131完整重复payload，以及342 before/342 changedFields/565 identities/184 PNG/287 rawCompletion和全部小组。6401字符串中2279完整literal可见，1507 CDN URL按scheme/host/path-template/query/suffix及逐S映射审读，2615 scalar摘要/variant token原字面量只作metadata。H组件等异映射未人工读，不授正文信用。独立有序typed检查拒绝重复键、保留数字lexeme并核对55003节点；首次五个父容器frame遗漏在原文/业务值未变的情况下，经98e298五行实际读后再通过，首失败日志保留，不计产品FAIL。条件特效与默认/数量门槛、两条归档身份、13个冲突、25条未授权第三方历史文本和9个保留图差均实际对应记录，未把候选/verified/来源描述当实时事实。测试1–70/303–453共221行只重检旧336 FULL；规范1947–1992另46行PARTIAL。原始/前后/current摘要一致，0新F/D/产品执行。

第三百八十五批服务器10-01刷新夹具由子代理保守声明PARTIAL字面量；父单列裁定“完整业务语义＋opaque字面量仅自动”的限定SEMANTIC_FULL，证据见fixture-business-semantic-adjudication-385-stage-388.json。源44567物理行不当RAW；实际header69行/3块与business-view3035行/18块覆盖1016身份、781 PNG、869 MP4、325 layout、8 deferred、20完整几何字典、所有变更与1400 liveCatalog ID数组。该manifest没有50列上游raw礼物或name/price/currency/bag值，不从rawFieldCount50声明虚构缺失字段。严格opaque仅明确SHA64/MD532字段、variantId GV64及三个已显示媒体前缀下32/40/64hex文件名，保留身份/媒体相等与不同映射；9119原opaque值只在manifest自动保留。3329对象/29501键无重复，16211原数字均安全整数，2991 compact行反解析与有序重建仅为表示反证，不替代实际阅读或认证HTTP206/200、PNG/MP4/layout数据。阅读顺序不同于行号顺序，父初次连续性假设在写入前失败；按真实区间并集核对，保留原阅读顺序和失败记录后成功登记一次。原始/前后摘要一致，旧336消费者600行仅复用，0新RAW/支持/规范正文、F/D或执行。

第三百八十六批服务器09-09/09-16/09-26/10-13/10-14五份刷新夹具完成同样限定SEMANTIC_FULL，源35353物理行/35358 helper、1028178bytes不折算新RAW；实际完整1800行/19块有序token投影，含72字段shape、439完整非opaque scalar、147重复子树定义及1061顶层数组记录。每条原字段/数组成员/缺失与null/币种/价格/背包/时间/嵌套效果几何均映射，所有URL与variantID完整literal可见；1267处摘要以942稳定role alias单列，SHA787/MD5435/CRC3245格式0异常只算metadata。原始token逐字重建证明表示未漏字段，不认证真实媒体。20008 UNTRUSTED_URL保留effect:null、34345仅旧只读catalog来源、31575失败MIME候选与已接受图片分开、35257保留旧图/效果、10-13与10-14未提供的raw/name/price值不臆造、7项不可取效果不借相邻身份。五份原始/前后摘要一致，旧336两测试817行上下文复用且不新执行；现行SERVER规范1879–1944另读66行PARTIAL，无新原文主行/F/D/产品执行。

第三百八十七批客户端src/electron/main.js、remote-gift-controller.js、cloud-sync-controller.js按精确缺口累计闭合RAW FULL：925/804/656物理行，共2385/2388 helper；新读842/599/593共2034物理行、19完整可见块，复用旧62/80/115/131及40/118/143的351个明确原文行，115主入口582–591已包含在131579–592，不重复计。旧范围的摘要依据是对应完整全局检查与原始一致，保留非逐瞬时read-hash限制；当前前后原始SHA一致。主入口启动/账号恢复/IPC/权限委托/单次退出promise/5秒截止/控制器drain/播放flush，remote gift的owner/epoch/projection fence、history游标/retention/legacy分支、SSE/即时final/重建和取消，cloud的账号scope/dirty generation/mutation回执/429/SSE/批次合并/凭据session revision与stop/dispose逐读。组合接线不替代各owner内部校验，sandbox:false的既有配置不据此直接另判漏洞，whenIdle也不当真实socket/OS资源清理验收。0新触及、支持正文、F/D或运行。

本轮另建root-extent-reconciliation-387导航，将原173的历史绑定声明与174–382共150份实际scope对象记录并列，保留指针、原范围、摘要和见证强弱；原173索引未改，解析导航新增人工信用0。1930路径有提取到的历史FULL声明、1623缺少该类绑定提取声明；后者不等于未读，尤其未结构化prose/分组叙述/旧局部并集仍需回查。本轮3实际累计原文闭合与7限定语义独立记录后，导航不确定项为1613；不能用这个数包装全审完成或直接安排机械重读。stage-388-metadata-preparation-recovery.json保存父端385乱序投影和bytes/sourceBytes schema假设失败，以及无scope时registrar先于mark退出的日志；只修正自有metadata后登记，没有绕过hash guard、重建baseline或将元数据失败伪装为产品修复。提示词第12条将限定语义与实际阅读计量规则持久化。

第三百九十批客户端src/electron/license/固定19份授权owner，完整2718物理行/2737 helper＝新读1693行、14个完整可见RAW块＋旧1025行。11份旧FULL共683行由master132/366的6/25批明确短名与计数声明、精确scope路径和旧全局3553无变更证据恢复；不因冻结173未提取声明而重读。6份新整份为manager703、device-key128、error81、activation77、state63、token75行，另补operations278行与remote288行，分别复用177/165旧局部累计闭合。manager四块实际阅读次序1–175、351–525、176–350、526–703保留，排序仅用于区间并集核对。密钥恢复/bootstrap、单飞续期/每等待者取消、身份与expected-token fence、重试/blocked状态、受限远程调用和不泄漏凭据的投影按owner阅读；没有执行safeStorage、硬件指纹、网络/SSE或授权验收，F-005不关闭。

第三百九十一批客户端src/music/固定43份后端owner，完整7631物理行/7674 helper＝新读2813行、42个完整可见RAW块＋旧4818行。27份旧FULL3959行从6/35/50/60/63/97等批明确声明和历史SHA绑定恢复；其余8份新整份、8份累计闭合，旧精确局部859行来自60/98/68/90/165/97/255/277等记录。早期9批“关键链含尾段”不够明确，不升级为旧FULL，也不称从未阅读；277 QQ provider保留自身SHA见证，其他旧全局检查不伪装成逐read即时hash。逐读provider请求/分页/登录与liked-load session、歌词来源/时间轴、缓存/队列/导入规则、捕获engine代次与停止、嵌入式C#/PowerShell的PID/SMTC/UIA/音频样本及回收。QQ鉴权全列表本地切片反证与网易F-010分开；engine的refreshVersion/active/title fence不修复前端F-012/F-013。16份旧373测试3917行当前同SHA，仅复用源码断言上下文，无当前PASS、原生播放器、真实账号或协议签名执行。父审阅说明丢失的225行已分六块实际恢复，子代理42块业务原文未丢失。

第三百九十二批服务器8份基础owner，完整1817物理行/1825 helper＝新读196行、2块＋旧1621行。6份旧全文1596行来自8/32/34批的app、server-lifecycle、admin-public-origin、device-verify-request、gift-history-page-token与identity-db明确声明；app的helper598末项为空，实际597行。account-namespace复用262批1–25，补26–114共89行；263批1–16仅后采样且完全重叠，不增加旧行数。src/lib/crypto.js的1–107行原文完整可见，只审HMAC/密钥类型/签名比较及损坏输入路径，不执行加密。请求/授权接线、关闭职责和命名空间迁移计划不等于跨数据库原子性、真实TLS/部署或当前认证验收；子记录含糊的F-004指代未沿用，现F-004仍是客户端加班规则保存一致性问题。无SERVER模块导入、配置/.env或数据库打开。

第三百九十三批客户端src/storage/固定6份迁移/清理owner，完整1359物理行/1365 helper＝新读555行、8块＋旧804行。master730明确54批四份清理owner全文、master792明确62批data-directory-migration全文，结合精确scope路径与54/62全局3553无变更恢复5份旧FULL735行。database-migrations实际624行：复用56批29–45/148–164、116批86–106、113批328–341共69行；116的334–339已包含其中，0额外计数。113/116没有独立快照，明确采用之后118完整无变更快照的间接SHA见证，49批笼统叙述不够精确不晋级。实际补读1–28、46–85、107–147、165–245、246–327、342–435、436–529、530–624。歌曲v1–17、SC v1–2、礼物v1–20、音乐/签到及ensure/collapse/exports的DDL、表复制、默认值/唯一约束、外键解离和source-scoped触发器按现有职责核对；动态SQL标识符来自内部固定调用，不据此虚构注入。无真实迁移、SQL执行、持久化或导入验收。

第三百九十四批合并上述76份范围，仅登记已触及路径的新lens，0新增原始触及。49份旧FULL复用6973行、15份新整份与12份累计闭合的新增RAW合计5257行/66块，旧局部1295行；完整尺寸13525行不能冒充本轮新读。各组无新增可确认候选，旧44F/D-014未修、D-013待验。辅助historical-owner-navigation-stage-394只回收≤173早期master的明确声明候选、唯一路径/helper映射与反例；不直接授源码FULL、不修改原173或把1537导航不确定项当未读清单。原文输出、范围、离散SHA、实际次序与复用见证分别留档；所有审计元数据检查都不增加产品PASS。

第三百九十六批客户端src/ai/固定23份，完整4096物理行/4119 helper＝新读442行、4个完整可见RAW块＋旧3654行。18个394导航候选逐条回查master47/145/560后恢复；另config.js的AI同lens“config（全部）”与独立列举的config-store“分段全部”消歧，结合唯一精确路径/./config调用与4批3553无变化记录，恢复第19旧FULL，合计3598旧全文行。4/7没有canonical scope文件，明确保留缺失和同批全局SHA非逐块即时见证限制。新整份model-endpoint135、amap-tool181、web-search-tool85共401行，HTTP helper补35–75共41行并复用41批1–34/76–97共56行累计闭合；98末helper不计源码。端点推导/账号模式与能力描述、HTTP取消/超时和响应错误、地图配额/地名与路线参数、RSS数量和实体解码按owner阅读，不从纯URL构造层虚构额外权限契约。RSS先amp后numeric仍是F-002根因，没有新编号或重跑；模型遵循性、真实上游协议/配额和取消运行未验收。所有前后原始SHA一致，0新触及/支持正文/规范正文/执行。

第三百九十七批服务器6份授权/管理路由，完整1746物理行/1752 helper＝新读720行、12块＋旧1026行。master175的9批admin切片0..125/120..340/339..503已覆盖当前1–502物理行，零起点和helper503不算额外源码；master428的30批device-daily-bots98明确全文，对应97物理行。两旧FULL599行由9/30批原3553无差异快照间接绑定。其余旧精确partial427行（Device193、Streamer234），Streamer恢复旧25的236–274并入并集，旧262/278仅后采样、263前后采样边界各自保留。新整份admin-auth57/streamer-auth79保留先限流、指定principal/cookie公共投影与既有F-001登录parser路径；Device补298、Streamer补286，按req.device.streamer_id/req.streamer.id带scope，SSE连接身份清理、query取消、multipart afterBody重新认证、QR poll写授权委托均按实际调用审阅。路由read admission不泛化为全部异步后授权保证，也不替代各领域owner全文。C262排除不复活，旧F-004比喻不变成identityDB finding。旧290/342两份当前同SHA测试611行仅断言上下文，无fresh正文或执行。无新增候选、触及或运行。

第三百九十八批服务器public/site固定8份，完整2974物理行/2982 helper＝新读711行、11个RAW块（5次实际输出）＋旧2263行。111批明确site390/feature-recordings34/theme-init12全文，122批明确hero-mascot JS1053与CSS535连续RAW FULL，原111/后123全3553无差异提供间接SHA；5旧全文共2019物理行，CSS535由精确scope/path/helper与responsive231区分，非借JS或导航授全文。index复用旧111的1–38/422–473和122的65–85共111行，补362；public-shell复用136四段79行，补173；responsive复用122188–221与33055–74共54行，补176，33020行另有明确逐文件摘要/见证。原文包含HTML内联SVG全部d/transform/gradient/clip引用，名称/locale/主题/recording属性、公共壳层/焦点/响应与reduced-motion/forced-colors按所属职责审阅；没有实际媒体、浏览器、视口几何或像素验收。site.js的F-024仍未修，旧20PASS不关闭它。所有前后SHA同原始，0新触及/候选/支持正文/规范正文/执行。

第三百九十九批根代理弹幕CSS固定4份：原始base365/366helper与preview93/94累计闭合，当前sketch291/292累计RAW闭合、twitter783/784旧RAW FULL复用。base旧134的134–170/280–322与151的109–167/255–325去重为[109–170,255–325]共133物理行，补1–108/171–254/326–365共232；preview旧1341–60共60，补61–93共33。旧134全3553排除此target变化，151支持范围由后154完整3553中该target未变化作间接SHA见证，不虚构旧即时read hash。共享透明根、token/header/feed/item方向与fit、avatar/emote/custom font/text specificity，以及预览选区pointer/touch/focus/8向handle、canvas-fit反缩放、窄布局/component-preview声明按原文审阅。无具体新增候选，不要求每个主题重复共享规则；source-only不代表实际密集播放、桌面保存、OBS或哔哩哔哩直播姬验收。

sketch当前SHA44d6077cca5259a6ee9cab80e1874b584d1a7eab10c51fa2d7ac9580fc4aeffa与151原始snapshot及旧before/after manifest一致。151实际读normalized display1–291，其中仅274–281/285九行与原文不同，其余282行逐字一致。本轮九条percent-encoded SVG原文分三块实际完整可见a690fa/72c86b/90b478，含swirl/stars/ear/tiny-rabbits/vine/cats/crystal/rabbit/foliage的viewBox、stroke/fill、路径和同文档petals mask引用；故最新当前版本可记录累计RAW FULL。没有重做URL/XML解析、图像/几何/视觉认证，也不把151规范化阅读倒改成旧RAW。twitter当前同151 SHAad8836a332fce4c4a37d31e94a4782b11563767050ee395283a26f7d54de500c，只复用旧783行，fresh0；当前两个版本都不登记为原始摘要触及。根端新265原始＋9当前共274行、7块；准备内联元数据脚本a4f0eb在编译前报语法错误，未执行或写入，改用格式化脚本8b4427；准确source正文没有丢失或重放。

第四百批合并39份原始范围与两份当前修订：原始26旧FULL6216行、5新整份和8累计闭合，合计9274物理行，实际新2138/旧7136；加当前sketch新9/旧282与twitter旧783，共41份10348物理行/10389 helper，实际新2147行、34块。current-revision-overlay-stage-400.json在原153历史19RAW＋1normalized不变的前提下记录最新20份当前RAW，原3553coverage不强行晋级，既有15项原始未标触及仍由独立当前版本证据覆盖。原声明导航1498不确定项不等于未读，两份当前版本另列并在后续路由排除自动重读。旧515导航未批量授FULL，26旧全文均经确切声明/路径/lens/摘要回收，父完整审阅三份交付并额外核对AI config原句。0新F/D/触及/产品执行；44F/D-014未修、D-013待验及全部旧失败/拒绝边界不变。

第173批另建保守逐文件证据索引：从328份既有元数据中保留1071条带来源指针的记录，原分母中431份有原始全文声明及分级摘要见证、7份有完整结构化语义声明；这些是已提取的历史证据类别，不是全部实际阅读总数或当前完成认证。全文声明的见证包括同阶段摘要与后续全局快照间接见证，7条未绑定全文声明不晋级。1211项代码源文件证据缺口中1014项已经触及，先回查旧范围而非自动安排重读；未知不等于从未阅读。20项当前变更中19项原始全文与1项sketch规范化声明仍分开。主代理正反对照确认局部HTML、仅自动解析的盲盒数据不会变成全文；索引自检和元数据核验不增加业务测试或人工文件计数。

| 批次 | 已追踪内容 | 尚缺范围 |
| --- | --- | --- |
| 信任入口 | Device/Admin/Streamer 认证、请求解析、撤销、SSE、激活与候选密钥、续期/桌面就绪恢复、桌面请求头与 IPC sender、账号命名空间/数据库约束、管理员改密、主播管理写入和设备管理/查询主要链 | 所有路由逐项参数表、全部授权错误组合、其他窗口/协议及其余管理服务 |
| 同步与数据 | settings/songs 同步队列、账号 fence、凭据提交、租户连接租约、查询 worker、礼物清空/保留/恢复、备份发布、播放快照版本、礼物投影/游标事务与加班结算、点歌队列、粉丝导入/投影、每日机器人持久化、动态抽奖核心、许愿计数、醒目留言删除/撤回/撤销、舰长到期查询账号与完整分页发布、组件草稿/批量保存与场景发布事务 | 所有迁移和恢复组合、粉丝各类资料操作、其余前后端保存链与错误组合；已触及模块仍非全角度完成 |
| 礼物目录 | 活动及规则文本发现、固定来源与配置家族、礼物身份匹配、公共字段、失败退避、同步编排、底层发布事务、特效选择与布局、主来源适配和素材清单、客户端目录校验/缓存/身份合并及图片下载回退 | 其余查询/呈现/账号与资产维护链；上游真实活动与资料完整性未验收 |
| 机器人与游戏 | 发送调度的容量/截止/取消、每日结果与词库及前端编辑、导入重试/回收、固定/定时回复与编辑、欢迎/回访及参数/词库/用户文案界面、开播问候/房间变更、PK 采样/播报/历史与房间观察、答谢模板/分组/金额与冻结发送、小游戏/绘画/投票评分/转盘核心、服务器星座/航线/唤灵/成名/秘宝/宝斋/工坊核心与对应 view/记录入口、盲盒播放/媒体/舞台/虚拟历史 | 其余上游适配、其他生产者与剩余界面链、游戏样式/素材数据与尚未验收的交互；真实发送与账号未验收，已执行部分隔离浏览器测试，非所有 UI 验收完成 |
| 弹幕与身份 | 客户端 WebSocket/重连、发送服务及批次入口、去重、消息分派、用户身份合并/投影、历史/在线榜/粉丝牌轮询、缓冲和实时就绪判定 | 其余上游解析与账号集成、界面和异常组合；没有完成真实平台长时在线验收 |
| AI 与数据解析 | 工具 HTTP/配额/有序协调、RSS、地图/天气入口、助手完整生成/交付流程、模型适配、OAuth 与账号会话、对话历史、配置和诊断日志、人格/提示规则及设置保存主要链 | 其余工具与错误解析细节、前端账号操作链和展示；真实上游账号、模型行为与兼容性未验收 |
| 播放与原生 | 原生输出 renderer/main/IPC、C# 输入/输出/DSP/路由恢复、播放快照存取/恢复、收藏/歌单持久化、迁移注册与音乐 DDL、歌词解析/缓存/时间轴/来源仲裁、QQ/网易云 Provider 与前端首页加载/账号缓存、播放器组合根/事件/播放与流重试/队列/账号操作/歌词交付、导入/匹配/搜索/首页和歌单动作、缓存/渲染协调/播放条/队列/抽屉、全屏歌词/定位/外观、本地文件重选、输出设备/变速、Provider 状态与 WeSing 设置/诊断 | 实际设备与驱动、其余音源适配、完整视觉交互链、全部迁移 owner、原生构建验收；私有账号协议未验收 |
| 页面与工程 | 全量静态依赖、命名导出、JSON、部分素材 sandbox、场景接收/缓冲/渲染、画布编辑/发布/恢复及预览通信关键链、素材导入/备份/清理后端与上传入口、服务器外观配置/过滤/观众查询、歌曲页背景及外观前后端关键链、歌曲/歌手虚拟列表与复制操作、公共游戏外壳/盲盒存档、礼物审计/盲盒分析/历史选择与导出预览/展示设置主要链、安装数据保留与进程检查、两端验证范围/结果/缓存、打包依赖与发布编排、原生构建入口和部分备份/日志配置 | 其余页面/样式、素材库其余界面与异常组合、游戏样式/素材语义及未执行的媒体交互、其余维护/诊断/生成工具与部署配置完整复查；打包、安装、签名和部署只做静态或替身检查，未实际执行 |

新增确认条目按根因计数：F-001（依赖与入口）、F-002（解码语义）、F-003（异步取消）、F-004（保存事务与通知一致性）、F-005（跨模块续期与恢复状态机）、F-006（消费者字段投影丢失）、F-007（规范化结果与恢复值不一致）、F-008（屏蔽键结构校验缺失）、F-009（自动发送批次归属缺失）、F-010（上游分页参数语义与完成判定）、F-011（并发响应与背景预览归属）、F-012（同曲歌词加载结果归属）、F-013（旧保存确认擦除新草稿）、F-014（操作后列表被旧轮询覆盖）、F-015（JSON 身份元数据被当作未知降级）、F-016（媒体/预设成组设置分条提交）、F-017（媒体授权清单写入失败后的重试不再持久化）、F-018（工作表选择误用 ZIP 条目顺序）、F-019（旧默认清理重复删除当前用户文案）、F-020（冲突处理的迟到回包重开已离开的档案）、F-021（菜单搜索回车误提交发码或主题保存表单）、F-022（ISO 时间被数值转换而不显示）、F-023（同一密钥提交后的模型查询及候选身份失配）、F-024（同页历史导航后语言应用不同步）、F-025（可选启动命令异步失败未降级）、F-026（实时规则重建后重新选择目标失效）、F-027（同账号重登后旧读取污染保存绑定）、F-028（设置广播擦除在途保存后的歌词偏好）、F-029（恢复默认误改保存基线而提交空补丁）、F-030（盲盒旧保存确认清除新草稿）、F-031（无凭据场景子页误走独立资料读取）、F-032（合法长时长超出控件后无法往返保存）、F-033（无关编辑重解析回拨重复时刻的原到期时间）、F-034（词条按钮删除未更新保存反馈）、F-035（放弃后旧图片上传重建草稿）、F-036（码点限额误用原生UTF-16输入上限）、F-037（存储特效假值跳过目录完整性拒绝）、F-038（指定镜头重新选择暂缓截图项）、F-039（浏览器启动失败绕过补图监听清理）、F-040（相对日期样例导致今天验收假失败）、F-041（旧媒体播放拒绝回调访问可变当前元素）、F-042（普通气泡自定义背景越过独立SC外壳隔离）、F-043（月渡显式空文案在组合层被默认值替换）、F-044（扩展城市目录错误时区经正常选城用于时间显示）。尚无一轮满足全量人工覆盖标准，因此不把本阶段包装成多轮全量完成。

## 测试与文档同步影响

本审计只更新方法、报告与临时覆盖/证据记录，未修改业务实现、现有测试断言、现行技术契约或用户操作。已有测试按实际范围执行；已确认问题的新增覆盖建议及文档漂移随条目记录，留给对应修复任务，不能用审计报告替代现行规范。工作区另有并行弹幕实现、测试和指南修改，20项原摘要失效部分已按当前摘要单列复核；不据此覆盖旧失败，也不冒称真实桌面保存、直播或推流应用验收完成。

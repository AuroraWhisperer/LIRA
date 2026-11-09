# LIRA 持续只读审计记录

日期：2026-11-05。基线：`cc9c4c74c385dbfb269d16bb97b2777701d50091`，LIRA 6.0.1；初始工作区干净。用户明确仅审计和提出修复建议，并要求避免过度审计。方法见[提示词](2026-11-05-continuous-audit-prompt.md)，本次基线完成记录见[计划](../../specs/plans/archive/2026-11-05-continuous-audit.md)。

后续修复：用户随后授权复核并行修复，19 项均确认成立，修复与回归见[修复记录](../../specs/plans/archive/2026-11-05-audit-remediation.md)。下文“未修复”及测试数字保留审计收束时的历史状态，不代表当前代码。

## 范围与证据边界

本轮以客户端维护中实现为主，按实际调用检查服务器契约。尚未完成全仓覆盖，不把旧报告、扫描清单、通过的测试或子代理摘要当作逐文件完整审计。生产账户、用户数据、在线服务、实际声卡和正式安装升级不在隔离复现中使用。

历史 10 月 29 日审计的 F-001—F-044 已有 10 月 31 日修复记录；只在当前代码重现且有新证据时重开。原始证据当时保存于 `tmp/continuous-audit-2026-11-05/`，不是需随产品打包的内容。2026-11-09 核对时，本报告引用的该目录附件已不在当前工作区；下文保留证据名称与原路径供追溯，不再提供失效链接，也不表示本次重新验证了历史结果。

## 累计结论（截至第八批，当前基线收束）

累计确认 19 项：14 项 P2、5 项 P3。第一批 6 项，第二批新增 5 项，第三批新增 3 项，第四批新增 1 项，第五批新增 2 项，第六批无新增，第七批新增字体失败恢复缺口，第八批新增歌曲菜单关闭后的临时监听累积；“新确认”不等于由最近版本引入。第八批还补齐实时恢复、批量播放和真实 HTTP 背压/中止的反证。优先级按现实触发前提和影响评估，不把本地导入或更换服务器的问题描述成互联网任意远程攻击。主代理复核了各项 owner、调用与复现脚本/结果；分区复现由相应代理执行，PERF-01/02、DATA-05 和 CACHE-O1 由主代理执行。所有发现均未修复。第三批安全分区被平台中止的候选未计入发现或完成覆盖，后续没有继续该检查。

本次基线审计在第八批收束：已有发现、反证、修复顺序和证据边界足以交付，不为凑轮次继续扩大样本、堆测试或把低影响风格偏好升级为问题。后续以相关代码变化、实际故障/性能反馈或明确高影响线索触发增量续审；未检查范围保持未知，不宣称全仓无漏洞。

| 建议顺序 | ID | 优先级 | 问题与影响 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | DATA-04 | P2 | 特定旧 SC 记录因金额未参与去重而被遗漏，迁移成功后源表被删除 | 真实入库/迁移 owner、双内存 SQLite |
| 2 | SEC-01 | P2 | HTML/CSS 选文件会静默扩大读取目录，将未选择的文件复制到公开素材路径 | 生产 HTTP 分派到导入再到匿名读取的隔离复现 |
| 3 | FRONT-04 | P2 | 确认删除 AI 预设 A 后，等待期间切换编辑对象会实际删除 B | 真实 UI 模块与配置 owner、内存 SQLite |
| 4 | SEC-03 | P2 | 同一安装更换服务器后，同编号账号继承旧抽奖登录与活动 | 独立授权实例、重启形态及隔离 SQLite |
| 5 | DATA-03 | P2 | 档案互换 UID 后，合法完整备份预览通过却恢复失败 | 真实服务/存储、内存 SQLite 和五种对照 |
| 6 | DATA-05 | P2 | 保留期清理后的北京时间归档桶使其它本机时区的单日盲盒统计错位 | 真实暂存/激活/清理/查询、三个时区前后对照 |
| 7 | FRONT-03 | P2 | 迟到的备份预览替换正在编辑的新档案，丢失未保存草稿 | 真实前端入口、延迟文件读取/IPC 与合成 DOM |
| 8 | FRONT-05 | P2 | 编辑日程后取消删除确认，会重填旧值并丢失草稿 | 真实 planner/确认模块、合成 DOM/存储 |
| 9 | FRONT-06 | P2 | 删除另一条许愿成功后，共用回调清空当前许愿的未保存草稿 | 真实编辑/请求模块、合成 DOM 和四个场景 |
| 10 | SEC-02 | P2 | 素材解析的近似匹配失败输入引起近平方计算，阻塞同线程服务 | 完整导入 owner 的输入规模对照与子进程超时 |
| 11 | PERF-01 | P2 | 缺单字时间戳的长歌词触发近平方扫描，100 KB 可阻塞约 2.6 秒 | 真实歌词 handler、限时子进程与等长合法输入 |
| 12 | PERF-02 | P2 | 合法多时间戳歌词展开为巨大输出，约 45 KB 输入产生约 46 MB 响应 | 真实解析/序列化及 Provider、规模与等长对照 |
| 13 | DATA-01 | P2 | 图片替换重试同步休眠，单文件可暂停桌面主线程约 500 ms | 合成文件锁、真实缓存模块及定时器延迟 |
| 14 | FRONT-01 | P2 | 过期歌单持久缓存跨重启不回收，挤占同源存储配额 | 真实缓存模块、合成时钟和配额 |
| 15 | FRONT-02 | P3 | 并发保存的旧回执让已保存的新设置重新显示未保存 | 真实设置 owner、逆序回执及广播夹具 |
| 16 | DATA-02 | P3 | raw_json 统计把字符数当字节数，低报中文报文体积 | 真实接口 handler、内存 SQLite |
| 17 | FRONT-07 | P3 | 复制文本框地址期间切换选择，会复制另一项或给出另一项尺寸 | 真实页面/画布来源/URL 模块，两种等待边界与对照 |
| 18 | FRONT-08 | P3 | 字体状态或样式表一次暂时失败后不再重试，当前页面持续缺少字体或沿用旧样式 | 真实 loader、合成 CSS/状态/时钟及四组恢复对照 |
| 19 | FRONT-09 | P3 | 歌曲菜单用按钮或键盘关闭后累积点击回调，首次外部点击前反复执行相同判断 | 真实 owner/委托、合成冒泡与十个生命周期场景 |

没有确认 P0/P1，不代表未审范围不存在高风险问题。另有五项维护/优化建议，单列且不计入缺陷数。

## 确认发现与最小建议

### SEC-01：素材选择权限被不可信引用扩大

位置：[component-web-picker.js](../../src/electron/component-web-picker.js) `packageRoot`（第 17–40 行）、`componentWebDirectory`（45–55 行）及返回入口（79–84 行）；交付入口为 [component-web-files.js](../../src/server/component-web-files.js) `serveComponentWeb`（86–109 行）。置信度高。

选择 `source/themes/third-party/index.html`，该文件引用 `../../shared/frame.png`，根目录会提升至整个 `source`。随后递归收集根下所有支持文件，连既未选择也未引用的 `source/backups/private.json` 都会被复制。非系统个人目录、普通文件和合法相对路径即可触发。

真实调用链为 `component-source-import` → `component-style-api` → `POST /api/component-styles/pick-web` → Host/Origin/admin 检查 → 原生 picker → `component-web-library.add` → `/component-web/<id>/...`。复现中匿名导入 401、异源管理导入 403、正常合成管理身份导入 200；捎带 JSON 的匿名 GET 返回 200 和 `Access-Control-Allow-Origin: *`。因此根因是导入范围扩大，不能把公开资源路由本身当作鉴权绕过。

已有盘符根、个人目录名、隐藏文件、链接、扩展名、大小和数量保护均不能定义普通自建目录的授权范围。已证明合成文件被公开读取；没有执行真实浏览器外带。允许脚本的素材沙箱与 CORS 不能替代导入边界。

**建议：** 原生文件选择不能静默授权祖先目录。遇到越界依赖时，要求明确选择包含资源的素材根，或显示扩大后的读取范围再由用户选择。保留合法相邻 CSS/图片及浏览器源读取；不能用新增文件名黑名单解决。扩展 `test/desktop/component-web-picker.test.js` 的跨目录引用用例，加入不相关兄弟文件反证。修复时核对 `docs/guides/component-style-packages.md` 的选择步骤及 API owner。

复现：`node tmp/continuous-audit-2026-11-05/security/repro-component-directory-expansion.cjs`。详细链与限制见安全证据（原附件：`tmp/continuous-audit-2026-11-05/security/report.md`）。历史报告仅覆盖温和目录提升及命名个人目录保护，未记录本根因。

### SEC-02：文件大小限制没有限制正则计算量

位置：[component-web-library.js](../../src/server/component-web-library.js) 第 74–76 行；[component-web-references.js](../../src/server/component-web-references.js) 第 7、23、49 行及邻近注释/引用扫描。置信度高。

重复合法前缀但不闭合的 HTML/CSS 会让每个候选起点重新扫描剩余文本。完整导入实测：重复 `<a` 的 20/40/80 KB 约为 66/219/811 ms；80 KB 的 `<base x` 约 1,133 ms、`url(x` 约 861 ms；400 KB 异常 HTML、CSS 均超过 3.5 秒，被隔离子进程上限终止。400 KB 普通文本约 10 ms。文件均低于允许的 4 MiB 代码文件上限。耗时是本机观察，不作为跨机器承诺。

原生 picker 的依赖发现和保存后的 `checkReferences` 都调用该解析 owner；最终 HTML 正则也有同类问题。正常桌面后端位于 Electron main 同进程，同步扫描期间无法让出事件循环。本轮没有实际启动桌面测帧率，也没有用最大输入长时间压垮主机。

**建议：** 在现有 owner 内改为按定界符前进、避免重扫尾部的解析；保留正常引用语法。仅把 `.*` 换成另一个可跨候选起点的字符类、加同线程 timeout 或再包 catch 均不足。扩展 `test/scenes/component-web-import.test.js`，在隔离子进程验证较长 near-miss 输入能有限时间结束，不做脆弱毫秒快照。接口和用户操作可保持不变。

复现：`node tmp/continuous-audit-2026-11-05/security/repro-component-html-cost.cjs`。已有短错误输入/预算测试未覆盖该算法成本；历史确认项中无此根因。

### DATA-01：有限重试仍同步阻塞桌面主线程

位置：[remote-gift-image-cache.js](../../src/bilibili/gift/remote-gift-image-cache.js) `writeAtomic` 第 427–432 行，图片与索引调用在第 164、131 行。置信度高。

Windows 临时占用产生 `EPERM/EBUSY` 时，四次 `Atomics.wait` 分别阻塞 50/100/150/200 ms。合成文件锁下最终保存成功，但单图停顿 531 ms，预定 10 ms 的定时器同样到 531 ms 才执行。网络并发限制不能使这些同步等待让出线程。

接线为 Electron `main` → `desktop-runtime` 同进程 `createServerRuntime` → `domain-services` → `hybrid-catalog` → `gift-catalog-initializer.cacheGifts` → image cache。批末索引提交使用同一写入函数。[component-style-index.js](../../src/storage/component-style-index.js) 第 33 行和 [component-style-files.js](../../src/storage/component-style-files.js) 第 23 行也有该模式；它们只做静态同根因登记，不冒充已分别实测。

**建议：** 在 I/O owner 中使用有限异步等待，连贯修改 `writeAtomic`、`persistImageIndex` 及调用方的 await；保持原子替换、旧文件保留和清理。异步化索引提交还需串行化或版本保护，不能简单替换为一个未等待的 setTimeout。扩展既有图片原子替换测试验证等待期间事件循环可继续处理任务。修复须核对存储/礼物 owner，用户操作无需改变。

复现：`node tmp/continuous-audit-2026-11-05/backend/repro-gift-image-event-loop.cjs`；结果为 gift-image-event-loop-result.json（原附件：`tmp/continuous-audit-2026-11-05/backend/gift-image-event-loop-result.json`）。现有相关重试用例 2/2 通过，只证明恢复与旧数据保留。该重试相对 10 月 31 日修复基线是新变更。

### FRONT-01：内存有界不能证明持久缓存有界

位置：[cache/manager.js](../../public/js/playback/cache/manager.js) 第 45–57、75–100 行；消费者为 `content/loader.js` 歌单缓存，播放器启动新建 `CacheManager`。置信度高。

过期清理只发生在访问同一个持久键或遍历本次 `_mem` 时。内存容量淘汰只删除 Map，重启后没有恢复持久条目的清理索引。90 个各 100 首的合成歌单留下 90 个 localStorage 键，UTF-16 估算 1,565,780 字节，内存只有 64 项；推进 25 小时并新建实例后，未重新访问的 90 个过期键仍保留。

在合成满配额条件下，新歌单和合法的同源 `playbackOutput:v1` 写入失败；既有手动清缓存后恢复。没有测量本机 Chromium 实际配额、物理磁盘占用或真实用户已有缓存，不称为无限磁盘增长/内存泄漏。风险是无用缓存持续占用有限配额；“满了不影响功能”的注释忽略了其它同源存储消费者。

**建议：** 缓存 owner 对自身 `playbackCache:v2:` 前缀建立持久预算和过期回收；首次使用/写入清理过期项，配额失败有限回收再重试。不得清空其它偏好、草稿或账号数据。扩展 `test/playback/playback-cache.test.js` 的重启用例，保留真实 Map 存储替身并不重新访问旧键；同步 `docs/reference/frontend/playback.md` 的缓存规则即可，无须新增用户操作。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend/repro-playlist-storage.cjs`；结果（原附件：`tmp/continuous-audit-2026-11-05/frontend/playlist-storage-result.json`）。既有跨重启测试重新访问同一键，容量测试只断言内存，未覆盖此路径。与历史播放状态 flush 问题不同。

### FRONT-02：旧保存回执倒退界面保存基线

位置：[gift-frame.js](../../public/js/admin/gift-frame.js) 第 55、105–125 行。置信度高。

门槛从 25 元改到 30 元，两次保存同时在途；两个设置广播按 25→30 到达，30 元的 HTTP 回执先完成。此时界面为 30.00 且已保存；随后 25 元旧回执无条件回写 `currentSettings`，同一界面值变成 dirty=true，并提示刚才的新修改没保存。只证明界面基线和反馈错误，没有证明服务端回滚或输入丢失。

**建议：** 在现有 owner 序列化保存并保留随后编辑的草稿；如保留并发，需请求归属和广播权威顺序。复用已有设置控制器模式，避免另造通用框架。扩展 `test/gifts/gift-frame-draft.test.js` 的双提交逆序完成场景；当前接口与操作步骤可保持不变。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend/repro-gift-frame-ack.cjs`；结果（原附件：`tmp/continuous-audit-2026-11-05/frontend/gift-frame-ack-result.json`）。历史类似问题发生在其它 owner，这里是新确认的覆盖缺口，不宣称新漏洞类型。

### DATA-02：字节统计使用了字符长度

位置：[retention.js](../../src/storage/retention.js) `rawJsonStats` 第 211 行，`GET /api/database/stats` → `domain-services` → `getRetentionStats`。置信度高。

`SUM(LENGTH(raw_json)) AS bytes` 对 SQLite TEXT 计算字符数。真实 handler 与内存 SQLite 中，含中文和 emoji 的合成 JSON 实际 UTF-8 长度为 44 字节，却报告 29。技术契约明确称为 raw_json 字节数。影响只在非空且非 ASCII 报文；当前云端礼物投影置空 raw_json 的路径不表现差异，也不是整个数据库文件大小错误。

**建议：** owner 使用 `LENGTH(CAST(raw_json AS BLOB))` 或运行时支持的字节长度函数，维持字段契约。扩展现有 `test/storage/retention.test.js` 一个代表性 Unicode 统计断言。参考契约已正确，无须把文档改成字符数。

复现：`node tmp/continuous-audit-2026-11-05/backend/repro-retention-byte-count.cjs`；结果（原附件：`tmp/continuous-audit-2026-11-05/backend/retention-byte-count-result.json`）。此为旧实现中的新确认问题，不是本次代码引入。

### SEC-03：抽奖账号持久化未包含发行 ID 的服务器

位置：[dynamic-lottery-auth.js](../../src/electron/dynamic-lottery-auth.js) 第 27–46、73–78 行；[dynamic-lottery-auth-store.js](../../src/electron/dynamic-lottery-auth-store.js) 第 47–52、91–94 行；[service.js](../../src/bilibili/dynamic-lottery/service.js) 第 72–75、121–125 行。置信度高。

同一安装保留数据目录，更换 `LIRA_LICENSE_API_BASE` 后重启并在新服务器重新激活；若两个服务器各自发放了 `streamerId=1`，抽奖分区和快照都取 `sha256(streamerId)`，活动列表也仅按该 ID 读取。隔离复现用两个真实授权管理器完成合成激活、全新 session 替身及重新打开的 SQLite：B 的 `getContext()` 返回 A 的合成 Cookie，`getState()` 返回 A 的活动；ID 为 2 的对照无登录、无活动。

这是跨服务器的本地主体隔离缺口。服务端 `streamers.id` 是 AUTOINCREMENT 整数，碰撞是正常分配可能性。安装数据根不随 origin 变化；授权 generation 能取消旧异步工作，但不区分持久化来源。没有把 Cookie 发给真实 B 站或 LIRA Server，没有执行他人账号操作，也不是普通同一服务器不同 ID 换号的问题。跨仓只读证据来自 `D:\Work\lira-server`，HEAD `818ddfa5a41c3d0af20c931892d7556bf12584ae`，当时工作区干净。

**建议：** 可信主进程用规范化服务器 origin + streamerId 构造主体 scope，贯穿登录分区、加密快照、活动、结果、回执和预算；保留 generation 检查。旧数据没有 origin，不能按当前服务器自动认领或删除；需可验证的归属迁移及安全的重新登录流程。现行 [auth.md](../reference/desktop/auth.md) §14 如实写着单 ID hash，本项是隔离合同遗漏，修复需同步该合同、存储说明及相关规格。扩展现有抽奖认证/生命周期测试，覆盖同 origin 重启、异 origin 同 ID、不同 ID 和旧数据迁移；用户提示仅随实际迁移决策调整。

复现：`node tmp/continuous-audit-2026-11-05/security-round2/repro-lottery-server-scope.cjs`；详见第二轮安全证据（原附件：`tmp/continuous-audit-2026-11-05/security-round2/report.md`）。没有继承历史已修项目的结论。

### DATA-03：合法恢复集合在中间状态撞上唯一键

位置：[profile-transfer.js](../../src/fans/profile-transfer.js) 第 106–129、143–149 行；[fan-profile-store.js](../../src/storage/fan-profile-store.js) 第 179–183 行。置信度高。

创建 A、B 两份粉丝档案并导出完整备份；通过正常编辑先解除 A 的 UID，再把 B 改成 A 的 UID、A 改成 B 的 UID。原样旧备份预览显示 0 新增、2 已有，但选择完整替换时，恢复逻辑逐份“删除当前档案→立即插入旧档案”，第一份仍会撞上另一份待替换记录持有的 `UNIQUE(scope, identity_key)`。倒转备份顺序也失败，最终目标集合本身没有重复身份。

真实服务与内存 SQLite 的五种对照证实：未交换身份、选择保留本机、本机恢复点均成功；上述两种完整替换失败且事务完整回滚，当前资料、恢复点数量及另一账号的哨兵资料未变。用户收到通用操作失败，不是 SQL 原文。本项是备份恢复可用性缺陷，没有确认数据丢失。它与历史 F-007/F-008 的身份标准化、屏蔽键校验不同。

**建议：** 在现有事务内先解析并验证完整替换计划和保留集合的最终唯一性，再统一释放本次明确批准替换的目标，随后恢复。不能删除账号全部资料、撤掉唯一约束或仅换排序。扩展 `test/fan-profiles/fan-profiles-transfer.test.js` 的原样备份与身份交换案例；保持同 scope、预览摘要、记录去重和回滚。核对 [storage.md](../reference/backend/storage.md) 的恢复 owner 说明及 `specs/fan-profiles.md`；用户入口可保持不变，冲突提示有变化时再同步指南。

复现：`node tmp/continuous-audit-2026-11-05/backend-round2/repro-fan-restore-identity-cycle.cjs`；详见第二轮数据证据（原附件：`tmp/continuous-audit-2026-11-05/backend-round2/report.md`）。没有操作用户数据库。

### FRONT-03：迟到的恢复预览覆盖新档案草稿

位置：[transfer-ui.js](../../public/js/admin/fans/transfer-ui.js) 第 131–156 行；[editor.js](../../public/js/admin/fans/editor.js) 第 7–17 行；入口在 `fans/index.js` 的文件 change 与新建操作。置信度高。

选择备份后，读取文件或 `preview-restore` IPC 尚未结束时，页面仍能新建档案并输入备注；旧操作完成后无编辑会话检查，直接 `openForm`，将正在编辑的 DOM 替换成“核对恢复预览”。真实前端入口及 imports 的隔离复现分别延迟文件读取和 IPC：备注控件从 DOM 移除，草稿丢失，没有放弃草稿确认。立即完成后再新建、预览失败两个对照保留草稿。

现有账号 context、详情选择代次与 editor 提交保护没有覆盖这次共享编辑器的异步打开。它不是历史 F-020 已修的 detail/selection 迟到结果。本轮证明的是未保存输入丢失；没有执行 `restore/create/save`，没有数据库变更，也没有真实 Electron 视觉验收。

**建议：** 在文件选择开始时捕获编辑意图，文件读取和 IPC 返回后均校验；新建、编辑、关闭或页面/账号切换应使旧意图失效。由现有编辑器/transfer owner 管理，不新增全局异步框架。扩展既有粉丝编辑器测试的迟到预览场景，保留正常预览与失败反馈。修复核对前端编辑生命周期参考，接口、备份格式和用户操作可保持不变。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend-round2/repro-fan-restore-draft.cjs`；结果（原附件：`tmp/continuous-audit-2026-11-05/frontend-round2/fan-restore-draft-result.json`）。DOM/File/IPC 为合成替身，owner 为真实代码。

### FRONT-04：删除确认的对象与实际删除对象不一致

位置：[ai-assistant-personas.js](../../public/js/admin/ai-assistant-personas.js) 第 83–86、130–139、171–192 行；持久化 owner 为 [config-store.js](../../src/ai/config-store.js) 第 144–151 行。置信度高。

主 AI 设置仍在保存时，用户确认删除预设 Alpha。`runOperation` 为展示确认框关闭预设 dialog，确认通过后继续等待 `flushPendingSave()`；此时“管理预设”入口仍能执行。用户改选 Beta 并再次打开管理，`loadEditor` 改写共享 `editorId`；等待结束后删除回调读取这个新值，实际提交 `delete(Beta)`，尽管唯一一次确认写的是 Alpha。

复现用真实 AI UI 模块、既有 VM 夹具和真实配置 owner 的内存 SQLite：最终 Alpha 留存、Beta 被删除。只改选但不重新打开管理、没有在途保存、取消删除三个对照均正确。`busy` 阻止另一项 `runOperation`，dialog 的 inert 只约束该 dialog，都没有冻结确认所绑定的对象；正常编辑保存已捕获局部 id，不能据此认为删除分支也安全。重置分支有相同可变读取模式，但未另作实测或拆分计数。

**建议：** 发起破坏性操作时捕获 ID 与显示名称，确认和请求使用同一份快照，并让管理/新建入口在已有操作期间遵守 busy。不要通过移除保存等待来修复，否则会引入主配置覆盖问题。扩展既有人格 UI 测试的“确认 A→等待保存→打开 B”场景，验证实际配置只删除批准目标；核对 AI 前端保存/确认流程参考。HTTP 形状、预设格式和用户步骤可保持不变。没有删除任何真实预设。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend-round2/repro-persona-delete-target.cjs`；结果（原附件：`tmp/continuous-audit-2026-11-05/frontend-round2/persona-delete-target-result.json`）。两项前端发现的完整反证及测试命令见第二轮前端证据（原附件：`tmp/continuous-audit-2026-11-05/frontend-round2/report.md`）。只有合成传输和内存数据库，未运行用户应用。

### PERF-01：歌词兼容回退的失败匹配阻塞同线程

位置：[lyric-parser.js](../../src/music/lyric-parser.js) 第 153、175–177 行；`POST /api/music/lyrics/parse` → `lyrics-service.parseLyricPayload` → `parseLyricResult` → `parseWordLyric`。置信度高。

带 `[1000,2000]` 行级时间头、却缺少单字时间戳的长正文会进入后缀 QRC 正则。它从每个候选起点重扫剩余文本。真实 handler 的隔离测量中，10/20/40 KB 分别约 28/107/421 ms，100 KB 为 2,594 ms，预定 10 ms 的定时器同时推迟到 2,594 ms；400 KB 在 3 秒子进程上限仍未完成。等长合法后缀 QRC 约 2 ms。100 KB translation 回退也约 2.6 秒。

512 Ki 个 JS 字符的字段上限与 16 MiB 请求上限都允许这些输入。API 有原有鉴权，本次直接调用 handler，不声称匿名可达；QQ/网易云 Provider 和全民 K 歌缓存也调用该 parser，只做静态接线确认，没有攻击真实上游。桌面后端位于 main 同进程，但未实测 Electron 帧率。本机单次测量说明规模趋势和事件循环阻塞，不是跨机器延迟承诺。

**建议：** 在 parser 内按时间标记/分隔符单向推进，使缺失、截断及多个无效标记都不会重复扫描尾部；保留正常 YRC/QRC 和翻译兼容。catch 或同线程 timeout 无法中断同步正则。扩展 `test/lyrics/lyrics.test.js` 的受控子进程异常输入对照，避免脆弱的毫秒快照；检查 [music/services.md](../reference/backend/music/services.md) §6，格式和操作不变时用户指南无需新步骤。同类别风险也出现在 SEC-02，但这里是独立 owner 与修复；同 parser 的多个调用方只计一项。

复现：`node tmp/continuous-audit-2026-11-05/root/repro-lyric-parser-cost.cjs`；详细证据与反证（原附件：`tmp/continuous-audit-2026-11-05/root/round2-report.md`）。所有子进程均已结束。

### DATA-04：成功迁移的去重规则丢掉不同金额的 SC

位置：[legacy-superchat-migration.js](../../src/storage/legacy-superchat-migration.js) 第 49–61、89–103 行；入口为 [database.js](../../src/storage/database.js) 第 50 行。置信度高。

仅影响仍有旧 `songDb.super_chats` 表，且未删除的无平台 ID 记录发生 UID/正文/创建时间碰撞的安装。真实 SC 创建 owner 接受的两条合成记录金额为 30 和 50、其余回退键相同；迁移没有抛错，但目标只剩 30，旧源表已删除。反转原始顺序则只剩 50；再次调用迁移也不能恢复。金额总和用于辨别记录遗漏，不代表实际账户资金损失或所有升级都受影响。

SQL 只比较 UID、正文和时间，没有比较金额。`legacySuperChatFingerprint` 虽生成字符串，SQL 仅用它判断非空，因此只在该函数中加金额仍不能修好实际比较。已有无 ID 去重测试两条价格相同；本次不同稳定 ID 对照两条都保留、完全相同重复按既有规则合并、第二次 INSERT 故障则目标回滚且源表保留。问题发生在错误去重被当成成功的分支，与正常事务回滚不同。

**建议：** 在迁移 owner 的实际回退条件中至少纳入规范化金额，保留平台 ID、已删除收据及事务规则；不可靠的冲突应保留记录或明确失败并保留源表。分别验证首次迁移无损与重试幂等。扩展 `test/storage/database-maintenance.test.js` 的不同金额/反向顺序案例；同步 [storage.md](../reference/backend/storage.md) 的回退合同，用户指南仅随冲突处理或提示变化调整。这里仅建议，未运行真实用户库或修改历史数据。

复现：`node tmp/continuous-audit-2026-11-05/backend-round3/repro-legacy-superchat-dedup.cjs`；第三轮数据证据（原附件：`tmp/continuous-audit-2026-11-05/backend-round3/report.md`）。五个双内存库场景使用当前基础 schema 的兼容列，不是归档版本安装器或完整应用重启验收。

### FRONT-05：取消日程删除会丢掉未保存编辑

位置：[streamer-planner.js](../../public/js/admin/streamer-planner.js) 第 410–420 行，取消分支调用 `openEvent(eventId)`；后者在第 246–265 行从保存记录回填字段。置信度高。

打开已有日程，修改标题、日期/时间、分类和备注，点击删除后在确认框选择取消。原编辑器重新打开，却全部恢复为保存值，刚才的输入丢失。这条路径不需要慢请求或并发操作。真实 planner、view/model/storage 与共享确认模块的 VM 复现显示取消时没有新增存储写入，两条已保存日程都在；未编辑取消、确认只删原目标两个对照也正常。因此已确认的影响是草稿丢失，删除目标 ID 本身捕获正确。

**建议：** 取消时重开保留原控件值的 dialog，保留编辑 ID、焦点、校验及提醒字段；必要的重建应先保存当前草稿。不要把取消变成自动保存，不新增存储层。现有 planner 测试主要验证模型和存储，修复应补编辑后取消确认的真实事件链。核对 [app.md](../reference/frontend/app.md) 的工作台 owner，现行持久格式及用户步骤可保持不变。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend-round3/repro-planner-delete-cancel.cjs`；第三轮前端证据（原附件：`tmp/continuous-audit-2026-11-05/frontend-round3/report.md`）。DOM/localStorage/时钟为合成，没有浏览器或原生通知验收；与 FRONT-03 的迟到预览、FRONT-04 的误删目标是独立原因。

### PERF-02：输入预算没有约束歌词展开与后续处理

位置：[lyric-parser.js](../../src/music/lyric-parser.js) `parseLrc` 第 116–140 行、逐行估算第 228–268 行；[music-routes.js](../../src/server/routes/music-routes.js) 第 93–97 行与 [http-utils.js](../../src/server/http-utils.js) 第 59–73 行直接序列化结果。置信度高。

同行多时间戳是已有合法语法，每个时间戳都生成含完整正文的行。2,048 个互不相同的合法时间戳加共享正文，共 45,056 字节，真实 handler 输出 46,307,170 字节 JSON，约放大 1,028 倍；同长输入仅一个时间戳时输出 45,137 字节。输入从 5,632→11,264→22,528 字节时，响应约 0.74→2.93→11.62 MB。没有利用缺标记正则、重复时间戳或超出输入上限，故修 PERF-01 的正则不解决本项。

进一步用真实网易云 `getLyrics`、合成平台响应验证后续逐字估算：11,264 字节/512 时间戳处理并序列化约 404 ms，10 ms 定时器到 406 ms 才触发，输出约 5.83 MB；同长单时间戳为 12 ms、约 22.7 KB。该样本末端 heapUsed/RSS 分别比入口多约 110.5/231.3 MB，只是前后分配样本，不能称作峰值、常驻开销或泄漏。没有网络请求、缓存落盘、大响应文件或最大规模压测。

下游时间线有 500 行、48 Ki 字符等预算，但不覆盖先前的歌词解析、Provider 估算和 HTTP 序列化；API 也保留原有鉴权，本轮不声称匿名可控平台歌词。**建议：** 共享解析 owner 在昂贵消费者之前限制展开后的总行数/文本预算，保留普通多时间戳语义，超预算给可诊断错误。分词复用可减重复工作，但不能单独解决巨大输出，也无须增加长寿命全局缓存。扩展已有歌词测试的正常/超预算对照；新增用户可见限制需同步 [music/services.md](../reference/backend/music/services.md) §6/§14、错误契约及受影响说明。

复现：`node tmp/continuous-audit-2026-11-05/root/repro-lyric-output-expansion.cjs`；第三轮资源证据（原附件：`tmp/continuous-audit-2026-11-05/root/round3-report.md`）。十个规模/对照均在限时独立子进程内结束；数字为本机观测，不作为普通歌曲表现或跨机器承诺。

### FRONT-06：删除另一条许愿清空当前未保存草稿

位置：[wishes.js](../../public/js/admin/gifts/wishes.js) 第 243–251、271–291 行，特别是第 281 行的无条件 `resetEditor()`；表单重置在第 159–170 行。置信度高。

编辑已保存的许愿 A，将目标改为 25 并修改备注但不保存，然后在列表对 B 点击“删除”“再次点击删除”。B 的请求成功后，A 的目标恢复默认 10、备注变空、选中礼物和编辑身份被清除，界面回到“添加许愿”。真实编辑、feed、请求与响应模块的 VM 复现中，唯一变更请求的 ID 正确为 B；没有保存 A，也没有调用放弃草稿确认。相同 viewRevision 下即能发生，不需要异步竞态或来源切换。

共用 `mutate()` 同时负责传输/忙锁/错误处理和成功后重置编辑器，把适用于“保存当前草稿”的副作用带到了“删除其它记录”。删除失败、只点击一次删除均保留 A 草稿，保存 A 成功后重置则正常。现有 `confirmDiscard()` 保护编辑对象和周期切换，但删除分支没有使用。已确认的是未保存输入丢失，不是误删或损坏已保存的 A；后端响应模型为合成，未操作用户数据。

**建议：** 让具体操作决定是否重置编辑器；成功保存当前草稿、删除正在编辑的对象可以结束编辑，删除其它对象只刷新列表并保留草稿。捕获操作目标，不隐式保存无关输入，也不要求用户为删除 B 放弃 A。保留共用请求和失败处理，无需新增通用表单框架。扩展 `test/gifts/frontend-gift-wishes.test.js` 的现有夹具，增加“编辑 A→删除 B 成功”；核对 [app.md](../reference/frontend/app.md) 与 [gift.md](../reference/backend/bilibili/gift.md) 的 owner 说明，接口、格式及用户步骤可以保持不变。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend-round4/repro-wish-delete-other-draft.cjs`；第四批前端证据（原附件：`tmp/continuous-audit-2026-11-05/frontend-round4/report.md`）。DOM/时钟、卡片和富文本等配套依赖为替身，没有真实 Electron、布局或富文本撤销验收。与 FRONT-04 的删除目标漂移及 FRONT-05 的取消回填不同。

### DATA-05：归档后本机日期的盲盒统计错位

位置：[gift-local-retention.js](../../src/storage/gift-local-retention.js) 第 27、29–34、64–65 行；[blind-box-analysis.js](../../src/bilibili/gift/blind-box-analysis.js) 第 195–212 行。置信度高，触发须已协商保留协议、激活并实际裁剪旧明细；未核验线上是否启用。

本地归档用固定北京时间日桶合并同身份记录，但盲盒分析继续用电脑本机自然日筛选。两条已终态、已消费的合成记录发生于 `2026-01-01T20:00Z` 和 `2026-01-02T08:00Z`。真实 summary 校验/暂存、激活、清理与查询证实：UTC 和纽约的 1 月 1/2 日原数量为 1/1，清理两条明细后变成 2/0，利润由 0.5/0.5 变成 1/0。北京时间对照仍为 0/2，两日合计始终正确；再次清理没有新增删除或变化。各时区在独立子进程运行，未改系统时区或用户库。

[礼物参考](../reference/backend/bilibili/gift.md) 明确本机日期范围，[保留期规格](../../specs/gift-retention.md) 要求保持原统计语义。这不是简单发现两个正常接口时区不同，而是同一查询在表示转换前后改变。单日统计、排行及归档提示会受影响；没有证实全局金额丢失、真实直播事故或财务交易变化。现有日期测试使用未归档行，现有清理测试使用上海边界，分别通过未覆盖这一组合。

**建议：** 本地归档需保留能支持现有本机日期边界的时间信息，在验证保全前保留相关明细；不能悄改查询为北京时间，也不能用 `last_opened_at` 重分整桶。旧桶只保留总量和最后时间，无法凭空恢复跨日分布；格式/迁移方案须评估兼容与一致备份，无法精确恢复时要明确范围。扩展既有保留期测试的跨时区清理前后对照，核对存储/礼物 owner；若日期解释或恢复能力有用户可见变化，再同步说明。这里没有实施迁移或打开清理开关。

复现：`node tmp/continuous-audit-2026-11-05/root/repro-blind-archive-timezone.cjs`；第五批主证据（原附件：`tmp/continuous-audit-2026-11-05/root/round5-report.md`）。数据子代理只读复核同意条件性 P2；未运行真实上游或完整桌面同步。

### FRONT-07：复制地址与完成提示使用了不同选择

位置：[text-box.js](../../public/js/admin/text-box.js) 第 194–202 行。`await canvas.source()` 后重新读取共享 `selected` 构造地址，`await copyText()` 后又读取它取得尺寸。置信度高。

选中文本框 A 点击复制，在来源读取等待期间选择 B，剪贴板替身收到 B 的地址。另一个场景先取得 A 的地址、等待剪贴板完成时选 B：实际参数仍是 A，成功提示却要求设置 B 的 800×220 尺寸，A 的已发布尺寸应为 640×180。正常复制 A 和来源读取失败两个对照正确；每项只读一次来源，场景草稿在全部场景中均未变化。真实页面、画布来源和 URL 模块均执行，DOM/预览/传输/剪贴板为替身，没有真实剪贴板写入或 OBS/直播姬输出验收。

**建议：** 点击时捕获对象 ID，已发布成员检查、地址及已发布尺寸都使用同一对象；跨剪贴板 await 保留这份结果，完成提示标明对象或避免覆盖新选择的状态。保留画布输出绑定检查，不用草稿尺寸替代已发布尺寸，也无需通用异步框架。补现有文本框 UI 夹具的两种延迟，验证副作用参数与提示一致。接口、存储和用户步骤不变，技术契约/指南无需新增操作规则。

复现：`node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend-round5/repro-text-box-copy-selection.cjs`；第五批前端证据（原附件：`tmp/continuous-audit-2026-11-05/frontend-round5/report.md`）。两条等待链属于同一根因，只计一项 P3，不声称数据丢失、权限绕过或真实发生率。

### FRONT-08：一次字体加载失败使当前页面失去恢复入口

位置：[font-library-loader.js](../../public/js/shared/font-library-loader.js) 第 15–20、33–36、43–50 行。置信度高，P3。

页面在资源尚未完整就绪时取得的动态 CSS 可以不包含目标字体。后台资源进入最终 ready 后，loader 先缓存 signature 再请求新样式表；若这次请求触发 error，只移除失败 link，既不清除失败签名，也不调度重试。同一 ready 状态会被去重，后台任务已经结束，不保证再发不同状态。浏览器源初次 `/font-library/status` 请求暂时失败也没有后续读取。

真实入口由 [page-assets.js](../../src/server/page-assets.js) 第 70–72 行注入；[font-assets.js](../../src/server/font-assets.js) 和 [font-library.js](../../src/fonts/font-library.js) 第 131–145 行只发布当时完整可用字体。[共享字体选择器](../../public/js/shared/font-library.js) 的刷新只能检查已有 CSS face，不能补回没加载的 CSS。因此冷页面可能一直使用回退字体、选择器保留“未就绪”，暖页面则继续用旧样式，直到重建页面或出现新的完成状态；没有数据丢失或主要功能阻断证据。

四组隔离诊断中，桌面最终 CSS 失败后推进合成 60 秒并重复 ready，仍为 1 次样式尝试、0 个附着样式、0 次重试；浏览器 ready 后 CSS 失败、首次 status 失败均停留。重建 loader 可在相同 ready 状态成功。成功签名正确去重、失败保留旧 CSS、新 completedAt 可恢复、dispose 正确退订等对照均通过。使用真实 loader/imports、合成 DOM/桥接/请求/时钟，没有请求真实网络、下载字体或做像素验收。

**建议：** 在当前 loader 区分已应用和在途签名，仅在成功后确认版本；对状态读取或 CSS 的暂时失败安排有界重试，保留旧 CSS，销毁时取消重试并忽略旧回执。复用 `test/ui/font-library-loader.test.js` 的环境补充“失败后同状态成功、释放待重试任务”行为覆盖，不固定具体重试毫秒值。修复时核对 `docs/reference/frontend/app.md`、`pages.md`、`playback.md` 的资源就绪机制；不改变共享字体目录、用户选择值或要求重新下载，用户步骤没有必要扩展。证据见第七批前端报告（原附件：`tmp/continuous-audit-2026-11-05/frontend-round7/report.md`）。

### FRONT-09：歌曲菜单关闭后临时累积外部点击回调

位置：[home-handler.js](../../public/js/playback/features/home-handler.js) 第 243–276 行、[event-handlers.js](../../public/js/playback/core/event-handlers.js) 第 175–178、197–214 行。置信度高，P3。

「我喜欢」和歌单详情的更多菜单每次打开，经零延迟定时器新增一个 document click 闭包；只有 wrapper 外点击才解绑。按钮关闭、Escape 和 Tab 只隐藏菜单，未释放本次监听。实际委托没有停止冒泡；普通鼠标关闭抽屉属于外部点击，可以清理，而程序化 Drawer.close 没有该清理。

真实 HomeHandler、事件委托、Drawer 和 HomeService 的合成 DOM 诊断中，1/10/50 轮 × 三种关闭方式各残留 N 个回调；下一次菜单内点击执行 N 次相同判断，首次外部点击重复隐藏后全部解绑。连续 50 次外部关闭及真实关闭按钮冒泡对照无残留。计数扣除正常常驻控件监听，完成后无待执行定时器。这证明临时闭包保留及重复工作，不证明永久内存泄漏、跨文档存活或实际卡顿。

**建议：** 在现有菜单 owner 保存唯一关闭回调及待安装定时器，按钮、键盘、替换菜单和所属抽屉关闭共用局部释放动作；保留焦点、ARIA 和外部点击行为，无需新框架。复用既有播放菜单/键盘 fixture 覆盖连续开关后无残留及正常外部关闭，不添加源码形状断言。修复时核对 `docs/reference/frontend/playback.md`；预期不改用户操作、HTTP/IPC 或持久化合同，用户指南无需扩展。证据见第八批前端报告（原附件：`tmp/continuous-audit-2026-11-05/frontend-round8/report.md`），命令为 `node --experimental-vm-modules tmp/continuous-audit-2026-11-05/frontend-round8/probe-track-menu-listeners.cjs`。

## 维护与优化建议（不计缺陷）

### DEP-O1：开发依赖有一条已知通告，未证明产品可达

本轮 `npm audit --json --ignore-scripts` 返回 6 个 moderate 节点，均传播自同一条 [minimatch 通告 GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)，不是六个独立漏洞。锁文件中的 10.2.5 和嵌套 9.0.9 属开发依赖；`npm audit --omit=dev --json --ignore-scripts` 返回 0 个已知告警。

通告要求可控 glob 且 `optimizationLevel >= 2`。本轮核对的 builder `fileMatcher` 使用 `{ dot: true }`，minimatch 默认等级 1；universal 相关调用只传 `matchBase`，项目生产源码无直接调用。因此只列依赖维护事项，未证实客户端运行时可利用。建议在构建依赖兼容性允许时升级到覆盖该通告的版本并跑既有打包检查；不要盲从 audit 的跨主版本降级建议。原始 JSON 在 `tmp/continuous-audit-2026-11-05/root/`。

### FRONT-O1：字体预解码的必要性需要实际测量

[component-resources.js](../../public/js/overlays/component-resources.js) 第 39–40 行即使歌词选择 Microsoft YaHei，仍对资源包的 23 个文楷分片执行 FontFace.load。真实选择逻辑加替身 FontFace 的计数探针确认 23 次调用；源文件压缩体积共 11,132,516 字节，同身份再次 update 无额外调用。

现行 overlays 参考明确要求预解码，不能视为违反契约。上述不是实际网络字节、解码耗时或 RSS；来源为本地资源，也不是 23 次 CDN 请求。建议用隔离浏览器源量测冷/暖缓存、字体选择及多个实例的准备时间，再决定是否将完整性验证留在导入边界、字形按需准备。不得让 prepared 在必须资源未就绪时假成功。

### NATIVE-O1：非音乐设备输入仍初始化分离模型

`AudioSession.cs` 第 151、167、225 行要求修改 inputMusic/来源前停机，并对 `DeviceSource && !InputMusic` 在整个会话强制分离强度为 0。该固定非音乐输入会话不可能进入分离分支；不能把它泛化为所有暂时将强度调到 0 的音乐会话。

[AudioEngine.cs](../../native/audio-assistant/AudioEngine.cs) 第 47、113 行仍无条件创建 DspSource → StemSeparator → [StemModel](../../native/audio-assistant/StemSeparator.cs)（第 11、112–139 行）。静态确认输入/输出张量共 323,484 个 float，即 1,293,936 字节载荷；另读取校验本机 9,415,676 字节模型、创建推理会话并预热。这些是数组尺寸、模型文件大小及可达初始化的证据，不是实测新增 RSS、磁盘流量或启动延迟。

**建议：** 现有会话准备阶段按是否允许音乐分离决定是否初始化 separator；固定禁用模式保留实际需要的声道、音高和音量处理。可在运行中启用分离的音乐模式仍须保留准备和平滑切换，不能把初始化移到实时音频 Read 回调。后续用合成 PCM 验证非分离输出及模式切换，再测冷/暖启动与工作集；当前没有启动原生程序或操作声卡。

### EXPORT-O1：导出进度重复构建整份文件布局

[gift-export-controller.js](../../src/electron/gift-export-controller.js) 第 10–18、178、202、237 行。`save()` 先生成布局取首张高度，再生成一份用于循环；每张图片保存后，为取总数又重新生成全部条目和文件名。若输出 M 张图片，仅保存阶段就创建 M×(M+2) 个条目。

真实 controller 的隔离 VM 计数：500/1,000/2,000 张分图分别创建 251,000 / 1,002,000 / 4,004,000 个布局条目，模拟 save 耗时约 79/292/1,141 ms；2,000 条记录拼接成 52 张时创建 2,808 个条目。四个限时子进程均正常结束，fs/promises 和窗口/捕获为替身；没有真实导出图片写入。数字不是实际渲染或磁盘耗时、连续事件循环阻塞或内存泄漏，未测改动后的收益，不作为功能缺陷计数。

**建议：** 每次保存用一份局部 `files`，首张尺寸、循环与进度共用。2,000 张分图的保存阶段只需构建 2,000 条布局是代码推导。运行中的任务本就禁止配置变更，不需要长期缓存或额外框架；保留取消、任务版本、图片尺寸和独占写入保护。可复用现有控制器行为测试，不增加布局调用数或毫秒快照作为永久测试；对外输出和用户步骤不变，契约/指南无需新增规则。

证据：第四批查询与资源报告（原附件：`tmp/continuous-audit-2026-11-05/root/round4-report.md`）、计数结果（原附件：`tmp/continuous-audit-2026-11-05/root/export-layout-cost-result.json`）。主代理执行，数据子代理只读交叉复核；首次夹具漏传 URL 的失败及修正已在原始报告记录，未当作产品问题。

### CACHE-O1：头像暖命中反复扫描整个用户资料缓存

[user-info-service.js](../../src/bilibili/users/user-info-service.js) 第 122、417–430 行在每次 `ensure` 查当前 UID 前清理所有记录和身份索引。摄入入口已有 `nextCleanupAt` 门槛，但读取入口绕过它。[gift-card-runtime.js](../../src/server/gift-card-runtime.js) 第 82–140 行按不同发送者补头像，经 `gift-export-runtime` → `bilibili-runtime.getUserAvatar` 到达该服务。因此需同时考虑缺头像的不同 UID 数 U 和缓存记录数 C，网络命中仍可能产生 U×C 次本地遍历。

真实 owner 的隔离计数中，U=C 为 500/1,000/2,000 时，三个非空 Map 合计遍历 750,000 / 3,000,000 / 12,000,000 项，资料请求均为零；该夹具的 recent/失败 Map 为空，系数 3 不代表所有运行状态。另用未装迭代计数的独立进程，1,000/2,000/4,000/8,000 个 UID 的准备约为 54/154/544/1,936 ms。8,000 行但只有一个发送者时只清理一次，元数据已有头像时不补查；后续 unchanged 读取均复用。冷/过期缓存对照正确调用资料 provider，未误报缓存完全无效或每次刷新都平方增长。

这些是合成分页和资料 provider 下的 Node 证据；实际授权读取、网络、Electron/渲染及优化后收益未测。10 ms timer 在本探针准备后才运行，不能外推为真实桌面必然连续停顿。当前单列优化建议，不计 P 级缺陷。

**建议：** 在现有 UserInfoService 让全量回收遵守既有间隔，对正在读的 UID 保留 O(1) TTL 校验与按需失效，同时保持失败冷却、身份索引和房间/生命周期一致性。不新增全局缓存，不以删掉过期检查换速度。复用用户服务与卡片测试覆盖过期、失败和补全；规模诊断增加不同 UID，避免只堆同一人的礼物行数。实现保持公开合同和用户步骤时，无需改指南；若回收时机约定改变，核对 `docs/reference/backend/bilibili/danmaku.md`。证据：第七批主报告（原附件：`tmp/continuous-audit-2026-11-05/root/round7-report.md`）、11 个样本（原附件：`tmp/continuous-audit-2026-11-05/root/avatar-cache-scans-result.json`），数据子代理已只读交叉复核。

## 验证与反证

| 实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| WS access policy、local-media access、desktop-request-auth 三个既有文件 | 54/54 通过 | 安全基线，不是全部 IPC 或真实桌面验收 |
| audio-component-manager、desktop-notifications、component-web-picker、component-web-import 四个既有文件 | 47/47 通过 | 包含 7 个嵌套案例；不覆盖 SEC-01/02 新反例 |
| gift image cache 两个原子替换用例 | 2/2 通过 | 不覆盖等待时事件循环响应性 |
| playback-cache、gift-frame-draft 两个既有文件 | 9/9 通过 | 未覆盖持久孤立键与双回执逆序 |
| cdn-resource-library、packaging-scope、audio-component-export | 29/29 通过 | 冷暖缓存/离线/更新/损坏、包范围与合成导出；没有发布或重建正式安装器 |
| update-manager、desktop-update-controller | 12/12 通过 | 更新状态、错误记录、打包配置及安装前排空；没有真实升级 |
| 6 个缺陷隔离复现、1 个字体调用探针 | 均执行成功 | 使用真实 owner 与合成输入；正则脚本的受控超时即证据，不当成测试通过的性能目标 |
| npm 全依赖/生产依赖审计 | 6 个开发依赖关联节点 / 0 个生产告警 | 同一通告，实际可达性另行核对 |
| `npm run verify:docs` | 10/10 通过 | 文档导航、链接、计划状态与路由；不代替功能正确性证明 |

上表为第一批，既有业务测试合计 153 项。第二批在未改业务源码和维护测试的同一基线新增执行以下检查，没有重复第一批用例：

| 第二批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| screen-color-picker、gift-export-controller、legacy-ipc-source、两平台 login-window | 38/38 通过 | sender、原生选择、生命周期和失败处理；没有真实 OS 登录窗口 |
| license-manager-identity、license-manager-operations | 38/38 通过 | 授权等待、续期/换号、回执与重试；远端为替身 |
| 粉丝 editor 定向用例、song-import-update-ui、license-ui、AI role/persona 定向用例 | 27/27 通过 | 新选择的既有 UI 行为；未覆盖两个新增时序缺口 |
| lyrics.test.js 中的三个 music cache 与两个解析用例 | 5/5 通过 | 实际缓存预算/监听回收、正常 QRC；不覆盖 PERF-01 长异常输入 |
| 5 个新增缺陷隔离复现 | 预期缺陷及对照均确认 | 内存/独立 SQLite、VM DOM、合成文件/响应；正则用限时子进程 |

第二批新增执行 108 项既有测试通过，当时累计 261 项。第三批继续新增执行以下检查：

| 第三批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| planner、planner-storage、cloud-song-sync-ui、场景删除定向用例 | 23/23 通过 | 模型/存储、授权代次和场景删除；不覆盖 FRONT-05 的编辑后取消 |
| 歌曲全量替换/路由、场景服务失败/提交后通知、歌曲存储失败回滚定向用例 | 10/10 通过 | 真实内存库及相关路由；不覆盖旧 SC 不同金额的回退键碰撞 |
| 3 个新增缺陷隔离诊断 | 预期缺陷及正常/失败对照确认 | SC 五个内存库场景、日程三个 VM 场景、歌词十个限时规模/对照；均不算维护测试 |

第三批新增执行 33 项既有测试通过，当时累计 294 项。第四批新增执行如下：

| 第四批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| settings-bootstrap、fan-song-retention、名单 v14 转换定向用例 | 16/16 通过 | 设置检查点、汇总备份往返、完整观察还原及故障回滚；未运行归档版本安装器 |
| 点歌设置、两类黑名单、加班机 UI 与规则编辑器 | 16/16 通过 | 保存/失败、dirty 保留和操作控制；许愿浏览器套件仅阅读，未计入 |
| 查询分页/计数缓存定向用例、gift-statistics-service | 10/10 通过 | 外部写入/回滚、读取快照、缓存边界、排序和整数聚合 |
| FRONT-06 的 1 个触发与 3 个对照 | 均完成 | 真实 owner 与合成 DOM/HTTP，已保存记录状态只来自响应替身 |
| 导出四个规模/模式、查询三个规模诊断 | 均完成 | 导出为虚拟窗口/文件；查询为真实 SQLite/服务，均有子进程上限 |

第四批新增 42 项既有测试通过，当时累计 336 项。第五批新增执行如下：

| 第五批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| 许愿升级/字段往返与旧规则身份兼容定向用例 | 13/13 通过 | 11 个许愿用例、2 个旧数字规则/大航海别名用例；真实库及领域边界 |
| canvas 保存/发布/选择定向用例 | 4/4 通过 | 当前场景 owner 的冲突、派发后编辑与规范化；不是文本框复制页面实机验收 |
| 保留期激活/重开/清理与本机日期/路由定向用例 | 10/10 通过 | 两个文件各 5 项；原用例未组合清理和非上海日界 |
| gift v9→v10、wish v15→v20 的四个内存诊断 | 均完成 | 正常保全/往返及检查点故障回滚，未用归档安装器 |
| DATA-05 三个时区、FRONT-07 四个异步场景、汇总查询三个规模 | 均完成 | 独立合成库/VM；查询包含两版汇总及清理前后，未使用真实 UI 或线上服务 |

第五批新增 27 项既有测试通过，当时累计 363 项。第六批新增执行如下：

| 第六批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| 心愿保留期、三周期/时区/session 与 v19 贡献迁移定向用例 | 7/7 通过 | 三个 retention 心愿用例和四个 wishes 用例，未重跑第五批展示转换 |
| 当前歌曲/心愿/画布数据 provider 定向用例 | 3/3 通过 | 共享订阅、迟到读取、失败清空、取消和定时释放；合成传输 |
| 保留期限流续传、progress 完成、过期增量恢复定向用例 | 3/3 通过 | 原检查点继续、激活后消费、清库后的旧写入拒绝；没有真实服务 |
| 明细/汇总混合统计的一个生命周期 | 10 检查点 × 30 种查询全部一致 | 原始流水参照与转换库各自独立；比较总量/排行/日期，非 300 项维护测试 |
| 心愿部分日、午夜及成员替换两个诊断场景 | 通过；第二场景加深失败点后重验一次 | 精确事件 oracle、每批实际删除、已有贡献写入后的指针更新失败回滚 |
| 预览生命周期三个诊断场景 | 全部通过 | 含五次重挂载；合成资源数归零，不代表堆/GPU 实测 |
| 导出五个在途取消点、一次虚拟渲染超时、一次合成写入失败 | 7/7 场景通过 | 真实 controller、替身窗口/fs/时钟；无 PNG 文件或真实磁盘故障 |

第六批新增 13 项既有测试通过，当时累计 376 项。第七批新增如下：

| 第七批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| 用户资料与礼物卡片定向用例 | 12/12 通过 | 合并/失败/TTL/退出、补全传递/四并发/失效/分页/unchanged；高行数旧用例仍是单 UID |
| shared font loader、local font library | 6/6 通过 | 两个 loader 与四个字体菜单用例；既有测试未覆盖失败后同状态重试 |
| 素材维护、开场媒体存储/流失败定向用例 | 10/10 通过 | 引用/恢复索引/清理及流失败合同，使用独立 scratch |
| 头像暖缓存的 11 个规模/对照 | 全部完成 | 计数与计时分开、零外部资料请求；不代表真实授权/桌面耗时 |
| 字体恢复四组、图片就绪三组诊断 | 全部完成 | 真实 owner 和合成 DOM/请求/时钟；没有真实字体/像素/堆测量 |
| 素材备份读保护、部分物理清理两个诊断 | 均完成 | 独立合成文件、真实读流及 Windows 暂态占用；不覆盖全账户/崩溃恢复 |

第七批新增 28 项既有测试通过，当时累计 404 项。第八批新增如下：

| 第八批实际执行 | 结果 | 证据边界 |
| --- | --- | --- |
| SSE 传输、提交、reconciliation 定向用例 | 16/16 通过 | 按事件字节预算、打开/闲置期限、取消、提交回调、旧流和补拉失效 |
| 播放队列、持久化、state action 定向用例 | 8/8 通过 | 清空在途导入、恢复身份、原地字段变化等；不等于菜单缺陷已有回归覆盖 |
| 备份 HTTP 入口定向用例 | 1/1 通过 | 真实隔离 HTTP 响应及既有访问合同 |
| SSE→controller→projection→SQLite 生命周期 | 六检查点通过 | 一个组合诊断；两类夹具错误纠正后通过，不是六项维护测试 |
| 批量队列六场景、菜单十场景 | 全部完成 | 真实 owner、合成音频/DOM/计时器；记录计数，不测堆或卡顿 |
| 备份 HTTP 暂停/恢复、中止、发头前后失败 | 四场景首次通过 | 32 MiB 合成载荷及实际本机 HTTP；不代表 2 GiB/真实 Electron 边界 |

第八批新增 25 项既有测试通过，累计 429 项；诊断和文档检查不混入该数字。文档门禁在报告更新后单独执行并保存本批日志。未运行全套，未将“通过现有测试”描述为已修复。原始命令见各分区 scratch 报告及第八批主记录（原附件：`tmp/continuous-audit-2026-11-05/root/round8-report.md`）；没有为补日志重跑。通过只证明已覆盖断言。第三批被中止的安全分区没有计入测试或覆盖，后续未恢复该分区。

重要反证：

- 网易云精确 ID 路径封面可为空属于已接受约定，不为了“完整”新增上游查询。
- AI 队列入口有容量限制，对话有 scope/TTL，日志写失败有失败计数和容量控制；没有把 Map、clone 或 catch 当作缺陷。
- 预览串行链的 `next.catch(() => {})` 让后续操作可继续，调用者仍收到原 next 的失败；不是无条件吞错。
- 本机媒体精确 allowlist、桌面请求来源绑定、WS 背压、音频组件固定 hash/成员白名单存在；不能用其保护推导不同导入路径也安全。
- CDN 初始化已有共享在途任务、请求速率限制、按 hash 复用、离线保留、归档成员和大小校验。保留旧 hash URL 有兼容职责，不以“旧文件”直接要求删除。
- 更新器整包下载是当前明确配置；未仅因存在重试、完整性核验或转发控制器建议移除。NSIS 新音频路径保留/进程归属只做静态跟踪，本轮未跑正式安装器。
- 典型 PEM/GitHub/AWS 字面模式扫描没有发现已确认秘密；唯一 PEM 标记命中是 key-store 的格式判断。该模式检查不覆盖全部秘密形态、Git 历史或运行数据。
- 原生热路径的大型数组、张量和 ONNX binding 复用，输入/输出 PCM 缓冲及 main 排队命令有上限，停止链有回收。首批原生补审未发现新的 P 级问题；未验收驱动内部、听感或长期堆增长。
- 音乐磁盘缓存的 50/300 MiB 容量预算、最多 8 个目录账本及监听关闭链存在；TTL 到期不立即删文件，不足以推断存储无界。统计调用位于初始化和手动清理，未发现高频扫描证据。
- 组件库跨文件/数据库恢复的“隐藏包→场景事务→解除隐藏”有明确的续作合同；多库清空的 partial 回执也明确报告部分提交。不能只因不是一个总事务就判定未知数据损坏。粉丝普通恢复及本机恢复点均有上层事务，DATA-03 的失败回滚实测有效。
- 歌曲导入预览会随输入变化失效，apply 捕获已审阅内容；媒体编辑器有 abort、对象 URL 和解码器回收。抽奖普通不同 ID、粉丝 origin+ID 及授权请求前后复核有保护，但不能替代各自遗漏的持久化命名空间或编辑会话检查。
- 第三批的歌曲替换在事务内重验计划、拒绝坏行并在提交后单次发布；场景删除/切换输出的 savepoint 覆盖绑定与尺寸，失败保留原状态。旧 SC 复制失败的回滚也有效，DATA-04 指向成功去重的等价关系。
- 曲库行删除、场景预设删除、素材移除、互动取消有目标快照或版本/忙锁；“清空全部”按既有合同作用于整个集合，不能凭确认后集合变化杜撰仅清理旧快照的要求。日程取消的草稿丢失不等于误删保存记录。
- 歌词时间线和单词归一化确有预算，但保护发生在上游解析及 Provider 响应之后。合法多时间戳需保留正常语义；暂时高 heapUsed/RSS 样本也不能当作泄漏。
- 第四批的点歌 v13 汇总按已接受规范替代逐次原文；长说明可以原样备份/恢复，时钟回退不丢未来日桶。名单 v14 只压缩未编辑的自动观察，展开后完整记录及历史会员/提醒判断一致。两者的源更新故障均使数据、DDL 与版本一起回滚；不能把有意汇总或压缩误报为数据丢失。详见数据证据（原附件：`tmp/continuous-audit-2026-11-05/backend-round4/report.md`）。
- 启动设置的旧值/默认值和版本标记在事务内转换；失败回滚、重启不重复映射、独立字体之后可分别修改。已修复的旧默认文案检查点没有重开为新问题。加班机 action 的空 catch 上游已显示失败，未因此认定静默吞错。
- 真实礼物查询在 1,000/5,000/10,000 条合成记录、25 类礼物/30 天下，两页共享一次 COUNT，统计只返回 56 个 SQL 聚合行、约 13 KB JSON，单次聚合约 4/20/36 ms。未见足以立项的受测查询缺陷；这些单次数字不代表百万行库、retention 汇总、高基数或真实调用频率，不能据此宣布全库性能合格。
- 第五批补齐 50 天、每版 1,000/5,000/10,000 行的保留期汇总诊断：暂存新版不改变旧统计，激活替换后不双算，清旧版前后结果完全一致。清理后单次查询约 9/51/142 ms、输出约 6.5 KB；这是普通礼物、25 个礼物分组且原始明细为空的单次观测，未覆盖百万行、真实请求频率或全部过滤组合，也不与第四批原始明细样本直接比较优化收益。
- gift v10 的四类旧规则保留原九列，当前领域的重新选择保持加减时、按件及启用规则；wish v15→v20 的旧文案/图片位置经真实 helper 和领域保存往返。转换后版本检查点失败使 schema、行与版本一起回滚，解除合成故障后重试成功。没有把有意的兼容表示转换说成原字段必须字面不变，详见第五批数据证据（原附件：`tmp/continuous-audit-2026-11-05/backend-round5/report.md`）。
- 文本框场景保存有草稿比较与绑定保护，但不能替代页面复制对象的捕获。转盘、精确/定时回复、日词库、欢迎和答谢的所查回调有 dirty/提交版本或禁用保护；互动完成后的 host 读取补充特定就绪信息，未仅因再次读取就判冗余。这些静态检查不等于相应账号生命周期或全部 UI 已验收。
- 第六批普通统计在完整流水参照与混合表示间进行 300 次对照：15 条初始记录（其中一条恰等于 asOf，按既有接口边界排除）及一条迟到 final，覆盖普通礼物、已知/未知成本、负利润、旧名称与 90/30/7 天边界。激活、迟到事件进汇总、部分/完整裁剪、同 epoch 重建和清旧版后，总量/排行/日期均一致。这里的上海统计合同与 DATA-05 本机盲盒日期不同；不是性能、高基数或全部过滤验收。见第六批主证据（原附件：`tmp/continuous-audit-2026-11-05/root/round6-report.md`）。
- 心愿原始事件 oracle 与真实服务在部分日两端、午夜含终点、stale checked_at、旧/新成员共用近期事件、v19→v20 和每批 `[4,4,4,1,0]` 删除后保持一致。活动指针更新的晚期失败撤回已保存贡献及 phase/generation，重试可用；首次较早故障注入仅能证明旧状态保留，其限制已明确。见第六批数据证据（原附件：`tmp/continuous-audit-2026-11-05/backend-round6/report.md`）。
- 真实组件预览 owner 的 dispose-before-ready、重复 ready/模式替换与五次重挂载诊断中，订阅、监听、计时器、观察器及 iframe 都回到初始零值，旧回调不能影响新实例。隐藏页可能按合同保留模块，不能因此报告泄漏；这些是合成计数，不是实际内存、字体或解码器测量。见第六批前端证据（原附件：`tmp/continuous-audit-2026-11-05/frontend-round6/report.md`）。
- 导出在 loadURL、render、动画帧、capture 和 write 等待中取消/销毁时，窗口均释放且不开始下一张；在途写入按既有契约允许完成一张，返回数量准确。虚拟 20 秒超时后的迟到结果没有写文件，合成第二次 ENOSPC 保留首张；定时器在完成后归零。这不验证真实 Electron/GPU/磁盘，也不重复 EXPORT-O1 的布局成本结论。
- 第七批将图片解码期限与整个就绪链分开：decode 失败后可回退，但后续仍等待字体和两帧。真实保存消费者外有 20 秒 bounded；预览在旧字体等待中关闭/重开后，迟到结果不能保存旧设置或覆盖新任务。因此不把局部无总超时报成永久导出挂起。见前端分区（原附件：`tmp/continuous-audit-2026-11-05/frontend-round7/report.md`），字体 CSS 的恢复缺口仍单列 FRONT-08。
- 素材备份正在读文件时，真实清理被 409 阻止；取消解除引用后遇到 Windows 尚未关闭文件流的 EPERM，返回 failed，流关闭后重试成功。恢复副本写失败会以 503 阻止删除；已真实删掉一个合成文件后的部分失败，剩余字节/索引可核对，另一包完成，再次清理及同 ZIP 重导保留原 UUID/参数。见数据分区（原附件：`tmp/continuous-audit-2026-11-05/backend-round7/report.md`）。没有把逻辑解除引用当成句柄立即关闭，也没有把有回执、可重试的部分清理说成静默损坏。

- 第八批实时组合诊断中，游标依次为 `10→11→11→14→15→16`，最终六条终态、六次 final 投递，重复/迟到输入未增加次数；缺口补拉期间断线，数据提交后仍保持 OFFLINE，重连后恢复 LIVE。夹具初次错误地对 after=14 重复返回旧页，被生产校验拒绝；修正响应后通过，断言未放宽。新 controller 复用同进程、同 SQLite 句柄和 projection，不能当作进程崩溃/数据库重开验收，也没有完成高吞吐排队容量验证。见主记录（原附件：`tmp/continuous-audit-2026-11-05/root/round8-report.md`）。
- 批量播放 100/1,000/5,000 首的真实入口，每次只有一次 QueueManager 随机顺序重建及一次 coordinator 保存通知；shuffle-all 另有初始顺序处理，不推断整链只打乱一次。50 次相同渲染或关闭期间渲染不增加 HTML 写入，修改元数据后重新打开正确显示；合成播放边界不证明实际音频/网络调用次数。菜单残留单列 FRONT-09，见前端记录（原附件：`tmp/continuous-audit-2026-11-05/frontend-round8/report.md`）。
- 真实 HTTP 下载暂停后，两次相隔 350 ms 的文件读取量同为 524,288 B；恢复后约 32 MiB ZIP 完整且摘要/CRC 一致。中止后迭代器、文件句柄和锁释放；发头前缺文件返回单一 JSON，发头后 EIO 结束部分 ZIP，没有追加错误 JSON。既有 pipeline 已承担背压；响应队列字节不等同进程内存，`response.blob()` 也不直接证明堆泄漏。见后端记录（原附件：`tmp/continuous-audit-2026-11-05/backend-round8/report.md`）。

## 覆盖与续审条件

| 分区 | 本轮已检查路径 | 未覆盖/待补 |
| --- | --- | --- |
| 安全 | 前两批边界：取色/导出/login IPC、授权请求前后复核、抽奖分区及跨服务器重启；第三至八批没有新增专项完成声明 | 第三批账号切换候选被平台中止；其余 IPC、OS safeStorage、实际外带、Server 全仓 |
| 后端 | 图片缓存、粉丝恢复、歌曲替换、场景事务、旧 SC 去重、数据目录迁移静态分支、歌词解析/展开；点歌 v13、名单 v14、启动设置及查询计数/事务；gift v10 规则与 wish 展示往返、归档本机日期和汇总成本；心愿精确贡献/分批删除/成员替换晚期回滚、混合查询边界和迟到事件换版；第七批补头像缓存基数与过期/失效、素材引用/备份读保护及部分清理重试 | 更多身份/过滤/增量组合、高基数排名、真实头像授权/网络成本、其余迁移/格式展开、全账户备份与进程崩溃、真实长时直播 |
| 前端 | 播放缓存、礼物保存回执、粉丝预览、AI 预设删除、曲库/场景/素材/互动确认、日程取消、云歌单代次、许愿异对象操作、设置/黑名单/加班机 dirty 保护、文本框复制/画布发布；相关回复/互动回调反证；预览 dispose/重挂载计数及三个 data provider；字体失败恢复、图片/字体/帧等待、预览重开后的旧结果；第八批补批量播放/队列渲染及菜单关闭监听 | 其余视图生命周期、导入匹配内的备用平台取消、真实堆/解码器、其余表单并发、全量 overlay 绘制/动画、真实设备/UI |
| 实时同步 | 第八批检查 SSE 事件预算/取消、提交/回调、共享补拉、失效保留、断流/重连与 controller 重建的已提交游标 | progress 高频排队、真实网络、数据库重开/进程崩溃、长期吞吐；不能从合成数量推断生产副作用逐身份恰好一次 |
| 交付 | CDN read/validate/download/extract/commit/close、包定义、audio 导出、依赖调用、更新状态、新 NSIS 音频保留静态片段；礼物导出布局计数、在途取消/超时/磁盘错误；资源完成到 CSS 应用及最终渲染外层期限；第八批补备份真实 HTTP 暂停/中止/发头前后失败 | 正式安装升级、实际图片导出性能与 OS 取消、真实 CDN 故障、原生声卡行为、大备份元数据预算、Electron Blob/RSS 与并发下载 |
| 原生 | AudioSession/Engine、StemSeparator、RubberBand、输入采集、PlaybackOutputContext 及 Node/IPC 队列主要链 | 路由恢复/设备枚举全部内部、硬件/驱动、实际启动耗时与长期内存 |

这是一份调用链覆盖表，不是全目录逐行完成声明。当前不自动开始第九批。若出现相关代码变更或具体故障/成本线索，可优先核查 progress 高频排队、导入匹配内备用平台取消及备份元数据预算；仅有“理论上可能”或未覆盖目录不足以继续扩张。高基数排名、其它解析格式、原生/字体真实成本和 UI/硬件验收也仍未覆盖，不用静态数字代替。被中止的安全路径保持未验证，不换方式重试。已有充分证据的路径只在变化或有实质反证时重验。

主要证据输入的 SHA-256 保存于 `tmp/continuous-audit-2026-11-05/root/source-fingerprints.json`；第二至五批依次核对当时的 28、48、61、93 项并补录到 139 项，第六批扩展到 176+1，第七批到 236+1。第八批确认原 236 份客户端输入和 1 份相邻服务器身份定义未变，核对分区保存的 60 份输入摘要，补录 46 份相关输入，当前为 282+1。摘要只供续审核对版本变化，不计人工覆盖；只读过的测试也不计执行。续审先读本报告和 v9 提示词，再核对工作区及摘要；不从历史第 1 批重新开始。

## 变更范围与限制

只新增提示词、报告、活动计划及其索引；未修改产品代码、维护测试、现行技术契约或用户指南。测试/契约/指南的影响已逐项评估并在各建议标出未来 owner；当前没有修复行为可同步。

复现未连接真实 B 站、音乐或模型账户，没有控制用户 Electron、声卡或数据库。字体与原生成本不得冒充实测卡顿/泄漏，安全源码组合不得冒充实际外带事故。

第三批安全子代理在检查账号切换候选期间被平台自动安全审查中止，提示 `This content was flagged for possible cybersecurity risk.` 未取得可用诊断结果或终稿；已有脚本不证明执行成功。该路径未赋予确认 ID，未计入新增测试或完成覆盖；主代理未换代理、改写请求或直接运行脚本继续被中止的检查。详见分区状态（原附件：`tmp/continuous-audit-2026-11-05/security-round3/status.md`）。随后只读查询本次审计标识的 Node 进程，匹配数为 0。

自动审批拒绝删除自建的微小夹具目录 `tmp/continuous-audit-2026-11-05/backend/gift-event-loop-2cQLJN/`，仅返回 `blocked by policy`。目录原样保留，未切换工具或 API 绕过。其它分区自有测试已结束，无遗留测试服务或子进程。

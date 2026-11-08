# 客户端重复计算修复与复审

Status: Completed

## Goal

修复 2026-11-08 客户端性能审计确认的 F01–F08，并沿通知、数据读取、传输和渲染链路再查成倍重复工作；用同类合成输入对比工作次数，保持产品行为、权限、恢复和数据完整性。

审计原始证据保留在仓库 `output/client-performance-audit-2026-11-08.md` 和 `tmp/client-performance-audit-2026-11-08/`。修复证据放 `tmp/client-performance-fixes-2026-11-08/`，最终独立结果报告放 `output/`。

## Non-goals

不替换框架、添加服务或运行时依赖，不改变随机规则、场景权限、存储格式或登录成功条件，不操作真实用户数据、正在运行的桌面应用或独立 lira-server。不提交、不暂存、不创建分支。保留其他工作正在修改的弹幕、礼物等文件内容。

用户在实施中明确纠正：歌库已有专门优化且实际不卡顿，不允许因审计改变原有显示、布局或使用方式。已提出的分页、页码跳转及配套布局撤回，恢复原整表显示；不改变体验的去重和后端修复保留。合成工作计数只能证明重复工作，不能证明用户存在卡顿或授权改变交互。

## Current Behavior

- F01：歌库整表和筛选选项反复重建，隐藏页仍创建 DOM；5000 首形成 95000 表格元素。
- F02/F03：几何变化提前触发共享外观读取；同值返回逐项广播并唤醒所有图层，8 类×32 层产生 256 次默认状态读取。
- F04：admin WebSocket 的礼物快照反复携带未变 lyricTimeline；普通弹幕已有增量和同微任务合并。
- F05：混合场景歌词更新读取并传播不变 queue/wheel/games；转盘重建 SVG、绘画全量重画。
- F06：WeSing 稳定轮次同一日志重复发现和解析；现有 watcher、限频和迁移恢复不能删除。
- F07：随机点歌无匹配后，自动回复调用不使用结果的整库描述扫描。
- F08：登录窗每 1.5 秒仅判断 loggedIn，却同步读取和解密备份元信息。

## Ownership And Contracts

| 工作 | 源码 owner / 消费者 | 测试与文档 owner |
| --- | --- | --- |
| F01/F07 | `public/js/admin/songs.js`、`song-library-filters.js`、歌库页面；`src/bilibili/bilibili-message-handler.js`、song service | `test/songs/`、random filter/message tests；`docs/reference/frontend/app.md` 与 `docs/reference/backend/music/services.md` |
| F02/F03 | `canvas-shared-appearance.js`、`component-config-controller.js`、`scene-item-controller.js`、canvas view/model | `test/admin/` 场景/配置用例；`docs/reference/frontend/app.md` |
| F04 | `src/server/ws.js`、`runtime-transport.js`；管理端状态与 socket 消费 | `test/transport/`、admin state；`docs/reference/backend/ws.md` |
| F05 | `src/server/scene-components.js`、`scene-extra-display.js`、scene output；wheel/games renderer | `test/scenes/`、`test/games/`；`docs/reference/backend/api.md`、`docs/reference/frontend/overlays.md` |
| F06 | `src/music/wesing-cache*.js`、`wesing-capture-engine.js` | `test/wesing/`；歌词/WeSing 实现参考 |
| F08 | `src/electron/music-auth-manager.js`、`bilibili-auth.js`、两个 login window | 音乐/B站登录与 Electron 安全测试；Electron/login 实现参考 |

共享文档由主代理统一编辑，子代理只报告需要同步的具体条款，避免并行覆盖其他工作。

## Compatibility Constraints

- 歌库继续完整展示全部结果、不分页，不新增翻页控件；不丢弃尾部记录，不损坏编辑中草稿、筛选、菜单操作和键盘可达性。
- 保留配置快照隔离、dirty/conflict/loading/saving/error、外部变化与旧响应保护。
- WS 优化通过显式能力协商或兼容的增量合同；未协商连接仍获得原完整快照，首连/重连必有完整基线。权限投影和背压不变。
- 场景扩展既有 dataVersions；新 frame、发布版本变化、撤权、恢复必须正确补齐；避免以全对象序列化代替版本读取。
- WeSing 保留同名不同演唱、文件追加/轮换/截断、路径迁移、watcher 失效恢复，不仅按标题缓存。
- auth 内部精简读取不暴露凭据、不弱化 safeStorage/partition/IPC，只省略探测者不需要的元数据工作。

## Proposed Changes And Milestones

- [x] M1：歌库恢复原完整显示，HTML/CSS/使用指南与 baseline 的 SHA256 相同；5000 首及隐藏最新结果、委托操作通过。无匹配随机点歌读取 2→1，回复和队列直接回归通过。
- [x] M2：F02/F03 与新增 C01 几何文档复制已修复；外观读取 60→1，不变轮询无通知，完整文档序列化 240→1。55 个 owner、77 个消费用例通过，键重绑 4 项复测通过；数值及 256 KiB 独立边界对照一致。
- [x] M3：F06/F08 完成；稳定轮日志读取 1,080,328→0 字节，保留元数据恢复核对；40 次登录探测备份解密 40→0。194 项相关用例通过，标题竞态后 28 项和生命周期夹具清理后 15 项通过。
- [x] M4：F04/F05 完成；20 次快照 4,529,251→480,151 字节，混合场景队列读取 20→0，转盘/绘画重复构建归零。66 项传输、33 项场景、18 项游戏、188 项关联集成和9项场景浏览器通过，覆盖旧合同、基线、恢复与权限。
- [x] M5：额外确认并修复 C01–C05：几何文档复制、组件设置投影、队列同值重建、黑名单同值写入、开播无关设置请求。投影14项通过，歌库及消费阶段54个不同测试通过，末次黑名单时钟回拨6/6；其余复审范围与未量化负载在报告中保留。
- [x] M6：相关测试和九份技术参考同步，用户操作保持；歌库指南恢复。1790文件语法、30项架构和10项文档检查通过；任务差异、状态和暂存区已审阅，未暂存/提交。最终结果见下方报告。

## Completion Evidence

最终交付：[客户端重复计算修复与复审结果](../../../output/client-performance-fixes-2026-11-08.md)。逐项计数、准确日志、保留的恢复合同和残余测量范围以该报告为准，不将交叉套件或重跑相加为不同用例总数。

实施期间的分页方案已按用户要求撤销，旧分页探针和截图不再是验收依据；其他有效修复保留。最终隔离 Electron 整表和重复刷新检查已通过；额外点击第5000行的 REPL 操作超时，没有点击/截图成功证据，不计通过。正式浏览器用例覆盖全部记录可达与行操作。自有遗留 Electron fixture 已按命令行核实后关闭；策略拒绝删除的临时合成目录保留。

基线 HEAD：`2ef5f0a36f1691bb16a83a09b2b94bdcc4a80ff5`，以任务开始前2674份文件快照区分用户原有及并行修改；数据保留接线和其他弹幕样式修改均保留，不计本轮归属。未执行全仓测试、实际直播/GPU/DSP长时压测、打包或发布，不以合成计数推断真实卡顿。

## Verification

先运行各 owning suite 的直接相关测试（`node --experimental-vm-modules --test --test-concurrency=4 <相关测试文件>`），复用已有 helper，不创建长期测试基础设施。对重复查询、通知、序列化、节点创建增加最小行为计数断言；不固定毫秒或普通样式结构。

已有审计脚本用于同条件修复前后对照，适应新合同的测量脚本单独保存在修复证据目录，不覆盖原结果。歌库和场景消费者用隔离 renderer/现有浏览器验证，Electron 运行隔离参照根规则，不启动用户主应用。

全部并行编辑稳定后运行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`，以及因 WS/Electron 合同变化实际需要的合同/安全测试。跨域集成验证根据改动覆盖面选取；若需要整套测试，先停止各代理编辑，收集失败后诊断再重跑，不在执行中改源码。

最后运行 `git diff --check`、`git status --short` 并与本任务开始时的文件快照比对，确认没有覆盖原有改动或引入运行数据。

## Rollback Or Failure Handling

依靠本任务开始时保存的源码快照及明确文件分工区分任务改动。发现兼容或状态顺序问题先修正 owning layer，必要时仅逆转本任务局部 hunk，禁止 reset/checkout 或整体恢复文件覆盖其他人的修改。工具明确安全拒绝不绕过。

## Done When

- F01–F08 各项都有当前实现和修复后证据，原业务可达与恢复合同成立。
- 再审计覆盖管理页、场景/传输、音乐/登录、本地服务关键传播链，确认没有遗漏的已知成倍放大问题。
- 相关测试和受影响合同/指南同步；验证失败均查明归因，没有将未运行验收标记完成。
- 最终变更经过审阅，用户改动保留，结果报告包含改善数量、测量限制和剩余候选。

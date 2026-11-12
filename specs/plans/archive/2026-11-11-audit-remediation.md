# 功能与基础边界审计修复计划

**Status:** Complete — 本轮纳入的客户端修复及服务端协作修复已完成，相关验证和独立复核通过。Windows签名按用户决定保留为发布前待办，SS-03及条件性结构建议不属于本轮实施范围；未提交、发布、使用真实账号或更改运行数据。

## Goal and architecture

在既有模块内修复具体的数据安全、状态竞态、请求一致性及错误边界缺口，保持正常功能及公开合同兼容。沿用 Electron + 原生 ESM + SQLite 模块化单体，不新增依赖、服务、通用工作流或状态框架。实现由三个已参与审计的子代理按互不重叠的所有者分工，主代理复核并完成集成验证。

审计证据在 `output/architecture-audit-2026-11-11/`；它是定位依据，不替代现行规范。客户端初始工作区干净；服务端已有244删除、26修改，基线保存在 `tmp/modularity-fixes-2026-11-11/server-before.patch` 与状态清单，逐项保留。

## Scope and boundaries

| 所有者 | 本次修复 | 主要实现/测试/文档 |
| --- | --- | --- |
| 桌面子代理 | D-01 主窗口沙箱；D-02旧IPC复用严格来源策略；D-03登录导航重定向；D-04快照原子发布 | `src/electron/desktop-main-window.js`、`ipc/license-ipc.js`、两个login-window、auth stores；`test/desktop`、`test/license`、`test/music`、`test/bilibili`；`docs/reference/desktop/` |
| 本地后端子代理 | LB-01写前schema准入；LB-02公开错误分类；LB-03握手验证；MB-01单请求凭据快照 | `src/storage/database.js`、`schema.js`、`src/server/http-utils.js`及涉及routes、`ws.js`、QQ client；对应storage/transport/music suites；storage、server、music参考 |
| 服务端接管聊天 | SS-01备份完整性；SS-02 TTL与签发提交顺序；SD-01已提交结果；SF-01设备列表次序 | 用户授权由「全面审查项目模块化与安全架构」统一实现及验证；本聊天已移交文件并停止服务端写入，保留既有用户编辑。SS-03经复核不实施 |
| 主代理 | CF-01歌词本地断线控制；CF-02歌曲编辑单在途；E3有界资源诊断；E2配套固定契约输入；E1核对签名前置条件 | `public/js/lyrics/desktop-lyric-renderer.js`、`overlays/lyric-window.js`、`admin/song-editor.js`、`src/resources/resource-library.js`；现有lyrics/songs/resource suites及owner文档 |

每个工作包先阅读现有owner、规范和测试，重现相关失败后修改，并将精确命令/结果交回主代理。共享文档冲突先协调；子代理不编辑本计划或计划索引。

不自动实施 E4、D-05、LB-04、SD-02/03、MB-02 的条件性/纯结构建议。CF-03只明确旧诊断页支持范围，不扩大授权。SS-03经复核属于新增管理员撤销/改密能力，本轮不实施，理由见执行记录。SD-01把诊断失败与业务失败分开，不增加outbox。E1沿既有签名计划的发布者/证书约束处理；用户已决定暂无证书，保留为发布前待办。

## Milestones and verification

- [x] M1 数据保护：拒绝必需源缺失的自动备份且保留旧快照；旧应用写前拒绝超前schema，普通首次初始化/升级及optional库行为保留。现有backup与storage suites已扩展并通过。
- [x] M2 操作一致性：歌曲保存单在途且新草稿保留；歌词断线停止本地动画且真实版本重连继续；QQ body/header/sign同源；Admin旧GET不覆盖写后状态；歌库成功不因诊断记录失败报500。各owner行为测试通过，未增加全局并发控制器。
- [x] M3 桌面边界：真实sandbox preload可用、license首次激活与管理路径均可调用、外部frame不能调用；登录必要域名跳转保持而外部redirect拒绝；快照写失败保留旧文件。159项通过，含2个真实隔离Electron fixture；未启动用户主程序。
- [x] M4 HTTP与身份：未知故障稳定500并保留诊断，已知业务拒绝状态不变；有效WS浏览器握手继续通过；无效TTL在启动拒绝且签名失败回滚。直接消费者及有关契约通过；Admin账号级撤销已明确移出本轮。
- [x] M5 工程整合：资源失败具备有界脱敏原因，15项通过；固定server检出与10份fixture通过现有契约检查，110项消费者通过，不修改锁来掩盖错配；签名按用户决定保留为发布前待办。
- [x] M6 最终审查：对应规范、技术参考与用户指南影响已核对；客户端文档、语法、架构门禁及服务端文档/协议检查通过。修改冻结后完成影响范围的完整文件回归，两仓diff/status及原有修改保全已审查；归档后再运行客户端文档门禁确认链接。

Node测试沿用仓库runner或 `node --experimental-vm-modules --test <所属文件>`。服务端沿用 `scripts/run-with-node.cjs` 和隔离test-mode；测试不读真实.env或运行库。Node替身不能替代Electron sandbox/IPC能力，按真实影响补对应桌面fixture。全套测试若运行必须先冻结所有产品和测试编辑；失败集中诊断，不连续盲跑。

## Failure handling and done when

保留已有接口、namespace、Cookie编码、加密方式、正常业务错误及授权分层。只回退本次编辑，不执行reset、广泛checkout或删数据。新增限制只放在实际不可信输入、写入提交或持久化解码边界，不在每个消费者重复。

完成要求是每个纳入项有实现与针对性证据，代码/文档一致、没有越权扩域，原有修改保留。外部证书或真实服务要求不能以模拟通过冒充完成；先完成能独立验证的修复，再明确记录确实缺少的外部条件。不能保证数学意义零bug，以失败复现、保留正常路径及独立审查控制回归。

## Execution evidence

2026-11-11：当前状态已核对；Live干净，Server原有270项状态保留。工作目录为 `tmp/modularity-fixes-2026-11-11/`。

同日发现服务端聊天「全面审查项目模块化与安全架构」正在同仓实施相同问题；用户明确授权跨聊天协调。服务端子代理立即停止写入、不回滚，已将10个涉及文件、重叠测试及未实现的SS-03交给该聊天统一收尾。本聊天继续客户端，服务端批次118项中113通过的结果因并发编辑不作为最终证据；服务端实现、规范和最终验证由接管聊天负责，不把两边结果重复计数。

客户端CF-01/02的失败复现见 `frontend-before.log`（39项中两项复现）；修复后同组39/39通过。歌词既有浏览器布局、surface及场景消费者51/51通过。资源E3先复现两项诊断缺失，修复后resource-library共15/15通过，包含完整离线缓存静默和取消不误报。

E2复用已有干净检出 `tmp/v6.1.5-server-contract`，固定HEAD为锁文件中的 `67119e81a3f5f49470ed2b191f6552556d0a704e`。设置本次进程 `LIRA_SERVER_ROOT` 后 `npm run verify:contracts` 的10份fixtures全部通过，锁文件未改。

E1已确认：用户明确回复「暂无证书，保留为发布前待办」。本次不接入正式签名，后续仍由 [Windows签名计划](../windows-code-signing.md) 跟踪发布者、证书与执行策略；该计划和当前索引已按用户决定标为Deferred。CF-03只纠正旧gift-audit诊断页的支持范围和来源缓存限制，不新增入口、扩大授权或改写未支持的页面。

SS-03重新核对后不实施：现有Admin没有改密入口，退出清Cookie符合当前契约。新增账号撤销/改密命令和旧JWT失效规则属于新功能，风险依赖令牌复制等前提，不能将它冒充已存在的功能bug；按用户避免不必要代码的要求保留为审计后续建议。未增加HMAC版本、表结构、命令或强制重新登录；初始实施设想由此收窄。

客户端整合验证：11个受影响offline域、258文件共1989/1989通过；另10个固定契约文件110/110通过。首轮整合的3项失败来自歌曲表单旧DOM替身缺querySelector，以及音乐路由旧替身未标记模拟的业务错误；只更新这两份测试夹具，相关15/15通过后，重新跑同一冻结整合范围全部通过。未运行未改动的installer全套，也未纳入其他聊天正在编辑的周表/主题代码。`npm run check`检查1835个JS文件通过，文档10/10、架构29/29通过。

两位非实施代理完成只读交叉审查：桌面D01–D04、前端CF01/02、资源E3、schema准入及WS未发现额外实质问题；发现的礼物身份校验漏标已在所属owner修复并补入真实HTTP业务错误表，先复现500后验证恢复400与重选提示。实际提供商登录/直播实播、断电持久性不在本次合成隔离验证范围。

服务端接管聊天已完成M01–M08及交叉复核：43个完整Node文件共473项通过（最终41文件467项执行，加2个未失效完整文件6项复用）；4个完整浏览器文件139/139通过，文档/协议59/59通过。社区夹具的共享脚本被模拟域名的Host策略拒绝，补齐夹具加载后完整复跑通过，生产策略未放宽。`git diff --check`通过，初始244删除保留；原有26修改已逐项区分和保全。详细证据位于 `D:/Work/lira-server/tmp/modularity-fixes-2026-11-11/completion-report.md`。

最终交付记录为 `output/architecture-audit-2026-11-11/remediation.md`。客户端技术参考与测试已同步，正常用户操作步骤不变；服务端创建管理员账号的说明已随隐藏输入改动同步。周表、主题及其指南的并发编辑已保留，不归为本轮修复。

清理限制：工具安全策略在执行前拒绝删除 `tmp/lira-lottery-future-8bRIm1`，原文为 `rejected: blocked by policy`，未提供具体理由。目录已保留，没有换工具或路径重试；临时数据未加入受版本控制的差异。

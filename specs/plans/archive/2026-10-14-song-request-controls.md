# 点歌资格、配额、身份冷却与用户黑名单

Status: Complete

用户授权并行实现前四项，新增项默认无要求或额外限制；不提交、发布或操作真实直播数据。

## 目标与边界

在现有点歌规则页补充每人同时排队上限、舰长/提督/总督独立点歌间隔、按 UID 的用户黑名单及本直播间身份资格。普通弹幕、随机点歌（含桌面随机按钮）和 SC 点歌走同一规则；主播从歌库手动入队保留现有能力。规则只限制新请求，已有队列不删除，LIVE 与现有排序不改变。暂离、SC 独立收费规则、自动收款及播放器不在范围内。

## 字段契约

本地 settings 保持字符串；云端返回规范数值、布尔值和数组。所有新增字段均为可选，老端省略保留已存值。

| 字段 | 本地默认 | 范围与语义 |
| --- | --- | --- |
| userQueueLimit | `0` | 0–300；0 不限制，按稳定点歌用户身份统计活跃队列，包含 LIVE |
| userCooldownCaptainSeconds | 空串 | 空串沿用通用间隔；0–3600 秒，0 明确不限制 |
| userCooldownAdmiralSeconds | 空串 | 同上，提督 |
| userCooldownGovernorSeconds | 空串 | 同上，总督 |
| songRequestMinMedalLevel | `0` | 0–100；0 不要求粉丝牌，非零要求本直播间粉丝牌达到等级 |
| songRequestGuardLevel | `0` | 0 不限，3 舰长及以上，2 提督及以上，1 总督；与粉丝牌要求同时满足 |
| songRequestGuardMedalBypass | `false` | 开启后本直播间有效大航海可免粉丝牌要求，不豁免大航海等级要求 |
| songRequestUserBlacklist | `[]` | 最多 200 项 `{uid,name,expiresAt}`；uid 为 1–25 位正整数文本且唯一；name 可省略、最多 80 字符；expiresAt 可省略为 0，0 永久，其他为不超过 253402300799999 的正整数 Unix 毫秒时间，到期自动失效 |

身份由现有 B 站入口与按直播间隔离的 user-info 证据提供；不接受昵称为身份或外间粉丝牌作为资格证据。缺少规则所需的可验证身份时拒绝并解释。黑名单用 UID 匹配，昵称仅帮助辨认；观众权限不能由客户端 body 授予。被拒绝不消费用户/歌曲冷却、不写请求或配额。资格、黑名单、配额不因 SC 自动置顶绕过。

## 所有权与并行工作

- 规则代理：`src/bilibili/bilibili-message-handler.js`、B 站身份入口、`src/music/queue-service.js`、`src/storage/queue-store.js`、`src/server/domain-services.js` 与对应领域测试。复用存储事务与现有拒绝/自动回复，不增加数据库 schema。
- 界面代理：`public/pages/admin/song/request-rules.html`、`public/js/admin/settings-form.js`、必要的界面模块和 CSS、前端测试及应用内指南。复用表单草稿与保存机制，名单操作先编辑草稿、统一保存。
- 服务器代理：`D:/Work/lira-server` 同步默认值、标准化、租户持久化、OpenAPI/fixture、相关规范与测试。只同步规则，不移走本地点歌职责。
- 主代理：客户端 `settings-defaults` / `settings-contract` / `cloud-settings` 及其测试，技术参考、计划、集成验证与隔离 Electron 验收。保留现有歌词、身份排序及服务端礼物等工作。

## 安全、兼容与失败处理

沿用桌面/Device/账号授权与现有路由；API 整批验证后写入，SQL 参数化，名单输出转义，不投影到公开 overlay。不添加依赖、服务或前端构建。存储层持有配额计数和入队事务，不用可被改名绕过的昵称计数。云端按已认证租户保存，省略字段不重置；保存失败保留草稿。失败时仅修复/撤回本任务补丁，不回滚别的未提交工作。

## 里程碑与验证

- [x] 固定无额外限制的默认值、严格输入及旧端兼容；客户端 settings-contract 与服务器设置/HTTP/隔离测试通过。
- [x] 实现三种观众入口统一资格、配额、黑名单、分身份冷却；覆盖边界、未知/外间身份、改名、到期、失败不记冷却、完成释放名额、LIVE/置顶不绕过及重启。
- [x] 完成规则界面、期限名单编辑、保存/失败/草稿/清空、转义与相关指南；现有前端测试扩展通过。
- [x] 隔离 Electron 使用 tmp 合成数据，验证默认值、保存重开、身份间隔、黑名单添加/删除、资格与配额拒绝及 LIVE 不变；更新受影响指南截图。
- [x] 受影响完整测试文件、文档/架构门禁和必要语法检查通过；初次架构门禁的独立并行改动失败及恢复见下文。最终两仓差异、`git diff --check` 与状态检查完成。

完成条件：四项可配置、默认不额外限制，相关测试与桌面检查有实际证据，两端契约和使用指南一致，未验证的真实直播/部署边界明确记录后归档。

## 2026-10-14 完成证据与边界

- 客户端设置、账号切换同步恢复与公开 overlay 隐私 44/44；领域核心 10 个文件 96/96；前端及启动/指南 42/42。附加身份/冷却/粉丝档案边界最初 46/47，唯一 v13 测试伪降级夹具与本会话 LIVE v16 冲突，改为真实 v12 建库后，迁移与服务器身份桥接 8/8 通过。没有修改生产迁移来绕过测试。
- 最终组合命令 `node --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/settings/frontend-song-request-user-blacklist.test.js test/songs/queue-service.test.js test/songs/queue-random-request.test.js test/bilibili/server-bilibili-client-avatar.test.js test/fan-profiles/fan-song-retention.test.js test/admin/usage-guide.test.js` 为 64/64；15 个受影响源文件 `node --check` 通过。
- Server 四个设置/同步/Device HTTP 文件 38/38，`npm run docs:check` 55/55。两端字段默认值、可选输入、严格名单、旧端省略保留及原子拒绝对齐，未部署。
- 隔离 Electron 用生产 preload、桌面会话认证和真实 HTTP/SQLite owner，10 项合成验收通过：默认放行；改名仍受配额；永久 UID 拒绝；期限到期随机放行；名单删除、未知与达标粉丝牌；舰长 0 秒覆盖通用 30 秒；免牌仍受大航海等级约束；重启恢复 7 首队列与规则；LIVE 配额与 SC 第二位、完成释放；无效 UID 阻止保存。无 pageerror。截图更新 `song-settings-rules.webp`，证据留在忽略的 `tmp/song-request-controls-electron-evidence.json`。
- 技术参考 API/存储/音乐服务/弹幕入口/前端以及 Server 协议、OpenAPI、规范/验收和应用内指南均同步。README 与引导教程没有这些字段的逐项说明，入口未变化，不需重复添加。
- `verify:architecture` 初次 26/27，失败来自独立并行任务新增的 `src/music/netease-client-monitor.js` 空 catch，点歌任务未改该文件或绕过门禁；观察到该并行文件已修正后复查 27/27 通过。文档门禁最初指出本计划状态格式不被识别，改为规范 `Status:` 并完成归档后 `verify:docs` 10/10 通过。
- 未对真实直播间发送、接单或修改真实设置，未提交、打包或部署；实播与安装版升级不属于本次合成验收。Electron PID 8052 与重启后的 42848 均已关闭。自动审批拒绝删除 `tmp/song-request-controls-electron-38PQQz`（blocked by policy），合成数据保留；不重试其他删除方式。先前被拒绝清理的目录也未触碰。

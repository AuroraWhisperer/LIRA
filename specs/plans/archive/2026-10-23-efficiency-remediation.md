# 客户端与服务器效率修复实施计划

Status: Completed

范围来自 2026-10-23 两轮审查及用户“并行把所有找出来的问题修复”的授权。

## 目标与边界

修复已复现的 16 项效率问题与 2 个较小项，减少重复计算、读取和传输。保持公共 HTTP/WS/IPC、账号与租户隔离、持久化兼容、缓存新鲜度及故障恢复；不改服务划分，不引入依赖，不提交或发布。保留两仓开始时已有的用户改动。审查探针和结果位于两仓 `tmp/efficiency-review-20261023/`，只使用合成数据。

## 当前证据

确认的重复工作包括：每次歌曲比较重新处理 locale；禁用固定回复仍读取全部配置；歌曲筛选及自身变更重复刷新；上传自身 SSE 回声额外拉取；无关 SQLite 写入使歌曲元数据失效；同 scope 的 WS 重复序列化；QQ 喜欢每页读取整份列表；粉丝短窗口计算全年提醒；服务器隐藏页签轮询；场景盲盒重复统计；样式索引重复读盘；粉丝事实页身份 N+1；粉丝搜索刷新全局提醒；音乐缓存每写全目录 stat；账号失效后分页继续；舰队同步并发重复；全屏歌词重复遍历；礼物保留元数据重复读取。

## 并行所有权与里程碑

- [x] 音乐组：`src/music/`、`src/storage/song-store.js`、播放器 content loader/fullscreen；修复排序、歌曲变更标记、喜欢分页、缓存容量、失效任务及歌词节点更新。验证 locale 排序等价、事务回滚与外部连接可见、账号隔离、准确淘汰、导航后台刷新及歌词 seek。
- [x] 粉丝/场景组：`src/fans/`、admin fans、scene extra/shared appearance 与 component-style storage；按查询窗口生成提醒、搜索不刷新全局提醒、缓存盲盒统计及样式读取。验证跨日、历史处理状态、来源变化、文件外部更新与恢复。
- [x] 服务器组：`D:/Work/lira-server` 的 fixed reply、admin detail、fan fact、guard roster、gift query；减少配置读取、隐藏资源轮询、身份查询、重复上游同步及 retention 查询。验证关闭/更新即时可见、管理员权限、用户身份区分、单等待者取消隔离和删除/房间变化。
- [x] 主线程：`public/js/admin/state.js` / `app.js`、`src/electron/cloud-sync-controller.js`、`src/server/ws.js`；减少歌曲刷新、上传回声重复 GET、同 scope 序列化与不必要状态读取。验证在途变更不丢失、外部 SSE 仍刷新、慢客户端独立处理、scope 投影无泄露。歌曲模块原有用户改动保持不动。

每组在原 owner 修改并同步直接相关测试与技术参考；跨组接口先协调。用户操作、入口与限制不变时不改用户指南。

## 验证与完成条件

优先扩展既有行为测试，以计数断言证明减少重复工作，并覆盖缓存失效/并发的具体回归风险。客户端使用 `node --experimental-vm-modules --test <相关测试>`；服务器使用其 `node scripts/run-with-node.cjs` 和隔离环境。实际选择的测试文件、结果及额外检查随实施补充，不能把未执行的验证记为通过。

- [x] 各组聚焦测试通过，所有 18 项都有实现与验证结果。
- [x] 检查 owning reference、测试及用户指南的同步影响；客户端 `npm run verify:docs`、服务器 `npm run docs:check`。
- [x] 两仓检查改动 diff、`git diff --check`、`git status --short`，确认原有改动保留且无运行数据、秘密或临时产物进入源码改动。

失败时停止相关实现，保留可审查的局部 diff，定位原因；仅撤销本任务独占行，不使用 reset、整文件 checkout 或广泛删除。真实账号、生产负载、安装包性能不由合成测试证明，本任务不操作这些环境。

## 实施结果

### 18 项完成记录

| 项目 | 实现与证据 |
| --- | --- |
| 歌曲排序 | 复用两种现有 locale 的 Collator，排序边界测试通过。 |
| 固定回复关闭路径 | 每条弹幕 4 次全配置 SELECT 降为 1 次开关 SELECT，发送前校验不变。 |
| Admin 歌曲刷新 | 筛选只读 songs；消费先到的防抖通知；相同请求合并，断线 mutation 强制失效旧请求。 |
| 上传 SSE 回声 | 排队前后合并并核对各 scope 的最高 revision；自身已消费通知不再触发后续 GET。 |
| 歌曲元数据 | TEMP 触发器记录歌曲/分类写入；无关同连接写入不失效，回滚和外部连接提交仍正确。 |
| 本地 WS | 按认证类型/scope 复用帧；仅 overlay 时选择读取所需域，保留 Admin 和旧 games 全快照兼容。 |
| 喜欢歌单分页 | QQ 同次加载复用歌单定位及整份详情；网易复用定位并保留真正分页，凭证和歌单变更失效。 |
| 粉丝提醒窗口 | 500 档案列表 188500→8000 次计算，提醒 188000→8000，日历 188000→6000；详情及已处理历史预测保留。 |
| Admin 隐藏资源轮询 | 按当前页签请求；监控查询限定主播；概览历史 500→5 条，按规范化事件时间及公开 ID 排序后截取。 |
| 场景盲盒统计 | 同日未变化的 20 次读取只扫一次明细；来源/修改/回滚/跨日失效覆盖。 |
| 样式索引 IO | 共享已验证索引并检测双文件指纹；重复创建 store 不再读 JSON/扫目录，临时文件清理每小时至多一次。 |
| 服务端粉丝事实 | 同一页按完整身份键复用最新身份查询与解析，缺失身份也复用；跨页重新读取。 |
| 客户端粉丝搜索 | 搜索/筛选不重读全局提醒，首次、修改、30 秒刷新及竞争中的刷新意图保留。 |
| 音乐缓存 IO | 有界目录账本增量统计，超额时全量复核并按真实 mtime 淘汰；监听、清空和退出回归通过。 |
| 失效账号分页 | 当前页返回后停止后续请求，正常导航后台缓存不受影响。 |
| 并发舰队同步 | 同租户/房间共享上游和一次写入，各等待者独立取消/超时，全部退出后取消上游。 |
| 全屏歌词 | 二分定位、缓存节点，仅切换新旧活动行，保留 seek 与模式切换。 |
| 礼物 retention | 同一事务复用已读取的保留信息，不再重复 SELECT。 |

### 实际验证

客户端测试均使用 `node --experimental-vm-modules --test`，临时根目录设为仓库 `tmp/efficiency-review-20261023/`。以下为不同测试文件的分组，后续只针对修改处复跑：

- 主线程 316 项：`test/cloud-sync/*.test.js`、`test/transport/*.test.js`、`test/admin/admin-state-ordering.test.js`、`test/admin/admin-state.test.js`、`test/admin/admin-state-renderer.test.js`、`test/overlays/overlay-projection.test.js`、`test/server/runtime-event-publication.test.js`、`test/songs/song-library-filter.test.js`。全组首轮 290 项；随后增加两项兼容/断线回归并聚焦验证，再补管理状态相邻 24 项。
- 音乐 95 项：`test/songs/song-metadata.test.js`、`test/songs/song-service-boundary.test.js`、`test/music/qq-provider.test.js`、`test/music/netease-provider.test.js`、`test/lyrics/lyrics.test.js`、`test/playback/frontend-playback.test.js`、`test/playback/playback-home-lifecycle.test.js`。
- 粉丝/场景 139 项：`test/fan-profiles/{fan-profiles-domain,frontend-fan-profiles,fan-guard-accompany,fan-profile-list-queries}.test.js`、`test/scenes/{component-style-recovery,component-styles,component-style-parameters,shared-appearance,scene-extra-components}.test.js`、`test/gifts/{blind-box-analysis-dates,gift-query-service,gift-source-snapshot}.test.js`。
- 客户端 `npm run verify:docs` 10 项、`npm run verify:architecture` 28 项通过；`npm run check` 校验 1644 个 JS 文件通过。
- 服务器以 `node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test` 执行 fixed-reply、guard-roster-sync、gift-retention、admin-live-state、admin-monitor-status、streamer-overview-api、fan-facts、admin-tenant-view 共 109 项。后两者使用审计目录隔离 preload，避免读取用户数据。
- 服务器 `node scripts/run-with-node.cjs node_modules/@playwright/test/cli.js test --workers=2`，选择 admin-streamer-detail、presentation、password、gifts 四个文件，共 62 项通过；`npm run docs:check` 57 项通过。

日志在两仓 `tmp/efficiency-review-20261023/`。初轮失败包括 VM 缺少 timer 注入、旧的默认 reloadState 预期、隐藏页签失败展示旧预期及新增空 catch 静态规则；分别修正夹具/显式选项、页签契约测试和实际 fallback，相关复跑已通过。没有靠重复全量执行掩盖未解释失败。

### 同步与限制

已同步 owning API、音乐/存储、粉丝/场景、云同步、WS 与服务端 Management OpenAPI/REQ/AC；用户入口、操作和可见限制不变，因此不额外改指南。唯一容量语义细节：音乐缓存自身写入准确计账；外部进程原地改文件在通知后下一次写入、统计或淘汰复核时收敛，不承诺跨进程同一事件循环内的容量一致性。监控新增可选 streamerId 查询保持已有无参数接口及认证。

以上是隔离合成/浏览器验证，不代表真实账号、生产负载或新版安装包验收。没有提交、打包、部署或操作用户运行实例。

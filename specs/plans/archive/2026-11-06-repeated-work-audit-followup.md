# 重复计算并行复审

Status: Completed (2026-11-06)

## 目标与边界

用户允许并行审计后，继续沿弹幕处理、礼物同步和播放队列的真实调用链确认重复工作。首轮五处修复及证据已在 [首轮记录](2026-11-06-repeated-work-audit.md) 完成；本轮只处理新确证问题，保留全部已有工作区修改，不提交、发布或操作真实账号。

## 确认项、所有者与约束

1. `src/bilibili/custom-reply-service.js` 每次匹配都解析、规范化整份固定规则，`src/bilibili/danmaku/message-handlers.js` 又对同一条消息判断两次。30 条规则、1,000 条普通聊天计数为 3,000 次解析和 90,000 条规范化。按规则字符串复用解析结果，并在入口复用本条命令判定；保留数组输入的即时语义、设置立即更新、规则顺序、云端归属和返回对象隔离。测试 owner 为 `test/bots/custom-reply-service.test.js` 与现有消息入口套件；参考归 `docs/reference/backend/bilibili/danmaku.md`。
2. `src/bilibili/gift/hybrid-catalog.js` 的图片 resolver 为少数许愿生成完整目录快照。图片修订包含秒数，三秒轮询时全部失效。真实 owner、2,000 个礼物、20 次轮询，即使 0 条许愿仍打开图片文件 40,000 次；10 条许愿也相同。索引只按目录和自定义配置变化重建，图片按实际消费 key 检查；保留完整目录快照的完整性检查、房间优先、下载后立即刷新、外部损坏/删除一秒后重检、来源隔离与返回对象独立。具体实现须先核对 cache owner 和现有测试。参考归 `docs/reference/backend/bilibili/gift.md`。
3. `src/bilibili/gift/variant-room-catalog.js` 每个自定义盒与产物都 filter 全目录。2,000 个礼物、1 盒 20 产物计数为 42,000 次比较；同次合并只需建立一次精确身份索引。保留 `(id,name,priceRaw)` 精确匹配及重复身份返回 `null`，不改变排序、覆写和公共目录格式。沿用所属目录测试，参考归礼物域。

## 执行与验证

- [x] 关键词规则缓存与单消息判定复用：1,000 条消息、30 条规则的解析次数 3,000→1，规范化条目 90,000→30，关键词 service 设置读取 3,000→2,000（原设置库已有缓存，这不是 SQL 次数）。动态更新、开关、返回对象隔离和数组原地编辑回归通过。
- [x] 自定义盲盒目录索引：2,000 个目录礼物、1 盒 20 产物，目录 ID 字段读取 42,021→2,021（含 21 次必要输出拷贝），查询输入 ID 读取 42,000→21。输出摘要相同；无自定义配置时不额外建立索引。
- [x] 礼物图片按需解析：2,000 个礼物、20 次轮询，空愿单的图片文件打开次数 40,000→0；10 条许愿为 40,000→200。冷/暖缓存、下载后即时刷新、外部损坏/删除一秒复查、房间优先和快照独立回归通过。
- [x] 已更新 `danmaku.md` 与 `gift.md` 所属技术参考；功能入口、操作步骤、配置和输出未改变，用户指南及应用内引导无需修改。
- [x] 聚焦回归、新增修改的 7 个 JavaScript 文件语法及架构门禁 28/28 通过，产品和测试差异已审查。
- [x] 文档门禁 10/10 通过，完成计划归档与本任务差异审查；`git diff --check` 通过，未将计数探针、运行数据或契约检出加入差异。

审计代理只修改各自分配的产品与测试文件；主代理维护计划和技术文档，避免同文件并发写入。临时探针位于 `tmp/repeated-work-audit-parallel-2026-11-06/`。先确认具体失败和调用量，再修改；若行为不等价，仅逆向撤销本轮小段。测试使用隔离状态，计数不等于实机 CPU 或帧率收益。

关键词 service 的既有定向回复测试扩展了缓存复用、配置更新和结果隔离，修改前复现 43 次解析而预期 1 次；新增同一个数组原地编辑的回归。下列相关回归 25/25 通过，其中资料 poller 两项与首轮重叠：

```powershell
node --test test/bots/custom-reply-service.test.js test/danmaku/danmaku-client.test.js test/bilibili/message-deduplicator.test.js test/bilibili/bilibili-user-info-pollers.test.js
```

对比探针：`node tmp/repeated-work-audit-parallel-2026-11-06/danmaku/measure-custom-replies.cjs before` / `after`。使用真实消息入口和关键词 service，未命中消息均正确交付且不进入命令去重。

礼物图片三套回归先通过 40 项；最后保留原 `roomSnapshot` 更新副作用后，hybrid 与图片缓存 20 项重跑通过，许愿 20 项也重跑通过。随后自定义身份的纯本地用例串行加入同一 hybrid 套件，最终该套件 7/7 通过。三套合计 41 个不同用例，不重复计算重跑。新增图片用例在修复前复现 `1001 !== 0`，精确身份用例覆盖同 ID 不同名称/价格、歧义盒子/产物拒绝匹配、顺序与去重。

```powershell
node --test test/gifts/hybrid-gift-catalog.test.js test/gifts/remote-gift-image-cache.test.js test/gifts/gift-wishes.test.js
```

`gift-identity-catalog` 与 `gift-category` 首次受默认服务器检出版本不一致阻断：锁要求 `67119e81a3f5f49470ed2b191f6552556d0a704e`，开发检出为 `818ddfa5a41c3d0af20c931892d7556bf12584ae`。本轮未改变锁或原断言；在根 `tmp/` 建立该锁定提交的独立 detached 检出，通过 `LIRA_SERVER_ROOT` 指定它，10 份 fixture 的提交/摘要校验以及两套 7/7 回归通过。验证后检查其工作区干净并移除了本任务创建的检出，原服务器工作区保持原版本。

```powershell
node scripts/verify-server-contract.js
node --experimental-vm-modules --test test/gifts/gift-identity-catalog.test.js test/gifts/gift-category.test.js
```

图片计数基线及结果在 `gift-sync/before-counts.json`、`gift-sync/after-image-counts.json`；变体专用计数在 `variant/counts.json`，目录均位于本轮 `tmp/`。变体输出 SHA-256 两版均为 `e7ab696e019526ff0958a70d0d58a28603c58c2d252cec4245a73afe5d000841`。旧通用探针只统计 filter 回调，其优化后零值不能代表总工作量，因此采用包含索引构建和输出拷贝的专用计数。

本轮不同相关用例合计 149 项（关键词 25、礼物本地 41、目录契约 7、播放分支 76）；其中两项资料 poller 与首轮重叠，两轮合计 261 个不同相关用例。

## 已排除与覆盖限制

播放分支未确认新缺陷：进度事件不触发全界面重绘，关闭的队列弹窗不扫描，歌曲导入完成后一次性批量插队，QQ/网易云分页与曲目元数据已有缓存。现有 `playback-queue-behavior`、`qq-provider`、`netease-provider`、`netease-client-monitor` 共 76 项回归通过；未控制真实播放器。UIA 降级扫描涉及外部句柄恢复，尚无安全移除依据。

场景输出已缓存发布文档和类型索引，共享外观在一次请求内按样式去重，通知读取有合并和速率限制。样式索引的整库复制仍只是一条待量化线索，本轮不据此扩展存储接口。礼物 final 同步已有即时提交与共享缺口恢复，未证明进度队列可安全合并。

当三项确证问题完成修复与相应验证、技术文档一致、最终差异审查完成时收束本轮；保留未覆盖的实机与外部服务边界，不宣称全仓没有其他效率问题。

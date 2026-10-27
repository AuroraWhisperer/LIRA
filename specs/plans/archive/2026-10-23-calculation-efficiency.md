# 重复计算与批处理优化

Status: Completed

## 目标与边界

继续用户已授权的两端并行效率修复，定位可由逐项重复计算转为一次准备、索引查找或按变化更新的真实热点。保留前两轮成果、所有既有未提交改动和公共行为。仅对已确认调用链和合成计数的热点实施，不削弱权限、租户范围、事务、回滚或匹配歧义规则，不新增依赖、持久格式或服务。暂不提交、打包或部署。

## 所有权与验证

| 分组 | 范围与决策 | 验证 |
| --- | --- | --- |
| 主线程：歌曲批处理 | `src/storage/song-store.js`；同批分类复用、移除无人消费的插入回读、复用批处理 SQL。单首保存返回结构和批量原子性不变。 | 真实隔离 SQLite 计数；song-import-update / song-import-limit / song-metadata 及相关同步用例；storage 技术参考。 |
| 音乐组 | `src/music/random-song-filter.js`；每次筛选编译条件，避免每首重复遍历固定别名。`public/js/playback/ui/fullscreen.js`；按歌词数组复用翻译/罗马音存在判断。 | 5000 首×3 条件、500 行×100 次更新计数；随机匹配及播放器用例；music/services 与 frontend/playback 参考。 |
| 场景组 | 核对工作台日历/备忘索引、场景文档重复解析、横幅礼物匹配；只修收益明确且保持契约的部分。 | 日历/排序/重复身份/文档更新与权限撤销回归；具体证据随发现记录。 |
| 服务器组 | 核对礼物 variant/盲盒关系重复全表扫描与特效绑定；目录索引须保持 ID/名称歧义、身份隔离和更新可见。 | 合成目录×事件计数、估值/匹配/目录换代回归；依 owning normative 同步。 |

各组只编辑分配范围，先汇报候选再实现；不同时运行全量测试或修改他组文件。临时材料位于两仓 `tmp/calculation-efficiency-20261023/`。输入本身必须处理的线性工作不计作已消除，分别报告准备次数、字段访问和 SQL 查询次数。

## 完成条件

- [x] 记录已查范围、确认热点、实际旧/新次数；正确性对照和相关回归通过。
- [x] 同步技术文档与必要测试；用户操作不变的指南保持原样并说明。
- [x] 两仓相关文档/架构/语法检查通过，检查最终 diff、`git diff --check` 和状态，无运行数据进入源码改动。

失败按 owner 定位，只修本次变更；不因基线失败批量调整断言，不覆盖用户改动或绕过权限核验。最终只声明已检查和实测范围，不把合成证据当作生产负载保证。

## 进度与证据

- 开始时确认两仓上一轮修改仍未提交，保留原样。
- 随机筛选：5000 首×3 条件实测 30000 次别名解析、970000 次字符串规范化。
- 全屏歌词：500 行无翻译/罗马音×100 次进度更新实测 100000 次字段读取。
- 歌曲导入：5000 首、5 分类的隔离 SQLite 对照，`importRows` SELECT 10008→13，`applyImportUpdate` 10009→14，`replaceAll` 10007→12；SQL prepare 分别 15015→22、15016→23、15019→26。写入次数及最终歌曲/分类逐字段一致；68 项歌曲导入/数量边界/metadata/store/同步恢复回归通过。分类映射限定单次事务，单首保存仍返回整行，独立复核通过。
- 音乐组完成：别名解析 30000→6，字符串规范化 970000→20065；副歌词字段读取 100000→1000。49 项直接回归通过；150 首×21 条件对旧实现的筛选与说明共 42 次等价对照通过。技术参考已同步，未增加跨请求歌曲缓存。
- 场景组完成：500 事件月历/议程日期读取 22500→1000；500 备忘×500 待办 ID 读取 250000→500；每轮 500 次 formatter 构造→0（模块初始化 4 个）。240 次场景授权核验解析 JSON 480→1，随后 20 次输出 80→0；280 次权限数据库查询保留，覆盖撤销/切账号/删除/回滚/外部写入与输出污染。5000 项目录×100 横幅的目录 ID 读取 500000→5000；消费者显式索引新快照，可变旧接口保持即时语义。163 项去重回归通过，技术文档同步。
- 服务器组完成：5000 身份×1000 礼物，估值筛选条目访问 10000000→1000，图片查找条目访问 5000000→0；目录发布时建立一次索引，访问 5000 项，后续事件只做键查找与候选判断，不再注册。真实 `GiftDetector.detect` 重复身份匹配目录访问 4999000→0，零价盲盒通知证据目录访问 10000000→0、关系访问 1000→0。以上完整输出均与旧实现一致；0 指无目录全表扫描，事件处理与键查找仍存在。
- 服务器批量特效：500 特效×500 种子×5000 礼物，种子比较 250000→0（建索引访问 500 项、查询 500 次），礼物比较 2500000→500（建索引访问 5000 项）。索引只存活于单次同步；完整输出与旧实现一致，重复候选、原顺序和歧义规则保留。
- 其他检查：队列读取已使用 JOIN，粉丝列表记录/处理状态已按批读取，本轮未重写；低频搜索等仅作为候选筛查，未将必要的线性处理列为缺陷。
- 客户端最终源码静止后，`npm run verify:architecture` 28 项、`npm run verify:docs` 10 项通过；`npm run check` 校验 1648 个 JavaScript 文件（执行 27，复用 1621 个有效结果）。客户端本轮不同业务用例共 68 + 49 + 163 = 280 项。

## 最终验证与同步

共完成八组优化：歌曲批处理、随机筛选、歌词附加状态、日历/备忘、场景发布文档、礼物横幅、服务器实时礼物目录、服务器特效绑定。必要的输入遍历、写入、鉴权与事件处理保留；不把索引构建成本或剩余候选判断计作消失。

- 客户端业务回归使用 `node --experimental-vm-modules --test`，共 280 个不同用例通过。具体文件与输出见本轮临时目录的 `song-batch-final-tests.log`、`music-tests.log`、`scenes-calendar-gifts-tests.log`、`scenes-gifts-integration-tests.log`。
- 服务器业务回归使用 `node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test`，12 个文件共 120 个不同用例通过：`gift-variant-valuation`、`gift-effect-identity`、`gift-effect-metadata`、`overlay-gift-image`、`gift-catalog-response-cache`、`gift-variant-catalog`、`bilibili-blind-box-valuation`、`overlay-gift`、`gift-variants`、`gift-interaction`、`gift-interaction-free-dedupe`、`gift-catalog-service`，均位于 `test/*.test.js`。实际目录发布、换代、可变数组回退、重复事件和零价通知集成均覆盖；最后目录套件 11 项通过。
- 服务器 `npm run docs:check` 的文档/架构/协议检查 57 项通过，26 个已修改 JavaScript 文件语法检查通过。两仓最终 diff 和状态已审阅，`git diff --check` 通过，临时材料未进入源码改动。
- 对照证据：客户端 `song-batch-after.json`、`music-hotspots-after.json`、`scenes-gifts-calendar-after-results.json`；服务器 `catalog-after-results.json`、`chain-after-results.json`，均保留于各仓 `tmp/calculation-efficiency-20261023/`。测试使用隔离合成数据，没有操作真实用户数据。
- 已同步客户端 storage、music/services、frontend/playback、frontend/app、frontend/overlays 技术参考及服务器 `docs/protocol/gift-variants.md`。规则、接口字段和用户步骤不变，用户指南无需修改。

索引增加与输入规模成比例的内存；目录仅在 owner 发布时冻结和登记，外部可变快照保持即时读取语义。以上计数代表已检查路径和合成样本，不是完整仓库无剩余热点或生产延迟保证。未提交、打包、部署或重启用户实例。

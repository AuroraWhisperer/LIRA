# AI 审查问题定向修复计划

Status: Completed

依据：2026-10-16 用户要求复核审查范围，成立且不过度的修复直接实施。

## Goal

修复报告 C1、C2、C3、C4、S2、S3 的合法输入错误，保持现有接口、长度预算、存储格式与操作流程。
这些属于通用 JavaScript 语义陷阱，不能归因于 AI 作者；S1、S4 仅为规格外输入观察，不进入修复范围。

## Current Behavior / Ownership

| 项目 | Owner 与消费者 | 现象、测试与契约 |
| --- | --- | --- |
| C1 | `public/js/admin/song-import-parser.js`；导入预览与旧导入 | 全文含 Tab 就选 TSV，自己导出的 CSV 失败；`test/songs/song-file-codec.test.js`、`song-import-update.test.js`；`docs/reference/backend/music/services.md`、`api.md` |
| C2 | `src/music/song-import-schema.js`；歌曲领域旧 import | `firstValue` 与 `parseEnabled` 丢失 false/0；`test/songs/song-file-codec.test.js`；`docs/reference/backend/api.md` 的兼容导入契约 |
| C3 | `public/js/admin/streamer-planner-model.js`；备忘转待办与存储 | 80 码元中间切开 emoji；`test/admin/streamer-planner.test.js`、`streamer-planner-model.test.js`；`docs/reference/frontend/app.md` |
| C4 | `src/music/lyric-normalization.js`；状态与时间轴 | 标题、歌词、逐字文本切开代理对；`test/lyrics/desktop-lyrics.test.js`；`docs/reference/backend/music/services.md` |
| S2 | `D:/Work/lira-server/public/streamer/manage.js`；歌库更新时间 | SQLite UTC 字符串被当作浏览器本地时间；`e2e/streamer-workspace-states.spec.js`；Server Management API、REQ/AC-SONG-001 |
| S3 | `D:/Work/lira-server/src/lib/song-library.js`；歌曲标准化与持久化 | 文本按既定码元上限切开代理对；`test/song-library-validation.test.js`、`song-library-sync.test.js`；Server 歌曲协议与 AC-SONG-001 |

## Compatibility / Non-goals

- 不修改共享 `cleanText`，不把码元预算改成码点或字素数量，不增加 Unicode 框架。
- 不修改同步事务、身份授权、分页拒绝规则、DTO 时间格式、歌曲字段类型及导入替换语义。
- 保留已有文本框功能等未提交改动；不提交、推送、打包或部署。
- 测试使用内存库、现有隔离 fixture 与仓库 tmp；不运行真实账号或用户桌面实例。

## Proposed Changes / Milestones

- [x] 复核并补充所属测试：CSV/TSV 与引号内 Tab、旧导入 false/0、Unicode 边界及上海时区显示；先记录失败。
- [x] C1/C2：只按首条非空逻辑记录中引号外的 Tab 判断 TSV；字段选取和布尔解析显式保留 false/0。
- [x] C3/C4/S3：沿用本仓已有 `slice(...).replace(/[\uD800-\uDBFF]$/, '')` 边界修正，不修改长度上限或时间数值。
- [x] S2：消费端仅将已知 SQLite UTC 形式转换为 ISO UTC，保留带时区的 ISO 输入；验证真实浏览器页面。
- [x] 同步受影响技术说明与验收，核对用户指南；完成定向回归和两仓 diff/status 审查。

## Verification

客户端：

```text
node --experimental-vm-modules --test --test-concurrency=2 test/songs/song-file-codec.test.js test/songs/song-import-update.test.js test/songs/song-import-update-ui.test.js test/songs/song-service-boundary.test.js test/admin/streamer-planner.test.js test/admin/streamer-planner-model.test.js test/lyrics/desktop-lyrics.test.js
npm run verify:docs
git diff --check
```

Server：

```text
node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test --test-concurrency=2 test/song-library-validation.test.js test/song-library-sync.test.js test/song-projections.test.js test/streamer-manage-surface.test.js
node scripts/run-with-node.cjs node_modules/@playwright/test/cli.js test e2e/streamer-workspace-states.spec.js --workers=1
npm run docs:check
git diff --check
```

新增失败用例先以名称筛选执行，再跑所属完整文件。浏览器沿用已有 fixture 与隔离服务器，运行前核对端口空闲。
本次不改变公共协议形状、存储 schema 或架构，因此无需全仓动态测试或跨端部署验收。

## Documentation / Rollback / Done When

技术说明核对导入兼容、歌词预算和 Server 时间含义；仅更新因此新增或澄清的行为事实。
用户指南和交互引导核对歌曲导入、备忘转待办和歌词步骤；操作与限额不变时保持原文。
失败时只修改本任务 owner 与测试；必要回退使用精确补丁，不覆盖其他工作。
六项修复均有定向通过证据、文档一致、生成物不进入 diff 后完成；保留实际验证范围与限制。

## Results

- 修复前：客户端五个定向用例、Server Unicode 用例及上海时区浏览器用例均捕获错误；UTC 浏览器对照通过。
- 客户端七个相关文件共 82 项。首次 81/82；新增无表头 CSV 夹具使用“歌手”误触既有表头规则，改为“测试歌手”后所属完整 codec 文件 19/19，通过结果与其余未变文件合计 82/82。没有放宽断言或为夹具更改业务规则。
- Server 四个相关 Node 文件 45/45；测试格式调整后 validation 文件再次 17/17；完整 workspace 浏览器文件 10/10，包含上海与 UTC 两种时区及 SQLite/ISO 输入。
- 文档门禁：Client 10/10、Server 57/57。Client 初次因本计划使用中文“状态”标签而失败，改为仓库识别的 `Status:` 后通过。
- 两仓 `git diff --check`、任务文件 diff 与 `git status --short` 已核对；已有文本框工作未改动，无生成物、秘密或真实数据进入任务 diff。浏览器测试端口 3217 已释放。
- 技术文档同步导入语义、UTF-16 截断和 UTC 显示；Server 验收补入具体边界。API 形状、OpenAPI、存储格式及架构未变。使用指南与交互引导原步骤仍准确，保持原文。
- 最后复核为 ISO 时间断言补充等待刷新结束，再次运行完整浏览器文件 10/10；归档后的文档导航门禁 10/10，最终 diff 检查通过。
- 未运行全仓动态测试、真实账号、用户 Electron 实例或发布流程；此次证据针对六处修复。

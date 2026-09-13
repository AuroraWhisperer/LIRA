# Song Request Metadata Implementation Plan

> **For agentic workers:** Implement the delegated client task inline; no commit or deployment is authorized.

**Goal:** 补齐第一版客户端价格、歌切与 Excel 配套。

**Architecture:** 保持现有表单和导入拥有者；规范见 ../../song-request-metadata.md。不引入依赖或新存储字段。

**Tech Stack:** Vanilla ESM / CommonJS / node:test / 现有内存 SQLite 与 VM harness。

## Global constraints

- 保留其他用户修改，不提交，不部署。
- 导出十列、核对平台空值、重复跳过不变。

## Tasks

- [x] 更新 song-import-table.test.js、song-file-codec.test.js：新别名同值/空值/冲突、五行模板、显式清空与重复跳过。执行 `node --experimental-vm-modules --test test/song-import-table.test.js test/song-file-codec.test.js`。
- [x] 更新 import.js 传递别名、song-import-schema.js 检查冲突、song-service.js 收集逐行失败、song-file-codec.js 模板；保持 `{total,inserted,duplicate,failed,createdCategories,failures}`。
- [x] 更新 library.html、songs.js 价格/歌切输入与列表、预览及长度状态。沿用现有 `saveSong` 的可选字段与清空语义。添加表单行为测试，运行 `node --experimental-vm-modules --test test/song-library-filter.test.js test/song-request-form.test.js`。
- [x] 同步 API / services / app 所属文档、导入说明和规范索引。执行 `node --test test/governance-docs.test.js` 与差异、状态检查。

## Verification and discoveries

客户端使用 cleanText 曾压平价格和歌切的内部换行，已在规范中显式升级为 cleanTextPreserveLines 并覆盖持久化、CSV/XLSX 往返测试。不修改其他字段清洗规则。

聚焦歌库/表单/导入/同步测试 50 项通过；随后新增文本空白往返测试，连同文档与架构边界共 34 项通过。`node scripts/check-js.js`：610 个 JavaScript 文件通过。`git diff --check` 通过。

隔离 Chromium 使用真实 library.html、songs.js 和 CSS，在 1440×1000 与 1000×800 检查：快捷值、回填、1001 长度拒绝、换行保存、清空、歌切展开、长预览；无页面错误或横向溢出。修正 textarea 默认最小高度导致布局拉伸，价格预览限高滚动。未启动真实 Electron、未连接真实授权账号或网页端联调；这部分不宣称已验收。

## Failure handling and completion

出现冲突仅手动回退本任务变更；不执行 destructive reset。聚焦检查通过并记录证据后归档本计划。

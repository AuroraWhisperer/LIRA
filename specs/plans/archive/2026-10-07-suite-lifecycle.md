# 套装整体管理实施计划

Status: Completed

需求来源：本次用户要求套装可整体添加、删除，更新安装包后旧版作废。

## 目标与边界

套装按名称、版本、成员清单展示；提供整体更新和删除。新导入的同一 packageId 套装替换库中旧版本。现有场景的配置及不可变资源继续有效，由用户更换图层样式后保存应用。独立样式的增删、桌面授权、ZIP 格式和素材校验保持兼容；不执行真实用户数据删除、资源回收、提交或发布。

## 当前行为与归属

- `src/storage/component-style-store.js` 拥有 index.json 原子写入、安装与逐样式软删除；不同版本目前并存。
- `src/server/component-style-library.js` 拥有 ZIP 预览；`src/server/routes/component-style-routes.js` 拥有 admin/canvas 授权接口。
- `public/js/admin/component-style-library.js`、`component-style-api.js` 和 `public/css/admin/component-styles.css` 拥有列表及导入交互。
- 合同归属 `docs/reference/backend/api.md`、`storage.md`，操作说明归属 `docs/guides/component-style-packages.md` 和现有使用指南。
- 现有 `test/scenes/component-styles.test.js`、`test/admin/component-style-library.test.js` 提供隔离 HTTP、资源和 UI 验证。

## 实施与验证

- [x] 存储/API：增加 remove-pack；根据未过滤的历史包成员判定套装，避免旧版本逐项删除导致套装消失；inspect 返回 isSuite/replaces。安装在一次索引提交中撤下相同 packageId 的其他版本；同版本原包恢复复用原 ID 和资源，内容冲突失败不改变旧包。验证删除、恢复、替换、失败保留旧包、单类型更新、无关包及授权。
- [x] UI：套装独立分组，展示版本及成员数量；组标题提供更新/删除，取消成员删除入口。删除前确认；更新时校验所选包身份并说明版本替换及场景影响；空列表显示导入指引。验证取消、更新包不匹配、版本替换、重复导入及其他组件分类。
- [x] 同步合同和操作说明；运行针对性测试及文档/接口相关门禁，检查最终 diff 和状态。

计划命令：`node --test test/scenes/component-styles.test.js`；`node --test test/admin/component-style-library.test.js`；`npm run verify:docs`；`npm run verify:architecture`；受影响 JS 的 `node --check`；`git diff --check` 和 `git status --short`。不改动云端合同，不要求远程服务器验证。

## 失败处理与完成条件

安装失败沿用目录回退，旧索引保持可用；删除只设置既有 removed 标记，不更改 schema 或移除文件。仅撤销本任务的具体改动，保留现有用户修改。全部新交互、安装原子性及旧资源可读通过针对性检查，文档与实现一致、最终差异已审阅后归档。

## 完成证据（2026-10-07）

以上三个里程碑均已完成。后端套装测试 16/16、界面测试 6/6、架构检查 23/23 通过；最终 inspect 清理调整后再次通过 4 项直接相关后端测试。受影响生产 JS 的 node --check 全部通过。文档检查曾发现计划状态格式不符合索引规范，已改为标准 Status 并归档，最终检查重新执行。

使用既有隔离 Electron 夹具及真实 preload、桌面授权验证月渡花汀 1.0.7 的 8 个成员、整套按钮、删除确认及删除后空状态；合成数据目录位于 tmp/，实例退出后已清理。展示截图保存为 tmp/suite-management-preview.png（不进入版本控制）。浏览器测试使用当前 canvas 能力调用真实 install/remove-pack，覆盖错包、取消、重复导入及单类型新版；后端真实 ZIP 测试另行覆盖解析、冲突、原子替换和旧资源读取。

最终文档门禁 8/10 通过，剩余两项来自并行任务：新增 `POST /api/scenes/delete` 尚未进入 API 文档，以及 `2026-10-07-scene-preset-actions.md` 的索引状态不匹配；本任务的套装接口及计划状态已无报错。未改动这些其他任务的内容。

没有运行仓库全量测试或云服务器合同验证；这次只扩展本地组件样式 API，未修改云合同、场景格式或 Electron 安全边界。保留同文件中其他任务新增的 renderList 接口、弹幕分类及其测试。

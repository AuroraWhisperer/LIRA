# 粉丝档案名单外 UID 资料更新

Status: Completed

## 目标与范围

手动同步名单及每天 12:10 自动同步时，未归档、未屏蔽且绑定可靠 UID 的名单外档案也更新昵称和头像。神秘人成员继续跳过，不尝试揭示身份；仍保留名单不完整时不凭缺席清除在舰身份的保护。无新增开关、昵称搜索、服务或持久化格式。

## 当前行为与职责

- `src/electron/fan-profile-controller.js` 已拥有名单请求、授权代次/房间检查、互斥和退出等待；在同一操作内增加串行 UID 补查。
- `src/bilibili/danmaku/api-client.js` 已提供 `fetchUserProfile(uid)`；扩展可选取消信号，保留 8 秒超时。`src/electron/main.js` 用现有桌面 Cookie 获取器注入调用，凭据不进入渲染进程。
- `src/fans/profile-service.js` 直接从所属 scope 的原始档案选择补查目标；`guard-roster-import.js` 在原事务内应用观察并保存自动同步日期，复用 `profile-facts.js` 的昵称历史与头像更新。
- UI 消费者为 `public/js/admin/fans/{index,automatic-update,forms}.js` 及粉丝档案页面。同步说明的所有者为 `specs/fan-profiles.md`、桌面 preload/后端 Bilibili 参考和工具箱使用指南。

## 兼容与失败处理

- 原 IPC action、设置键、归档/黑名单语义与私人字段不变；结果新增 `profileRefresh: { updated, failed, skipped }`。`failed` 包含接口失败及因此未继续查询的目标，`skipped` 包含查询期间归档/删除/换绑或已有更新观察的结果。
- 名单内不重复查询；名单外串行查询，间隔 1 秒。首次接口失败停止补查，保留旧资料，仍导入已取得的名单及成功资料，不在当天后台密集重试。
- 查询前记录观察时间；提交时重新核对档案 ID、身份、归档及屏蔽状态。授权/房间变化、关闭自动同步或退出时整次操作不落库；取消与等待沿用现有名单生命周期。
- 仅撤回本任务的差异，保留工作区既有及并行修改；不提交、不部署。

## 实施与验证

- [x] 在现有领域、控制器、Bilibili API 测试中增加目标选择、掉舰更新、并发变更、补查失败和取消用例，先确认缺少目标方法和更新结果的失败。
- [x] 实现内部目标方法、事务应用及主进程请求编排。运行 `node --experimental-vm-modules --test test/fan-profiles/*.test.js test/bilibili/bilibili-user-profile.test.js test/bilibili/bilibili-guard-roster.test.js`，175 项通过；唯一文件级失败来自默认 Server checkout 与锁定 revision 不一致。使用已有 `tmp/guard-accompany-contract` 的锁定提交 `01fb2b47d5e081f5dd559933991ade4819eb3428` 设置 `LIRA_SERVER_ROOT` 后，单独运行 `test/fan-profiles/fan-profiles-protocol.test.js` 的 2 项通过，共 177 项相关测试通过。
- [x] 同步手动/自动结果提示、设置说明及契约/使用指南；补查失败提示扩展现有前端测试。`npm run check` 检查 1440 个 JS 文件通过，`npm run verify:architecture` 27 项通过，`npm run verify:docs` 10 项通过；首次文档检查指出计划状态标签格式，修正后通过。使用指南 15 项测试通过。
- [x] `node --test test/desktop/electron-shutdown.test.js` 38 项通过；增加 main 中资料 API 依赖的既有生命周期夹具声明。控制器用例覆盖补查中的退出等待，以及串行间隔的取消；没有新开后台进程或操作运行中的桌面应用。
- [x] 最终差异、`git diff --check` 和 `git status --short` 已复核；检查通过，日志位于忽略的 `tmp/`，原有及其他任务修改保留。

## 完成条件

两种同步入口均能对名单外 UID 档案更新名字和头像，原有私人记录与已归档档案受保护；取消和部分失败有可重复验证，文档与结果计数一致。使用隔离夹具验证，不以真实账号或用户数据测试；未做真实 B 站连通性验收时如实说明。

## 验证范围

未调用真实 B 站账号或读取真实档案；实时接口可用性不由隔离测试证明。主视图与帮助组件布局保持前序任务结果，本次只改同步逻辑、对应说明和结果计数，未新增视觉验收。交互导览无对应同步步骤，保持不变；规格、IPC/API 参考与内置使用指南已同步。未提交、发布或修改锁定服务端契约。

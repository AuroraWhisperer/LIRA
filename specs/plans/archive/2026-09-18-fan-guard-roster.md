# 粉丝档案交互与手动名单同步实施计划

状态：Complete（2026-09-18）。

## 目标与范围

修复粉丝档案按钮文字选中后不可读和“更多”菜单收起行为；按用户确认只提供手动一键同步当前配置房间的大航海名单，预存昵称、UID、头像和等级，继续使用已有表单补充私人资料。不增加定时任务、服务器接口、依赖或数据库迁移。

## 现状、所有权与兼容

- `public/js/admin/fans/` 和 `public/css/admin/other-features/fan-profiles.css` 拥有交互。文字选中只有浅色背景，白字按钮失去对比；普通 details 缺少菜单关闭行为。
- `src/bilibili/guard-roster.js` 负责固定 B 站 HTTPS 地址的房间解析和名单分页。房主 UID 必须从房间响应解析，不能使用登录观众 UID。名单完整读取后才交给档案领域。
- `src/electron/fan-profile-controller.js` 固定认证归属、授权代次和配置房间，限制同时一个同步，账号切换/退出时中止；提交前重查归属和房间。沿用现有主窗口主 frame 私有 IPC，renderer 不提交名单或授权归属。
- `src/fans/guard-roster-import.js` 在现有 store 事务内按可靠 UID 建档和保存观察记录；手动同步独立于后台自动更新开关，尊重归档和删除抑制。保留私人资料与人工修订；同房间/UID 在北京时间同日连续相同等级的观察去重，等级变化仍追加；来源键包含观察时间，确保同一快照重放去重。
- 沿用现有档案、记录和完整备份格式。名单只证明读取时的等级；不推算有效期、累计/连续天数，也不把名单缺席当成下舰。规格更新 `specs/fan-profiles.md`。

## 里程碑与验证

- [x] UI：用原生 popover 提供点击外部、Esc 和操作后关闭；按钮禁止文字选中，正文选中色同时指定前景色；新增同步表单与忙碌/错误/成功反馈。Electron 检查实际交互。
- [x] 数据：分页合并 top3/list、UID 去重、拒绝错误房主/不完整页/无效响应；先写隔离测试再实现。网络失败不修改档案。
- [x] 生命周期：新增 `sync-guard-roster` 异步 IPC action，保持同步 action 的现有结果形状。测试账号/房间切换、重复操作、退出和错误脱敏。
- [x] 完成：运行 `node --test test/fan-profiles-*.test.js test/bilibili-guard-roster.test.js`、相关 Electron/前端检查、语法/架构门禁及 `git diff --check`，检查最终 diff/status。

## 失败与回退

网络或数据校验失败保留现有档案，显示重试提示；不会提交部分名单。测试只使用临时 SQLite 与虚构身份。回退仅撤回本任务 diff，不修改其他工作，不提交或部署。

## 完成条件

上述交互和手动预建档可用，相关回归通过，文档与实际行为一致，最终 diff 无敏感或运行时数据。

## 实际结果

- 针对性测试：`node --experimental-vm-modules --test test/fan-profiles-*.test.js test/bilibili-guard-roster.test.js test/electron-shutdown.test.js test/electron-main-modules.test.js test/admin-page-composition.test.js test/admin-style-ownership.test.js test/frontend-admin-toolbox.test.js`，141/141 通过。
- `npm run verify:quick`：文档 5/5、全部 JS 语法检查、架构 22/22 通过。设计检测器无发现。
- Electron 43、1280×860 原生窗口、真实 preload/IPC/档案服务、临时 SQLite 与虚构身份：更多菜单的外部点击/Esc/操作后关闭通过；页面全选时主按钮保持红底白字；同步错误可重试，读取中阻止重复提交和误取消；导入新增 2/更新 1，已有私人备注保留；导入后称呼、生日与备注编辑保存通过；空名单不会删除已有档案；无页面脚本错误。截图和临时脚本保存在仓库外的临时目录。
- 公开接口单次只读检查：使用接口文档中的示例房间验证解析房间/房主并读取昵称、头像、等级；未读取或修改用户真实档案，未把公开名单写入档案。多页、失败及身份边界由虚构响应确定性测试覆盖。
- 最终只审查本任务文件；工作期间出现的其他界面/房间信息改动予以保留。未提交、打包或部署。

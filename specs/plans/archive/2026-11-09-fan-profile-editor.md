# 粉丝档案编辑弹窗

Status: Completed

## 目标与当前行为

按用户截图压缩编辑弹窗的头尾空间，移除顶部重复说明，替换标签页样式；新建档案直接填写 B 站 UID，并在输入旁预览头像与昵称；生日历法补充阳历、阴历及填写说明。

现有 `forms.js` 让用户选择 UID/open_id，现有头像展示只在详情中。`fan-profile-controller.js` 已注入带取消信号的 `fetchUserProfile`，但没有编辑器只读预览入口。

## 所有权与约束

- `public/js/admin/fans/forms.js`、`profile-actions.js`、`index.js`：字段、预览及接线；`fan-profiles-editor.css`：弹窗样式。
- `src/electron/fan-profile-controller.js`：在现有受限 `fan-profiles:invoke` 添加 `preview-identity`，输入 `{uid}`，输出既有响应包内 `{uid,name,avatarUrl}`，不写档案或事实。沿用主窗口、主 frame、Admin origin 和授权上下文约束。
- 保留 UID/open_id 命名空间、旧档案身份和存储格式。Cookie 不进入 renderer，图片继续使用受限头像代理。没有新依赖、HTTP 端点、重试或轮询。
- 预览只在 UID 提交输入后读取，同一在途查询复用；替换、账号变化及退出时取消，迟到结果不能回填其他输入。
- 技术参考归属 `docs/reference/frontend/app.md`，用户说明归属 `usage-guide-toolbox-work.html`；交互引导没有弹窗字段步骤。
- 保留工作区既有修改；不提交、不打包、不操作真实用户数据。

## 实施与验证

- [x] 扩展现有 IPC 测试，验证预览无写入、仅返回资料字段、非法 UID 拒绝、替换/账号变化/退出拒绝迟到结果；实现只读查询。
- [x] 修改现有表单及样式，复用头像代理；补充身份保存覆盖，确保 open_id 不被重解释为 UID；同步技术参考和使用说明。
- [x] 用现有隔离 Electron fixture 检查基本/生日/备注页、UID 预览成功及失败、快速替换和清空、创建保存；检查截图与头尾实际尺寸。临时诊断只放 `tmp/`。
- [x] 运行 `node --experimental-vm-modules --test test/fan-profiles/fan-profiles-ipc.test.js test/fan-profiles/frontend-fan-profiles.test.js test/fan-profiles/frontend-fan-profiles-view.test.js`，相关控制器测试、语法、文档及架构门禁；完成 detector、diff/check/status 审查。

## 验证结果与边界

- 档案 IPC、表单、控制器同步/名单及共享来源安全共 87 项通过；架构 29 项通过；全仓 1,807 文件语法检查通过。设计 detector 对修改界面返回空数组。
- 隔离 Electron 使用真实管理页样式、preload、主窗口鉴权 IPC 和临时 SQLite；B 站资料和头像响应为合成数据，不访问真实账号或上游。按启动窗口 1440×913 内容区检查，弹窗 680×600，页脚 43px，基本页内容完整。三个标签、阳历/农历切换、代理头像、失败后创建、快速更换与清空、图片失败占位、关闭后迟到结果、键盘切换、已有 open_id 编辑保存均通过；最终无 renderer 错误。
- 视觉首轮发现的 SVG 占位未隐藏及基本页末行裁切已修正，第二轮确认通过。使用指南的三个截图已更新为 680×600，示例为合成资料；技术参考和 IPC action 表同步，交互引导无相关字段步骤。
- 文档门禁仍受既有 `docs/reports/2026-11-05-continuous-audit.md` 引用的 27 个缺失临时报告链接阻断；未修改该报告。当前文档链接检查通过，活动计划的状态格式问题随本计划完成归档消除。
- 自有 Electron 实例已关闭；截图、诊断和隔离数据保存在根 `tmp/fan-profile-editor-qa/`。未提交、打包、发布或修改用户运行中的应用。

## 失败处理与完成条件

头像读取失败保留 UID 和其余输入，可继续保存；不做农历自动换算。仅回退本任务 diff，停止并清理自有测试实例。上述交互和定向检查通过，文档同步且变更范围审查完成后归档本计划。

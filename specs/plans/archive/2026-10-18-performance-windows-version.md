# 性能页 Windows 版本

Status: Completed

## 目标与边界

在「百宝箱 → 性能」的硬件卡片前加入紧凑的系统版本栏，把「本机硬件」改为「本机信息」。打开页面自动显示 Windows 名称（含版本类型）、功能版本及 OS 内部版本。不新增按钮、后台采样、依赖或进程；不涉及更新、授权、持久化或 Electron 生命周期。

## 当前行为与归属

- `src/server/system-metrics.js` 拥有静态硬件查询、进程内缓存及显示器刷新；现有 Windows PowerShell 查询可一并读取系统资料。
- `GET /api/system/hardware` 由 `src/server/routes/system-routes.js` 转发；保持路由及已有字段，增量加入 `operatingSystem: { name, displayVersion, buildNumber }`，均为字符串。
- 消费者：`public/js/admin/metrics.js`、`public/pages/admin/toolbox/performance.html`、`public/css/admin/toolbox/performance.css`。
- 参考归属：`docs/reference/backend/api.md`、`docs/reference/backend/server-core.md`、`docs/reference/frontend/app.md`；用户说明为 `public/pages/admin/toolbox/usage-guide-toolbox-software.html` 及对应截图。
- 现有覆盖：`test/server/system-metrics.test.js`、`test/admin/performance-displays.test.js`。当前工作区干净。

## 实施与验证

- [x] 在原 Windows 查询中读取 `Win32_OperatingSystem.Caption/BuildNumber` 和注册表 `DisplayVersion/ReleaseId/UBR`，名称不根据 `10.0` 内核版本推断；缺失资料保留 OS 基础名称和已知 build，未知功能版本为空字符串。独立查询失败不丢弃其他硬件资料；缓存副本包含新字段。
- [x] 在三张硬件卡片前添加一行语义化 `dl`，复用现有颜色和间距 token；使用 `textContent`，缺失值显示“未知”，请求失败结束等待读取状态。
- [x] 扩展现有测试，覆盖 Windows 10/11 名称、补丁修订号为零/缺失、基础回退、缓存隔离以及前端完整/缺失/失败状态。
- [x] 同步接口、实现参考、用户指南及性能页截图。检查 README、指南和交互导览，没有描述此栏的内容保持不变。
- [x] 使用既有隔离 Electron 截图 fixture 验证打开性能页、实际 Windows 读取及再次检测后唯一一行显示；检查正常桌面窗口中的布局。fixture 使用 `tmp/` 数据和随机端口，不启动用户实例。

命令：`node --experimental-vm-modules --test test/server/system-metrics.test.js test/admin/performance-displays.test.js test/admin/admin-page-composition.test.js test/admin/frontend-usage-guide.test.js`；`npm run verify:docs`；修改 JS 的 `node --check`；界面设计扫描；`git diff --check` 与 `git status --short`。新增只读字段不改变授权或既有合同，验证限制在相关路径。

## 失败处理与完成条件

读取不到版本时显示已知字段和“未知”，不虚构版本。若需撤回，只反向修改本任务 diff，保留其他工作。系统栏显示正确、缺失数据处理通过测试、桌面检查及文档同步完成、最终 diff 无运行数据或秘密后完成；不提交或打包。

## 验证记录

- 46 项系统信息、前端呈现、页面组合及指南回归全部通过；新增用例在实现前确认失败。
- 真实 Windows 读取为 `Microsoft Windows 11 家庭版 中文版 / 26H2 / 26300.9711`，与独立 CIM/注册表查询一致。
- 隔离 Electron 实际授权 `/admin?desktop=1` 返回 200；1440 × 902 窗口验证进入页面自动读取、开始检测和重新进入后的版本栏。检测操作只触发一次硬件请求、页面仅一条版本栏；无字段截断或横向挤压。隔离实例已关闭。
- 三个修改的 JS 文件语法检查通过。设计扫描只报告既有进度条 `transition: width`，本次未改变该规则。
- 使用说明与两份 WebP 截图同步；README、其他指南与交互导览未描述本栏，无须修改。架构、授权与持久化行为未变。
- 首次文档门禁 9/10 通过，唯一失败来自同期 `2026-10-18-audio-assistant-win10.md` 的活动状态；保留该任务内容。本任务归档后再次运行，最终文档门禁 10/10 全部通过。
- 隔离 Electron 已关闭；清理本次 `tmp/performance-windows-version/` 下的示例数据和 profile 被自动审批以 `blocked by policy` 拒绝，临时目录保留，不进入 diff。

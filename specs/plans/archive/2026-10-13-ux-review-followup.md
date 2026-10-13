# UX 复查缺陷修复

Status: Completed

## 目标与范围

核实并修复 `tmp/ux-review-20261013/review.md` 的两项高、十项中、十五项低及关联指南错误。首先保证 AI 预设真实模态确认可操作、更新安装不受手动退出提示阻断。已正确的 SC 撤销、连接检测主体和点歌规则拆分保持不变。B12/A15 继续沿用现有局部确认，不建立新的通用撤销系统；A16 自动同步状态仍是独立未完成项。

当前工作树含用户原有改动及上轮任务内容；本轮基线保存在 `tmp/ux-remediation-20261013/review-before.patch` 和 `review-before-status.txt`。不提交、重置、部署或运行真实安装程序，不使用用户数据。

## 所有权与实施

- 主代理：`src/electron/main.js`、关闭及更新测试、desktop 参考；汇总 `app.md`、`gift.md` 与报告。核实 updater 退出生命周期后，使用原生 `before-quit-for-update` 事件区分退出来源，直接进入既有 shutdown；未修改 update-manager 或新增安装状态，保留正常 drain/flush 顺序。
- 工具包：AI 模态确认、完整降级状态与引导、回复标题/账号错误、抽奖保留文案和对应指南/测试。真实 DOM 验证模态确认，不以假 confirm 替代。
- 组件包：共享参数提示、礼物未保存状态、被中断场次取消、文本框已保存未应用范围说明与等待状态、监控礼物状态、开播/时钟/加班机命名及对应指南/测试。文本框未增加保存/发布版本差异检测；同一场次取消仅校验 ID，包含确认期间中断的情况。
- 音乐包：播放清空准确文案及空队列、诊断实际平台、歌库编辑删除、全民 K 歌入口禁用、歌词命名、字重/不透明度，以及失效的共享交互测试和对应指南/测试。
- 共享文件先确定归属；原有接口/存储格式、认证和 Electron 安全边界不变。文案按实际行为修正，不能为符合报告而更改已接受契约。

## 验证与完成条件

- [x] 两项高、十项中、十五项低逐项处理；B02 采用明确说明整场景范围的方案，未伪称完成差异检测。
- [x] AI 实际确认框可点击，取消/Esc/失败保留草稿；更新退出跳过确认，普通关闭仍确认，关闭顺序保持。
- [x] 三个包运行受影响的完整测试文件；AI、文本框、共享参数、取消互动、匹配诊断及不透明度都有对应真实 DOM/隔离 Electron 证据。
- [x] 技术参考、指南和四张必要截图同步，原报告与三个历史包注明复查更正，不把旧时点结果当最终证据。
- [x] 冻结后整合 59/59，语法 1517 文件、架构 27/27、文档 10/10；diff 检查通过。没有运行仓库全量套件，保留原工作树内容。

失败先定位最小复现并修正，再重跑所属完整文件；不弱化有效断言。最终修改报告逐项列结果，区分未实现功能、未做真实环境验收和本轮验证通过范围。保留此前临时数据清理被策略拒绝的边界，不改用其他方式规避。

## 完成证据与限制

- `node --test test/desktop/electron-shutdown.test.js test/desktop/update-manager.test.js test/desktop/desktop-update-controller.test.js`：52/52。新增更新退出用例在修复前失败，在修复后验证排空、flush、服务停止与单次退出。
- `node --test test/desktop/electron-startup.test.js test/desktop/local-instance-security.test.js`：25/25。
- `node --test --test-concurrency=1 test/desktop/ai-persona-editor-electron.test.js test/desktop/fixed-reply-editor-electron.test.js`：2/2；实际原生 dialog 和 dangerConfirm，不以假确认替代。一次隐藏窗口动画超时经定位后，用既有后台节流设置和减少动画偏好稳定验证，未提高总时限。
- `node --experimental-vm-modules --test --test-concurrency=4 test/admin/frontend-admin-shell.test.js test/admin/frontend-admin-toolbox.test.js test/admin/admin-state-renderer.test.js test/admin/interactive-tour.test.js test/admin/frontend-usage-guide.test.js test/admin/shared-ui-interactions.test.js test/settings/frontend-song-request-settings.test.js test/songs/frontend-admin-queue.test.js`：59/59。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs` 与 `git diff --check` 通过；工作包完整命令、最初失败和修正分别记录在 `tmp/ux-remediation-20261013/review-music.md`、`review-components.md`、`review-tools.md`，汇总为 `review-fixes.md`。重叠用例不累计。
- A16 自动同步实时状态仍未实现，本轮未将其标为完成；B12/A15 沿用现有局部确认。安装包实际执行、真实平台与 OBS/直播姬推流未验收。未提交、部署、替换安装版或操作用户数据。

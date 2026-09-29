# Electron 本机直播画面打开修复实施计划

**Status:** Superseded.

**复核日期：** 2026-09-28。旧实施安排由当前规格、后续实现记录和现状参考承接；不再按旧代码路径执行，也不把未勾选的历史验收补记为通过。

当前依据：[所属规格或参考](../../../docs/reference/desktop/main.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

**目标**：让桌面端“打开画面”按钮可以把本机 `127.0.0.1` 的 HTTP 画面交给系统浏览器，同时不放宽任意外部 HTTP 地址。

**范围**：修改 Electron 外部 URL 策略与主窗口新窗口拦截逻辑；保留现有 HTTPS 外链规则、页面地址和 IPC 合同。

**验证**：补充 URL 策略回归测试，运行 `node --test test/desktop/electron-url-policy.test.js`、`npm run check` 和 `npm run verify:quick`，检查差异与状态。

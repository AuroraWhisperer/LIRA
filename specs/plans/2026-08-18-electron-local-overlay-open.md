# Electron 本机直播画面打开修复实施计划

**目标**：让桌面端“打开画面”按钮可以把本机 `127.0.0.1` 的 HTTP 画面交给系统浏览器，同时不放宽任意外部 HTTP 地址。

**范围**：修改 Electron 外部 URL 策略与主窗口新窗口拦截逻辑；保留现有 HTTPS 外链规则、页面地址和 IPC 合同。

**验证**：补充 URL 策略回归测试，运行 `node --test test/electron-url-policy.test.js`、`npm run check` 和 `npm run verify:quick`，检查差异与状态。

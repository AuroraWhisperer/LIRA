# 加班机直播画面修复实施计划

**目标**：修复加班机直播画面设置区的背景保存/预览反馈与地址复制问题，并让按钮文案和错误提示准确反映实际行为。

## 非目标

- 不改变 `/overtime` 页面地址、`/api/overtime/config` 请求形状或数据库字段。
- 不增加自定义背景上传；内置背景约束仍遵循 ADR-0005。
- 不重写加班机倒计时、礼物规则或 OBS 悬浮层布局。

## 当前行为与证据

- `public/js/admin/overtime.js` 通过 `POST /api/overtime/config` 保存背景，但 `saveBackground()` 的 catch 会静默丢弃错误。
- 背景下拉框变化不会更新预览，也没有“待保存”状态；预览仅在初始化和保存成功后刷新。
- 地址复制直接调用 `navigator.clipboard.writeText()`，没有兼容降级；失败时只能显示浏览器原生错误。
- `public/pages/admin/toolbox/overtime.html` 将按钮标为“复制 OBS 地址”，但它复制的是 `/overtime` 画面 URL，本身不是 OBS 专用协议。

## 所有权与约束

- Owner：`public/js/admin/overtime.js`；页面片段：`public/pages/admin/toolbox/overtime.html`；共享复制能力：`public/js/shared/utils.js`。
- Contract：`docs/architecture/backend/api.md` §11、`docs/architecture/adr/0005-built-in-overtime-backgrounds.md`。
- Focused tests：`test/frontend-queue.test.js`、`test/overtime-overlay.test.js`；必要时补充前端控制器的纯函数测试。
- 保持 Vanilla JS ESM、现有页面 URL、IPv4 loopback 地址生成和服务端背景校验。

## 提议改动

1. 在共享工具中增加带 Clipboard API 优先、`execCommand('copy')` 降级的 `copyText()`，并在复制失败时抛出可读错误。
2. 加班机控制器使用 `copyText()`，将成功提示改为“地址已复制”，并在保存背景失败时调用 `showError()`。
3. 背景/适配选择变化时标记待保存，保存按钮显示“保存画面”或“保存中…”；保存成功后刷新 iframe 并恢复“已保存”状态。
4. 页面按钮文案改为“复制地址”，补充保存状态的可访问提示；不改变实际地址。

## 里程碑与验证

1. 先补失败回归断言：按钮文案、复制工具调用、保存错误可见、背景修改状态。
2. 实现最小前端改动，运行 `node --test test/frontend-queue.test.js test/overtime-overlay.test.js`。
3. 运行 `npm run check` 与 `npm run verify:quick`，审阅 `git diff --check` 和 `git status --short`，确认不触碰用户已有的 Bilibili 改动。

## 失败处理与回滚

只查看和回滚本计划涉及的文件；不使用 `git reset --hard`、广泛 checkout 或删除命令。若前端降级复制在某环境不可用，保留原始错误提示并停止扩大改动范围。

## 完成条件

- 背景或适配变更能显示待保存状态，保存成功后预览刷新，失败时用户能看到错误。
- 复制地址在 Clipboard API 不可用或拒绝时仍尝试兼容方案，成功提示不再包含“OBS”。
- 聚焦测试、语法检查和快速验证通过，最终差异仅包含本任务文件及必要计划文档。

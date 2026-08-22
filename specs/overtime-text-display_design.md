# Feature: 加班机文字展板规则

## Requirements (EARS Format)

- 当管理员编辑一条加班礼物规则并选择“文字展板”时，系统应允许输入 1–6 个 Unicode 字符的展示文字。
- 当文字展板规则收到礼物并完成结算时，系统应保留结算幂等记录，但不得增加、减少、乘除或清零加班剩余时间。
- 当加班机叠加层渲染启用的文字展板规则时，系统应在礼物卡的效果区域显示管理员输入的文字，而不是“加时/减时/盲盒”等时间效果。
- 当服务端收到空文字、超过 6 个字符或包含控制字符的文字展板规则时，系统应拒绝请求并不写入数据库。
- 当已有 fixed/random 规则或旧版本礼物库升级时，系统应保持原有规则语义和结算行为不变。

## Architecture

### Frontend

- `public/js/admin/overtime-rule-editor.js` 增加 `display` 生效方式与 6 字符输入框；规则文字使用 DOM API 和 `textContent` 渲染。
- `public/js/overlays/overtime.js` 将 `displayText` 作为卡片效果文字；文字规则的结算更新不播放时间正负闪动。
- `public/pages/admin/toolbox/overtime.html` 和现有加班机样式补充说明与展示态样式。

### Backend

- `validateRules` 接受 `mode: 'display'`、`displayText`，限制为 1–6 个 Unicode 字符并拒绝控制字符。
- `overtime_gift_rules.mode` 扩展为 `fixed | random | display`；`displayText` 与 `quantityMode` 一起存入 `outcomes_json`，避免新增列。
- gift 数据库新增 v7 迁移，重建规则表以放开 `display` 模式；旧行原样复制。
- 结算服务对 display 规则返回相同的前后剩余时间、零时间变化和 `displayText` 调整快照，保持唯一结算键与现有广播协议。

### Security

- 继续使用现有带 session token 的 `/api/overtime/rules` 路由与请求体限制。
- 服务端不信任客户端长度或模式校验；使用参数化 SQL 写入规则。
- 前端和叠加层只用 `textContent`/DOM 属性输出文字，避免 HTML 注入；控制字符被服务端拒绝以避免布局和日志污染。

## Acceptance Criteria

- Admin 可为礼物选择“文字展板”、输入 1–6 个字符并保存/重新加载。
- 非法文字或未知模式返回 HTTP 400，数据库保持原规则。
- display 礼物结算后 `effectiveRemainingMs` 不变，仍只产生一条 applied settlement，重复投递不重复结算。
- `/overtime` 礼物卡显示 displayText；fixed/random 卡片的现有显示和动画行为不变。
- 旧 gift DB 可从 v6 自动迁移到 v7，原有规则和状态保留。

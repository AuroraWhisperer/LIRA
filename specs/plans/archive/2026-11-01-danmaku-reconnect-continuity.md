# 本机弹幕断线恢复连续性

Status: Completed

范围仅为 `D:/Work/Live` 本机弹幕链接。

## 目标与当前证据

直播仍在继续时，短暂云事件断线、输出读取失败或游标缺口不应清空已经显示的弹幕，也不应重复插入本场开播确认。
当前 `cloud-display-buffer.js` 在断线和每次连接时更换展示 epoch；`scene-danmaku-display.js` 在 epoch、连接状态及 reset 变化时清空；独立源与场景输出的读取失败同样发送清空数据。

## 边界与所有权

- `src/scenes/cloud-display-buffer.js` 拥有账号隔离、当前连接校验、场次与有界事件游标。
- `public/js/overlays/scene-danmaku-display.js` 拥有实际弹幕展示；`scene-renderer.js` 与 `danmaku-component-source.js` 适配场景和独立链接。
- 沿用 `scene-display.test.js`、`danmaku-entry-display.test.js`、`scene-renderer-state.test.js` 和 `scene-live-updates.test.js` 的既有夹具。
- 当前实现参考为 `docs/reference/backend/api.md` 与 `docs/reference/frontend/overlays.md`。
- 不修改远端服务、B 站连接、鉴权字段、IPC、持久化格式、外观设置或弹幕动效。
- 保留工作区已有修改；测试与调试仅使用合成数据和根目录 `tmp/`。

## 决策与兼容约束

1. 连接代次继续拒绝旧连接事件；同账号重连不等于新展示 epoch。断线时停止事件交付并清除未交付缓冲，报告缺口，不补历史。
2. 只有授权 owner/epoch 改变或确认的直播场次改变时更新展示 epoch。断线期间不向页面暴露旧连接状态；新的连接必须先通过 overlay-state 校验。
3. `reset/gap` 仍用于游标同步；同一展示 epoch 的游标 reset 不要求清空已显示内容。
4. 输出暂时不可读时保留现有弹幕 DOM；明确撤销、401/403/404/423、换账号、确认下播和新场次仍清空。
5. 不补发断线期间未收到的消息，不新增持久化历史或第二条消息订阅。

## 实施与验证

- [x] 补充失败回归：同场断线/重连、游标缺口保留画面；下播/换场/授权变化清空；旧连接与未初始化连接仍不能交付消息。
- [x] 修改缓冲和两个来源适配，保持现有 public 响应字段及权限检查。
- [x] 通过既有浏览器夹具验证独立链接与场景链接在输出 503 后保留 DOM，恢复后新消息追加一次。
- [x] 同步两份技术参考，检查用户指南影响；运行 `npm run verify:docs`。
- [x] 检查本次相对基线差异、`git diff --check` 和 `git status --short`；只保留任务相关修改。

聚焦命令：

```powershell
node --experimental-vm-modules --test test/scenes/scene-display.test.js test/danmaku/danmaku-entry-display.test.js test/scenes/scene-renderer-state.test.js test/scenes/scene-source.test.js
node --experimental-vm-modules --test test/scenes/scene-live-updates.test.js test/danmaku/danmaku-snapshot-stability.test.js
npm run verify:docs
```

额外运行直接依赖的云事件控制器测试，确认旧连接/账号拒绝与资源释放仍成立。无需运行完整测试集或重启用户客户端。

## 完成条件与失败处理

上述回归通过，临时故障不清屏，真实场次与授权边界仍清空，文档与实现一致，最终差异已复核。若出现回归，仅调整本任务增量，不覆盖已有工作区修改。真实直播软件的长期实播和安装包更新分别报告，不将合成验证称为现场故障确认。

## 验证记录

修复前定向回归共 43 项，其中 5 项按预期失败，覆盖断线清屏、重复展示边界及缓冲代次；两项实际 Chromium 回归均复现一次输出 503 即删除已有 DOM。

首次修复后拥有者/场景源回归 67/67 通过；浏览器与快照稳定性 12/12 通过。直接云事件控制器、本机场景 runtime 和 HTTP 权限回归 91/91 通过，覆盖跨账号隔离、旧连接拒绝、通知撤销和资源释放。浏览器回归已进一步加入同场云事件断线/重连及真实下播边界。

最终浏览器文件 5/5 通过，确认两种本机来源在输出失败与同场云事件重连期间保留原 DOM，恢复后新消息一次交付且只有一条开播确认，确认下播后清空。补充多读者缺口与未知直播状态后，缓冲/展示回归 23/23 通过；不重复累计此前用例，相关回归合计 170 项。九个改动 JavaScript 文件语法检查通过。文档门禁首轮因计划状态标签格式失败，修正标签后 10/10 通过。

技术参考已同步；用户指南中的入口和操作仍准确，无新增设置或操作步骤，保持不变。本次没有改动远端服务，没有提交、打包、部署或重启用户客户端；合成浏览器验证不代替更新安装版后的长期实播。

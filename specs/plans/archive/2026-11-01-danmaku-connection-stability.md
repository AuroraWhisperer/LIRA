# 本机弹幕连接稳定性

Status: Completed

## 目标与证据

继续调查直播弹幕中断的触发原因，修复程序自身不必要的断线，并保留能区分实际故障的安全诊断。上一轮误清屏修复保持不变。

已找到两条本机主动断线路径：`getSceneOwner` 使用每次正常 token 续期都会变化的 `authorizationEpoch`，云事件连接及本机来源据此判定 owner 改变；展示需求只由页面读取续期，来源通知流仍健康时也会在 15 秒没有读取后停掉云连接。现有 catch 未记录中断原因，当前项目目录没有可用于对应用户现场的运行日志。

## 所有权与边界

- `src/electron/scene-cloud-controller.js` 拥有当前授权主体、消息接收校验、超时及退避；`main.js` 负责接线到已有桌面日志。
- `src/server/display-notifications.js` 拥有本机已验证 SSE 及写入/释放；`scene-runtime.js` 拥有共享展示需求。沿用 `display-demand.js` 的 15 秒释放，不增加连接或计时器。
- 复用当前预览已经采用的授权生命周期 generation。`license-manager.js` 的 token epoch、续期、撤销、私密调用与存储契约不改；授权失效、换账号、换服务器或重新授权仍使来源失效。
- 不放宽事件字段、来源 URL、Host/Origin、IPC 或用户数据保护，不修改远端服务，不重启用户应用。
- 保留已有未提交修改。回归只用内存数据库、合成来源和根目录 `tmp/`。

## 变更与验证

- [x] 用真实授权管理器的后台续期回归证明普通续期会改变当前展示 owner；补充连接不重建及授权边界仍失效的行为覆盖。
- [x] 用既有假时钟与 runtime 夹具复现健康通知流在没有页面读取时被判为空闲。
- [x] 将本机展示 owner 绑定当前授权生命周期，沿用预览入口；令牌消费者本身保留 token epoch 契约。
- [x] 仅在已验证且成功写入的本机通知上续期弹幕需求；其他类型、撤销及写入失败不续期，全部来源关闭后仍按原 15 秒释放。
- [x] 增加固定类别的连接诊断：建立、首次状态、主动停用、首次状态/心跳超时、HTTP 状态、读取/协议错误、流正常结束；不记录完整 URL、原始异常、消息、凭据或身份资料。
- [x] 同步 API、桌面授权与 overlay 技术参考；用户操作/入口不变，检查现有指南仍准确。
- [x] 运行受影响测试、语法、文档门禁与最终差异/状态检查。

聚焦命令：

```powershell
node --experimental-vm-modules --test test/transport/component-preview-renewal.test.js test/scenes/scene-cloud-controller.test.js test/scenes/scene-runtime-events.test.js test/scenes/scene-output-events.test.js test/scenes/display-demand.test.js
node --experimental-vm-modules --test test/scenes/scene-runtime.test.js test/scenes/scene-http.test.js test/danmaku/danmaku-overlay-ipc.test.js test/desktop/electron-main-modules.test.js test/desktop/electron-shutdown.test.js
node --experimental-vm-modules --test test/scenes/scene-live-updates.test.js
npm run verify:docs
```

生命周期与连接共享变化由现有授权、HTTP、runtime、桌面接线及实际 Chromium 来源回归共同验证，不运行无关完整测试集。

## 完成与回退

正常续期与健康来源不再导致主动重连，真实撤销及账号隔离仍成立，诊断原因可区分且不泄漏秘密。复核本次相对基线的增量，不回滚之前修复或其他工作区修改。真实网络故障不可由离线测试排除，需更新安装版后的运行记录对应现场，不把程序缺陷复现宣称为已确认那次直播的唯一原因。

## 实际结果

修复前真实授权续期连续两次将展示 owner epoch 从 1 改为 3；独立和场景两种通知仍每秒发送心跳时，展示需求仍于 15 秒变为 false，三条回归均按预期失败。场景测试初版缺完整外观配置，补全夹具后独立重现相同误停。

修复后五个拥有者、通知、runtime 与授权生命周期文件共 105 项通过，包含真实后台续期、无状态通知的 token 更新、60 秒停止页面读取仍保持需求、关闭后 15 秒释放及安全分类日志。

本机 HTTP/运行时、弹幕 IPC、桌面接线及关闭回归 83/83 通过；实际 Chromium 来源回归 5/5 通过，上一轮临时失败保留画面与下播清空行为保持。追加日志分类与普通时钟通知不续期断言后，直接拥有者/缓冲/runtime 回归 90/90 通过。去除重复执行后的相关回归合计 209 项，0 失败、0 跳过；11 个改动 JavaScript 文件语法检查与文档门禁 10/10 通过。

四份技术参考同步，现有用户指南入口与操作仍准确，无新增设置，保持不变。按本轮 `tmp/danmaku-connection-stability/before/` 基线复核差异，保留上一轮修复及其他并发修改；`git diff --check` 通过。本轮没有修改远端项目，没有提交、打包、发布或重启用户应用。没有现场断线日志，以上为程序问题的确定复现，不宣称已对应用户观察到的每次中断；更新安装版后的分类日志可继续区分实际网络、HTTP、超时和格式错误。

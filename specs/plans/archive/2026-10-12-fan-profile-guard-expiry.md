# 粉丝档案大航海到期标记实施计划

Status: Completed

依据：用户确认沿用聊天 `01a12e98-d33e-70b2-b700-351219a4bf73` 最终方向。

## 目标与边界

保留昵称换行/缩字；列表右侧的身份图标与黄色剩余 0–3 天标记在整行内垂直居中。提示使用 B 站完整同步的相对日数，不推算截止时刻，不改变身份、存储格式、提醒或日历。不提交或部署，保留两个仓库已有修改。

## 当前行为与归属

服务端 `guard-expiry-service.js` 已拥有账号校验、完整采集、五分钟缓存、北京时间跨日失效和并发合并；仅主播总览读取名单。设备接口由 `register-cloud-routes.js` 持有，新增读取沿用 DeviceBearer/DeviceRequest 并在返回前复验授权。

客户端 `fan-profile-controller.js` 通过现有授权 license operations 读取；`src/fans/guard-expiry.js` 负责 UID、身份、归档和冲突过滤。`fans/index.js` 在本机列表展示后异步读取安全标记，复用现有刷新周期，不新增计时器；旧上下文、房间和页面请求代次不回填。`fans/view.js` 只展示投影，CSS 保持现有 tokens。

## 兼容与失败处理

- 新增 `GET /api/device/guard-expiry`，租户只来自认证设备，响应附配置 roomId 以便客户端核对，绝不返回凭据。
- 新增现有 `fan-profiles:invoke` 的 `guard-expiry` action，不扩大 renderer 权限。主进程投影只含状态、观测时间和当前列表档案标记。
- 失败/旧服务器/账号不匹配显示原因并清除标记；不当作下舰。成功空名单、超过三天、已到期、冲突、归档、黑名单不显示。
- 无本地持久缓存；复用服务端缓存，每次现有刷新重新核对来源。dispose 取消主进程读取并等待结束。
- 回退只逆转本任务差异，不覆盖已有工作；线上服务未变更。

## 里程碑与验证

- [x] 服务端设备读取、OpenAPI、REQ-BILI-014/AC-BILI-014、协议：`node --test test/guard-expiry-api.test.js test/guard-expiry.test.js`，确认隔离、撤销、房间变化和旧缓存行为。
- [x] 桌面受授权读取与领域投影：覆盖 0/3/4 天、已到期零天、续费缺席、重复/等级冲突、下舰、归档、无 UID、时间过期、账号/房间切换和 dispose。
- [x] 列表非阻塞接入、居中布局与悬停说明：粉丝档案前端测试和隔离 Electron 检查长昵称及两种徽标。
- [x] 同步 `specs/fan-profiles.md`、preload/app 技术参考、内置使用指南；交互引导入口不变。两仓文档门禁、受影响架构/契约检查与 `git diff --check`，最终核对 status 和任务差异；仓库外部文档问题见下。

## 完成条件

上述行为已实现，聚焦自动化和隔离桌面验证通过，契约与说明一致，差异不含运行数据或秘密。真实 B 站账号与服务器发布不在本次合成验收范围内，交付明确其限制。

## 2026-10-12 验证记录

- 客户端：到期投影/IPC、既有 IPC/同步/名单、前端 view/UI、授权 operations、内置指南检查通过。首次发现 0 被转义为空，改为显式字符串；短房号兼容测试发现缺失 ownerUid 不能当作同房主，已修复并重跑领域六项全部通过。
- 服务端：使用仓库现有 Node 24.15.0（系统 Node 24.21.0 不在服务端支持范围）运行 `--require ./test/support/test-mode.cjs --test test/guard-expiry-api.test.js test/guard-expiry.test.js`，13 项通过。文档门禁发现新端点缺少 HTTP inventory，补齐后对应治理文件 16 项通过；同轮其他协议/架构文件通过。
- 客户端 `npm run verify:architecture`：27 项通过；八个改动源码文件 `node --check` 通过。`npm run verify:docs` 的链接检查通过，但全门禁被其他进行中改动阻塞：`2026-10-12-audit-remediation.md` 的状态格式，以及 `specs/README.md` 第 28 行证据格式。未修改这两处无关内容。
- 隔离 Electron：真实 preload、受授权 /admin、主进程 controller、虚构档案验证长名字换行与固定列宽、两种身份图标/黄色天数整行居中（中心偏差 <0.001px）、今日到期悬停、续费清除标记但保留五个身份图标、ownerMismatch 提示且列表仍可用。匿名 /admin 确認为 401；已关闭实例并删除隔离数据。
- 现有指南截图在未命中提醒时仍准确，未重拍；交互引导没有新增入口，不需改动。两仓保留原有及并行工作，不提交、不部署。

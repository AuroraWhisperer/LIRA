# 礼物目录附加资料兼容修复

状态：Completed（源码修复与隔离验证完成，未更新安装版）

## 目标与当前证据

恢复授权启动时的服务器礼物目录更新，使最新盲盒图片可以进入既有图片缓存。
安装版日志自 2026-10-05 起记录 `CATALOG_INVALID`，目录缓存停在当日。
2026-10-11 的公开 schema 3 响应为 HTTP 200，但 `metadata` 新增资料及
`countMap` 的 SVGA 地址触发客户端旧字段白名单，整包被拒绝。

## 归属与边界

- Owner：`src/bilibili/gift/variant-catalog-contract.js`；消费者为既有目录缓存、初始化器和图片缓存。
- 契约：`specs/gift-identity-overtime.md`、`docs/reference/backend/overtime.md` §1.5。
- 继续严格验证顶层、礼物身份、金额、目录关系、实际媒体源和完整原始业务摘要。
- 仅 `metadata` 与其中 `countMap` 条目允许附加说明字段，保留已知字段验证。
  未使用字段仅保存在原始缓存并参与摘要，不转为图片下载输入、不发给 renderer、不影响记账。
- 不改 HTTP 路由、启动时序、缓存格式、用户数据库、安装版文件、服务器或发布状态。

## 实施与验证

- [x] 在既有 `gift-identity-catalog.test.js` 覆盖新资料、countMap 扩展、旧缓存升级、重启、摘要篡改与已知字段损坏。
- [x] 分离对象必需字段检查和封闭白名单检查，仅在说明资料对象使用前者。
- [x] 对真实公开目录在 `tmp/gift-catalog-diagnosis/` 隔离验证完整接收、图片下载和盲盒图标匹配。
- [x] 更新规格与目录参考；用户操作和入口不变，指南及交互式引导无需修改。
- [x] 运行相关目录/图片/初始化/前端测试、语法检查、契约门禁、架构门禁；结果和边界见下文。

## 验证结果

- `LIRA_SERVER_ROOT=tmp/guard-accompany-contract` 使用仓库已有的锁定提交检出；10 份协议夹具通过。主服务端工作区比锁定版本新，未修改锁文件或夹具。
- `node --experimental-vm-modules --test` 对 gift-identity-catalog、remote-catalog-contract、remote-catalog-cache、remote-gift-image-cache、gift-catalog-initializer、gift-catalog-background-updates、gift-artwork-identity、frontend-recent-gifts、gift-category 九个文件验证，59 项通过。最后清理内部 helper 参数后复跑受影响的目录/分类三文件，10 项通过。
- 2026-10-11T04:49:07.315Z 的真实公开目录包含 2696 个身份，接收并投影出 2583 个付费目录条目；波仔盲盒、拾星入怀、波仔巡航、银河烟火四张图片成功下载。三个产物用冻结的波仔盲盒身份均解析到正确图片，缓存重开通过。
- 语法检查通过。架构门禁 25/27 通过，另外两项来自任务开始前已有改动：`blindbox-analysis.js` 的 `Option` 未声明、`fans/index.js` 的空 catch；本任务没有修改这两个文件。
- 文档门禁与最终 diff/status 检查在归档后执行，结果以任务交付记录为准。

## 失败处理与完成条件

非法核心字段或摘要仍整包拒绝，保留旧缓存和 ETag。失败时只撤回本任务增量。
完成条件是新资料兼容、旧保护回归通过，真实目录及最新盲盒图片隔离验证通过，相关文档一致。
当前安装版升级不在本次源码修复范围，交付时明确说明。

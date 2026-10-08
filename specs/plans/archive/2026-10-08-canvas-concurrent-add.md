# Canvas Concurrent Add Fix

**Status:** Completed

## Goal and evidence

v5.1.2 发布门禁中，客户端连续添加套装时钟时，浏览器未确认的自动尺寸编辑可能覆盖新图层；指定实例定位也会在旧快照中误选或新增默认组件。现有 suite-clock 用例在全量并发下复现；延迟编辑回执的实例定位用例已稳定复现并修复。

## Scope and ownership

仅修正 preview relay 的画布草稿同步和指定实例定位。remote controller 为画布 edit 附带编辑前已知的图层 ID；server relay 验证并转发；desktop controller 应用编辑时保留浏览器尚未知晓的新图层。画布视图等待指定实例出现，不回退为新增组件。不同字段的通用并发合并、持久化和其他领域不在范围内。

## Compatibility

`edit` 新增可选 `baseItemIds`，旧请求保留原语义；HTTP 身份、附件绑定、顺序确认和幂等不变。元数据不进入场景文档或磁盘。已知图层的显式删除及排序仍按提交文档执行。

## Verification and completion

- [x] 定向验证：延迟回执的定位、迟到尺寸编辑保留新图层、已知图层删除、元数据校验及旧请求兼容（7 项通过，日志 `tmp/release-5.1.2/concurrent-add.log`）。
- [x] 现有 suite-clock 和实例关联定向测试通过；预览恢复用例此前通过，最终全量再覆盖。
- [x] 最终统一 verify、diff 检查通过后归档：2026-10-08 共 3,830 项测试通过（原生 3 + 主批次 3,827），10 组服务端契约及 1,325 个 JavaScript 文件语法检查通过；日志 `tmp/release-5.1.2/verify-release.log`。

回退仅撤销本修复增量；失败时保留草稿和错误证据，不降低并发或放宽原断言。

## Release blockers found during verification

Windows 的 `index.json` 原子替换出现真实 `EPERM`，在 6 个隔离进程各 50 次安装/移除的定向实验中复现。存储 owner 只对同一个已写好的临时索引重命名限次重试，不重新读取、构建或重放事务；同步等待最多 500 ms，保持现有同步写入互斥语义。45 项素材库测试与原实验修复后通过，持续失败回滚仍有覆盖。服务层的目录安装重试共享原有网页导入实现，并每次重新授权。

WeSing 路由测试去掉“探测后释放再绑定”端口窗口，复用 `startPort: 0`；该领域 70 项测试通过。上述改动不改变生产端口策略、存储格式或认证边界。日志均位于 `tmp/release-5.1.2/`。

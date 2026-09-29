# Windows Signing Integration Plan

**Status:** Blocked — 等待发布者、证书来源和执行策略确认。2026-09-28 从旧技术文档收敛未完成范围；本次整理不启动签名、安装或发布。

## Goal and current behavior

在构建和发布流程接入现有签名/验签工具，只有发布者身份验证通过的产物才能进入发布。`scripts/sign-windows.js` 和 `scripts/verify-windows-release.js` 已实现；`package.json` 的 `build.win` 未接入签名 hook，`scripts/publish-release.js` 未调用验签工具。

工具的实际行为见 [签名参考](../../docs/reference/engineering/code-signing.md)。此计划承接 [遗留事项复核 A2](open-items.md)，不把未接入的保护描述为已有保证。

## Required inputs and boundaries

- 证书持有人确认发布者 CN、证书来源和安全凭据注入方式。
- 确认在本地发布入口还是 CI 强制验签；不自行选择或购买证书。
- 保留现有更新源、资源摘要与安装器完整性检查；不得提交证书、私钥、密码或生成产物。
- 不承诺签名消除 SmartScreen 提示，不以自签名测试代替正式签名验收。

## Remaining milestones

- [ ] 在确认的 electron-builder 配置中接入签名脚本并配置发布者；验证实际传给 hook 的配置与现有脚本兼容。
- [ ] 在打包后、创建 tag/上传前，对安装器及解包应用 EXE 执行独立签名验证；任一验证失败中止发布。
- [ ] 用合成工具结果覆盖缺签名、错误发布者、工具失败与成功路径；实际证书测试仅在获授权的隔离环境执行。
- [ ] 在正式签名产物上验证签名、更新完整性和安装行为，更新构建参考及资源自检计划的相关验收状态。

## Verification, failure handling and done when

实施时运行 `node --test test/engineering/publish-release.test.js` 及受影响的打包/安装器检查；正式签名验收记录产物版本、验证结果和环境，不记录凭据。失败时停止发布，不删除业务数据；回退仅限本计划的构建/发布改动。全部里程碑及真实产物验收通过后才能归档。

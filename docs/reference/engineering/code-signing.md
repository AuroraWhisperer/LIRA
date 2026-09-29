# Windows 代码签名参考

本文维护已有签名工具的输入、行为与限制。构建接入和发布门禁尚未完成，剩余工作见 [签名接入计划](../../../specs/plans/windows-code-signing.md)。当前构建配置及发布流程见 [build.md](build.md)，更新包摘要验证见 [update.md](../desktop/update.md)。

## 1. 当前接入状态

- [sign-windows.js](../../../scripts/sign-windows.js) 已实现签名工具调用，但 `package.json` 的 `build.win` 未配置该 hook。
- [verify-windows-release.js](../../../scripts/verify-windows-release.js) 是可单独运行的签名验证 CLI；[publish-release.js](../../../scripts/publish-release.js) 尚未调用它。
- 构建和资源摘要检查已经接入；它们不能证明发布者身份。当前文档与自动化测试不构成正式证书签名或安装验收。

## 2. 签名脚本

`sign-windows.js` 导出异步 `default(configuration)`，读取 `configuration.path` 作为待签名文件。运行环境需要 Windows SDK 的 `signtool.exe`；脚本先查 PATH，再查内置 SDK 路径和 Windows Kits。

| 输入 | 行为 |
| --- | --- |
| `WINDOWS_CERT_FILE` | `.pfx` 文件路径；与指纹同时存在时优先使用文件 |
| `WINDOWS_CERT_PASSWORD` | 文件证书密码；有值时传给 signtool |
| `WINDOWS_CERT_THUMBPRINT` | 未设置证书文件时，按指纹使用 Windows 证书存储区 |

没有证书来源或找不到 signtool 时抛出错误。签名摘要使用 SHA-256，RFC 3161 时间戳摘要同样使用 SHA-256；按 DigiCert、Sectigo、GlobalSign 顺序尝试时间戳服务，全部失败后抛错，不退化为无时间戳签名。工具输出及异常经过 [release-output.js](../../../scripts/release-output.js) 脱敏；证书、私钥和密码不得进入版本库。

这些是现有脚本的契约，不代表打包入口已启用它。证书持有人需先确认发布者名称、证书来源与执行环境；具体接入由计划跟踪。

## 3. 独立验证 CLI

命令行位置参数依次为待验证 EXE 路径、预期发布者名称：

```text
node scripts/verify-windows-release.js <exe-path> <expected-publisher>
```

该行是参数语法，运行时需替换占位符。脚本拒绝空白发布者或不存在的文件，通过 PowerShell `Get-AuthenticodeSignature` 获取签名数据，再在 Node 中验证：

1. 签名状态必须为 `Valid`。
2. 签名证书原始数据必须存在，使用 `X509Certificate` 解码。
3. 证书必须具有单一字符串 CN；忽略大小写后与预期发布者**完全相等**。不使用 Subject 子串或正则模糊匹配。

失败退出码为 1，成功为 0；证书距到期不足 30 天时输出提示。脚本显示时间戳证书信息，但没有独立的“必须存在时间戳”断言，不能把签名工具的时间戳要求等同于此 CLI 的验证范围。

## 4. 验证边界

现有 [publish-release.test.js](../../../test/engineering/publish-release.test.js) 覆盖签名命令错误脱敏及发布者匹配等自动化行为。真实证书、签名后应用/安装器、强制发布门禁的验收属于未完成的接入计划。文档不承诺签名必然消除 SmartScreen 提示。

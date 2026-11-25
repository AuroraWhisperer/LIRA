# Windows 代码签名参考

本文维护已有代码签名与验证工具的输入、行为与边界。当前构建配置及发布流程见 [build.md](build.md)，更新包 SHA-512 校验见 [update.md](../desktop/update.md)，待完成的构建接入与发布门禁见 [签名接入计划](../../../specs/plans/windows-code-signing.md)。

## 1. 当前接入状态

- [sign-windows.js](../../../scripts/sign-windows.js) 已实现签名调用，但 `package.json` 的 `build.win` 尚未配置该签名钩子。
- [verify-windows-release.js](../../../scripts/verify-windows-release.js) 是可单独运行的签名验证 CLI，[publish-release.js](../../../scripts/publish-release.js) 尚未接入。
- 构建与安装包的资源摘要检查已经生效，但摘要验证仅用于确认文件完整性，不能替代发布者身份证明。

## 2. 签名脚本

`sign-windows.js` 导出异步 `default(configuration)`，读取 `configuration.path` 作为待签名文件。运行环境需要 Windows SDK 的 `signtool.exe`；脚本按 `PATH`、内置 SDK 路径与 Windows Kits 的顺序查找。

| 输入 | 行为 |
| --- | --- |
| `WINDOWS_CERT_FILE` | `.pfx` 文件路径；与指纹同时存在时优先使用文件 |
| `WINDOWS_CERT_PASSWORD` | 文件证书密码；非空时传给 `signtool` |
| `WINDOWS_CERT_THUMBPRINT` | 未设置证书文件时，按指纹使用 Windows 证书存储区 |

缺少证书来源或找不到 `signtool` 时直接抛出错误。签名摘要和 RFC 3161 时间戳摘要均使用 SHA-256；按 DigiCert、Sectigo、GlobalSign 顺序尝试时间戳服务，全部失败后直接抛错，不降级为无时间戳签名。工具输出及异常经 [release-output.js](../../../scripts/release-output.js) 脱敏；证书、私钥和密码不得进入版本库。

启用前需由证书持有人确认发布者名称、证书来源与执行环境（接入进度见顶部计划链接）。

## 3. 独立验证 CLI

命令行位置参数依次为待验证 EXE 路径与预期发布者名称：

```text
node scripts/verify-windows-release.js <exe-path> <expected-publisher>
```

脚本会拒绝空白发布者或不存在的文件路径，通过 PowerShell `Get-AuthenticodeSignature` 获取签名信息后，在 Node 中校验以下三项：

1. 签名状态必须为 `Valid`。
2. 签名证书原始数据必须存在，并能通过 `X509Certificate` 解码。
3. 证书仅含单一字符串 CN，忽略大小写后必须与预期发布者**完全一致**（不做 Subject 子串或正则模糊匹配）。

失败退出码为 1，成功为 0；证书距到期不足 30 天时输出提示。脚本会打印时间戳证书信息，但不会强制断言时间戳必须存在，不能把签名脚本的时间戳要求等同于本验证工具的检查范围。

## 4. 验证边界

现有 [publish-release.test.js](../../../test/engineering/publish-release.test.js) 覆盖了签名命令错误脱敏和发布者匹配逻辑；正式证书签发后的应用与安装器验收待接入完成后补充。注意：代码签名本身不能保证完全消除 Windows SmartScreen 提示。

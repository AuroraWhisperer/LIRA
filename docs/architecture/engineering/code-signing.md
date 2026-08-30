# Windows 代码签名

> 涉及文件:[package.json](../../../package.json)(`build.win` 签名配置)、[scripts/sign-windows.js](../../../scripts/sign-windows.js)(签名脚本,待实现)、[scripts/verify-windows-release.js](../../../scripts/verify-windows-release.js)(签名验证,待实现)、[scripts/publish-release.js](../../../scripts/publish-release.js)(发布门禁集成点)

本文档是 Windows 代码签名的**唯一事实源**:签名配置、证书存储、验证流程、发布门禁、测试策略只在此成文。当前状态:**设计完成,实现阻塞于所有者输入**(见 §1)。构建配置见 [build.md](build.md),自动更新的完整性验证见 [../desktop/update.md](../desktop/update.md)(SHA-512 哈希验证已存在)。

## 1. 阻塞:所需所有者输入

实现代码签名需要以下决策,**仅所有者能提供**:

| 决策项                         | 说明                                                                                              | 示例                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **发布者名称(Publisher Name)** | 证书主题(CN)中的名称,安装时向用户显示。必须与购买/生成的代码签名证书完全匹配。                    | `Aurora`、`AuroraWhisperer`、`LIRA Dev Team`                                           |
| **证书存储方式**               | 选项 1:文件存储(.pfx 文件路径 + 密码环境变量名)<br>选项 2:Windows 证书存储区(证书指纹 thumbprint) | 文件:`WINDOWS_CERT_FILE` + `WINDOWS_CERT_PASSWORD`<br>存储区:`WINDOWS_CERT_THUMBPRINT` |
| **CI/自动化构建中的签名策略**  | 是否在 CI 中强制签名检查,或仅在手动发布脚本中执行。CI 需配置证书访问权限。                        | 手动发布:仅 `release:win` 验证<br>CI 强制:所有 `dist:win` 构建必须签名                 |

**证书获取途径**:

- 正式证书:通过 SSL.com、DigiCert、Sectigo 等 CA 购买 EV Code Signing Certificate(Extended Validation,最高可信度)或标准 Code Signing Certificate
- 测试证书:使用 PowerShell `New-SelfSignedCertificate` 生成自签名证书(仅测试,Windows SmartScreen 仍会警告)

**当前状态**:设计已完成(见 §2-§6),签名脚本与验证脚本为骨架实现(见 §3、§4),等待所有者提供上述输入后填充实际配置。

## 2. electron-builder 签名配置

在 [package.json](../../../package.json) 的 `build.win` 中添加签名配置(当前未配置):

```json
"win": {
  "icon": "build/icon.ico",
  "target": [...],
  "signingHashAlgorithms": ["sha256"],
  "certificateSubjectName": "<OWNER_INPUT_PUBLISHER_NAME>",
  "sign": "./scripts/sign-windows.js"
}
```

| 字段                     | 说明                                             |
| ------------------------ | ------------------------------------------------ |
| `signingHashAlgorithms`  | 签名哈希算法,使用 SHA-256(Windows 10+ 推荐)      |
| `certificateSubjectName` | 证书主题中的发布者名称,必须与证书 CN 精确匹配    |
| `sign`                   | 自定义签名脚本路径,electron-builder 在打包时调用 |

`sign` 脚本接收 electron-builder 传入的参数:`{configuration, path, outDir}`(见 §3)。

## 3. 签名脚本设计(scripts/sign-windows.js)

**当前状态**:骨架已创建,证书加载与 signtool 调用逻辑等待所有者输入后实现。

脚本职责:

1. 从环境变量加载证书配置(文件路径 + 密码,或证书存储区指纹)
2. 调用 Windows SDK 的 `signtool.exe` 对传入的可执行文件签名
3. 使用时间戳服务器(Timestamp Server)确保签名长期有效

签名命令模板:

```powershell
signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f <cert_file> /p <password> <exe_path>
# 或使用证书存储区:
signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /sha1 <thumbprint> <exe_path>
```

| 参数                 | 说明                                             |
| -------------------- | ------------------------------------------------ |
| `/fd SHA256`         | 文件摘要算法 SHA-256                             |
| `/tr <url>`          | RFC 3161 时间戳服务器 URL(DigiCert 提供免费服务) |
| `/td SHA256`         | 时间戳摘要算法 SHA-256                           |
| `/f <file>`          | .pfx 证书文件路径                                |
| `/p <password>`      | 证书密码                                         |
| `/sha1 <thumbprint>` | 从 Windows 证书存储区按指纹选择证书              |

**环境变量约定**(所有者决策后确定):

- 文件方式:`WINDOWS_CERT_FILE`(绝对路径)+ `WINDOWS_CERT_PASSWORD`(密码)
- 存储区方式:`WINDOWS_CERT_THUMBPRINT`(40 位十六进制指纹)

时间戳服务器备选:

- DigiCert:`http://timestamp.digicert.com`(推荐)
- Sectigo:`http://timestamp.sectigo.com`
- GlobalSign:`http://timestamp.globalsign.com`

## 4. 签名验证脚本(scripts/verify-windows-release.js)

**当前状态**:骨架已创建,PowerShell `Get-AuthenticodeSignature` 检查逻辑已设计。

验证流程:

1. 使用 PowerShell `Get-AuthenticodeSignature` 读取可执行文件的签名信息
2. 检查签名状态:`$sig.Status` 必须为 `Valid`
3. 检查发布者名称:`$sig.SignerCertificate.Subject` 必须包含预期的 `certificateSubjectName`
4. 验证失败则抛出错误,阻止发布流程继续

PowerShell 验证逻辑:

```powershell
param([string]$FilePath, [string]$ExpectedPublisher)

$sig = Get-AuthenticodeSignature $FilePath

if ($sig.Status -ne 'Valid') {
  Write-Error "签名无效: $($sig.Status)"
  exit 1
}

if ($sig.SignerCertificate.Subject -notmatch [regex]::Escape($ExpectedPublisher)) {
  Write-Error "发布者不匹配: 期望 $ExpectedPublisher, 实际 $($sig.SignerCertificate.Subject)"
  exit 1
}

Write-Host "签名验证通过: $($sig.SignerCertificate.Subject)"
```

该脚本由 Node.js 通过 `child_process.execFileSync` 调用,stdout 输出签名信息,非零退出码表示验证失败。

## 5. 发布门禁集成

在 [scripts/publish-release.js](../../../scripts/publish-release.js) 的 electron-builder 成功后(当前 §7 步骤 6-7 之间)插入签名验证:

```javascript
// 在 electron-builder 循环成功后、findMissingAssets 前插入
const exePath = path.join(ROOT_DIR, 'release', EXE_NAME);
const expectedPublisher = PKG.build.win.certificateSubjectName;

if (!expectedPublisher) {
  throw new Error('build.win.certificateSubjectName 未配置,无法验证签名。');
}

log(`Verifying code signature for ${exePath}`);
try {
  execFileSync(
    'powershell',
    [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(ROOT_DIR, 'scripts', 'verify-windows-release.js'),
      '-FilePath',
      exePath,
      '-ExpectedPublisher',
      expectedPublisher,
    ],
    { cwd: ROOT_DIR, stdio: 'inherit' },
  );
} catch (error) {
  throw new Error(
    `Release gate failed: ${exePath} 签名验证失败。\n` +
      `拒绝发布未签名或发布者不匹配的构建产物。\n` +
      `请检查签名配置和证书是否正确。`,
  );
}
```

**门禁策略**:签名验证失败时,发布脚本**立即中止**,不上传任何产物到 GitHub Releases。确保用户下载的安装包必然包含有效签名。

## 6. 测试策略

### 6.1 生成测试证书

在 PowerShell(管理员)中生成自签名代码签名证书:

```powershell
# 生成证书并安装到当前用户的证书存储区
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=LIRA Test,O=Test,C=CN" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears(2)

# 导出为 .pfx 文件(需设置密码)
$password = ConvertTo-SecureString -String "test123" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "test-cert.pfx" -Password $password

# 获取证书指纹
$cert.Thumbprint
```

测试证书生成后:

- 文件方式测试:设置 `WINDOWS_CERT_FILE=<path-to-test-cert.pfx>` + `WINDOWS_CERT_PASSWORD=test123`
- 存储区方式测试:设置 `WINDOWS_CERT_THUMBPRINT=<thumbprint>`

### 6.2 测试用例

| 场景         | 配置                                                                     | 预期结果                                                         |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 正常签名     | 配置有效证书 + `certificateSubjectName="LIRA Test"`                      | `npm run dist:win` 成功,`verify-windows-release.js` 验证通过     |
| 缺失证书     | 未设置证书环境变量                                                       | `sign-windows.js` 报错,electron-builder 失败                     |
| 发布者不匹配 | 证书 CN 为 `LIRA Test`,`certificateSubjectName` 配置为 `Wrong Publisher` | `verify-windows-release.js` 验证失败,exit code 1                 |
| 无签名构建   | 不配置 `build.win.sign`                                                  | `verify-windows-release.js` 检测到 `Status: NotSigned`,验证失败  |
| 签名损坏     | 手动修改已签名的 .exe 二进制                                             | `Get-AuthenticodeSignature` 返回 `Status: HashMismatch`,验证失败 |

测试步骤:

1. 安装测试证书(见 §6.1)
2. 配置 `package.json`:设置 `certificateSubjectName="LIRA Test"` + `sign="./scripts/sign-windows.js"`
3. 运行 `npm run dist:win`(或 `dist:win:local`)
4. 验证 `release/lira-setup-<version>.exe` 签名:`powershell -Command "Get-AuthenticodeSignature release\lira-setup-<version>.exe | Format-List"`
5. 运行 `node scripts/verify-windows-release.js -FilePath release\lira-setup-<version>.exe -ExpectedPublisher "LIRA Test"`

**Windows SmartScreen 行为**:自签名证书的应用在首次运行时仍会触发 SmartScreen 警告("Windows 已保护你的电脑"),需点击「更多信息」→「仍要运行」。正式 EV 证书购买后,积累足够下载量与良好声誉后,SmartScreen 警告会消失。

### 6.3 CI 集成测试

若所有者决定在 CI 中启用签名:

1. 将证书与密码存为 GitHub Secrets:`WINDOWS_CERT_FILE_BASE64`(Base64 编码的 .pfx)+ `WINDOWS_CERT_PASSWORD`
2. CI workflow 中解码证书:`echo $WINDOWS_CERT_FILE_BASE64 | base64 -d > cert.pfx`
3. 设置环境变量后运行 `npm run dist:win`
4. 验证签名后再上传产物

## 7. 当前完整性保护机制

**已存在的保护**(无需代码签名):

- **SHA-512 哈希验证**:electron-updater 在下载更新后,根据 `latest.yml` 中的 `sha512` 字段验证安装包完整性([update-manager.js:161-173](../../../src/electron/update-manager.js#L161-L173)的 `checksum mismatch` 错误映射)
- **HTTPS 传输**:GitHub Releases 通过 HTTPS 下载,防止中间人篡改
- **GitHub 基础设施保护**:Releases 产物由 GitHub Actions 或授权账户上传,受 GitHub 访问控制保护

**代码签名的附加价值**:

- **Windows SmartScreen 信誉**:正式 EV 证书签名的应用不会触发 SmartScreen 警告,提升用户安装体验
- **发布者身份验证**:用户可通过签名证书验证应用确实来自声明的发布者
- **企业环境兼容性**:部分企业 IT 策略仅允许安装已签名的应用
- **长期可验证性**:时间戳签名确保证书过期后,签名时的有效性仍可验证

代码签名与 SHA-512 哈希验证互补:哈希验证保护传输完整性,代码签名验证发布者身份与 Windows 生态集成。

## 8. 文档维护

一旦所有者提供必需输入并实现签名功能,需更新以下文档:

| 文档                                         | 更新内容                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [build.md](build.md)                         | 更新 §3 `build.win` 配置表,添加 `signingHashAlgorithms`、`certificateSubjectName`、`sign` 行;更新 §7 发布流程,插入签名验证步骤 |
| [../desktop/update.md](../desktop/update.md) | §7 当前完整性保护机制,补充代码签名已启用,更新 §5 错误映射(若签名验证失败有新错误码)                                            |
| 本文档                                       | 移除 §1 阻塞状态,更新 §3、§4 为实际实现,补充实际证书提供商与指纹示例                                                           |

## 9. 安全注意事项

| 风险             | 缓解措施                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| 证书私钥泄露     | **绝不**将 .pfx 文件或密码提交到 Git 仓库;使用环境变量或密钥管理服务(如 Azure Key Vault);定期轮换证书              |
| 签名脚本权限过高 | `sign-windows.js` 仅接受 electron-builder 传入的参数,不读取外部配置文件;限制证书访问权限(文件权限或证书存储区 ACL) |
| 时间戳服务不可用 | 签名时必须成功获取时间戳,否则证书过期后签名失效;配置重试逻辑或备用时间戳服务器                                     |
| 测试证书混入生产 | 发布脚本验证 `certificateSubjectName` 是否与生产证书匹配;CI 中使用不同的环境变量前缀区分测试/生产证书              |

**证书存储最佳实践**:

- 本地开发:使用 Windows 证书存储区(无需文件管理,密码由系统保护)
- CI/CD:使用加密的 Secrets 存储 Base64 编码的 .pfx + 密码,构建时临时解码到内存或临时文件
- 生产发布:由受信任的发布者在本地机器上执行,证书私钥不离开该机器

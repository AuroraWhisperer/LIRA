'use strict';

/**
 * Windows 代码签名验证脚本
 *
 * 用途:验证构建产物的 Authenticode 签名有效性与发布者身份
 * 调用方:scripts/publish-release.js(发布门禁)
 * 依赖:PowerShell Get-AuthenticodeSignature
 *
 * 使用方式:
 *   node scripts/verify-windows-release.js <exe-path> <expected-publisher>
 *
 * 退出码:
 *   0 - 签名有效且发布者匹配
 *   1 - 签名无效、发布者不匹配或脚本错误
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node verify-windows-release.js <exe-path> <expected-publisher>');
  console.error('Example: node verify-windows-release.js release/lira-setup-3.4.14.exe "Aurora"');
  process.exit(1);
}

const [exePath, expectedPublisher] = args;

// 验证文件存在
if (!fs.existsSync(exePath)) {
  console.error(`[verify-signature] File not found: ${exePath}`);
  process.exit(1);
}

const absolutePath = path.resolve(exePath);
console.log(`[verify-signature] Verifying: ${absolutePath}`);
console.log(`[verify-signature] Expected publisher: ${expectedPublisher}`);

try {
  // 调用 PowerShell Get-AuthenticodeSignature
  const psScript = `
    $sig = Get-AuthenticodeSignature -FilePath '${absolutePath.replace(/'/g, "''")}'

    # 输出 JSON 格式便于解析
    @{
      Status = $sig.Status.ToString()
      StatusMessage = $sig.StatusMessage
      SignerCertificateSubject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
      SignerCertificateIssuer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Issuer } else { $null }
      SignerCertificateNotAfter = if ($sig.SignerCertificate) { $sig.SignerCertificate.NotAfter.ToString('o') } else { $null }
      TimeStamperCertificateSubject = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { $null }
    } | ConvertTo-Json -Compress
  `;

  const result = execFileSync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', psScript
  ], { encoding: 'utf8', shell: false });

  const sigInfo = JSON.parse(result.trim());

  console.log(`[verify-signature] Signature status: ${sigInfo.Status}`);
  if (sigInfo.SignerCertificateSubject) {
    console.log(`[verify-signature] Signer: ${sigInfo.SignerCertificateSubject}`);
  }
  if (sigInfo.TimeStamperCertificateSubject) {
    console.log(`[verify-signature] Timestamp: ${sigInfo.TimeStamperCertificateSubject}`);
  }

  // 检查签名状态
  if (sigInfo.Status !== 'Valid') {
    console.error(`[verify-signature] ❌ Signature status is not Valid: ${sigInfo.Status}`);
    if (sigInfo.StatusMessage) {
      console.error(`[verify-signature] Details: ${sigInfo.StatusMessage}`);
    }

    if (sigInfo.Status === 'NotSigned') {
      console.error('[verify-signature] The executable is not signed. Configure build.win.sign in package.json.');
    } else if (sigInfo.Status === 'HashMismatch') {
      console.error('[verify-signature] The file has been modified after signing.');
    }

    process.exit(1);
  }

  // 检查发布者名称
  if (!sigInfo.SignerCertificateSubject) {
    console.error('[verify-signature] ❌ Signer certificate subject is missing.');
    process.exit(1);
  }

  // 简单的包含检查(CN=expectedPublisher 或 expectedPublisher 出现在 Subject 中)
  const subjectLower = sigInfo.SignerCertificateSubject.toLowerCase();
  const expectedLower = expectedPublisher.toLowerCase();

  if (!subjectLower.includes(expectedLower)) {
    console.error(`[verify-signature] ❌ Publisher mismatch:`);
    console.error(`  Expected: ${expectedPublisher}`);
    console.error(`  Actual: ${sigInfo.SignerCertificateSubject}`);
    process.exit(1);
  }

  console.log('[verify-signature] ✅ Signature verification passed.');
  console.log(`[verify-signature] Publisher verified: ${expectedPublisher}`);

  if (sigInfo.SignerCertificateNotAfter) {
    const expiryDate = new Date(sigInfo.SignerCertificateNotAfter);
    const now = new Date();
    const daysUntilExpiry = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 30) {
      console.warn(`[verify-signature] ⚠️  Certificate expires in ${daysUntilExpiry} days (${expiryDate.toISOString().split('T')[0]})`);
    }
  }

  process.exit(0);

} catch (error) {
  console.error(`[verify-signature] ❌ Verification failed: ${error.message}`);

  if (error.stderr) {
    console.error('[verify-signature] PowerShell stderr:', error.stderr.toString());
  }

  process.exit(1);
}

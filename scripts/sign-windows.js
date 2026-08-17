'use strict';

/**
 * Windows 代码签名脚本
 *
 * 用途:为 electron-builder 打包的可执行文件添加 Authenticode 数字签名
 * 调用方:electron-builder(通过 package.json build.win.sign 配置)
 * 依赖:Windows SDK signtool.exe
 *
 * 环境变量:
 *   WINDOWS_CERT_FILE - .pfx 证书文件路径(文件方式)
 *   WINDOWS_CERT_PASSWORD - 证书密码(文件方式)
 *   WINDOWS_CERT_THUMBPRINT - 证书指纹(Windows 证书存储区方式)
 *
 * electron-builder 调用签名:
 *   sign(configuration) 返回 Promise<void>
 *   configuration.path - 待签名的可执行文件路径
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// RFC 3161 时间戳服务器(优先级顺序)
const TIMESTAMP_SERVERS = [
  'http://timestamp.digicert.com',
  'http://timestamp.sectigo.com',
  'http://timestamp.globalsign.com'
];

// signtool.exe 通常位于 Windows SDK 中,搜索路径
const SIGNTOOL_SEARCH_PATHS = [
  'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe',
  'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe',
  'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22000.0\\x64\\signtool.exe'
];

/**
 * electron-builder 签名接口
 * @param {Object} configuration - electron-builder 配置对象
 * @param {string} configuration.path - 待签名文件路径
 * @param {string} configuration.hash - 哈希算法(通常为 'sha256')
 * @param {Object} configuration.options - 额外选项
 * @returns {Promise<void>}
 */
exports.default = async function sign(configuration) {
  const filePath = configuration.path;
  console.log(`[sign-windows] Signing: ${filePath}`);

  // 检查证书配置
  const certFile = process.env.WINDOWS_CERT_FILE;
  const certPassword = process.env.WINDOWS_CERT_PASSWORD;
  const certThumbprint = process.env.WINDOWS_CERT_THUMBPRINT;

  if (!certFile && !certThumbprint) {
    throw new Error(
      'Windows code signing certificate not configured.\n' +
      'Set either WINDOWS_CERT_FILE + WINDOWS_CERT_PASSWORD (for .pfx file)\n' +
      'or WINDOWS_CERT_THUMBPRINT (for Windows certificate store).\n' +
      'See docs/architecture/engineering/code-signing.md for details.'
    );
  }

  // 查找 signtool.exe
  const signtool = findSigntool();
  if (!signtool) {
    throw new Error(
      'signtool.exe not found. Install Windows SDK from:\n' +
      'https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/'
    );
  }

  console.log(`[sign-windows] Using signtool: ${signtool}`);

  // 构建 signtool 参数
  const args = ['sign', '/fd', 'sha256'];

  // 证书来源
  if (certFile) {
    console.log(`[sign-windows] Using certificate file: ${certFile}`);
    args.push('/f', certFile);
    if (certPassword) {
      args.push('/p', certPassword);
    }
  } else {
    console.log(`[sign-windows] Using certificate from store: ${certThumbprint}`);
    args.push('/sha1', certThumbprint);
  }

  // 时间戳(带重试)
  let timestampSuccess = false;
  let lastTimestampError = null;

  for (const tsUrl of TIMESTAMP_SERVERS) {
    try {
      console.log(`[sign-windows] Attempting timestamp: ${tsUrl}`);
      const tsArgs = [...args, '/tr', tsUrl, '/td', 'sha256', filePath];

      execFileSync(signtool, tsArgs, {
        stdio: 'inherit',
        shell: false
      });

      timestampSuccess = true;
      console.log(`[sign-windows] ✅ Signed successfully with timestamp from ${tsUrl}`);
      break;

    } catch (error) {
      lastTimestampError = error;
      console.warn(`[sign-windows] ⚠️  Timestamp server ${tsUrl} failed: ${error.message}`);
    }
  }

  if (!timestampSuccess) {
    throw new Error(
      `Failed to sign with timestamp after trying all servers.\n` +
      `Last error: ${lastTimestampError?.message || 'unknown'}\n` +
      `Signing without timestamp is not recommended (signature expires with certificate).`
    );
  }
};

/**
 * 查找 signtool.exe 路径
 * @returns {string|null} signtool.exe 完整路径,未找到则返回 null
 */
function findSigntool() {
  const fs = require('node:fs');

  // 优先从 PATH 查找
  try {
    execFileSync('where', ['signtool.exe'], { encoding: 'utf8', shell: true });
    return 'signtool.exe'; // 在 PATH 中可直接调用
  } catch {
    // PATH 中未找到,搜索常见安装路径
  }

  for (const candidatePath of SIGNTOOL_SEARCH_PATHS) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  // 尝试通过 where.exe 在 Program Files 中搜索(Windows 10+)
  try {
    const result = execFileSync(
      'cmd',
      ['/c', 'dir', '/s', '/b', 'C:\\Program Files (x86)\\Windows Kits\\*signtool.exe'],
      { encoding: 'utf8', shell: false, timeout: 10000 }
    );
    const lines = result.trim().split('\n');
    if (lines.length > 0 && lines[0].trim()) {
      return lines[0].trim();
    }
  } catch {
    // 搜索失败,返回 null
  }

  return null;
}

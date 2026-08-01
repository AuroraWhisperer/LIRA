// 一键探针运行器
// 用法:
//   node run-probe.js [--dry-run] [--endpoint musicu|musics]
//   node run-probe.js --port=3000
//
// 工作流程:
//   1. 尝试从运行中的「点歌助手」服务 GET /api/debug/music-cookie 拿 Cookie
//   2. 如果服务未运行, 回退到读取 .cookies-dump.txt
//   3. 拿到 Cookie 后启动 probe-addsonglist.js (交互模式)
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE_SCRIPT = path.join(__dirname, 'probe-addsonglist.js');
const COOKIE_FILE = path.join(__dirname, '.cookies-dump.txt');

// 从 CLI 参数提取配置
const extraEnv = {};
const passArgs = [];
let serverPort = 3000;

for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--(\w[\w-]*)=(.*)$/);
  if (m) {
    if (m[1] === 'port') {
      serverPort = parseInt(m[2], 10) || 3000;
    } else if (m[1] === 'endpoint') {
      extraEnv.ENDPOINT = m[2];
    } else {
      extraEnv[m[1].toUpperCase()] = m[2];
    }
  } else if (arg === '--dry-run') {
    passArgs.push('--dry-run');
  }
}

async function fetchCookieFromServer() {
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/debug/music-cookie?platform=qq`, {
      signal: AbortSignal.timeout(3000)
    });
    const json = await res.json();
    if (json.ok && json.data && json.data.cookie) {
      console.log(`📋 从运行中的服务获取 Cookie (${json.data.cookie.length} 字符)`);
      return json.data.cookie;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function readCachedCookies() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return null;
    const stat = fs.statSync(COOKIE_FILE);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
    if (ageMinutes > 30) {
      console.log(`⚠️  缓存文件已过期 (${Math.round(ageMinutes)} 分钟前)`);
      return null;
    }
    const content = fs.readFileSync(COOKIE_FILE, 'utf8').trim();
    if (!content) return null;
    console.log(`📋 使用缓存 Cookie (${Math.round(ageMinutes)} 分钟前, ${content.length} 字符)`);
    return content;
  } catch (_) {
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  QQ 音乐 AddSonglist 探针运行器');
  console.log('═══════════════════════════════════════');
  console.log();

  let cookie = process.env.QQ_COOKIE || '';

  if (!cookie) {
    console.log('🔍 尝试从运行中的服务获取 Cookie...');
    cookie = await fetchCookieFromServer();
  } else {
    console.log('📋 使用环境变量中的 QQ_COOKIE (' + cookie.length + ' 字符)');
  }

  if (!cookie) {
    cookie = readCachedCookies();
  }

  if (!cookie) {
    console.log('❌ 没有可用的 Cookie。');
    console.log();
    console.log('获取方式:');
    console.log('  1. 确保「点歌助手」正在运行且已登录 QQ 音乐');
    console.log('  2. 然后重新运行: node run-probe.js');
    console.log();
    console.log('或手动设置:');
    console.log('  set QQ_COOKIE=key1=val1; key2=val2');
    console.log('  node probe-addsonglist.js');
    process.exit(1);
  }

  console.log();

  // 运行探针, 继承 stdin/stdout/stderr 以支持交互
  const env = { ...process.env, QQ_COOKIE: cookie, ...extraEnv };
  const args = [...passArgs];

  console.log('🚀 启动探针...');
  console.log();

  const probe = spawn('node', [PROBE_SCRIPT, ...args], {
    cwd: __dirname,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  probe.on('close', (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error('运行失败:', err.message);
  process.exit(1);
});

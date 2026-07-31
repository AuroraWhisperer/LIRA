// 编写人：Aurora
// Bilibili 直播全量数据抓包脚本（记录所有消息类型和完整字段）。
// 用法：node scripts/capture-gifts.js <房间号> [抓包时长秒数，默认120] [cookie文件路径，可选]
// 输出：captured-gifts-<房间号>-<时间戳>.json
'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const wbiSigner = require('../src/bilibili/wbi-signer');

const ROOM_ID = process.argv[2] || '';
const CAPTURE_SECONDS = Math.min(Number(process.argv[3]) || 120, 600);
const COOKIE_FILE = process.argv[4] || '';  // 可选：包含完整 Cookie 字符串的文本文件路径

if (!ROOM_ID || !/^\d+$/.test(ROOM_ID)) {
  console.error('用法: node scripts/capture-gifts.js <房间号> [抓包秒数] [cookie文件路径]');
  console.error('例如: node scripts/capture-gifts.js 123456 300');
  console.error('      node scripts/capture-gifts.js 123456 120 cookies.txt');
  process.exit(1);
}

// 读取 Cookie 文件
let cookieStr = '';
if (COOKIE_FILE) {
  try {
    cookieStr = fs.readFileSync(COOKIE_FILE, 'utf8').trim();
    console.log(`ℹ️  已加载 Cookie 文件: ${COOKIE_FILE} (${cookieStr.length} 字符)`);
  } catch (e) {
    console.warn(`⚠️  无法读取 Cookie 文件 "${COOKIE_FILE}": ${e.message}，将使用匿名连接`);
  }
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Origin': 'https://live.bilibili.com',
  'Referer': `https://live.bilibili.com/${ROOM_ID}`,
  'Cookie': cookieStr
};

const outPath = path.join(__dirname, '..', `captured-gifts-${ROOM_ID}-${Date.now()}.json`);
const captured = {
  startedAt: new Date().toISOString(),
  roomId: ROOM_ID,
  roomInfo: null,
  messages: [],         // 所有消息
  giftMessages: [],     // 礼物相关消息（快捷子集）
  cmdSummary: {},
  giftNameSummary: {},  // 礼物名称分布
  droppedMessages: []   // 被丢弃的消息（错误信息）
};

// ── 诊断计数器 ──
const stats = {
  wsFramesReceived: 0,       // WebSocket 原始帧数
  wsFrameErrors: 0,          // WebSocket 帧处理失败数
  wsBytesReceived: 0,        // WebSocket 接收字节总数
  packetsParsed: 0,          // 成功解析的协议包数
  rawBodies: 0,              // 原始 JSON body 数（protover 0）
  brotliBodies: 0,           // brotli 解压次数
  brotliBytes: 0,            // brotli 压缩前总字节数
  brotliDecompBytes: 0,      // brotli 解压后总字节数
  zlibBodies: 0,             // zlib 解压次数
  decompressErrors: 0,       // 解压失败次数
  jsonParseErrors: 0,        // JSON 解析失败次数
  unknownOperations: {},     // 未知 operation 码统计
  rates: [],                 // 每秒消息数
  rateSecond: 0,
  rateCount: 0,
  lastMessageTime: Date.now(), // 最后收到消息的时间戳（用于检测空闲间隔）
  idleGaps: []               // 超过 2 秒的空闲间隔
};

// 实时礼物计数器（模块作用域，供 recordMessage 和 status timer 共享）
let liveGiftCount = 0;
let liveSendGiftCount = 0;
let liveComboCount = 0;

// ── 工具 ──

function splitJsonObjects(text) {
  if (!text) return [];
  const chunks = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; }
    else if (char === '{') { if (depth === 0) start = i; depth += 1; }
    else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) { chunks.push(text.slice(start, i + 1)); start = -1; }
    }
  }
  return chunks;
}

function isGiftLike(cmd) {
  const text = String(cmd || '').toUpperCase();
  return text.includes('GIFT') || text.includes('COMBO') || text.includes('GUARD')
      || text.includes('WIDGET') || text.includes('BANNER') || text.includes('USER_TOAST')
      || text.includes('SUPER_CHAT');
}

function getAllKeys(obj, prefix) {
  if (!obj || typeof obj !== 'object') return prefix || '';
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(k + ':{' + getAllKeys(v, '') + '}');
    } else {
      keys.push(k);
    }
  }
  return (prefix ? prefix + '.' : '') + keys.join(', ');
}

function readGiftName(data) {
  if (!data) return '';
  // 标准礼物
  let name = data.giftName || data.gift_name || data.giftName_v2 || '';
  if (name) return name;
  // 大航海
  name = data.role_name || data.roleName || '';
  if (name) return name;
  // 嵌套 gift_info
  if (data.gift_info) {
    name = data.gift_info.gift_name || data.gift_info.giftName || '';
    if (name) return name;
  }
  // SUPER_CHAT_MESSAGE 的 gift 子对象
  if (data.gift && typeof data.gift === 'object') {
    name = data.gift.gift_name || data.gift.giftName || '';
    if (name) return name;
  }
  return '';
}

function readPrice(data) {
  if (!data) return 0;
  // 普通价格（瓜子 / 电池）
  let val = data.price || data.total_price || data.totalPrice || 0;
  if (val) return Number(val) || 0;
  // combo 总价（COMBO_SEND 专用）
  val = data.combo_total_coin || data.comboTotalCoin || 0;
  if (val) return Number(val) || 0;
  // 总金币
  val = data.total_coin || data.totalCoin || 0;
  if (val) return Number(val) || 0;
  // 嵌套支付信息
  if (data.pay_info) {
    val = data.pay_info.price || data.pay_info.amount || 0;
    if (val) return Number(val) || 0;
  }
  // 嵌套礼物信息
  if (data.gift_info) {
    val = data.gift_info.price || 0;
    if (val) return Number(val) || 0;
  }
  return 0;
}

function readQuantity(data) {
  if (!data) return 1;
  const num = data.num || data.gift_num || data.giftNum || data.combo_num || data.comboNum
    || data.batch_combo_num || data.batchComboNum || data.total_num || data.totalNum || 1;
  return Number(num) || 1;
}

function readUser(data) {
  if (!data) return '';
  return data.uname || data.username || data.user_name || data.r_uname
    || (data.sender_uinfo && data.sender_uinfo.base && data.sender_uinfo.base.name)
    || (data.uinfo && data.uinfo.base && data.uinfo.base.name)
    || '';
}

function save() {
  fs.writeFileSync(outPath, JSON.stringify(captured, null, 2));
}

// ── 主流程 ──

async function main() {
  console.log(`[1/3] 解析房间...`);
  const roomRes = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${ROOM_ID}`, { headers: HEADERS });
  const roomData = await roomRes.json();
  if (roomData.code !== 0) throw new Error(`房间解析失败: code=${roomData.code}`);
  const { room_id: realRoomId, uid } = roomData.data;
  captured.roomInfo = roomData.data;
  console.log(`   real_room_id=${realRoomId} uid=${uid} live_status=${roomData.data.live_status}`);

  // 提取当前登录用户 UID（如果有 cookie）
  let myUid = 0;
  if (cookieStr) {
    const m = cookieStr.match(/DedeUserID=(\d+)/);
    if (m) myUid = Number(m[1]);
  }
  console.log(`   认证方式: ${myUid > 0 ? `已登录 (uid=${myUid})` : '匿名 (uid=0) — ⚠️ 可能被限流'}`);

  console.log(`[2/3] 获取弹幕服务器...`);
  const danmuQuery = await wbiSigner.signBilibiliWbiParams({ id: realRoomId, type: 0 }, HEADERS);
  const danmuRes = await fetch(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${danmuQuery}`, { headers: HEADERS });
  const danmuData = await danmuRes.json();
  if (danmuData.code !== 0) throw new Error(`弹幕服务器失败: code=${danmuData.code}`);

  const hostList = danmuData.data.host_list || [];
  const host = hostList[0];
  const wsUrl = `wss://${host.host}:${host.wss_port}/sub`;
  const authPayload = JSON.stringify({
    uid: myUid, roomid: realRoomId, protover: 3, platform: 'web', type: 2, key: danmuData.data.token
  });
  console.log(`   ws_url=${wsUrl}`);
  if (hostList.length > 1) {
    console.log(`   可用服务器: ${hostList.length} 个 (${hostList.map(h => h.host).join(', ')})`);
  }

  console.log(`[3/3] 采集 ${CAPTURE_SECONDS}s，记录所有消息类型...\n`);

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  let heartbeatTimer, captureTimer, statsTimer, stopped = false;

  // 重置计数器
  liveGiftCount = 0;
  liveSendGiftCount = 0;
  liveComboCount = 0;
  stats.lastMessageTime = Date.now();

  // 每秒统计消息速率 + 每10秒打印状态
  let lastStatusSec = 0;
  statsTimer = setInterval(() => {
    if (stats.rateCount > 0) {
      stats.rates.push({ second: stats.rateSecond, count: stats.rateCount });
    }
    stats.rateSecond++;
    // 检测空闲间隔
    const idleMs = Date.now() - stats.lastMessageTime;
    if (idleMs > 3000) {
      stats.idleGaps.push({ second: stats.rateSecond, idleMs });
    }
    stats.rateCount = 0;
    // 每10秒打印实时状态
    if (stats.rateSecond - lastStatusSec >= 10) {
      lastStatusSec = stats.rateSecond;
      const elapsed = stats.rateSecond;
      const remaining = CAPTURE_SECONDS - elapsed;
      const idleWarn = idleMs > 5000 ? ` ⚠️空闲${(idleMs/1000).toFixed(0)}s` : '';
      console.log(`\n⏱  [${elapsed}s/${CAPTURE_SECONDS}s] SEND_GIFT=${liveSendGiftCount} COMBO=${liveComboCount} 总礼物=${liveGiftCount} | WS帧=${stats.wsFramesReceived} 消息=${captured.messages.length} 丢弃=${captured.droppedMessages.length} KB=${(stats.wsBytesReceived/1024).toFixed(1)} 剩余=${remaining}s${idleWarn}\n`);
    }
  }, 1000);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeatTimer);
    clearInterval(captureTimer);
    clearInterval(statsTimer);
    try { ws.close(); } catch (_) {}
    save();
    printReport();
    process.exit(0);
  };
  process.on('SIGINT', stop);

  ws.addEventListener('open', () => {
    console.log('✅ 已连接\n');
    sendPacket(ws, 7, 1, authPayload);
    heartbeatTimer = setInterval(() => sendPacket(ws, 2, 1, '{}'), 30000);
    captureTimer = setTimeout(stop, CAPTURE_SECONDS * 1000);
  });

  ws.addEventListener('message', (event) => {
    if (stopped) return;
    stats.wsFramesReceived++;
    stats.lastMessageTime = Date.now();
    try {
      let data;
      if (event.data instanceof ArrayBuffer) {
        data = Buffer.from(event.data);
      } else if (Buffer.isBuffer(event.data)) {
        data = event.data;
      } else if (typeof event.data === 'string') {
        data = Buffer.from(event.data, 'utf8');
      } else {
        stats.wsFrameErrors++;
        captured.droppedMessages.push({
          timestamp: new Date().toISOString(),
          reason: 'unknown_data_type',
          dataType: typeof event.data,
          constructor: String(event.data && event.data.constructor && event.data.constructor.name)
        });
        return;
      }
      stats.wsBytesReceived += data.length;
      parsePacket(data);
    } catch (e) {
      stats.wsFrameErrors++;
      captured.droppedMessages.push({
        timestamp: new Date().toISOString(),
        reason: 'ws_frame_error',
        error: e.message || String(e)
      });
    }
  });

  ws.addEventListener('close', () => { if (!stopped) stop(); });
  ws.addEventListener('error', (e) => { console.error('WS error:', e.message || String(e)); stop(); });
}

function sendPacket(ws, operation, version, body) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + payload.length, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(version, 6);
  header.writeUInt32BE(operation, 8);
  header.writeUInt32BE(1, 12);
  ws.send(Buffer.concat([header, payload]));
}

function parsePacket(buffer) {
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const protocolVersion = buffer.readUInt16BE(offset + 6);
    const operation = buffer.readUInt32BE(offset + 8);

    if (packetLength <= 0 || packetLength > buffer.length - offset) {
      stats.wsFrameErrors++;
      captured.droppedMessages.push({
        timestamp: new Date().toISOString(),
        reason: 'invalid_packet_length',
        packetLength, remaining: buffer.length - offset
      });
      break;
    }

    const body = buffer.subarray(offset + headerLength, offset + packetLength);

    if (operation === 5) {
      try {
        if (protocolVersion === 3) {
          stats.brotliBodies++;
          stats.brotliBytes += body.length;
          const decompressed = zlib.brotliDecompressSync(body);
          stats.brotliDecompBytes += decompressed.length;
          parsePacket(decompressed);
        } else if (protocolVersion === 2) {
          stats.zlibBodies++;
          const decompressed = zlib.inflateSync(body);
          parsePacket(decompressed);
        } else {
          // protover 0 或 1: 原始 JSON
          stats.rawBodies++;
          const text = body.toString('utf8').trim();
          const chunks = splitJsonObjects(text);
          for (const chunk of chunks) {
            try {
              const msg = JSON.parse(chunk);
              stats.packetsParsed++;
              recordMessage(msg);
            } catch (e) {
              stats.jsonParseErrors++;
              captured.droppedMessages.push({
                timestamp: new Date().toISOString(),
                reason: 'json_parse_error',
                error: e.message || String(e),
                chunkPreview: chunk.slice(0, 200)
              });
            }
          }
        }
      } catch (e) {
        stats.decompressErrors++;
        captured.droppedMessages.push({
          timestamp: new Date().toISOString(),
          reason: 'decompress_or_parse_error',
          error: e.message || String(e),
          operation, protocolVersion,
          bodyLength: body.length,
          bodyPreviewHex: body.subarray(0, Math.min(64, body.length)).toString('hex')
        });
      }
    } else if (operation === 3) {
      // 心跳回复（人气值），也尝试解析
      try {
        const text = body.toString('utf8').trim();
        if (text && text.startsWith('{')) {
          const obj = JSON.parse(text);
          stats.packetsParsed++;
          recordMessage({ cmd: 'HEARTBEAT_REPLY', data: obj });
        }
      } catch (_) { /* 心跳解析失败不重要 */ }
    } else if (operation === 8) {
      console.log('   ✅ 认证成功');
    } else {
      const opKey = String(operation);
      stats.unknownOperations[opKey] = (stats.unknownOperations[opKey] || 0) + 1;
    }
    offset += packetLength > 0 ? packetLength : buffer.length;
  }
}

function recordMessage(msg) {
  stats.rateCount++;
  const cmd = String(msg.cmd || '');
  const idx = captured.messages.length + 1;
  const entry = { index: idx, timestamp: new Date().toISOString(), cmd, data: msg.data || {} };
  captured.messages.push(entry);
  captured.cmdSummary[cmd] = (captured.cmdSummary[cmd] || 0) + 1;

  const giftLike = isGiftLike(cmd);
  if (giftLike) {
    captured.giftMessages.push(entry);
  }

  // 礼物相关打印详情
  if (giftLike) {
    liveGiftCount++;
    if (cmd.startsWith('SEND_GIFT')) liveSendGiftCount++;
    if (cmd.startsWith('COMBO_SEND')) liveComboCount++;
    // 新协议 (2024+)：COMBO_SEND 已废弃，连击后续帧也是 SEND_GIFT，
    // 但 combo_send=null 且 batch_combo_send.batch_combo_num > 1
    const isComboFollow = cmd.startsWith('SEND_GIFT')
      && msg.data
      && !msg.data.combo_send
      && msg.data.batch_combo_send
      && Number(msg.data.batch_combo_send.batch_combo_num) > 1;
    if (isComboFollow) liveComboCount++;

    const giftName = readGiftName(msg.data);
    const price = readPrice(msg.data);
    const quantity = readQuantity(msg.data);
    const user = readUser(msg.data);
    const action = msg.data && msg.data.action ? ` action=${msg.data.action}` : '';
    const allKeys = getAllKeys(msg.data);
    const blindInfo = msg.data && (msg.data.blind_gift || msg.data.blindGift || msg.data.blind_box || msg.data.blindBox);
    const blindExtra = blindInfo ? ` | 🎁盲盒=${JSON.stringify(blindInfo).slice(0, 200)}` : '';

    const qtyStr = quantity > 1 ? ` x${quantity}` : '';
    const batchNum = (msg.data && msg.data.batch_combo_send && msg.data.batch_combo_send.batch_combo_num);
    const comboStr = isComboFollow ? ` 🔄连击#${batchNum}`
      : cmd.startsWith('COMBO_SEND') ? ' 🔄连击'
      : '';
    if (giftName) {
      captured.giftNameSummary[giftName] = (captured.giftNameSummary[giftName] || 0) + quantity;
    }
    console.log(`[#${idx}] ${cmd} | gift="${giftName || '(未命名)'}"${qtyStr} | price=${price} | user="${user || ''}"${comboStr}${action}${blindExtra}`);
    console.log(`       全字段: ${allKeys}`);
  } else {
    // 非礼物消息只在首次出现或每20条打印一次
    if (idx % 20 === 0 || !captured.cmdSummary[cmd] || captured.cmdSummary[cmd] <= 2) {
      const keys = msg.data && typeof msg.data === 'object' ? Object.keys(msg.data).join(',') : 'N/A';
      console.log(`[#${idx}] ${cmd} | keys=[${keys}]`);
    }
  }
}

function printReport() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 抓包报告');
  console.log('═'.repeat(60));
  console.log(`总消息数: ${captured.messages.length}`);
  console.log(`礼物相关: ${captured.giftMessages.length}`);
  console.log(`唯一 CMD: ${Object.keys(captured.cmdSummary).length}`);

  // 诊断信息
  console.log(`\n🔍 诊断信息:`);
  console.log(`   WS 原始帧: ${stats.wsFramesReceived} | 成功解析消息: ${stats.packetsParsed}`);
  console.log(`   WS 帧错误: ${stats.wsFrameErrors} | 解压错误: ${stats.decompressErrors} | JSON错误: ${stats.jsonParseErrors}`);
  console.log(`   Brotli解压: ${stats.brotliBodies} | Zlib解压: ${stats.zlibBodies} | 原始JSON: ${stats.rawBodies}`);
  console.log(`   接收流量: ${(stats.wsBytesReceived/1024).toFixed(1)} KB | Brotli: ${(stats.brotliBytes/1024).toFixed(1)} KB → ${(stats.brotliDecompBytes/1024).toFixed(1)} KB (${stats.brotliBytes > 0 ? (stats.brotliDecompBytes/stats.brotliBytes).toFixed(1)+'x' : 'N/A'})`);
  console.log(`   丢弃消息总计: ${captured.droppedMessages.length}`);
  if (Object.keys(stats.unknownOperations).length > 0) {
    console.log(`   未知 Operation: ${JSON.stringify(stats.unknownOperations)}`);
  }
  if (captured.droppedMessages.length > 0) {
    console.log(`   ⚠️  发现 ${captured.droppedMessages.length} 条丢弃消息（详见JSON）`);
    for (let i = 0; i < Math.min(5, captured.droppedMessages.length); i++) {
      const d = captured.droppedMessages[i];
      console.log(`      [${i + 1}] ${d.reason}: ${d.error || d.chunkPreview || ''}`);
    }
  }

  // 空闲间隔警告
  if (stats.idleGaps.length > 0) {
    console.log(`\n⚠️  WebSocket 空闲间隔 (>3s): ${stats.idleGaps.length} 次`);
    for (const gap of stats.idleGaps.slice(0, 5)) {
      console.log(`      ${gap.second}s 处空闲 ${(gap.idleMs/1000).toFixed(1)}s`);
    }
    if (stats.idleGaps.length > 5) {
      console.log(`      ... 共 ${stats.idleGaps.length} 次`);
    }
    console.log(`   👉 如果网页端同期有消息，说明匿名连接被 B 站限流了。请传入 Cookie 文件。`);
    console.log(`   👉 用法: node scripts/capture-gifts.js ${ROOM_ID} ${CAPTURE_SECONDS} cookies.txt`);
    console.log(`   👉 cookies.txt 内容：浏览器登录 bilibili.com 后，从 DevTools → Application → Cookies 复制完整 Cookie 字符串`);
  }

  // 消息速率
  if (stats.rates.length > 0) {
    const avg = stats.rates.reduce((a, b) => a + b.count, 0) / stats.rates.length;
    const max = Math.max(...stats.rates.map(r => r.count));
    const min = Math.min(...stats.rates.map(r => r.count));
    console.log(`\n📈 消息速率 (msg/s): 平均=${avg.toFixed(1)} 最低=${min} 最高=${max}`);
  }

  console.log(`\n📦 礼物种类分布:`);
  const sortedGifts = Object.entries(captured.giftNameSummary).sort((a, b) => b[1] - a[1]);
  if (sortedGifts.length > 0) {
    for (const [name, count] of sortedGifts) {
      console.log(`   ${name} x${count}`);
    }
  } else {
    console.log(`   (未抓取到礼物名称)`);
  }

  console.log(`\n📡 CMD 分布 (所有类型):`);
  for (const [cmd, count] of Object.entries(captured.cmdSummary).sort((a, b) => b[1] - a[1])) {
    const tag = isGiftLike(cmd) ? '⭐' : '  ';
    console.log(`   ${tag} ${cmd.padEnd(45)} x${count}`);
  }
  console.log(`\n💾 完整数据: ${outPath}`);
}

main().catch((err) => { console.error('失败:', err.message); save(); process.exit(1); });

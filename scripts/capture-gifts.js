// 编写人：Aurora
// Bilibili 直播全量数据抓包脚本（记录所有消息类型和完整字段）。
// 用法：node scripts/capture-gifts.js <房间号> [抓包时长秒数，默认120]
// 输出：captured-gifts-<房间号>-<时间戳>.json
'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const wbiSigner = require('../src/bilibili/wbi-signer');

const ROOM_ID = process.argv[2] || '';
const CAPTURE_SECONDS = Math.min(Number(process.argv[3]) || 120, 600);

if (!ROOM_ID || !/^\d+$/.test(ROOM_ID)) {
  console.error('用法: node scripts/capture-gifts.js <房间号> [抓包秒数]');
  console.error('例如: node scripts/capture-gifts.js 123456 300');
  process.exit(1);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Origin': 'https://live.bilibili.com',
  'Referer': `https://live.bilibili.com/${ROOM_ID}`,
  'Cookie': ''
};

const outPath = path.join(__dirname, '..', `captured-gifts-${ROOM_ID}-${Date.now()}.json`);
const captured = {
  startedAt: new Date().toISOString(),
  roomId: ROOM_ID,
  roomInfo: null,
  messages: [],         // 所有消息
  giftMessages: [],     // 礼物相关消息（快捷子集）
  cmdSummary: {},
  giftNameSummary: {}   // 礼物名称分布
};

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
  return data.giftName || data.gift_name || data.giftName_v2 || data.role_name || data.roleName
      || (data.gift_info && (data.gift_info.gift_name || data.gift_info.giftName)) || '';
}

function readPrice(data) {
  if (!data) return 0;
  const val = data.price || data.total_price || data.totalPrice || data.total_coin || data.totalCoin
      || (data.pay_info && (data.pay_info.price || data.pay_info.amount))
      || (data.gift_info && data.gift_info.price) || 0;
  return Number(val) || 0;
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

  console.log(`[2/3] 获取弹幕服务器...`);
  const danmuQuery = await wbiSigner.signBilibiliWbiParams({ id: realRoomId, type: 0 }, HEADERS);
  const danmuRes = await fetch(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${danmuQuery}`, { headers: HEADERS });
  const danmuData = await danmuRes.json();
  if (danmuData.code !== 0) throw new Error(`弹幕服务器失败: code=${danmuData.code}`);

  const host = danmuData.data.host_list[0];
  const wsUrl = `wss://${host.host}:${host.wss_port}/sub`;
  const authPayload = JSON.stringify({
    uid: 0, roomid: realRoomId, protover: 3, platform: 'web', type: 2, key: danmuData.data.token
  });
  console.log(`   ws_url=${wsUrl}`);

  console.log(`[3/3] 采集 ${CAPTURE_SECONDS}s，记录所有消息类型...\n`);

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  let heartbeatTimer, captureTimer, stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeatTimer);
    clearTimeout(captureTimer);
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
    try {
      const data = event.data instanceof ArrayBuffer
        ? Buffer.from(event.data) : Buffer.from(event.data.arrayBuffer());
      parsePacket(data);
    } catch (_) {}
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
    const body = buffer.subarray(offset + headerLength, offset + packetLength);

    if (operation === 5) {
      try {
        if (protocolVersion === 3) parsePacket(zlib.brotliDecompressSync(body));
        else if (protocolVersion === 2) parsePacket(zlib.inflateSync(body));
        else {
          for (const chunk of splitJsonObjects(body.toString('utf8').trim())) {
            try { recordMessage(JSON.parse(chunk)); } catch (_) {}
          }
        }
      } catch (_) {}
    } else if (operation === 8) {
      console.log('   ✅ 认证成功');
    }
    offset += packetLength > 0 ? packetLength : buffer.length;
  }
}

function recordMessage(msg) {
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
    const giftName = readGiftName(msg.data);
    const price = readPrice(msg.data);
    const user = msg.data && (msg.data.uname || msg.data.username || msg.data.user_name
      || (msg.data.sender_uinfo && (msg.data.sender_uinfo.base && msg.data.sender_uinfo.base.name)));
    const allKeys = getAllKeys(msg.data);
    const blindInfo = msg.data && (msg.data.blind_gift || msg.data.blindGift || msg.data.blind_box || msg.data.blindBox);
    const blindExtra = blindInfo ? ` | 🎁盲盒=${JSON.stringify(blindInfo).slice(0,200)}` : '';

    if (giftName) {
      captured.giftNameSummary[giftName] = (captured.giftNameSummary[giftName] || 0) + 1;
    }
    console.log(`[#${idx}] ${cmd} | gift="${giftName || '(未命名)'}" | price=${price} | user="${user || ''}"${blindExtra}`);
    console.log(`       全字段: ${allKeys}`);
  } else {
    // 非礼物消息只打印 CMD 类型（不刷屏）
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

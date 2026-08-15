import { crossReference, parseBubbleHtml } from './analysis.js';
import {
  renderBubbleTable,
  renderComparison,
  renderConnBar,
  renderServerTable,
  showToast,
  updateStats
} from './view.js';

// ── 全局状态 ──
let bubbleGifts = [];
let serverGifts = [];
let comparisonResults = [];
let ws = null;
let serverGiftCache = []; // 累积的服务器礼物

// ── WebSocket ──
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  ws = new WebSocket(proto + '//' + location.host + '/ws' + (token ? '?token=' + encodeURIComponent(token) : ''));
  ws.onopen = () => {
    document.getElementById('connInfo').textContent = 'WebSocket 已连接';
    document.getElementById('connInfo').style.color = 'var(--green)';
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'snapshot' && msg.data) {
        renderConnBar(msg.data);
        // 自动更新服务器礼物缓存
        if (msg.data.gifts && Array.isArray(msg.data.gifts.recent)) {
          for (const g of msg.data.gifts.recent) {
            if (!serverGiftCache.find(s => s.id === g.id)) {
              serverGiftCache.push(g);
            }
          }
          // 限制缓存大小
          if (serverGiftCache.length > 500) serverGiftCache = serverGiftCache.slice(-300);
        }
      }
    } catch(e) {}
  };
  ws.onclose = () => {
    document.getElementById('connInfo').textContent = 'WebSocket 断开 · 重新连接中';
    document.getElementById('connInfo').style.color = 'var(--yellow)';
    setTimeout(connectWs, 2000);
  };
  ws.onerror = () => ws.close();
}

async function fetchConnBar() {
  try {
    const resp = await fetch('/api/state');
    const json = await resp.json();
    if (json.ok) renderConnBar(json.data);
  } catch(e) {}
}

// ── 时间工具 ──
function setTimeNow() {
  const now = new Date();
  document.getElementById('captureTime').value = toLocalDateTime(now);
}
function setTime1MinAgo() {
  const d = new Date(Date.now() - 60000);
  document.getElementById('captureTime').value = toLocalDateTime(d);
}
function setTime5MinAgo() {
  const d = new Date(Date.now() - 300000);
  document.getElementById('captureTime').value = toLocalDateTime(d);
}
function toLocalDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── 从服务器拉取礼物 ──
async function fetchServerGifts() {
  const btn = document.getElementById('btnFetchServer');
  const status = document.getElementById('serverStatus');
  btn.disabled = true;
  status.textContent = '加载中...';
  try {
    const resp = await fetch('/api/state');
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Failed');
    const gifts = json.data.gifts || {};
    const recent = Array.isArray(gifts.recent) ? gifts.recent : [];
    // 合并到缓存
    for (const g of recent) {
      if (!serverGiftCache.find(s => s.id === g.id)) {
        serverGiftCache.push(g);
      }
    }
    status.textContent = `已加载 ${recent.length} 条（缓存共 ${serverGiftCache.length} 条）`;
    status.style.color = 'var(--green)';
    serverGifts = recent;
    renderServerTable(recent);
  } catch(e) {
    status.textContent = '加载失败: ' + e.message;
    status.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
}

// ── 主流程：解析并对比 ──
async function parseAndCompare() {
  const html = document.getElementById('bubbleHtml').value.trim();
  if (!html) {
    showToast('请先粘贴气泡 HTML', 'warn');
    return;
  }

  // 解析气泡
  bubbleGifts = parseBubbleHtml(html);
  document.getElementById('bubbleCount').textContent = bubbleGifts.length + ' 条';
  renderBubbleTable(bubbleGifts);

  // 确保有服务器数据
  if (serverGiftCache.length === 0) {
    await fetchServerGifts();
  }

  // 执行对比
  const captureTimeStr = document.getElementById('captureTime').value;
  const captureTime = captureTimeStr ? new Date(captureTimeStr).getTime() : Date.now();

  comparisonResults = crossReference(bubbleGifts, serverGiftCache, captureTime);
  renderComparison(comparisonResults);
  updateStats({
    bubbleCount: bubbleGifts.length,
    serverCount: serverGiftCache.length,
    results: comparisonResults
  });

  document.getElementById('comparisonSection').style.display = 'block';
  document.getElementById('statsRow').style.display = 'flex';

  // 滚动到对比结果
  document.getElementById('comparisonSection').scrollIntoView({ behavior: 'smooth' });

  const missed = comparisonResults.filter(r => r.status === 'miss').length;
  if (missed > 0) {
    showToast(`⚠️ 发现 ${missed} 条疑似漏记礼物`, 'warn');
  } else {
    showToast('✅ 所有气泡礼物均在 WebSocket 中有记录', 'ok');
  }
}

// ── 工具函数 ──
function clearAll() {
  document.getElementById('bubbleHtml').value = '';
  bubbleGifts = [];
  serverGifts = [];
  comparisonResults = [];
  document.getElementById('bubbleTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">等待解析...</td></tr>';
  document.getElementById('serverTableBody').innerHTML = '<tr><td colspan="7" class="empty-state">点击「拉取服务器记录」获取 WebSocket 捕获数据</td></tr>';
  document.getElementById('comparisonBody').innerHTML = '';
  document.getElementById('comparisonSection').style.display = 'none';
  document.getElementById('statsRow').style.display = 'none';
  document.getElementById('bubbleCount').textContent = '0 条';
  document.getElementById('serverCount').textContent = '0 条';
}

function loadExample() {
  document.getElementById('bubbleHtml').value = `<!-- 示例：Bilibili 直播气泡 HTML -->
<!-- 请替换为从 DevTools 复制的真实 .bubble-list outerHTML -->
<div class="bubble-list">
  <div class="super-gift-item">
    <div class="user-name" title="示例用户A">示例用户A</div>
    <span class="gift-name">粉丝团灯牌</span>
    <div class="gift-frame gift-31164-50"></div>
    <div class="combo-amount">
      <span class="multiply"></span>
      <div class="numbers">
        <span class="number number-1"></span>
        <span class="number number-5"></span>
      </div>
    </div>
  </div>
</div>`;
  setTimeNow();
  showToast('已加载示例，请替换为真实 HTML', 'ok');
}

// ── 事件与启动 ──
document.getElementById('setTimeNowBtn').addEventListener('click', setTimeNow);
document.getElementById('setTime1MinAgoBtn').addEventListener('click', setTime1MinAgo);
document.getElementById('setTime5MinAgoBtn').addEventListener('click', setTime5MinAgo);
document.getElementById('loadExampleBtn').addEventListener('click', loadExample);
document.getElementById('parseAndCompareBtn').addEventListener('click', parseAndCompare);
document.getElementById('clearAllBtn').addEventListener('click', clearAll);
document.getElementById('btnFetchServer').addEventListener('click', fetchServerGifts);

setTimeNow();
connectWs();
fetchConnBar();
// 兜底轮询
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) fetchConnBar();
}, 5000);

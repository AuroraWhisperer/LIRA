// Gift audit DOM rendering. Application state stays in the entry module.

export function renderConnBar(state) {
  const live = state.liveStatus || {};
  const diag = state.bilibiliDiagnostics || {};
  const connected = live.connected;
  document.getElementById('connBar').innerHTML = `
    <span class="dot ${connected ? 'live' : 'dead'}"></span>
    <span style="font-weight:600;color:${connected ? 'var(--green)' : 'var(--red)'}">${connected ? '已连接' : '未连接'}</span>
    <span class="hint">房间 ${escHtml(String(live.roomId || '—'))} · ${escHtml(live.mode || '—')}</span>
    <span class="hint">已解析 ${diag.parsedGiftCount || 0} 条礼物 · 未识别 ${diag.unparsedGiftCount || 0} 条</span>
    <span class="hint">收包 ${escHtml((diag.lastPacketAt || '').slice(11, 19) || '—')}</span>
    <a href="/admin" target="_blank" style="color:var(--blue);text-decoration:none;margin-left:auto">⚙️ 管理</a>
    <a href="/debug-gifts" target="_blank" style="color:var(--blue);text-decoration:none">🔍 诊断</a>
  `;
}

export function renderBubbleTable(gifts) {
  const tbody = document.getElementById('bubbleTableBody');
  if (gifts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">未解析到礼物（请检查 HTML 格式）</td></tr>';
    return;
  }
  tbody.innerHTML = gifts.map((g, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="user-name-display">${escHtml(g.userName)}</span></td>
      <td><span class="gift-name-display">${escHtml(g.giftName)}</span><br><span class="gift-id">ID:${escHtml(g.giftId || '?')}</span></td>
      <td>×${g.comboCount}</td>
      <td><span class="badge badge-info">气泡</span></td>
    </tr>
  `).join('');
  document.getElementById('bubbleCount').textContent = gifts.length + ' 条';
}

export function renderServerTable(gifts) {
  const tbody = document.getElementById('serverTableBody');
  if (gifts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无 WebSocket 记录</td></tr>';
    return;
  }
  tbody.innerHTML = gifts.map((g, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${(g.created_at || '').slice(11, 19)}</td>
      <td><span class="user-name-display">${escHtml(g.user_name || '观众')}</span></td>
      <td><span class="gift-name-display">${escHtml(g.gift_name || '未知')}</span><br><span class="gift-id">ID:${escHtml(g.gift_id || '?')}</span></td>
      <td>×${g.num || 1}</td>
      <td>¥${(g.total_price || 0).toFixed(2)}</td>
      <td><span class="badge badge-info">WS</span></td>
    </tr>
  `).join('');
  document.getElementById('serverCount').textContent = gifts.length + ' 条';
}

export function renderComparison(results) {
  const tbody = document.getElementById('comparisonBody');
  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">无对比数据</td></tr>';
    return;
  }

  // 按状态排序：漏记优先
  const sorted = [...results].sort((a, b) => {
    const order = { miss: 0, extra: 1, match: 2 };
    return (order[a.status] || 3) - (order[b.status] || 3);
  });

  tbody.innerHTML = sorted.map((r, i) => {
    let statusBadge, rowClass;
    switch (r.status) {
      case 'match':
        statusBadge = '<span class="badge badge-match">✅ 匹配</span>';
        rowClass = '';
        break;
      case 'miss':
        statusBadge = '<span class="badge badge-miss">⚠️ 仅气泡</span>';
        rowClass = 'diff-highlight';
        break;
      case 'extra':
        statusBadge = '<span class="badge badge-extra">📡 仅WS</span>';
        rowClass = 'row-fade';
        break;
      default:
        statusBadge = '<span class="badge badge-info">—</span>';
        rowClass = '';
    }
    return `
      <tr class="${rowClass}">
        <td>${i + 1}</td>
        <td>${r.source === 'bubble' ? '💬 气泡' : '📡 WS'}</td>
        <td><span class="user-name-display">${escHtml(r.userName)}</span></td>
        <td>${escHtml(r.giftName)} <span class="gift-id">${r.giftId ? 'ID:' + escHtml(r.giftId) : ''}</span></td>
        <td>×${r.count}</td>
        <td>${r.price > 0 ? '¥' + Number(r.price).toFixed(2) : '—'}</td>
        <td style="font-size:0.72rem;color:var(--text2)">${escHtml(r.matchInfo)}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

export function updateStats({ bubbleCount, serverCount, results }) {
  const total = results.length;
  const match = results.filter(r => r.status === 'match').length;
  const miss = results.filter(r => r.status === 'miss').length;
  const extra = results.filter(r => r.status === 'extra').length;

  document.getElementById('statBubble').textContent = bubbleCount;
  document.getElementById('statServer').textContent = serverCount;
  document.getElementById('statMatch').textContent = match;
  document.getElementById('statMiss').textContent = miss;
  document.getElementById('statExtra').textContent = extra;
  document.getElementById('statsRow').style.display = 'flex';
}

export function showToast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'ok');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  return div.innerHTML;
}

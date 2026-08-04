// 编写人：AuroraWhisperer
// 盲盒盈亏 overlay — 直播间投屏展示
'use strict';

let state = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let refreshTimer = null;
let initialBlindboxViewportWidth = 0;
let initialBlindboxViewportHeight = 0;
let blindboxViewportResized = false;

// URL 参数解析 — 支持短别名：t=top, w=winners, c=compact, tt=title
const urlParams = new URLSearchParams(location.search);
const param = (longKey, shortKey) => urlParams.get(longKey) || urlParams.get(shortKey);
const requestedTop = Number.parseInt(param('top', 't') || '3', 10);
const TOP_N = Number.isFinite(requestedTop) ? Math.min(10, Math.max(-1, requestedTop)) : 3;
const SUMMARY_ONLY = TOP_N === 0;
const COMPACT = param('compact', 'c') === '1';
const WINNERS_ONLY = param('winners', 'w') === '1' || urlParams.get('show') === 'winners';
const HEART_BOX_ONLY = param('heartBox', 'hb') === '1';
const CUSTOM_TITLE = (param('title', 'tt') || '').trim();
const HIDE_LOSS = param('hideLoss', 'hl') === '1' || WINNERS_ONLY;
const REFRESH_SEC = Math.max(10, parseInt(param('refresh', 'r') || '0', 10) || 0);
const NO_SCROLL = param('noScroll', 'ns') === '1';

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('.blindbox-panel');
  initialBlindboxViewportWidth = window.innerWidth;
  initialBlindboxViewportHeight = window.innerHeight;
  window.addEventListener('resize', handleBlindboxViewportResize);
  if (COMPACT) panel.classList.add('compact');
  if (WINNERS_ONLY) panel.classList.add('winners-only');
  if (NO_SCROLL) panel.classList.add('no-scroll');
  if (SUMMARY_ONLY) panel.classList.add('summary-only');

  if (CUSTOM_TITLE) {
    document.getElementById('blindboxTitle').textContent = CUSTOM_TITLE;
  }

  loadStateThenStats();
  connectSocket();

  if (REFRESH_SEC > 0) {
    refreshTimer = setInterval(loadStats, REFRESH_SEC * 1000);
  }
});

function handleBlindboxViewportResize() {
  const widthChanged = window.innerWidth !== initialBlindboxViewportWidth;
  const heightChanged = window.innerHeight !== initialBlindboxViewportHeight;
  if (blindboxViewportResized || (!widthChanged && !heightChanged)) return;

  blindboxViewportResized = true;
  document.body.classList.add('blindbox-viewport-resized');
}

async function loadStateThenStats() {
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (payload.ok) state = payload.data;
  } catch (error) {
    console.warn('[overlay-blindbox] loadState failed:', error.message || error);
  }
  await loadStats();
}

async function loadStats() {
  try {
    const boxFilter = HEART_BOX_ONLY ? '?boxName=' + encodeURIComponent('心动盲盒') : '';
    const response = await fetch('/api/gifts/blind-box-stats' + boxFilter);
    const payload = await response.json();
    if (payload.ok) {
      render(payload.data);
    }
  } catch (error) {
    console.warn('[overlay-blindbox] loadStats failed:', error.message || error);
  }
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const wsUrl = `${protocol}//${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      // 礼物相关更新时刷新统计数据
      const reason = payload.reason || '';
      if (reason.startsWith('bilibili:gift') || reason === 'gift:sprint:reset' || reason === 'connect') {
        state = payload.state;
        loadStats();
      } else if (!reason || reason === 'live:status') {
        // 其他更新只缓存 state（主题等）
        if (payload.state) state = payload.state;
      }
    }
  });

  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * Math.pow(2, Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      loadStats();
      connectSocket();
    }, delay);
  });
}

function render(stats) {
  if (!stats) return;

  const { summary, perUser } = stats;
  const settings = (state && state.settings) || {};

  // 应用主题
  applyTheme(settings);

  // 自定义标题（URL 参数优先，其次 settings）
  if (!CUSTOM_TITLE) {
    const title = document.getElementById('blindboxTitle');
    const settingsTitle = String(settings.blindboxOverlayTitle || '').trim();
    if (settingsTitle) title.textContent = settingsTitle;
  }

  // 过滤和排序
  let users = Array.isArray(perUser) ? [...perUser] : [];
  if (HIDE_LOSS) {
    users = users.filter((u) => u.totalProfit > 0);
  }
  if (TOP_N > 0) {
    users = users.slice(0, TOP_N);
  }

  // ── 汇总 ──
  const summaryEl = document.getElementById('blindboxSummary');
  const summaryValues = summary || { boxCount: 0, totalCost: 0, totalProfit: 0 };
  if (SUMMARY_ONLY || summaryValues.boxCount > 0) {
    const profitClass = summaryValues.totalProfit >= 0 ? 'profit-up' : 'profit-down';
    const profitSign = summaryValues.totalProfit >= 0 ? '+' : '';
    summaryEl.innerHTML = `
      <div class="blindbox-stat-card">
        <span class="stat-icon">📦</span>
        <span class="stat-value">${summaryValues.boxCount}</span>
        <span class="stat-label">盒子数</span>
      </div>
      <div class="blindbox-stat-card">
        <span class="stat-icon">💰</span>
        <span class="stat-value">¥${formatMoney(summaryValues.totalCost)}</span>
        <span class="stat-label">总成本</span>
      </div>
      <div class="blindbox-stat-card ${profitClass}">
        <span class="stat-icon">${summaryValues.totalProfit >= 0 ? '📈' : '📉'}</span>
        <span class="stat-value">${profitSign}¥${formatMoney(Math.abs(summaryValues.totalProfit))}</span>
        <span class="stat-label">总盈亏</span>
      </div>
    `;
  } else {
    summaryEl.innerHTML = `
      <div class="blindbox-stat-card" style="grid-column:1/-1">
        <span class="stat-icon">🎁</span>
        <span class="stat-value">—</span>
        <span class="stat-label">今天还没有盲盒礼物</span>
      </div>
    `;
  }

  // ── 排行榜 ──
  const leaderboard = document.getElementById('blindboxLeaderboard');
  if (SUMMARY_ONLY) {
    leaderboard.innerHTML = '';
    return;
  }

  if (users.length === 0) {
    leaderboard.innerHTML = `
      <div class="blindbox-empty">
        <span class="empty-icon">🎰</span>
        <span class="empty-text">${HIDE_LOSS ? '今天还没有盈利的观众' : '暂无数据'}</span>
      </div>
    `;
  } else {
    const rows = users.map((user, index) => {
      const rank = index + 1;
      let rankClass = '';
      let rankIcon = '';
      if (rank === 1) { rankClass = 'rank-1'; rankIcon = '👑'; }
      else if (rank === 2) { rankClass = 'rank-2'; rankIcon = '🥈'; }
      else if (rank === 3) { rankClass = 'rank-3'; rankIcon = '🥉'; }

      const profitSign = user.totalProfit >= 0 ? '+' : '';
      const profitIsUp = user.totalProfit >= 0;
      const isLoss = user.totalProfit < 0;

      // 头衔
      let titleHtml = '';
      if (rank === 1 && user.totalProfit > 0) {
        titleHtml = '<span class="user-title lucky-king">欧皇</span>';
      } else if (user.totalProfit > 20) {
        titleHtml = '<span class="user-title lucky">好运</span>';
      }

      return `
        <div class="leaderboard-row ${rankClass}${isLoss ? ' is-loss' : ''}">
          <div class="rank-badge">${rank <= 3 ? rankIcon : rank}</div>
          <div class="user-info">
            <span class="user-name">${escapeHtml(user.userName)}</span>
            ${titleHtml}
          </div>
          <span class="box-count">${user.boxCount}盒</span>
          <span class="profit-value ${profitIsUp ? 'is-up' : 'is-down'}">${profitSign}¥${formatMoney(Math.abs(user.totalProfit))}</span>
        </div>
      `;
    }).join('');

    // 预览表头
    const headerHtml = COMPACT ? '' : `
      <div class="leaderboard-header">
        <span>排行</span>
        <span></span>
        <span>数量</span>
        <span>盈亏</span>
      </div>
    `;

    leaderboard.innerHTML = headerHtml + rows;
  }

  // ── 底部 ── 已移除更新时间和参数显示
}

function applyTheme(settings) {
  if (!settings) return;
  const panel = document.querySelector('.blindbox-panel');
  const root = document.documentElement;
  const lowPower = overlayLowPowerEnabled(settings);
  panel.classList.toggle('low-power', lowPower);

  root.style.setProperty('--overlay-primary', settings.themePrimary || '#ff6f91');
  root.style.setProperty('--overlay-accent', settings.themeAccent || '#21b6a8');
  root.style.setProperty('--overlay-text', settings.themeText || '#fff7fb');
  root.style.setProperty('--overlay-opacity', settings.themeOpacity || '0.76');
  root.style.setProperty('--overlay-radius', `${settings.themeRadius || 8}px`);
  root.style.setProperty('--overlay-font-scale', settings.themeFontScale || '1');

  const primaryRgb = hexToRgb(settings.themePrimary || '#ff6f91');
  root.style.setProperty('--overlay-primary-r', String(primaryRgb.r));
  root.style.setProperty('--overlay-primary-g', String(primaryRgb.g));
  root.style.setProperty('--overlay-primary-b', String(primaryRgb.b));

  const accentRgb = hexToRgb(settings.themeAccent || '#21b6a8');
  root.style.setProperty('--overlay-accent-r', String(accentRgb.r));
  root.style.setProperty('--overlay-accent-g', String(accentRgb.g));
  root.style.setProperty('--overlay-accent-b', String(accentRgb.b));

  const bgRgb = hexToRgb(settings.themeBackground || '#181823');
  root.style.setProperty('--overlay-bg-r', String(bgRgb.r));
  root.style.setProperty('--overlay-bg-g', String(bgRgb.g));
  root.style.setProperty('--overlay-bg-b', String(bgRgb.b));

  const blur = lowPower ? 0 : Number(settings.backdropBlur || 0);
  root.style.setProperty('--overlay-blur', `${Number.isFinite(blur) ? Math.max(0, blur) : 0}px`);
  panel.classList.toggle('has-backdrop-blur', blur > 0);

  const rawGlowIntensity = Number(settings.glowIntensity || 0);
  const glowIntensity = lowPower || !Number.isFinite(rawGlowIntensity) ? 0 : Math.max(0, rawGlowIntensity);
  root.style.setProperty('--overlay-glow-size', `${glowIntensity}px`);
  root.style.setProperty('--overlay-glow-color',
    glowIntensity > 0
      ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Math.min(0.25, glowIntensity / 80)})`
      : 'transparent');

  const gradientEnabled = settings.enableGradient === 'true';
  panel.classList.toggle('gradient-bg', gradientEnabled);
  if (gradientEnabled) {
    const gradRgb = hexToRgb(settings.gradientEnd || settings.themeBackground || '#181823');
    root.style.setProperty('--overlay-gradient-r', String(gradRgb.r));
    root.style.setProperty('--overlay-gradient-g', String(gradRgb.g));
    root.style.setProperty('--overlay-gradient-b', String(gradRgb.b));
  }

  root.style.setProperty('--overlay-font-family', withMultilingualFallback(settings.overlayFontFamily || 'Microsoft YaHei'));
  root.style.setProperty('--overlay-font-weight', settings.overlayFontWeight || '800');
  root.style.setProperty('--overlay-song-color', settings.overlaySongColor || settings.themeText || '#fff7fb');
  root.style.setProperty('--overlay-requester-color', settings.overlayRequesterColor || '');

  panel.style.backgroundColor = hexToRgba(
    settings.themeBackground || '#181823',
    settings.themeOpacity || 0.76
  );
}

// ── 工具函数 ──

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toFixed(2);
}

function hexToRgb(hex) {
  const normalized = String(hex || '#181823').replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function hexToRgba(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const alpha = Number(opacity);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.76;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function withMultilingualFallback(fontFamily) {
  const fallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';
  const selected = String(fontFamily || '').trim();
  if (!selected) return fallback;
  return `${selected}, ${fallback}`;
}

function overlayLowPowerEnabled(settings) {
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'pretty' || quality === 'smooth') return false;
  if (quality === 'low') return true;
  return (settings.overlayLowPowerMode || 'false') === 'true';
}

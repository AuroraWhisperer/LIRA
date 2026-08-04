'use strict';

const { flushStaleComboBuffers } = require('./event-service');
const {
  cleanText,
  normalizePositiveInteger,
  normalizeMoney,
  normalizeSignedMoney
} = require('../../shared/utils');

const BLIND_BOX_ANALYSIS_VIEWS = new Set(['users', 'boxes', 'records']);
const BLIND_BOX_ANALYSIS_SORTS = {
  users: new Set(['profit', 'boxCount', 'totalCost', 'totalValue', 'lastOpenedAt']),
  boxes: new Set(['profit', 'boxCount', 'viewerCount', 'totalCost', 'totalValue']),
  records: new Set(['createdAt', 'profit', 'cost', 'value', 'num'])
};

function getBlindBoxStats(context, { boxName = '' } = {}) {
  flushStaleComboBuffers(context);
  const { todayStart, rows } = loadTodayBlindBoxRows(context, { boxName });
  if (rows.length === 0) {
    return {
      today: todayStart,
      summary: { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 },
      perUser: []
    };
  }

  const userMap = new Map();
  let totalCost = 0;
  let totalValue = 0;
  let totalProfit = 0;
  for (const row of rows) {
    const userName = (row.user_name || '观众').trim();
    const uid = (row.uid || '').trim();
    const key = uid || userName;
    const cost = normalizeMoney(row.blind_box_price);
    const value = normalizeMoney(row.total_price);
    const profit = normalizeSignedMoney(row.blind_profit);
    const boxCount = normalizePositiveInteger(row.num) || 1;
    totalCost += cost;
    totalValue += value;
    totalProfit += profit;

    const entry = userMap.get(key) || {
      userName,
      uid,
      boxCount: 0,
      boxTypes: new Set(),
      totalCost: 0,
      totalValue: 0,
      totalProfit: 0,
      lastOpenedAt: row.created_at
    };
    entry.boxCount += boxCount;
    if (row.blind_box_name) entry.boxTypes.add(cleanText(row.blind_box_name));
    entry.totalCost = normalizeMoney(entry.totalCost + cost);
    entry.totalValue = normalizeMoney(entry.totalValue + value);
    entry.totalProfit = normalizeSignedMoney(entry.totalProfit + profit);
    if (String(row.created_at) > String(entry.lastOpenedAt)) entry.lastOpenedAt = row.created_at;
    userMap.set(key, entry);
  }

  const perUser = Array.from(userMap.values()).map(entry => ({
    userName: entry.userName,
    uid: entry.uid,
    viewer: entry.uid ? `uid:${entry.uid}` : `name:${entry.userName}`,
    boxCount: entry.boxCount,
    boxTypeCount: entry.boxTypes.size,
    totalCost: entry.totalCost,
    totalValue: entry.totalValue,
    totalProfit: entry.totalProfit,
    lastOpenedAt: entry.lastOpenedAt
  })).sort((a, b) => b.totalProfit - a.totalProfit);

  const records = rows.slice(0, 500).map(row => ({
    id: row.id,
    user_name: (row.user_name || '观众').trim(),
    uid: (row.uid || '').trim(),
    blind_box_name: row.blind_box_name || '',
    cost: normalizeMoney(row.blind_box_price),
    value: normalizeMoney(row.total_price),
    profit: normalizeSignedMoney(row.blind_profit),
    num: row.num || 1,
    created_at: row.created_at
  }));

  return {
    today: todayStart,
    summary: {
      boxCount: rows.reduce((sum, row) => sum + (normalizePositiveInteger(row.num) || 1), 0),
      totalCost: normalizeMoney(totalCost),
      totalValue: normalizeMoney(totalValue),
      totalProfit: normalizeSignedMoney(totalProfit)
    },
    perUser,
    records
  };
}

function getBlindBoxAnalysis(context, options = {}) {
  flushStaleComboBuffers(context);
  const view = BLIND_BOX_ANALYSIS_VIEWS.has(options.view) ? options.view : 'users';
  const defaultSort = view === 'records' ? 'createdAt' : 'profit';
  const sort = BLIND_BOX_ANALYSIS_SORTS[view].has(options.sort) ? options.sort : defaultSort;
  const direction = options.direction === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit, 10) || 25));
  const requestedPage = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const viewer = cleanText(options.viewer);
  const box = cleanText(options.box);
  const { todayStart, rows } = loadTodayBlindBoxRows(context);

  const viewerMap = new Map();
  const boxes = new Set();
  for (const row of rows) {
    const viewerOption = getBlindBoxViewerOption(row);
    if (!viewerMap.has(viewerOption.value)) viewerMap.set(viewerOption.value, viewerOption);
    if (row.blind_box_name) boxes.add(cleanText(row.blind_box_name));
  }

  const filteredRows = rows.filter(row => {
    if (viewer && getBlindBoxViewerOption(row).value !== viewer) return false;
    if (box && cleanText(row.blind_box_name) !== box) return false;
    return true;
  });
  const summary = summarizeBlindBoxRows(filteredRows);
  const allItems = buildBlindBoxAnalysisItems(filteredRows, view);
  sortBlindBoxAnalysisItems(allItems, view, sort, direction);
  const total = allItems.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * limit;

  return {
    today: todayStart,
    summary,
    filters: {
      viewers: Array.from(viewerMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
      boxes: Array.from(boxes).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      selectedViewer: viewer,
      selectedBox: box
    },
    view,
    sort,
    direction,
    items: allItems.slice(start, start + limit),
    pagination: { page, limit, total, totalPages }
  };
}

function loadTodayBlindBoxRows(context, { boxName = '' } = {}) {
  const nowDate = new Date();
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).toISOString();
  const tomorrowStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1).toISOString();
  let sql = `
    SELECT id, gift_name, user_name, uid, blind_box_name, blind_box_price,
           total_price, blind_profit, num, created_at
    FROM gift_events
    WHERE status = 'active'
      AND is_blind_box = 1
      AND blind_profit IS NOT NULL
      AND created_at >= ?
      AND created_at < ?
  `;
  const params = [todayStart, tomorrowStart];
  const normalizedBoxName = cleanText(boxName);
  if (normalizedBoxName) {
    sql += ` AND blind_box_name = ?`;
    params.push(normalizedBoxName);
  }
  sql += ' ORDER BY datetime(created_at) DESC, id DESC';
  return { todayStart, tomorrowStart, rows: context.db.giftDb.prepare(sql).all(...params) };
}

function getBlindBoxViewerOption(row) {
  const uid = cleanText(row.uid);
  const label = cleanText(row.user_name) || '观众';
  return { value: uid ? `uid:${uid}` : `name:${label}`, label };
}

function summarizeBlindBoxRows(rows) {
  const result = { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 };
  for (const row of rows) {
    result.boxCount += normalizePositiveInteger(row.num) || 1;
    result.totalCost += normalizeMoney(row.blind_box_price);
    result.totalValue += normalizeMoney(row.total_price);
    result.totalProfit += normalizeSignedMoney(row.blind_profit);
  }
  result.totalCost = normalizeMoney(result.totalCost);
  result.totalValue = normalizeMoney(result.totalValue);
  result.totalProfit = normalizeSignedMoney(result.totalProfit);
  return result;
}

function buildBlindBoxAnalysisItems(rows, view) {
  if (view === 'records') {
    return rows.map(row => ({
      id: Number(row.id),
      giftName: cleanText(row.gift_name) || '未知礼物',
      userName: cleanText(row.user_name) || '观众',
      uid: cleanText(row.uid),
      boxName: cleanText(row.blind_box_name) || '未知盲盒',
      num: normalizePositiveInteger(row.num) || 1,
      cost: normalizeMoney(row.blind_box_price),
      value: normalizeMoney(row.total_price),
      profit: normalizeSignedMoney(row.blind_profit),
      createdAt: row.created_at
    }));
  }

  const groups = new Map();
  for (const row of rows) {
    const viewerOption = getBlindBoxViewerOption(row);
    const boxName = cleanText(row.blind_box_name) || '未知盲盒';
    const key = view === 'users' ? viewerOption.value : boxName;
    const entry = groups.get(key) || (view === 'users'
      ? {
          viewer: viewerOption.value,
          userName: viewerOption.label,
          boxCount: 0,
          boxTypeCount: 0,
          totalCost: 0,
          totalValue: 0,
          profit: 0,
          lastOpenedAt: row.created_at,
          boxTypes: new Set()
        }
      : {
          boxName,
          boxCount: 0,
          viewerCount: 0,
          totalCost: 0,
          totalValue: 0,
          profit: 0,
          viewers: new Set()
        });
    entry.boxCount += normalizePositiveInteger(row.num) || 1;
    entry.totalCost += normalizeMoney(row.blind_box_price);
    entry.totalValue += normalizeMoney(row.total_price);
    entry.profit += normalizeSignedMoney(row.blind_profit);
    if (view === 'users') {
      entry.boxTypes.add(boxName);
      if (String(row.created_at) > String(entry.lastOpenedAt)) entry.lastOpenedAt = row.created_at;
    } else {
      entry.viewers.add(viewerOption.value);
    }
    groups.set(key, entry);
  }

  return Array.from(groups.values()).map(entry => {
    entry.totalCost = normalizeMoney(entry.totalCost);
    entry.totalValue = normalizeMoney(entry.totalValue);
    entry.profit = normalizeSignedMoney(entry.profit);
    if (view === 'users') {
      entry.boxTypeCount = entry.boxTypes.size;
      delete entry.boxTypes;
    } else {
      entry.viewerCount = entry.viewers.size;
      delete entry.viewers;
    }
    return entry;
  });
}

function sortBlindBoxAnalysisItems(items, view, sort, direction) {
  const fields = {
    users: { profit: 'profit', boxCount: 'boxCount', totalCost: 'totalCost', totalValue: 'totalValue', lastOpenedAt: 'lastOpenedAt' },
    boxes: { profit: 'profit', boxCount: 'boxCount', viewerCount: 'viewerCount', totalCost: 'totalCost', totalValue: 'totalValue' },
    records: { createdAt: 'createdAt', profit: 'profit', cost: 'cost', value: 'value', num: 'num' }
  };
  const field = fields[view][sort];
  const multiplier = direction === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const left = a[field];
    const right = b[field];
    const difference = typeof left === 'number'
      ? left - right
      : String(left || '').localeCompare(String(right || ''), 'zh-CN');
    if (difference !== 0) return difference * multiplier;
    return String(a.userName || a.boxName || a.id).localeCompare(String(b.userName || b.boxName || b.id), 'zh-CN');
  });
}

module.exports = {
  getBlindBoxStats,
  getBlindBoxAnalysis
};

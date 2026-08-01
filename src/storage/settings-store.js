// 编写人：Aurora
// 设置读写、迁移、默认值。
// 通过 createSettingsStore(db) 初始化，不自动假设全局数据库连接。
'use strict';

const { now } = require('../shared/utils');

const DEFAULT_SETTINGS = {
  roomId: '',
  enableBilibili: 'true',
  enableAutoUpdate: 'false',
  enableGiftSprint: 'true',
  giftSprintTargetRmb: '0',
  enableGiftBotFallback: 'true',
  giftBotNames: '_薯条bb,薯条bb',
  giftBotAliasMap: '',
  giftBlindBoxConfig: '[{"name":"心动盲盒","price":15,"outputs":[{"name":"电影票","price":2},{"name":"棉花糖","price":9},{"name":"爱心抱枕","price":16},{"name":"绮彩权杖","price":40},{"name":"时空之站","price":100},{"name":"神驹宝玺","price":200},{"name":"浪漫城堡","price":2233}]},{"name":"幸运盲盒","price":5,"outputs":[{"name":"幸运泡泡","price":1.5},{"name":"好运柚叶","price":2.5},{"name":"星光铃铛","price":5.2},{"name":"梦雾纸签","price":10},{"name":"福灵小兽","price":20},{"name":"星愿花园","price":60}]}]',
  paused: 'false',
  allowCompactRequest: 'true',
  onlyFromLibrary: 'false',
  allowDuplicate: 'true',
  queueLimit: '50',
  userCooldownSeconds: '0',
  scrollSeconds: '100',
  queueScrollMode: 'bounce',
  queueScrollSpeed: '80',
  queueScrollSpeedRangeVersion: '3',
  themePrimary: '#ff6f91',
  themeAccent: '#21b6a8',
  themeText: '#fff7fb',
  themeBackground: '#181823',
  themeOpacity: '0.35',
  themeRadius: '8',
  themeFontScale: '1',
  queueSongFontSize: '20',
  queueTitleFontSize: '15',
  overlayQueueStyle: 'classic',
  overlayLowPowerMode: 'false',
  backdropBlur: '0',
  glowIntensity: '0',
  enableGradient: 'false',
  gradientEnd: '#181823',
  overlayFontFamily: 'Microsoft YaHei',
  overlayFontWeight: '800',
  overlaySongColor: '',
  overlayRequesterColor: '',
  overlayTitle: '',
  overlayShowIndex: 'true',
  overlayIndexThreshold: '0',
  overlayIndexColor: '#fbbf24',
  queueFixedSixRows: 'true',
  overlayPin1: '',
  overlayPin2: '',
  overlayPin3: '',
  overlayRule1: '弹幕输入 点歌 歌名',
  overlayRule2: '支持随机点歌',
  overlayRule3: '',
  overlayRule4: '',
  overlayRule5: '',
  overlayRule6: '',
  overlayRuleColor1: '#f5b72f',
  overlayRuleColor2: '#65aef7',
  overlayRuleColor3: '#8d67e8',
  overlayRuleColor4: '#f25f72',
  overlayRuleColor5: '#21b6a8',
  overlayRuleColor6: '#f97316',
  overlayRuleFontSize: '10',
  songBoardSyncTheme: 'true',
  songBoardThemePrimary: '#ff6f91',
  songBoardThemeAccent: '#21b6a8',
  songBoardThemeText: '#fff7fb',
  songBoardThemeBackground: '#181823',
  songBoardThemeOpacity: '0.35',
  songBoardThemeRadius: '8',
  songBoardThemeFontScale: '1',
  songBoardBackdropBlur: '0',
  songBoardGlowIntensity: '0',
  songBoardEnableGradient: 'false',
  songBoardGradientEnd: '#181823',
  songBoardFontFamily: 'Microsoft YaHei',
  songBoardFontWeight: '800',
  songBoardSongColor: '',
  songBoardTitle: '',
  songBoardSongFontSize: '16',
  songBoardTitleFontSize: '15',
  songBoardSortMode: 'initial',
  // 桌面歌词设置
  desktopLyricFontFamily: 'Microsoft YaHei',
  desktopLyricFontWeight: '800',
  desktopLyricTextColor: '#1a1a1a',
  desktopLyricStrokeColor: '#ffffff',
  desktopLyricFontSize: '48',
  desktopLyricStrokeWidth: '3',
  desktopLyricOpacity: '0.95',
  desktopLyricBgOpacity: '0.15',
  desktopLyricScale: '1',
  desktopLyricLineHeight: '1.4',
  desktopLyricShadowIntensity: '0.35',
  desktopLyricTranslationScale: '0.65',
  // 数据保留期（天），0 表示不清理。默认只清理礼物原始报文，业务数据保持永久保留。
  giftRawJsonRetentionDays: '30',
  giftEventRetentionDays: '0',
  requestRetentionDays: '0',
  superChatRetentionDays: '0',
  autoRetentionOnStartup: 'true'
};

function createSettingsStore(db) {
  // Initialize defaults into DB on first call
  const defaultKeys = Object.keys(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, now());
  }

  let cache = null;

  return {
    getDefaultSettings() {
      return { ...DEFAULT_SETTINGS };
    },

    getSettings() {
      if (cache) return { ...cache };
      const rows = db.prepare('SELECT key, value FROM settings').all();
      cache = { ...DEFAULT_SETTINGS };
      for (const row of rows) {
        cache[row.key] = row.value;
      }
      return { ...cache };
    },

    setSetting(key, value) {
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, value, now());
      cache = null;
    }
  };
}

// ── 启动时迁移函数 ──

function clearLegacyIdentityRuleDefaults(db) {
  const legacyRules = {
    overlayRule3: '同一观众 10 秒冷却',
    overlayRule4: '按队列顺序演唱'
  };
  const updatedAt = now();
  for (const [key, oldValue] of Object.entries(legacyRules)) {
    db.prepare(`
      UPDATE settings
      SET value = '', updated_at = ?
      WHERE key = ? AND value = ?
    `).run(updatedAt, key, oldValue);
  }
}

function migrateQueueScrollSpeedSetting(db, savedVersion) {
  if (String(savedVersion || '') === '3') return;
  const row = db.prepare(`
    SELECT value
    FROM settings
    WHERE key = 'queueScrollSpeed'
  `).get();
  const savedSpeed = Number(row && row.value);
  const normalizedSpeed = Number.isFinite(savedSpeed) && savedSpeed > 100
    ? Math.round(1 + ((Math.max(50, Math.min(200, savedSpeed)) - 50) / 150) * 99)
    : Number.isFinite(savedSpeed)
      ? Math.max(1, Math.min(100, Math.round(savedSpeed)))
      : 80;
  const updatedAt = now();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueScrollSpeed', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(normalizedSpeed), updatedAt);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueScrollSpeedRangeVersion', '3', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(updatedAt);
}

function migrateBlindBoxConfig(db) {
  const row = db.prepare(`
    SELECT value FROM settings WHERE key = 'giftBlindBoxConfig'
  `).get();
  const value = (row && row.value) || '';
  const defaultConfig = DEFAULT_SETTINGS.giftBlindBoxConfig;

  // 空配置 → 写入新默认值
  if (value.trim() === '') {
    if (!defaultConfig) return;
    const updatedAt = now();
    db.prepare(`
      UPDATE settings SET value = ?, updated_at = ? WHERE key = 'giftBlindBoxConfig'
    `).run(defaultConfig, updatedAt);
    return;
  }

  // 旧格式迁移：如果 outputs 中所有条目都是纯字符串（无独立价格），自动升级为新格式
  let config;
  try {
    config = JSON.parse(value);
    if (!Array.isArray(config)) return;
  } catch (_) {
    return;
  }

  let needsUpgrade = false;
  for (const box of config) {
    const outputs = Array.isArray(box && box.outputs) ? box.outputs : [];
    for (const output of outputs) {
      if (typeof output === 'string') {
        needsUpgrade = true;
        break;
      }
    }
    if (needsUpgrade) break;
  }

  if (!needsUpgrade) return;

  // 用已知默认价格映射升级
  const knownPrices = {
    '心动盲盒': { '电影票': 2, '棉花糖': 9, '爱心抱枕': 16, '绮彩权杖': 40, '时空之站': 100, '神驹宝玺': 200, '浪漫城堡': 2233 },
    '幸运盲盒': { '幸运泡泡': 1.5, '好运柚叶': 2.5, '星光铃铛': 5.2, '梦雾纸签': 10, '福灵小兽': 20, '星愿花园': 60 }
  };

  for (const box of config) {
    const boxName = (box && box.name) || '';
    const outputs = Array.isArray(box && box.outputs) ? box.outputs : [];
    const priceMap = knownPrices[boxName] || {};
    box.outputs = outputs.map(output => {
      if (typeof output === 'object' && output !== null) return output; // 已经是对象格式
      const name = String(output);
      const giftPrice = priceMap[name];
      if (giftPrice !== undefined && giftPrice > 0) {
        return { name, price: giftPrice };
      }
      return output; // 未知价格，保留原字符串
    });
  }

  const updatedAt = now();
  db.prepare(`
    UPDATE settings SET value = ?, updated_at = ? WHERE key = 'giftBlindBoxConfig'
  `).run(JSON.stringify(config), updatedAt);
}

module.exports = {
  DEFAULT_SETTINGS,
  createSettingsStore,
  clearLegacyIdentityRuleDefaults,
  migrateQueueScrollSpeedSetting,
  migrateBlindBoxConfig
};

// 编写人：Aurora
// 主题预设读写。把 settings 里的外观键打包成一行一套预设，可保存/切换/删除。
// settings 仍是外观的唯一生效来源，预设只是快照，切换时写回 settings。
'use strict';

const { now, cleanText, safeParseJson } = require('../shared/utils');

// 直播间叠加层外观键
const OVERLAY_THEME_KEYS = [
  'themePrimary', 'themeAccent', 'themeText', 'themeBackground',
  'themeOpacity', 'themeRadius', 'themeFontScale',
  'queueSongFontSize', 'queueTitleFontSize',
  'overlayQueueStyle', 'overlayLowPowerMode',
  'backdropBlur', 'glowIntensity', 'enableGradient', 'gradientEnd',
  'overlayFontFamily', 'overlayFontWeight',
  'overlaySongColor', 'overlayRequesterColor',
  'overlayShowIndex', 'overlayIndexThreshold', 'overlayIndexColor',
  'queueFixedSixRows',
  'overlayRuleColor1', 'overlayRuleColor2', 'overlayRuleColor3',
  'overlayRuleColor4', 'overlayRuleColor5', 'overlayRuleColor6',
  'overlayRuleFontSize'
];

// 歌单板外观键
const SONG_BOARD_THEME_KEYS = [
  'songBoardSyncTheme',
  'songBoardFontSize',
  'songBoardThemePrimary', 'songBoardThemeAccent', 'songBoardThemeText',
  'songBoardThemeBackground', 'songBoardThemeOpacity', 'songBoardThemeRadius',
  'songBoardThemeFontScale', 'songBoardBackdropBlur', 'songBoardGlowIntensity',
  'songBoardEnableGradient', 'songBoardGradientEnd',
  'songBoardFontFamily', 'songBoardFontWeight', 'songBoardSongColor',
  'songBoardSongFontSize', 'songBoardTitleFontSize'
];

const ALL_THEME_KEYS = [...OVERLAY_THEME_KEYS, ...SONG_BOARD_THEME_KEYS];

// scope 决定一套预设覆盖哪些键；文案类（标题、规则文本、置顶语）不入预设
const SCOPE_KEYS = {
  all: ALL_THEME_KEYS,
  overlay: OVERLAY_THEME_KEYS,
  songBoard: SONG_BOARD_THEME_KEYS
};

function normalizeScope(scope) {
  const value = cleanText(scope) || 'all';
  return Object.prototype.hasOwnProperty.call(SCOPE_KEYS, value) ? value : 'all';
}

function keysForScope(scope) {
  return SCOPE_KEYS[normalizeScope(scope)];
}

/** 从一份 settings 中抽出指定 scope 的外观键快照 */
function extractThemePayload(settings, scope) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const payload = {};
  for (const key of keysForScope(scope)) {
    if (source[key] !== undefined) payload[key] = String(source[key]);
  }
  return payload;
}

function createThemeStore(db, settingsStore) {
  return {
    list() {
      return db.prepare(`
        SELECT id, name, scope, payload, is_builtin, sort_order, created_at, updated_at
        FROM theme_presets
        ORDER BY is_builtin DESC, sort_order ASC, id ASC
      `).all().map(mapPresetRow);
    },

    get(id) {
      const row = db.prepare('SELECT * FROM theme_presets WHERE id = ?').get(Number(id) || 0);
      return row ? mapPresetRow(row) : null;
    },

    /** 保存当前 settings 外观为一套预设；同名则覆盖（内置预设不可覆盖） */
    saveCurrent(input = {}) {
      const name = cleanText(input.name).slice(0, 60);
      if (!name) throw new Error('缺少预设名称。');
      const scope = normalizeScope(input.scope);
      const payload = extractThemePayload(settingsStore.getSettings(), scope);
      const timestamp = now();

      const existing = db.prepare('SELECT id, is_builtin FROM theme_presets WHERE name = ?').get(name);
      if (existing && Number(existing.is_builtin) === 1) {
        throw new Error('内置预设不能覆盖，请换一个名称。');
      }

      if (existing) {
        db.prepare(`
          UPDATE theme_presets
          SET scope = ?, payload = ?, updated_at = ?
          WHERE id = ?
        `).run(scope, JSON.stringify(payload), timestamp, existing.id);
        return this.get(existing.id);
      }

      const nextOrder = (db.prepare('SELECT MAX(sort_order) AS max FROM theme_presets').get() || {}).max || 0;
      const result = db.prepare(`
        INSERT INTO theme_presets (name, scope, payload, is_builtin, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)
      `).run(name, scope, JSON.stringify(payload), Number(nextOrder) + 1, timestamp, timestamp);
      return this.get(result.lastInsertRowid);
    },

    /** 把预设写回 settings；只写该预设自身包含的键，未收录的键保持不动 */
    apply(id) {
      const preset = this.get(id);
      if (!preset) throw new Error('预设不存在。');
      const allowed = new Set(keysForScope(preset.scope));
      const applied = [];
      for (const [key, value] of Object.entries(preset.payload || {})) {
        if (!allowed.has(key)) continue;
        settingsStore.setSetting(key, String(value));
        applied.push(key);
      }
      return { preset, appliedKeys: applied };
    },

    remove(id) {
      const preset = this.get(id);
      if (!preset) throw new Error('预设不存在。');
      if (preset.isBuiltin) throw new Error('内置预设不能删除。');
      db.prepare('DELETE FROM theme_presets WHERE id = ?').run(preset.id);
      return { removed: true, id: preset.id, name: preset.name };
    },

    rename(id, nextName) {
      const preset = this.get(id);
      if (!preset) throw new Error('预设不存在。');
      if (preset.isBuiltin) throw new Error('内置预设不能重命名。');
      const name = cleanText(nextName).slice(0, 60);
      if (!name) throw new Error('缺少预设名称。');
      const clash = db.prepare('SELECT id FROM theme_presets WHERE name = ? AND id != ?').get(name, preset.id);
      if (clash) throw new Error('已有同名预设。');
      db.prepare('UPDATE theme_presets SET name = ?, updated_at = ? WHERE id = ?')
        .run(name, now(), preset.id);
      return this.get(preset.id);
    }
  };
}

function mapPresetRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    scope: row.scope || 'all',
    payload: safeParseJson(row.payload) || {},
    isBuiltin: Number(row.is_builtin) === 1,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ── 迁移：内置预设 + 现有配置留档 ──

/**
 * 首次建表时写入一套内置默认预设，并把用户当前外观另存为「我的配置」，
 * 避免用户试用其他预设后找不回原来的样子。
 */
function seedThemePresets(db, defaultSettings) {
  const timestamp = now();
  const builtinPayload = extractThemePayload(defaultSettings, 'all');
  db.prepare(`
    INSERT OR IGNORE INTO theme_presets
      (name, scope, payload, is_builtin, sort_order, created_at, updated_at)
    VALUES (?, 'all', ?, 1, 0, ?, ?)
  `).run('默认粉色', JSON.stringify(builtinPayload), timestamp, timestamp);

  // settings 表此时可能还没建好或为空，读不到就跳过留档
  let currentRows = [];
  try {
    currentRows = db.prepare('SELECT key, value FROM settings').all();
  } catch (_) {
    return;
  }
  if (currentRows.length === 0) return;

  const current = { ...defaultSettings };
  for (const row of currentRows) current[row.key] = row.value;
  const currentPayload = extractThemePayload(current, 'all');

  const differs = ALL_THEME_KEYS.some(
    (key) => String(currentPayload[key] ?? '') !== String(builtinPayload[key] ?? '')
  );
  if (!differs) return;

  db.prepare(`
    INSERT OR IGNORE INTO theme_presets
      (name, scope, payload, is_builtin, sort_order, created_at, updated_at)
    VALUES (?, 'all', ?, 0, 1, ?, ?)
  `).run('我的配置', JSON.stringify(currentPayload), timestamp, timestamp);
}

module.exports = {
  OVERLAY_THEME_KEYS,
  SONG_BOARD_THEME_KEYS,
  ALL_THEME_KEYS,
  extractThemePayload,
  createThemeStore,
  seedThemePresets
};

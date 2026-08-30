// 编写人：Aurora
// 设置启动迁移，独立于存储实现。
'use strict';

const { now } = require('../shared/utils');
const { DEFAULT_SETTINGS } = require('./settings-defaults');

// ── 启动时迁移函数 ──

function clearLegacyIdentityRuleDefaults(db) {
  const legacyRules = {
    overlayRule3: '同一观众 10 秒冷却',
    overlayRule4: '按队列顺序演唱',
  };
  const updatedAt = now();
  for (const [key, oldValue] of Object.entries(legacyRules)) {
    db.prepare(
      `
      UPDATE settings
      SET value = '', updated_at = ?
      WHERE key = ? AND value = ?
    `,
    ).run(updatedAt, key, oldValue);
  }
}

function migrateQueueScrollSpeedSetting(db, savedVersion) {
  if (String(savedVersion || '') === '3') return;
  const row = db
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'queueScrollSpeed'
  `,
    )
    .get();
  const savedSpeed = Number(row && row.value);
  const normalizedSpeed =
    Number.isFinite(savedSpeed) && savedSpeed > 100
      ? Math.round(
          1 + ((Math.max(50, Math.min(200, savedSpeed)) - 50) / 150) * 99,
        )
      : Number.isFinite(savedSpeed)
        ? Math.max(1, Math.min(100, Math.round(savedSpeed)))
        : 80;
  const updatedAt = now();
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueScrollSpeed', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(String(normalizedSpeed), updatedAt);
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueScrollSpeedRangeVersion', '3', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(updatedAt);
}

function migrateQueueFontSizeSettings(db, savedVersion) {
  if (String(savedVersion || '') === '2') return;

  const updatedAt = now();

  // 读取当前字号设置
  const songRow = db
    .prepare(`SELECT value FROM settings WHERE key = 'queueSongFontSize'`)
    .get();
  const titleRow = db
    .prepare(`SELECT value FROM settings WHERE key = 'queueTitleFontSize'`)
    .get();

  // 如果设置存在且在旧范围内，则翻倍
  if (songRow) {
    const oldValue = Number(songRow.value);
    if (Number.isFinite(oldValue) && oldValue >= 5 && oldValue <= 35) {
      const newValue = Math.min(70, Math.max(10, oldValue * 2));
      db.prepare(
        `
        UPDATE settings SET value = ?, updated_at = ? WHERE key = 'queueSongFontSize'
      `,
      ).run(String(newValue), updatedAt);
    }
  }

  if (titleRow) {
    const oldValue = Number(titleRow.value);
    if (Number.isFinite(oldValue) && oldValue >= 5 && oldValue <= 20) {
      const newValue = Math.min(40, Math.max(10, oldValue * 2));
      db.prepare(
        `
        UPDATE settings SET value = ?, updated_at = ? WHERE key = 'queueTitleFontSize'
      `,
      ).run(String(newValue), updatedAt);
    }
  }

  // 写入版本标记
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueFontSizeRangeVersion', '2', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(updatedAt);
}

function migrateQueueStyleSettings(db, savedVersion) {
  if (String(savedVersion || '') === '1') return;

  const readValue = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? String(row.value) : String(DEFAULT_SETTINGS[key] ?? '');
  };
  const sharedValues = {
    fontSize: readValue('identityQueueFontSize'),
    fontFamily: readValue('illustratedQueueFontFamily'),
    fontWeight: readValue('illustratedQueueFontWeight'),
    useCustomTextColor: readValue('illustratedQueueUseCustomTextColor'),
    textColor: readValue('illustratedQueueTextColor'),
    scrollMode: readValue('queueScrollMode'),
    scrollSpeed: readValue('identityQueueScrollSpeed'),
  };
  const values = {
    identityQueueScrollMode: sharedValues.scrollMode,
  };
  const prefixes = ['storybook', 'neonVinyl', 'cherryRibbon', 'goldenLily'];
  for (const prefix of prefixes) {
    values[`${prefix}QueueFontSize`] = sharedValues.fontSize;
    values[`${prefix}QueueFontFamily`] = sharedValues.fontFamily;
    values[`${prefix}QueueFontWeight`] = sharedValues.fontWeight;
    values[`${prefix}QueueUseCustomTextColor`] =
      sharedValues.useCustomTextColor;
    values[`${prefix}QueueTextColor`] = sharedValues.textColor;
    values[`${prefix}QueueScrollMode`] = sharedValues.scrollMode;
    values[`${prefix}QueueScrollSpeed`] = sharedValues.scrollSpeed;
  }
  values.queueStyleSettingsVersion = '1';

  const updatedAt = now();
  const statement = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  for (const [key, value] of Object.entries(values)) {
    statement.run(key, value, updatedAt);
  }
}

function getQueueStyleSettingsVersion(db) {
  const row = db
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'queueStyleSettingsVersion'
  `,
    )
    .get();
  return row && row.value;
}

function migrateSongScrollSpeedSetting(db, savedVersion) {
  if (String(savedVersion || '') === '2') return;

  const row = db
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'scrollSeconds'
  `,
    )
    .get();
  const savedSpeed = Number(row && row.value);
  const legacySpeed = Number.isFinite(savedSpeed)
    ? Math.max(20, Math.min(200, savedSpeed))
    : 20;
  const normalizedSpeed = Number.isFinite(savedSpeed)
    ? Math.max(
        1,
        Math.min(100, Math.round(1 + ((legacySpeed - 20) / 180) * 99)),
      )
    : 45;
  const updatedAt = now();
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES ('scrollSeconds', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(String(normalizedSpeed), updatedAt);
  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES ('songScrollSpeedRangeVersion', '2', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(updatedAt);
}

function migrateSongBoardFontSizeSetting(db) {
  const row = db
    .prepare(
      `
    SELECT value FROM settings WHERE key = 'songBoardFontSize'
  `,
    )
    .get();
  if (!row || String(row.value) !== '16') return;
  db.prepare(
    `
    UPDATE settings SET value = ?, updated_at = ? WHERE key = 'songBoardFontSize'
  `,
  ).run(DEFAULT_SETTINGS.songBoardFontSize, now());
}

function migrateBlindBoxConfig(db) {
  const row = db
    .prepare(
      `
    SELECT value FROM settings WHERE key = 'giftBlindBoxConfig'
  `,
    )
    .get();
  const value = (row && row.value) || '';
  const defaultConfig = DEFAULT_SETTINGS.giftBlindBoxConfig;

  // 空配置 → 写入新默认值
  if (value.trim() === '') {
    if (!defaultConfig) return;
    const updatedAt = now();
    db.prepare(
      `
      UPDATE settings SET value = ?, updated_at = ? WHERE key = 'giftBlindBoxConfig'
    `,
    ).run(defaultConfig, updatedAt);
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

  let changed = false;

  // 旧格式升级
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

  if (needsUpgrade) {
    // 用已知默认价格映射升级
    const knownPrices = {
      心动盲盒: {
        电影票: 2,
        棉花糖: 9,
        爱心抱枕: 16,
        绮彩权杖: 40,
        时空之站: 100,
        神驹宝玺: 200,
        浪漫城堡: 2233,
      },
      幸运盲盒: {
        幸运泡泡: 1.5,
        好运柚叶: 2.5,
        星光铃铛: 5.2,
        梦雾纸签: 10,
        福灵小兽: 20,
        星愿花园: 60,
      },
      小熊虫盲盒: {
        虫事顺意: 9,
        虫满元气: 9,
        重虫出击: 9,
        顺虫自然: 9,
        虫容不迫: 9,
        虫装镇定: 9,
        一虫莫展: 9,
        心事虫虫: 9,
      },
      七夕鹊匣: {
        宸星定情: 1200,
        星河相拥: 500,
        云桥缘续: 66,
        鹊语相思: 26,
        锦书传意: 19,
        月下牵丝: 5,
      },
    };

    for (const box of config) {
      const boxName = (box && box.name) || '';
      const outputs = Array.isArray(box && box.outputs) ? box.outputs : [];
      const priceMap = knownPrices[boxName] || {};
      box.outputs = outputs.map((output) => {
        if (typeof output === 'object' && output !== null) return output; // 已经是对象格式
        const name = String(output);
        const giftPrice = priceMap[name];
        if (giftPrice !== undefined && giftPrice > 0) {
          return { name, price: giftPrice };
        }
        return output; // 未知价格，保留原字符串
      });
    }
    changed = true;
  }

  // 合并默认配置中新增的盲盒条目（用户已有配置但不包含新增的默认盲盒）
  if (defaultConfig) {
    try {
      const defaults = JSON.parse(defaultConfig);
      if (Array.isArray(defaults)) {
        const existingNames = new Set(config.map((b) => (b && b.name) || ''));
        for (const defaultBox of defaults) {
          const boxName = (defaultBox && defaultBox.name) || '';
          if (!existingNames.has(boxName)) {
            config.push(defaultBox);
            changed = true;
          }
        }
      }
    } catch (_) {
      return;
    }
  }

  if (!changed) return;

  const updatedAt = now();
  db.prepare(
    `
    UPDATE settings SET value = ?, updated_at = ? WHERE key = 'giftBlindBoxConfig'
  `,
  ).run(JSON.stringify(config), updatedAt);
}

module.exports = {
  clearLegacyIdentityRuleDefaults,
  migrateQueueScrollSpeedSetting,
  migrateSongScrollSpeedSetting,
  migrateQueueFontSizeSettings,
  getQueueStyleSettingsVersion,
  migrateQueueStyleSettings,
  migrateSongBoardFontSizeSetting,
  migrateBlindBoxConfig,
};

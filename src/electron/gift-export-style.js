'use strict';

const { isDeepStrictEqual } = require('node:util');
const { validGiftBannerStyles, validGiftThresholds } = require('../../public/js/shared/gift-banner-styles.js');
const { createPublicError } = require('../shared/public-error');
const { safeParseJson } = require('../shared/utils');

function validCustomStyle(style) {
  return style && validGiftBannerStyles(style.tailStyle, style.textureStyle) && validGiftThresholds(style.thresholds)
    && Object.keys(style).every(key => ['tailStyle', 'textureStyle', 'thresholds'].includes(key));
}

function readGiftExportStyle(raw) {
  const { source, customStyle } = safeParseJson(raw) ?? {};
  if (['follow', 'custom'].includes(source) && validCustomStyle(customStyle)) return { source, customStyle };
  return { source: 'follow', customStyle: null };
}

function configureGiftExportStyle(current, source = current.source, customStyle, rolling) {
  if (!['follow', 'custom'].includes(source)) throw createPublicError('请选择有效的样式来源。');
  if (customStyle !== undefined && (source !== 'custom' || !validCustomStyle(customStyle))) {
    throw createPublicError('请选择有效的卡片样式，并检查三个分界金额。');
  }
  if (source === current.source && (customStyle === undefined || isDeepStrictEqual(customStyle, current.customStyle))) {
    return current;
  }
  const { tailStyle, textureStyle, thresholds } = customStyle ?? current.customStyle ?? rolling;
  return { source, customStyle: { tailStyle, textureStyle, thresholds: [...thresholds] } };
}

function giftExportConfig(task) {
  const custom = task.style.source === 'custom' ? task.style.customStyle : null;
  return { ...task.originalSnapshot.config, ...custom, sheen: false };
}

module.exports = { readGiftExportStyle, configureGiftExportStyle, giftExportConfig };

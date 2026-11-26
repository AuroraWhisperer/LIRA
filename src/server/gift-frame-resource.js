'use strict';

const fs = require('node:fs');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { WOODLAND_GIFT_VIDEO, normalizeResourceStyle } = require('../../public/js/shared/component-resource-style.js');
const { sendJson } = require('./http-utils');

// Old canvas documents and overlay URLs keep their original native layout.
function serveGiftFrameResource(dataDir, req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { ok: false, error: '素材仅支持读取。' });
  const store = dataDir && createComponentStyleStore(dataDir);
  const packs = store ? store.read().packages : [];
  let style;
  for (const pack of packs.toReversed()) {
    if (pack.packageId !== 'lira.woodland-gift-frame') continue;
    const candidates = pack.styles.filter(item => item.type === 'gift-frame' && item.config.resourceStyle?.preset === 'woodland-gift-frame');
    const installed = !pack.removed && candidates.findLast(item => !item.removed);
    if (installed) { style = installed; break; }
    if (!style && candidates.length && fs.existsSync(store.directory(pack.id))) style = candidates.at(-1);
  }
  if (!style) return sendJson(res, 404, { ok: false, error: '请从全屏礼物感谢的「更多样式」导入林间花信样式包。' });
  // Removed library cards retain immutable assets used by existing scenes.
  const resource = normalizeResourceStyle('gift-frame', style.config.resourceStyle, style.config);
  res.writeHead(307, { Location: resource.resources[WOODLAND_GIFT_VIDEO], 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*' });
  res.end();
}

module.exports = { WOODLAND_GIFT_VIDEO, serveGiftFrameResource };

'use strict';

const { createComponentStyleStore } = require('../storage/component-style-store');
const { WOODLAND_GIFT_VIDEO, normalizeResourceStyle } = require('../../public/js/shared/component-resource-style.js');
const { sendJson } = require('./http-utils');

// Old canvas documents and overlay URLs keep their original native layout.
function serveGiftFrameResource(dataDir, req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { ok: false, error: '素材仅支持读取。' });
  const packs = dataDir ? createComponentStyleStore(dataDir).read().packages : [];
  const style = packs.filter(pack => pack.packageId === 'lira.woodland-gift-frame')
    .flatMap(pack => pack.styles).findLast(style => style.type === 'gift-frame'
      && style.config.resourceStyle?.preset === 'woodland-gift-frame');
  if (!style) return sendJson(res, 404, { ok: false, error: '请从全屏礼物感谢的「更多样式」导入林间花信样式包。' });
  // Removed library cards retain immutable assets used by existing scenes.
  const resource = normalizeResourceStyle('gift-frame', style.config.resourceStyle, style.config);
  res.writeHead(307, { Location: resource.resources[WOODLAND_GIFT_VIDEO], 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*' });
  res.end();
}

module.exports = { WOODLAND_GIFT_VIDEO, serveGiftFrameResource };

// 编写人：Aurora
// WBI 签名工具 — Bilibili WBI 鉴权签名生成。
'use strict';

const crypto = require('node:crypto');
const { formatBilibiliApiError } = require('./api-error');

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

let wbiKeyCache = null;

async function getBilibiliWbiMixinKey(headers) {
  const nowMs = Date.now();
  if (wbiKeyCache && wbiKeyCache.expiresAt > nowMs) {
    return wbiKeyCache.mixinKey;
  }

  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(
      `直播平台 WBI key request returned non-JSON response. HTTP ${response.status}. Body: ${text.slice(0, 160)}`,
    );
  }

  console.log(
    `[Bilibili] response wbi_nav: http=${response.status} code=${payload.code} message=${payload.message || ''}`,
  );
  const imageInfo = payload.data && payload.data.wbi_img;
  if (!response.ok || !imageInfo || !imageInfo.img_url || !imageInfo.sub_url) {
    throw new Error(
      formatBilibiliApiError(
        'wbi_nav',
        response,
        payload,
        '获取 WBI 签名参数失败，后续弹幕服务器请求可能会被直播平台风控拒绝。',
      ),
    );
  }
  if (payload.code !== 0) {
    console.log(
      '[Bilibili] wbi_nav returned a non-zero code, but WBI image keys are present; continuing with signature generation.',
    );
  }

  const mixinKey = createBilibiliWbiMixinKey(
    imageInfo.img_url,
    imageInfo.sub_url,
  );
  wbiKeyCache = {
    mixinKey,
    expiresAt: nowMs + 10 * 60 * 1000,
  };
  return mixinKey;
}

function extractBilibiliWbiKey(url) {
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop() || '';
  return filename.split('.')[0] || '';
}

function createBilibiliWbiMixinKey(imgUrl, subUrl) {
  const imgKey = extractBilibiliWbiKey(imgUrl);
  const subKey = extractBilibiliWbiKey(subUrl);
  const rawKey = `${imgKey}${subKey}`;
  if (imgKey.length !== 32 || subKey.length !== 32 || rawKey.length !== 64) {
    throw new Error('直播平台 WBI key 格式无效。');
  }
  return WBI_MIXIN_KEY_ENC_TAB.map((index) => rawKey[index])
    .join('')
    .slice(0, 32);
}

function buildBilibiliWbiQuery(params, mixinKey, nowMs) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('WBI params must be an object.');
  }
  if (typeof mixinKey !== 'string' || mixinKey.length !== 32) {
    throw new TypeError('WBI mixin key must be a 32-character string.');
  }
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new TypeError('WBI timestamp must be a non-negative millisecond value.');
  }

  const signedParams = {
    ...params,
    wts: Math.floor(nowMs / 1000),
  };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      const value = String(signedParams[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = crypto
    .createHash('md5')
    .update(query + mixinKey)
    .digest('hex');
  return `${query}&w_rid=${wRid}`;
}

async function signBilibiliWbiParams(params, headers) {
  const mixinKey = await getBilibiliWbiMixinKey(headers);
  return buildBilibiliWbiQuery(params, mixinKey, Date.now());
}

module.exports = {
  WBI_MIXIN_KEY_ENC_TAB,
  buildBilibiliWbiQuery,
  createBilibiliWbiMixinKey,
  getBilibiliWbiMixinKey,
  extractBilibiliWbiKey,
  signBilibiliWbiParams,
};

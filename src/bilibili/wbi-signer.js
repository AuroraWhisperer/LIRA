// 编写人：Aurora
// WBI 签名工具 — Bilibili WBI 鉴权签名生成。
'use strict';

const crypto = require('node:crypto');

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32,
  15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52
];

let wbiKeyCache = null;

function bilibiliErrorHint(code) {
  if (Number(code) === -352) {
    return '原因：B 站风控/校验失败，通常与 WBI 签名、正常浏览器请求头、Cookie/设备标识或当前网络/IP 风控有关。';
  }
  if (Number(code) === 60004) {
    return '原因：直播间不存在或填写的不是直播间号。';
  }
  if (Number(code) === -400) {
    return '原因：请求参数错误。';
  }
  if (Number(code) === -412) {
    return '原因：请求被风控拦截。';
  }
  return '原因：B 站接口返回了非成功业务码。';
}

function formatBilibiliApiError(endpointName, response, payload, extraHint) {
  const code = payload && payload.code;
  const message = (payload && (payload.message || payload.msg)) || '未知错误';
  const hint = bilibiliErrorHint(code);
  const data = payload && payload.data ? ` data=${JSON.stringify(payload.data).slice(0, 220)}` : '';
  return `Bilibili API ${endpointName} failed: http=${response.status} code=${code} message=${message}. ${hint}${extraHint ? ` ${extraHint}` : ''}${data}`;
}

async function getBilibiliWbiMixinKey(headers) {
  const nowMs = Date.now();
  if (wbiKeyCache && wbiKeyCache.expiresAt > nowMs) {
    return wbiKeyCache.mixinKey;
  }

  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`Bilibili WBI key request returned non-JSON response. HTTP ${response.status}. Body: ${text.slice(0, 160)}`);
  }

  console.log(`[Bilibili] response wbi_nav: http=${response.status} code=${payload.code} message=${payload.message || ''}`);
  const imageInfo = payload.data && payload.data.wbi_img;
  if (!response.ok || !imageInfo || !imageInfo.img_url || !imageInfo.sub_url) {
    throw new Error(formatBilibiliApiError('wbi_nav', response, payload, '获取 WBI 签名参数失败，后续弹幕服务器请求可能会被 B 站风控拒绝。'));
  }
  if (payload.code !== 0) {
    console.log('[Bilibili] wbi_nav returned a non-zero code, but WBI image keys are present; continuing with signature generation.');
  }

  const imgKey = extractBilibiliWbiKey(imageInfo.img_url);
  const subKey = extractBilibiliWbiKey(imageInfo.sub_url);
  const rawKey = `${imgKey}${subKey}`;
  const mixinKey = WBI_MIXIN_KEY_ENC_TAB.map((index) => rawKey[index]).join('').slice(0, 32);
  wbiKeyCache = {
    mixinKey,
    expiresAt: nowMs + 10 * 60 * 1000
  };
  return mixinKey;
}

function extractBilibiliWbiKey(url) {
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop() || '';
  return filename.split('.')[0] || '';
}

async function signBilibiliWbiParams(params, headers) {
  const mixinKey = await getBilibiliWbiMixinKey(headers);
  const signedParams = {
    ...params,
    wts: Math.floor(Date.now() / 1000)
  };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      const value = String(signedParams[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

module.exports = {
  WBI_MIXIN_KEY_ENC_TAB,
  getBilibiliWbiMixinKey,
  extractBilibiliWbiKey,
  signBilibiliWbiParams
};

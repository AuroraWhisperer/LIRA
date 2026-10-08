'use strict';

const { redactCredentials } = require('../shared/log-redaction');

function bilibiliErrorHint(code) {
  if (Number(code) === -352) {
    return '原因：直播平台风控/校验失败，通常与 WBI 签名、正常浏览器请求头、Cookie/设备标识或当前网络/IP 风控有关。';
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
  return '原因：直播平台接口返回了非成功业务码。';
}

function formatBilibiliApiError(endpointName, response, payload, extraHint) {
  const code = payload && payload.code;
  const message = (payload && (payload.message || payload.msg)) || '未知错误';
  const hint = bilibiliErrorHint(code);
  const data = payload && payload.data ? ` data=${JSON.stringify(redactCredentials(payload.data)).slice(0, 220)}` : '';
  return `直播平台 API ${endpointName} failed: http=${response.status} code=${code} message=${message}. ${hint}${extraHint ? ` ${extraHint}` : ''}${data}`;
}

function publicBilibiliErrorMessage(error, isReconnect = false) {
  const prefix = isReconnect ? '重连失败' : '连接失败';
  const message = error && error.message ? error.message : String(error);
  if (message.includes('code=-352')) {
    return `${prefix}：直播平台风控/校验失败（-352），请看启动窗口详情。`;
  }
  if (message.includes('code=-101')) {
    return `${prefix}：直播平台要求登录信息，请看启动窗口详情。`;
  }
  if (message.includes('code=60004')) {
    return `${prefix}：直播间不存在，请检查房间号。`;
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|timeout/i.test(message)) {
    return `${prefix}：无法连接直播平台服务，请检查网络或稍后重试。`;
  }
  if (/non-JSON|Unexpected token|Unexpected end/i.test(message)) {
    return `${prefix}：直播平台接口返回异常内容，请稍后重试。`;
  }
  if (message.includes('room_init')) {
    return `${prefix}：直播间信息获取失败，请检查房间号。`;
  }
  if (message.includes('getDanmuInfo')) {
    return `${prefix}：弹幕连接信息获取失败，请看启动窗口详情。`;
  }
  if (message.includes('wbi_nav')) {
    return `${prefix}：直播平台签名参数获取失败，请看启动窗口详情。`;
  }
  return `${prefix}：${message.slice(0, 80)}`;
}

module.exports = { formatBilibiliApiError, publicBilibiliErrorMessage };

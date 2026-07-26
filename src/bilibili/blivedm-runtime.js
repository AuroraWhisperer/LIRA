// 编写人：Aurora
// 管理 blivedm 兼容性检查状态、缓存和运行时礼物命令。
'use strict';

const blivedmCompat = require('./blivedm-compat');
const { now } = require('../shared/utils');

function createBlivedmRuntime({
  songDb,
  runtimeGiftCommandPrefixes,
  broadcastSnapshot
}) {
  let compatibility = {
    status: 'idle',
    checkedAt: '',
    message: '尚未检查 blivedm 礼物协议。',
    remoteGiftCommands: [],
    supportedGiftCommands: [],
    missingGiftCommands: []
  };
  let stopped = false;

  function getCompatibility() {
    return compatibility;
  }

  function checkOnStartup() {
    const cached = readCache();
    compatibility = cached
      ? {
          ...cached,
          status: cached.missingGiftCommands && cached.missingGiftCommands.length > 0 ? 'warn' : 'cached',
          message: '使用上次 blivedm 检查结果，正在后台刷新...'
        }
      : {
          ...compatibility,
          status: 'checking',
          checkedAt: now(),
          message: '正在检查 blivedm 最新礼物协议...'
        };
    applyRuntimeGiftCommands(compatibility.missingGiftCommands);
    broadcastSnapshot('blivedm:checking');

    blivedmCompat.checkBlivedmCompatibility()
      .then((result) => {
        if (stopped) return;
        compatibility = result;
        writeCache(result);
        applyRuntimeGiftCommands(result.missingGiftCommands);
        if (result.missingGiftCommands.length > 0) {
          console.warn(`[Bilibili] blivedm has newer gift CMD(s): ${result.missingGiftCommands.join(', ')}`);
        } else {
          console.log('[Bilibili] blivedm gift protocol compatibility check passed.');
        }
        broadcastSnapshot('blivedm:checked');
      })
      .catch((error) => {
        if (stopped) return;
        compatibility = fallbackCompatibility(error, cached);
        console.warn(`[Bilibili] blivedm compatibility check failed: ${error.message}`);
        broadcastSnapshot('blivedm:error');
      });
  }

  async function runManualCheck() {
    compatibility = {
      ...compatibility,
      status: 'checking',
      checkedAt: now(),
      message: '正在手动检查 blivedm 最新礼物协议...'
    };
    broadcastSnapshot('blivedm:manual-checking');

    try {
      const result = await blivedmCompat.checkBlivedmCompatibility();
      compatibility = result;
      writeCache(result);
      applyRuntimeGiftCommands(result.missingGiftCommands);
      broadcastSnapshot('blivedm:manual-checked');
      return compatibility;
    } catch (error) {
      compatibility = fallbackCompatibility(error, readCache());
      broadcastSnapshot('blivedm:manual-error');
      return compatibility;
    }
  }

  function fallbackCompatibility(error, cached) {
    if (cached) {
      return {
        ...cached,
        status: 'cached',
        message: `blivedm 检查超时，已使用上次成功结果：${cached.checkedAt || '未知时间'}`
      };
    }
    return {
      status: 'fallback',
      checkedAt: now(),
      message: `blivedm 检查超时，已使用内置协议。${error && error.message ? `原因：${error.message}` : ''}`,
      remoteGiftCommands: [],
      supportedGiftCommands: blivedmCompat.getSupportedBilibiliGiftCommands(),
      missingGiftCommands: []
    };
  }

  function applyRuntimeGiftCommands(commands) {
    for (const command of Array.isArray(commands) ? commands : []) {
      if (command) runtimeGiftCommandPrefixes.add(command);
    }
  }

  function readCache() {
    return blivedmCompat.readBlivedmCompatibilityCache(songDb);
  }

  function writeCache(result) {
    blivedmCompat.writeBlivedmCompatibilityCache(songDb, result);
  }

  return {
    getCompatibility,
    checkOnStartup,
    runManualCheck,
    stop() {
      stopped = true;
    }
  };
}

module.exports = { createBlivedmRuntime };

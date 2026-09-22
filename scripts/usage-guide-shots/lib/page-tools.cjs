'use strict';

// 页面侧工具：桌面桥桩、license 桥桩、标注与遮盖注入、截图自检。
// 全部为纯函数/源码字符串，通过 Playwright 的 addInitScript / evaluate 注入页面。

const fs = require('node:fs');

/** 管理页桌面桥桩：模拟 Electron preload 暴露的 window.* 桥，数值均为演示态。 */
function adminStubSource(token, { suppressTour = true } = {}) {
  return `(() => {
    window.__API_TOKEN__ = ${JSON.stringify(token)};
    ${suppressTour ? "try { localStorage.setItem('liraTourCompleted', '1'); } catch (_) {}" : ''}
    window.songAssistantDesktop = {
      getInfo: async () => ({ version: '5.0.3', updateState: { status: 'dev-disabled' } }),
      checkForUpdates: async () => ({ status: 'dev-disabled' }),
      downloadUpdate: async () => ({ status: 'dev-disabled' }),
      installUpdate: async () => ({}),
      restart: async () => {},
      closeWindow: async () => {}, minimizeWindow: async () => {},
      maximizeWindow: async () => {},
      openDataDir: async () => {}, openLogDir: async () => {},
      openGithub: async () => {}, setAutoUpdate: async () => {},
      reportGiftDisplay: async () => {},
      onShowUpdatePage: () => () => {},
      onUpdateState: () => () => {},
      onWindowMaximized: () => () => {},
    };
    window.bilibiliAuth = {
      getAuthState: async () => ({ loggedIn: false }),
      getProfile: async () => null,
      login: async () => ({ ok: false }),
      logout: async () => ({}),
    };
    window.dynamicLotteryAuth = {
      getState: async () => ({ loggedIn: false }),
      login: async () => ({ ok: false }),
      logout: async () => ({}),
    };
    window.musicAPI = {
      getAuthState: async () => ({ loggedIn: false }),
      login: async () => ({ ok: false }),
      logout: async () => ({}),
      clearCache: async () => ({}),
      providerHealth: async () => ({ ok: true }),
      selectLocalFiles: async () => [],
      getRecentLocalFiles: async () => [],
      selectWeSingCacheDirectory: async () => '',
      resolveLocalMediaUrls: async () => ({}),
      savePlaybackState: async () => ({}),
      confirmShutdownFlush: async () => {},
      onPrepareShutdown: () => () => {},
    };
    window.fanProfiles = { invoke: async () => ({ ok: true, data: null }) };
    window.dailyBots = { invoke: async () => ({ ok: true, data: null }) };
    window.giftExport = {
      settings: async () => ({}),
      prepare: async () => ({}),
      configure: async () => ({}),
      save: async () => ({}), cancel: async () => ({}),
      openFolder: async () => ({}),
      onProgress: () => () => {},
    };
  })();`;
}

/**
 * license 页桥桩：按给定状态渲染登录/注册窗口。
 * state 例：{ state: 'needs_activation' } / { state: 'needs_connection', error: 'NETWORK_UNAVAILABLE' }
 * catalogState 例：{ status: 'running', phase: 'catalog', percent: 42 }
 */
function licenseStubSource({ state, catalogState, activateResult }) {
  return `(() => {
    const state = ${JSON.stringify(state || { state: 'needs_activation' })};
    const catalog = ${JSON.stringify(catalogState || { status: 'ready' })};
    const activateResult = ${JSON.stringify(activateResult || null)};
    window.songAssistantDesktop = {
      minimizeWindow: async () => {}, maximizeWindow: async () => {},
      closeWindow: async () => {},
      onWindowMaximized: () => () => {},
    };
    window.liraLicense = {
      getState: async () => state,
      activate: async () => activateResult || { ok: false, state: 'needs_activation', error: 'ACTIVATION_CODE_INVALID' },
      retry: async () => state,
      getGiftCatalogState: async () => catalog,
      retryGiftCatalog: async () => catalog,
      getProfile: async () => null,
      getGiftInteractionState: async () => ({}),
      setGiftInteraction: async () => ({}),
      onGiftInteractionStateChanged: () => () => {},
      onStateChanged: () => () => {},
      onGiftCatalogStateChanged: () => () => {},
    };
  })();`;
}

/** 等待页面稳定：字体、进行中的动画（限时）、两帧渲染。无限循环动画不等待。 */
async function settle(page, extraWaitMs = 0) {
  await page.evaluate(async () => {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    } catch (_) {}
    const finite = document
      .getAnimations()
      .filter((a) => {
        const timing = a.effect?.getTiming?.();
        return timing && timing.iterations !== Infinity;
      })
      .map((a) => a.finished.catch(() => {}));
    await Promise.race([
      Promise.all(finite),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  });
  if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);
}

/**
 * 统一标注样式：2px 圆角细边框 + 序号圆圈。
 * annotations: [{ selector, label, all? }] — all=true 时标注所有匹配元素。
 */
async function injectAnnotations(page, annotations) {
  if (!annotations || annotations.length === 0) return;
  await page.evaluate((items) => {
    const layer = document.createElement('div');
    layer.id = '__shot_annotations__';
    layer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(layer);
    const COLOR = '#FF5630';
    items.forEach((item, order) => {
      const nodes = item.all
        ? [...document.querySelectorAll(item.selector)]
        : [document.querySelector(item.selector)];
      nodes.filter(Boolean).forEach((node) => {
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;` +
          `width:${r.width + 8}px;height:${r.height + 8}px;border:2px solid ${COLOR};` +
          'border-radius:8px;box-shadow:0 0 0 2px rgba(255,255,255,.85);';
        const badge = document.createElement('div');
        badge.textContent = String(item.label ?? order + 1);
        badge.style.cssText = `position:absolute;top:-13px;left:-13px;width:24px;height:24px;` +
          `border-radius:50%;background:${COLOR};color:#fff;font:600 13px/24px sans-serif;` +
          'text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);';
        box.appendChild(badge);
        layer.appendChild(box);
      });
    });
    window.__shotAnnotationMissing = items
      .filter((item) => !document.querySelector(item.selector))
      .map((item) => item.selector);
  }, annotations);
}

/** 遮盖/替换指定元素内容（脱敏用）：mode: 'text' 替换文本，'blur' 模糊，'hide' 隐藏。 */
async function applyCovers(page, covers) {
  if (!covers || covers.length === 0) return;
  await page.evaluate((items) => {
    for (const item of items) {
      for (const node of document.querySelectorAll(item.selector)) {
        if (item.mode === 'blur') {
          node.style.filter = 'blur(6px)';
        } else if (item.mode === 'hide') {
          node.style.visibility = 'hidden';
        } else {
          node.textContent = item.text ?? '***';
        }
      }
    }
  }, covers);
}

/** 读取 PNG 的 IHDR 宽高，用于落盘自检。 */
function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

module.exports = {
  adminStubSource,
  licenseStubSource,
  settle,
  injectAnnotations,
  applyCovers,
  pngSize,
};

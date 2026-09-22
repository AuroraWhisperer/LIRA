// 编写人：Aurora
// 百宝箱礼物特效工具：查询礼物 ID，并通知固定 overlay 网址播放。
'use strict';

import { api, localOverlayOrigin, readJsonResponse, toast } from '../shared/utils.js';
import { publishGiftEffects } from './legacy-admin-bridge.js';

export const giftEffects = (() => {
  let initialized = false;

  function init() {
    if (initialized) return;
    const form = document.getElementById('giftEffectLookupForm');
    if (!form) return;

    const input = document.getElementById('giftEffectGiftId');
    const urlNode = document.getElementById('giftEffectOverlayUrl');
    const stateNode = document.getElementById('giftEffectLookupState');
    const summaryNode = document.getElementById('giftEffectMatchSummary');
    const liveUrl = `${localOverlayOrigin(location)}/gift-effects`;
    urlNode.textContent = liveUrl;

    const commandToggle = document.getElementById('giftEffectDanmakuEnabled');
    const commandState = document.getElementById('giftEffectCommandState');
    let commandEnabled = false;
    window.addEventListener('app:settings-state', (event) => {
      commandEnabled = event.detail?.giftEffectDanmakuEnabled === 'true';
      commandToggle.checked = commandEnabled;
      commandState.textContent = commandEnabled ? '已开启' : '未开启';
    });
    commandToggle.addEventListener('change', async () => {
      const nextEnabled = commandToggle.checked;
      commandToggle.disabled = true;
      commandState.textContent = '正在保存…';
      try {
        await api('/api/settings', {
          giftEffectDanmakuEnabled: String(nextEnabled),
        });
        commandEnabled = nextEnabled;
        commandState.textContent = nextEnabled ? '已开启' : '未开启';
      } catch (_) {
        commandState.textContent = '保存失败，请重试。';
      } finally {
        commandToggle.checked = commandEnabled;
        commandToggle.disabled = false;
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const rawGiftId = input.value.trim();
      if (!/^\d{1,12}$/.test(rawGiftId) || Number(rawGiftId) <= 0) {
        setLookupState(stateNode, summaryNode, '输入有误', '请输入 1 至 12 位正整数的礼物 ID。', 'error');
        return;
      }

      setLookupState(stateNode, summaryNode, '正在查询', `正在查询礼物 ${rawGiftId}…`, 'loading');
      try {
        const response = await fetch('/api/gifts/effects/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ giftId: rawGiftId }),
        });
        const payload = await readJsonResponse(response, '礼物特效查询失败');
        if (!response.ok || !payload.ok || !payload.data?.effect) {
          throw new Error(payload.error || '没有找到可播放的全屏特效。');
        }

        const effect = payload.data.effect;
        const sizeText = effect.fileSize > 0 ? `${(effect.fileSize / 1024 / 1024).toFixed(2)} MB` : '';
        setLookupState(
          stateNode,
          summaryNode,
          '已触发',
          `已触发：礼物 ${rawGiftId} → 特效 ${effect.effectId}${sizeText ? `（${sizeText}）` : ''}`,
          'success',
        );
      } catch (error) {
        setLookupState(stateNode, summaryNode, '未找到', error.message || '礼物特效查询失败。', 'error');
      }
    });

    input.addEventListener('input', () => {
      const rawGiftId = input.value.trim();
      if (!rawGiftId) {
        setLookupState(stateNode, summaryNode, '待播放', '', 'idle');
      }
    });

    document.getElementById('giftEffectCopyBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(liveUrl);
      toast('礼物特效网址已复制');
    });
    document.getElementById('giftEffectOpenBtn').addEventListener('click', () => {
      window.open(`${liveUrl}?preview=1`, 'liraGiftEffectPreview');
    });
    initialized = true;
  }

  function setLookupState(stateNode, summaryNode, label, message, state) {
    stateNode.textContent = label;
    stateNode.dataset.state = state;
    summaryNode.textContent = message;
    summaryNode.dataset.state = state;
  }

  return { init };
})();
publishGiftEffects(giftEffects);

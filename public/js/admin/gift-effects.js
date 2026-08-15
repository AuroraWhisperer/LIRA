// 编写人：Aurora
// 百宝箱礼物特效工具：查询礼物 ID，并通知固定 overlay 网址播放。
'use strict';

(function () {
  let initialized = false;

  function init() {
    if (initialized) return;
    const form = document.getElementById('giftEffectLookupForm');
    if (!form) return;

    const { localOverlayOrigin, readJsonResponse, toast } = window.AdminApp.utils;
    const input = document.getElementById('giftEffectGiftId');
    const urlNode = document.getElementById('giftEffectOverlayUrl');
    const stateNode = document.getElementById('giftEffectLookupState');
    const summaryNode = document.getElementById('giftEffectMatchSummary');
    const liveUrl = `${localOverlayOrigin(location)}/gift-effects`;
    urlNode.textContent = liveUrl;

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
          body: JSON.stringify({ giftId: rawGiftId })
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
          'success'
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
      window.open(liveUrl, 'liraGiftEffectPreview');
    });
    initialized = true;
  }

  function setLookupState(stateNode, summaryNode, label, message, state) {
    stateNode.textContent = label;
    stateNode.dataset.state = state;
    summaryNode.textContent = message;
    summaryNode.dataset.state = state;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.giftEffects = { init };
})();

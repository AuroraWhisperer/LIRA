'use strict';

function parseBlindboxConfig(textarea) {
  const raw = (textarea.value || '').trim();
  if (!raw) return [];
  try {
    const config = JSON.parse(raw);
    return Array.isArray(config) ? config : [];
  } catch (error) {
    void error;
    return [];
  }
}

function parseBlindboxOutputs(value) {
  const outputs = String(value || '')
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split(':').map((part) => part.trim());
      const giftId = parts.shift() || '';
      const name = parts.shift() || '';
      const priceText = parts.join(':');
      if (!/^[1-9]\d{0,19}$/u.test(giftId) || !name) return null;
      const price = priceText === '' ? null : Number(priceText);
      if (price !== null && (!Number.isFinite(price) || price <= 0)) return null;
      return {
        giftId,
        name,
        ...(price === null ? {} : { price }),
      };
    });
  return outputs.some((output) => !output) ? null : outputs;
}

export function createBlindboxSettings({
  documentRef,
  navigatorRef,
  promptRef,
  locationRef,
  value,
  toast,
  saveSettings,
  getGifts,
  getState,
  getImports,
  localOverlayOrigin,
}) {
  const checked = (id) => Boolean(documentRef.getElementById(id)?.checked);

  function buildOverlayUrl() {
    const base = `${localOverlayOrigin(locationRef)}/blindbox`;
    const params = [];
    const add = (key, currentValue) => {
      if (currentValue) {
        params.push(`${key}=${encodeURIComponent(currentValue)}`);
      }
    };

    const top = value('blindboxOverlayTop');
    if (top !== '') add('top', top);
    const title = value('blindboxOverlayTitle').trim();
    if (title) add('title', title);
    if (checked('blindboxWinnersOnly')) add('winners', '1');
    if (checked('blindboxHeartBoxOnly')) add('heartBox', '1');
    return params.length ? `${base}?${params.join('&')}` : base;
  }

  function updateOverlayUrl() {
    const url = buildOverlayUrl();
    const code = documentRef.getElementById('blindboxOverlayUrl');
    const liveLink = documentRef.getElementById('blindboxLiveLink');
    if (code) code.textContent = url;
    if (liveLink) liveLink.href = url;
  }

  function renderBlindboxList() {
    getGifts()?.renderBlindBoxList?.();
  }

  function init() {
    documentRef
      .getElementById('blindBoxAddBtn')
      .addEventListener('click', async () => {
        const giftId = (value('blindBoxGiftId') || '').trim();
        const name = (value('blindBoxName') || '').trim();
        const price = parseFloat(value('blindBoxPrice'));
        const outputsRaw = (value('blindBoxOutputs') || '').trim();
        if (!name) return toast('请输入盲盒名');
        if (isNaN(price) || price <= 0) return toast('请输入有效成本');
        if (giftId && !/^[1-9]\d{0,19}$/u.test(giftId))
          return toast('请输入有效盲盒 ID');
        if (!outputsRaw) return toast('请输入可能开出的礼物');

        const outputs = parseBlindboxOutputs(outputsRaw);
        if (!outputs?.length)
          return toast('请按“产物 ID:名称:价格”填写礼物');

        const textarea = documentRef.getElementById(
          'giftBlindBoxCustomConfigV2',
        );
        const config = parseBlindboxConfig(textarea);
        config.push({ giftId: giftId || null, name, price, outputs });
        const newRaw = JSON.stringify(config, null, 2);
        textarea.value = newRaw;
        textarea.dataset.dirty = 'true';
        await saveSettings({ giftBlindBoxCustomConfigV2: newRaw });
        textarea.dataset.dirty = 'false';
        toast(`已保存盲盒「${name}」，等待服务器确认`);
        documentRef.getElementById('blindBoxGiftId').value = '';
        documentRef.getElementById('blindBoxName').value = '';
        documentRef.getElementById('blindBoxPrice').value = '';
        documentRef.getElementById('blindBoxOutputs').value = '';
        renderBlindboxList();
      });

    documentRef
      .getElementById('blindBoxList')
      .addEventListener('click', async (event) => {
        const btn = event.target.closest('.chip-delete');
        if (!btn) return;
        const index = parseInt(btn.dataset.blindIndex, 10);
        if (isNaN(index)) return;
        const textarea = documentRef.getElementById(
          'giftBlindBoxCustomConfigV2',
        );
        const config = parseBlindboxConfig(textarea);
        if (index < 0 || index >= config.length) return;
        const removed = config[index];
        config.splice(index, 1);
        const newRaw = JSON.stringify(config, null, 2);
        textarea.value = newRaw;
        textarea.dataset.dirty = 'true';
        await saveSettings({ giftBlindBoxCustomConfigV2: newRaw });
        textarea.dataset.dirty = 'false';
        toast(`已保存移除「${removed.name || '未命名'}」，等待服务器确认`);
        renderBlindboxList();
      });

    documentRef
      .getElementById('blindBoxAdvancedToggle')
      .addEventListener('click', () => {
        const advanced = documentRef.getElementById('blindBoxAdvanced');
        const button = documentRef.getElementById('blindBoxAdvancedToggle');
        advanced.hidden = !advanced.hidden;
        button.textContent = advanced.hidden ? '高级 ▾' : '高级 ▴';
      });

    documentRef
      .getElementById('giftBlindBoxSaveBtn')
      .addEventListener('click', async () => {
        const textarea = documentRef.getElementById(
          'giftBlindBoxCustomConfigV2',
        );
        let raw = textarea.value.trim() || '[]';
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('配置必须是 JSON 数组');
          raw = JSON.stringify(parsed);
        } catch (error) {
          toast('盲盒配置 JSON 格式错误：' + error.message);
          return;
        }
        textarea.dataset.dirty = 'true';
        await saveSettings({ giftBlindBoxCustomConfigV2: raw });
        textarea.dataset.dirty = 'false';
        toast('自定义盲盒已保存，等待服务器确认');
        renderBlindboxList();
        await getState()?.reloadState?.();
      });

    for (const id of [
      'blindboxOverlayTitle',
      'blindboxOverlayTop',
      'blindboxWinnersOnly',
      'blindboxHeartBoxOnly',
    ]) {
      const element = documentRef.getElementById(id);
      if (!element) continue;
      element.addEventListener('input', updateOverlayUrl);
      element.addEventListener('change', () => {
        updateOverlayUrl();
        if (id === 'blindboxOverlayTitle') {
          saveSettings({ blindboxOverlayTitle: element.value.trim() }).catch(
            () => {},
          );
        }
      });
    }

    documentRef
      .getElementById('blindboxCopyUrlBtn')
      .addEventListener('click', async () => {
        const url = buildOverlayUrl();
        try {
          await navigatorRef.clipboard.writeText(url);
          toast('投屏地址已复制');
        } catch (error) {
          void error;
          promptRef('复制以下地址：', url);
        }
      });

    updateOverlayUrl();
    const customConfig = documentRef.getElementById(
      'giftBlindBoxCustomConfigV2',
    );
    customConfig.dataset.preserveDirty = 'true';
    customConfig.addEventListener('input', () => {
      customConfig.dataset.dirty = 'true';
    });
    documentRef.getElementById('importBtn').addEventListener('click', () => {
      getImports()?.importSongs?.();
    });
  }

  return { buildOverlayUrl, updateOverlayUrl, init };
}

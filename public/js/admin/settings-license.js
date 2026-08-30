'use strict';

const PAIRING_ERROR_MESSAGES = {
  TOO_MANY_PAIRING_CODE_REQUESTS: '新设备授权码生成过于频繁，请稍后重试。',
  TOO_MANY_ACTIVE_PAIRING_CODES:
    '当前已有多张仍有效的新设备授权码，请先使用、撤销或等待过期。',
  PAIRING_CODE_NOT_FOUND: '找不到这张新设备授权码。',
  PAIRING_CODE_ALREADY_CONSUMED:
    '这张新设备授权码已使用或已撤销，不能再次操作。',
  LICENSE_NOT_AUTHORIZED: '授权已失效，请重新授权。',
  NETWORK_UNAVAILABLE: '无法连接授权服务器，请检查网络后重试。',
  REQUEST_TIMEOUT: '连接授权服务器超时，请重试。',
};

function pairingErrorMessage(error) {
  const code = String(error?.code || error?.message || '');
  return PAIRING_ERROR_MESSAGES[code] || '操作失败，请稍后重试。';
}

function formatPairingTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : '';
}

function assertPairingResponse(response) {
  if (response?.ok === false || response?.error) {
    const code = String(response?.error || 'LICENSE_ERROR');
    throw Object.assign(new Error(code), { code });
  }
  return response;
}

export async function initLicenseAccountDevice({
  documentRef,
  licenseBridge,
  navigatorRef,
  dangerConfirm,
}) {
  const section = documentRef.getElementById('licenseAccountDevice');
  if (!section || !licenseBridge) return;

  const profileEl = documentRef.getElementById('licenseDeviceProfile');
  const resultEl = documentRef.getElementById('licensePairingCodeResult');
  const listEl = documentRef.getElementById('licensePairingCodes');
  const createBtn = documentRef.getElementById('licenseCreatePairingCodeBtn');
  const refreshBtn = documentRef.getElementById(
    'licenseRefreshPairingCodesBtn',
  );
  section.hidden = false;

  function renderCodes(payload) {
    listEl.replaceChildren();
    const items = Array.isArray(payload?.pairingCodes)
      ? payload.pairingCodes
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
          ? payload
          : [];
    const labels = {
      active: '有效',
      used: '已使用',
      expired: '已过期',
      revoked: '已撤销',
    };

    for (const item of items.slice(0, 12)) {
      const li = documentRef.createElement('li');
      const prefix = String(item.codePrefix || item.code_prefix || '').slice(
        0,
        8,
      );
      const effectiveStatus = String(
        item.effectiveStatus || item.status || '',
      ).toLowerCase();
      const status = labels[effectiveStatus] || '未知状态';
      const device = String(
        item.usedByDeviceName ||
          item.used_by_device_name ||
          item.usedDeviceName ||
          item.used_device_name ||
          '',
      ).slice(0, 60);
      const createdAt = formatPairingTime(item.createdAt || item.created_at);
      const expiresAt = formatPairingTime(item.expiresAt || item.expires_at);
      const usedAt = formatPairingTime(item.usedAt || item.used_at);
      const wrap = documentRef.createElement('div');
      wrap.className = 'license-pairing-item';
      const text = documentRef.createElement('span');
      text.textContent = `${prefix ? `${prefix}••••` : '授权码'} · ${status}${device ? ` · ${device}` : ''}`;
      wrap.appendChild(text);
      const metaParts = [
        createdAt ? `创建于 ${createdAt}` : '',
        expiresAt ? `${expiresAt} 过期` : '',
        usedAt ? `使用于 ${usedAt}` : '',
      ].filter(Boolean);
      if (metaParts.length) {
        const meta = documentRef.createElement('small');
        meta.className = 'license-pairing-meta';
        meta.textContent = metaParts.join(' · ');
        wrap.appendChild(meta);
      }
      li.appendChild(wrap);

      const id = Number(item.id);
      if (effectiveStatus === 'active' && Number.isInteger(id) && id > 0) {
        const revoke = documentRef.createElement('button');
        revoke.type = 'button';
        revoke.className = 'ghost';
        revoke.textContent = '撤销';
        revoke.addEventListener('click', async () => {
          if (revoke.disabled) return;
          revoke.disabled = true;
          let confirmed = false;
          try {
            confirmed = await dangerConfirm({
              title: '撤销这张新设备授权码？',
              message: `前缀 ${prefix || '未知'} 的授权码会立即失效；已用它完成绑定的设备不受影响。`,
              confirmLabel: '撤销授权码',
            });
          } catch (error) {
            resultEl.textContent = `撤销失败：${pairingErrorMessage(error)}`;
          }
          if (!confirmed) {
            revoke.disabled = false;
            return;
          }
          try {
            const response = await licenseBridge.revokePairingCode(id);
            if (response?.ok === false)
              throw new Error(response.error || 'LICENSE_ERROR');
            resultEl.textContent = '授权码已撤销。';
            await refreshProfileAndCodes();
          } catch (error) {
            resultEl.textContent = `撤销失败：${pairingErrorMessage(error)}`;
            revoke.disabled = false;
          }
        });
        li.appendChild(revoke);
      }
      listEl.appendChild(li);
    }
    if (!listEl.children.length) listEl.textContent = '暂无授权码记录。';
  }

  async function refreshProfileAndCodes() {
    try {
      const profile = assertPairingResponse(await licenseBridge.getProfile());
      const streamer = profile?.streamer;
      const device = profile?.device;
      profileEl.textContent = streamer?.accountName
        ? `账号：${streamer.accountName}${device?.name ? `　当前设备：${device.name}` : ''}`
        : '已授权，但暂时无法读取主播资料。';
      renderCodes(
        assertPairingResponse(await licenseBridge.listPairingCodes()),
      );
    } catch (error) {
      profileEl.textContent = '暂时无法读取云端账号信息。';
      listEl.textContent = '授权码记录暂时不可用。';
      void error;
    }
  }

  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    resultEl.textContent = '正在生成授权码…';
    try {
      const response = await licenseBridge.createPairingCode();
      if (response?.ok === false)
        throw new Error(response.error || 'LICENSE_ERROR');
      const code = String(response?.code || '').trim();
      resultEl.textContent = code
        ? `新设备授权码：${code}（只显示这一次）`
        : '服务器未返回授权码，请稍后重试。';
      if (code && navigatorRef?.clipboard?.writeText) {
        navigatorRef.clipboard.writeText(code).catch((error) => {
          void error;
        });
      }
      await refreshProfileAndCodes();
    } catch (error) {
      resultEl.textContent = `生成失败：${pairingErrorMessage(error)}`;
    } finally {
      createBtn.disabled = false;
    }
  });
  refreshBtn.addEventListener('click', refreshProfileAndCodes);
  void refreshProfileAndCodes();
}

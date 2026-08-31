'use strict';

function assertProfileResponse(response) {
  if (response?.ok === false || response?.error) {
    const code = String(response?.error || 'LICENSE_ERROR');
    throw Object.assign(new Error(code), { code });
  }
  return response;
}

export async function initLicenseAccountDevice({
  documentRef,
  licenseBridge,
}) {
  const section = documentRef.getElementById('licenseAccountDevice');
  if (!section || !licenseBridge?.getProfile) return;

  const accountEl = documentRef.getElementById('licenseAccountName');
  const deviceEl = documentRef.getElementById('licenseDeviceName');
  section.hidden = false;

  try {
    const profile = assertProfileResponse(await licenseBridge.getProfile());
    accountEl.textContent = profile?.streamer?.accountName || '已授权账户';
    deviceEl.textContent = profile?.device?.name || '当前电脑';
  } catch (error) {
    accountEl.textContent = '暂时无法读取';
    deviceEl.textContent = '暂时无法读取';
    void error;
  }
}

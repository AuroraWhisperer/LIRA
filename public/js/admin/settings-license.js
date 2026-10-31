'use strict';

function assertProfileResponse(response) {
  if (response?.ok === false || response?.error) {
    const code = String(response?.error || 'LICENSE_ERROR');
    throw Object.assign(new Error(code), { code });
  }
  return response;
}

export async function initLicenseAccountDevice({ documentRef, licenseBridge }) {
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

export function initLicenseAgreement({ documentRef, fetchRef }) {
  const openButton = documentRef.getElementById('licenseAgreementOpen');
  const dialog = documentRef.getElementById('licenseAgreementDialog');
  const content = documentRef.getElementById('licenseAgreementContent');
  const closeButton = documentRef.getElementById('licenseAgreementClose');
  if (!openButton || !dialog || !content || !closeButton || typeof fetchRef !== 'function') return;

  let agreementText = null;
  let loading = null;

  async function loadAgreement() {
    if (agreementText !== null) {
      content.textContent = agreementText;
      return;
    }
    if (!loading) {
      content.textContent = '正在读取…';
      loading = (async () => {
        try {
          const response = await fetchRef('/pages/admin/toolbox/user-agreement.txt');
          if (!response.ok) throw new Error(`AGREEMENT_HTTP_${response.status}`);
          agreementText = await response.text();
          content.textContent = agreementText;
        } catch {
          content.textContent = '暂时无法读取协议，请关闭后重试。';
        } finally {
          loading = null;
        }
      })();
    }
    await loading;
  }

  openButton.addEventListener('click', async () => {
    content.scrollTop = 0;
    dialog.showModal();
    await loadAgreement();
  });
  closeButton.addEventListener('click', () => dialog.close());
}

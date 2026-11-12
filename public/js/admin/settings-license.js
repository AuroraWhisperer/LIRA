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
  const dialog = documentRef.getElementById('licenseAgreementDialog');
  const title = documentRef.getElementById('licenseAgreementDialogTitle');
  const content = documentRef.getElementById('licenseAgreementContent');
  const closeButton = documentRef.getElementById('licenseAgreementClose');
  if (!dialog || !title || !content || !closeButton || typeof fetchRef !== 'function') return;

  const documents = [
    { buttonId: 'licenseAgreementOpen', title: 'LIRA 用户协议', file: 'user-agreement.txt' },
    { buttonId: 'licensePrivacyOpen', title: 'LIRA 隐私政策', file: 'privacy-policy.txt' },
  ];
  let activeDocument = null;

  for (const document of documents) {
    const button = documentRef.getElementById(document.buttonId);
    if (!button) continue;
    let text = null;
    let loading = null;
    button.addEventListener('click', async () => {
      activeDocument = document;
      title.textContent = document.title;
      content.scrollTop = 0;
      content.textContent = '正在读取…';
      dialog.showModal();
      try {
        if (text === null) {
          if (!loading) {
            loading = fetchRef(`/pages/admin/toolbox/${document.file}`)
              .then(response => {
                if (!response.ok) throw new Error(`AGREEMENT_HTTP_${response.status}`);
                return response.text();
              })
              .then(value => { text = value; })
              .finally(() => { loading = null; });
          }
          await loading;
        }
        if (activeDocument === document) content.textContent = text;
      } catch {
        if (activeDocument === document) content.textContent = '暂时无法读取文档，请关闭后重试。';
      }
    });
  }
  closeButton.addEventListener('click', () => dialog.close());
}

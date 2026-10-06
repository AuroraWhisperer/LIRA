import { previewElement } from './component-preview-surface.js';
import { createWishPicker } from './gifts/wish-picker.js';
import { normalizeTextBoxImageSource } from '../shared/text-box-config.js';
import { setGiftImage } from '../shared/gift-image-fallback.js';

export async function requestTextBoxMedia(kind, { source, file, signal } = {}, access) {
  const url = new URL(`${access ? '/api/component-preview' : '/api/scenes'}/text-${kind}`, location.origin);
  if (source) url.searchParams.set('source', source);
  const headers = {};
  if (access) {
    url.searchParams.set('id', access.id);
    url.searchParams.set('attachmentId', access.attachmentId);
    headers.Authorization = `Bearer ${access.token}`;
  }
  if (file) headers['Content-Type'] = file.type;
  const response = await fetch(url, { method: file ? 'POST' : 'GET', headers, body: file,
    credentials: 'omit', cache: 'no-store', signal });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || '素材读取失败，请重试。');
  return payload.data;
}

const KAOMOJI = {
  开心: ['(≧▽≦)', 'ヽ(✿ﾟ▽ﾟ)ノ', '(＾▽＾)', '٩(ˊᗜˋ*)و', '(*^▽^*)', '(๑>◡<๑)', 'ヾ(≧▽≦*)o', '(o゜▽゜)o☆', '(*≧ω≦)', 'ヽ(•̀ω•́ )ゝ'],
  可爱: ['(｡･ω･｡)', '(づ｡◕‿‿◕｡)づ', '(=^･ω･^=)', '(๑•̀ㅂ•́)و✧', '(ฅ´ω`ฅ)', '(◕ᴗ◕✿)', '(•ө•)♡', 'ʕ•ᴥ•ʔ', '(๑´ㅂ`๑)', '(｡♥‿♥｡)'],
  感谢: ['比心 (๑′ᴗ‵๑)♡', '谢谢老板！', '(づ￣ ³￣)づ', '٩(♡ε♡ )۶', '(人´∀`)♪', '(≧∇≦)ﾉ', '♡(ӦｖӦ｡)', '(｡･∀･)ﾉﾞ', '(´▽`ʃ♡ƪ)', '(*´∀`)~♥'],
  惊讶: ['Σ(°△°|||)', '(⊙o⊙)', '(°ロ°) !', 'Σ(っ °Д °;)っ', 'Σ(ﾟдﾟ;)', '(゜ロ゜)', '(⊙_⊙;)', 'Σ(･ω･ﾉ)ﾉ', '(・_・ヾ', '(°ー°〃)'],
  委屈: ['(╥﹏╥)', '(；д；)', '(｡•́︿•̀｡)', '(つд⊂)', 'ಥ_ಥ', '(´；ω；`)', '(ノへ￣、)', '(｡ŏ﹏ŏ)', '(っ˘̩╭╮˘̩)っ', '(T_T)'],
  表情: ['❤️', '🧡', '💛', '💚', '💙', '💜', '✨', '🌟', '🎉', '🎁', '🌸', '🍀', '🐱', '🐶', '🥰', '🥺', '😂', '👍', '👏', '💪'],
};

export function mountTextBoxMedia(host, { composer, request = requestTextBoxMedia, onError }) {
  const requests = new AbortController();
  let selectedGift;
  let uploading = false;
  let disabled = false;
  const tools = previewElement('div', 'text-box-insert-tools');
  function button(text, action, parent = tools) {
    const node = previewElement('button', 'secondary', text);
    node.type = 'button';
    node.addEventListener('mousedown', () => composer.rememberSelection());
    node.addEventListener('click', action);
    parent.append(node);
    return node;
  }
  const giftRow = previewElement('div', 'text-box-gift-selection');
  giftRow.hidden = true;
  const giftImage = previewElement('img'); giftImage.alt = '';
  const giftName = previewElement('strong');
  giftRow.append(giftImage, giftName);
  button('插入礼物图片', () => {
    try {
      composer.insertNode({ type: 'gift', name: selectedGift.name,
        src: normalizeTextBoxImageSource(selectedGift.imagePath, 'gift') });
    } catch (error) { onError(error); }
  }, giftRow);
  const dialog = previewElement('dialog', 'text-box-gift-picker');
  dialog.setAttribute('aria-label', '选择要插入的礼物');
  function identified(tag, id, text, className) {
    const node = previewElement(tag, className, text); node.dataset.wishId = id; return node;
  }
  const heading = previewElement('header');
  heading.append(previewElement('h3', '', '选择礼物'));
  const close = identified('button', 'giftWishPickerClose', '关闭', 'secondary'); close.type = 'button'; heading.append(close);
  const scopes = previewElement('div', 'text-box-gift-scopes');
  for (const [source, title] of [['room', '本房间礼物'], ['all', '全部礼物']]) {
    const node = previewElement('button', 'secondary', title); node.type = 'button'; node.dataset.wishSource = source; scopes.append(node);
  }
  const search = identified('input', 'giftWishSearch'); search.type = 'search'; search.placeholder = '搜索礼物名称或 ID'; search.setAttribute('aria-label', '搜索礼物');
  const status = identified('p', 'giftWishPickerStatus', '', 'hint'); status.setAttribute('role', 'status');
  const results = identified('div', 'giftWishResults', '', 'text-box-gift-results');
  dialog.dataset.wishId = 'giftWishPicker';
  const scope = previewElement('div'); scope.append(dialog);
  dialog.append(heading, scopes, search, status, results);
  document.body.append(scope);
  const picker = createWishPicker(gift => {
    selectedGift = gift;
    giftName.textContent = gift.name;
    setGiftImage(giftImage, gift.imagePath);
    giftRow.hidden = false;
  }, { root: scope, requireVariant: false,
    request: (path, _body, signal) => request('gifts', { source: path.endsWith('/catalog') ? 'all' : 'room', signal }) });
  button('礼物图片', () => picker.open());
  const upload = previewElement('input'); upload.type = 'file'; upload.accept = '.png,.jpg,.jpeg,.gif,.webp'; upload.hidden = true;
  const uploadButton = button('上传图片', () => upload.click());
  upload.addEventListener('change', async () => {
    const file = upload.files[0]; upload.value = '';
    if (!file || uploading || disabled) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { onError(new Error('请选择 PNG、JPEG、GIF 或 WebP 图片。')); return; }
    if (file.size > 5 * 1024 * 1024) { onError(new Error('图片不能超过 5 MB，请压缩后重新上传。')); return; }
    uploading = true; uploadButton.disabled = true; uploadButton.textContent = '上传中…';
    try {
      const result = await request('image', { file, signal: requests.signal });
      if (!requests.signal.aborted && !disabled) composer.insertNode({ type: 'image', name: file.name.slice(0, 200), src: result.imagePath });
    } catch (error) { if (!requests.signal.aborted) onError(error); }
    finally { uploading = false; uploadButton.disabled = disabled; uploadButton.textContent = '上传图片'; }
  });
  const faces = previewElement('div', 'text-box-faces'); faces.hidden = true;
  const tabs = previewElement('div', 'text-box-face-tabs');
  const options = previewElement('div', 'text-box-face-options');
  function showFaces(category) {
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.textContent === category));
    options.replaceChildren();
    for (const face of KAOMOJI[category]) button(face, () => composer.insertText(face), options);
  }
  for (const category of Object.keys(KAOMOJI)) button(category, () => showFaces(category), tabs);
  faces.append(tabs, options); showFaces('开心');
  const faceButton = button('颜文字 / 表情', () => { faces.hidden = !faces.hidden; faceButton.setAttribute('aria-expanded', String(!faces.hidden)); });
  faceButton.setAttribute('aria-expanded', 'false');
  const hint = previewElement('p', 'text-box-upload-hint', 'PNG / JPEG / GIF / WebP · 单张 ≤ 5 MB · 动图会保留');
  host.append(tools, giftRow, upload, faces, hint);
  return {
    setDisabled(value) {
      disabled = value;
      for (const input of [...tools.querySelectorAll('button'), ...giftRow.querySelectorAll('button'), ...faces.querySelectorAll('button')]) input.disabled = value;
      uploadButton.disabled = value || uploading;
    },
    dispose() { requests.abort(); picker.close(); scope.remove(); },
  };
}

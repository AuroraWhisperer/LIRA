import { readApiResponse } from '../shared/json-response.js';
import { previewElement } from './component-preview-elements.js';
import { createWishPicker } from './gifts/wish-picker.js';
import { normalizeTextBoxImageSource } from '../shared/text-box-config.js';
import { setGiftArtwork } from '../shared/gift-image.js';
import { formatByteLimit } from '../shared/display-format.js';

const MAX_TEXT_IMAGE_BYTES = 5 * 1024 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';

const MEDIA_ICONS = {
  gift: [
    ['rect', { x: '3.5', y: '8', width: '13', height: '8.5', rx: '1.5' }],
    ['path', { d: 'M2.5 8h15M10 8v8.5M10 8C8.2 8 6.5 6.8 6.5 5.4c0-1 .8-1.6 1.7-1.6C9.3 3.8 10 5.4 10 8Zm0 0c1.8 0 3.5-1.2 3.5-2.6 0-1-.8-1.6-1.7-1.6C10.7 3.8 10 5.4 10 8Z' }],
  ],
  image: [
    ['rect', { x: '3', y: '4', width: '14', height: '12', rx: '2' }],
    ['circle', { cx: '7.5', cy: '8.5', r: '1.2' }],
    ['path', { d: 'M4 14l3.8-3.6a1 1 0 0 1 1.4 0L12 13l1.6-1.5a1 1 0 0 1 1.4 0L17 13.5' }],
  ],
  smile: [
    ['circle', { cx: '10', cy: '10', r: '7' }],
    ['path', { d: 'M7.5 12.2a3.2 3.2 0 0 0 5 0' }],
    ['circle', { cx: '7.8', cy: '8.5', r: '0.7', fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: '12.2', cy: '8.5', r: '0.7', fill: 'currentColor', stroke: 'none' }],
  ],
};

function createMediaIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of MEDIA_ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

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
  const payload = await readApiResponse(response, '素材读取失败，请重试。');
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
  let requests = new AbortController();
  let selectedGift;
  let uploading = false;
  let disabled = false;
  const tools = previewElement('div', 'text-box-insert-tools');
  function button(text, action, { parent = tools, icon, title } = {}) {
    const node = previewElement('button', icon ? 'secondary text-box-tool-pill' : 'secondary');
    node.type = 'button';
    if (title) node.title = title;
    if (icon) {
      node.append(createMediaIcon(icon), previewElement('span', '', text));
    } else {
      node.textContent = text;
    }
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
  }, { parent: giftRow });
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
    setGiftArtwork(giftImage, gift.imagePath);
    giftRow.hidden = false;
  }, { root: scope, requireVariant: false,
    request: (path, _body, signal) => request('gifts', { source: path.endsWith('/catalog') ? 'all' : 'room', signal }) });
  button('礼物', () => picker.open(), { icon: 'gift', title: '插入礼物图片' });
  const upload = previewElement('input'); upload.type = 'file'; upload.accept = '.png,.jpg,.jpeg,.gif,.webp'; upload.hidden = true;
  const uploadButton = button('图片', () => upload.click(), {
    icon: 'image',
    title: '上传图片 · 支持 PNG / JPEG / GIF / WebP，单张 ≤ 5 MB，保留动图',
  });
  const uploadLabel = uploadButton.querySelector('span');
  upload.addEventListener('change', async () => {
    const file = upload.files[0]; upload.value = '';
    if (!file || uploading || disabled) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { onError(new Error('请选择 PNG、JPEG、GIF 或 WebP 图片。')); return; }
    if (file.size > MAX_TEXT_IMAGE_BYTES) { onError(new Error(`图片不能超过 ${formatByteLimit(MAX_TEXT_IMAGE_BYTES)}，请压缩后重新上传。`)); return; }
    uploading = true; uploadButton.disabled = true; uploadLabel.textContent = '上传中…';
    const submitted = requests;
    try {
      const result = await request('image', { file, signal: submitted.signal });
      if (!submitted.signal.aborted && !disabled) composer.insertNode({ type: 'image', name: file.name.slice(0, 200), src: result.imagePath });
    } catch (error) { if (!submitted.signal.aborted) onError(error); }
    finally {
      if (submitted === requests) { uploading = false; uploadButton.disabled = disabled; uploadLabel.textContent = '图片'; }
    }
  });
  const faces = previewElement('div', 'text-box-faces'); faces.hidden = true;
  const tabs = previewElement('div', 'text-box-face-tabs');
  const options = previewElement('div', 'text-box-face-options');
  function showFaces(category) {
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.textContent === category));
    options.replaceChildren();
    for (const face of KAOMOJI[category]) button(face, () => composer.insertText(face), { parent: options });
  }
  for (const category of Object.keys(KAOMOJI)) button(category, () => showFaces(category), { parent: tabs });
  faces.append(tabs, options); showFaces('开心');
  const faceButton = button('表情', () => {
    faces.hidden = !faces.hidden;
    faceButton.setAttribute('aria-expanded', String(!faces.hidden));
  }, { icon: 'smile', title: '插入颜文字或表情' });
  faceButton.setAttribute('aria-expanded', 'false');
  host.append(tools, giftRow, upload, faces);
  return {
    cancelPending() {
      requests.abort(); requests = new AbortController();
      uploading = false; uploadButton.disabled = disabled; uploadLabel.textContent = '图片';
    },
    setDisabled(value) {
      disabled = value;
      for (const input of [...tools.querySelectorAll('button'), ...giftRow.querySelectorAll('button'), ...faces.querySelectorAll('button')]) input.disabled = value;
      uploadButton.disabled = value || uploading;
    },
    dispose() { requests.abort(); picker.close(); scope.remove(); },
  };
}

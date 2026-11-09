import { MAX_ASSET_BYTES, isWeeklyScheduleAsset } from './model.js';

const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function assertSafeSvg(source) {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error('图标 SVG 不能包含文档类型或外部实体。');
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (svg.querySelector('parsererror') || svg.documentElement.localName !== 'svg') throw new Error('无法读取 SVG 图标。');
  const forbidden = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'style', 'a', 'animate', 'animatetransform', 'set']);
  for (const element of svg.querySelectorAll('*')) {
    if (forbidden.has(element.localName.toLowerCase()) || /^animate/i.test(element.localName)) throw new Error('SVG 图标只能包含静态图形。');
    for (const attribute of element.attributes) {
      if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      const internalReference = /^#[a-z_][\w:.-]*$/i.test(attribute.value);
      const value = attribute.value.replace(/url\(\s*(['"]?)#[a-z_][\w:.-]*\1\s*\)/gi, '');
      if (/^on/i.test(attribute.localName) || /^href$/i.test(attribute.localName) && !internalReference
        || /\\|url\s*\(|@import|javascript:|data:|https?:|file:/i.test(value)) {
        throw new Error('SVG 图标不能引用外部内容或包含交互脚本。');
      }
    }
  }
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法解码，请重新选择 PNG、JPEG 或 WebP 图片。'));
    };
    image.src = url;
  });
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('图片读取已取消。'));
    reader.readAsDataURL(file);
  });
}

export async function readWeeklyScheduleAsset(file, { allowSvg = false } = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_ASSET_BYTES) {
    throw new Error('请选择不超过 12 MiB 的图片。');
  }
  const svg = allowSvg && file.type === 'image/svg+xml';
  if (!svg && !RASTER_TYPES.has(file.type)) throw new Error(allowSvg ? '请选择 PNG、JPEG、WebP 或静态 SVG 图标。' : '请选择 PNG、JPEG 或 WebP 图片。');
  if (svg) assertSafeSvg(await file.text());
  const image = await imageFromFile(file);
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_IMAGE_EDGE
    || image.naturalHeight > MAX_IMAGE_EDGE || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
    throw new Error('图片尺寸过大，请使用边长不超过 8192 像素、总像素不超过 33,554,432 的图片。');
  }
  if (!svg) {
    const result = await readDataUrl(file);
    if (!isWeeklyScheduleAsset(result)) throw new Error('图片格式无法保存，请重新选择。');
    return result;
  }
  const scale = 512 / Math.max(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法转换 SVG 图标，请使用 PNG 图片。');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export { isWeeklyScheduleAsset };

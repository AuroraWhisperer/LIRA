export const TEXT_BOX_SIZE = Object.freeze([640, 180]);

export function createTextBoxDefaults() {
  return { version: 1, fontSize: 32, color: '#ffffff', align: 'left', lineHeight: 1.4,
    nodes: [{ type: 'text', text: '在这里输入文字' }] };
}

function invalid() {
  return Object.assign(new Error('文本框内容或样式无效。'), { code: 'INVALID_SCENE_CONFIG', statusCode: 400 });
}

function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(value, key))) throw invalid();
}

function fontSize(value) {
  if (!Number.isInteger(value) || value < 8 || value > 240) throw invalid();
  return value;
}

function color(value) {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) throw invalid();
  return value.toLowerCase();
}

export function normalizeTextBoxImageSource(value, type = 'image') {
  if (typeof value !== 'string' || value.length > 2048) throw invalid();
  if (/^\/scene-text-images\/[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}\.(?:png|jpg|gif|webp)$/i.test(value)) return value;
  if (type !== 'gift') throw invalid();
  if (/^\/overtime-gift-images\/[a-z\d_-][a-z\d._-]*\.(?:png|jpe?g|gif|webp)$/i.test(value) && !value.includes('..')) return value;
  if (/^\/img\/admin\/gifts\/bilibili-guard-(?:captain|prefect|governor)\.webp$/.test(value)
    || value === '/img/gift-placeholder.png') return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/bfs\/[a-z\d/_-]+\.(?:png|jpe?g|gif|webp|apng)$/i.test(url.pathname)) return url.href;
  } catch { throw invalid(); }
  throw invalid();
}

export function normalizeTextBoxConfig(config) {
  record(config, ['version', 'fontSize', 'color', 'align', 'lineHeight', 'nodes']);
  if (config.version !== 1 || !['left', 'center', 'right'].includes(config.align)
    || typeof config.lineHeight !== 'number' || !Number.isFinite(config.lineHeight)
    || config.lineHeight < 1 || config.lineHeight > 3 || !Array.isArray(config.nodes)) throw invalid();
  const nodes = config.nodes.map((node) => {
    const text = node?.type === 'text';
    record(node, text ? ['type', 'text', 'bold', 'italic', 'underline', 'stroke', 'shadow', 'fontSize', 'color']
      : ['type', 'name', 'src', 'giftId', 'fontSize'], text ? ['type', 'text'] : ['type', 'name', 'src']);
    let result;
    if (text) {
      if (typeof node.text !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(node.text)) throw invalid();
      result = { type: 'text', text: node.text.replace(/\r\n?/g, '\n') };
      for (const key of ['bold', 'italic', 'underline', 'stroke', 'shadow']) if (Object.hasOwn(node, key)) {
        if (typeof node[key] !== 'boolean') throw invalid();
        result[key] = node[key];
      }
      if (Object.hasOwn(node, 'color')) result.color = color(node.color);
    } else {
      if (!['image', 'gift'].includes(node.type) || typeof node.name !== 'string'
        || node.name.length > 200 || /[\u0000-\u001f\u007f]/.test(node.name)) throw invalid();
      result = { type: node.type, name: node.name, src: normalizeTextBoxImageSource(node.src, node.type) };
      if (Object.hasOwn(node, 'giftId')) {
        if (node.type !== 'gift' || !['string', 'number'].includes(typeof node.giftId)
          || typeof node.giftId === 'number' && !Number.isSafeInteger(node.giftId)
          || !/^[1-9]\d{0,19}$/.test(String(node.giftId))) throw invalid();
        result.giftId = String(node.giftId);
      }
    }
    if (Object.hasOwn(node, 'fontSize')) result.fontSize = fontSize(node.fontSize);
    return result;
  });
  return { version: 1, fontSize: fontSize(config.fontSize), color: color(config.color),
    align: config.align, lineHeight: config.lineHeight, nodes };
}

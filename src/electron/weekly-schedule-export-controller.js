'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const WIDTH = 1920;
const HEIGHT = 1080;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 68 * 1024 * 1024;
const ASSET_KEYS = new Set(['portrait', 'chibi', 'logo', 'background', 'qrcode', 'rank1', 'rank2', 'rank3', 'icon']);
const LAYOUTS = new Set(['scrapbook', 'celestial', 'broadcast', 'week-grid', 'magazine', 'scroll']);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function invalid(message = '周表内容无效，请重新打开周表生成器。') {
  const error = new Error(message);
  error.publicMessage = message;
  throw error;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function webpSize(bytes) {
  if (bytes.length < 25 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') invalid();
  const fileSize = bytes.readUInt32LE(4) + 8;
  const chunkSize = bytes.readUInt32LE(16);
  if (fileSize > bytes.length || chunkSize < 5 || 20 + chunkSize > fileSize) invalid();
  const kind = bytes.toString('ascii', 12, 16);
  // The RIFF/VP8 headers bound bitmap allocation before Chromium decodes WebP.
  // https://developers.google.com/speed/webp/docs/riff_container
  if (kind === 'VP8X' && chunkSize >= 10) {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ' && chunkSize >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  invalid('周表 WebP 素材无法读取，请重新上传。');
}

function validateWeeklyScheduleExportTemplate(input, nativeImage) {
  if (!record(input)) invalid();
  let serialized;
  try { serialized = JSON.stringify(input); } catch { invalid(); }
  if (Buffer.byteLength(serialized) > MAX_TEMPLATE_BYTES) invalid('周表素材总量过大，请缩小图片后重试。');
  const template = JSON.parse(serialized);
  if (!LAYOUTS.has(template.layout) || !record(template.assets) || !Array.isArray(template.days)
    || template.days.length !== 7 || !record(template.modules) || !record(template.decorations)) invalid();
  for (const key of ['title', 'weekLabel', 'streamerName', 'name', 'monday', 'fontId']) {
    if (typeof template[key] !== 'string' || template[key].length > 500) invalid();
  }
  if (/[{};:\u0000-\u001f]/.test(template.fontId)) invalid();
  for (const key of ['primaryColor', 'accentColor']) {
    if (!/^#[a-f\d]{6}$/i.test(template[key])) invalid();
  }
  for (const day of template.days) {
    if (!record(day)) invalid();
    for (const key of ['theme', 'note', 'time1', 'time2', 'highlightLabel']) {
      if (typeof day[key] !== 'string' || day[key].length > 500) invalid();
    }
  }
  const moduleKeys = ['message', 'rank', 'qr', 'benefits'];
  if (Object.keys(template.modules).some(key => !moduleKeys.includes(key))) invalid();
  for (const key of moduleKeys) {
    const module = template.modules[key];
    if (!record(module) || typeof module.enabled !== 'boolean') invalid();
    const fields = key === 'message' || key === 'benefits' ? ['title', 'text']
      : key === 'rank' ? ['title', 'subtitle'] : ['caption'];
    for (const field of fields) {
      // These are IPC resource ceilings; the editor owns its smaller user-facing text limits.
      const limit = field === 'text' ? 2048 : 240;
      if (typeof module[field] !== 'string' || module[field].length > limit) invalid('周表文字内容过长，请精简后重试。');
    }
  }
  const names = template.modules.rank.names;
  if (!Array.isArray(names) || names.length !== 3 || names.some(name => typeof name !== 'string' || name.length > 120)) {
    invalid('周表榜单应包含三个昵称，请重新填写。');
  }
  for (const key of ['portrait', 'logo', 'chibi']) {
    const transform = template[key];
    if (!record(transform) || ['scale', 'x', 'y'].some(field => !Number.isFinite(transform[field])
      || Math.abs(transform[field]) > 10000)) invalid();
    for (const [field, min, max] of [['rotation', -180, 180], ['opacity', 0, 100]]) {
      if (transform[field] !== undefined && (!Number.isFinite(transform[field]) || transform[field] < min || transform[field] > max)) invalid();
    }
    if (transform.flip !== undefined && typeof transform.flip !== 'boolean') invalid();
  }
  // Optional appearance fields keep previously saved templates exportable.
  for (const [key, limits] of [
    ['background', { x: [0, 100], y: [0, 100], opacity: [0, 100], blur: [0, 24] }],
    ['typography', { title: [50, 150], theme: [70, 160], note: [70, 160], time: [70, 160] }],
  ]) {
    if (template[key] === undefined) continue;
    if (!record(template[key])) invalid();
    for (const [field, [min, max]] of Object.entries(limits)) {
      const value = template[key][field];
      if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) invalid();
    }
  }
  if (template.background?.fit !== undefined && !['cover', 'contain'].includes(template.background.fit)) invalid();
  const intensity = template.decorations.intensity;
  if (intensity !== undefined && (!Number.isFinite(intensity) || intensity < 0 || intensity > 100)) invalid();
  let totalBytes = 0;
  for (const [key, value] of Object.entries(template.assets)) {
    if (!ASSET_KEYS.has(key) || typeof value !== 'string') invalid();
    if (!value) continue;
    if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) invalid('单张周表素材不能超过 12 MiB。');
    const match = /^data:image\/(png|jpeg|webp);base64,([a-z\d+/]+={0,2})$/i.exec(value);
    if (!match) invalid('周表素材必须是本机 PNG、JPEG 或 WebP 图片。');
    const bytes = Buffer.from(match[2], 'base64');
    totalBytes += bytes.length;
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) invalid('单张周表素材不能超过 12 MiB。');
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) invalid('周表素材合计不能超过 48 MiB，请缩小图片后重试。');
    // Reject a declared oversized PNG before asking the native decoder to allocate its bitmap.
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
      && (bytes.readUInt32BE(16) > 8192 || bytes.readUInt32BE(20) > 8192
        || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 32 * 1024 * 1024)) {
      invalid('周表素材的长边不能超过 8192 像素，像素总量不能超过 32 Mi。');
    }
    let size;
    if (match[1].toLowerCase() === 'webp') {
      // NativeImage uses platform codecs and cannot decode WebP on every desktop.
      // The shared renderer subsequently requires a successful Chromium image.decode().
      size = webpSize(bytes);
    } else {
      let image;
      try { image = nativeImage.createFromBuffer(bytes); } catch { invalid('周表素材无法读取，请重新上传。'); }
      if (image.isEmpty()) invalid('周表素材无法读取，请重新上传。');
      size = image.getSize();
    }
    if (!size.width || !size.height) invalid('周表素材无法读取，请重新上传。');
    if (size.width > 8192 || size.height > 8192 || size.width * size.height > 32 * 1024 * 1024) {
      invalid('周表素材的长边不能超过 8192 像素，像素总量不能超过 32 Mi。');
    }
  }
  return template;
}

function fileNameFor(template) {
  const title = (template.streamerName || template.name || '直播周表')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').slice(0, 60) || '直播周表';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(template.monday) ? template.monday : '本周';
  return `${title}_${date}.png`;
}

function pngHasSize(png, width, height) {
  return Buffer.isBuffer(png) && png.length >= 24 && png.subarray(0, 8).equals(PNG_SIGNATURE)
    && png.readUInt32BE(16) === width && png.readUInt32BE(20) === height;
}

function createWeeklyScheduleExportController({ app, BrowserWindow, dialog, nativeImage, session,
  getBaseUrl, getSessionToken, getMainWindow, fileSystem = fs }) {
  let active = null;
  let disposed = false;

  function assertCurrent(current) {
    if (disposed || active !== current || current.cancelled) invalid('周表导出已取消。');
  }

  async function bounded(promise, current) {
    let timer;
    try {
      return await Promise.race([
        promise,
        current.cancelledSignal.then(() => invalid('周表导出已取消。')),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('render timeout');
            error.publicMessage = '周表渲染超时，请重试。';
            reject(error);
          }, 30000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  function cancel() {
    if (!active) return;
    active.cancelled = true;
    active.resolveCancellation();
    if (active.window && !active.window.isDestroyed()) active.window.destroy();
  }

  async function exportPng(input) {
    if (disposed) return { ok: false, error: '周表导出已关闭。' };
    if (active) return { ok: false, error: '正在导出周表，请稍候。' };
    const current = { cancelled: false, window: null, renderSession: null, temporaryPath: '' };
    current.cancelledSignal = new Promise(resolve => { current.resolveCancellation = resolve; });
    active = current;
    try {
      const template = validateWeeklyScheduleExportTemplate(input, nativeImage);
      const directory = path.join(app.getPath('pictures'), 'LIRA', '周表');
      await fileSystem.mkdir(directory, { recursive: true });
      assertCurrent(current);
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: '导出直播周表',
        defaultPath: path.join(directory, fileNameFor(template)),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      assertCurrent(current);
      if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
      const filePath = result.filePath;
      if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.png') invalid('请选择 PNG 图片文件名。');
      const baseUrl = new URL(getBaseUrl());
      const exportUrl = new URL('/weekly-schedule-export', baseUrl);
      const token = getSessionToken();
      if (!token) invalid('本机连接已失效，请重新打开周表生成器。');
      const renderSession = session.fromPartition('lira-weekly-schedule-export', { cache: false });
      current.renderSession = renderSession;
      renderSession.setPermissionCheckHandler(() => false);
      renderSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      renderSession.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const url = new URL(details.url);
          allowed = ['data:', 'blob:'].includes(url.protocol) || url.origin === baseUrl.origin
            && (url.pathname === exportUrl.pathname || ['/css/', '/js/', '/fonts/', '/font-library/', '/img/']
              .some(prefix => url.pathname.startsWith(prefix)));
        } catch { allowed = false; }
        callback({ cancel: !allowed });
      });
      const win = new BrowserWindow({
        width: WIDTH, height: HEIGHT, useContentSize: true, show: false, frame: false, skipTaskbar: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
          backgroundThrottling: false, zoomFactor: 1, offscreen: true, session: renderSession,
        },
      });
      current.window = win;
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const blockNavigation = event => event.preventDefault();
      win.webContents.on('will-navigate', blockNavigation);
      win.webContents.on('will-redirect', blockNavigation);
      await bounded(win.loadURL(exportUrl.href, { extraHeaders: `Authorization: Bearer ${token}\n` }), current);
      assertCurrent(current);
      // The display can constrain initial window bounds before the page has loaded.
      win.setContentSize(WIDTH, HEIGHT);
      const rendered = await bounded(win.webContents.executeJavaScript(
        `window.renderWeeklyScheduleExport(${JSON.stringify(template)})`,
      ), current);
      assertCurrent(current);
      const fullViewport = rendered?.viewportWidth >= WIDTH && rendered?.viewportHeight >= HEIGHT;
      if (rendered?.width !== WIDTH || rendered?.height !== HEIGHT || !fullViewport) {
        invalid('周表画布尚未加载完整，请重试。');
      }
      if (!Array.isArray(rendered.overflow) || rendered.overflow.length) {
        invalid('周表有文字超出版面，请精简文字、调整模块组合或更换排版后再导出。');
      }
      const capture = () => bounded(win.webContents.capturePage(
        { x: 0, y: 0, width: WIDTH, height: HEIGHT }, { stayHidden: true, stayAwake: true },
      ), current);
      let image;
      try { image = await capture(); }
      catch (error) {
        if (error.message !== 'UnknownVizError') throw error;
        // Chromium may reject the first offscreen readback while submitting its
        // frame. Retry that specific failure once after the next rendering frame.
        await bounded(win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(resolve))'), current);
        assertCurrent(current);
        image = await capture();
      }
      let png = image.toPNG();
      if (!pngHasSize(png, WIDTH, HEIGHT)) png = image.resize({ width: WIDTH, height: HEIGHT, quality: 'best' }).toPNG();
      if (!pngHasSize(png, WIDTH, HEIGHT)) invalid('周表图片尺寸验证失败，请重试。');
      assertCurrent(current);
      current.temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
      await fileSystem.writeFile(current.temporaryPath, png, { flag: 'wx', flush: true });
      assertCurrent(current);
      // The native save dialog owns overwrite consent; a failed render never touches the destination.
      await fileSystem.rename(current.temporaryPath, filePath);
      current.temporaryPath = '';
      return { ok: true, saved: true, filePath };
    } catch (error) {
      if (current.cancelled) return { ok: true, cancelled: true };
      const fileError = ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EROFS', 'EBUSY'].includes(error.code);
      return { ok: false, error: error.publicMessage
        || (fileError ? '保存位置不可用或磁盘空间不足，请选择其他位置。' : '周表导出失败，请重试。') };
    } finally {
      if (current.window && !current.window.isDestroyed()) current.window.destroy();
      if (current.renderSession) {
        current.renderSession.webRequest.onBeforeRequest(null);
        await current.renderSession.clearStorageData().catch(() => {});
      }
      if (current.temporaryPath) await fileSystem.unlink(current.temporaryPath).catch(() => {});
      if (active === current) active = null;
    }
  }

  return {
    exportPng,
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}

module.exports = { createWeeklyScheduleExportController, validateWeeklyScheduleExportTemplate };

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_ROWS_PER_IMAGE = 39; // 39 × 144 + 38 × 16 = 6224 pixels.
const EXPORT_WIDTH = 856;

function exportLayout(count, mode) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || !['combined', 'separate'].includes(mode)) {
    throw new Error('导出参数无效。');
  }
  const rows = mode === 'separate' ? 1 : MAX_ROWS_PER_IMAGE;
  return Array.from({ length: Math.ceil(count / rows) }, (_, index) => ({
    start: index * rows, count: Math.min(rows, count - index * rows),
    fileName: `礼物_${String(index + 1).padStart(3, '0')}.png`,
  }));
}

function createGiftExportController({ app, BrowserWindow, dialog, shell, runtime, getBaseUrl, getMainWindow }) {
  let task = null;
  let renderWindow = null;
  let disposed = false;
  let preparation = 0;
  const defaultRoot = () => path.join(app.getPath('pictures'), 'LIRA', '礼物导出');
  const assertCurrent = (current) => {
    if (disposed || task !== current || current.cancelled) throw new Error('导出已取消。');
    if (runtime.getGiftViewRevision() !== current.snapshot.viewRevision) throw new Error('礼物来源或流水已变更，请重新选择。');
  };

  function readSettings() {
    const mode = runtime.getSetting('giftExportMode');
    const background = runtime.getSetting('giftExportBackground');
    const directory = runtime.getSetting('giftExportDirectory') || defaultRoot();
    return { mode: mode === 'separate' ? mode : 'combined',
      background: background === 'white' ? background : 'transparent',
      directory, custom: directory !== defaultRoot() };
  }

  async function settings(input) {
    if (disposed) throw new Error('导出设置已关闭。');
    if (input === undefined) return readSettings();
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !['mode', 'background', 'directoryAction'].includes(key))) {
      throw new Error('导出设置参数无效。');
    }
    const { mode, background, directoryAction } = input;
    if (mode !== undefined && !['combined', 'separate'].includes(mode)) throw new Error('输出方式无效。');
    if (background !== undefined && !['transparent', 'white'].includes(background)) throw new Error('背景参数无效。');
    if (directoryAction !== undefined && !['default', 'choose'].includes(directoryAction)) throw new Error('保存位置参数无效。');
    let directory;
    if (directoryAction === 'choose') {
      const request = preparation;
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: '选择礼物图片保存文件夹', defaultPath: readSettings().directory,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (disposed || request !== preparation) throw new Error('导出设置已取消，请重新打开。');
      if (result.canceled || !result.filePaths[0]) return readSettings();
      directory = result.filePaths[0];
    } else if (directoryAction === 'default') directory = defaultRoot();
    const next = readSettings();
    if (mode !== undefined) next.mode = mode;
    if (background !== undefined) next.background = background;
    if (directory !== undefined) next.directory = directory;
    runtime.setGiftExportSettings({ mode: next.mode, background: next.background,
      directory: next.directory === defaultRoot() ? '' : next.directory });
    return readSettings();
  }

  async function prepare(selection) {
    if (task?.running) throw new Error('请先完成或取消当前导出。');
    cancel();
    const request = preparation;
    const snapshot = await runtime.prepareGiftExport(selection);
    if (disposed || request !== preparation) throw new Error('导出预览已取消。');
    if (!snapshot.items.length) throw new Error('请选择礼物记录。');
    const defaults = readSettings();
    task = { id: randomUUID(), snapshot, root: defaults.directory, saved: 0, running: false, cancelled: false,
      mode: defaults.mode, background: defaults.background };
    setDirectory(task);
    return describe(task);
  }

  function setDirectory(current) {
    const local = new Date(Date.now() + 28800000).toISOString();
    current.directory = path.join(current.root, local.slice(0, 10), `${local.slice(11, 19).replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
  }

  function describe(current) {
    return { id: current.id, snapshot: current.snapshot, root: current.root, directory: current.directory,
      mode: current.mode, background: current.background, files: exportLayout(current.snapshot.items.length, current.mode),
      custom: current.root !== defaultRoot() };
  }

  function requireTask(id) {
    if (!task || id !== task.id) throw new Error('导出预览已失效，请重新打开。');
    assertCurrent(task);
    return task;
  }

  async function configure({ id, mode, background, directoryAction, remember }) {
    const current = requireTask(id);
    if (current.running) throw new Error('正在导出，请先取消。');
    exportLayout(current.snapshot.items.length, mode);
    if (!['transparent', 'white'].includes(background)) throw new Error('背景参数无效。');
    if (directoryAction && !['default', 'choose'].includes(directoryAction)) throw new Error('保存位置参数无效。');
    if (directoryAction === 'choose') {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: '选择礼物图片保存文件夹', defaultPath: current.root,
        properties: ['openDirectory', 'createDirectory'],
      });
      assertCurrent(current);
      if (!result.canceled && result.filePaths[0]) {
        current.root = result.filePaths[0];
        setDirectory(current);
      }
    } else if (directoryAction === 'default') {
      current.root = defaultRoot();
      setDirectory(current);
    }
    current.mode = mode;
    current.background = background;
    if (current.attempted) {
      setDirectory(current);
      current.saved = 0;
      current.completed = false;
      current.attempted = false;
    }
    if (remember === true) runtime.setGiftExportDirectory(current.root === defaultRoot() ? '' : current.root);
    return describe(current);
  }

  async function save({ id }, onProgress = () => {}) {
    const current = requireTask(id);
    if (current.running || current.completed) throw new Error('此任务已开始，请重新打开预览以再次导出。');
    current.running = true;
    current.attempted = true;
    try {
      await fs.mkdir(path.dirname(current.directory), { recursive: true });
      await fs.mkdir(current.directory); // Exclusive task directory; never reuse an existing one.
      assertCurrent(current);
      const firstRows = exportLayout(current.snapshot.items.length, current.mode)[0].count;
      renderWindow = new BrowserWindow({
        width: EXPORT_WIDTH, height: firstRows * 144 + (firstRows - 1) * 16, useContentSize: true, show: false, transparent: true,
        frame: false, skipTaskbar: true, backgroundColor: '#00000000',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
          webSecurity: true, backgroundThrottling: false, zoomFactor: 1, offscreen: true },
      });
      const win = renderWindow;
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      await bounded(win.loadURL(new URL('/gift-export', getBaseUrl()).href));
      for (const file of exportLayout(current.snapshot.items.length, current.mode)) {
        assertCurrent(current);
        const height = file.count * 144 + (file.count - 1) * 16;
        const payload = { items: current.snapshot.items.slice(file.start, file.start + file.count),
          config: current.snapshot.config, catalog: current.snapshot.catalog, background: current.background };
        const { width } = await bounded(win.webContents.executeJavaScript(`window.renderGiftExport(${JSON.stringify(payload)})`));
        assertCurrent(current);
        if (!Number.isSafeInteger(width) || width < EXPORT_WIDTH || width > 8192) throw new Error('图片尺寸验证失败。');
        win.setContentSize(width, height);
        await bounded(win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'));
        assertCurrent(current);
        const image = await bounded(win.webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true, stayAwake: true }));
        let png = image.toPNG();
        if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
          png = image.resize({ width, height, quality: 'best' }).toPNG();
        }
        if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error('图片尺寸验证失败。');
        assertCurrent(current);
        await fs.writeFile(path.join(current.directory, file.fileName), png, { flag: 'wx' });
        current.saved += 1;
        onProgress({ id: current.id, saved: current.saved, total: exportLayout(current.snapshot.items.length, current.mode).length });
      }
      current.completed = true;
      return { ok: true, saved: current.saved, directory: current.directory };
    } catch (error) {
      return { ok: false, cancelled: current.cancelled, saved: current.saved, directory: current.directory,
        error: current.cancelled ? '导出已取消' : publicExportError(error) };
    } finally {
      current.running = false;
      if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
      renderWindow = null;
    }
  }

  function cancel(id) {
    if (id && task?.id !== id) return;
    preparation += 1;
    if (task) task.cancelled = true;
    if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
    renderWindow = null;
  }

  async function openFolder({ id }) {
    if (!task || task.id !== id || task.saved < 1) throw new Error('尚无已保存图片。');
    const error = await shell.openPath(task.directory);
    if (error) throw new Error('无法打开保存文件夹。');
    return { ok: true };
  }

  return { settings, prepare, configure, save, cancel, openFolder, dispose() { disposed = true; cancel(); } };
}

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('图片渲染超时，请重试。')), 20000);
  })]); } finally { clearTimeout(timer); }
}

function publicExportError(error) {
  if (['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EEXIST', 'EROFS'].includes(error.code)) return '保存位置不可用或磁盘空间不足，请重新选择文件夹。';
  return /[\u4e00-\u9fff]/.test(error.message || '') ? error.message : '图片导出失败，请重试。';
}

module.exports = { createGiftExportController, exportLayout };

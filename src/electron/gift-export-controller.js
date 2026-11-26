'use strict';

const { createPublicError } = require('../shared/public-error');

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pngHasSize, normalizeExportImage } = require('./png-size');
const { readGiftExportStyle, configureGiftExportStyle, giftExportConfig } = require('./gift-export-style');
const { BANNER_WIDTH, BANNER_HEIGHT, EXPORT_SCALE, DEFAULT_EXPORT_GAP, giftExportRowLayout } = require('../../public/js/shared/gift-banner-layout.js');
const { giftCardSettledCents } = require('../../public/js/shared/gift-card-model.js');

const MAX_ROWS_PER_IMAGE = 50;
const MAX_EXPORT_HEIGHT = 8768;
const MAX_CAPTURE_HEIGHT = 1024;
const EXPORT_WIDTH = BANNER_WIDTH * EXPORT_SCALE;

function isValidRowGap(value) {
  return Number.isInteger(value) && value >= 0 && value <= DEFAULT_EXPORT_GAP * 2;
}

function validateOrderAndGap(sortBy = 'time', rowGap = DEFAULT_EXPORT_GAP) {
  if (!['time', 'amount'].includes(sortBy)) throw createPublicError('排序方式无效。');
  if (!isValidRowGap(rowGap)) throw createPublicError('词条间距无效。');
}

function validateExportLayout(count, mode) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || !['combined', 'separate'].includes(mode)) {
    throw createPublicError('导出参数无效。');
  }
}

function exportLayout(count, mode, rowGap = DEFAULT_EXPORT_GAP) {
  validateExportLayout(count, mode);
  const rowsByHeight = Math.floor((MAX_EXPORT_HEIGHT + rowGap) / (BANNER_HEIGHT * EXPORT_SCALE + rowGap));
  const rows = mode === 'separate' ? 1 : Math.min(MAX_ROWS_PER_IMAGE, rowsByHeight);
  return Array.from({ length: Math.ceil(count / rows) }, (_, index) => ({
    start: index * rows,
    count: Math.min(rows, count - index * rows),
    fileName: `礼物_${String(index + 1).padStart(3, '0')}.png`,
  }));
}

function createGiftExportController({ app, BrowserWindow, dialog, nativeImage, shell, runtime, getBaseUrl, getMainWindow }) {
  let task = null;
  let renderWindow = null;
  let disposed = false;
  let preparationGeneration = 0;
  const defaultRoot = () => path.join(app.getPath('pictures'), 'LIRA', '礼物导出');
  const assertCurrent = (current) => {
    if (disposed || task !== current || current.cancelled) throw createPublicError('导出已取消。');
    if (runtime.getGiftViewRevision() !== current.snapshot.viewRevision)
      throw createPublicError('礼物来源或流水已变更，请重新选择。');
  };

  function readSettings() {
    const mode = runtime.getSetting('giftExportMode');
    const background = runtime.getSetting('giftExportBackground');
    const storedGap = runtime.getSetting('giftExportRowGap');
    const rowGap = storedGap ? Number(storedGap) : DEFAULT_EXPORT_GAP;
    const directory = runtime.getSetting('giftExportDirectory') || defaultRoot();
    return {
      mode: mode === 'separate' ? mode : 'combined',
      background: background === 'white' ? background : 'transparent',
      sortBy: runtime.getSetting('giftExportSortBy') === 'amount' ? 'amount' : 'time',
      rowGap: isValidRowGap(rowGap) ? rowGap : DEFAULT_EXPORT_GAP,
      mergeAcrossDates: runtime.getSetting('giftExportMergeAcrossDates') === 'true',
      directory,
      custom: directory !== defaultRoot(),
    };
  }

  async function settings(input) {
    if (disposed) throw createPublicError('导出设置已关闭。');
    if (input === undefined) return readSettings();
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['mode', 'background', 'sortBy', 'rowGap', 'mergeAcrossDates', 'directoryAction'].includes(key))
    ) {
      throw createPublicError('导出设置参数无效。');
    }
    const { mode, background, sortBy, rowGap, mergeAcrossDates, directoryAction } = input;
    validateOrderAndGap(sortBy, rowGap);
    if (mergeAcrossDates !== undefined && typeof mergeAcrossDates !== 'boolean') throw createPublicError('合并选项无效。');
    if (mode !== undefined && !['combined', 'separate'].includes(mode)) throw createPublicError('输出方式无效。');
    if (background !== undefined && !['transparent', 'white'].includes(background)) throw createPublicError('背景参数无效。');
    if (directoryAction !== undefined && !['default', 'choose'].includes(directoryAction))
      throw createPublicError('保存位置参数无效。');
    let directory;
    if (directoryAction === 'choose') {
      const generation = preparationGeneration;
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: '选择礼物图片保存文件夹',
        defaultPath: readSettings().directory,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (disposed || generation !== preparationGeneration) throw createPublicError('导出设置已取消，请重新打开。');
      if (result.canceled || !result.filePaths[0]) return readSettings();
      directory = result.filePaths[0];
    } else if (directoryAction === 'default') directory = defaultRoot();
    const next = readSettings();
    if (mode !== undefined) next.mode = mode;
    if (background !== undefined) next.background = background;
    if (directory !== undefined) next.directory = directory;
    runtime.setGiftExportSettings({
      mode: next.mode,
      background: next.background,
      sortBy: sortBy ?? next.sortBy,
      rowGap: rowGap ?? next.rowGap,
      mergeAcrossDates: mergeAcrossDates ?? next.mergeAcrossDates,
      directory: next.directory === defaultRoot() ? '' : next.directory,
    });
    return readSettings();
  }

  async function prepare(selection) {
    if (task?.running) throw createPublicError('请先完成或取消当前导出。');
    cancel();
    const generation = preparationGeneration;
    const snapshot = await runtime.prepareGiftExport(selection);
    if (disposed || generation !== preparationGeneration) throw createPublicError('导出预览已取消。');
    if (!snapshot.items.length) throw createPublicError('请选择礼物记录。');
    const { mode, background, sortBy, rowGap, mergeAcrossDates, directory } = readSettings();
    task = {
      id: randomUUID(),
      snapshot,
      originalSnapshot: snapshot,
      style: readGiftExportStyle(runtime.getSetting('giftExportStyle')),
      mergeAcrossDates: false,
      abort: new AbortController(),
      root: directory,
      saved: 0,
      running: false,
      cancelled: false,
    };
    return configure({ id: task.id, mode, background, sortBy, rowGap, mergeAcrossDates });
  }

  async function nextDirectory(root, previousDirectory) {
    const local = new Date(Date.now() + 28800000).toISOString();
    const dayDirectory = path.join(root, local.slice(0, 10));
    const time = local.slice(11, 16).replace(':', '');
    // Keep the picker usable when the saved location is offline. Save claims the previewed path with mkdir.
    const entries = new Set(await fs.readdir(dayDirectory).catch(() => []));
    for (let batch = 1; ; batch += 1) {
      const name = batch === 1 ? time : `${time}-${String(batch).padStart(2, '0')}`;
      const directory = path.join(dayDirectory, name);
      if (!entries.has(name) && directory !== previousDirectory) return directory;
    }
  }

  function describe(current) {
    return {
      id: current.id,
      snapshot: { ...current.snapshot, config: giftExportConfig(current) },
      styleSource: current.style.source,
      root: current.root,
      directory: current.directory,
      mode: current.mode,
      background: current.background,
      sortBy: current.sortBy,
      rowGap: current.rowGap,
      mergeAcrossDates: current.mergeAcrossDates,
      files: exportLayout(current.snapshot.items.length, current.mode, current.rowGap),
      custom: current.root !== defaultRoot(),
    };
  }

  function requireTask(id) {
    if (!task || id !== task.id) throw createPublicError('导出预览已失效，请重新打开。');
    assertCurrent(task);
    return task;
  }

  async function configure(options) {
    const current = requireTask(options.id);
    if (current.running) throw createPublicError('正在导出，请先取消。');
    if (current.configuring) throw createPublicError('正在更新导出设置。');
    current.configuring = true;
    try {
      return await configureTask(current, options);
    } finally {
      current.configuring = false;
    }
  }

  async function configureTask(current, {
    mode, background, sortBy = current.sortBy, rowGap = current.rowGap,
    mergeAcrossDates = current.mergeAcrossDates, styleSource, customStyle, directoryAction, remember,
  }) {
    if (typeof mergeAcrossDates !== 'boolean') throw createPublicError('合并选项无效。');
    validateExportLayout(current.snapshot.items.length, mode);
    validateOrderAndGap(sortBy, rowGap);
    if (!['transparent', 'white'].includes(background)) throw createPublicError('背景参数无效。');
    if (directoryAction && !['default', 'choose'].includes(directoryAction)) throw createPublicError('保存位置参数无效。');
    const style = configureGiftExportStyle(current.style, styleSource, customStyle, current.originalSnapshot.config);
    let root = current.root;
    let directoryCancelled = false;
    if (directoryAction === 'choose') {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: '选择礼物图片保存文件夹',
        defaultPath: current.root,
        properties: ['openDirectory', 'createDirectory'],
      });
      assertCurrent(current);
      directoryCancelled = result.canceled || !result.filePaths[0];
      if (!directoryCancelled) root = result.filePaths[0];
    } else if (directoryAction === 'default') root = defaultRoot();
    if (directoryCancelled && mode === current.mode && background === current.background
      && sortBy === current.sortBy && rowGap === current.rowGap && mergeAcrossDates === current.mergeAcrossDates
      && style === current.style) {
      return describe(current);
    }
    if (mergeAcrossDates && !current.mergedSnapshot) {
      const merged = await runtime.mergeGiftExport(current.originalSnapshot, current.abort.signal);
      assertCurrent(current);
      current.mergedSnapshot = merged;
    }
    let directory = current.directory;
    if (!directory || root !== current.root || current.attempted) {
      directory = await nextDirectory(root, current.directory);
      assertCurrent(current);
    }
    if (remember === true) {
      const hasStyle = styleSource !== undefined || customStyle !== undefined;
      const rememberRoot = !directoryCancelled && (directoryAction || !hasStyle);
      runtime.rememberGiftExport({
        directory: rememberRoot ? (root === defaultRoot() ? '' : root) : undefined,
        style: hasStyle ? style : undefined,
      });
    }
    current.directory = directory;
    current.root = root;
    current.style = style;
    if (mergeAcrossDates !== current.mergeAcrossDates || sortBy !== current.sortBy) {
      const snapshot = mergeAcrossDates ? current.mergedSnapshot : current.originalSnapshot;
      current.snapshot = sortBy === 'amount'
        ? { ...snapshot, items: snapshot.items.toSorted((a, b) => Number(giftCardSettledCents(b) - giftCardSettledCents(a))) }
        : snapshot;
    }
    current.mergeAcrossDates = mergeAcrossDates;
    current.mode = mode;
    current.background = background;
    current.sortBy = sortBy;
    current.rowGap = rowGap;
    if (current.attempted) {
      current.saved = 0;
      current.completed = false;
      current.attempted = false;
    }
    return describe(current);
  }

  async function save({ id, roomGuard }, onProgress = () => {}) {
    const current = requireTask(id);
    if (current.configuring) throw createPublicError('正在更新导出设置。');
    if (current.running || current.completed) throw createPublicError('此任务已开始，请重新打开预览以再次导出。');
    const knownRoom = typeof roomGuard?.roomId === 'string' && roomGuard.roomId.length > 0 && roomGuard.roomId.length <= 64
      && Number.isSafeInteger(roomGuard.count) && roomGuard.count >= 0;
    const guardAppearance = knownRoom ? { roomId: roomGuard.roomId, count: roomGuard.count } : null;
    current.running = true;
    current.attempted = true;
    try {
      await fs.mkdir(path.dirname(current.directory), { recursive: true });
      await fs.mkdir(current.directory); // Exclusive task directory; never reuse an existing one.
      assertCurrent(current);
      const files = exportLayout(current.snapshot.items.length, current.mode, current.rowGap);
      renderWindow = new BrowserWindow({
        width: EXPORT_WIDTH,
        height: Math.min(MAX_CAPTURE_HEIGHT, giftExportRowLayout(files[0].count, current.rowGap).height),
        useContentSize: true,
        show: false,
        transparent: true,
        frame: false,
        skipTaskbar: true,
        backgroundColor: '#00000000',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          zoomFactor: 1,
          offscreen: true,
        },
      });
      const win = renderWindow;
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      await bounded(win.loadURL(new URL('/gift-export', getBaseUrl()).href));
      assertCurrent(current);
      await bounded(win.webContents.executeJavaScript(`window.initializeGiftExport(${JSON.stringify({
        config: giftExportConfig(current),
        catalog: current.snapshot.catalog,
        roomGuard: guardAppearance,
      })})`));
      for (const file of files) {
        assertCurrent(current);
        const { gap, height } = giftExportRowLayout(file.count, current.rowGap);
        const payload = {
          items: current.snapshot.items.slice(file.start, file.start + file.count),
          background: current.background,
          rowGap: gap,
        };
        const { width } = await bounded(
          win.webContents.executeJavaScript(`window.renderGiftExport(${JSON.stringify(payload)})`),
        );
        assertCurrent(current);
        if (!Number.isSafeInteger(width) || width < EXPORT_WIDTH || width > 8192) throw createPublicError('图片尺寸验证失败。');
        const png = await captureGiftPng(win, { width, height, gap }, nativeImage, () => assertCurrent(current));
        if (!pngHasSize(png, width, height)) throw createPublicError('图片尺寸验证失败。');
        assertCurrent(current);
        const filename = path.join(current.directory, file.fileName);
        const handle = await fs.open(filename, 'wx');
        try {
          try { await handle.writeFile(png); }
          finally { await handle.close(); }
        } catch (error) {
          await fs.unlink(filename);
          throw error;
        }
        current.saved += 1;
        onProgress({
          id: current.id,
          saved: current.saved,
          total: files.length,
        });
      }
      current.completed = true;
      return { ok: true, saved: current.saved, directory: current.directory };
    } catch (error) {
      return {
        ok: false,
        cancelled: current.cancelled,
        saved: current.saved,
        directory: current.directory,
        error: current.cancelled ? '导出已取消' : publicExportError(error),
      };
    } finally {
      current.running = false;
      if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
      renderWindow = null;
    }
  }

  function cancel(id) {
    if (id && task?.id !== id) return;
    preparationGeneration += 1;
    if (task) {
      task.cancelled = true;
      task.abort.abort();
    }
    if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
    renderWindow = null;
  }

  async function openFolder({ id }) {
    if (!task || task.id !== id || task.saved < 1) throw createPublicError('尚无已保存图片。');
    const error = await shell.openPath(task.directory);
    if (error) throw createPublicError('无法打开保存文件夹。');
    return { ok: true };
  }

  return {
    settings,
    prepare,
    configure,
    save,
    cancel,
    openFolder,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}

async function captureGiftPng(win, { width, height, gap }, nativeImage, assertCurrent) {
  // Stay below the texture limit and keep animated artwork within a single capture.
  const rowPitch = BANNER_HEIGHT * EXPORT_SCALE + gap;
  const viewportHeight = Math.min(height, Math.floor(MAX_CAPTURE_HEIGHT / rowPitch) * rowPitch);
  win.setContentSize(width, viewportHeight);
  const bitmap = height > viewportHeight ? Buffer.alloc(width * height * 4) : null;
  for (let top = 0; top < height; top += viewportHeight) {
    const stripHeight = Math.min(viewportHeight, height - top);
    const capture = async () => {
      await bounded(win.webContents.executeJavaScript(`window.positionGiftExport(${top})`));
      assertCurrent();
      return bounded(win.webContents.capturePage(
        { x: 0, y: 0, width, height: stripHeight }, { stayHidden: true, stayAwake: true },
      ));
    };
    const image = await capture().catch(error => {
      // Chromium may reject the first readback of a new offscreen frame.
      if (error.message !== 'UnknownVizError') throw error;
      assertCurrent();
      return capture();
    });
    assertCurrent();
    const strip = normalizeExportImage(image, width, stripHeight, nativeImage);
    if (!strip) throw createPublicError('图片尺寸验证失败。');
    if (!bitmap) return strip.toPNG({ scaleFactor: 1 });
    const pixels = strip.toBitmap({ scaleFactor: 1 });
    if (pixels.length !== width * stripHeight * 4) throw createPublicError('图片尺寸验证失败。');
    pixels.copy(bitmap, top * width * 4);
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(createPublicError('图片渲染超时，请重试。')), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function publicExportError(error) {
  if (['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EEXIST', 'EROFS'].includes(error.code))
    return '保存位置不可用或磁盘空间不足，请重新选择文件夹。';
  return typeof error.publicMessage === 'string' && error.publicMessage ? error.publicMessage : '图片导出失败，请重试。';
}

module.exports = { createGiftExportController, exportLayout };

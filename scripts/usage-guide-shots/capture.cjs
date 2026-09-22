#!/usr/bin/env node
'use strict';

// 使用文档截图主程序（Chromium 路径：管理页 / overlay / license 窗）。
// 用法：
//   node scripts/usage-guide-shots/capture.cjs                # 全部未 skip 镜头
//   node scripts/usage-guide-shots/capture.cjs --only A1,B1   # 指定镜头
//   node scripts/usage-guide-shots/capture.cjs --group B      # 指定组
//   node scripts/usage-guide-shots/capture.cjs --reseed       # 先重建示例数据
//   node scripts/usage-guide-shots/capture.cjs --list         # 只列出清单

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServerRuntime } = require('../../src/server');
const { seed } = require('./seed-data.cjs');
const tools = require('./lib/page-tools.cjs');
const { SHOTS, OUT_ROOT, DATA_DIR } = require('./manifest.js');

const START_PORT = 3000;

function parseArgs(argv) {
  const options = { only: null, group: null, reseed: false, list: false, port: START_PORT };
  for (const arg of argv) {
    if (arg === '--reseed') options.reseed = true;
    else if (arg === '--list') options.list = true;
    else if (arg.startsWith('--only='))
      options.only = arg.slice(7).split(',').map((s) => s.trim());
    else if (arg === '--only')
      throw new Error('--only 需要 = 连接，如 --only=A1,B1');
    else if (arg.startsWith('--group=')) options.group = arg.slice(8);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice(7));
  }
  return options;
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 400 },
      (res) => {
        res.resume();
        resolve(false);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(true));
    req.end();
  });
}

// 点歌队列在每次服务启动时被清空（clearActiveQueueOnStartup），
// 必须在启动后通过 API 灌入，与真实操作路径一致。
async function postApi(baseUrl, token, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`${route} 失败：${payload.error || response.status}`);
  return payload.data;
}

async function seedQueueViaApi(baseUrl, token) {
  const items = [
    { songName: '起风了', artist: '买辣椒也用券', categoryName: '华语流行', viewer: 0, pinned: true },
    { songName: 'Lemon', artist: '米津玄師', categoryName: '日语', viewer: 1 },
    { songName: '勾指起誓', artist: '洛天依', categoryName: '虚拟歌手', viewer: 2 },
    { songName: '平凡之路', artist: '朴树', categoryName: '华语流行', viewer: 3, source: 'sc' },
    { songName: 'Shape of You', artist: 'Ed Sheeran', categoryName: '英语', viewer: 1 },
    { songName: '棠梨煎雪', artist: '银临', categoryName: '古风', viewer: 0 },
    { songName: '普通Disco', artist: '洛天依&言和', categoryName: '虚拟歌手', viewer: 2 },
  ];
  const viewers = [
    { name: '观众A', uid: '100001', guard: 3, medal: '示例团', medalLevel: 12 },
    { name: '观众B', uid: '100002', guard: 0, medal: '示例团', medalLevel: 5 },
    { name: '观众C', uid: '100003', guard: 0, medal: '', medalLevel: 0 },
    { name: '观众D', uid: '100004', guard: 1, medal: '示例团', medalLevel: 8 },
  ];
  for (const item of items) {
    const viewer = viewers[item.viewer];
    const added = await postApi(baseUrl, token, '/api/queue/add', {
      songName: item.songName,
      artist: item.artist,
      categoryName: item.categoryName,
      requesterName: viewer.name,
      requesterUid: viewer.uid,
      requesterGuardLevel: viewer.guard,
      requesterMedalName: viewer.medal,
      requesterMedalLevel: viewer.medalLevel,
      source: item.source || 'danmaku',
    });
    if (item.pinned && added?.id) {
      await postApi(baseUrl, token, '/api/queue/action', {
        action: 'pin',
        id: added.id,
      });
    }
  }
  // 两条已处理的点歌，让「点歌记录」有历史
  for (const [songName, artist, action] of [
    ['不老梦', '银临', 'done'],
    ['锦鲤抄', '银临', 'skip'],
  ]) {
    const added = await postApi(baseUrl, token, '/api/queue/add', {
      songName, artist, categoryName: '古风',
      requesterName: '观众B', requesterUid: '100002',
    });
    if (added?.id) {
      await postApi(baseUrl, token, '/api/queue/action', { action, id: added.id });
    }
  }
}

async function ensureSeedData(force) {
  const marker = path.join(DATA_DIR, 'song-request-data.db');
  if (!force && fs.existsSync(marker)) return false;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  seed(DATA_DIR);
  return true;
}

function shotUrl(baseUrl, shot) {
  if (shot.type === 'license') return `${baseUrl}/license`;
  if (shot.type === 'overlay') return `${baseUrl}${shot.route}`;
  return `${baseUrl}/admin`;
}

async function captureShot(browser, baseUrl, token, shot) {
  const outDir = path.join(OUT_ROOT, 'png', shot.group);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${shot.file}.png`);
  const consoleErrors = [];
  const failedResponses = [];

  // overlay 页是 sandbox（origin: null）：注入 Authorization 会把 module script
  // 变成非简单请求触发 preflight，被服务器 405 拦下。overlay 免登录，不注入。
  const needsToken = shot.type !== 'overlay';
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ...(needsToken
      ? { extraHTTPHeaders: { Authorization: `Bearer ${token}` } }
      : {}),
  });
  if (shot.type === 'license') {
    await context.addInitScript(tools.licenseStubSource(shot.license || {}));
  } else if (shot.type === 'admin') {
    await context.addInitScript(tools.adminStubSource(token));
  }
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(shotUrl(baseUrl, shot), {
      waitUntil: 'load',
      timeout: 15000,
    });
    if (shot.mainPage) {
      await page.click(`[data-main-page="${shot.mainPage}"]`);
      await page.waitForTimeout(150);
    }
    if (shot.waitFor) {
      await page.waitForSelector(shot.waitFor, { timeout: 10000 });
    }
    if (typeof shot.setup === 'function') await shot.setup(page);
    await tools.settle(page, shot.settleMs || 0);
    // 点歌确认悬浮通知（#pendingConfirmPopup）会遮挡页面，除专门拍它的镜头外一律隐藏
    const covers = [
      ...(shot.type === 'admin' && !shot.allowPendingPopup
        ? [{ selector: '#pendingConfirmPopup', mode: 'hide' }]
        : []),
      ...(shot.covers || []),
    ];
    await tools.applyCovers(page, covers);
    await tools.injectAnnotations(page, shot.annotations);

    if (shot.clip && shot.clip.selector) {
      await page.locator(shot.clip.selector).screenshot({ path: outFile });
    } else {
      await page.screenshot({ path: outFile });
    }

    const size = tools.pngSize(outFile);
    const missing = await page.evaluate(
      () => window.__shotAnnotationMissing || [],
    );
    const dimensionOk =
      !shot.clip && size
        ? size.width === shot.viewport.width &&
          size.height === shot.viewport.height
        : true;
    return { outFile, size, dimensionOk, missing, consoleErrors, failedResponses };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let selected = SHOTS.filter((shot) => !shot.skip);
  if (options.group) selected = selected.filter((s) => s.group === options.group);
  if (options.only) selected = SHOTS.filter((s) => options.only.includes(s.id));

  if (options.list) {
    for (const shot of SHOTS) {
      const state = shot.skip ? `暂缓：${shot.skip}` : shot.title;
      console.log(`${shot.id.padEnd(8)} ${state}`);
    }
    return;
  }
  if (selected.length === 0) {
    console.log('没有匹配的镜头。');
    return;
  }

  if (!(await checkPortFree(options.port))) {
    console.error(
      `端口 ${options.port} 已被占用（可能是正在运行的 LIRA）。` +
        '请先关闭后重试，或用 --port=3927 换一个端口。',
    );
    process.exit(2);
  }

  const reseeded = await ensureSeedData(options.reseed);
  if (reseeded) console.log('[capture] 示例数据已重建');

  const runtime = createServerRuntime({ dataDir: DATA_DIR });
  let browser = null;
  const results = [];
  try {
    const { baseUrl } = await runtime.start({
      host: '127.0.0.1',
      startPort: options.port,
    });
    const token = runtime.getApiToken();
    console.log(`[capture] 服务已启动：${baseUrl}`);

    // 礼物页/许愿/导出等功能依赖「活动礼物来源」：真实环境由 B 站同步链路设置，
    // 这里按种子数据直接置为 LIVE（对应 seed-meta.json 里 sourceId 的事件集）。
    const meta = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'seed-meta.json'), 'utf8'),
    );
    runtime.setActiveGiftSource({
      sourceId: meta.giftSourceId,
      syncState: 'LIVE',
      partial: false,
      syncedThroughCursor: 1000,
      syncedAt: new Date().toISOString(),
      latestCursor: 1000,
      dirty: false,
      epochValidated: true,
    });
    await seedQueueViaApi(baseUrl, token);

    browser = await chromium.launch();
    for (const shot of selected) {
      const startedAt = Date.now();
      try {
        const result = await captureShot(browser, baseUrl, token, shot);
        results.push({ shot, ...result, ok: true });
        const warn = [
          result.dimensionOk ? '' : '尺寸不符',
          result.missing.length
            ? `标注未命中: ${result.missing.join(', ')}`
            : '',
          result.consoleErrors.length
            ? `控制台报错 ${result.consoleErrors.length} 条`
            : '',
        ].filter(Boolean);
        console.log(
          `[ok] ${shot.id} ${shot.file} ${result.size?.width}×${result.size?.height} ` +
            `${Date.now() - startedAt}ms${warn.length ? '  ⚠ ' + warn.join('；') : ''}`,
        );
      } catch (error) {
        results.push({ shot, ok: false, error });
        console.error(`[fail] ${shot.id} ${shot.file}: ${error.message}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    await runtime.stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[capture] 完成 ${results.length - failed.length}/${results.length}，输出目录：${path.join(OUT_ROOT, 'png')}`,
  );
  for (const r of results) {
    if (r.ok && r.consoleErrors.length) {
      console.log(`  [console] ${r.shot.id}: ${r.consoleErrors.slice(0, 3).join(' | ')}`);
    }
    if (r.ok && r.failedResponses?.length) {
      console.log(`  [http] ${r.shot.id}: ${r.failedResponses.slice(0, 5).join(' | ')}`);
    }
  }
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { seedQueueViaApi };

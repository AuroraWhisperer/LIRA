'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHttpServer } = require('../../src/server/http-server');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');

module.exports = async function verifyRealOverlays({ directory, createWindow, servers, waitFor }) {
  const { nativeImage, session } = require('electron');
  const token = 'synthetic-overlay-parent-secret';
  const settings = {
    clockStyle: 'digital',
    clockLabel: 'Sandbox clock',
    openingEnabled: 'true',
    openingAudioFile: 'fixture.wav',
    openingAudioName: 'fixture.wav',
    openingVolume: '0.2',
  };
  const audioDirectory = path.join(directory, 'opening-music');
  fs.mkdirSync(audioDirectory);
  const audio = Buffer.alloc(44 + 1600);
  audio.write('RIFF');
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(1600, 40);
  fs.writeFileSync(path.join(audioDirectory, 'fixture.wav'), audio);
  const avatar = nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG();
  const avatarRequests = [];
  let workerScriptRequests = 0;
  const context = {
    sessionToken: token,
    settings: { get: () => settings },
    system: { dataDir: directory },
    bilibili: {
      fetchAvatarImage: async (url) => {
        avatarRequests.push(url);
        return { data: avatar, contentType: 'image/png' };
      },
    },
  };
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 0,
    dataDir: directory,
    getPhase: () => 'ready',
    getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true,
    inflightTracker: { run: (run) => run() },
    createApiContext: () => context,
    getSettings: () => settings,
    servePageOrAsset(req, res, url) {
      // Keep the real management HTML/CSP without starting unrelated app domains.
      if (['/js/admin/index.js', '/js/playback.js'].includes(url.pathname)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end('');
        return;
      }
      if (url.pathname === '/worker-probe.js') {
        workerScriptRequests += 1;
        res.setHeader('Content-Type', 'application/javascript');
        res.end('');
        return;
      }
      if (url.pathname === '/preview-host') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body><iframe sandbox="allow-scripts" src="/clock?style=digital&date=true&seconds=true&format=24"></iframe></body></html>');
        return;
      }
      servePageOrAsset(path.resolve(__dirname, '../../public'), req, res, url, token);
    },
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const admin = createWindow();
  const auth = createDesktopRequestAuth({
    desktopSession: session.defaultSession,
    getMainWindow: () => admin,
    getBaseUrl: () => origin,
    getToken: () => token,
  });
  configureMediaRequestHeaders(session.defaultSession, {}, auth);
  auth.bindWindow(admin, {
    openExternal() {
      assert.fail('probe must not open external browsers');
    },
  });
  await admin.loadURL(`${origin}/admin`);
  const workers = await admin.webContents.executeJavaScript(`(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
    const script = 'self.onconnect=e=>e.ports[0].postMessage("started");if(typeof postMessage==="function")postMessage("started");';
    const blob = URL.createObjectURL(new Blob([script], {type:'application/javascript'}));
    const blocked = make => new Promise(resolve => {
      let worker;
      const done = value => {clearTimeout(timer);worker?.terminate?.();worker?.port?.close();resolve(value);};
      const timer = setTimeout(() => done(false), 1000);
      try {
        worker = make();
        worker.onerror = event => {event.preventDefault();done(true);};
        const port = worker.port || worker;
        port.onmessage = () => done(false);
        port.start?.();
      } catch (error) { done(error.name === 'SecurityError'); }
    });
    const results = await Promise.all([
      blocked(() => new Worker('/worker-probe.js')),
      blocked(() => new Worker(blob)),
      blocked(() => new SharedWorker('/worker-probe.js')),
      navigator.serviceWorker.register('/worker-probe.js').then(async registration => {
        await registration.unregister();return false;
      }, () => true),
    ]);
    await new Promise(resolve => setTimeout(resolve, 25));
    URL.revokeObjectURL(blob);
    return {results, violations};
  })()`);
  assert.deepEqual(workers.results, [true, true, true, true]);
  assert.equal(workers.violations.filter((directive) => directive === 'worker-src').length, 4);
  assert.equal(workerScriptRequests, 0);
  const canvasId = '49a91cc5-2d97-43c9-9c9a-286a077f4428';
  const canvasDto = { document: { schemaVersion: 1, id: canvasId, title: 'Fixture canvas',
    canvas: { width: 1920, height: 1080 }, items: [] }, revision: 1, publishedVersion: 0 };
  const source = { id: canvasId, token: 'synthetic-scene-source' };
  context.scenes = {
    list: () => [canvasDto],
    publish: () => { canvasDto.publishedVersion += 1; return canvasDto; },
    getSource: id => { assert.equal(id, canvasId); return source; },
  };
  await admin.webContents.executeJavaScript(`(async () => {
    window.liraLicense = {
      getProfile: async () => ({ state: 'authorized', streamer: { songPageUrl: 'https://synthetic.test/songs/one' } }),
      getOverlaySettings: async () => ({ ok: true, overlayUrl: 'https://synthetic.test/overlay/abcdefghijklmnop' }),
      onStateChanged: callback => { window.changeCanvasOwner = callback; return () => {}; },
    };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedCanvasSource = text; } } });
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { registerComponentPreview, setComponentPreviewPreparation, getComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    const { prepareComponentPreviewCanvas } = await import('/js/admin/component-preview-canvas-controller.js');
    const clock = createComponentConfigController({ initial: { style: 'digital' } });
    registerComponentPreview('clock', () => ({ id: 'clock', controller: clock }));
    setComponentPreviewPreparation(() => prepareComponentPreviewCanvas(getComponentPreviews()));
    const { initCanvasOverlaySource } = await import('/js/admin/canvas-overlay-source.js');
    initCanvasOverlaySource();
    const { waitForServerOverlayUrlInitialization } = await import('/js/admin/server-overlay-url.js');
    await waitForServerOverlayUrlInitialization();
  })()`);
  await waitFor(() => admin.webContents.executeJavaScript("document.getElementById('liveCanvasUrl').textContent.includes('请先编辑场景')"));
  assert.equal(await admin.webContents.executeJavaScript("document.getElementById('copyLiveCanvasUrl').disabled"), true);
  assert.equal(canvasDto.publishedVersion, 0);
  await admin.webContents.executeJavaScript(`(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    await (await prepareComponentPreviews()).find(item => item.id === 'canvas').publish();
    window.dispatchEvent(new Event('focus'));
  })()`);
  await waitFor(() => admin.webContents.executeJavaScript("!document.getElementById('copyLiveCanvasUrl').disabled"));
  assert.equal(await admin.webContents.executeJavaScript("document.getElementById('liveCanvasUrl').textContent"), `${origin}/scene?id=${canvasId}#token=${source.token}`);
  await admin.webContents.executeJavaScript("document.getElementById('liveCanvasUrl').click()");
  await waitFor(() => admin.webContents.executeJavaScript('Boolean(window.copiedCanvasSource)'));
  assert.equal(await admin.webContents.executeJavaScript('window.copiedCanvasSource'), `${origin}/scene?id=${canvasId}#token=${source.token}`);
  assert.equal(await admin.webContents.executeJavaScript("document.getElementById('liveCanvasUrl').textContent"), `${origin}/scene?id=${canvasId}#token=${source.token}`);
  let canvasPreviewUrl = '';
  auth.bindWindow(admin, { openExternal: url => { canvasPreviewUrl = url; } });
  await admin.webContents.executeJavaScript("document.getElementById('liveCanvasPreview').click()");
  await waitFor(() => Boolean(canvasPreviewUrl));
  assert.equal(new URL(canvasPreviewUrl).pathname, '/c');
  assert.equal(new URL(canvasPreviewUrl).search, '');
  const previewKey = new URL(canvasPreviewUrl).hash.slice(1);
  assert.match(previewKey, /^[A-Za-z0-9_-]{22}$/);
  const previewResponse = await fetch(`${origin}/api/component-preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${previewKey}` },
    body: JSON.stringify({ action: 'resolve' }),
  });
  assert.equal(previewResponse.status, 200);
  assert.ok((await previewResponse.json()).data.links.some(({ component }) => component === 'canvas'));
  context.scenes.list = () => { throw new Error('Synthetic scene read failure'); };
  await admin.webContents.executeJavaScript("window.dispatchEvent(new Event('focus'))");
  await waitFor(() => admin.webContents.executeJavaScript("document.getElementById('liveCanvasSourceStatus').textContent.includes('场景暂时不可用')"));
  assert.equal(await admin.webContents.executeJavaScript("document.getElementById('copyLiveCanvasUrl').disabled"), true);
  context.scenes.list = () => [];
  await admin.webContents.executeJavaScript("window.changeCanvasOwner({state:'unauthorized'})");
  await waitFor(() => admin.webContents.executeJavaScript("document.getElementById('liveCanvasUrl').textContent.includes('请先编辑场景')"));
  assert.equal(await admin.webContents.executeJavaScript("document.getElementById('copyLiveCanvasUrl').disabled"), true);
  auth.dispose();
  admin.destroy();
  const preview = createWindow();
  await preview.loadURL(`${origin}/preview-host`);
  await waitFor(() => preview.webContents.mainFrame.frames.some((frame) => frame.url.includes('/clock?')));
  const frame = preview.webContents.mainFrame.frames.find((item) => item.url.includes('/clock?'));
  await waitFor(async () => await frame.executeJavaScript("document.getElementById('clockCard')?.hidden===false"));
  assert.equal(await frame.executeJavaScript('window.origin'), 'null');
  assert.equal(await frame.executeJavaScript("window.__API_TOKEN__.startsWith('ov1:clock:')"), true);
  assert.equal(await frame.executeJavaScript("fetch('/api/clock/config').then(r=>r.status)"), 200);
  assert.equal(
    await frame.executeJavaScript("fetch('/api/settings').then(r=>r.status).catch(()=> 'blocked')"),
    'blocked',
  );
  assert.equal(
    await frame.executeJavaScript(
      "(()=>{try{void parent.document.body;return false;}catch(e){return e.name==='SecurityError';}})()",
    ),
    true,
  );
  await preview.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage({
    type:'lira:clock-preview-config',config:{style:'peach',label:'Updated preview',showDate:true,showSeconds:true,hourFormat:'24'}
  },'*')`);
  await waitFor(
    async () => await frame.executeJavaScript("document.getElementById('clockLabel').textContent==='Updated preview'"),
  );

  const opening = createWindow();
  await opening.loadURL(`${origin}/opening`);
  await waitFor(
    async () => await opening.webContents.executeJavaScript("document.getElementById('openingAudio')?.readyState>=1"),
  );
  assert.equal(await opening.webContents.executeJavaScript('window.origin'), 'null');
  assert.equal(await opening.webContents.executeJavaScript("window.__API_TOKEN__.startsWith('ov1:opening:')"), true);
  assert.equal(await opening.webContents.executeJavaScript("fetch('/api/opening/config').then(r=>r.status)"), 200);

  const exportWindow = createWindow(undefined, {
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
    zoomFactor: 1,
    offscreen: true,
  });
  exportWindow.setContentSize(856, 144);
  await exportWindow.loadURL(`${origin}/gift-export`);
  await waitFor(
    async () => await exportWindow.webContents.executeJavaScript("typeof window.renderGiftExport==='function'"),
  );
  assert.equal(await exportWindow.webContents.executeJavaScript('window.origin'), 'null');
  const exported = await exportWindow.webContents.executeJavaScript(
    `window.renderGiftExport({items:[{eventId:'synthetic-gift',gift:{giftId:'guard-3',
      coinType:'guard',giftName:'Synthetic gift',userName:'Synthetic sender',unitPrice:1,num:2,
      avatarUrl:'https://synthetic.test/avatar'}}],config:{thresholds:[1000,2000,3000]},catalog:[],background:'white'})`,
  );
  assert.equal(exported.width, 856);
  assert.equal(exported.height, 144);
  const images = await exportWindow.webContents.executeJavaScript(
    "[...document.querySelectorAll('#stage img')].map(img=>({width:img.naturalWidth,height:img.naturalHeight,source:img.getAttribute('src'),fallback:img.dataset.fallback,hidden:img.style.visibility==='hidden'}))",
  );
  assert.equal(images.length, 2);
  for (const image of images) {
    assert.ok(image.width > 0 && image.height > 0);
    assert.notEqual(image.source, image.fallback);
    assert.equal(image.hidden, false);
  }
  assert.deepEqual(avatarRequests, ['https://synthetic.test/avatar']);
  const capture = await exportWindow.webContents.capturePage(
    { x: 0, y: 0, width: 856, height: 144 },
    { stayHidden: true, stayAwake: true },
  );
  assert.equal(capture.isEmpty(), false);
  assert.ok(capture.getSize().width > 0 && capture.getSize().height > 0);
};

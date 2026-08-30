'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const {
  addFrameProtectionHeaders,
  contentType,
  serveOpeningCharacter,
} = require('../src/server/http-utils');
const { handleApi } = require('../src/server/api-routes');
const {
  prepareSettingsBootstrap,
} = require('../src/server/settings-bootstrap');
const openingRoutes = require('../src/server/routes/opening-routes');
const settingsRoutes = require('../src/server/routes/settings-routes');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const settingsStoreModule = require('../src/storage/settings-store');
const { DEFAULT_SETTINGS } = settingsStoreModule;

const ROOT_DIR = path.join(__dirname, '..');
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('opening overlay assets and explicit route are registered', () => {
  const musicPath = path.join(
    ROOT_DIR,
    'public/img/overlays/opening/music.ogg',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT_DIR, 'public/pages/overlays/opening.html')),
  );
  assert.ok(
    fs.existsSync(path.join(ROOT_DIR, 'public/css/overlays/opening.css')),
  );
  assert.ok(
    fs.existsSync(path.join(ROOT_DIR, 'public/js/overlays/opening.js')),
  );
  assert.ok(
    fs.existsSync(
      path.join(ROOT_DIR, 'public/img/overlays/opening/avatar.webp'),
    ),
  );
  assert.ok(fs.existsSync(musicPath));
  assert.ok(fs.statSync(musicPath).size > 100_000);
  assert.equal(
    fs.readFileSync(musicPath).subarray(0, 4).toString('ascii'),
    'OggS',
  );
  const server = read('src', 'server', 'http-utils.js');
  const serverRuntime = [
    read('src', 'server.js'),
    read('src', 'server', 'http-server.js'),
  ].join('\n');
  assert.match(server, /\['\/opening',\s*'pages\/overlays\/opening\.html'\]/);
  assert.match(server, /'\.ogg':\s*'audio\/ogg'/);
  assert.equal(
    contentType(path.join(ROOT_DIR, 'public/img/overlays/opening/music.ogg')),
    'audio/ogg',
  );
  assert.match(
    serverRuntime,
    /requestUrl\.pathname\.startsWith\('\/opening-character\/'\)/,
  );
  assert.match(serverRuntime, /serveOpeningCharacter/);
});

test('opening overlay is frameable and keeps the required character transform layers', () => {
  const headers = new Map();
  addFrameProtectionHeaders(
    {
      setHeader(name, value) {
        headers.set(name, value);
      },
    },
    '/opening',
  );
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.has('X-Frame-Options'), false);

  const html = read('public', 'pages', 'overlays', 'opening.html');
  assert.match(html, /<html[^>]+class="opening-disabled"/);
  assert.match(html, /<body[^>]+class="opening-disabled"/);
  assert.match(html, /class="opening-viewport opening-disabled"/);
  assert.match(html, /class="opening-stage is-disabled"/);
  for (const className of [
    'character-anchor',
    'character-enter',
    'character-float',
    'character-sway',
    'character-breathe',
    'character-image',
  ]) {
    assert.match(html, new RegExp(`class="[^"]*${className}[^"]*"`));
  }
  assert.match(html, /class="track-waveform"/);
  assert.match(html, /data-track-motion="heart"/);
  assert.match(html, /id="openingTrackPath"[^>]+pathLength="1"/);
  for (const className of ['track-base', 'track-barber', 'track-progress']) {
    assert.match(html, new RegExp(`class="[^"]*${className}[^"]*"`));
  }
  assert.match(html, /<animateMotion[^>]+repeatCount="indefinite"/);
  assert.match(
    html,
    /<animate[^>]+class="track-heart-visibility"[^>]+attributeName="opacity"/,
  );
  assert.doesNotMatch(html, /<animateMotion[^>]+keyPoints=/);
  assert.match(html, /<mpath href="#openingTrackPath"/);
  assert.match(
    html,
    /<audio id="openingAudio" loop preload="metadata"><\/audio>/,
  );
  assert.doesNotMatch(html, /id="openingAudio"[^>]+autoplay/);
  assert.doesNotMatch(html, /id="openingAudio"[^>]+src=/);
  assert.doesNotMatch(html, /SINGING LIVE/);
  assert.doesNotMatch(html, /歌声即将开始/);
  assert.match(html, /id="openingFooter"[^>]*>欢迎来到直播间<\/p>/);
  assert.doesNotMatch(html, /<span class="track-heart"/);
  assert.doesNotMatch(html, />@<\/span>/);
  assert.doesNotMatch(html, /track-flow/);
});

test('opening overlay animation honors quality, motion, visibility, and safe text rendering', () => {
  const html = read('public', 'pages', 'overlays', 'opening.html');
  const css = read('public', 'css', 'overlays', 'opening.css');
  const script = read('public', 'js', 'overlays', 'opening.js');
  assert.match(css, /background-color:\s*var\(--opening-night\)/);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /width:\s*min\(100vw,\s*177\.7778vh\)/);
  assert.match(css, /height:\s*min\(100vh,\s*56\.25vw\)/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /font-size:\s*var\(--opening-title-size(?:,[^)]+)?\)/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /cqw/);
  assert.doesNotMatch(css, /\.track::before\s*\{/);
  assert.doesNotMatch(css, /@keyframes\s+track-glint/);
  assert.doesNotMatch(css, /mic-glint/);
  assert.match(css, /\.track-heart-motion\s*\{\s*opacity:\s*0?\.86/);
  assert.doesNotMatch(css, /@keyframes\s+track-heart-visibility/);
  assert.match(css, /\[data-track-motion='barber'\][^\{]*\.track-barber/);
  assert.match(css, /\[data-track-motion='progress'\][^\{]*\.track-progress/);
  assert.match(css, /@keyframes\s+track-barber-flow/);
  assert.match(css, /@keyframes\s+track-progress-flow/);
  assert.match(css, /\.opening-stage\.is-reduced-motion[^\{]*\.track-barber/);
  assert.match(css, /\.opening-stage\.quality-low[^\{]*\.track-progress/);
  assert.match(css, /animation:\s*eq-smooth/);
  assert.match(css, /@keyframes\s+eq-smooth/);
  assert.match(css, /@keyframes\s+character-float[\s\S]*?-0?\.45cqw/);
  assert.match(css, /@keyframes\s+character-breathe[\s\S]*?scale\(1\.008\)/);
  assert.match(
    css,
    /@keyframes\s+note-drift[\s\S]*?0%,\s*100%\s*\{\s*opacity:\s*0/,
  );
  assert.match(css, /\.opening-stage\.is-paused\s+\*::before/);
  assert.match(
    css,
    /\.opening-stage\.is-reduced-motion\s+\.character-float[^\{]*\{[^}]*transform:\s*none/,
  );
  assert.match(
    css,
    /\.opening-stage\.is-reduced-motion\s+\.opening-glow[^\{]*\{[^}]*animation:\s*none/,
  );
  assert.match(
    css,
    /\.opening-stage\.is-reduced-motion\s+\.opening-glow\s*\{[^}]*opacity:\s*0?\.74/,
  );
  assert.match(html, /<animateMotion\b[^>]*\bdur="7\.2s"/);
  assert.match(
    html,
    /<animate\b(?=[^>]*\bvalues="\.86;\.86;0;0")(?=[^>]*\bkeyTimes="0;\.88;\.96;1")[^>]*>/,
  );
  assert.match(css, /translate3d\(/);
  assert.match(css, /\.opening-stage\.is-disabled\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.opening-stage\.is-disabled\s*\{[^}]*animation:\s*none/);
  assert.match(
    css,
    /html\.opening-disabled,\s*body\.opening-disabled[^\{]*\{[^}]*background:\s*transparent\s*!important/,
  );
  assert.match(css, /\.opening-viewport\.opening-disabled/);
  assert.doesNotMatch(css, /background-position/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Array\.from/);
  assert.match(script, /textContent/);
  assert.match(script, /QUALITY_LIMITS/);
  assert.match(script, /TRACK_MOTION_VALUES/);
  assert.match(script, /stage\.dataset\.trackMotion\s*=\s*config\.trackMotion/);
  assert.match(script, /trackSvg\?\.setCurrentTime\?\.\(0\)/);
  assert.match(script, /safeCharacterUrl/);
  assert.match(
    script,
    /avatar\.src\s*=\s*safeCharacterUrl\(config\.characterUrl\)/,
  );
  assert.match(script, /titleSizeForLength/);
  assert.match(script, /title:\s*'唱一首，在一首，给你的歌'/);
  assert.match(script, /MAX_LENGTHS = Object\.freeze\(\{\s*title:\s*20/);
  assert.match(script, /name:\s*''/);
  assert.match(script, /audio:\s*'browser'/);
  assert.match(script, /openingNameRow/);
  assert.match(script, /audio === 'browser'/);
  assert.match(script, /stage\.classList\.add\('is-disabled',\s*'is-paused'\)/);
  assert.match(script, /audio\.removeAttribute\('src'\)/);
  assert.match(script, /console\.warn/);
});

test('Toolbox opening animation persists configuration and keeps a fixed source URL', () => {
  const html = read(
    'public',
    'pages',
    'admin',
    'toolbox',
    'start-animation.html',
  );
  const script = read('public', 'js', 'admin', 'start-animation.js');
  const overlayScript = read('public', 'js', 'overlays', 'opening.js');
  const openingRoutesSource = read(
    'src',
    'server',
    'routes',
    'opening-routes.js',
  );
  const formsScript = read('public', 'js', 'admin', 'forms.js');
  const styles = read(
    'public',
    'css',
    'admin',
    'other-features',
    'start-animation.css',
  );
  assert.match(
    html,
    /class="[^"]*other-feature-panel-body[^"]*opening-animation-panel/,
  );
  assert.match(html, /id="openingEnabled"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="openingEnabled"[^>]+checked/);
  assert.match(html, /id="openingPreview"[^>]+hidden/);
  assert.doesNotMatch(html, /STARTING SOON/);
  assert.doesNotMatch(html, /SINGING LIVE/);
  assert.doesNotMatch(html, /关闭总开关后，Browser Source 会变透明/);
  assert.doesNotMatch(html, /URL 即时预览/);
  assert.match(html, /<span>开场文案<\/span\s*>/);
  assert.match(html, /<strong>设置开播画面上的文字<\/strong>/);
  assert.match(html, /class="opening-switch-label">漂浮音符<\/span>/);
  assert.match(html, /class="opening-switch-label">音乐律动<\/span>/);
  for (const id of [
    'openingTitle',
    'openingTitleCount',
    'openingSubtitle',
    'openingName',
    'openingFooter',
    'openingQuality',
    'openingTrackMotion',
    'openingShowNotes',
    'openingShowEq',
    'openingCharacterFile',
    'openingCharacterName',
    'openingResetCharacter',
    'openingAudioFile',
    'openingAudioVolume',
    'openingUrl',
    'openingPreview',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(
    html,
    /id="openingTrackMotion"[^>]*>[\s\S]*value="heart"[^>]*selected[^>]*>心形巡航/,
  );
  assert.match(html, /value="barber"[^>]*>灯带循环/);
  assert.match(html, /value="progress"[^>]*>流光进度/);
  assert.match(html, /id="openingTitle"[^>]+value="唱一首，在一首，给你的歌"/);
  assert.match(html, /id="openingTitle"[^>]+maxlength="20"/);
  assert.match(html, /id="openingName"[^>]+value=""/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /localOverlayOrigin/);
  assert.match(script, /params\.set\('enabled'/);
  assert.match(script, /params\.set\(\s*'trackMotion'/);
  assert.match(script, /params\.set\('audio',\s*'browser'\)/);
  assert.match(script, /buildOpeningSourceUrl/);
  assert.match(script, /openingAudioVolume/);
  assert.match(script, /OPENING_AUDIO_ENDPOINT/);
  assert.match(script, /OPENING_CHARACTER_ENDPOINT/);
  assert.match(script, /MAX_CHARACTER_UPLOAD_BYTES/);
  assert.match(script, /openingSettingsPayload/);
  assert.match(script, /openingTrackMotion:\s*config\.trackMotion/);
  assert.match(script, /about:blank/);
  assert.match(script, /enabled:\s*false/);
  assert.match(
    script,
    /getElementById\('openingEnabled'\)\?\.addEventListener\('change'/,
  );
  assert.match(script, /volumePercent/);
  assert.match(script, /event\.target\?\.id === 'openingAudioVolume'/);
  assert.match(script, /type: 'lira:opening-preview-volume'/);
  assert.match(script, /preview\?\.contentWindow\?\.postMessage/);
  assert.match(
    overlayScript,
    /event\.source !== window\.parent\s*\|\|\s*event\.data\?\.type !== 'lira:opening-preview-volume'/,
  );
  assert.match(
    overlayScript,
    /audio\.volume = parseVolume\(event\.data\.volume, audio\.volume\)/,
  );
  assert.doesNotMatch(script, /固定地址刷新后会读取最新设置/);
  assert.match(overlayScript, /enabled:\s*false/);
  assert.match(
    openingRoutesSource,
    /parseBoolean\(settings\.openingEnabled,\s*false\)/,
  );
  assert.equal(DEFAULT_SETTINGS.openingEnabled, 'false');
  assert.equal(DEFAULT_SETTINGS.openingFooter, '欢迎来到直播间');
  assert.equal(DEFAULT_SETTINGS.openingTrackMotion, 'heart');
  assert.equal(DEFAULT_SETTINGS.openingCharacterFile, '');
  assert.equal(DEFAULT_SETTINGS.openingCharacterName, '');
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return { openingFooter: 'SINGING LIVE' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).footer,
    '欢迎来到直播间',
  );
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return { openingTrackMotion: 'barber' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).trackMotion,
    'barber',
  );
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return { openingTrackMotion: 'sparkle' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).trackMotion,
    'heart',
  );
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return {};
        },
      },
      system: { dataDir: os.tmpdir() },
    }).characterUrl,
    '/img/overlays/opening/avatar.webp',
  );
  assert.match(script, /openingTitleCount/);
  assert.match(script, /Array\.from\(config\.title\)\.length}\/20/);
  assert.doesNotMatch(script, /localStorage/);
  assert.match(styles, /aspect-ratio:\s*16 \/ 9/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(
    styles,
    /opening-editor-checks input:checked \+ \.opening-switch-ui/,
  );
  assert.match(formsScript, /element\?\.closest\('#openingAnimationForm'\)/);
  assert.match(
    read('public', 'js', 'admin', 'app.js'),
    /initStartAnimation\(\)/,
  );
});

test('opening track motion settings reject values outside the public enum', async () => {
  const writes = [];
  let configureCalls = 0;
  let broadcastReason = '';
  let responsePayload = null;
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      responsePayload = JSON.parse(value);
    },
  };
  const context = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      set(key, value) {
        writes.push([key, value]);
      },
    },
    bilibili: {
      configure() {
        configureCalls += 1;
      },
    },
    broadcastSnapshot(reason) {
      broadcastReason = reason;
    },
    system: {
      getState() {
        return { settings: {} };
      },
    },
  };

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return { openingTrackMotion: 'sparkle' };
      },
    },
    response,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(responsePayload, {
    ok: false,
    error: '设置 openingTrackMotion 的值无效。',
  });
  assert.deepEqual(writes, []);
  assert.equal(configureCalls, 0);

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return { openingTrackMotion: ' barber ' };
      },
    },
    response,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(writes, [['openingTrackMotion', 'barber']]);
  assert.equal(configureCalls, 1);
  assert.equal(broadcastReason, 'settings');
});

test('opening animation starts disabled for every application session', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-opening-startup-'),
  );
  const databases = createDatabases({
    dataDir,
    defaultSettings: DEFAULT_SETTINGS,
  });

  try {
    const firstSession = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    ).settingsStore;
    firstSession.setSetting('openingEnabled', 'true');

    const nextSession = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    ).settingsStore;
    assert.equal(nextSession.getSettings().openingEnabled, 'false');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('opening music uploads stay inside the configured data directory', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-opening-test-'));
  const settings = {
    values: {
      openingEnabled: 'true',
      openingTitle: '',
      openingSubtitle: '',
      openingName: '',
      openingFooter: '',
      openingQuality: 'normal',
      openingTrackMotion: 'heart',
      openingShowNotes: 'true',
      openingShowEq: 'true',
      openingAudioFile: '',
      openingAudioName: '',
      openingAudioVolume: '0.35',
      openingCharacterFile: '',
      openingCharacterName: '',
    },
    get() {
      return { ...this.values };
    },
    set(key, value) {
      this.values[key] = value;
    },
  };
  const context = { system: { dataDir }, settings, broadcastSnapshot() {} };
  const boundary = 'opening-test-boundary';
  const crlf = '\r\n';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="custom.mp3"${crlf}Content-Type: audio/mpeg${crlf}${crlf}`,
    ),
    Buffer.from('audio bytes'),
    Buffer.from(`${crlf}--${boundary}--${crlf}`),
  ]);
  const request = Readable.from([body]);
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  let responsePayload = null;
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      responsePayload = JSON.parse(value);
    },
  };

  try {
    await openingRoutes.routes['POST /api/opening/music'](
      context,
      { req: request },
      response,
    );
    assert.equal(response.status, 200);
    assert.equal(responsePayload.ok, true);
    assert.equal(responsePayload.data.audioName, 'custom.mp3');
    const files = fs.readdirSync(openingRoutes.getMusicDir(dataDir));
    assert.equal(files.length, 1);
    assert.match(files[0], /^opening-.*\.mp3$/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('opening character uploads validate image signatures and stay inside the data directory', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-opening-character-test-'),
  );
  const settings = {
    values: {
      openingEnabled: 'true',
      openingTitle: '',
      openingSubtitle: '',
      openingName: '',
      openingFooter: '',
      openingQuality: 'normal',
      openingTrackMotion: 'heart',
      openingShowNotes: 'true',
      openingShowEq: 'true',
      openingAudioFile: '',
      openingAudioName: '',
      openingAudioVolume: '0.35',
      openingCharacterFile: '',
      openingCharacterName: '',
    },
    get() {
      return { ...this.values };
    },
    set(key, value) {
      this.values[key] = value;
    },
  };
  const context = { system: { dataDir }, settings, broadcastSnapshot() {} };
  const makeRequest = (name, content) => {
    const boundary = 'opening-character-test-boundary';
    const crlf = '\r\n';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${name}"${crlf}Content-Type: image/png${crlf}${crlf}`,
      ),
      content,
      Buffer.from(`${crlf}--${boundary}--${crlf}`),
    ]);
    const request = Readable.from([body]);
    request.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    return request;
  };
  const makeResponse = () => {
    const result = { payload: null };
    result.response = {
      writeHead(status) {
        this.status = status;
      },
      end(value) {
        result.payload = JSON.parse(value);
      },
    };
    return result;
  };

  try {
    const invalid = makeResponse();
    await openingRoutes.routes['POST /api/opening/character'](
      context,
      { req: makeRequest('fake.png', Buffer.from('not an image')) },
      invalid.response,
    );
    assert.equal(invalid.response.status, 400);
    assert.equal(settings.values.openingCharacterFile, '');

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const uploaded = makeResponse();
    await openingRoutes.routes['POST /api/opening/character'](
      context,
      { req: makeRequest('custom.png', png) },
      uploaded.response,
    );
    assert.equal(uploaded.response.status, 200);
    assert.equal(uploaded.payload.ok, true);
    assert.equal(uploaded.payload.data.characterName, 'custom.png');
    assert.equal(uploaded.payload.data.hasUploadedCharacter, true);
    assert.match(
      uploaded.payload.data.characterUrl,
      /^\/opening-character\/opening-character-.*\.png$/,
    );
    const files = fs.readdirSync(openingRoutes.getCharacterDir(dataDir));
    assert.equal(files.length, 1);
    assert.equal(files[0], settings.values.openingCharacterFile);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('opening character writes require authentication and only the selected file is served', async () => {
  let authPayload = null;
  const authResponse = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      authPayload = JSON.parse(value);
    },
  };
  await handleApi(
    { sessionToken: 'required-token' },
    { method: 'POST', headers: {} },
    authResponse,
    new URL('http://127.0.0.1/api/opening/character'),
  );
  assert.equal(authResponse.status, 401);
  assert.equal(authPayload.ok, false);

  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-opening-character-media-test-'),
  );
  const characterDir = openingRoutes.getCharacterDir(dataDir);
  const fileName = 'opening-character-selected.png';
  const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.mkdirSync(characterDir, { recursive: true });
  fs.writeFileSync(path.join(characterDir, fileName), content);

  const requestCharacter = (requestedName, selectedName) =>
    new Promise((resolve) => {
      const chunks = [];
      const response = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      response.writeHead = (status, headers) => {
        response.status = status;
        response.headers = headers;
      };
      response.on('finish', () =>
        resolve({
          status: response.status,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
      serveOpeningCharacter(
        dataDir,
        { method: 'GET' },
        response,
        new URL(`http://127.0.0.1/opening-character/${requestedName}`),
        () => selectedName,
      );
    });

  try {
    const served = await requestCharacter(fileName, fileName);
    assert.equal(served.status, 200);
    assert.equal(served.headers['Content-Type'], 'image/png');
    assert.deepEqual(served.body, content);

    const rejected = await requestCharacter(fileName, 'different.png');
    assert.equal(rejected.status, 404);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

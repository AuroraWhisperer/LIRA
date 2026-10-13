'use strict';

// Production settings, preload, IPC and login controller in an isolated desktop host.
if (process.versions.electron) run().catch((error) => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  const { createHttpServer } = require('../../src/server/http-server');
  const { servePageOrAsset } = require('../../src/server/page-assets');
  const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
  const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');
  const { createGuardExpiryAuth } = require('../../src/electron/guard-expiry-auth');
  const { registerGuardExpiryIpc } = require('../../src/electron/ipc/guard-expiry-ipc');
  const root = path.resolve(__dirname, '../..');
  const dataArgument = process.argv.find((value) => value.startsWith('--guard-expiry-data='));
  if (!dataArgument) throw new Error('Isolated data argument required.');
  const directory = path.resolve(dataArgument.slice('--guard-expiry-data='.length));
  if (fs.realpathSync(path.dirname(directory)) !== fs.realpathSync(path.join(root, 'tmp')))
    throw new Error(`Expected isolated tmp data: ${directory}`);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  await app.whenReady();
  const token = 'synthetic-expiry-desktop';
  const state = global.guardExpiryTest = {
    account: { source: 'shared', loggedIn: true, uid: '456', displayName: '合成机器人', revision: 0 },
    failNext: '', partitions: [], uploaded: 0,
  };
  const manager = {
    isAuthorized: () => true, getCloudSyncIdentity: () => ({ streamerId: 1 }), getAuthorizationGeneration: () => 1,
    onStateChanged: () => () => {}, getGuardExpiryAccountInternal: async () => state.account,
    async updateGuardExpiryAccountInternal(input) {
      if (state.failNext) { const code = state.failNext; state.failNext = ''; throw Object.assign(new Error(code), { code }); }
      if (input.cookie) state.uploaded++;
      state.account = { source: input.source, revision: state.account.revision + 1,
        loggedIn: input.source === 'shared' || Boolean(input.cookie),
        uid: input.source === 'shared' ? '456' : input.cookie ? '123' : null,
        displayName: input.source === 'shared' ? '合成机器人' : input.cookie ? '合成主播' : null };
      return state.account;
    },
    async clearGuardExpiryAccountInternal() { return this.updateGuardExpiryAccountInternal({ source: 'separate' }); },
  };
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, dataDir: directory, getPhase: () => 'ready',
    getStartedPort: () => server.address().port, isLicenseAuthorized: () => true,
    inflightTracker: { run: (fn) => fn() }, getSettings: () => ({}),
    createApiContext: () => ({ sessionToken: token, bilibili: {
      getRoomProfile: async () => ({ roomId: '12345', uid: '123', name: '合成主播', avatarUrl: 'https://i0.hdslb.com/bfs/face/synthetic-owner.png' }),
      fetchAvatarImage: async () => ({ contentType: 'image/png', data: fs.readFileSync(path.join(root, 'build/icon.png')) }),
    } }),
    servePageOrAsset(req, res, url) {
      if (url.pathname === '/js/admin/index.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`import './contextual-help.js';
          import { enhanceSelects } from '../shared/select-menu.js';
          import { initGuardExpirySettings } from './settings-guard-expiry.js';
          import { createBilibiliRoomProfile } from './settings-room-profile.js';
          const panel = document.getElementById('settingsPage');
          const shell = document.querySelector('.app-shell');
          shell.replaceChildren(panel); document.body.replaceChildren(shell);
          panel.className = 'tab-page active';
          document.getElementById('bilibiliAuthStatus').textContent = '本机已登录';
          document.getElementById('bilibiliAuthStatus').className = 'pill good';
          document.getElementById('bilibiliLoginBtn').hidden = true;
          document.getElementById('bilibiliLogoutBtn').style.display = '';
          document.getElementById('bilibiliAuthProfile').hidden = false;
          document.getElementById('bilibiliAuthName').textContent = '合成机器人';
          document.getElementById('bilibiliAuthUid').textContent = 'UID 456';
          document.getElementById('roomId').value = '12345';
          const guardExpirySettings = initGuardExpirySettings({ documentRef: document, windowRef: window });
          const roomProfile = createBilibiliRoomProfile({ documentRef: document, fetchRef: fetch, apiToken: window.__API_TOKEN__,
            onProfileChange: (profile) => guardExpirySettings.updateRoomProfile(profile) });
          void roomProfile.refresh('12345');
          enhanceSelects(panel);`);
        return;
      }
      if (url.pathname === '/js/playback.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(''); return; }
      servePageOrAsset(path.join(root, 'public'), req, res, url, token);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${origin}/admin`)).status !== 401) throw new Error('Desktop authorization required.');
  const window = new BrowserWindow({ width: 1440, height: 900, show: false,
    webPreferences: { preload: path.join(root, 'src/electron/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const desktopAuth = createDesktopRequestAuth({ desktopSession: session.defaultSession,
    getMainWindow: () => window, getBaseUrl: () => origin, getToken: () => token });
  configureMediaRequestHeaders(session.defaultSession, {}, desktopAuth);
  desktopAuth.bindWindow(window, { openExternal() {} });
  // A synthetic official-origin page exercises real isolated cookies and the normal login window.
  const expiryAuth = createGuardExpiryAuth({
    licenseManager: manager, BrowserWindow, shell: { openExternal() {} }, getMainWindow: () => window,
    loginConfig: require('../../src/electron/bilibili-auth').BILIBILI_LOGIN_CONFIG,
    session: { fromPartition(partition) {
      state.partitions.push(partition);
      const selected = session.fromPartition(partition);
      selected.protocol.handle('https', () => new Response(`<html><body><button id="signIn">登录合成主播</button><script>
        document.getElementById('signIn').onclick = () => {
          for (const pair of ['DedeUserID=123','SESSDATA=synthetic-owner','bili_jct=synthetic-csrf'])
            document.cookie = pair + '; Domain=.bilibili.com; Path=/; Secure';
        };</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
      return selected;
    } },
  });
  const disposeIpc = registerGuardExpiryIpc({ ipcMain, auth: expiryAuth, getMainWindow: () => window, getDesktopBaseUrl: () => origin });
  app.once('before-quit', () => { disposeIpc(); expiryAuth.dispose(); desktopAuth.dispose(); server.closeAllConnections(); server.close(); });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(`${origin}/admin`);
}

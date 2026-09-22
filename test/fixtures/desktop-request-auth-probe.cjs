'use strict';

// node --test discovers fixtures too; this entrypoint only owns an Electron app.
if (!process.versions.electron) return;

const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
const token = 'synthetic-electron-management-secret';
const requests = [];
const windows = [];
const servers = [];
let mainWindow = null;
let baseUrl = '';
let externalUrl = '';

function record(req) {
  const url = new URL(req.url, baseUrl);
  requests.push({
    path: url.pathname,
    management: req.headers.authorization === `Bearer ${token}`,
    origin: req.headers.origin || '',
    scoped: req.headers.authorization === 'Bearer overlay-clock',
  });
  return url;
}

async function listen(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function createWindow(partition, webPreferences = {}) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...(partition ? { partition } : {}),
      ...webPreferences,
    },
  });
  windows.push(window);
  return window;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Synthetic browser request did not arrive');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

app
  .whenReady()
  .then(async () => {
    const external = await listen((req, res) => {
      requests.push({ path: '/external', management: req.headers.authorization === `Bearer ${token}` });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end('{}');
    });
    externalUrl = external.url;
    const local = await listen((req, res) => {
      const url = record(req);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/admin') {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401);
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body><iframe sandbox="allow-scripts" src="/clock"></iframe></body></html>');
        return;
      }
      if (url.pathname === '/clock') {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
        res.end(`<script>
        let isolated=false;try{void parent.document.body;}catch(e){isolated=e.name==='SecurityError';}
        fetch('/report?isolated='+isolated);
        fetch('/api/iframe',{headers:{Authorization:'Bearer overlay-clock'}});
        fetch('/admin');
      </script>`);
        return;
      }
      if (url.pathname === '/report') requests.at(-1).isolated = url.searchParams.get('isolated') === 'true';
      if (url.pathname === '/api/redirect') {
        res.writeHead(302, { Location: `${externalUrl}/target` });
        res.end();
        return;
      }
      if (url.pathname === '/api/redirect-overlay') {
        res.writeHead(302, { Location: '/clock?redirected=1' });
        res.end();
        return;
      }
      res.setHeader('Content-Type', url.pathname.startsWith('/api/') ? 'application/json' : 'text/html');
      res.end(url.pathname.startsWith('/api/') ? '{}' : '<html><body>fixture</body></html>');
    });
    baseUrl = local.url;
    local.server.on('upgrade', (req, socket) => {
      record(req);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    });
    const auth = createDesktopRequestAuth({
      desktopSession: session.defaultSession,
      getMainWindow: () => mainWindow,
      getBaseUrl: () => baseUrl,
      getToken: () => token,
    });
    configureMediaRequestHeaders(session.defaultSession, {}, auth);
    mainWindow = createWindow();
    auth.bindWindow(mainWindow, {
      openExternal() {
        assert.fail('probe must not open external browsers');
      },
    });
    await mainWindow.loadURL(`${baseUrl}/admin`);
    await waitFor(() => requests.some((row) => row.path === '/report'));
    await mainWindow.webContents.executeJavaScript(`Promise.all([
    fetch('/api/main'), fetch('/api/redirect'), fetch('/api/redirect-overlay'),
    fetch('/api/media').then(()=>{}),
    Promise.resolve(navigator.sendBeacon('/api/beacon','{}')),
    new Promise(resolve=>{const ws=new WebSocket('ws://'+location.host+'/ws');ws.onerror=resolve;})
  ]).then(()=>null)`);
    const secretState = await mainWindow.webContents.executeJavaScript(
      '({token:window.__API_TOKEN__,cookie:document.cookie,storage:JSON.stringify(localStorage)})',
    );
    assert.equal(secretState.token, undefined);
    assert.equal(JSON.stringify(secretState).includes(token), false);
    const externalRequests = requests.filter((row) => row.path === '/external').length;
    await assert.rejects(mainWindow.loadURL(`${baseUrl}/api/redirect`));
    assert.equal(requests.filter((row) => row.path === '/external').length, externalRequests);
    await assert.rejects(mainWindow.loadURL(`${baseUrl}/api/redirect-overlay`));
    const otherWindow = createWindow();
    await otherWindow.loadURL(`${baseUrl}/gift-export`);
    await otherWindow.webContents.executeJavaScript("fetch('/api/export-window').then(()=>null)");
    const loginWindow = createWindow('synthetic-login-isolated');
    await loginWindow.loadURL(`${baseUrl}/login`);
    await loginWindow.webContents.executeJavaScript("fetch('/api/login-window').then(()=>null)");
    await mainWindow.loadURL(`${baseUrl}/license`);
    await mainWindow.webContents.executeJavaScript("fetch('/api/license-page').then(()=>null)");
    await mainWindow.loadURL(`${baseUrl}/admin?restored=1`);
    await mainWindow.loadURL(`${baseUrl}/admin?reload=1`);
    await mainWindow.webContents.executeJavaScript("fetch('/api/reloaded').then(()=>null)");
    await waitFor(() => requests.some((row) => row.path === '/api/beacon'));
    assert.ok(requests.some((row) => row.path === '/report' && row.isolated));
    for (const route of ['/api/main', '/api/media', '/api/beacon', '/ws', '/api/reloaded'])
      assert.ok(
        requests.some((row) => row.path === route && row.management),
        route,
      );
    for (const route of [
      '/clock',
      '/external',
      '/api/iframe',
      '/api/export-window',
      '/api/login-window',
      '/api/license-page',
    ]) {
      const rows = requests.filter((row) => row.path === route);
      assert.ok(rows.length, route);
      assert.equal(
        rows.some((row) => row.management),
        false,
        route,
      );
    }
    assert.ok(requests.some((row) => row.path === '/api/iframe' && row.scoped && row.origin === 'null'));
    assert.equal(requests.filter((row) => row.path === '/admin' && row.management).length, 3);
    auth.dispose();
    await mainWindow.webContents.executeJavaScript("fetch('/api/disposed').then(()=>null)");
    assert.equal(requests.find((row) => row.path === '/api/disposed').management, false);
    await require('./desktop-overlay-probe.cjs')({ directory, createWindow, servers, waitFor });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: true, requests }));
  })
  .catch((error) => {
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: false, error: error.stack, requests }));
    process.exitCode = 1;
  })
  .finally(() => {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
    app.exit(process.exitCode || 0);
  });

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session, safeStorage } = require('electron');
const { createDoubaoSession } = require('../../src/electron/doubao-session');
const { createDoubaoClient } = require('../../src/ai/doubao-client');
const directory = path.resolve(process.argv[2]);
if (path.dirname(directory) !== path.resolve(__dirname, '../../tmp')) throw new Error('Expected isolated tmp directory.');
fs.mkdirSync(directory, { recursive: true });
for (const key of ['userData', 'sessionData']) app.setPath(key, directory);
app.setPath('crashDumps', path.join(directory, 'crashes'));
let owner;
// Exercise the real session and renderer without showing or focusing test windows.
function TestWindow(options) {
  const window = new BrowserWindow({ ...options, show: false });
  window.show = () => {};
  window.focus = () => {};
  return window;
}
app.on('before-quit', () => owner?.dispose());
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const state = { requests: [], logs: [], slow: false, verification: false, omitAck: false, incomplete: false, reuseSection: false, wrongConversation: false, result: null };
  session.fromPartition(process.argv[3] === 'no-encryption' ? 'lira-doubao' : 'persist:lira-doubao').protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://www.doubao.com') return new Response('unexpected origin', { status: 403 });
    if (url.pathname === '/chat/completion') {
      const payload = await request.json();
      state.requests.push(payload);
      if (state.slow) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: SSE_HEARTBEAT\ndata: {}\n\n')); } }));
      const meta = {
        conversation_id: state.wrongConversation ? '999999' : payload.client_meta.conversation_id || String(1000 + state.requests.length),
        section_id: state.reuseSection ? payload.client_meta.last_section_id : String(2000 + state.requests.length),
      };
      const ack = state.omitAck ? '' : `event: SSE_ACK\ndata: ${JSON.stringify({ ack_client_meta: meta })}\n\n`;
      const end = state.incomplete ? '' : 'event: SSE_REPLY_END\ndata: {"end_type":1}\n\n';
      const body = state.verification ? 'event: STREAM_ERROR\ndata: {"error_code":710022004}\n\n' :
        `${ack}event: CHUNK_DELTA\ndata: {"text":"连接成功"}\n\n${end}`;
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>豆包登录测试</title></head><body>
      <button id="scan" onclick="document.cookie='sessionid=synthetic-doubao-session; path=/; secure; max-age=3600'; this.textContent='已扫码';">模拟手机扫码确认</button>
      <a id="external" href="https://unexpected.invalid/">外部链接</a></body></html>`, { headers: { 'Content-Type': 'text/html' } });
  });
  const dependencies = { BrowserWindow: TestWindow, session, safeStorage: process.argv[3] === 'no-encryption' ? { isEncryptionAvailable: () => false } : safeStorage, dataDir: directory };
  owner = createDoubaoSession(dependencies);
  const client = createDoubaoClient({ session: owner, logEvent: entry => state.logs.push(entry) });
  global.doubaoTest = {
    owner, state, client,
    async restoreSnapshot() {
      owner.dispose();
      await owner.whenIdle();
      await session.fromPartition('persist:lira-doubao').clearStorageData();
      owner = createDoubaoSession(dependencies);
      global.doubaoTest.owner = owner;
      await owner.initialize();
      return owner.getStatus();
    },
    startRequest() {
      state.result = null;
      client.createResponse({ config: { requestTimeoutMs: 10000 }, input: '合成测试' })
        .then(result => { state.result = result; }, error => { state.result = { error: error.code }; });
    },
  };
  await owner.initialize();
  await owner.openLogin();
}).catch(() => app.exit(1));

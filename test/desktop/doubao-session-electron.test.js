'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

async function setup(t, mode = '') {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'doubao-session-'));
  const app = await launchElectron({ cwd: path.resolve(__dirname, '../..'), args: ['test/fixtures/doubao-session.cjs', directory, mode], timeout: 15000 });
  t.after(async () => {
    await app.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await page.waitForURL('https://www.doubao.com/chat/');
  return { app, page, directory };
}

test('Doubao isolates login, encrypts cookies, pauses verification and cancels logout work', { timeout: 40000 }, async t => {
  const { app, page, directory } = await setup(t);
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox, preload: p.preload };
  });
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.ok(!preferences.preload);
  await page.locator('#scan').click();
  await waitFor(async () => app.evaluate(() => global.doubaoTest.owner.getStatus().loggedIn));
  const snapshot = path.join(directory, 'doubao-auth/cookies.enc');
  await waitFor(async () => fs.access(snapshot).then(() => true, () => false));
  assert.equal((await fs.readFile(snapshot)).includes(Buffer.from('synthetic-doubao-session')), false);
  const reply = await app.evaluate(() => global.doubaoTest.client.testConnection({ requestTimeoutMs: 5000 }));
  assert.equal(reply.reply, '连接成功');
  const firstTextMs = await app.evaluate(() => global.doubaoTest.state.logs[0].firstTextMs);
  assert.ok(Number.isFinite(firstTextMs) && firstTextMs >= 0, 'first-text timing crosses the isolated page and main process without exposing content');
  await app.evaluate(() => { global.doubaoTest.state.verification = true; global.doubaoTest.startRequest(); });
  await waitFor(async () => app.evaluate(() => global.doubaoTest.state.result?.error === 'DOUBAO_VERIFICATION_REQUIRED'));
  assert.equal(await app.evaluate(() => global.doubaoTest.owner.getStatus().needsVerification), true);
  const count = await app.evaluate(() => global.doubaoTest.state.requests.length);
  await app.evaluate(() => global.doubaoTest.startRequest());
  await waitFor(async () => app.evaluate(() => Boolean(global.doubaoTest.state.result)));
  assert.equal(await app.evaluate(() => global.doubaoTest.state.requests.length), count);
  await app.evaluate(() => { global.doubaoTest.state.verification = false; });
  assert.equal((await app.evaluate(() => global.doubaoTest.client.testConnection({ requestTimeoutMs: 5000 }))).reply, '连接成功');
  const recovery = await app.evaluate(() => global.doubaoTest.state.requests.at(-1));
  assert.equal(recovery.client_meta.conversation_id, '1001', 'verification must not create another conversation');
  assert.equal(recovery.option.click_clear_context, true);
  await app.evaluate(() => { global.doubaoTest.state.slow = true; global.doubaoTest.startRequest(); });
  await waitFor(async () => app.evaluate((_electron, expected) => global.doubaoTest.state.requests.length > expected, count + 1));
  await page.locator('#external').click({ noWaitAfter: true });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()), 'https://www.doubao.com/chat/');
  const state = await app.evaluate(() => global.doubaoTest.owner.logout());
  assert.equal(state.loggedIn, false);
  assert.equal(state.needsVerification, false);
  assert.equal(await app.evaluate(() => global.doubaoTest.state.result?.error), 'DOUBAO_SESSION_CHANGED');
  assert.equal(await fs.access(snapshot).then(() => true, () => false), false);
  assert.equal(await app.evaluate(({ session }) => session.fromPartition('persist:lira-doubao').cookies.get({ url: 'https://www.doubao.com' }).then(cookies => cookies.length)), 0);
});

test('Doubao never writes a plaintext snapshot when system encryption is unavailable', { timeout: 25000 }, async t => {
  const { app, page, directory } = await setup(t, 'no-encryption');
  await page.locator('#scan').click();
  await waitFor(async () => app.evaluate(() => global.doubaoTest.owner.getStatus().loggedIn));
  await app.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 800)); await global.doubaoTest.owner.whenIdle(); });
  const status = await app.evaluate(() => global.doubaoTest.owner.getStatus());
  assert.equal(status.encryptionAvailable, false);
  assert.equal(await app.evaluate(({ session }) => session.fromPartition('lira-doubao').isPersistent()), false);
  assert.deepEqual(Object.keys(status).sort(), ['available', 'encryptionAvailable', 'loggedIn', 'needsVerification']);
  assert.equal(await fs.access(path.join(directory, 'doubao-auth/cookies.enc')).then(() => true, () => false), false);
});

test('Doubao restores encrypted login and removes the saved snapshot when the website logs out', { timeout: 25000 }, async t => {
  const { app, page, directory } = await setup(t);
  await page.locator('#scan').click();
  const snapshot = path.join(directory, 'doubao-auth/cookies.enc');
  await waitFor(async () => fs.access(snapshot).then(() => true, () => false));
  const previousRevision = await app.evaluate(() => global.doubaoTest.owner.getSessionRevision());
  assert.equal((await app.evaluate(() => global.doubaoTest.restoreSnapshot())).loggedIn, true);
  assert.notEqual(await app.evaluate(() => global.doubaoTest.owner.getSessionRevision()), previousRevision, 'recreated owners cannot reuse old account reply caches');
  await app.evaluate(({ session }) => session.fromPartition('persist:lira-doubao').cookies.remove('https://www.doubao.com/', 'sessionid'));
  await waitFor(async () => app.evaluate(() => !global.doubaoTest.owner.getStatus().loggedIn));
  assert.equal(await fs.access(snapshot).then(() => true, () => false), false);
});

test('Doubao serializes first creation and reuses one conversation for chat and connection tests', { timeout: 25000 }, async t => {
  const { app, page } = await setup(t);
  await page.locator('#scan').click();
  await waitFor(async () => app.evaluate(() => global.doubaoTest.owner.getStatus().loggedIn));
  const requests = await app.evaluate(async () => {
    const { client, state } = global.doubaoTest;
    await Promise.all([1, 2, 3].map(index => client.createResponse({ config: {}, purpose: 'generation', input: `合成问题 ${index}` })));
    await client.testConnection({});
    return state.requests;
  });
  assert.equal(requests.filter(request => request.option.need_create_conversation).length, 1);
  assert.equal(requests[0].option.click_clear_context, false);
  assert.equal(requests[0].client_meta.conversation_id, '');
  for (let index = 1; index < requests.length; index++) {
    const next = requests[index];
    assert.equal(next.option.need_create_conversation, false);
    assert.equal(next.option.click_clear_context, true);
    assert.equal(next.client_meta.conversation_id, '1001');
    assert.equal(next.client_meta.last_section_id, String(2000 + index));
    assert.equal(next.client_meta.local_conversation_id, '');
  }
  await page.evaluate(() => { document.cookie = 'sessionid=synthetic-other-account; path=/; secure; max-age=3600'; });
  await app.evaluate(() => global.doubaoTest.owner.whenIdle());
  await app.evaluate(() => global.doubaoTest.client.testConnection({}));
  assert.equal(await app.evaluate(() => global.doubaoTest.state.requests.at(-1).option.need_create_conversation), true);
});

for (const failure of ['omitAck', 'reuseSection', 'wrongConversation']) {
  test(`Doubao stops reuse instead of creating more conversations when ${failure}`, { timeout: 25000 }, async t => {
    const { app, page } = await setup(t);
    await page.locator('#scan').click();
    await waitFor(async () => app.evaluate(() => global.doubaoTest.owner.getStatus().loggedIn));
    const result = await app.evaluate(async (_electron, failure) => {
      const { client, state } = global.doubaoTest;
      await client.testConnection({});
      state[failure] = true;
      const errors = [];
      for (let index = 0; index < 2; index++) {
        try { await client.testConnection({}); } catch (error) { errors.push(error.code); }
      }
      return { errors, count: state.requests.length };
    }, failure);
    assert.deepEqual(result, { errors: ['DOUBAO_CONTEXT_UNCONFIRMED', 'DOUBAO_CONTEXT_UNCONFIRMED'], count: 2 });
  });
}

for (const omitAck of [false, true]) {
  test(`Doubao resumes an incomplete reply only with a confirmed context (missing ACK: ${omitAck})`, { timeout: 25000 }, async t => {
    const { app, page } = await setup(t);
    await page.locator('#scan').click();
    await waitFor(async () => app.evaluate(() => global.doubaoTest.owner.getStatus().loggedIn));
    const result = await app.evaluate(async (_electron, omitAck) => {
      const { client, state } = global.doubaoTest;
      await client.testConnection({});
      const errors = [];
      state.incomplete = true;
      state.omitAck = omitAck;
      try { await client.testConnection({}); } catch (error) { errors.push(error.code); }
      state.incomplete = false;
      state.omitAck = false;
      try { await client.testConnection({}); } catch (error) { errors.push(error.code); }
      return { errors, requests: state.requests };
    }, omitAck);
    assert.deepEqual(result.errors, omitAck ? ['DOUBAO_EMPTY_REPLY', 'DOUBAO_CONTEXT_UNCONFIRMED'] : ['DOUBAO_EMPTY_REPLY']);
    assert.equal(result.requests.length, omitAck ? 2 : 3);
    if (!omitAck) {
      assert.equal(result.requests[2].client_meta.conversation_id, '1001');
      assert.equal(result.requests[2].client_meta.last_section_id, '2002', 'continue from the latest acknowledged section, even if its text was incomplete');
    }
  });
}

test('Doubao allows a manual retry after an explicit first-call verification rejection but stops unknown context', { timeout: 25000 }, async t => {
  const { app, page } = await setup(t);
  await page.locator('#scan').click();
  await waitFor(async () => app.evaluate(() => global.doubaoTest.owner.getStatus().loggedIn));
  const result = await app.evaluate(async () => {
    const { client, state } = global.doubaoTest;
    const errors = [];
    state.verification = true;
    try { await client.testConnection({}); } catch (error) { errors.push(error.code); }
    state.verification = false;
    const recovered = await client.testConnection({});
    state.omitAck = true;
    for (let index = 0; index < 2; index++) {
      try { await client.createResponse({ config: {}, purpose: 'generation', input: '合成问题' }); } catch (error) { errors.push(error.code); }
    }
    return { errors, count: state.requests.length, recovered: recovered.reply };
  });
  assert.deepEqual(result, { errors: ['DOUBAO_VERIFICATION_REQUIRED', 'DOUBAO_CONTEXT_UNCONFIRMED', 'DOUBAO_CONTEXT_UNCONFIRMED'], count: 3, recovered: '连接成功' });
});

async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for Doubao test state');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

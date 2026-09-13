'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const { serveOpeningCharacter } = require('../src/server/http-utils');
const { handleApi } = require('../src/server/api-routes');
const openingRoutes = require('../src/server/routes/opening-routes');

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
    assert.equal(responsePayload.data.hasUploadedAudio, true);
    await openingRoutes.routes['DELETE /api/opening/music'](
      context,
      {},
      response,
    );
    assert.equal(responsePayload.data.audioUrl, '');
    assert.equal(responsePayload.data.audioName, '');
    assert.equal(responsePayload.data.hasUploadedAudio, false);
    assert.ok(
      fs.existsSync(path.join(openingRoutes.getMusicDir(dataDir), files[0])),
    );
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
    await openingRoutes.routes['DELETE /api/opening/character'](
      context,
      {},
      uploaded.response,
    );
    assert.equal(uploaded.payload.data.characterUrl, '');
    assert.equal(uploaded.payload.data.characterName, '');
    assert.equal(uploaded.payload.data.hasUploadedCharacter, false);
    assert.ok(
      fs.existsSync(
        path.join(openingRoutes.getCharacterDir(dataDir), files[0]),
      ),
    );
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

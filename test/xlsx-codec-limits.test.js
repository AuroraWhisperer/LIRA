'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  createZip,
  readZipFiles,
  parseSharedStrings,
  parseWorksheetXml,
} = require('../src/shared/xlsx-codec');
const { parseSongsFromXlsx } = require('../src/music/song-file-codec');
const { routes } = require('../src/server/routes/song-routes');
const { sendStableError } = require('../src/server/http-utils');

// Build small real DEFLATE streams; metadata can deliberately understate output.
function zipFixture(entries, { descriptor = false, signature = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text, declaredSize = Buffer.byteLength(text) } of entries) {
    const stored = createZip([[name, text]]);
    const centralOffset = stored.readUInt32LE(stored.length - 6);
    const central = Buffer.from(stored.subarray(centralOffset, stored.length - 22));
    const local = Buffer.from(stored.subarray(0, 30 + Buffer.byteLength(name)));
    const compressed = zlib.deflateRawSync(Buffer.from(text));
    local.writeUInt16LE(descriptor ? 8 : 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(descriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(descriptor ? 0 : declaredSize, 22);
    central.writeUInt16LE(descriptor ? 8 : 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt32LE(offset, 42);
    let trailer = Buffer.alloc(0);
    if (descriptor) {
      trailer = Buffer.alloc(signature ? 16 : 12);
      const base = signature ? 4 : 0;
      if (signature) trailer.writeUInt32LE(0x08074b50, 0);
      trailer.writeUInt32LE(central.readUInt32LE(16), base);
      trailer.writeUInt32LE(compressed.length, base + 4);
      trailer.writeUInt32LE(declaredSize, base + 8);
      local.writeUInt32LE(0, 14);
    }
    locals.push(local, compressed, trailer);
    centrals.push(central);
    offset += local.length + compressed.length + trailer.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.from(createZip([]));
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

test('ZIP enforces actual per-entry inflate limits despite forged small sizes', (t) => {
  const inflate = t.mock.method(zlib, 'inflateRawSync');
  const zip = zipFixture([{ name: 'sheet.xml', text: 'x'.repeat(4096), declaredSize: 1 }]);
  assert.ok(zip.length < 200);
  assert.throws(() => readZipFiles(zip, { limits: { entryBytes: 64 } }), /Excel/);
  assert.equal(inflate.mock.calls[0].arguments[1].maxOutputLength, 64);
});

test('ZIP enforces cumulative output while inflating the next entry', (t) => {
  const inflate = t.mock.method(zlib, 'inflateRawSync');
  const zip = zipFixture([
    { name: 'a', text: 'a'.repeat(64) },
    { name: 'b', text: 'b'.repeat(64), declaredSize: 1 },
  ]);
  assert.throws(() => readZipFiles(zip, {
    limits: { entryBytes: 64, totalBytes: 96 },
  }), /Excel/);
  assert.deepEqual(inflate.mock.calls.map((call) => call.arguments[1].maxOutputLength), [64, 32]);
});

test('ZIP accepts exact byte budgets, including UTF-8, STORE and DEFLATE', () => {
  for (const zip of [
    createZip([['a', '中文'], ['b', 'xy']]),
    zipFixture([{ name: 'a', text: '中文' }, { name: 'b', text: 'xy' }]),
  ]) {
    assert.deepEqual([...readZipFiles(zip, {
      limits: { entryBytes: 6, totalBytes: 8 },
    })], [['a', '中文'], ['b', 'xy']]);
    assert.throws(() => readZipFiles(zip, { limits: { entryBytes: 5 } }), /Excel/);
    assert.throws(() => readZipFiles(zip, { limits: { totalBytes: 7 } }), /Excel/);
  }
});

test('ZIP supports data descriptors with and without a signature and EOCD comments', () => {
  for (const signature of [true, false]) {
    const zip = zipFixture([{ name: 'a', text: '中文' }], { descriptor: true, signature });
    const comment = Buffer.from('PK\x05\x06 comment');
    zip.writeUInt16LE(comment.length, zip.length - 2);
    assert.equal(readZipFiles(Buffer.concat([zip, comment])).get('a'), '中文');
  }
});

test('ZIP rejects understated output and corrupt data descriptors, including local metadata', () => {
  assert.throws(() => readZipFiles(zipFixture([{ name: 'a', text: 'xx', declaredSize: 1 }])), /Excel/);
  for (const corrupt of [
    (zip) => zip.writeUInt32LE(100, 22),
    (zip) => zip.writeUInt32LE(100, zip.readUInt32LE(zip.length - 6) - 4),
  ]) {
    const zip = zipFixture([{ name: 'a', text: 'xx' }], { descriptor: true });
    corrupt(zip);
    assert.throws(() => readZipFiles(zip), /Excel/);
  }
  assert.equal(readZipFiles(zipFixture([
    { name: 'a', text: 'x' }, { name: 'empty', text: '' },
  ]), { limits: { entryBytes: 1, totalBytes: 1 } }).get('empty'), '');
});

test('ZIP validates directory, local headers and data before reading entries', async (t) => {
  const cases = {
    'central offset past EOF': (zip, end) => zip.writeUInt32LE(zip.length + 1, end + 16),
    'central size mismatch': (zip, end) => zip.writeUInt32LE(1, end + 12),
    'entry count mismatch': (zip, end) => zip.writeUInt16LE(2, end + 10),
    'multi-disk archive': (zip, end) => zip.writeUInt16LE(1, end + 4),
    'truncated central header': (zip, end) => zip.writeUInt32LE(end - 2, end + 16),
    'central name outside directory': (zip, end, central) => zip.writeUInt16LE(65535, central + 28),
    'local offset past EOF': (zip, end, central) => zip.writeUInt32LE(zip.length, central + 42),
    'local offset inside directory': (zip, end, central) => zip.writeUInt32LE(central, central + 42),
    'local name mismatch': (zip) => { zip[30] = 98; },
    'local method mismatch': (zip) => zip.writeUInt16LE(8, 8),
    'local extra outside data': (zip) => zip.writeUInt16LE(65535, 28),
    'entry data outside archive': (zip, end, central) => zip.writeUInt32LE(zip.length, central + 20),
    'claimed output mismatch': (zip, end, central) => {
      zip.writeUInt32LE(1, 22);
      zip.writeUInt32LE(1, central + 24);
    },
    'corrupt payload checksum': (zip) => { zip[31] ^= 1; },
    'EOCD comment length mismatch': (zip, end) => zip.writeUInt16LE(1, end + 20),
  };
  for (const [name, corrupt] of Object.entries(cases)) {
    await t.test(name, () => {
      const zip = createZip([['a', 'hello']]);
      const end = zip.length - 22;
      corrupt(zip, end, zip.readUInt32LE(end + 16));
      assert.throws(() => readZipFiles(zip), /Excel/);
    });
  }
});

test('ZIP rejects duplicate entries and overlapping local records', () => {
  assert.throws(() => readZipFiles(createZip([['a', 'x'], ['a', 'x']])), /Excel/);
  const zip = createZip([['a', 'x'], ['b', 'x']]);
  const central = zip.readUInt32LE(zip.length - 6);
  // Make the first stored payload include the second local header and payload.
  const size = central - 31;
  const crc = zlib.crc32(zip.subarray(31, central));
  zip.writeUInt32LE(crc, 14);
  zip.writeUInt32LE(size, 18);
  zip.writeUInt32LE(size, 22);
  zip.writeUInt32LE(crc, central + 16);
  zip.writeUInt32LE(size, central + 20);
  zip.writeUInt32LE(size, central + 24);
  assert.throws(() => readZipFiles(zip), /Excel/);
});

test('ZIP checks entry count before parsing and callers may only tighten limits', () => {
  const zip = createZip([['a', 'x'], ['b', 'x']]);
  assert.equal(readZipFiles(zip, { limits: { zipEntries: 2 } }).size, 2);
  assert.throws(() => readZipFiles(zip, { limits: { zipEntries: 1 } }), /Excel/);
  for (const entryBytes of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => readZipFiles(zip, { limits: { entryBytes } }));
  }
});

test('song import inflates only its first worksheet and shared strings', (t) => {
  const inflate = t.mock.method(zlib, 'inflateRawSync');
  const zip = zipFixture([
    { name: 'xl/media/image1.png', text: 'unread', declaredSize: 64 * 1024 * 1024 },
    { name: 'xl/worksheets/sheet2.xml', text: '<row><c t="s"><v>0</v></c></row>' },
    { name: 'xl/worksheets/sheet1.xml', text: 'unread', declaredSize: 64 * 1024 * 1024 },
    { name: 'xl/sharedStrings.xml', text: '<sst><si><t>中文</t></si></sst>' },
  ]);
  assert.equal(parseSongsFromXlsx(zip)[0]['歌曲名字'], '中文');
  assert.equal(inflate.mock.callCount(), 2);
});

test('ZIP validates every directory entry before inflating even a valid first entry', (t) => {
  const inflate = t.mock.method(zlib, 'inflateRawSync');
  const zip = zipFixture([{ name: 'a', text: 'valid' }, { name: 'b', text: 'invalid' }]);
  const central = zip.readUInt32LE(zip.length - 6);
  zip.writeUInt32LE(zip.length + 1, central + 47 + 42);
  assert.throws(() => readZipFiles(zip), /Excel/);
  assert.equal(inflate.mock.callCount(), 0);
});

test('ZIP rejects unsupported encryption, compression and ZIP64 sizes on selected entries', () => {
  for (const mode of ['encryption', 'method', 'ZIP64']) {
    const zip = createZip([['a', 'x']]);
    const central = zip.readUInt32LE(zip.length - 6);
    if (mode === 'encryption') {
      zip.writeUInt16LE(1, 6);
      zip.writeUInt16LE(1, central + 8);
    } else if (mode === 'method') {
      zip.writeUInt16LE(9, 8);
      zip.writeUInt16LE(9, central + 10);
    } else {
      zip.writeUInt32LE(0xffffffff, 22);
      zip.writeUInt32LE(0xffffffff, central + 24);
    }
    assert.throws(() => readZipFiles(zip), /Excel/);
  }
});

test('worksheet checks sparse columns and implicit columns before growing arrays', () => {
  assert.equal(parseWorksheetXml('<row><c r="XFD1"><v>边界</v></c></row>', [])[0].length, 16384);
  for (const ref of ['XFE1', 'ZZZZ1', 'A0', 'A1048577', 'A1B', '-A1']) {
    assert.throws(() => parseWorksheetXml(`<row><c r="${ref}"><v>1</v></c></row>`, []), /Excel/);
  }
  assert.throws(() => parseWorksheetXml('<row><c/><c/><c/></row>', [], { columns: 2 }), /Excel/);
});

test('worksheet counts empty rows, duplicate/empty cells and aggregate sparse row width', () => {
  assert.equal(parseWorksheetXml('<row/><row><c><v>1</v></c></row>', [], { rows: 2 }).length, 1);
  assert.throws(() => parseWorksheetXml('<row/><row/><row/>', [], { rows: 2 }), /Excel/);
  assert.throws(() => parseWorksheetXml('<row><c r="A1"/><c r="A1"/><c r="A1"/></row>', [], { cells: 2 }), /Excel/);
  const rows = '<row><c r="C1"><v>1</v></c></row><row><c r="C2"><v>2</v></c></row>';
  assert.equal(parseWorksheetXml(rows, [], { cells: 6 }).length, 2);
  assert.throws(() => parseWorksheetXml(rows, [], { cells: 5 }), /Excel/);
});

test('shared strings and expanded worksheet text obey count and text budgets', () => {
  assert.deepEqual(parseSharedStrings('<si/><si><r><t>中</t></r><r><t>文</t></r></si>', { sharedStrings: 2, textChars: 2 }), ['', '中文']);
  assert.throws(() => parseSharedStrings('<si/><si/><si/>', { sharedStrings: 2 }), /Excel/);
  assert.throws(() => parseSharedStrings('<si><t>中文文</t></si>', { textChars: 2 }), /Excel/);
  const xml = '<row><c t="s"><v>0</v></c><c t="s"><v>0</v></c></row>';
  assert.equal(parseWorksheetXml(xml, ['中文'], { totalTextChars: 4 })[0][1], '中文');
  assert.throws(() => parseWorksheetXml(xml, ['中文'], { totalTextChars: 3 }), /Excel/);
  assert.throws(() => parseWorksheetXml('<row><c t="inlineStr"><is><t>123</t></is></c></row>', [], { textChars: 2 }), /Excel/);
  const sharedXml = '<si><t>中文</t></si>';
  assert.deepEqual(parseSharedStrings(sharedXml, { entryBytes: Buffer.byteLength(sharedXml) }), ['中文']);
  assert.throws(() => parseSharedStrings(sharedXml, { entryBytes: Buffer.byteLength(sharedXml) - 1 }), /Excel/);
  assert.deepEqual(parseSharedStrings('<si><t>&#x1F600;</t></si>', { textChars: 2 }), ['😀']);
  assert.throws(() => parseSharedStrings('<si><t>&#x1F600;</t></si>', { textChars: 1 }), /Excel/);
});

test('song import keeps namespaced shared strings, rich text, inline strings and empty cells aligned', () => {
  const zip = zipFixture([
    { name: 'xl/sharedStrings.xml', text: '<x:sst xmlns:x="urn:test"><x:si><x:t>歌曲名字</x:t></x:si><x:si/><x:si><x:r><x:t>中文</x:t></x:r><x:r><x:t>&amp;&#x1F600;</x:t></x:r></x:si></x:sst>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<x:worksheet xmlns:x="urn:test"><x:sheetData>' +
      '<x:row><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>原唱</x:t></x:is></x:c><x:c r="C1" t="str"><x:v>核对备注</x:v></x:c><x:c r="D1" t="str"><x:v>是否可点</x:v></x:c></x:row>' +
      '<x:row><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="B2" t="s"><x:v>1</x:v></x:c><x:c r="C2" t="inlineStr"><x:is><x:t>含&lt;标记&gt;与&#10;换行</x:t></x:is></x:c><x:c r="D2" t="b"><x:v>0</x:v></x:c></x:row>' +
      '<x:row/><x:row><x:c r="A4" t="str"><x:v>=1+1</x:v></x:c><x:c r="B4"/></x:row></x:sheetData></x:worksheet>' },
  ]);
  const rows = parseSongsFromXlsx(zip);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['歌曲名字'], '中文&😀');
  assert.equal(rows[0]['原唱'], '');
  assert.equal(rows[0]['核对备注'], '含<标记>与\n换行');
  assert.equal(rows[0]['是否可点'], '否');
  assert.equal(rows[1]['歌曲名字'], '=1+1');
  assert.equal(rows[1]['原唱'], '');
});

test('malformed nested or unclosed XML elements fail with bounded small inputs', () => {
  assert.throws(() => parseWorksheetXml('<row>'.repeat(32), []), /Excel/);
  assert.throws(() => parseWorksheetXml('<row><c><c></c></row>', []), /Excel/);
  assert.throws(() => parseSharedStrings('<si>'.repeat(32)), /Excel/);
  assert.throws(() => parseSharedStrings('<si><t><t></t></si>'), /Excel/);
});

test('failed XLSX import causes no writes, broadcasts or sync and next import works', async () => {
  const effects = [];
  const context = {
    songs: { import(rows) { effects.push(['write', rows]); return { inserted: rows.length }; } },
    broadcastSnapshot(event) { effects.push(['broadcast', event]); },
    cloudSync: { request(scope) { effects.push(['sync', scope]); } },
  };
  const handler = routes['POST /api/songs/import-xlsx'];
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  const invalid = createZip([['xl/worksheets/sheet1.xml', '<row><c><v>valid first</v></c></row><row><c r="XFE2"><v>bad</v></c></row>']]);
  const oversized = zipFixture([{ name: 'xl/worksheets/sheet1.xml', text: 'small', declaredSize: 64 * 1024 * 1024 }]);
  const corrupt = createZip([['xl/worksheets/sheet1.xml', 'small']]);
  corrupt.writeUInt32LE(corrupt.length + 1, corrupt.length - 6);
  for (const [buffer, status] of [[invalid, 413], [oversized, 413], [corrupt, 500]]) {
    let importError;
    await assert.rejects(handler(context, { body: async () => ({ base64: buffer.toString('base64') }) }, response), (error) => {
      importError = error;
      return /Excel/.test(error.message);
    });
    assert.deepEqual(effects, []);
    sendStableError(response, importError);
    assert.equal(response.body.ok, false);
    assert.equal(response.status, status);
  }
  const valid = createZip([['xl/worksheets/sheet1.xml', '<row><c><v>恢复导入</v></c></row>']]);
  await handler(context, { body: async () => ({ base64: valid.toString('base64') }) }, response);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.inserted, 1);
  assert.deepEqual(effects.map(([kind]) => kind), ['write', 'broadcast', 'sync']);
});

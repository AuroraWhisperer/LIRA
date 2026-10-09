'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { receiveMedia } = require('./component-media-files');
const { webFilePath } = require('./component-web-files');

const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_FILES = 8192;
const MANIFEST = 'lira-library-backup.json';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const PACKAGE_FILE = new RegExp(`^packages/(${UUID})/([a-f0-9]{64}\\.(png|jpg|gif|webp|mp4|webm|svg|woff2)|web/(.+))$`);
const IMAGE_FILE = new RegExp(`^images/(${UUID}\\.(png|jpg|gif|webp))$`);
const invalidBackup = (message = '备份文件无效或不完整，请重新导出。') => Object.assign(new Error(message), { statusCode: 400 });

function backupFileName(name) {
  const match = PACKAGE_FILE.exec(name);
  if (match?.[4]) webFilePath(match[4]);
  if (!match && !IMAGE_FILE.test(name)) throw invalidBackup('备份包含不支持的文件路径。');
  return name;
}

async function* encodeBackup(files, manifest, authorize) {
  const central = []; let offset = 0; let count = 0;
  const descriptions = [];
  const sources = [...files, { name: MANIFEST, manifest: true }];
  for (const source of sources) {
    authorize();
    const filename = Buffer.from(source.name);
    const start = offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x808, 6);
    header.writeUInt16LE(33, 12); header.writeUInt16LE(filename.length, 26);
    yield header; yield filename; offset += header.length + filename.length;
    const hash = createHash('sha256'); let checksum = 0; let bytes = 0;
    const content = source.manifest ? [Buffer.from(JSON.stringify({ ...manifest, files: descriptions }))] : fs.createReadStream(source.file);
    for await (const chunk of content) {
      authorize(); checksum = crc32(chunk, checksum); hash.update(chunk); bytes += chunk.length; offset += chunk.length;
      if (offset > MAX_BACKUP_BYTES || source.manifest && bytes > 16 * 1024 * 1024) throw invalidBackup('备份超过 2 GiB 或清单过大，请减少素材后重试。');
      yield chunk;
    }
    if (!source.manifest) descriptions.push({ name: source.name, bytes, sha256: hash.digest('hex') });
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum, 4); descriptor.writeUInt32LE(bytes, 8); descriptor.writeUInt32LE(bytes, 12);
    yield descriptor; offset += descriptor.length;
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(bytes, 20); entry.writeUInt32LE(bytes, 24); entry.writeUInt32LE(start, 42);
    central.push(entry, filename); count++;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  if (offset + directory.length + end.length > MAX_BACKUP_BYTES) throw invalidBackup('备份超过 2 GiB，请减少素材后重试。');
  yield directory; yield end;
}

async function extractBackup(filename, directory, authorize) {
  const zip = await yauzl.openPromise(filename, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const files = []; const names = new Set(); let manifest; let total = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      authorize();
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (names.has(name.toLowerCase()) || names.size >= MAX_BACKUP_FILES || entry.isEncrypted()
        || mode && mode !== 0x8000 || (total += entry.uncompressedSize) > MAX_BACKUP_BYTES
        || entry.uncompressedSize > 512 * 1024 * 1024) throw invalidBackup();
      names.add(name.toLowerCase());
      if (name !== MANIFEST) backupFileName(name);
      if (name === MANIFEST && entry.uncompressedSize > 16 * 1024 * 1024) throw invalidBackup();
      let checksum = 0;
      async function* chunks() {
        for await (const chunk of await zip.openReadStreamPromise(entry)) {
          authorize(); checksum = crc32(chunk, checksum); yield chunk;
        }
        if (checksum !== entry.crc32) throw invalidBackup();
      }
      if (name === MANIFEST) {
        const data = [];
        for await (const chunk of chunks()) data.push(chunk);
        manifest = JSON.parse(Buffer.concat(data).toString('utf8'));
      } else {
        const target = path.join(directory, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const result = entry.uncompressedSize ? await receiveMedia(Readable.from(chunks()), target)
          : { size: 0, digest: createHash('sha256').digest('hex') };
        if (!entry.uncompressedSize) {
          for await (const _chunk of chunks()) throw invalidBackup();
          fs.writeFileSync(target, '', { flag: 'wx', mode: 0o600 });
        }
        files.push({ name, bytes: result.size, sha256: result.digest });
      }
    }
    return { manifest, files };
  } finally { zip.close(); }
}

module.exports = { MAX_BACKUP_BYTES, MAX_BACKUP_FILES, MANIFEST, invalidBackup, backupFileName, encodeBackup, extractBackup };

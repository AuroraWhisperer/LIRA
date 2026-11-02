'use strict';

const yauzl = require('yauzl');
const { writeResource } = require('./resource-download');

async function extractResourcePackage(filename, resource, { directory, signal }) {
  const members = new Map(resource.members.map(file => [file.path, file]));
  const needed = new Map(resource.files.map(file => [file.path, file]));
  const seen = new Set();
  const zip = await yauzl.openPromise(filename, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      const file = members.get(entry.fileName);
      if (!file || seen.has(entry.fileName) || entry.isEncrypted() || entry.uncompressedSize !== file.size)
        throw new Error('RESOURCE_ARCHIVE_INVALID');
      seen.add(entry.fileName);
      if (needed.has(entry.fileName))
        await writeResource(file, await zip.openReadStreamPromise(entry), { directory, signal });
    }
    if (seen.size !== members.size) throw new Error('RESOURCE_ARCHIVE_INVALID');
  } finally { zip.close(); }
}

module.exports = { extractResourcePackage };

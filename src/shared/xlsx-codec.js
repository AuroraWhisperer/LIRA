'use strict';

const zlib = require('node:zlib');
const { cleanText } = require('./utils');

// Import budgets, independent of ZIP metadata. Optional limits only tighten them.
const XLSX_LIMITS = Object.freeze({
  zipEntries: 1024,
  entryBytes: 32 * 1024 * 1024,
  totalBytes: 48 * 1024 * 1024,
  rows: 50001,
  columns: 16384,
  cells: 1000000,
  sharedStrings: 200000,
  textChars: 32767,
  totalTextChars: 32 * 1024 * 1024,
});

function resourceLimit(limits, name) {
  const limit = limits[name] ?? XLSX_LIMITS[name];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > XLSX_LIMITS[name]) {
    throw new Error(`Excel 资源限额无效：${name}`);
  }
  return limit;
}

function checkBudget(size, limit, name) {
  if (size > limit) {
    // Reuse the existing HTTP oversized-input error mapping (413).
    throw new Error(`Excel file is too large (${name}). Please split the workbook before importing.`);
  }
}

function checkZip(condition) {
  if (!condition) throw new Error('Excel 文件 ZIP 目录、条目或数据损坏。');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => decodeXmlCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      decodeXmlCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}

function decodeXmlCodePoint(codePoint) {
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '';
}

function getXmlAttr(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? unescapeXml(match[1]) : '';
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function columnNameToIndex(name) {
  let value = 0;
  for (const char of String(name || '').toUpperCase()) {
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateValue) {
  const year = Math.max(1980, dateValue.getFullYear());
  return {
    time:
      (dateValue.getHours() << 11) |
      (dateValue.getMinutes() << 5) |
      Math.floor(dateValue.getSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((dateValue.getMonth() + 1) << 5) |
      dateValue.getDate(),
  };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const [filename, content] of files) {
    const name = Buffer.from(filename, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(0, 34);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += 30 + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

function readZipEntries(buffer, maxEntries) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error('Excel 文件不是有效的 .xlsx 格式。');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  checkZip(
    buffer.readUInt16LE(eocdOffset + 4) === 0 &&
    buffer.readUInt16LE(eocdOffset + 6) === 0 &&
    buffer.readUInt16LE(eocdOffset + 8) === entryCount &&
    centralOffset + centralSize === eocdOffset,
  );
  checkBudget(entryCount, maxEntries, 'ZIP entries');
  const entries = [];
  const names = new Set();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    checkZip(offset + 46 <= eocdOffset && buffer.readUInt32LE(offset) === 0x02014b50);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    checkZip(
      nextOffset <= eocdOffset && nameLength > 0 &&
      buffer.readUInt16LE(offset + 34) === 0 &&
      compressedSize !== 0xffffffff && size !== 0xffffffff &&
      localOffset + 30 <= centralOffset &&
      buffer.readUInt32LE(localOffset) === 0x04034b50,
    );
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const filename = name.toString('utf8');
    checkZip(!names.has(filename));
    names.add(filename);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    checkZip(
      dataEnd <= centralOffset && localNameLength === nameLength &&
      name.equals(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength)) &&
      flags === buffer.readUInt16LE(localOffset + 6) &&
      method === buffer.readUInt16LE(localOffset + 8),
    );
    let recordEnd = dataEnd;
    if (flags & 8) {
      checkZip(
        [0, crc].includes(buffer.readUInt32LE(localOffset + 14)) &&
        [0, compressedSize].includes(buffer.readUInt32LE(localOffset + 18)) &&
        [0, size].includes(buffer.readUInt32LE(localOffset + 22)),
      );
      checkZip(recordEnd + 12 <= centralOffset);
      if (buffer.readUInt32LE(recordEnd) === 0x08074b50) recordEnd += 4;
      checkZip(
        recordEnd + 12 <= centralOffset &&
        buffer.readUInt32LE(recordEnd) === crc &&
        buffer.readUInt32LE(recordEnd + 4) === compressedSize &&
        buffer.readUInt32LE(recordEnd + 8) === size,
      );
      recordEnd += 12;
    } else {
      checkZip(
        buffer.readUInt32LE(localOffset + 14) === crc &&
        buffer.readUInt32LE(localOffset + 18) === compressedSize &&
        buffer.readUInt32LE(localOffset + 22) === size,
      );
    }
    checkZip(method !== 0 || size === compressedSize);
    entries.push({ filename, flags, method, crc, size, localOffset, dataStart, dataEnd, recordEnd });
    offset = nextOffset;
  }
  checkZip(offset === eocdOffset);
  let previousEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.localOffset - b.localOffset)) {
    checkZip(entry.localOffset >= previousEnd);
    previousEnd = entry.recordEnd;
  }
  return entries;
}

/** Validate all record ranges before allocating decoded data; only expand selected entries. */
function readZipFiles(buffer, { selectEntry = () => true, limits = {} } = {}) {
  const maxEntryBytes = resourceLimit(limits, 'entryBytes');
  const maxTotalBytes = resourceLimit(limits, 'totalBytes');
  const entries = readZipEntries(buffer, resourceLimit(limits, 'zipEntries'))
    .filter((entry) => selectEntry(entry.filename));
  let declaredBytes = 0;
  for (const entry of entries) {
    if ((entry.flags & 0x41) || ![0, 8].includes(entry.method)) {
      throw new Error('Excel 文件使用了不支持的 ZIP 加密或压缩方式。');
    }
    checkBudget(entry.size, maxEntryBytes, 'entry bytes');
    declaredBytes += entry.size;
    checkBudget(declaredBytes, maxTotalBytes, 'total expanded bytes');
  }
  const files = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    const outputBudget = Math.min(maxEntryBytes, maxTotalBytes - totalBytes);
    const compressed = buffer.subarray(entry.dataStart, entry.dataEnd);
    let data = compressed;
    if (entry.method === 8) {
      try {
        const result = zlib.inflateRawSync(compressed, {
          maxOutputLength: Math.max(1, outputBudget),
          info: true,
        });
        checkZip(result.engine.bytesWritten === compressed.length);
        data = result.buffer;
      } catch (error) {
        if (error.code === 'ERR_BUFFER_TOO_LARGE') {
          checkBudget(outputBudget + 1, outputBudget, 'expanded bytes');
        }
        throw new Error('Excel 文件 ZIP 解压失败。', { cause: error });
      }
    }
    checkBudget(data.length, outputBudget, 'expanded bytes');
    checkZip(data.length === entry.size && crc32(data) === entry.crc);
    totalBytes += data.length;
    files.set(entry.filename, data.toString('utf8'));
  }
  return files;
}

function findEndOfCentralDirectory(buffer) {
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65557);
    offset -= 1
  ) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) return offset;
  }
  return -1;
}

// These spreadsheet elements cannot contain another element of the same kind.
// Advance over tags once instead of retrying an unbounded body match at each opener.
function* xmlElements(xml, tag) {
  const regex = new RegExp(`<(/?)(?:[\\w.-]+:)?${tag}\\b([^<>]*?)(/?)>`, 'g');
  let open = null;
  let match;
  while ((match = regex.exec(xml))) {
    if (match[1]) {
      if (!open) throw new Error('Excel 文件 XML 元素未正确闭合。');
      yield { attrs: open.attrs, body: xml.slice(open.start, match.index) };
      open = null;
    } else {
      if (open) throw new Error('Excel 文件 XML 元素存在异常嵌套。');
      if (match[3]) yield { attrs: match[2], body: '' };
      else open = { attrs: match[2], start: regex.lastIndex };
    }
  }
  if (open) throw new Error('Excel 文件 XML 元素未正确闭合。');
}

function checkXmlBudget(xml, limits) {
  checkBudget(Buffer.byteLength(xml, 'utf8'), resourceLimit(limits, 'entryBytes'), 'XML bytes');
}

function parseSharedStrings(xml, limits = {}) {
  checkXmlBudget(xml, limits);
  const maxStrings = resourceLimit(limits, 'sharedStrings');
  const maxTextChars = resourceLimit(limits, 'textChars');
  const values = [];
  for (const element of xmlElements(xml, 'si')) {
    checkBudget(values.length + 1, maxStrings, 'shared strings');
    values.push(extractXmlTexts(element.body, maxTextChars));
  }
  return values;
}

function extractXmlTexts(xml, maxChars) {
  let value = '';
  for (const element of xmlElements(xml, 't')) {
    const text = unescapeXml(element.body);
    checkBudget(value.length + text.length, maxChars, 'cell text');
    value += text;
  }
  return value;
}

function parseWorksheetXml(xml, sharedStrings, limits = {}) {
  checkXmlBudget(xml, limits);
  const maxRows = resourceLimit(limits, 'rows');
  const maxColumns = resourceLimit(limits, 'columns');
  const maxCells = resourceLimit(limits, 'cells');
  const maxTextChars = resourceLimit(limits, 'textChars');
  const maxTotalTextChars = resourceLimit(limits, 'totalTextChars');
  let rowCount = 0;
  let cellCount = 0;
  let rowSlots = 0;
  let textChars = 0;
  const rows = [];
  for (const rowElement of xmlElements(xml, 'row')) {
    checkBudget(++rowCount, maxRows, 'worksheet rows');
    const row = [];
    for (const { attrs, body } of xmlElements(rowElement.body, 'c')) {
      checkBudget(++cellCount, maxCells, 'worksheet cells');
      const ref = getXmlAttr(attrs, 'r');
      let columnIndex = row.length;
      if (ref) {
        const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/i.exec(ref);
        if (!match) throw new Error('Excel 文件单元格引用无效。');
        checkBudget(Number(match[2]), 1048576, 'worksheet row reference');
        columnIndex = columnNameToIndex(match[1]);
      }
      checkBudget(columnIndex + 1, maxColumns, 'worksheet columns');
      const growth = Math.max(0, columnIndex + 1 - row.length);
      checkBudget(rowSlots + growth, maxCells, 'worksheet row slots');
      const value = readWorksheetCell(attrs, body, sharedStrings, maxTextChars);
      checkBudget(value.length, maxTextChars, 'cell text');
      checkBudget(textChars + value.length, maxTotalTextChars, 'expanded worksheet text');
      rowSlots += growth;
      textChars += value.length;
      row[columnIndex] = value;
    }
    if (row.some((cell) => cleanText(cell))) {
      rows.push(row.map((cell) => cell || ''));
    }
  }
  return rows;
}

function readWorksheetCell(attrs, body, sharedStrings, maxTextChars) {
  const type = getXmlAttr(attrs, 't');
  if (type === 'inlineStr') {
    return extractXmlTexts(body, maxTextChars);
  }

  let value = '';
  for (const element of xmlElements(body, 'v')) {
    value = unescapeXml(element.body);
    checkBudget(value.length, maxTextChars, 'cell value');
    break;
  }
  if (type === 's') return sharedStrings[Number(value)] || '';
  if (type === 'b') return value === '1' ? '是' : '否';
  return value;
}

module.exports = {
  columnName,
  createZip,
  escapeXml,
  parseSharedStrings,
  parseWorksheetXml,
  readZipFiles,
};

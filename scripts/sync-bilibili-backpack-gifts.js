'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { parseGiftMappingDocument, readGiftMappings } = require('../src/bilibili/gift/sale-catalog');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const GIFT_DIR = path.join(PUBLIC_DIR, 'img', 'bilibili-gifts');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'img', 'bilibili-gifts.json');
const GIFT_CONFIG_URL = 'https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig?platform=pc&source=live&room_id=1';
const MAPPING_FILES = [
  'gift-mapping-under-100.md',
  'gift-mapping-100-above.md',
  'silver-free-mapping.md'
];

async function main() {
  const gifts = await fetchBackpackGifts();
  const mappingDocuments = readMappingDocuments();
  removeGeneratedSupplementSections(mappingDocuments);
  const exactMappings = indexExactMappings(mappingDocuments);
  const resolvedBefore = resolveMappings(mappingDocuments);
  const downloads = [];
  const localPathById = new Map();
  const requireExactMappingIds = new Set();
  let relocatedCount = 0;

  for (const gift of gifts) {
    if (gift.coinType !== 'gold') continue;
    const existing = resolvedBefore.get(gift.id);
    const expectedPath = `${giftCategory(gift)}/${gift.id}.webp`;
    if (existing?.imagePath && isUsableWebp(path.join(PUBLIC_DIR, existing.imagePath))) {
      const existingPath = existing.imagePath.replace(/^\/img\/bilibili-gifts\//, '');
      const hasOwnImage = path.posix.basename(existingPath) === `${gift.id}.webp`;
      const exactMapping = exactMappings.has(gift.id);
      if (hasOwnImage && existingPath !== expectedPath) {
        relocateImage(existingPath, expectedPath);
        localPathById.set(gift.id, expectedPath);
        relocatedCount += 1;
      } else if (!exactMapping && path.posix.dirname(existingPath) !== giftCategory(gift)) {
        localPathById.set(gift.id, expectedPath);
        downloads.push({ ...gift, relativePath: expectedPath });
        requireExactMappingIds.add(gift.id);
      } else {
        localPathById.set(gift.id, existingPath);
      }
      continue;
    }
    const relativePath = expectedPath;
    localPathById.set(gift.id, relativePath);
    downloads.push({ ...gift, relativePath });
  }

  const downloadedCount = await downloadImages(downloads);
  restoreRemoteOnlyMappingImages(mappingDocuments, exactMappings, gifts);
  updateExistingMappingImages(mappingDocuments, exactMappings, localPathById);
  appendMissingMappingRows(mappingDocuments, gifts, resolvedBefore, localPathById, requireExactMappingIds);
  writeMappingDocuments(mappingDocuments);

  const resolvedAfter = readGiftMappings(PUBLIC_DIR);
  updateManifest(gifts, resolvedAfter);
  verifyLocalCatalog(gifts, resolvedAfter);
  const removedCount = removeUnneededGeneratedImages(gifts, resolvedAfter);

  const goldCount = gifts.filter(gift => gift.coinType === 'gold').length;
  console.log(`背包礼物同步完成：代码 ${gifts.length} 个，金瓜子本地图片 ${goldCount} 张，新增下载 ${downloadedCount} 张，按价格调整目录 ${relocatedCount} 张，清理无需本地化图片 ${removedCount} 张。`);
}

async function fetchBackpackGifts() {
  const response = await fetch(GIFT_CONFIG_URL, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://live.bilibili.com',
      'Referer': 'https://live.bilibili.com/1'
    }
  });
  if (!response.ok) throw new Error(`Bilibili 礼物配置请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  if (Number(payload?.code) !== 0 || !Array.isArray(payload?.data?.list)) {
    throw new Error(`Bilibili 礼物配置返回错误：${payload?.message || payload?.code || '无数据'}`);
  }

  return payload.data.list.filter(entry => Number(entry?.bag_gift) === 1).map(normalizeGift).filter(Boolean);
}

function normalizeGift(entry) {
  const id = Number(entry?.id);
  const name = String(entry?.name || '').replace(/\s+/g, ' ').trim();
  const rawPrice = Number(entry?.price);
  const coinType = String(entry?.coin_type || '');
  const sourceUrl = normalizeImageUrl(entry?.webp || entry?.img_basic);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !Number.isFinite(rawPrice) || rawPrice < 0 || !sourceUrl) {
    return null;
  }
  const battery = coinType === 'silver' ? rawPrice / 1000 : rawPrice / 100;
  return {
    id,
    name,
    rawPrice,
    battery,
    rmb: battery / 10,
    coinType,
    sourceUrl
  };
}

function normalizeImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(hostname === 'hdslb.com' || hostname.endsWith('.hdslb.com'))) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function readMappingDocuments() {
  return new Map(MAPPING_FILES.map((name) => {
    const filePath = path.join(GIFT_DIR, name);
    const source = fs.readFileSync(filePath, 'utf8');
    const trailingNewline = /\r?\n$/.test(source);
    const body = trailingNewline ? source.replace(/\r?\n$/, '') : source;
    return [name, { filePath, lines: body.split(/\r?\n/), trailingNewline }];
  }));
}

function indexExactMappings(documents) {
  const result = new Map();
  for (const [fileName, document] of documents) {
    document.lines.forEach((line, lineIndex) => {
      const match = line.match(/^\|\s*(\d+)\s*\|/);
      if (match) result.set(Number(match[1]), { fileName, lineIndex });
    });
  }
  return result;
}

function removeGeneratedSupplementSections(documents) {
  for (const document of documents.values()) {
    const sectionIndex = document.lines.indexOf('## 背包礼物补充');
    if (sectionIndex < 0) continue;
    document.lines.splice(sectionIndex);
    while (document.lines.at(-1) === '') document.lines.pop();
  }
}

function resolveMappings(documents) {
  const result = new Map();
  for (const document of documents.values()) {
    for (const [id, mapping] of parseGiftMappingDocument(document.lines.join('\n'))) {
      if (!result.has(id)) result.set(id, mapping);
    }
  }
  return result;
}

function updateExistingMappingImages(documents, exactMappings, localPathById) {
  for (const [id, relativePath] of localPathById) {
    const mapping = exactMappings.get(id);
    if (!mapping) continue;
    const document = documents.get(mapping.fileName);
    const cells = document.lines[mapping.lineIndex].split('|');
    if (cells.length < 4) continue;
    const imageCell = `[${id}.webp](${relativePath})`;
    if (cells[2].trim() === imageCell) continue;
    cells[2] = ` ${imageCell} `;
    document.lines[mapping.lineIndex] = cells.join('|');
  }
}

function restoreRemoteOnlyMappingImages(documents, exactMappings, gifts) {
  for (const gift of gifts) {
    if (gift.coinType === 'gold') continue;
    const mapping = exactMappings.get(gift.id);
    if (!mapping) continue;
    const document = documents.get(mapping.fileName);
    const cells = document.lines[mapping.lineIndex].split('|');
    if (cells.length < 4 || cells[2].trim() === gift.sourceUrl) continue;
    cells[2] = ` ${gift.sourceUrl} `;
    document.lines[mapping.lineIndex] = cells.join('|');
  }
}

function appendMissingMappingRows(documents, gifts, resolvedMappings, localPathById, requireExactMappingIds) {
  const missingByFile = new Map();
  for (const gift of gifts) {
    if (resolvedMappings.has(gift.id) && !requireExactMappingIds.has(gift.id)) continue;
    const fileName = mappingFileForGift(gift);
    if (!missingByFile.has(fileName)) missingByFile.set(fileName, []);
    missingByFile.get(fileName).push(gift);
  }

  for (const [fileName, missing] of missingByFile) {
    const document = documents.get(fileName);
    while (document.lines.at(-1) === '') document.lines.pop();
    document.lines.push('', '## 背包礼物补充', '');
    if (fileName === 'silver-free-mapping.md') {
      document.lines.push(
        '| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 当前在售 |',
        '| ---: | --- | --- | ---: | ---: | --- |'
      );
    } else {
      document.lines.push(
        '| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 同特效代码 | 当前在售 |',
        '| ---: | --- | --- | ---: | ---: | --- | --- |'
      );
    }
    for (const gift of missing.sort((left, right) => left.rmb - right.rmb || left.id - right.id)) {
      const image = gift.coinType === 'gold'
        ? `[${gift.id}.webp](${localPathById.get(gift.id)})`
        : gift.sourceUrl;
      const values = [gift.id, image, escapeMarkdownCell(gift.name), formatNumber(gift.battery), formatMoney(gift.rmb)];
      if (fileName !== 'silver-free-mapping.md') values.push('');
      values.push('非目前在售');
      document.lines.push(`| ${values.join(' | ')} |`);
    }
  }
}

function writeMappingDocuments(documents) {
  for (const document of documents.values()) {
    const content = `${document.lines.join('\n')}${document.trailingNewline ? '\n' : ''}`;
    fs.writeFileSync(document.filePath, content, 'utf8');
  }
}

async function downloadImages(items) {
  let nextIndex = 0;
  let downloadedCount = 0;
  const workerCount = Math.min(8, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      const targetPath = path.join(GIFT_DIR, item.relativePath);
      if (isUsableWebp(targetPath)) continue;
      await downloadImage(item.sourceUrl, targetPath);
      downloadedCount += 1;
    }
  }));
  return downloadedCount;
}

function relocateImage(fromRelativePath, toRelativePath) {
  const sourcePath = path.join(GIFT_DIR, fromRelativePath);
  const targetPath = path.join(GIFT_DIR, toRelativePath);
  if (sourcePath === targetPath) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!isUsableWebp(targetPath)) fs.copyFileSync(sourcePath, targetPath);
  fs.rmSync(sourcePath);
}

async function downloadImage(url, targetPath) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://live.bilibili.com/'
    }
  });
  if (!response.ok) throw new Error(`礼物图片下载失败：HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!isWebpBuffer(buffer)) throw new Error(`礼物图片不是有效 WebP：${url}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function updateManifest(gifts, mappings) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const remoteOnlyIds = new Set(gifts.filter(gift => gift.coinType !== 'gold').map(gift => gift.id));
  const entries = (Array.isArray(manifest.gifts) ? manifest.gifts : [])
    .filter(entry => !(entry?.bagGift === true && remoteOnlyIds.has(Number(entry?.id))));
  const indexById = new Map(entries.map((gift, index) => [Number(gift?.id), index]));
  const additions = [];

  for (const gift of gifts) {
    if (gift.coinType !== 'gold') continue;
    const mapping = mappings.get(gift.id);
    if (!mapping?.imagePath) throw new Error(`礼物 ${gift.id} 缺少本地图片映射。`);
    const relativePath = mapping.imagePath.replace(/^\/img\//, '');
    const entry = {
      id: gift.id,
      name: gift.name,
      price: `${formatNumber(gift.battery)}电池`,
      image: relativePath,
      sourceUrl: gift.sourceUrl,
      battery: gift.battery,
      rmb: gift.rmb,
      category: path.posix.dirname(relativePath.replace(/^bilibili-gifts\//, '')),
      bagGift: true
    };
    const index = indexById.get(gift.id);
    if (index === undefined) additions.push(entry);
    else entries[index] = { ...entries[index], ...entry };
  }

  additions.sort((left, right) => left.id - right.id);
  manifest.retrievedAt = new Date().toISOString();
  manifest.gifts = entries.concat(additions);
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function verifyLocalCatalog(gifts, mappings) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestById = new Map(manifest.gifts.map(gift => [Number(gift?.id), gift]));
  for (const gift of gifts) {
    const mapping = mappings.get(gift.id);
    if (!mapping) throw new Error(`礼物 ${gift.id} 缺少本地代码映射。`);
    if (gift.coinType !== 'gold') continue;
    const entry = manifestById.get(gift.id);
    if (!mapping?.imagePath || !entry?.bagGift || !entry.image) {
      throw new Error(`礼物 ${gift.id} 的本地目录不完整。`);
    }
    if (!isUsableWebp(path.join(PUBLIC_DIR, mapping.imagePath))) {
      throw new Error(`礼物 ${gift.id} 的本地图片无效。`);
    }
  }
}

function removeUnneededGeneratedImages(gifts, mappings) {
  const status = childProcess.execFileSync('git', [
    'status', '--porcelain=v1', '--untracked-files=all', '--', 'public/img/bilibili-gifts'
  ], { cwd: ROOT_DIR, encoding: 'utf8' });
  const untracked = new Set(status.split(/\r?\n/)
    .filter(line => line.startsWith('?? '))
    .map(line => line.slice(3).replaceAll('\\', '/')));
  let removedCount = 0;

  for (const gift of gifts) {
    const ownRelativePath = `${giftCategory(gift)}/${gift.id}.webp`;
    const repositoryPath = `public/img/bilibili-gifts/${ownRelativePath}`;
    const mappedPath = mappings.get(gift.id)?.imagePath?.replace(/^\/img\/bilibili-gifts\//, '') || '';
    if (mappedPath === ownRelativePath || !untracked.has(repositoryPath)) continue;
    const targetPath = path.resolve(GIFT_DIR, ownRelativePath);
    if (!targetPath.startsWith(`${GIFT_DIR}${path.sep}`)) throw new Error(`礼物图片路径越界：${targetPath}`);
    fs.rmSync(targetPath);
    removedCount += 1;
  }
  return removedCount;
}

function mappingFileForGift(gift) {
  if (gift.coinType !== 'gold') return 'silver-free-mapping.md';
  return gift.rmb < 100 ? 'gift-mapping-under-100.md' : 'gift-mapping-100-above.md';
}

function giftCategory(gift) {
  if (gift.rmb < 100) return '0000-under-0100';
  if (gift.rmb >= 3000) return '3000-above';
  if (gift.rmb >= 2500) return '2500-2999';
  if (gift.rmb >= 2000) return '2000-2499';
  const lower = Math.floor(gift.rmb / 100) * 100;
  return `${String(lower).padStart(4, '0')}-${String(lower + 100).padStart(4, '0')}`;
}

function isUsableWebp(filePath) {
  try {
    return isWebpBuffer(fs.readFileSync(filePath).subarray(0, 12));
  } catch (_) {
    return false;
  }
}

function isWebpBuffer(buffer) {
  return buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function formatNumber(value) {
  return String(Number(Number(value).toFixed(4)));
}

function formatMoney(value) {
  return `¥${Number(value).toFixed(2)}`;
}

function escapeMarkdownCell(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`同步背包礼物失败：${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  giftCategory,
  normalizeGift
};

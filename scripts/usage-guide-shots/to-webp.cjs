#!/usr/bin/env node
'use strict';

// PNG → WebP 转换（复用 Playwright 的 Chromium canvas，零新依赖）。
// 用法：node scripts/usage-guide-shots/to-webp.cjs [--quality 0.86]
// 读取 screenshots/usage-guide/png/**，输出到 webp/ 同名目录，并自检体积与宽高。

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { pngSize } = require('./lib/page-tools.cjs');
const { OUT_ROOT } = require('./manifest.js');

const SIZE_BUDGET_BYTES = 200 * 1024; // 方案 6.1：单张 WebP ≤200 KB 为目标

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listPngs(full);
    return entry.name.toLowerCase().endsWith('.png') ? [full] : [];
  });
}

async function main() {
  const qualityArg = process.argv.find((a) => a.startsWith('--quality='));
  const quality = qualityArg ? Number(qualityArg.slice(10)) : 0.86;
  const pngDir = path.join(OUT_ROOT, 'png');
  const files = listPngs(pngDir);
  if (files.length === 0) {
    console.log(`[webp] 没有找到 PNG：${pngDir}`);
    return;
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const file of files) {
      const relative = path.relative(pngDir, file);
      const outFile = path.join(
        OUT_ROOT,
        'webp',
        relative.replace(/\.png$/i, '.webp'),
      );
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      const dataUrl = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      const webpDataUrl = await page.evaluate(
        async ([src, q]) => {
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('image decode failed'));
            image.src = src;
          });
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return canvas.toDataURL('image/webp', q);
        },
        [dataUrl, quality],
      );
      const base64 = webpDataUrl.replace(/^data:image\/webp;base64,/, '');
      fs.writeFileSync(outFile, Buffer.from(base64, 'base64'));
      const kb = Math.round(fs.statSync(outFile).size / 1024);
      const size = pngSize(file);
      const over = fs.statSync(outFile).size > SIZE_BUDGET_BYTES;
      console.log(
        `[webp] ${relative} → ${path.relative(OUT_ROOT, outFile)} ` +
          `${size?.width}×${size?.height} ${kb} KB${over ? '  ⚠ 超过 200 KB 目标' : ''}`,
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

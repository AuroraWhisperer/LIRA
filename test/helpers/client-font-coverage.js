'use strict';

const assert = require('node:assert/strict');
const { CLIENT_FONT_IDS } = require('../../public/js/shared/client-font-theme.js');

// CDP reports the embedded names from the font files, not the CSS family aliases.
const postScriptNames = {
  wenkai: ['LiraMoonWenKai'],
  xiaolai: ['Xiaolai'],
  yozai: ['Yozai-Regular', 'Yozai-Medium'],
};

// Exercise the shipped CSS stack and actual platform glyphs; document.fonts.check alone accepts fallback.
async function checkClientFontCoverage(page, cdp) {
  const decoder = new TextDecoder('gb18030');
  let han = '';
  for (let row = 0xb0; row <= 0xf7; row++) {
    for (let col = 0xa1; col <= 0xfe; col++) {
      if (row === 0xd7 && col >= 0xfa) continue;
      han += decoder.decode(Uint8Array.of(row, col));
    }
  }
  assert.equal(new Set(han).size, 6763);
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  await page.evaluate(text => {
    const sample = document.createElement('span');
    sample.id = 'verify-client-mixed';
    sample.textContent = text;
    document.body.append(sample);
  }, `直播间 · Live 09:30 · 蘋果北𣴓，。！？：（）【】《》、￥％ Café ¥99.50 · 20°C ${ascii} ${han}`);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#verify-client-mixed' });
  for (const fontId of CLIENT_FONT_IDS) {
    await page.evaluate(async id => {
      const { applySavedClientFont } = await import('/js/shared/client-font-runtime.js');
      await applySavedClientFont(id);
    }, fontId);
    for (const weight of [400, 700]) {
      await page.locator('#verify-client-mixed').evaluate((sample, weight) => { sample.style.fontWeight = weight; }, weight);
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(fonts.length === 1 && fonts[0].isCustomFont && postScriptNames[fontId].includes(fonts[0].postScriptName),
        `${fontId} at ${weight}: ${JSON.stringify(fonts)}`);
      assert.ok(fonts[0].glyphCount >= han.length, `${fontId}: the whole mixed node must be laid out`);
    }
  }
}

module.exports = { checkClientFontCoverage };

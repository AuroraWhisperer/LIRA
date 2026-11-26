'use strict';

const assert = require('node:assert/strict');
const { CLIENT_FONTS } = require('../../public/js/shared/client-font-theme.js');

// CDP reports the embedded names from the font files, not the CSS family aliases.
const postScriptNames = {
  wenkai: ['LiraMoonWenKai'],
  xiaolai: ['Xiaolai'],
  yozai: ['Yozai-Regular', 'Yozai-Medium'],
  'source-han-serif': ['LiraSeaBreezeSerif-Regular'],
  maiyuan: ['KNMaiyuan-Regular'],
  assorted: ['MaokenAssortedSans'],
  smiley: ['SmileySans-Oblique'],
  kuaile: ['ZCOOLKuaiLe-Regular'],
  dengxian: ['DengXian', 'DengXian-Bold'],
  simsun: ['SimSun'],
  kaiti: ['KaiTi'],
  fangsong: ['FangSong'],
  simhei: ['SimHei'],
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
  const commonText = `直播间 · Live 09:30 ，。！？；：、（）【】《》“”‘’…—·￥％　〈〉「」『』〔〕［］｛｝～／＼－． ${ascii} ${han}`;
  await page.evaluate(async () => {
    const select = document.createElement('select');
    select.id = 'clientFont';
    select.dataset.selectSearch = '';
    select.dataset.selectFontPreview = '';
    select.dataset.selectUngrouped = '';
    select.add(new Option('默认字体', 'system'));
    const sample = document.createElement('span');
    sample.id = 'verify-client-mixed';
    sample.textContent = '直播间 · Live 09:30';
    document.body.append(select, sample);
    const { initClientFontSettings } = await import('/js/admin/client-font-settings.js');
    initClientFontSettings(document, { setClientFont: async fontId => ({ ok: true, fontId }) });
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects(select);
  });
  const trigger = page.locator('#clientFont-trigger');
  const menu = page.locator('#clientFont-options');
  const sample = page.locator('#verify-client-mixed');
  await trigger.click();
  const installed = await page.evaluate(async candidates => {
    const faces = await Promise.allSettled(candidates.map(font => new FontFace(font.family, `local(${font.value})`).load()));
    return candidates.filter((_, i) => faces[i].status === 'fulfilled').map(font => font.id);
  }, CLIENT_FONTS.filter(font => font.local));
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#verify-client-mixed' });
  const available = CLIENT_FONTS.filter(font => !font.local || installed.includes(font.id));
  for (const font of available) {
    const fontId = font.id;
    if (!await menu.isVisible()) await trigger.click();
    await menu.getByRole('option', { name: font.label.split(' · ')[0], exact: true }).click();
    await page.waitForFunction(id => !document.querySelector('#clientFont').disabled && document.documentElement.dataset.clientFont === id, fontId);
    // Preserve the broader coverage of the three original families, including supplementary Han.
    const text = ['wenkai', 'xiaolai', 'yozai'].includes(fontId) ? `${commonText} 蘋果北𣴓 Café ¥99.50 · 20°C` : commonText;
    await sample.evaluate((node, text) => { node.textContent = text; }, text);
    for (const weight of [400, 700]) {
      await sample.evaluate((node, weight) => { node.style.fontWeight = weight; }, weight);
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(fonts.length === 1 && fonts[0].isCustomFont === !font.local && postScriptNames[fontId].includes(fonts[0].postScriptName),
        `${fontId} at ${weight}: ${JSON.stringify(fonts)}`);
      assert.ok(fonts[0].glyphCount >= han.length, `${fontId}: the whole mixed node must be laid out`);
    }
  }
  return available.map(font => font.label.split(' · ')[0]);
}

module.exports = { checkClientFontCoverage };

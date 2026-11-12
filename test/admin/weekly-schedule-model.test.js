'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=';
let model;
test.before(async () => {
  model = await loadModuleExports(path.join(__dirname, '../../public/js/admin/weekly-schedule/model.js'), {
    atob, crypto: { randomUUID: () => 'new-template' },
  });
});
const plain = value => JSON.parse(JSON.stringify(value));

test('week dates begin on Monday and preserve real dates across month and leap-year boundaries', () => {
  assert.deepEqual(plain(model.getWeekDates('2026-11-01')), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
  assert.equal(model.getWeekDates('2024-03-01')[3], '2024-02-29');
  assert.equal(model.getWeekDates('2024-03-01')[6], '2024-03-03');
});

test('copying a template retains images and creates independently editable days, modules and transforms', () => {
  const original = model.createWeeklyScheduleTemplate({ id: 'original', name: '原模板', monday: '2026-11-09' });
  original.assets.portrait = PNG;
  original.layout = 'gallery';
  original.palette = 'lilac';
  original.decorations.pattern = 'wash';
  original.days[1].time1 = '8:00–12:00';
  original.modules.rank.names[0] = '小月亮';
  const copy = model.cloneWeeklyScheduleTemplate(original, { id: 'copy', name: '第二位主播' });
  assert.equal(copy.id, 'copy');
  assert.equal(copy.layout, 'gallery');
  assert.equal(copy.palette, 'lilac');
  assert.equal(copy.decorations.pattern, 'wash');
  assert.equal(copy.assets.portrait, PNG);
  assert.equal(copy.days[1].time1, '8:00–12:00');
  copy.days[1].time1 = '22:00';
  copy.modules.rank.names[0] = '星星';
  copy.portrait.scale = 200;
  assert.equal(original.days[1].time1, '8:00–12:00');
  assert.equal(original.modules.rank.names[0], '小月亮');
  assert.equal(original.portrait.scale, 100);
});

test('starting a fresh week clears program content and states while keeping broadcast times and assets', () => {
  const original = model.createWeeklyScheduleTemplate({ id: 'original', monday: '2026-11-09' });
  original.assets.logo = PNG;
  original.days[0] = { theme: '生日会', note: '连唱', time1: '20:00', time2: '到困为止', rest: true, highlight: true, highlightLabel: '生日' };
  const cleared = model.clearWeeklyScheduleWeek(original);
  assert.equal(cleared.days[0].theme, '');
  assert.equal(cleared.days[0].note, '');
  assert.equal(cleared.days[0].rest, false);
  assert.equal(cleared.days[0].highlight, false);
  assert.equal(cleared.days[0].time1, '20:00');
  assert.equal(cleared.days[0].time2, '到困为止');
  assert.equal(cleared.assets.logo, PNG);
  assert.equal(cleared.monday, '2026-11-09');
  assert.equal(original.days[0].theme, '生日会');
});

test('restored input preserves valid edits while constraining unsafe URLs, fonts and invalid transforms', () => {
  const restored = model.normalizeWeeklyScheduleTemplate({
    id: 'saved', name: '我的模板', monday: '2026-11-12', title: '', layout: 'celestial',
    primaryColor: '#000000', accentColor: 'red;', fontId: 'Arial; background:url(https://example.invalid)',
    assets: { portrait: PNG, logo: 'file:///private.png', background: 'https://example.invalid/bg.png' },
    portrait: { scale: Infinity, x: 99999, y: -9999, flip: true, outline: false },
    modules: { message: { enabled: false, text: '<img src=x onerror=alert(1)>' } },
  });
  assert.equal(restored.monday, '2026-11-09');
  assert.equal(restored.title, '');
  assert.equal(restored.layout, 'celestial');
  assert.equal(restored.primaryColor, '#000000');
  assert.equal(restored.fontId.includes(';'), false);
  assert.equal(restored.assets.portrait, PNG);
  assert.equal(restored.assets.logo, '');
  assert.equal(restored.assets.background, '');
  assert.equal(restored.portrait.scale, 100);
  assert.equal(restored.portrait.x, 1920);
  assert.equal(restored.portrait.y, -1080);
  assert.equal(restored.portrait.flip, true);
  assert.equal(restored.portrait.outline, false);
  assert.equal(restored.modules.message.enabled, false);
  assert.equal(restored.modules.message.text, '<img src=x onerror=alert(1)>');
});

test('legacy templates retain their appearance and expanded controls survive independent copies', () => {
  const legacy = model.normalizeWeeklyScheduleTemplate({ id: 'legacy', portrait: { scale: 200, x: 10, y: -20 } });
  assert.equal(legacy.portrait.scale, 200);
  assert.equal(legacy.portrait.outlineWidth, 7);
  assert.equal(legacy.portrait.rotation, 0);
  assert.equal(legacy.portrait.opacity, 100);
  assert.equal(legacy.background.fit, 'cover');
  assert.equal(legacy.background.x, 50);
  assert.equal(legacy.typography.theme, 100);
  const edited = model.normalizeWeeklyScheduleTemplate({
    ...legacy, portrait: { ...legacy.portrait, outline: false, outlineWidth: 12 },
    logo: { scale: 350, x: -1200, rotation: 45, opacity: 55, flip: true, brightness: 130, shadow: 40 },
    background: { fit: 'contain', x: 80, y: 0, blur: 8, opacity: 35, offsetX: 80, scale: 150 },
    rank1: { scale: 125, x: 12, glow: 60 }, customIcon: { rotation: 30, saturation: 70 },
    typography: { theme: 135, note: 80 }, decorations: { pattern: 'stripes', intensity: 25 },
  });
  const copy = model.cloneWeeklyScheduleTemplate(edited);
  assert.equal(copy.portrait.outline, false);
  assert.equal(copy.portrait.outlineWidth, 12);
  assert.equal(copy.logo.scale, 350);
  assert.equal(copy.logo.x, -1200);
  assert.equal(copy.logo.rotation, 45);
  assert.equal(copy.logo.flip, true);
  assert.equal(copy.background.fit, 'contain');
  assert.equal(copy.background.opacity, 35);
  assert.equal(copy.background.offsetX, 80);
  assert.equal(copy.background.scale, 150);
  assert.equal(copy.logo.brightness, 130);
  assert.equal(copy.logo.shadow, 40);
  assert.equal(copy.rank1.glow, 60);
  assert.equal(copy.customIcon.rotation, 30);
  copy.rank1.glow = 10;
  assert.equal(edited.rank1.glow, 60);
  assert.equal(edited.rank2.glow, 0);
  assert.equal(copy.typography.theme, 135);
  assert.equal(copy.decorations.pattern, 'stripes');
  copy.background.x = 10;
  copy.typography.theme = 100;
  assert.equal(edited.background.x, 80);
  assert.equal(edited.typography.theme, 135);
  const bounded = model.normalizeWeeklyScheduleTemplate({
    logo: { scale: -5, rotation: 1000, opacity: -1 },
    background: { blur: Infinity, fit: 'invalid' }, typography: { theme: 10000 },
  });
  assert.equal(bounded.logo.scale, 10);
  assert.equal(bounded.logo.rotation, 180);
  assert.equal(bounded.logo.opacity, 0);
  assert.equal(bounded.background.blur, 0);
  assert.equal(bounded.background.fit, 'cover');
  assert.equal(bounded.typography.theme, 160);
});

test('image values require a raster signature rather than trusting an image MIME prefix', () => {
  assert.equal(model.isWeeklyScheduleAsset(PNG), true);
  assert.equal(model.getWeeklyScheduleAssetBytes(PNG), Buffer.from(PNG.split(',')[1], 'base64').length);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
  assert.equal(model.isWeeklyScheduleAsset(`data:image/png;base64,${svg}`), false);
  assert.equal(model.isWeeklyScheduleAsset(`data:image/svg+xml;base64,${svg}`), false);
  assert.equal(model.isWeeklyScheduleAsset('https://example.invalid/avatar.png'), false);
});

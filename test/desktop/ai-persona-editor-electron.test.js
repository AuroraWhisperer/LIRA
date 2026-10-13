'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

test('persona modal suspends for the real confirmation and restores editable drafts', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'ai-personas-desktop-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/daily-bot-editor.cjs', directory, 'ai-personas'], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  // Exercise real modal focus and cancellation without hidden-window animation waits.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForURL('**/admin');
  assert.equal((await fetch(page.url())).status, 401);
  await page.waitForFunction(() => window.aiPersonaTest);
  const config = await page.evaluate(() => window.aiPersonaTest.config);
  const requests = [];
  let failNext = false;
  await page.route('**/api/ai/personas/**', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { ok: false, error: '预设保存暂时失败，请重试。' } });
    }
    if (body.reset) config.personas[0].prompt = '已恢复默认的角色指南，长度足够用于实际表单校验。';
    else {
      config.personas = config.personas.filter((persona) => persona.id !== body.id);
      config.personaId = 'general';
    }
    await route.fulfill({ json: { ok: true, data: config } });
  });
  const modal = page.locator('#xiaomiAiPersonaDialog');
  const prompt = page.locator('#xiaomiAiPersonaPrompt');
  const confirmation = page.locator('.lira-confirm-backdrop');
  const draft = '这份还没有保存的角色指南，在取消和失败后都应该完整保留。';
  await page.locator('#xiaomiAiPersonaManage').click();
  await prompt.fill(draft);
  for (const cancel of ['button', 'escape']) {
    await page.locator('#xiaomiAiPersonaReset').click();
    await confirmation.waitFor();
    assert.equal(await modal.evaluate((node) => node.open), false);
    if (cancel === 'button') await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    else {
      await page.waitForFunction(() => document.activeElement?.classList.contains('lira-confirm-cancel'));
      await page.keyboard.press('Escape');
    }
    await modal.waitFor();
    assert.equal(await modal.evaluate((node) => node.matches(':modal') && !node.inert), true);
    assert.equal(await prompt.inputValue(), draft);
    assert.equal(requests.length, 0);
  }
  failNext = true;
  await page.locator('#xiaomiAiPersonaReset').click();
  await confirmation.getByRole('button', { name: '恢复默认', exact: true }).click();
  await modal.waitFor();
  await page.locator('#xiaomiAiPersonaState').filter({ hasText: '暂时失败' }).waitFor();
  assert.equal(await prompt.inputValue(), draft);
  await prompt.fill(draft + '仍可编辑。');
  await page.locator('#xiaomiAiPersonaReset').click();
  await confirmation.getByRole('button', { name: '恢复默认', exact: true }).click();
  await modal.waitFor();
  assert.match(await prompt.inputValue(), /^已恢复默认/);
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  await page.locator('#xiaomiAiPersona').selectOption('test-persona');
  await page.locator('#xiaomiAiPersonaManage').click();
  await prompt.fill(draft);
  await page.locator('#xiaomiAiPersonaDelete').click();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await modal.waitFor();
  assert.equal(await prompt.inputValue(), draft);
  assert.equal(requests.length, 2);
  await page.locator('#xiaomiAiPersonaDelete').click();
  await confirmation.getByRole('button', { name: '删除预设', exact: true }).click();
  await modal.waitFor();
  assert.equal(await page.locator('#xiaomiAiPersona option[value="test-persona"]').count(), 0);
  await page.locator('#xiaomiAiPersonaCancel').click();
  await modal.waitFor({ state: 'hidden' });
  assert.deepEqual(requests, [{ id: 'general', reset: true }, { id: 'general', reset: true }, { id: 'test-persona' }]);
});

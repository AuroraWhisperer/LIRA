'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAiSettingsFixture } = require('./helpers/ai-settings-fixture');

test('AI assistant keeps saved secrets out of password fields', async () => {
  const { elements } = await createAiSettingsFixture({
    config: { hasQWeatherApiKey: true },
  });
  for (const provider of ['DeepSeek', 'QWeather', 'Amap']) {
    assert.equal(elements.get(`xiaomiAi${provider}Key`).type, 'password');
    assert.equal(elements.get(`xiaomiAi${provider}Key`).value, '');
  }
  for (const provider of ['DeepSeek', 'QWeather']) {
    assert.equal(
      elements.get(`xiaomiAi${provider}KeyHint`).textContent,
      '已加密保存；清空或输入新值以更新',
    );
  }
  assert.equal(elements.get('xiaomiAiAmapKeyHint').textContent, '尚未保存');
});

for (const value of ['', '********']) {
  test(`AI assistant omits ${value ? 'legacy mask' : 'empty'} secrets from model requests and configuration saves`, async () => {
    const f = await createAiSettingsFixture({
      config: { hasQWeatherApiKey: true },
    });
    for (const provider of ['DeepSeek', 'QWeather', 'Amap']) {
      f.elements.get(`xiaomiAi${provider}Key`).value = value;
    }
    await f.fire('xiaomiAiFetchModelsBtn', 'click');
    const modelRequest = f.calls.find((call) => call.url === '/api/ai/models');
    assert.equal(JSON.parse(modelRequest.options.body).apiKey, '');
    f.input('xiaomiAiTrigger', '猫猫');
    await f.advance(700);
    assert.equal(f.saves().length, 1);
    const saved = f.saves()[0];
    assert.equal(saved.trigger, '猫猫');
    assert.equal(saved.deepseekApiKey, undefined);
    assert.equal(saved.qweatherApiKey, undefined);
    assert.equal(saved.amapApiKey, undefined);
  });
}

test('AI assistant submits a newly entered key without changing other saved secrets', async () => {
  const f = await createAiSettingsFixture({
    config: { hasQWeatherApiKey: true },
  });
  f.input('xiaomiAiDeepSeekKey', 'new-deepseek-key');
  await f.advance(700);
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].deepseekApiKey, 'new-deepseek-key');
  assert.equal(f.saves()[0].qweatherApiKey, undefined);
});

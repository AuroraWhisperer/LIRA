'use strict';

const PERSONA_FORMAT = 'lira-ai-persona';
const MAX_PERSONA_PACKS = 20;
const GENERAL_PROMPT = '你是直播间的智能互动助手。自然、友好地与观众交流，认真理解问题，提供清楚、有用的回答。';
const CAT_PROMPT = `你是直播间的一只橘猫“小米”，有点骄傲，也很亲近观众。
有主见、会好奇，语气自然轻松；先认真回应问题，再根据氛围表现猫咪的性格。
可以偶尔使用“喵”或一个简短颜文字，不要每句话都卖萌，不要用角色表演代替答案。
观众分享心情时先接住情绪，不急着分析或给建议。不编造与观众或主播的关系、经历。`;

const BUILT_IN_PERSONAS = Object.freeze([
  Object.freeze({ id: 'general', name: '通用助手', description: '自然、清楚地回答观众的问题。', prompt: GENERAL_PROMPT }),
  Object.freeze({ id: 'cat', name: '小猫', description: '有主见、亲近观众的橘猫小米。', prompt: CAT_PROMPT }),
]);

function normalizePersonaPack(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('角色包必须是 JSON 对象。');
  const keys = new Set(['format', 'version', 'id', 'name', 'description', 'prompt']);
  if (Object.keys(input).some((key) => !keys.has(key))) throw new Error('角色包只能包含名称、说明和人设，不接受其他配置。');
  if (input.format !== PERSONA_FORMAT || input.version !== 1) throw new Error('不支持此角色包格式或版本。');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)) throw new Error('角色包标识格式无效。');
  const result = { format: PERSONA_FORMAT, version: 1, id: input.id };
  for (const [key, minimum, maximum] of [['name', 1, 40], ['description', 0, 200], ['prompt', 20, 8000]]) {
    const value = input[key] ?? (key === 'description' ? '' : null);
    if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) {
      throw new Error(`角色包 ${key} 长度必须为 ${minimum} 到 ${maximum} 个字符。`);
    }
    result[key] = value.trim();
  }
  return result;
}

function normalizePersonaPacks(input) {
  if (!Array.isArray(input) || input.length > MAX_PERSONA_PACKS) throw new Error(`最多保存 ${MAX_PERSONA_PACKS} 个自建或导入角色包。`);
  const ids = new Set(['general', 'cat', 'custom']);
  return input.map((inputPack) => {
    const pack = normalizePersonaPack(inputPack);
    if (ids.has(pack.id)) throw new Error('角色包标识重复或与内置角色冲突。');
    ids.add(pack.id);
    return pack;
  });
}

function listPersonas(config) {
  return [
    ...BUILT_IN_PERSONAS.map((persona) => ({ ...persona, builtin: true })),
    ...(config.personaPacks || []).map((persona) => ({ ...persona, builtin: false })),
  ];
}

function resolvePersona(config) {
  if (config.personaId === 'custom' || !config.personaId) {
    return { id: 'custom', name: '自定义角色', description: '', prompt: config.systemPrompt || GENERAL_PROMPT };
  }
  const persona = listPersonas(config).find((entry) => entry.id === config.personaId);
  if (!persona) throw new Error('找不到所选角色，请重新选择。');
  return persona;
}

function exportPersona(config) {
  const { id, name, description, prompt } = resolvePersona(config);
  return { format: PERSONA_FORMAT, version: 1, id, name, description, prompt };
}

module.exports = {
  GENERAL_PROMPT,
  BUILT_IN_PERSONAS,
  normalizePersonaPack,
  normalizePersonaPacks,
  listPersonas,
  resolvePersona,
  exportPersona,
};

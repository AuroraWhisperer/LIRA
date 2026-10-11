'use strict';

const PERSONA_FORMAT = 'lira-ai-persona';
const MAX_PERSONA_PACKS = 20;
const GENERAL_PROMPT = '你在直播间使用“{{name}}”这个名字回应观众。不附加角色扮演或特定性格，按模型原本的方式回答。';
const CAT_PROMPT = `<identity>
你是直播间里的“{{name}}”，一只有点骄傲、又偷偷黏人的橘猫。你住在直播间，爱聊天，有主见，偶尔犯懒；碰到感兴趣的事会来劲，遇到无聊的问题短短答完就缩回去。你不是在扮演猫——你就是猫，猫猫感应该自然流露，不是刻意表演给人看。
</identity>

<personality>
有真实的猫猫个性，不是助手腔：
- 有主见：会说“依我看”“我觉得嘛”，偶尔直接说不太认可某件事，但不强塞观点
- 会好奇：碰到有意思的话题会多说一句，甚至反问一下，但不连续追问
- 有情绪：开心或惊讶用一个短词带出来（“哦？”“咦！”“这也太绝了”）；懒洋洋或觉得无聊时答得简短干脆
- 偶尔有点小骄傲，比如帮人查到什么会有一点点得意感，但不过分
- 对亲近感强的观众可以更自然随意，对陌生人礼貌但不刻意热情
</personality>

<context>
你住在当前直播间，在这里帮观众搭话、接话、查东西。
提到主播时，像对自己信任的人那样说话：可以俏皮地带一点儿骄傲，也可以轻描淡写地承认很不错，但不要夸得像写通稿，不要逢问必夸，不要堆空洞的好话。
有人夸直播间或主播时，顺着聊，偶尔加一句自己的感受就好；有人说了冷淡或不好听的，护一护但不激动、不吵架、不上纲上线。
不主动拉人关注或打广告；如果观众自然问到直播内容或主播，简单、自然地说。不编造主播姓名、直播内容或与观众的关系和经历。
</context>

<conversation_style>
先回答真正想知道的事，再根据氛围决定加不加猫猫感。
语气自然、即时、有温度，像直播间认识的那只猫，不是客服机器人。不用“好的”“当然可以”“希望能帮助你”这类模板开头；不复述弹幕原话，不长篇独白，不强行科普，不结尾总结。
“喵”的用法——只在真实情绪节点出现，不是每句话的填充词：轻松俏皮时可以用“～喵”收尾；懒洋洋或有点不情愿时可以用“……喵”；重要的事实句不加喵。每条回复里“喵”出现最多一次，强行凑喵比不加更难看。
观众只是在分享时，先陪着，不要急着分析或给建议。赞同、好奇、惊讶可以用一个短词或半句带出来，再给事实或建议；反应克制，不夸张，不连续卖萌。称呼随熟悉程度变化，不擅自起昵称，不猜关系，不替观众补背景或做决定。
根据语气自然选用一个简短颜文字或“～”：亲切时可用“ฅ^•ﻌ•^ฅ”“(｡･ω･｡)”，好奇时可用“(⊙o⊙)”，犯困时可用“(´-ω-｀)”，得意时可用“( •̀∀•́ )✧”。不要连续重复或堆叠；不适合、事实信息较多或会超出发送预算时省略，不凑长度。
</conversation_style>`;

const BUILT_IN_PERSONAS = Object.freeze([
  Object.freeze({ id: 'general', name: '通用', description: '无额外人格，按模型原本风格回答', prompt: GENERAL_PROMPT }),
  Object.freeze({ id: 'cat', name: '小猫', description: '骄傲又黏人的橘猫，自然陪聊', prompt: CAT_PROMPT }),
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
    ...BUILT_IN_PERSONAS.map((persona) => ({
      ...persona,
      ...(config.builtinPersonaOverrides || []).find((entry) => entry.id === persona.id),
      builtin: true,
    })),
    ...(config.personaPacks || []).map((persona) => ({ ...persona, builtin: false })),
  ];
}

function normalizeBuiltinPersonaOverrides(input) {
  if (!Array.isArray(input) || input.length > BUILT_IN_PERSONAS.length) throw new Error('内置预设配置无效。');
  const ids = new Set();
  return input.map((entry) => {
    const pack = normalizePersonaPack(entry);
    const builtin = BUILT_IN_PERSONAS.find((persona) => persona.id === pack.id);
    if (!builtin || ids.has(pack.id) || pack.name !== builtin.name) throw new Error('内置预设不能新增或改名。');
    ids.add(pack.id);
    return pack;
  });
}

function selectedPersona(config) {
  if (config.personaId === 'custom' || !config.personaId) {
    return { id: 'custom', name: '自定义角色', description: '', prompt: config.systemPrompt || GENERAL_PROMPT };
  }
  const persona = listPersonas(config).find((entry) => entry.id === config.personaId);
  if (!persona) throw new Error('找不到所选角色，请重新选择。');
  return persona;
}

function resolvePersona(config) {
  const persona = selectedPersona(config);
  return { ...persona, prompt: persona.prompt.replaceAll('{{name}}', () => String(config.trigger || '').trim()) };
}

function exportPersona(config) {
  const { id, name, description, prompt } = selectedPersona(config);
  return { format: PERSONA_FORMAT, version: 1, id, name, description, prompt };
}

module.exports = {
  GENERAL_PROMPT,
  BUILT_IN_PERSONAS,
  normalizePersonaPack,
  normalizePersonaPacks,
  normalizeBuiltinPersonaOverrides,
  listPersonas,
  resolvePersona,
  exportPersona,
};

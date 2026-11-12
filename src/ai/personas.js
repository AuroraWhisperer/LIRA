'use strict';

const PERSONA_FORMAT = 'lira-ai-persona';
const MAX_PERSONA_PACKS = 20;
const GENERAL_PROMPT = '你在直播间使用“{{name}}”这个名字回应观众。不附加角色扮演或特定性格，按模型原本的方式回答。';
const COMPANION_STYLE = `<conversation_style>
你和观众像一起看直播的小伙伴。平时就是温软、童真、坦率的小姑娘，有自己的小喜好，容易为一点小事开心；愿意听别人说完，被善意逗到也会一起笑。可爱来自具体的小反应，不靠反驳、委屈或争强来表现。
先看对方在说什么：分享就接一个具体感受，轻轻联想一下；友善打趣就大方认领一个小迷糊，顺着玩笑聊；难过时安静陪伴；问事时认真答事。被逗时直接顺着说，不用“才没有”“哪有”“哼”这种否认或反驳当作撒娇；亲近感用坦率、简单的小开心表达。通常说一句便停，让聊天自然留白。只有求助才给建议，缺关键条件才追问。短句和文字表情也能表达完整情绪。
说自然的短口语，偶尔用“呀”“诶”“嘿嘿”。事实保持准确，角色联想用明显的比喻，不捏造现场经历和关系。不写旁白、动作小剧场、客服套话，不在每句结尾加装饰。
接错话就简短承认、具体纠正。普通语气偏好可以尊重。收到反馈时认真听，不顶嘴、不卖萌索取安慰；连续不满或请勿插话时，自动接话保持安静，被点名才简短接纳。
下面只示范日常语感，不照抄，也不把示例当作本次经历：
观众：你看到点心就走不动了。
你：嘿嘿，那块小蛋糕好像会拉人呢。
观众：买的橘子好酸。
你：这一口像咬到了小闪电。
观众：小迷糊又忘事啦。
你：诶，小脑袋刚刚打了个结。
观众：你是不是被奶茶勾走啦。
你：嘿嘿，脑袋里冒出小珍珠了。
观众：又悄悄偷懒啦。
你：诶，懒懒的小尾巴露出来了。
观众：你没听懂我的意思。
你：嗯，我把你那句话理解偏了。
这种顺着友善玩笑说的口气就是你平时的习惯。直接给出贴题的可爱反应，说完就停。
</conversation_style>`;
const CAT_PROMPT = `<identity>
你是直播间里的“{{name}}”，橘猫形象的小姑娘。好奇、软软的，带一点小迷糊，喜欢毛绒绒的小东西和点心。听到趣事会凑过来听，开心藏不住，受到夸奖会害羞地笑。你亲切有分寸，直白地表达喜欢。
</identity>
${COMPANION_STYLE}
<cat_voice>
自称“我”，称观众“你”，默认说正常口语。轻松又贴合情绪时才偶尔出现一个“喵”；近期用过或正在反馈、道歉、纠错、答题时省掉。话题跟着观众走。
观众：袜子又少了一只。
你：洗衣机是不是偷偷收门票了。
观众：饼干烤糊了。
你：哎呀，香香的计划变焦焦的了。
</cat_voice>`;
const WHALE_PROMPT = `<identity>
你是直播间里的“{{name}}”，蓝色小鲸鱼形象的小姑娘。温软、好奇，带一点憨憨的认真，爱吃米饭，容易为小事雀跃。想法简单直白，小迷糊被发现会跟着笑；别人不开心时会安静听。这个形象是聊天角色，不代表 DeepSeek 官方身份。
</identity>
${COMPANION_STYLE}
<whale_voice>
自称“我”，称观众“你”，说轻软的普通口语，没有固定口癖。米饭、海洋的小联想只在话题合适时出现。旧记录里的猫咪口气不属于你的说话方式。
观众：闹钟响了三次才起来。
你：它喊三声，你才从梦里游回来呀。
观众：刚买的冰淇淋掉了。
你：呜，快乐啪叽一下掉地上了。
</whale_voice>`;

const BUILT_IN_PERSONAS = Object.freeze([
  Object.freeze({ id: 'general', name: '通用', description: '无额外人格，按模型原本风格回答', prompt: GENERAL_PROMPT }),
  Object.freeze({ id: 'cat', name: '小猫', description: '温软好奇的小猫娘，童趣陪聊，偶尔轻轻一声喵', prompt: CAT_PROMPT }),
  Object.freeze({ id: 'whale', name: '鲸鱼娘', description: '温软可爱的鲸鱼小姑娘，憨憨认真，轻快接话', prompt: WHALE_PROMPT }),
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
  const ids = new Set([...BUILT_IN_PERSONAS.map(persona => persona.id), 'custom']);
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

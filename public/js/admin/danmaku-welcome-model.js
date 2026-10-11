export const PARAMETER_FIELDS = {
  welcomeDelaySeconds: { label: '首次欢迎时间', min: 0, max: 300, empty: 0 },
  welcomeMinHonorLevel: { label: '首次欢迎荣耀等级', min: 0, max: 999, empty: 0 },
  greetingDelaySeconds: { label: '二次问候时间', min: 1, max: 600 },
  greetingMinHonorLevel: { label: '二次问候荣耀等级', min: 0, max: 999, empty: 0 },
  attentionMinHonorLevel: { label: '重点关注荣耀等级', min: 1, max: 999 },
};
export const LIBRARIES = {
  messages: '欢迎词库',
  greetingMessages: '问候词库',
  attentionWelcomeMessages: '高荣耀欢迎词库',
  attentionGreetingMessages: '高荣耀问候词库',
};
export const SWITCHES = {
  enabled: 'Toggle',
  greetingEnabled: 'GreetingToggle',
  attentionEnabled: 'AttentionToggle',
  rareNamePinyinEnabled: 'PinyinToggle',
};
export const SUGGESTED = {
  welcomeDelaySeconds: 5,
  welcomeMinHonorLevel: 10,
  greetingDelaySeconds: 10,
  greetingMinHonorLevel: 10,
  attentionMinHonorLevel: 31,
};

export function parameterValues(draft, settings) {
  const values = {},
    errors = {};
  for (const [key, rule] of Object.entries(PARAMETER_FIELDS)) {
    const raw = String(draft[key] ?? '').trim();
    const value = raw === '' ? rule.empty : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < rule.min || value > rule.max)
      errors[key] = `${rule.label}需为 ${rule.min}～${rule.max} 的整数`;
    else values[key] = value;
  }
  if (
    settings.greetingEnabled &&
    !errors.greetingDelaySeconds &&
    !errors.welcomeDelaySeconds &&
    values.greetingDelaySeconds <= values.welcomeDelaySeconds
  )
    errors.greetingDelaySeconds = '问候时间需要大于首次欢迎时间';
  return { values, errors };
}

export function validMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length >= 1 &&
    messages.length <= 30 &&
    messages.every(
      (text) =>
        typeof text === 'string' && text.trim() && Array.from(text).length <= 80 && !/[\x00-\x1f\x7f]/u.test(text),
    )
  );
}

export function confirmedSettings(result) {
  if (!result?.ok || typeof result.enabled !== 'boolean' || !validMessages(result.messages))
    throw new Error('尚未确认服务器设置，请检查连接后重试。');
  if (result.schemaVersion === 1) return result;
  if (
    result.schemaVersion !== 2 ||
    Object.keys(SWITCHES).some((key) => typeof result[key] !== 'boolean') ||
    Object.keys(LIBRARIES).some((key) => !validMessages(result[key])) ||
    Object.keys(PARAMETER_FIELDS).some((key) => !Number.isInteger(result[key])) ||
    Object.keys(parameterValues(result, result).errors).length ||
    (!result.enabled && (result.greetingEnabled || result.attentionEnabled)) ||
    (result.userWelcomeMessages !== undefined &&
      (!Array.isArray(result.userWelcomeMessages) ||
        result.userWelcomeMessages.some((item) => typeof item?.uid !== 'string' || typeof item?.message !== 'string')))
  )
    throw new Error('服务器设置回包无效，请刷新核对。');
  return result;
}

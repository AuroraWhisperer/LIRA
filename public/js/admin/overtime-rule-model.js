export function readRules(root, limits) {
  const {
    maxEnabledRules,
    minRandomOutcomes,
    maxRandomOutcomes,
    maxDisplayTextLength,
  } = limits;
  const rows = Array.from(root.querySelectorAll('[data-overtime-rule]'));
  const rules = rows.map((row, index) => {
    const mode = row.querySelector('[data-rule-mode]:checked')?.value;
    if (!mode)
      throw new Error(`第 ${index + 1} 条礼物规则还没有选择生效方式。`);
    const quantityMode = row.querySelector(
      '[data-rule-quantity-mode]:checked',
    )?.value;
    if (!['group', 'item'].includes(quantityMode)) {
      throw new Error(`第 ${index + 1} 条礼物规则还没有选择数量计算方式。`);
    }
    const enabled = row.querySelector('[data-rule-enabled]').checked;
    const base = {
      giftId: row.dataset.giftId,
      giftName: row.dataset.giftName,
      imagePath: row.dataset.imagePath,
      mode,
      quantityMode,
      enabled,
      sortOrder: index,
    };
    if (mode === 'display') {
      const displayText = String(
        row.querySelector('[data-display-text]')?.value || '',
      ).trim();
      if (!displayText || Array.from(displayText).length > maxDisplayTextLength)
        throw new Error(
          `第 ${index + 1} 条文字展板需要填写 1–${maxDisplayTextLength} 个字符。`,
        );
      return { ...base, displayText };
    }
    if (mode === 'fixed') {
      return {
        ...base,
        fixedEffect: readEffect(
          row.querySelector('[data-effect-mode="fixed"]'),
        ),
      };
    }
    const outcomeCards = Array.from(
      row.querySelectorAll('[data-random-outcome]'),
    );
    if (
      outcomeCards.length < minRandomOutcomes ||
      outcomeCards.length > maxRandomOutcomes
    )
      throw new Error(
        `时间盲盒需要 ${minRandomOutcomes}–${maxRandomOutcomes} 个可能结果。`,
      );
    const outcomes = outcomeCards.map((card, outcomeIndex) => {
      const weight = Number(card.querySelector('[data-outcome-weight]').value);
      if (!Number.isSafeInteger(weight) || weight < 1)
        throw new Error(
          `盲盒结果 ${outcomeIndex + 1} 的抽中机会应填写正整数。`,
        );
      return { ...readEffect(card), weight };
    });
    return { ...base, outcomes };
  });
  if (rules.filter((rule) => rule.enabled).length > maxEnabledRules)
    throw new Error(`最多启用 ${maxEnabledRules} 条礼物规则。`);
  return rules;
}

export function normalizeEffect(effect, legacySeconds) {
  const operation = String(effect?.operation || '');
  if (['add', 'subtract', 'multiply', 'divide', 'clear'].includes(operation))
    return {
      operation,
      value: Math.max(0, Math.floor(Number(effect.value) || 0)),
    };
  const seconds = Math.trunc(Number(legacySeconds) || 0);
  return seconds < 0
    ? { operation: 'subtract', value: Math.abs(seconds) }
    : { operation: 'add', value: seconds };
}

export function describeRule(rule, minRandomOutcomes) {
  if (rule.mode === 'display')
    return `文字展板 · ${rule.displayText || '未填写'} · ${describeQuantityMode(rule.quantityMode)}`;
  if (rule.mode === 'random') {
    const count =
      Array.isArray(rule.outcomes) && rule.outcomes.length >= minRandomOutcomes
        ? rule.outcomes.length
        : minRandomOutcomes;
    return `随机抽取 · ${count} 个结果 · ${describeQuantityMode(rule.quantityMode)}`;
  }
  return `${describeEffect(normalizeEffect(rule.fixedEffect, rule.fixedSeconds))} · ${describeQuantityMode(rule.quantityMode)}`;
}

export function describeQuantityMode(value) {
  return value === 'item' ? '按具体数量' : '按连击组';
}

function describeEffect(effect) {
  if (effect.operation === 'clear') return '剩余时间清零';
  if (effect.operation === 'multiply') return `剩余时间乘 ${effect.value}`;
  if (effect.operation === 'divide') return `剩余时间除以 ${effect.value}`;
  return `${effect.operation === 'subtract' ? '减少' : '增加'} ${formatDurationSummary(effect.value)}`;
}

export function formatDurationSummary(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [];
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分钟`);
  if (rest || !parts.length) parts.push(`${rest} 秒`);
  return parts.join(' ');
}

function readEffect(root) {
  const operation = root.querySelector('[data-rule-operation]:checked')?.value;
  if (!operation) throw new Error('请选择增加、减少、乘倍数、除倍数或清零。');
  if (operation === 'clear') return { operation, value: 0 };
  if (operation === 'multiply' || operation === 'divide') {
    const value = Number(root.querySelector('[data-effect-factor]')?.value);
    if (!Number.isSafeInteger(value) || value < 2)
      throw new Error('倍数应填写大于等于 2 的整数。');
    return { operation, value };
  }
  const hours = readDurationPart(root, 'hours', '小时', 999);
  const minutes = readDurationPart(root, 'minutes', '分钟', 59);
  const seconds = readDurationPart(root, 'seconds', '秒', 59);
  return { operation, value: hours * 3600 + minutes * 60 + seconds };
}

function readDurationPart(root, part, label, maximum) {
  const value = Number(root.querySelector(`[data-duration-${part}]`)?.value);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error(`${label}应填写 0–${maximum} 的整数。`);
  return value;
}

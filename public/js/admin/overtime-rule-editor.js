'use strict';

const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';

export function createOvertimeRuleEditor(root, markDirty) {
  let ruleControlSequence = 0;
  let limits = null;

  function setLimits(nextLimits) {
    const normalized = {
      maxEnabledRules: Number(nextLimits?.maxEnabledRules),
      minRandomOutcomes: Number(nextLimits?.minRandomOutcomes),
      maxRandomOutcomes: Number(nextLimits?.maxRandomOutcomes),
      maxDisplayTextLength: nextLimits?.maxDisplayTextLength === undefined
        ? 6
        : Number(nextLimits.maxDisplayTextLength)
    };
    if (!Object.values(normalized).every(Number.isSafeInteger)
      || normalized.maxEnabledRules < 1
      || normalized.minRandomOutcomes < 1
      || normalized.maxRandomOutcomes < normalized.minRandomOutcomes
      || normalized.maxDisplayTextLength < 1) {
      throw new Error('加班机规则限制加载失败。');
    }
    limits = normalized;
  }

  function getLimits() {
    if (!limits) throw new Error('加班机规则限制尚未加载。');
    return limits;
  }

  function readRules() {
    const { maxEnabledRules, minRandomOutcomes, maxRandomOutcomes, maxDisplayTextLength } = getLimits();
    const rows = Array.from(root.querySelectorAll('[data-overtime-rule]'));
    const rules = rows.map((row, index) => {
      const mode = row.querySelector('[data-rule-mode]:checked')?.value;
      if (!mode) throw new Error(`第 ${index + 1} 条礼物规则还没有选择生效方式。`);
      const quantityMode = row.querySelector('[data-rule-quantity-mode]:checked')?.value;
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
        sortOrder: index
      };
      if (mode === 'display') {
        const displayText = String(row.querySelector('[data-display-text]')?.value || '').trim();
        if (!displayText || Array.from(displayText).length > maxDisplayTextLength) {
          throw new Error(`第 ${index + 1} 条文字展板需要填写 1–${maxDisplayTextLength} 个字符。`);
        }
        return { ...base, displayText };
      }
      if (mode === 'fixed') {
        return { ...base, fixedEffect: readEffect(row.querySelector('[data-effect-mode="fixed"]')) };
      }
      const outcomeCards = Array.from(row.querySelectorAll('[data-random-outcome]'));
      if (outcomeCards.length < minRandomOutcomes || outcomeCards.length > maxRandomOutcomes) {
        throw new Error(`时间盲盒需要 ${minRandomOutcomes}–${maxRandomOutcomes} 个可能结果。`);
      }
      const outcomes = outcomeCards.map((card, outcomeIndex) => {
        const weight = Number(card.querySelector('[data-outcome-weight]').value);
        if (!Number.isSafeInteger(weight) || weight < 1) {
          throw new Error(`盲盒结果 ${outcomeIndex + 1} 的抽中机会应填写正整数。`);
        }
        return { ...readEffect(card), weight };
      });
      return { ...base, outcomes };
    });
    if (rules.filter(rule => rule.enabled).length > maxEnabledRules) {
      throw new Error(`最多启用 ${maxEnabledRules} 条礼物规则。`);
    }
    return rules;
  }


  function renderRules(rules) {
    root.replaceChildren();
    if (!rules.length) {
      root.append(createMessage('overtime-rule-empty', '还没有规则。添加礼物后设置固定时间或时间盲盒。'));
      return;
    }
    rules.forEach((rule, index) => root.append(createRuleRow(rule, index, rules.length)));
  }

  function createRule(gift) {
    const { maxEnabledRules } = getLimits();
    root.querySelector('.overtime-rule-empty')?.remove();
    markDirty();
    const count = root.querySelectorAll('[data-overtime-rule]').length;
    const row = createRuleRow({
      giftId: gift.id,
      giftName: gift.name,
      imagePath: gift.imagePath,
      mode: 'fixed',
      quantityMode: String(gift.id).startsWith('guard-') ? 'item' : 'group',
      fixedEffect: { operation: 'add', value: 300 },
      outcomes: [],
      enabled: count < maxEnabledRules,
      sortOrder: count
    }, count, count + 1, true);
    root.append(row);
    return row;
  }

  function createRuleRow(rule, index, count, expanded = false) {
    const row = document.createElement('article');
    row.className = 'overtime-rule-row';
    row.dataset.overtimeRule = 'true';
    row.dataset.giftId = String(rule.giftId);
    row.dataset.giftName = String(rule.giftName || rule.giftId);
    row.dataset.imagePath = String(rule.imagePath || '');

    const header = document.createElement('header');
    header.className = 'overtime-rule-header';
    const gift = document.createElement('div');
    gift.className = 'overtime-rule-gift';
    const image = document.createElement('img');
    image.src = rule.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener('error', () => { image.src = PLACEHOLDER; }, { once: true });
    gift.append(image);

    const identity = document.createElement('div');
    identity.className = 'overtime-rule-identity';
    const name = document.createElement('strong');
    name.textContent = rule.giftName || `礼物 ${rule.giftId}`;
    const summary = document.createElement('small');
    summary.className = 'overtime-rule-summary';
    summary.dataset.ruleSummary = 'true';
    summary.textContent = describeRule(rule);
    identity.append(name, summary);
    gift.append(identity);
    header.append(gift);

    const controls = document.createElement('div');
    controls.className = 'overtime-rule-buttons';
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'overtime-rule-enabled';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.dataset.ruleEnabled = 'true';
    enabledLabel.append(enabled, document.createElement('span'), document.createTextNode('启用'));
    controls.append(enabledLabel);
    const moveUp = ruleButton('↑', '将这条规则上移', index === 0, () => moveRule(row, -1));
    moveUp.classList.add('overtime-rule-icon-button');
    const moveDown = ruleButton('↓', '将这条规则下移', index === count - 1, () => moveRule(row, 1));
    moveDown.classList.add('overtime-rule-icon-button');
    controls.append(moveUp, moveDown);
    const remove = ruleButton('删除', '删除规则', false, () => {
      markDirty();
      row.remove();
    });
    remove.classList.add('overtime-rule-remove');
    controls.append(remove);

    const body = document.createElement('div');
    body.className = 'overtime-rule-body';
    body.id = `overtime-rule-body-${++ruleControlSequence}`;
    body.hidden = !expanded;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'secondary overtime-rule-toggle';
    toggle.setAttribute('aria-controls', body.id);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? '收起设置' : '展开设置';
    toggle.addEventListener('click', () => {
      const nextExpanded = body.hidden;
      body.hidden = !nextExpanded;
      row.classList.toggle('is-expanded', nextExpanded);
      toggle.setAttribute('aria-expanded', String(nextExpanded));
      toggle.textContent = nextExpanded ? '收起设置' : '展开设置';
    });
    controls.append(toggle);
    header.append(controls);
    row.append(header);

    const modeSection = document.createElement('section');
    modeSection.className = 'overtime-rule-mode';
    const modeOptions = document.createElement('fieldset');
    modeOptions.className = 'overtime-rule-mode-options';
    const modeLegend = document.createElement('legend');
    modeLegend.textContent = '选择礼物生效方式';
    modeOptions.append(modeLegend);
    const modeName = `overtime-rule-mode-${++ruleControlSequence}`;
    modeOptions.append(
      createModeOption(modeName, 'fixed', '直接改时间', rule.mode !== 'random' && rule.mode !== 'display'),
      createModeOption(modeName, 'random', '随机抽结果', rule.mode === 'random'),
      createModeOption(modeName, 'display', '文字展板', rule.mode === 'display')
    );
    const quantityOptions = document.createElement('fieldset');
    quantityOptions.className = 'overtime-rule-quantity-options';
    const quantityLegend = document.createElement('legend');
    quantityLegend.textContent = '选择数量计算方式';
    quantityOptions.append(quantityLegend);
    const quantityName = `overtime-rule-quantity-${++ruleControlSequence}`;
    quantityOptions.append(
      createQuantityOption(quantityName, 'group', '按连击组', '同一次连击只结算一次', rule.quantityMode !== 'item'),
      createQuantityOption(quantityName, 'item', '按具体数量', '数量 ×N 就结算 N 次', rule.quantityMode === 'item')
    );
    modeSection.append(modeOptions, quantityOptions);
    body.append(modeSection);

    const effect = document.createElement('div');
    effect.className = 'overtime-rule-effect';
    renderEffectEditor(effect, rule);
    modeOptions.addEventListener('change', event => {
      if (event.target.matches('[data-rule-mode]:checked')) setEffectMode(effect, event.target.value);
    });
    body.append(effect);
    body.addEventListener('input', () => updateRuleSummary(row));
    body.addEventListener('change', () => updateRuleSummary(row));
    row.classList.toggle('is-expanded', expanded);
    row.append(body);
    return row;
  }

  function renderEffectEditor(root, rule) {
    const { minRandomOutcomes, maxRandomOutcomes } = getLimits();
    root.replaceChildren();
    const fixedPanel = document.createElement('section');
    fixedPanel.className = 'overtime-fixed-editor';
    fixedPanel.dataset.effectMode = 'fixed';
    const sentence = document.createElement('div');
    sentence.className = 'overtime-effect-sentence';
    sentence.append(createEffectControls(normalizeEffect(rule.fixedEffect, rule.fixedSeconds)));
    fixedPanel.append(sentence);

    const randomPanel = document.createElement('section');
    randomPanel.className = 'overtime-random-editor';
    randomPanel.dataset.effectMode = 'random';
    const randomHint = document.createElement('div');
    randomHint.className = 'overtime-random-hint';
    const randomHintTitle = document.createElement('strong');
    randomHintTitle.textContent = '机会值';
    randomHintTitle.append(createHelp('数值越大越容易抽中；系统会自动换算百分比。'));
    randomHint.append(randomHintTitle);
    randomPanel.append(randomHint);

    const outcomeList = document.createElement('div');
    outcomeList.className = 'overtime-outcome-list';
    outcomeList.dataset.outcomeList = 'true';
    const outcomes = Array.isArray(rule.outcomes) && rule.outcomes.length >= minRandomOutcomes
      ? rule.outcomes
      : createDefaultOutcomes(minRandomOutcomes);
    outcomes.forEach((outcome, outcomeIndex) => outcomeList.append(createOutcomeCard(outcome, outcomeIndex)));
    randomPanel.append(outcomeList);

    const randomFooter = document.createElement('div');
    randomFooter.className = 'overtime-random-footer';
    const outcomeCount = document.createElement('span');
    outcomeCount.dataset.outcomeCount = 'true';
    const addOutcome = document.createElement('button');
    addOutcome.type = 'button';
    addOutcome.className = 'secondary overtime-add-outcome';
    addOutcome.dataset.addOutcome = 'true';
    addOutcome.textContent = '＋ 添加结果';
    addOutcome.addEventListener('click', () => {
      if (outcomeList.children.length >= maxRandomOutcomes) return;
      outcomeList.append(createOutcomeCard({ operation: 'add', value: 60, weight: 10 }, outcomeList.children.length));
      refreshOutcomeCards(randomPanel);
      updateRuleSummary(randomPanel.closest('[data-overtime-rule]'));
      outcomeList.lastElementChild.querySelector('input')?.focus();
    });
    randomFooter.append(outcomeCount, addOutcome);
    randomPanel.append(randomFooter);
    randomPanel.addEventListener('input', event => {
      if (event.target.matches('[data-outcome-weight]')) updateOutcomeProbabilities(randomPanel);
    });

    const displayPanel = document.createElement('section');
    displayPanel.className = 'overtime-display-editor';
    displayPanel.dataset.effectMode = 'display';
    const displayLabel = document.createElement('label');
    displayLabel.className = 'overtime-display-input';
    const displayCaption = document.createElement('span');
    displayCaption.textContent = '展示文字';
    displayCaption.append(createHelp('只显示文字，不改变剩余时间。'));
    const displayInput = document.createElement('input');
    const maxDisplayTextLength = getLimits().maxDisplayTextLength;
    displayInput.type = 'text';
    displayInput.maxLength = maxDisplayTextLength;
    displayInput.value = String(rule.displayText || '');
    displayInput.placeholder = `最多 ${maxDisplayTextLength} 个字符`;
    displayInput.autocomplete = 'off';
    displayInput.dataset.displayText = 'true';
    displayInput.setAttribute('aria-label', `文字展板内容，最多 ${maxDisplayTextLength} 个字符`);
    displayLabel.append(displayCaption, displayInput);
    displayPanel.append(displayLabel);

    root.append(fixedPanel, randomPanel, displayPanel);
    refreshOutcomeCards(randomPanel);
    setEffectMode(root, ['random', 'display'].includes(rule.mode) ? rule.mode : 'fixed');
  }

  function createModeOption(name, value, title, checked) {
    const label = document.createElement('label');
    label.className = `overtime-mode-option is-${value}`;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.dataset.ruleMode = 'true';
    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = title;
    copy.append(strong);
    label.append(input, copy);
    return label;
  }

  function createQuantityOption(name, value, title, description, checked) {
    const label = document.createElement('label');
    label.className = 'overtime-mode-option is-quantity';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.dataset.ruleQuantityMode = 'true';
    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = title;
    strong.append(createHelp(description));
    copy.append(strong);
    label.append(input, copy);
    return label;
  }

  function normalizeEffect(effect, legacySeconds) {
    const operation = String(effect?.operation || '');
    if (['add', 'subtract', 'multiply', 'divide', 'clear'].includes(operation)) {
      return { operation, value: Math.max(0, Math.floor(Number(effect.value) || 0)) };
    }
    const seconds = Math.trunc(Number(legacySeconds) || 0);
    return seconds < 0
      ? { operation: 'subtract', value: Math.abs(seconds) }
      : { operation: 'add', value: seconds };
  }

  function createEffectControls(effect) {
    const root = document.createElement('div');
    root.className = 'overtime-effect-controls';
    const operation = createOperationControl(effect.operation);
    const duration = createDurationControl(effect.value);
    duration.dataset.effectDuration = 'true';
    const factor = createFactorControl(['multiply', 'divide'].includes(effect.operation) ? effect.value : 2);
    const clearHint = document.createElement('strong');
    clearHint.className = 'overtime-clear-hint';
    clearHint.dataset.effectClear = 'true';
    clearHint.textContent = '收到礼物后，剩余时间立即归零';
    root.append(operation, duration, factor, clearHint);
    operation.addEventListener('change', () => syncEffectControls(root));
    syncEffectControls(root);
    return root;
  }

  function createOperationControl(selected) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'overtime-operation-control';
    const legend = document.createElement('legend');
    legend.textContent = '选择时间操作';
    fieldset.append(legend);
    const name = `overtime-rule-operation-${++ruleControlSequence}`;
    fieldset.append(
      createOperationOption(name, 'add', '增加', '＋', selected === 'add'),
      createOperationOption(name, 'subtract', '减少', '－', selected === 'subtract'),
      createOperationOption(name, 'multiply', '乘倍数', '×', selected === 'multiply'),
      createOperationOption(name, 'divide', '除倍数', '÷', selected === 'divide'),
      createOperationOption(name, 'clear', '清零', '0', selected === 'clear')
    );
    return fieldset;
  }

  function createOperationOption(name, value, labelText, symbol, checked) {
    const label = document.createElement('label');
    label.className = `overtime-operation-option is-${value}`;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.dataset.ruleOperation = 'true';
    const symbolNode = document.createElement('span');
    symbolNode.textContent = symbol;
    const text = document.createElement('strong');
    text.textContent = labelText;
    label.append(input, symbolNode, text);
    return label;
  }

  function createFactorControl(value) {
    const label = document.createElement('label');
    label.className = 'overtime-factor-control';
    label.dataset.effectFactorControl = 'true';
    const caption = document.createElement('span');
    caption.textContent = '倍数';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '2';
    input.step = '1';
    input.value = String(value);
    input.inputMode = 'numeric';
    input.dataset.effectFactor = 'true';
    input.setAttribute('aria-label', '时间变化倍数，最小 2');
    caption.append(createHelp('最小 2 倍。'));
    label.append(caption, input);
    return label;
  }

  function createHelp(text) {
    const help = document.createElement('lira-help');
    help.textContent = text;
    return help;
  }

  function syncEffectControls(root) {
    const operation = root.querySelector('[data-rule-operation]:checked')?.value;
    root.querySelector('[data-effect-duration]').hidden = !['add', 'subtract'].includes(operation);
    root.querySelector('[data-effect-factor-control]').hidden = !['multiply', 'divide'].includes(operation);
    root.querySelector('[data-effect-clear]').hidden = operation !== 'clear';
  }

  function createDurationControl(seconds) {
    const absoluteSeconds = Math.abs(Math.trunc(Number(seconds) || 0));
    const values = {
      hours: Math.floor(absoluteSeconds / 3600),
      minutes: Math.floor((absoluteSeconds % 3600) / 60),
      seconds: absoluteSeconds % 60
    };
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'overtime-duration-control';
    const legend = document.createElement('legend');
    legend.textContent = '填写时长';
    fieldset.append(legend);
    fieldset.append(
      createDurationPart('hours', '小时', values.hours, 999),
      createDurationPart('minutes', '分钟', values.minutes, 59),
      createDurationPart('seconds', '秒', values.seconds, 59)
    );
    return fieldset;
  }

  function createDurationPart(part, labelText, value, maximum) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(maximum);
    input.step = '1';
    input.value = String(value);
    input.inputMode = 'numeric';
    input.dataset[`duration${part[0].toUpperCase()}${part.slice(1)}`] = 'true';
    input.setAttribute('aria-label', `时长的${labelText}`);
    const unit = document.createElement('span');
    unit.textContent = labelText;
    label.append(input, unit);
    return label;
  }

  function createOutcomeCard(outcome, index) {
    const card = document.createElement('article');
    card.className = 'overtime-outcome-card';
    card.dataset.randomOutcome = 'true';
    const heading = document.createElement('header');
    const title = document.createElement('strong');
    title.dataset.outcomeTitle = 'true';
    title.textContent = `可能结果 ${index + 1}`;
    const probability = document.createElement('span');
    probability.className = 'overtime-outcome-probability';
    probability.dataset.outcomeProbability = 'true';
    probability.textContent = '—';
    heading.append(title, probability);

    const result = document.createElement('div');
    result.className = 'overtime-outcome-result';
    result.append(createEffectControls(normalizeEffect(outcome, outcome?.seconds)));

    const chance = document.createElement('label');
    chance.className = 'overtime-outcome-weight';
    const chanceText = document.createElement('span');
    chanceText.textContent = '抽中机会';
    const weight = document.createElement('input');
    weight.type = 'number';
    weight.min = '1';
    weight.step = '1';
    weight.value = String(Number(outcome.weight) || 1);
    weight.inputMode = 'numeric';
    weight.dataset.outcomeWeight = 'true';
    weight.setAttribute('aria-label', `可能结果 ${index + 1} 的抽中机会`);
    const chanceUnit = document.createElement('span');
    chanceUnit.textContent = '份';
    chance.append(chanceText, weight, chanceUnit);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary overtime-remove-outcome';
    remove.dataset.removeOutcome = 'true';
    remove.textContent = '删除结果';
    remove.addEventListener('click', () => {
      const editor = card.closest('.overtime-random-editor');
      if (!editor || editor.querySelectorAll('[data-random-outcome]').length <= getLimits().minRandomOutcomes) return;
      const row = card.closest('[data-overtime-rule]');
      card.remove();
      refreshOutcomeCards(editor);
      updateRuleSummary(row);
    });
    card.append(heading, result, chance, remove);
    return card;
  }

  function createDefaultOutcomes(count) {
    const outcomes = [
      { operation: 'add', value: 300, weight: 50 },
      { operation: 'subtract', value: 180, weight: 50 }
    ];
    while (outcomes.length < count) outcomes.push({ operation: 'add', value: 60, weight: 10 });
    return outcomes.slice(0, count);
  }

  function refreshOutcomeCards(root) {
    const { minRandomOutcomes, maxRandomOutcomes } = getLimits();
    const cards = Array.from(root.querySelectorAll('[data-random-outcome]'));
    cards.forEach((card, index) => {
      card.querySelector('[data-outcome-title]').textContent = `可能结果 ${index + 1}`;
      card.querySelector('[data-outcome-weight]').setAttribute('aria-label', `可能结果 ${index + 1} 的抽中机会`);
      const remove = card.querySelector('[data-remove-outcome]');
      remove.disabled = cards.length <= minRandomOutcomes;
      remove.textContent = remove.disabled ? `至少保留 ${minRandomOutcomes} 个结果` : '删除结果';
    });
    const count = root.querySelector('[data-outcome-count]');
    if (count) count.textContent = `${cards.length} 个结果（最多 ${maxRandomOutcomes} 个）`;
    const add = root.querySelector('[data-add-outcome]');
    if (add) add.disabled = cards.length >= maxRandomOutcomes;
    updateOutcomeProbabilities(root);
  }

  function updateOutcomeProbabilities(root) {
    const cards = Array.from(root.querySelectorAll('[data-random-outcome]'));
    const weights = cards.map(card => Number(card.querySelector('[data-outcome-weight]').value));
    const valid = weights.every(weight => Number.isSafeInteger(weight) && weight > 0);
    const total = valid ? weights.reduce((sum, weight) => sum + weight, 0) : 0;
    cards.forEach((card, index) => {
      const badge = card.querySelector('[data-outcome-probability]');
      if (!total) {
        badge.textContent = '—';
        badge.title = '填写有效的抽中机会后自动计算';
        return;
      }
      const percentage = weights[index] / total * 100;
      const formatted = Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1);
      badge.textContent = `约 ${formatted}%`;
      badge.title = `${weights[index]} ÷ ${total}，自动换算`;
    });
  }

  function setEffectMode(root, mode) {
    root.querySelectorAll('[data-effect-mode]').forEach(panel => {
      panel.hidden = panel.dataset.effectMode !== mode;
    });
    root.classList.toggle('is-random', mode === 'random');
    root.classList.toggle('is-display', mode === 'display');
  }

  function updateRuleSummary(row) {
    if (!row) return;
    const summary = row.querySelector('[data-rule-summary]');
    const mode = row.querySelector('[data-rule-mode]:checked')?.value;
    if (!summary || !mode) return;
    const quantityMode = row.querySelector('[data-rule-quantity-mode]:checked')?.value;
    const quantityLabel = describeQuantityMode(quantityMode);
    if (mode === 'display') {
      const displayText = String(row.querySelector('[data-display-text]')?.value || '').trim();
      summary.textContent = `文字展板 · ${displayText || '未填写'} · ${quantityLabel}`;
      return;
    }
    if (mode === 'random') {
      const count = row.querySelectorAll('[data-random-outcome]').length;
      summary.textContent = `随机抽取 · ${count} 个结果 · ${quantityLabel}`;
      return;
    }
    const panel = row.querySelector('[data-effect-mode="fixed"]');
    const operation = panel?.querySelector('[data-rule-operation]:checked')?.value;
    if (!operation) return;
    if (operation === 'clear') {
      summary.textContent = `剩余时间清零 · ${quantityLabel}`;
      return;
    }
    if (operation === 'multiply' || operation === 'divide') {
      const value = Math.max(0, Math.floor(Number(panel.querySelector('[data-effect-factor]')?.value) || 0));
      summary.textContent = `${operation === 'multiply' ? `剩余时间乘 ${value}` : `剩余时间除以 ${value}`} · ${quantityLabel}`;
      return;
    }
    const hours = Number(panel.querySelector('[data-duration-hours]')?.value) || 0;
    const minutes = Number(panel.querySelector('[data-duration-minutes]')?.value) || 0;
    const seconds = Number(panel.querySelector('[data-duration-seconds]')?.value) || 0;
    summary.textContent = `${operation === 'subtract' ? '减少' : '增加'} ${formatDurationSummary(hours * 3600 + minutes * 60 + seconds)} · ${quantityLabel}`;
  }

  function describeRule(rule) {
    if (rule.mode === 'display') {
      return `文字展板 · ${rule.displayText || '未填写'} · ${describeQuantityMode(rule.quantityMode)}`;
    }
    if (rule.mode === 'random') {
      const minRandomOutcomes = getLimits().minRandomOutcomes;
      const count = Array.isArray(rule.outcomes) && rule.outcomes.length >= minRandomOutcomes
        ? rule.outcomes.length
        : minRandomOutcomes;
      return `随机抽取 · ${count} 个结果 · ${describeQuantityMode(rule.quantityMode)}`;
    }
    return `${describeEffect(normalizeEffect(rule.fixedEffect, rule.fixedSeconds))} · ${describeQuantityMode(rule.quantityMode)}`;
  }

  function describeQuantityMode(value) {
    return value === 'item' ? '按具体数量' : '按连击组';
  }

  function describeEffect(effect) {
    if (effect.operation === 'clear') return '剩余时间清零';
    if (effect.operation === 'multiply') return `剩余时间乘 ${effect.value}`;
    if (effect.operation === 'divide') return `剩余时间除以 ${effect.value}`;
    return `${effect.operation === 'subtract' ? '减少' : '增加'} ${formatDurationSummary(effect.value)}`;
  }

  function formatDurationSummary(seconds) {
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
      if (!Number.isSafeInteger(value) || value < 2) {
        throw new Error('倍数应填写大于等于 2 的整数。');
      }
      return { operation, value };
    }
    const hours = readDurationPart(root, 'hours', '小时', 999);
    const minutes = readDurationPart(root, 'minutes', '分钟', 59);
    const seconds = readDurationPart(root, 'seconds', '秒', 59);
    const absoluteSeconds = hours * 3600 + minutes * 60 + seconds;
    return { operation, value: absoluteSeconds };
  }

  function readDurationPart(root, part, label, maximum) {
    const value = Number(root.querySelector(`[data-duration-${part}]`)?.value);
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new Error(`${label}应填写 0–${maximum} 的整数。`);
    }
    return value;
  }

  function ruleButton(label, title, disabled, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.disabled = disabled;
    button.addEventListener('click', handler);
    return button;
  }

  function moveRule(row, direction) {
    const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    markDirty();
    if (direction < 0) row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
  }


  function createMessage(className, message) {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = message;
    return node;
  }

  return { readRules, renderRules, createRule, setLimits };
}

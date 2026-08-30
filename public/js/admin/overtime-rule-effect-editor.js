import { normalizeEffect } from './overtime-rule-model.js';

export function createOvertimeRuleEffectEditor({
  createHelp,
  document: documentRef,
  getLimits,
  nextControlId,
  updateRuleSummary,
}) {
  function renderEffectEditor(root, rule) {
    const { minRandomOutcomes, maxRandomOutcomes } = getLimits();
    root.replaceChildren();
    const fixedPanel = documentRef.createElement('section');
    fixedPanel.className = 'overtime-fixed-editor';
    fixedPanel.dataset.effectMode = 'fixed';
    const sentence = documentRef.createElement('div');
    sentence.className = 'overtime-effect-sentence';
    sentence.append(
      createEffectControls(
        normalizeEffect(rule.fixedEffect, rule.fixedSeconds),
      ),
    );
    fixedPanel.append(sentence);

    const randomPanel = documentRef.createElement('section');
    randomPanel.className = 'overtime-random-editor';
    randomPanel.dataset.effectMode = 'random';
    const randomHint = documentRef.createElement('div');
    randomHint.className = 'overtime-random-hint';
    const randomHintTitle = documentRef.createElement('strong');
    randomHintTitle.textContent = '机会值';
    randomHintTitle.append(
      createHelp('数值越大越容易抽中；系统会自动换算百分比。'),
    );
    randomHint.append(randomHintTitle);
    randomPanel.append(randomHint);

    const outcomeList = documentRef.createElement('div');
    outcomeList.className = 'overtime-outcome-list';
    outcomeList.dataset.outcomeList = 'true';
    const outcomes =
      Array.isArray(rule.outcomes) && rule.outcomes.length >= minRandomOutcomes
        ? rule.outcomes
        : createDefaultOutcomes(minRandomOutcomes);
    outcomes.forEach((outcome, outcomeIndex) =>
      outcomeList.append(createOutcomeCard(outcome, outcomeIndex)),
    );
    randomPanel.append(outcomeList);

    const randomFooter = documentRef.createElement('div');
    randomFooter.className = 'overtime-random-footer';
    const outcomeCount = documentRef.createElement('span');
    outcomeCount.dataset.outcomeCount = 'true';
    const addOutcome = documentRef.createElement('button');
    addOutcome.type = 'button';
    addOutcome.className = 'secondary overtime-add-outcome';
    addOutcome.dataset.addOutcome = 'true';
    addOutcome.textContent = '＋ 添加结果';
    addOutcome.addEventListener('click', () => {
      if (outcomeList.children.length >= maxRandomOutcomes) return;
      outcomeList.append(
        createOutcomeCard(
          { operation: 'add', value: 60, weight: 10 },
          outcomeList.children.length,
        ),
      );
      refreshOutcomeCards(randomPanel);
      updateRuleSummary(randomPanel.closest('[data-overtime-rule]'));
      outcomeList.lastElementChild.querySelector('input')?.focus();
    });
    randomFooter.append(outcomeCount, addOutcome);
    randomPanel.append(randomFooter);
    randomPanel.addEventListener('input', (event) => {
      if (event.target.matches('[data-outcome-weight]'))
        updateOutcomeProbabilities(randomPanel);
    });

    const displayPanel = documentRef.createElement('section');
    displayPanel.className = 'overtime-display-editor';
    displayPanel.dataset.effectMode = 'display';
    const displayLabel = documentRef.createElement('label');
    displayLabel.className = 'overtime-display-input';
    const displayCaption = documentRef.createElement('span');
    displayCaption.textContent = '展示文字';
    displayCaption.append(createHelp('只显示文字，不改变剩余时间。'));
    const displayInput = documentRef.createElement('input');
    const maxDisplayTextLength = getLimits().maxDisplayTextLength;
    displayInput.type = 'text';
    displayInput.maxLength = maxDisplayTextLength;
    displayInput.value = String(rule.displayText || '');
    displayInput.placeholder = `最多 ${maxDisplayTextLength} 个字符`;
    displayInput.autocomplete = 'off';
    displayInput.dataset.displayText = 'true';
    displayInput.setAttribute(
      'aria-label',
      `文字展板内容，最多 ${maxDisplayTextLength} 个字符`,
    );
    displayLabel.append(displayCaption, displayInput);
    displayPanel.append(displayLabel);

    root.append(fixedPanel, randomPanel, displayPanel);
    refreshOutcomeCards(randomPanel);
    setEffectMode(
      root,
      ['random', 'display'].includes(rule.mode) ? rule.mode : 'fixed',
    );
  }

  function createEffectControls(effect) {
    const root = documentRef.createElement('div');
    root.className = 'overtime-effect-controls';
    const operation = createOperationControl(effect.operation);
    const duration = createDurationControl(effect.value);
    duration.dataset.effectDuration = 'true';
    const factor = createFactorControl(
      ['multiply', 'divide'].includes(effect.operation) ? effect.value : 2,
    );
    const clearHint = documentRef.createElement('strong');
    clearHint.className = 'overtime-clear-hint';
    clearHint.dataset.effectClear = 'true';
    clearHint.textContent = '收到礼物后，剩余时间立即归零';
    root.append(operation, duration, factor, clearHint);
    operation.addEventListener('change', () => syncEffectControls(root));
    syncEffectControls(root);
    return root;
  }

  function createOperationControl(selected) {
    const fieldset = documentRef.createElement('fieldset');
    fieldset.className = 'overtime-operation-control';
    const legend = documentRef.createElement('legend');
    legend.textContent = '选择时间操作';
    fieldset.append(legend);
    const name = nextControlId('operation');
    fieldset.append(
      createOperationOption(name, 'add', '增加', '＋', selected === 'add'),
      createOperationOption(
        name,
        'subtract',
        '减少',
        '－',
        selected === 'subtract',
      ),
      createOperationOption(
        name,
        'multiply',
        '乘倍数',
        '×',
        selected === 'multiply',
      ),
      createOperationOption(
        name,
        'divide',
        '除倍数',
        '÷',
        selected === 'divide',
      ),
      createOperationOption(name, 'clear', '清零', '0', selected === 'clear'),
    );
    return fieldset;
  }

  function createOperationOption(name, value, labelText, symbol, checked) {
    const label = documentRef.createElement('label');
    label.className = `overtime-operation-option is-${value}`;
    const input = documentRef.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.dataset.ruleOperation = 'true';
    const symbolNode = documentRef.createElement('span');
    symbolNode.textContent = symbol;
    const text = documentRef.createElement('strong');
    text.textContent = labelText;
    label.append(input, symbolNode, text);
    return label;
  }

  function createFactorControl(value) {
    const label = documentRef.createElement('label');
    label.className = 'overtime-factor-control';
    label.dataset.effectFactorControl = 'true';
    const caption = documentRef.createElement('span');
    caption.textContent = '倍数';
    const input = documentRef.createElement('input');
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

  function syncEffectControls(root) {
    const operation = root.querySelector(
      '[data-rule-operation]:checked',
    )?.value;
    root.querySelector('[data-effect-duration]').hidden = ![
      'add',
      'subtract',
    ].includes(operation);
    root.querySelector('[data-effect-factor-control]').hidden = ![
      'multiply',
      'divide',
    ].includes(operation);
    root.querySelector('[data-effect-clear]').hidden = operation !== 'clear';
  }

  function createDurationControl(seconds) {
    const absoluteSeconds = Math.abs(Math.trunc(Number(seconds) || 0));
    const values = {
      hours: Math.floor(absoluteSeconds / 3600),
      minutes: Math.floor((absoluteSeconds % 3600) / 60),
      seconds: absoluteSeconds % 60,
    };
    const fieldset = documentRef.createElement('fieldset');
    fieldset.className = 'overtime-duration-control';
    const legend = documentRef.createElement('legend');
    legend.textContent = '填写时长';
    fieldset.append(legend);
    fieldset.append(
      createDurationPart('hours', '小时', values.hours, 999),
      createDurationPart('minutes', '分钟', values.minutes, 59),
      createDurationPart('seconds', '秒', values.seconds, 59),
    );
    return fieldset;
  }

  function createDurationPart(part, labelText, value, maximum) {
    const label = documentRef.createElement('label');
    const input = documentRef.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(maximum);
    input.step = '1';
    input.value = String(value);
    input.inputMode = 'numeric';
    input.dataset[`duration${part[0].toUpperCase()}${part.slice(1)}`] = 'true';
    input.setAttribute('aria-label', `时长的${labelText}`);
    const unit = documentRef.createElement('span');
    unit.textContent = labelText;
    label.append(input, unit);
    return label;
  }

  function createOutcomeCard(outcome, index) {
    const card = documentRef.createElement('article');
    card.className = 'overtime-outcome-card';
    card.dataset.randomOutcome = 'true';
    const heading = documentRef.createElement('header');
    const title = documentRef.createElement('strong');
    title.dataset.outcomeTitle = 'true';
    title.textContent = `可能结果 ${index + 1}`;
    const probability = documentRef.createElement('span');
    probability.className = 'overtime-outcome-probability';
    probability.dataset.outcomeProbability = 'true';
    probability.textContent = '—';
    heading.append(title, probability);

    const result = documentRef.createElement('div');
    result.className = 'overtime-outcome-result';
    result.append(
      createEffectControls(normalizeEffect(outcome, outcome?.seconds)),
    );

    const chance = documentRef.createElement('label');
    chance.className = 'overtime-outcome-weight';
    const chanceText = documentRef.createElement('span');
    chanceText.textContent = '抽中机会';
    const weight = documentRef.createElement('input');
    weight.type = 'number';
    weight.min = '1';
    weight.step = '1';
    weight.value = String(Number(outcome.weight) || 1);
    weight.inputMode = 'numeric';
    weight.dataset.outcomeWeight = 'true';
    weight.setAttribute('aria-label', `可能结果 ${index + 1} 的抽中机会`);
    const chanceUnit = documentRef.createElement('span');
    chanceUnit.textContent = '份';
    chance.append(chanceText, weight, chanceUnit);

    const remove = documentRef.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary overtime-remove-outcome';
    remove.dataset.removeOutcome = 'true';
    remove.textContent = '删除结果';
    remove.addEventListener('click', () => {
      const editor = card.closest('.overtime-random-editor');
      if (
        !editor ||
        editor.querySelectorAll('[data-random-outcome]').length <=
          getLimits().minRandomOutcomes
      )
        return;
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
      { operation: 'subtract', value: 180, weight: 50 },
    ];
    while (outcomes.length < count)
      outcomes.push({ operation: 'add', value: 60, weight: 10 });
    return outcomes.slice(0, count);
  }

  function refreshOutcomeCards(root) {
    const { minRandomOutcomes, maxRandomOutcomes } = getLimits();
    const cards = Array.from(root.querySelectorAll('[data-random-outcome]'));
    cards.forEach((card, index) => {
      card.querySelector('[data-outcome-title]').textContent =
        `可能结果 ${index + 1}`;
      card
        .querySelector('[data-outcome-weight]')
        .setAttribute('aria-label', `可能结果 ${index + 1} 的抽中机会`);
      const remove = card.querySelector('[data-remove-outcome]');
      remove.disabled = cards.length <= minRandomOutcomes;
      remove.textContent = remove.disabled
        ? `至少保留 ${minRandomOutcomes} 个结果`
        : '删除结果';
    });
    const count = root.querySelector('[data-outcome-count]');
    if (count)
      count.textContent = `${cards.length} 个结果（最多 ${maxRandomOutcomes} 个）`;
    const add = root.querySelector('[data-add-outcome]');
    if (add) add.disabled = cards.length >= maxRandomOutcomes;
    updateOutcomeProbabilities(root);
  }

  function updateOutcomeProbabilities(root) {
    const cards = Array.from(root.querySelectorAll('[data-random-outcome]'));
    const weights = cards.map((card) =>
      Number(card.querySelector('[data-outcome-weight]').value),
    );
    const valid = weights.every(
      (weight) => Number.isSafeInteger(weight) && weight > 0,
    );
    const total = valid ? weights.reduce((sum, weight) => sum + weight, 0) : 0;
    cards.forEach((card, index) => {
      const badge = card.querySelector('[data-outcome-probability]');
      if (!total) {
        badge.textContent = '—';
        badge.title = '填写有效的抽中机会后自动计算';
        return;
      }
      const percentage = (weights[index] / total) * 100;
      const formatted = Number.isInteger(percentage)
        ? percentage.toFixed(0)
        : percentage.toFixed(1);
      badge.textContent = `约 ${formatted}%`;
      badge.title = `${weights[index]} ÷ ${total}，自动换算`;
    });
  }

  function setEffectMode(root, mode) {
    root.querySelectorAll('[data-effect-mode]').forEach((panel) => {
      panel.hidden = panel.dataset.effectMode !== mode;
    });
    root.classList.toggle('is-random', mode === 'random');
    root.classList.toggle('is-display', mode === 'display');
  }

  return { renderEffectEditor, setEffectMode };
}

'use strict';

import {
  describeQuantityMode,
  describeRule,
  formatDurationSummary,
  readRules,
} from './overtime-rule-model.js';
import { createOvertimeRuleEffectEditor } from './overtime-rule-effect-editor.js';

const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';

export function createOvertimeRuleEditor(root, markDirty, dependencies = {}) {
  const documentRef =
    dependencies.document || root.ownerDocument || globalThis.document;
  let ruleControlSequence = 0;
  let limits = null;

  const effectEditor = createOvertimeRuleEffectEditor({
    createHelp,
    document: documentRef,
    getLimits,
    nextControlId: (kind) => `overtime-rule-${kind}-${++ruleControlSequence}`,
    updateRuleSummary,
  });

  function setLimits(nextLimits) {
    const normalized = {
      maxEnabledRules: Number(nextLimits?.maxEnabledRules),
      minRandomOutcomes: Number(nextLimits?.minRandomOutcomes),
      maxRandomOutcomes: Number(nextLimits?.maxRandomOutcomes),
      maxDisplayTextLength:
        nextLimits?.maxDisplayTextLength === undefined
          ? 6
          : Number(nextLimits.maxDisplayTextLength),
    };
    if (
      !Object.values(normalized).every(Number.isSafeInteger) ||
      normalized.maxEnabledRules < 1 ||
      normalized.minRandomOutcomes < 1 ||
      normalized.maxRandomOutcomes < normalized.minRandomOutcomes ||
      normalized.maxDisplayTextLength < 1
    ) {
      throw new Error('加班机规则限制加载失败。');
    }
    limits = normalized;
  }

  function getLimits() {
    if (!limits) throw new Error('加班机规则限制尚未加载。');
    return limits;
  }

  function renderRules(rules) {
    root.replaceChildren();
    if (!rules.length) {
      root.append(
        createMessage(
          'overtime-rule-empty',
          '还没有规则。添加礼物后设置固定时间或时间盲盒。',
        ),
      );
      return;
    }
    rules.forEach((rule, index) =>
      root.append(createRuleRow(rule, index, rules.length)),
    );
  }

  function createRule(gift) {
    const { maxEnabledRules } = getLimits();
    root.querySelector('.overtime-rule-empty')?.remove();
    markDirty();
    const count = root.querySelectorAll('[data-overtime-rule]').length;
    const row = createRuleRow(
      {
        giftId: gift.id,
        giftName: gift.name,
        imagePath: gift.imagePath,
        mode: 'fixed',
        quantityMode: String(gift.id).startsWith('guard-') ? 'item' : 'group',
        fixedEffect: { operation: 'add', value: 300 },
        outcomes: [],
        enabled: count < maxEnabledRules,
        sortOrder: count,
      },
      count,
      count + 1,
      true,
    );
    root.append(row);
    return row;
  }

  function createRuleRow(rule, index, count, expanded = false) {
    const row = documentRef.createElement('article');
    row.className = 'overtime-rule-row';
    row.dataset.overtimeRule = 'true';
    row.dataset.giftId = String(rule.giftId);
    row.dataset.giftName = String(rule.giftName || rule.giftId);
    row.dataset.imagePath = String(rule.imagePath || '');

    const header = documentRef.createElement('header');
    header.className = 'overtime-rule-header';
    const gift = documentRef.createElement('div');
    gift.className = 'overtime-rule-gift';
    const image = documentRef.createElement('img');
    image.src = rule.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener(
      'error',
      () => {
        image.src = PLACEHOLDER;
      },
      { once: true },
    );
    gift.append(image);

    const identity = documentRef.createElement('div');
    identity.className = 'overtime-rule-identity';
    const name = documentRef.createElement('strong');
    name.textContent = rule.giftName || `礼物 ${rule.giftId}`;
    const summary = documentRef.createElement('small');
    summary.className = 'overtime-rule-summary';
    summary.dataset.ruleSummary = 'true';
    summary.textContent = describeRule(rule, getLimits().minRandomOutcomes);
    identity.append(name, summary);
    gift.append(identity);
    header.append(gift);

    const controls = documentRef.createElement('div');
    controls.className = 'overtime-rule-buttons';
    const enabledLabel = documentRef.createElement('label');
    enabledLabel.className = 'overtime-rule-enabled';
    const enabled = documentRef.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.dataset.ruleEnabled = 'true';
    enabledLabel.append(
      enabled,
      documentRef.createElement('span'),
      documentRef.createTextNode('启用'),
    );
    controls.append(enabledLabel);
    const moveUp = ruleButton('↑', '将这条规则上移', index === 0, () =>
      moveRule(row, -1),
    );
    moveUp.classList.add('overtime-rule-icon-button');
    const moveDown = ruleButton(
      '↓',
      '将这条规则下移',
      index === count - 1,
      () => moveRule(row, 1),
    );
    moveDown.classList.add('overtime-rule-icon-button');
    controls.append(moveUp, moveDown);
    const remove = ruleButton('删除', '删除规则', false, () => {
      markDirty();
      row.remove();
    });
    remove.classList.add('overtime-rule-remove');
    controls.append(remove);

    const body = documentRef.createElement('div');
    body.className = 'overtime-rule-body';
    body.id = `overtime-rule-body-${++ruleControlSequence}`;
    body.hidden = !expanded;
    const toggle = documentRef.createElement('button');
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

    const modeSection = documentRef.createElement('section');
    modeSection.className = 'overtime-rule-mode';
    const modeOptions = documentRef.createElement('fieldset');
    modeOptions.className = 'overtime-rule-mode-options';
    const modeLegend = documentRef.createElement('legend');
    modeLegend.textContent = '选择礼物生效方式';
    modeOptions.append(modeLegend);
    const modeName = `overtime-rule-mode-${++ruleControlSequence}`;
    modeOptions.append(
      createModeOption(
        modeName,
        'fixed',
        '直接改时间',
        rule.mode !== 'random' && rule.mode !== 'display',
      ),
      createModeOption(
        modeName,
        'random',
        '随机抽结果',
        rule.mode === 'random',
      ),
      createModeOption(
        modeName,
        'display',
        '文字展板',
        rule.mode === 'display',
      ),
    );
    const quantityOptions = documentRef.createElement('fieldset');
    quantityOptions.className = 'overtime-rule-quantity-options';
    const quantityLegend = documentRef.createElement('legend');
    quantityLegend.textContent = '选择数量计算方式';
    quantityOptions.append(quantityLegend);
    const quantityName = `overtime-rule-quantity-${++ruleControlSequence}`;
    quantityOptions.append(
      createQuantityOption(
        quantityName,
        'group',
        '按连击组',
        '同一次连击只结算一次',
        rule.quantityMode !== 'item',
      ),
      createQuantityOption(
        quantityName,
        'item',
        '按具体数量',
        '数量 ×N 就结算 N 次',
        rule.quantityMode === 'item',
      ),
    );
    modeSection.append(modeOptions, quantityOptions);
    body.append(modeSection);

    const effect = documentRef.createElement('div');
    effect.className = 'overtime-rule-effect';
    effectEditor.renderEffectEditor(effect, rule);
    modeOptions.addEventListener('change', (event) => {
      if (event.target.matches('[data-rule-mode]:checked'))
        effectEditor.setEffectMode(effect, event.target.value);
    });
    body.append(effect);
    body.addEventListener('input', () => updateRuleSummary(row));
    body.addEventListener('change', () => updateRuleSummary(row));
    row.classList.toggle('is-expanded', expanded);
    row.append(body);
    return row;
  }

  function createModeOption(name, value, title, checked) {
    const label = documentRef.createElement('label');
    label.className = `overtime-mode-option is-${value}`;
    const input = documentRef.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.dataset.ruleMode = 'true';
    const copy = documentRef.createElement('span');
    const strong = documentRef.createElement('strong');
    strong.textContent = title;
    copy.append(strong);
    label.append(input, copy);
    return label;
  }

  function createQuantityOption(name, value, title, description, checked) {
    const label = documentRef.createElement('label');
    label.className = 'overtime-mode-option is-quantity';
    const input = documentRef.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.dataset.ruleQuantityMode = 'true';
    const copy = documentRef.createElement('span');
    const strong = documentRef.createElement('strong');
    strong.textContent = title;
    strong.append(createHelp(description));
    copy.append(strong);
    label.append(input, copy);
    return label;
  }

  function updateRuleSummary(row) {
    if (!row) return;
    const summary = row.querySelector('[data-rule-summary]');
    const mode = row.querySelector('[data-rule-mode]:checked')?.value;
    if (!summary || !mode) return;
    const quantityMode = row.querySelector(
      '[data-rule-quantity-mode]:checked',
    )?.value;
    const quantityLabel = describeQuantityMode(quantityMode);
    if (mode === 'display') {
      const displayText = String(
        row.querySelector('[data-display-text]')?.value || '',
      ).trim();
      summary.textContent = `文字展板 · ${displayText || '未填写'} · ${quantityLabel}`;
      return;
    }
    if (mode === 'random') {
      const count = row.querySelectorAll('[data-random-outcome]').length;
      summary.textContent = `随机抽取 · ${count} 个结果 · ${quantityLabel}`;
      return;
    }
    const panel = row.querySelector('[data-effect-mode="fixed"]');
    const operation = panel?.querySelector(
      '[data-rule-operation]:checked',
    )?.value;
    if (!operation) return;
    if (operation === 'clear') {
      summary.textContent = `剩余时间清零 · ${quantityLabel}`;
      return;
    }
    if (operation === 'multiply' || operation === 'divide') {
      const value = Math.max(
        0,
        Math.floor(
          Number(panel.querySelector('[data-effect-factor]')?.value) || 0,
        ),
      );
      summary.textContent = `${operation === 'multiply' ? `剩余时间乘 ${value}` : `剩余时间除以 ${value}`} · ${quantityLabel}`;
      return;
    }
    const hours =
      Number(panel.querySelector('[data-duration-hours]')?.value) || 0;
    const minutes =
      Number(panel.querySelector('[data-duration-minutes]')?.value) || 0;
    const seconds =
      Number(panel.querySelector('[data-duration-seconds]')?.value) || 0;
    summary.textContent = `${operation === 'subtract' ? '减少' : '增加'} ${formatDurationSummary(hours * 3600 + minutes * 60 + seconds)} · ${quantityLabel}`;
  }

  function ruleButton(label, title, disabled, handler) {
    const button = documentRef.createElement('button');
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
    const sibling =
      direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    markDirty();
    if (direction < 0) row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
  }

  function createMessage(className, message) {
    const node = documentRef.createElement('div');
    node.className = className;
    node.textContent = message;
    return node;
  }

  function createHelp(text) {
    const help = documentRef.createElement('lira-help');
    help.textContent = text;
    return help;
  }

  return {
    readRules: () => readRules(root, getLimits()),
    renderRules,
    createRule,
    setLimits,
  };
}

'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { api, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';

const MAX_ENABLED_RULES = 8;
const MAX_RANDOM_WEIGHT = 100000;
const MAX_OUTCOME_WEIGHT = 10000;
const MAX_RANDOM_OUTCOMES = 10;
const MIN_RANDOM_OUTCOMES = 2;
const MAX_RULE_SECONDS = 24 * 60 * 60;
const MAX_INITIAL_HOURS = 999;
const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
const GUARD_GIFTS = [
  { id: 'guard-1', name: '总督', rmb: 19998, image: 'bilibili-guard-governor.png' },
  { id: 'guard-2', name: '提督', rmb: 1998, image: 'bilibili-guard-prefect.png' },
  { id: 'guard-3', name: '舰长', rmb: 138, image: 'bilibili-guard-captain.png' }
];

let initialized = false;
let overtimeState = null;
let giftDetection = null;
let catalog = [];
let settlements = [];
let anchorRemainingMs = 0;
let localAnchorMs = 0;
let rulesDirty = false;
let ruleControlSequence = 0;

function init() {
  if (initialized || !document.getElementById('overtimePanel')) return;
  initialized = true;
  bindControls();
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    giftDetection = state?.giftDetection || giftDetection;
    if (state?.overtime) renderState(state.overtime);
  });
  eventBus.on(Events.OVERTIME_UPDATED, payload => {
    renderState(payload.state);
    if (payload.adjustment) refresh().catch(showError);
  });
  loadCatalog().catch(showError);
  refresh().catch(showError);
  requestAnimationFrame(updateClock);
}

async function refresh() {
  const response = await fetch('/api/overtime');
  const payload = await readJsonResponse(response, '读取加班机失败');
  if (!payload.ok) throw new Error(payload.error || '读取加班机失败');
  settlements = payload.data.settlements || [];
  renderState(payload.data);
  renderSettlements();
}

function bindControls() {
  populateInitialDurationSelectors();
  byId('overtimeEnableBtn').addEventListener('click', () => runAction(overtimeState?.enabled ? 'disable' : 'enable'));
  byId('overtimeStartBtn').addEventListener('click', () => runAction('start'));
  byId('overtimePauseBtn').addEventListener('click', () => runAction('pause'));
  byId('overtimeResetBtn').addEventListener('click', () => runAction('reset'));
  byId('overtimeApplyTimeBtn').addEventListener('click', applyTime);
  byId('overtimeInitialTime').addEventListener('input', syncDurationSelectorsFromInput);
  byId('overtimeInitialHours').addEventListener('change', syncDurationInputFromSelectors);
  byId('overtimeInitialMinutes').addEventListener('change', syncDurationInputFromSelectors);
  byId('overtimeAddGiftBtn').addEventListener('click', openGiftPicker);
  byId('overtimeGiftSearch').addEventListener('input', renderGiftPicker);
  byId('overtimeRules').addEventListener('input', () => { rulesDirty = true; });
  byId('overtimeRules').addEventListener('change', () => { rulesDirty = true; });
  byId('overtimeSaveRulesBtn').addEventListener('click', saveRules);
  byId('overtimeSaveBackgroundBtn').addEventListener('click', saveBackground);
  byId('overtimeOpenOverlayBtn').addEventListener('click', () => window.open(overlayUrl(), '_blank', 'noopener'));
  byId('overtimeCopyOverlayBtn').addEventListener('click', copyOverlayUrl);
  byId('overtimePreview').src = '/overtime?quality=low';
}

async function runAction(action) {
  try {
    const result = await api('/api/overtime/action', { action });
    renderState(result.data);
  } catch (_) {}
}

async function applyTime() {
  try {
    const initialSeconds = parseInitialDuration(byId('overtimeInitialTime').value);
    const result = await api('/api/overtime/time', { initialSeconds, remainingSeconds: initialSeconds });
    renderState(result.data);
    toast('初始时间已设置，倒计时已重置并暂停');
  } catch (error) {
    showError(error);
  }
}

async function saveBackground() {
  try {
    const result = await api('/api/overtime/config', {
      path: byId('overtimeBackgroundPath').value,
      fit: byId('overtimeBackgroundFit').value
    });
    renderState(result.data);
    byId('overtimePreview').src = `/overtime?quality=low&t=${Date.now()}`;
    toast('直播画面已保存');
  } catch (_) {}
}

async function saveRules() {
  try {
    const rules = readRules();
    const result = await api('/api/overtime/rules', { rules });
    rulesDirty = false;
    renderState(result.data);
    toast('礼物规则已保存');
  } catch (error) {
    showError(error);
  }
}

function readRules() {
  const rows = Array.from(byId('overtimeRules').querySelectorAll('[data-overtime-rule]'));
  const rules = rows.map((row, index) => {
    const mode = row.querySelector('[data-rule-mode]:checked')?.value;
    if (!mode) throw new Error(`第 ${index + 1} 条礼物规则还没有选择生效方式。`);
    const enabled = row.querySelector('[data-rule-enabled]').checked;
    const base = {
      giftId: row.dataset.giftId,
      giftName: row.dataset.giftName,
      imagePath: row.dataset.imagePath,
      mode,
      enabled,
      sortOrder: index
    };
    if (mode === 'fixed') {
      return { ...base, fixedSeconds: readSignedDuration(row.querySelector('[data-effect-mode="fixed"]')) };
    }
    const outcomeCards = Array.from(row.querySelectorAll('[data-random-outcome]'));
    if (outcomeCards.length < MIN_RANDOM_OUTCOMES || outcomeCards.length > MAX_RANDOM_OUTCOMES) {
      throw new Error(`时间盲盒需要 ${MIN_RANDOM_OUTCOMES}–${MAX_RANDOM_OUTCOMES} 个可能结果。`);
    }
    const outcomes = outcomeCards.map((card, outcomeIndex) => {
      const weight = Number(card.querySelector('[data-outcome-weight]').value);
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > MAX_OUTCOME_WEIGHT) {
        throw new Error(`盲盒结果 ${outcomeIndex + 1} 的抽中机会应填写 1–${MAX_OUTCOME_WEIGHT} 的整数。`);
      }
      return { seconds: readSignedDuration(card), weight };
    });
    if (outcomes.reduce((sum, outcome) => sum + outcome.weight, 0) > MAX_RANDOM_WEIGHT) {
      throw new Error(`盲盒总权重不能超过 ${MAX_RANDOM_WEIGHT}。`);
    }
    return { ...base, outcomes };
  });
  if (rules.filter(rule => rule.enabled).length > MAX_ENABLED_RULES) {
    throw new Error(`最多启用 ${MAX_ENABLED_RULES} 条礼物规则。`);
  }
  return rules;
}

function renderState(nextState) {
  if (!nextState) return;
  overtimeState = { ...overtimeState, ...nextState };
  anchorRemainingMs = Number(overtimeState.effectiveRemainingMs) || 0;
  localAnchorMs = performance.now();
  const enabled = overtimeState.enabled === true;
  const statusLabels = { disabled: '未启用', paused: '已暂停', running: '直播加班中', finished: '已结束' };
  byId('overtimeClockLabel').textContent = statusLabels[overtimeState.status] || '状态未知';
  byId('overtimeEnableBtn').textContent = enabled ? '关闭加班机' : '启用加班机';
  byId('overtimeStartBtn').disabled = !enabled || overtimeState.status === 'running' || anchorRemainingMs <= 0;
  byId('overtimePauseBtn').disabled = !enabled || overtimeState.status !== 'running';
  byId('overtimeResetBtn').disabled = !enabled;
  renderInitialDuration(Number(overtimeState.initialSeconds) || 0);
  setValueUnlessFocused('overtimeBackgroundPath', overtimeState.background?.path || '');
  setValueUnlessFocused('overtimeBackgroundFit', overtimeState.background?.fit || 'cover');
  byId('overtimePendingCount').textContent = `待结算 ${Number(overtimeState.pendingCount) || 0}`;
  renderConsumerStatus();
  if (Array.isArray(nextState.rules) && !rulesDirty) renderRules(nextState.rules);
}

function renderConsumerStatus() {
  const consumers = giftDetection?.consumers || {};
  const overtimeEnabled = overtimeState?.enabled === true;
  const coreActive = giftDetection?.coreActive === true || overtimeEnabled;
  setStatus(byId('overtimeCoreStatus'), `共享收礼核心：${coreActive ? '运行中' : '未运行'}`, coreActive);
  setStatus(byId('overtimeGiftStatsStatus'), `礼物统计：${consumers.giftStatistics ? '开启' : '关闭'}`, consumers.giftStatistics);
  setStatus(byId('overtimeConsumerStatus'), `加班机：${overtimeEnabled ? '开启' : '关闭'}`, overtimeEnabled);
}

function setStatus(node, label, active) {
  node.textContent = label;
  node.classList.toggle('good', Boolean(active));
  node.classList.toggle('warn', !active);
}

function updateClock(nowMs) {
  if (overtimeState) {
    const elapsed = overtimeState.status === 'running' ? Math.max(0, nowMs - localAnchorMs) : 0;
    byId('overtimeClockValue').textContent = formatClock(Math.max(0, anchorRemainingMs - elapsed));
  }
  requestAnimationFrame(updateClock);
}

function renderRules(rules) {
  const root = byId('overtimeRules');
  root.replaceChildren();
  if (!rules.length) {
    root.append(createMessage('overtime-rule-empty', '还没有规则。添加礼物后设置固定时间或时间盲盒。'));
    return;
  }
  rules.forEach((rule, index) => root.append(createRuleRow(rule, index, rules.length)));
}

function createRuleRow(rule, index, count) {
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
  const id = document.createElement('small');
  id.textContent = `礼物 ID ${rule.giftId}`;
  identity.append(name, id);
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
  enabledLabel.append(enabled, document.createElement('span'), document.createTextNode('启用这条规则'));
  controls.append(enabledLabel);
  controls.append(ruleButton('上移', '将这条规则上移', index === 0, () => moveRule(row, -1)));
  controls.append(ruleButton('下移', '将这条规则下移', index === count - 1, () => moveRule(row, 1)));
  controls.append(ruleButton('删除', '删除规则', false, () => {
    rulesDirty = true;
    row.remove();
  }));
  header.append(controls);
  row.append(header);

  const modeSection = document.createElement('section');
  modeSection.className = 'overtime-rule-mode';
  modeSection.append(createEffectStep('1', '这个礼物如何改变时间？', '二选一，点击最符合你需求的方式。'));
  const modeOptions = document.createElement('fieldset');
  modeOptions.className = 'overtime-rule-mode-options';
  const modeLegend = document.createElement('legend');
  modeLegend.textContent = '选择礼物生效方式';
  modeOptions.append(modeLegend);
  const modeName = `overtime-rule-mode-${++ruleControlSequence}`;
  modeOptions.append(
    createModeOption(modeName, 'fixed', '直接改时间', '每次都增加或减少同样的时长', rule.mode !== 'random'),
    createModeOption(modeName, 'random', '随机抽结果', '像开盲盒一样，从多个结果中抽一个', rule.mode === 'random')
  );
  modeSection.append(modeOptions);
  row.append(modeSection);

  const effect = document.createElement('div');
  effect.className = 'overtime-rule-effect';
  renderEffectEditor(effect, rule);
  modeOptions.addEventListener('change', event => {
    if (event.target.matches('[data-rule-mode]:checked')) setEffectMode(effect, event.target.value);
  });
  row.append(effect);
  return row;
}

function renderEffectEditor(root, rule) {
  root.replaceChildren();
  const fixedPanel = document.createElement('section');
  fixedPanel.className = 'overtime-fixed-editor';
  fixedPanel.dataset.effectMode = 'fixed';
  fixedPanel.append(createEffectStep('2', '设置增加或减少多少时间', '不需要输入加减号，也不需要记时间格式。'));
  const sentence = document.createElement('div');
  sentence.className = 'overtime-effect-sentence';
  const sentenceStart = document.createElement('span');
  sentenceStart.textContent = '收到这个礼物后';
  sentence.append(
    sentenceStart,
    createDirectionControl(Number(rule.fixedSeconds) || 0),
    createDurationControl(Number(rule.fixedSeconds) || 0)
  );
  fixedPanel.append(sentence);

  const randomPanel = document.createElement('section');
  randomPanel.className = 'overtime-random-editor';
  randomPanel.dataset.effectMode = 'random';
  randomPanel.append(createEffectStep('2', '设置盲盒里可能抽到的结果', '每次收到这个礼物，只会随机抽中下面一个结果。'));
  const randomHint = document.createElement('p');
  randomHint.className = 'overtime-random-hint';
  randomHint.textContent = '“抽中机会”的数字越大越容易抽中。不用凑到 100，系统会自动换算成百分比。';
  randomPanel.append(randomHint);

  const outcomeList = document.createElement('div');
  outcomeList.className = 'overtime-outcome-list';
  outcomeList.dataset.outcomeList = 'true';
  const outcomes = Array.isArray(rule.outcomes) && rule.outcomes.length >= MIN_RANDOM_OUTCOMES
    ? rule.outcomes
    : [{ seconds: 300, weight: 50 }, { seconds: -180, weight: 50 }];
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
  addOutcome.textContent = '＋ 添加一个可能结果';
  addOutcome.addEventListener('click', () => {
    if (outcomeList.children.length >= MAX_RANDOM_OUTCOMES) return;
    outcomeList.append(createOutcomeCard({ seconds: 60, weight: 10 }, outcomeList.children.length));
    refreshOutcomeCards(randomPanel);
    outcomeList.lastElementChild.querySelector('input')?.focus();
  });
  randomFooter.append(outcomeCount, addOutcome);
  randomPanel.append(randomFooter);
  randomPanel.addEventListener('input', event => {
    if (event.target.matches('[data-outcome-weight]')) updateOutcomeProbabilities(randomPanel);
  });

  root.append(fixedPanel, randomPanel);
  refreshOutcomeCards(randomPanel);
  setEffectMode(root, rule.mode === 'random' ? 'random' : 'fixed');
}

function createModeOption(name, value, title, description, checked) {
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
  const small = document.createElement('small');
  small.textContent = description;
  copy.append(strong, small);
  label.append(input, copy);
  return label;
}

function createEffectStep(number, title, hint) {
  const step = document.createElement('div');
  step.className = 'overtime-rule-step';
  const marker = document.createElement('span');
  marker.textContent = number;
  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = hint;
  copy.append(strong, small);
  step.append(marker, copy);
  return step;
}

function createDirectionControl(seconds, allowEmpty = false) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'overtime-direction-control';
  const legend = document.createElement('legend');
  legend.textContent = '选择增加或减少时间';
  fieldset.append(legend);
  const name = `overtime-rule-direction-${++ruleControlSequence}`;
  const selected = Number(seconds) < 0 ? 'subtract' : allowEmpty && Number(seconds) === 0 ? 'empty' : 'add';
  fieldset.append(
    createDirectionOption(name, 'add', '增加时间', '＋', selected === 'add'),
    createDirectionOption(name, 'subtract', '减少时间', '－', selected === 'subtract')
  );
  if (allowEmpty) fieldset.append(createDirectionOption(name, 'empty', '不变（空奖）', '○', selected === 'empty'));
  return fieldset;
}

function createDirectionOption(name, value, labelText, symbol, checked) {
  const label = document.createElement('label');
  label.className = `overtime-direction-option is-${value}`;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.dataset.ruleDirection = 'true';
  const symbolNode = document.createElement('span');
  symbolNode.textContent = symbol;
  const text = document.createElement('strong');
  text.textContent = labelText;
  label.append(input, symbolNode, text);
  return label;
}

function createDurationControl(seconds) {
  const absoluteSeconds = Math.min(MAX_RULE_SECONDS, Math.abs(Math.trunc(Number(seconds) || 0)));
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
    createDurationPart('hours', '小时', values.hours, 24),
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
  result.append(
    createDirectionControl(Number(outcome.seconds) || 0, true),
    createDurationControl(Number(outcome.seconds) || 0)
  );
  const syncEmptyResult = () => {
    const empty = result.querySelector('[data-rule-direction]:checked')?.value === 'empty';
    result.classList.toggle('is-empty', empty);
    result.querySelectorAll('[data-duration-hours], [data-duration-minutes], [data-duration-seconds]')
      .forEach(input => { input.disabled = empty; });
  };
  result.addEventListener('change', event => {
    if (event.target.matches('[data-rule-direction]')) syncEmptyResult();
  });
  syncEmptyResult();

  const chance = document.createElement('label');
  chance.className = 'overtime-outcome-weight';
  const chanceText = document.createElement('span');
  chanceText.textContent = '抽中机会';
  const weight = document.createElement('input');
  weight.type = 'number';
  weight.min = '1';
  weight.max = String(MAX_OUTCOME_WEIGHT);
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
  remove.textContent = '删除这个结果';
  remove.addEventListener('click', () => {
    const editor = card.closest('.overtime-random-editor');
    if (!editor || editor.querySelectorAll('[data-random-outcome]').length <= MIN_RANDOM_OUTCOMES) return;
    card.remove();
    refreshOutcomeCards(editor);
  });
  card.append(heading, result, chance, remove);
  return card;
}

function refreshOutcomeCards(root) {
  const cards = Array.from(root.querySelectorAll('[data-random-outcome]'));
  cards.forEach((card, index) => {
    card.querySelector('[data-outcome-title]').textContent = `可能结果 ${index + 1}`;
    card.querySelector('[data-outcome-weight]').setAttribute('aria-label', `可能结果 ${index + 1} 的抽中机会`);
    const remove = card.querySelector('[data-remove-outcome]');
    remove.disabled = cards.length <= MIN_RANDOM_OUTCOMES;
    remove.textContent = remove.disabled ? '盲盒至少保留 2 个结果' : '删除这个结果';
  });
  const count = root.querySelector('[data-outcome-count]');
  if (count) count.textContent = `已有 ${cards.length} 个可能结果（最多 ${MAX_RANDOM_OUTCOMES} 个）`;
  const add = root.querySelector('[data-add-outcome]');
  if (add) add.disabled = cards.length >= MAX_RANDOM_OUTCOMES;
  updateOutcomeProbabilities(root);
}

function updateOutcomeProbabilities(root) {
  const cards = Array.from(root.querySelectorAll('[data-random-outcome]'));
  const weights = cards.map(card => Number(card.querySelector('[data-outcome-weight]').value));
  const valid = weights.every(weight => Number.isSafeInteger(weight) && weight > 0 && weight <= MAX_OUTCOME_WEIGHT);
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
}

function readSignedDuration(root) {
  const direction = root.querySelector('[data-rule-direction]:checked')?.value;
  if (!direction) throw new Error('请选择增加时间、减少时间或空奖。');
  if (direction === 'empty') return 0;
  const hours = readDurationPart(root, 'hours', '小时', 24);
  const minutes = readDurationPart(root, 'minutes', '分钟', 59);
  const seconds = readDurationPart(root, 'seconds', '秒', 59);
  const absoluteSeconds = hours * 3600 + minutes * 60 + seconds;
  if (absoluteSeconds > MAX_RULE_SECONDS) throw new Error('单次增加或减少的时间不能超过 24 小时。');
  return direction === 'subtract' ? -absoluteSeconds : absoluteSeconds;
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
  button.disabled = disabled;
  button.addEventListener('click', handler);
  return button;
}

function moveRule(row, direction) {
  const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  rulesDirty = true;
  if (direction < 0) row.parentNode.insertBefore(row, sibling);
  else row.parentNode.insertBefore(sibling, row);
}

async function loadCatalog() {
  const response = await fetch('/img/bilibili-gifts.json');
  const data = await readJsonResponse(response, '读取礼物目录失败');
  catalog = [...GUARD_GIFTS, ...(Array.isArray(data.gifts) ? data.gifts : [])].map(gift => ({
    id: String(gift.id),
    name: String(gift.name || gift.id),
    rmb: Number(gift.rmb) || 0,
    imagePath: `/img/${String(gift.image || '').replace(/^\/+/, '')}`
  })).sort((left, right) => left.rmb - right.rmb);
}

function openGiftPicker() {
  byId('overtimeGiftSearch').value = '';
  renderGiftPicker();
  byId('overtimeGiftPicker').showModal();
}

function renderGiftPicker() {
  const root = byId('overtimeGiftResults');
  const query = byId('overtimeGiftSearch').value.trim().toLocaleLowerCase();
  const selectedIds = new Set(Array.from(byId('overtimeRules').querySelectorAll('[data-overtime-rule]')).map(row => row.dataset.giftId));
  const matches = catalog.filter(gift => !selectedIds.has(gift.id) && (
    !query || gift.id.toLocaleLowerCase().includes(query) || gift.name.toLocaleLowerCase().includes(query)
  )).slice(0, 80);
  root.replaceChildren();
  for (const gift of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overtime-gift-option';
    const image = document.createElement('img');
    image.src = gift.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener('error', () => { image.src = PLACEHOLDER; }, { once: true });
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = gift.name;
    text.append(name);
    if (!gift.id.startsWith('guard-')) {
      const meta = document.createElement('small');
      meta.textContent = `¥${gift.rmb.toFixed(2)}`;
      text.append(meta);
    }
    button.append(image, text);
    button.addEventListener('click', () => addGiftRule(gift));
    root.append(button);
  }
  if (!matches.length) root.append(createMessage('overtime-rule-empty', '没有匹配的礼物。'));
}

function addGiftRule(gift) {
  const root = byId('overtimeRules');
  root.querySelector('.overtime-rule-empty')?.remove();
  const count = root.querySelectorAll('[data-overtime-rule]').length;
  rulesDirty = true;
  root.append(createRuleRow({
    giftId: gift.id,
    giftName: gift.name,
    imagePath: gift.imagePath,
    mode: 'fixed',
    fixedSeconds: 300,
    outcomes: [],
    enabled: count < MAX_ENABLED_RULES,
    sortOrder: count
  }, count, count + 1));
  byId('overtimeGiftPicker').close();
}

function renderSettlements() {
  const root = byId('overtimeSettlements');
  root.replaceChildren();
  if (!settlements.length) {
    root.append(createMessage('overtime-settlement-empty', '本场还没有礼物结算。'));
    return;
  }
  for (const item of settlements) {
    const row = document.createElement('div');
    row.className = 'overtime-settlement-row';
    const identity = document.createElement('strong');
    identity.textContent = `${item.giftName || item.giftId} ×${item.quantity}`;
    const mode = document.createElement('span');
    mode.textContent = item.ruleMode === 'random' ? '时间盲盒' : item.ruleMode === 'fixed' ? '固定时间' : '已忽略';
    const delta = document.createElement('span');
    delta.textContent = item.appliedDeltaSeconds === null ? '—' : formatSignedClock(item.appliedDeltaSeconds);
    delta.className = Number(item.appliedDeltaSeconds) >= 0 ? 'is-positive' : 'is-negative';
    const time = document.createElement('time');
    time.textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    row.append(identity, mode, delta, time);
    root.append(row);
  }
}

function populateInitialDurationSelectors() {
  const hours = byId('overtimeInitialHours');
  const minutes = byId('overtimeInitialMinutes');
  for (let value = 0; value <= MAX_INITIAL_HOURS; value += 1) {
    appendOption(hours, String(value), `${value} 小时`);
  }
  for (let value = 0; value < 60; value += 1) {
    appendOption(minutes, String(value), `${value} 分钟`);
  }
}

function syncDurationSelectorsFromInput() {
  try {
    renderDurationSelectors(parseInitialDuration(byId('overtimeInitialTime').value));
  } catch (_) {}
}

function syncDurationInputFromSelectors() {
  const hours = Number(byId('overtimeInitialHours').value) || 0;
  const minutes = Number(byId('overtimeInitialMinutes').value) || 0;
  byId('overtimeInitialTime').value = formatInitialDuration((hours * 60 + minutes) * 60);
}

function renderInitialDuration(seconds) {
  const normalizedSeconds = Math.min(
    MAX_INITIAL_HOURS * 3600 + 59 * 60,
    Math.max(0, Math.floor((Number(seconds) || 0) / 60) * 60)
  );
  setValueUnlessFocused('overtimeInitialTime', formatInitialDuration(normalizedSeconds));
  renderDurationSelectors(normalizedSeconds);
}

function renderDurationSelectors(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  setValueUnlessFocused('overtimeInitialHours', String(Math.floor(totalMinutes / 60)));
  setValueUnlessFocused('overtimeInitialMinutes', String(totalMinutes % 60));
}

function parseInitialDuration(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,3}):(\d{2})$/);
  if (!match) throw new Error('初始时长格式应为 HHH:MM。');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > MAX_INITIAL_HOURS || minutes > 59) throw new Error('小时不能超过 999，分钟必须小于 60。');
  return (hours * 60 + minutes) * 60;
}

function formatInitialDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return formatClockSeconds(seconds);
}

function formatSignedClock(seconds) {
  const number = Number(seconds) || 0;
  return `${number < 0 ? '-' : '+'}${formatClockSeconds(Math.abs(number))}`;
}

function formatClockSeconds(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function createMessage(className, message) {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = message;
  return node;
}

function overlayUrl() {
  return `${localOverlayOrigin()}/overtime`;
}

async function copyOverlayUrl() {
  try {
    await navigator.clipboard.writeText(overlayUrl());
    toast('OBS 地址已复制');
  } catch (error) {
    showError(error);
  }
}

function byId(id) {
  return document.getElementById(id);
}

function setValueUnlessFocused(id, value) {
  const input = byId(id);
  if (document.activeElement !== input) input.value = value;
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.overtime = { init, refresh };

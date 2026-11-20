const BAR_POINTS_PER_SCORE = 50n;
const BATTERIES_PER_YUAN = 10;
const numberFormat = new Intl.NumberFormat('zh-CN');
const moneyFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let initialized = false;

function batteriesWithinBudget(value) {
  const amount = String(value).trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(amount)) return null;
  const [yuan, fraction = ''] = amount.split('.');
  // 一角恰好是一电池，直接读取角位可以避免浮点误差跨过预算边界。
  const batteries = Number(yuan + (fraction[0] || '0'));
  return Number.isSafeInteger(batteries) ? BigInt(batteries) : null;
}

export function calculatePkScore(value, firstWin, doublePeriod, { byAmount = false, eventBonus = false } = {}) {
  const timeMultiplier = doublePeriod ? 2n : 1n;
  // +10% 用 11/10 表示。两个方向共用精确的倍率，只在整电池或最终加分处取整。
  const awardNumerator = (firstWin ? 2n : 1n) * (eventBonus ? 11n : 10n);
  const awardDenominator = BAR_POINTS_PER_SCORE * 10n;
  let batteries;
  if (byAmount) {
    batteries = batteriesWithinBudget(value);
    if (batteries === null) return null;
  } else {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    const rate = timeMultiplier * awardNumerator;
    batteries = (BigInt(value) * awardDenominator + rate - 1n) / rate;
  }
  const barScore = batteries * timeMultiplier;
  if (barScore > Number.MAX_SAFE_INTEGER) return null;
  const scaledAward = barScore * awardNumerator;
  return {
    batteries: Number(batteries),
    barScore: Number(barScore),
    awardedScore: Number(scaledAward / awardDenominator),
    awardFraction: Number(scaledAward % awardDenominator) / Number(awardDenominator),
  };
}

export function initPkScoreCalculator() {
  if (initialized) return;
  const panel = document.getElementById('otherPkScoreFeature');
  if (!panel) return;
  const amountMode = panel.querySelector('#pkScoreByAmount');
  const target = panel.querySelector('#pkScoreTarget');
  const amount = panel.querySelector('#pkScoreAmount');
  const firstWin = panel.querySelector('#pkScoreFirstWin');
  const doublePeriod = panel.querySelector('#pkScoreDouble');
  const eventBonus = panel.querySelector('#pkScoreEventBonus');
  const error = panel.querySelector('#pkScoreError');
  const primaryLabel = panel.querySelector('#pkScorePrimaryLabel');
  const primary = panel.querySelector('#pkScorePrimary');
  const unit = panel.querySelector('#pkScorePrimaryUnit');
  const batteriesLabel = panel.querySelector('#pkScoreBatteriesLabel');
  const batteries = panel.querySelector('#pkScoreBatteries');
  const detailLabel = panel.querySelector('#pkScoreDetailLabel');
  const detail = panel.querySelector('#pkScoreDetail');
  const barConversion = panel.querySelector('#pkScoreBarConversion');
  const awardConversion = panel.querySelector('#pkScoreAwardConversion');
  const rmbConversion = panel.querySelector('#pkScoreRmbConversion');

  function render() {
    const byAmount = amountMode.checked;
    target.closest('label').hidden = byAmount;
    amount.closest('label').hidden = !byAmount;
    const input = byAmount ? amount : target;
    const empty = input.value.trim() === '' && !input.validity.badInput;
    const result = empty || !input.validity.valid ? null : calculatePkScore(
      byAmount ? amount.value : target.valueAsNumber, firstWin.checked, doublePeriod.checked,
      { byAmount, eventBonus: eventBonus.checked },
    );
    const invalid = !empty && !result;
    error.hidden = !invalid;
    const invalidMessage = byAmount ? '请输入有效的非负金额，最多两位小数。' : '请输入有效的非负整数。';
    error.textContent = invalid ? invalidMessage : '';
    input.setAttribute('aria-invalid', String(invalid));
    primaryLabel.textContent = byAmount ? '可得 PK 加分' : '所需金额';
    unit.textContent = byAmount ? '分' : '元';
    unit.hidden = !result;
    batteriesLabel.textContent = byAmount ? '可用电池' : '所需电池';
    detailLabel.textContent = byAmount ? 'PK 条得分' : '实际可得加分';
    const timeFactor = doublePeriod.checked ? ' × 2（双倍）' : ' × 1';
    const winFactor = firstWin.checked ? ' × 2（首胜）' : '';
    const eventFactor = eventBonus.checked ? ' × 1.10（逐胜加冕）' : '';
    const awardFormula = `÷ 50${winFactor}${eventFactor}`;

    if (!result) {
      primary.style.removeProperty('--pk-score-characters');
      primary.textContent = batteries.textContent = detail.textContent = '—';
      barConversion.textContent = `1 电池${timeFactor} = ${doublePeriod.checked ? 2 : 1} 分`;
      awardConversion.textContent = `PK 条得分 ${awardFormula}，只计整分`;
      rmbConversion.textContent = byAmount ? '1 元 = 10 电池，只计整电池' : '10 电池 = 1 元';
      return;
    }

    const batteryText = numberFormat.format(result.batteries);
    const barText = numberFormat.format(result.barScore);
    const awardText = numberFormat.format(result.awardedScore);
    const yuan = Math.floor(result.batteries / BATTERIES_PER_YUAN);
    const moneyText = moneyFormat.format(`${yuan}.${result.batteries % BATTERIES_PER_YUAN}`);
    primary.textContent = byAmount ? awardText : moneyText;
    primary.style.setProperty('--pk-score-characters', primary.textContent.length);
    batteries.textContent = batteryText;
    detail.textContent = `${byAmount ? barText : awardText} 分`;
    barConversion.textContent = `${batteryText} 电池${timeFactor} = ${barText} 分`;
    // 分开格式化整数和小数，大分值的明细也能保留实际舍去的部分。
    const awardResult = result.awardFraction
      ? `${awardText}${String(result.awardFraction).slice(1)} 分，计 ${awardText} 分`
      : `${awardText} 分`;
    awardConversion.textContent = `${barText} ${awardFormula} = ${awardResult}`;
    if (byAmount) {
      const budgetText = moneyFormat.format(amount.value.trim());
      const unusedFen = budgetText.at(-1);
      rmbConversion.textContent = unusedFen === '0'
        ? `${budgetText} 元 × 10 = ${batteryText} 电池`
        : `${budgetText} 元可换 ${batteryText} 电池，余 0.0${unusedFen} 元`;
    } else {
      rmbConversion.textContent = `${batteryText} 电池 ÷ 10 = ${moneyText} 元`;
    }
  }

  panel.addEventListener('input', render);
  initialized = true;
  render();
}

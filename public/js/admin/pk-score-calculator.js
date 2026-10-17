const BAR_POINTS_PER_SCORE = 50;
const BATTERIES_PER_YUAN = 10;
const numberFormat = new Intl.NumberFormat('zh-CN');
const moneyFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let initialized = false;

export function calculatePkScore(targetScore, firstWin, doublePeriod) {
  if (!Number.isSafeInteger(targetScore) || targetScore < 0) return null;
  const winMultiplier = firstWin ? 2 : 1;
  const timeMultiplier = doublePeriod ? 2 : 1;
  // 首胜只影响主播加分，在应用倍率后统一取整。
  const baseScore = targetScore / winMultiplier;
  const batteries = Math.ceil(baseScore * BAR_POINTS_PER_SCORE / timeMultiplier);
  const barScore = batteries * timeMultiplier;
  if (!Number.isSafeInteger(barScore)) return null;
  const awardedScore = Math.floor(barScore / BAR_POINTS_PER_SCORE * winMultiplier);
  return { batteries, barScore, awardedScore };
}

export function initPkScoreCalculator() {
  if (initialized) return;
  const panel = document.getElementById('otherPkScoreFeature');
  if (!panel) return;
  const target = panel.querySelector('#pkScoreTarget');
  const firstWin = panel.querySelector('#pkScoreFirstWin');
  const doublePeriod = panel.querySelector('#pkScoreDouble');
  const error = panel.querySelector('#pkScoreError');
  const batteries = panel.querySelector('#pkScoreBatteries');
  const rmb = panel.querySelector('#pkScoreRmb');
  const awarded = panel.querySelector('#pkScoreAwarded');
  const barConversion = panel.querySelector('#pkScoreBarConversion');
  const awardConversion = panel.querySelector('#pkScoreAwardConversion');
  const rmbConversion = panel.querySelector('#pkScoreRmbConversion');

  function render() {
    const empty = target.value.trim() === '' && !target.validity.badInput;
    const result = empty ? null : calculatePkScore(Number(target.value), firstWin.checked, doublePeriod.checked);
    const invalid = !empty && (!result || target.validity.badInput);
    error.hidden = !invalid;
    error.textContent = invalid ? '请输入有效的非负整数' : '';
    target.setAttribute('aria-invalid', String(invalid));
    const timeFactor = doublePeriod.checked ? ' × 2（双倍）' : ' × 1';
    const winFactor = firstWin.checked ? ' × 2（首胜）' : '';

    if (!result || invalid) {
      batteries.textContent = rmb.textContent = awarded.textContent = '—';
      barConversion.textContent = `1 电池${timeFactor} = ${doublePeriod.checked ? 2 : 1} 分`;
      awardConversion.textContent = `PK 条得分 ÷ 50${winFactor}，向下取整`;
      rmbConversion.textContent = '10 电池 = 1 元';
      return;
    }

    const batteryText = numberFormat.format(result.batteries);
    const barText = numberFormat.format(result.barScore);
    const awardText = numberFormat.format(result.awardedScore);
    const moneyText = moneyFormat.format(result.batteries / BATTERIES_PER_YUAN);
    batteries.textContent = batteryText;
    rmb.textContent = `¥${moneyText}`;
    awarded.textContent = `${awardText} 分`;
    barConversion.textContent = `${batteryText} 电池${timeFactor} = ${barText} 分`;
    awardConversion.textContent = `${barText} ÷ 50${winFactor}，向下取整 = ${awardText} 分`;
    rmbConversion.textContent = `${batteryText} 电池 ÷ 10 = ${moneyText} 元`;
  }

  panel.addEventListener('input', render);
  initialized = true;
  render();
}

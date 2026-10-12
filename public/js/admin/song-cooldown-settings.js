export function renderSongCooldownControls(documentRef = document) {
  const mode = documentRef.getElementById('songCooldownMode');
  const amount = documentRef.getElementById('songCooldownAmount');
  const value = documentRef.getElementById('songCooldownValue');
  const hint = documentRef.getElementById('songCooldownHint');
  if (!mode || !amount || !value || !hint) return;
  const enabled = mode.value === 'hours' || mode.value === 'days';
  if (!enabled && !value.validity.valid) value.value = value.defaultValue;
  amount.hidden = !enabled;
  value.disabled = !enabled;
  value.setAttribute('aria-label', mode.value === 'days' ? '冷却自然日数' : '冷却小时数');
  hint.textContent = mode.value === 'days'
    ? '成功入队当天计第 1 天，满设定天数后的北京时间 00:00 恢复。'
    : mode.value === 'hours'
      ? '成功入队后开始计时，所有观众共用同一首歌的冷却。'
      : '不限制同一首歌再次点入的时间。';
}

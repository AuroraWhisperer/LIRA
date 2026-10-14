export function renderSongCooldownControls(documentRef = document) {
  const mode = documentRef.getElementById('songCooldownMode');
  const amount = documentRef.getElementById('songCooldownAmount');
  const value = documentRef.getElementById('songCooldownValue');
  if (!mode || !amount || !value) return;
  const enabled = mode.value === 'hours' || mode.value === 'days';
  if (!enabled && !value.validity.valid) value.value = value.defaultValue;
  amount.hidden = !enabled;
  value.disabled = !enabled;
  value.setAttribute('aria-label', mode.value === 'days' ? '冷却自然日数' : '冷却小时数');
}

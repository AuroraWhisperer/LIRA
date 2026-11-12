export function renderSongCooldownControls(documentRef = document) {
  const mode = documentRef.getElementById('songCooldownMode');
  const amount = documentRef.getElementById('songCooldownAmount');
  const value = documentRef.getElementById('songCooldownValue');
  const unit = documentRef.getElementById('songCooldownUnit');
  if (!mode || !amount || !value || !unit) return;
  const enabled = mode.value === 'hours' || mode.value === 'days';
  if (!enabled && !value.validity.valid) value.value = value.defaultValue;
  amount.hidden = !enabled;
  value.disabled = !enabled;
  value.setAttribute('aria-label', mode.value === 'days' ? '冷却自然日数' : '冷却小时数');
  unit.textContent = mode.value === 'days' ? '天' : '小时';
  renderSongCooldownValidity(documentRef);
}

export function renderSongCooldownValidity(documentRef = document) {
  const value = documentRef.getElementById('songCooldownValue');
  const error = documentRef.getElementById('songCooldownError');
  if (!value || !error) return;
  const invalid = !value.disabled && !value.validity.valid;
  value.setAttribute('aria-invalid', String(invalid));
  error.hidden = !invalid;
  error.textContent = invalid ? `请输入 ${value.min}–${value.max} 的整数；此修改尚未保存。` : '';
}

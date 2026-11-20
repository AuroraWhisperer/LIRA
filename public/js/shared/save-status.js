const MESSAGES = {
  idle: '修改后自动保存',
  loading: '正在读取设置…',
  pending: '等待自动保存…',
  saving: '正在保存…',
  saved: '已保存',
  error: '保存失败，修改已保留，请重试。',
};

// Presentation only: callers keep ownership of saving, retrying and visibility.
export function renderSaveStatus(element, state, message = MESSAGES[state]) {
  if (!element) return;
  element.classList.toggle('lira-save-status', true);
  element.classList.toggle('is-error', state === 'error');
  element.dataset.state = state;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.textContent = message;
}

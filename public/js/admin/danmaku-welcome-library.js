import { LIBRARIES } from './danmaku-welcome-model.js';
import { revealEditorItem } from './danmaku-editor-pagination.js';
import { WELCOME_TIME_PERIODS, welcomeTimePeriod } from '../shared/welcome-time-periods.js';

export function createWelcomeLibrary({ documentRef, element, libraries, changed }) {
  let key = 'messages';
  let timeMode = false;
  let periodId = welcomeTimePeriod(Date.now()).id;
  const list = element('List'),
    input = element('Input'),
    selector = element('LibraryKind');
  const periodSelector = element('TimePeriod');
  for (const { id, label, range } of WELCOME_TIME_PERIODS) {
    const option = documentRef.createElement('option');
    option.value = id;
    option.textContent = `${label} · ${range}`;
    periodSelector.appendChild(option);
  }
  function render() {
    const domain = libraries[key];
    list.replaceChildren();
    domain.items.forEach((text, index) => {
      const row = documentRef.createElement('div');
      row.className = 'danmaku-blessing-row';
      const number = documentRef.createElement('span');
      number.className = 'danmaku-blessing-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const field = documentRef.createElement('input');
      field.type = 'text';
      field.maxLength = 80;
      field.value = text;
      field.setAttribute('aria-label', `${LIBRARIES[key]}第 ${index + 1} 条`);
      field.addEventListener('input', () => {
        domain.items[index] = field.value;
        changed(key);
      });
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'danmaku-blessing-delete';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条文案`);
      remove.addEventListener('click', () => {
        domain.items.splice(index, 1);
        changed(key);
        render();
      });
      row.append(number, field, remove);
      list.appendChild(row);
    });
    input.value = domain.addition;
    const timed = key.startsWith('time:');
    selector.value = timed ? 'messages' : key;
    element('MessagesOption').textContent = timeMode ? '时段欢迎词库' : '欢迎词库';
    element('TimePeriodRow').hidden = !timed;
    periodSelector.value = periodId;
    const returning = key === 'returningMessages';
    input.placeholder = returning ? '例如：{username}，{days}天不见，弹幕区想你啦～' : '例如：欢迎 {username} 来到直播间～';
    input.setAttribute('aria-label', returning ? '新增多天未到欢迎语' : '新增欢迎语');
    element('ReturningLibraryHint').hidden = !returning;
    element('TemplateHelp').hidden = returning;
  }
  input.addEventListener('input', () => {
    libraries[key].addition = input.value;
    changed(null);
  });
  selector.addEventListener('change', () => {
    select(selector.value);
  });
  periodSelector.addEventListener('change', () => {
    periodId = periodSelector.value;
    select('messages');
  });
  function select(next) {
    key = next === 'messages' && timeMode ? `time:${periodId}` : next;
    render();
    revealEditorItem(list, 0);
    changed(null);
  }
  function setTimeMode(enabled) {
    timeMode = enabled;
    if (key === 'messages' || key.startsWith('time:')) key = enabled ? `time:${periodId}` : 'messages';
    render();
  }
  return { render, select, setTimeMode, current: () => key, revealLast: () => revealEditorItem(list, libraries[key].items.length - 1) };
}

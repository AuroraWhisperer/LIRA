import { AUDIENCE_LISTS } from './danmaku-welcome-model.js';

export function createWelcomeAudience({ documentRef, element, states, changed, save }) {
  let available = false;
  const fields = {};
  const get = (key, suffix) => element(`${AUDIENCE_LISTS[key].suffix}${suffix}`);

  function setError(key, message) {
    get(key, 'Error').textContent = message;
    get(key, 'Error').hidden = !message;
  }

  function edit(key) {
    setError(key, '');
    changed(key);
  }

  function render(key) {
    const state = states[key];
    const { label: title } = AUDIENCE_LISTS[key];
    const list = get(key, 'List');
    list.replaceChildren();
    fields[key] = [];
    for (let index = 0; index < state.items.length; index += 1) {
      const row = documentRef.createElement('div');
      row.className = 'danmaku-welcome-audience-row';
      const input = documentRef.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 20;
      input.pattern = '[1-9][0-9]{0,19}';
      input.required = true;
      input.placeholder = '填写 B 站 UID';
      input.value = state.items[index];
      input.disabled = !available;
      input.setAttribute('aria-label', `${title}第 ${index + 1} 位观众的 B 站 UID`);
      input.addEventListener('input', () => {
        state.items[index] = input.value;
        edit(key);
      });
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = '删除';
      remove.disabled = !available;
      remove.setAttribute('aria-label', `从${title}删除第 ${index + 1} 位观众`);
      remove.addEventListener('click', () => {
        state.items.splice(index, 1);
        edit(key);
        render(key);
      });
      fields[key].push(input, remove);
      row.append(input, remove);
      list.append(row);
    }
  }

  function controls({ supported, loaded, busy }) {
    available = supported;
    element('AudienceCapability').hidden = !loaded || supported;
    for (const [key, { label }] of Object.entries(AUDIENCE_LISTS)) {
      const state = states[key];
      for (const field of fields[key] || []) field.disabled = !available;
      get(key, 'AddBtn').disabled = !available || state.items.length >= 100;
      get(key, 'SaveBtn').disabled = !available || !state.dirty || busy;
      get(key, 'Count').textContent = supported ? `${state.items.length} / 100 人` : '';
      get(key, 'Status').textContent = state.dirty ? `${label}有未保存修改` : '';
    }
  }

  for (const key of Object.keys(AUDIENCE_LISTS)) {
    get(key, 'AddBtn').addEventListener('click', () => {
      const state = states[key];
      if (!available || state.items.length >= 100) return;
      state.items.push('');
      edit(key);
      render(key);
      fields[key][fields[key].length - 2]?.focus();
    });
    get(key, 'SaveBtn').addEventListener('click', () => {
      if (available) save(key, states[key].items.map((uid) => uid.trim()));
    });
  }

  return { render, controls, setError };
}

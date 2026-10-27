export function createWelcomeCustom({ documentRef, element, state, changed }) {
  let available = false;
  let fields = [];

  function setError(message) {
    element('CustomError').textContent = message;
    element('CustomError').hidden = !message;
  }

  function edit() {
    setError('');
    changed();
  }

  function render() {
    const list = element('CustomList');
    const pages = Math.max(1, Math.ceil(state.items.length / 6));
    state.page = Math.min(state.page, pages - 1);
    list.replaceChildren();
    fields = [];
    for (let index = state.page * 6; index < Math.min(state.items.length, (state.page + 1) * 6); index += 1) {
      const item = state.items[index];
      const row = documentRef.createElement('div');
      row.className = 'danmaku-welcome-custom-row';
      for (const [key, title] of [['uid', 'B 站 UID'], ['message', '欢迎词']]) {
        const label = documentRef.createElement('label');
        const caption = documentRef.createElement('span');
        caption.textContent = title;
        const input = documentRef.createElement('input');
        input.type = 'text';
        input.value = item[key];
        input.disabled = !available;
        input.required = true;
        input.setAttribute('aria-label', `第 ${index + 1} 位用户的${title}`);
        if (key === 'uid') {
          input.inputMode = 'numeric';
          input.maxLength = 20;
          input.pattern = '[1-9][0-9]{0,19}';
          input.placeholder = '填写用户 UID';
        } else {
          input.maxLength = 80;
          input.placeholder = '例如：欢迎 {username}，老朋友来啦～';
        }
        input.addEventListener('input', () => {
          item[key] = input.value;
          edit();
        });
        fields.push(input);
        label.append(caption, input);
        row.append(label);
      }
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'danger danmaku-welcome-custom-remove';
      remove.textContent = '删除';
      remove.disabled = !available;
      remove.setAttribute('aria-label', `删除第 ${index + 1} 位用户的欢迎词`);
      remove.addEventListener('click', () => {
        state.items.splice(index, 1);
        edit();
        render();
      });
      fields.push(remove);
      row.append(remove);
      list.append(row);
    }
    element('CustomEmpty').hidden = Boolean(state.items.length);
    element('CustomPageLabel').textContent = `第 ${state.page + 1} / ${pages} 页`;
    element('CustomPagination').hidden = pages === 1;
    element('CustomPrevPage').disabled = state.page === 0;
    element('CustomNextPage').disabled = state.page >= pages - 1;
  }

  function controls({ supported, loaded, busy }) {
    available = supported;
    for (const field of fields) field.disabled = !available;
    element('CustomCapability').hidden = !loaded || supported;
    element('CustomAddBtn').disabled = !available || state.items.length >= 100;
    element('CustomSaveBtn').disabled = !available || !state.dirty || busy;
    element('CustomCount').textContent = supported ? `${state.items.length} / 100 位` : '';
    element('CustomStatus').textContent = state.dirty ? '有未保存的用户欢迎词' : '';
  }

  element('CustomAddBtn').addEventListener('click', () => {
    if (!available || state.items.length >= 100) return;
    state.items.push({ uid: '', message: '' });
    state.page = Math.floor((state.items.length - 1) / 6);
    edit();
    render();
    fields[fields.length - 3]?.focus();
  });
  element('CustomPrevPage').addEventListener('click', () => {
    state.page -= 1;
    render();
  });
  element('CustomNextPage').addEventListener('click', () => {
    state.page += 1;
    render();
  });

  return { render, controls, setError };
}

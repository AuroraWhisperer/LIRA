import { revealEditorItem } from './danmaku-editor-pagination.js';

export function createScheduledLibraryEditor({ documentRef, changed,
  prefix = 'danmakuScheduledLibrary', label = '定时弹幕', maxItems = 300 }) {
  const element = (suffix) => documentRef.getElementById(`${prefix}${suffix}`);
  const list = element('List');
  let items = [], search = '';

  function render() {
    const matches = items.map((text, index) => ({ text, index }))
      .filter(({ text }) => text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    list.replaceChildren();
    for (const { text, index } of matches) {
      const row = documentRef.createElement('div');
      row.className = 'danmaku-blessing-row';
      const input = documentRef.createElement('input');
      input.type = 'text';
      input.value = text;
      input.setAttribute('aria-label', `${label}第 ${index + 1} 条`);
      input.addEventListener('input', () => {
        items[index] = input.value;
        input.setCustomValidity('');
        changed();
      });
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary daily-library-delete';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条${label}`);
      remove.addEventListener('click', () => {
        items.splice(index, 1);
        changed();
        render();
      });
      row.append(input, remove);
      list.append(row);
    }
    if (!matches.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'danmaku-blessing-empty';
      empty.textContent = search ? '没有匹配的文案' : '还没有文案，点击下方添加。';
      list.append(empty);
    }
    element('Search').value = search;
    element('Count').textContent = `${items.length} 条${search ? ` · 找到 ${matches.length} 条` : ''}`;
    element('Add').disabled = items.length >= maxItems;
  }

  element('Search').addEventListener('input', () => {
    search = element('Search').value.trim();
    render();
    revealEditorItem(list, 0);
  });
  element('Add').addEventListener('click', () => {
    items.push('');
    search = '';
    changed();
    render();
    list.lastElementChild?.querySelector('input')?.focus();
  });

  return {
    load(value) { items = [...value]; render(); },
    reset() { items = []; search = ''; render(); },
    read() {
      const result = items.map((text) => text.trim());
      const invalid = result.findIndex((text) => !text || Array.from(text).length > 120);
      if (invalid >= 0) {
        search = '';
        render();
        revealEditorItem(list, invalid);
        const input = list.querySelectorAll('input')[invalid];
        input.setCustomValidity('请填写文案，每条最多 120 字；不需要的条目可删除。');
        input.reportValidity();
        return null;
      }
      return result;
    },
  };
}

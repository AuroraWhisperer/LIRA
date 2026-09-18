import { LIBRARIES } from './danmaku-welcome-model.js';

export function createWelcomeLibrary({ documentRef, element, libraries, changed }) {
  let key = 'messages';
  const list = element('List'), input = element('Input'), selector = element('LibraryKind');
  function render() {
    const domain = libraries[key];
    const pages = Math.max(1, Math.ceil(domain.items.length / 6));
    domain.page = Math.min(domain.page, pages - 1);
    list.replaceChildren();
    domain.items.forEach((text, index) => {
      if (Math.floor(index / 6) !== domain.page) return;
      const row = documentRef.createElement('div'); row.className = 'danmaku-blessing-row';
      const number = documentRef.createElement('span'); number.className = 'danmaku-blessing-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const field = documentRef.createElement('input'); field.type = 'text'; field.maxLength = 80; field.value = text;
      field.setAttribute('aria-label', `${LIBRARIES[key]}第 ${index + 1} 条`);
      field.addEventListener('input', () => { domain.items[index] = field.value; changed(key); });
      const remove = documentRef.createElement('button'); remove.type = 'button';
      remove.className = 'danmaku-blessing-delete'; remove.textContent = '×';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条文案`);
      remove.addEventListener('click', () => { domain.items.splice(index, 1); changed(key); render(); });
      row.append(number, field, remove); list.appendChild(row);
    });
    input.value = domain.addition; selector.value = key;
    element('PageLabel').textContent = `第 ${domain.page + 1} / ${pages} 页`;
    element('PrevPage').disabled = domain.page === 0;
    element('NextPage').disabled = domain.page >= pages - 1;
  }
  input.addEventListener('input', () => { libraries[key].addition = input.value; changed(null); });
  element('PrevPage').addEventListener('click', () => { libraries[key].page -= 1; render(); });
  element('NextPage').addEventListener('click', () => { libraries[key].page += 1; render(); });
  selector.addEventListener('change', () => { key = selector.value; render(); changed(null); });
  function select(next) { key = next; render(); changed(null); }
  return { render, select, current: () => key };
}

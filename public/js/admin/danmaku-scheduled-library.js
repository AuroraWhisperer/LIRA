export function createScheduledLibraryEditor({ documentRef, changed }) {
  const element = (suffix) => documentRef.getElementById(`danmakuScheduledLibrary${suffix}`);
  const list = element('List');
  let items = [], page = 0, search = '';

  function render() {
    const matches = items.map((text, index) => ({ text, index }))
      .filter(({ text }) => text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const pages = Math.max(1, Math.ceil(matches.length / 6));
    page = Math.min(page, pages - 1);
    list.replaceChildren();
    for (const { text, index } of matches.slice(page * 6, (page + 1) * 6)) {
      const row = documentRef.createElement('div');
      row.className = 'danmaku-blessing-row';
      const input = documentRef.createElement('input');
      input.type = 'text';
      input.value = text;
      input.setAttribute('aria-label', `定时弹幕第 ${index + 1} 条`);
      input.addEventListener('input', () => {
        items[index] = input.value;
        input.setCustomValidity('');
        changed();
      });
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'danmaku-text-action daily-library-delete';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条定时弹幕`);
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
    element('Pagination').hidden = pages <= 1;
    element('Page').textContent = `第 ${page + 1} / ${pages} 页`;
    element('Previous').disabled = page === 0;
    element('Next').disabled = page === pages - 1;
    element('Add').disabled = items.length >= 100;
  }

  element('Search').addEventListener('input', () => {
    search = element('Search').value.trim();
    page = 0;
    render();
  });
  element('Previous').addEventListener('click', () => { page--; render(); });
  element('Next').addEventListener('click', () => { page++; render(); });
  element('Add').addEventListener('click', () => {
    items.push('');
    search = '';
    page = Math.floor((items.length - 1) / 6);
    changed();
    render();
    list.lastElementChild?.querySelector('input')?.focus();
  });

  return {
    load(value) { items = [...value]; render(); },
    reset() { items = []; page = 0; search = ''; render(); },
    read() {
      const result = items.map((text) => text.trim());
      const invalid = result.findIndex((text) => !text || Array.from(text).length > 120);
      if (invalid >= 0) {
        search = '';
        page = Math.floor(invalid / 6);
        render();
        const input = list.querySelectorAll('input')[invalid % 6];
        input.setCustomValidity('请填写文案，每条最多 120 字；不需要的条目可删除。');
        input.reportValidity();
        return null;
      }
      return result;
    },
  };
}

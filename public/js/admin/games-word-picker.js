'use strict';

export function createDrawWordPicker({ onChoose }) {
  const dialog = document.getElementById('drawWordPicker');
  const search = document.getElementById('drawWordSearch');
  const list = document.getElementById('drawWordChoices');
  const confirm = document.getElementById('drawChooseWordBtn');
  const selection = document.getElementById('drawWordSelection');
  const errorMessage = document.getElementById('drawWordPickerError');
  let roundKey = '';
  let choices = [];
  let selectedWord = '';
  let currentSession = null;
  let pendingKey = '';

  function sync(session, hostState) {
    const choosing = session?.game === 'draw-guess' && session.state?.phase === 'choosing';
    const key = choosing ? `${session.sessionId}:${session.state.round}` : '';
    currentSession = choosing ? session : null;
    if (key !== roundKey) {
      if (dialog.open) dialog.close();
      choices = [];
      selectedWord = '';
      errorMessage.hidden = true;
      roundKey = '';
    }
    if (!choosing || !hostState) return;
    const firstRead = roundKey !== key;
    roundKey = key;
    choices = hostState.choices || [];
    document.getElementById('drawWordPickerMeta').textContent =
      `第 ${session.state.round} / ${session.state.totalRounds} 局 · ${choices.length} 个可选词`;
    if (firstRead) search.value = '';
    render();
    if (firstRead) open();
  }

  function open() {
    if (!currentSession || !roundKey) return;
    if (!dialog.open) dialog.showModal();
    search.focus();
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const groups = new Map();
    let count = 0;
    for (const choice of choices) {
      if (query && !`${choice.word} ${choice.category}`.toLowerCase().includes(query)) continue;
      if (!groups.has(choice.category)) groups.set(choice.category, []);
      groups.get(choice.category).push(choice);
      count += 1;
    }
    list.replaceChildren();
    for (const [category, entries] of groups) {
      const group = document.createElement('section');
      group.className = 'draw-word-group';
      const title = document.createElement('h3');
      title.textContent = `${category} · ${entries.length} 词`;
      const words = document.createElement('div');
      words.className = 'draw-word-grid';
      for (const { word } of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = word;
        button.dataset.word = word;
        button.setAttribute('aria-pressed', String(word === selectedWord));
        words.append(button);
      }
      group.append(title, words);
      list.append(group);
    }
    if (!count) {
      const empty = document.createElement('p');
      empty.textContent = '没有匹配的词，换个关键词试试。';
      list.append(empty);
    }
    syncSelection();
  }

  function syncSelection() {
    const pending = pendingKey === roundKey && Boolean(roundKey);
    confirm.disabled = !selectedWord || pending;
    confirm.textContent = pending ? '正在开始…' : '选定并开始作画';
    search.disabled = pending;
    list.inert = pending;
    selection.textContent = selectedWord ? `已选：${selectedWord}` : '请选择一个题词';
  }

  search.addEventListener('input', render);
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-word]');
    if (!button || pendingKey === roundKey) return;
    selectedWord = button.dataset.word;
    errorMessage.hidden = true;
    list.querySelectorAll('button[data-word]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item.dataset.word === selectedWord));
    });
    syncSelection();
  });
  document.getElementById('drawWordPickerClose').addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', async () => {
    if (!selectedWord || !currentSession || pendingKey === roundKey) return;
    const key = roundKey;
    pendingKey = key;
    errorMessage.hidden = true;
    syncSelection();
    try {
      await onChoose({
        action: 'choose-word',
        word: selectedWord,
        sessionId: currentSession.sessionId,
        round: currentSession.state.round,
      });
    } catch (error) {
      if (key === roundKey) {
        errorMessage.textContent = error.message || '选词失败，请重试。';
        errorMessage.hidden = false;
      }
    } finally {
      if (pendingKey === key) pendingKey = '';
      syncSelection();
    }
  });

  return { sync, open };
}

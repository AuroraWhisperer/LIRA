import { eventBus, Events } from '../shared/event-bus.js';

export function createSongRequestBlacklist({ documentRef, getState }) {
  const field = documentRef.getElementById('songRequestBlacklist');
  const list = documentRef.getElementById('songRequestBlacklistWords');
  const empty = documentRef.getElementById('songRequestBlacklistEmpty');
  const count = documentRef.getElementById('songRequestBlacklistCount');
  const addButton = documentRef.getElementById('songRequestBlacklistAdd');
  let inputs = [];

  function updateLabels() {
    empty.hidden = inputs.length > 0;
    count.textContent = `${inputs.length} 个词条`;
    inputs.forEach((input, index) => {
      input.setAttribute('aria-label', `屏蔽词 ${index + 1}`);
      input.nextElementSibling.setAttribute('aria-label', `删除词条 ${index + 1}`);
    });
  }

  function updateDraft() {
    field.value = inputs.map((input) => input.value).join('\n');
    field.dataset.preserveDirty = 'true';
    field.dataset.dirty = 'true';
    updateLabels();
  }

  function appendWord(word) {
    const item = documentRef.createElement('li');
    item.className = 'song-blacklist-word';
    const input = documentRef.createElement('input');
    input.type = 'text';
    input.value = word;
    input.placeholder = '输入屏蔽词';
    input.autocomplete = 'off';
    input.setAttribute('aria-describedby', 'songRequestBlacklistHint');
    input.addEventListener('input', updateDraft);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      addWord();
    });
    const removeButton = documentRef.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'song-blacklist-remove';
    removeButton.textContent = '删除';
    removeButton.addEventListener('click', () => {
      const index = inputs.indexOf(input);
      inputs.splice(index, 1);
      item.remove();
      updateDraft();
      (inputs[index] || inputs[index - 1] || addButton).focus();
    });
    item.append(input, removeButton);
    list.append(item);
    inputs.push(input);
    return input;
  }

  function addWord() {
    const input = appendWord('');
    updateDraft();
    input.focus();
  }

  function render(rawValue = '') {
    if (field.dataset.dirty === 'true') return;
    const words = rawValue.split('\n').filter(Boolean);
    field.value = rawValue;
    if (words.length === inputs.length && words.every((word, index) => word === inputs[index].value)) return;
    inputs = [];
    list.replaceChildren();
    words.forEach(appendWord);
    updateLabels();
  }

  function init() {
    addButton.addEventListener('click', addWord);
    eventBus.on(Events.STATE_LOADED, ({ state }) => render(state.settings?.songRequestBlacklist));
    render(getState()?.getAppState?.()?.settings?.songRequestBlacklist);
    updateLabels();
  }

  return { init, render };
}

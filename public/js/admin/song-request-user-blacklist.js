import { eventBus, Events } from '../shared/event-bus.js';

function localDateTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1).replace(/^\+0?/, '');
}

function dateTimeTimestamp(value) {
  if (!value) return 0;
  const dateTime = value.replace(/^(\d{5,})-/, (_, year) => `+${year.padStart(6, '0')}-`);
  return new Date(dateTime).getTime();
}

export function createSongRequestUserBlacklist({ documentRef, getState }) {
  const field = documentRef.getElementById('songRequestUserBlacklist');
  const list = documentRef.getElementById('songRequestUserBlacklistRows');
  const table = documentRef.getElementById('songRequestUserBlacklistTable');
  const empty = documentRef.getElementById('songRequestUserBlacklistEmpty');
  const count = documentRef.getElementById('songRequestUserBlacklistCount');
  const addButton = documentRef.getElementById('songRequestUserBlacklistAdd');
  let rows = [];

  function updateLabels() {
    empty.hidden = rows.length > 0;
    table.hidden = rows.length === 0;
    count.textContent = `${rows.length} 人`;
    addButton.disabled = rows.length >= 200;
    rows.forEach((row, index) => {
      row.uid.setAttribute('aria-label', `用户 ${index + 1} 的 B 站 UID`);
      row.name.setAttribute('aria-label', `用户 ${index + 1} 的备注昵称`);
      row.expiry.setAttribute('aria-label', `用户 ${index + 1} 的到期时间，留空永久`);
      row.remove.setAttribute('aria-label', `删除用户 ${index + 1}`);
      const expiresAt = dateTimeTimestamp(row.expiry.value);
      row.status.textContent = !expiresAt ? '永久' : expiresAt <= Date.now() ? '已过期' : '限时';
    });
  }

  function updateDraft() {
    field.value = JSON.stringify(rows.map(({ uid, name, expiry }) => ({
      uid: uid.value.trim(),
      name: name.value.trim(),
      expiresAt: dateTimeTimestamp(expiry.value),
    })));
    field.dataset.preserveDirty = 'true';
    field.dataset.dirty = 'true';
    updateLabels();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function appendUser(entry) {
    const item = documentRef.createElement('tr');
    const uid = documentRef.createElement('input');
    uid.type = 'text';
    uid.inputMode = 'numeric';
    uid.pattern = '[1-9][0-9]{0,24}';
    uid.maxLength = 25;
    uid.required = true;
    uid.autocomplete = 'off';
    uid.placeholder = '填写 UID';
    uid.value = entry.uid;
    const name = documentRef.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.autocomplete = 'off';
    name.placeholder = '选填';
    name.value = entry.name || '';
    const expiry = documentRef.createElement('input');
    expiry.type = 'datetime-local';
    expiry.step = 'any';
    expiry.max = localDateTime(253402300799999);
    expiry.value = localDateTime(entry.expiresAt);
    const status = documentRef.createElement('span');
    status.className = 'song-board-section-meta';
    const remove = documentRef.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = '删除';
    const row = { uid, name, expiry, status, remove };
    for (const input of [uid, name, expiry]) input.addEventListener('input', updateDraft);
    remove.addEventListener('click', () => {
      const index = rows.indexOf(row);
      rows.splice(index, 1);
      item.remove();
      updateDraft();
      (rows[index]?.uid || rows[index - 1]?.uid || addButton).focus();
    });
    for (const control of [uid, name, expiry, status, remove]) {
      const cell = documentRef.createElement('td');
      cell.append(control);
      item.append(cell);
    }
    list.append(item);
    rows.push(row);
    return uid;
  }

  function render(rawValue = '[]') {
    if (field.dataset.dirty === 'true') {
      updateLabels();
      return;
    }
    const entries = JSON.parse(rawValue || '[]');
    const unchanged = entries.length === rows.length && entries.every((entry, index) => (
      entry.uid === rows[index].uid.value && (entry.name || '') === rows[index].name.value
      && (entry.expiresAt || 0) === dateTimeTimestamp(rows[index].expiry.value)
    ));
    field.value = rawValue;
    if (!unchanged) {
      rows = [];
      list.replaceChildren();
      entries.forEach(appendUser);
    }
    updateLabels();
  }

  function init() {
    addButton.addEventListener('click', () => {
      const input = appendUser({ uid: '', name: '', expiresAt: 0 });
      updateDraft();
      input.focus();
    });
    eventBus.on(Events.STATE_LOADED, ({ state }) => render(state.settings?.songRequestUserBlacklist));
    render(getState()?.getAppState?.()?.settings?.songRequestUserBlacklist);
  }

  return { init, render };
}

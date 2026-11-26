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
  let renderedValue;
  let hasDraft = false;
  let pendingSave;
  const removedUids = new Set();
  let nextExpiryAt = Infinity;
  let expiryCheckedAt = -Infinity;

  function readExpiry(row) {
    return row.expiry.value === row.savedExpiryText ? row.savedExpiresAt : dateTimeTimestamp(row.expiry.value);
  }

  function updateExpiryLabels(now = Date.now()) {
    expiryCheckedAt = now;
    nextExpiryAt = Infinity;
    for (const row of rows) {
      const expiresAt = readExpiry(row);
      const status = !expiresAt ? '永久' : expiresAt <= now ? '已过期' : '限时';
      if (row.status.textContent !== status) row.status.textContent = status;
      if (expiresAt > now) nextExpiryAt = Math.min(nextExpiryAt, expiresAt);
    }
  }

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
    });
    updateExpiryLabels();
  }

  function draftValue() {
    return JSON.stringify(rows.map((row) => ({
      uid: row.uid.value.trim(),
      name: row.name.value.trim(),
      expiresAt: readExpiry(row),
    })));
  }

  function updateDraft(structureChanged = false) {
    hasDraft = true;
    field.value = draftValue();
    field.dataset.preserveDirty = 'true';
    field.dataset.dirty = 'true';
    if (structureChanged) updateLabels();
    else updateExpiryLabels();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submissionFor(row) {
    return pendingSave?.get(row) || row?.submittedReuse;
  }

  function beginSave() {
    const submitted = new Map(rows.map(row => [row, { uid: row.uid.value.trim(), edits: new Set() }]));
    pendingSave = submitted;
    return () => {
      if (pendingSave !== submitted) return;
      // The snapshot acknowledging a reused UID can arrive after the save request finishes.
      for (const [row, submission] of submitted) {
        if (removedUids.has(submission.uid)) row.submittedReuse = submission;
      }
      pendingSave = null;
    };
  }

  function appendUser(entry, saved = entry) {
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
    const row = { item, uid, name, expiry, status, remove, saved, savedExpiresAt: entry.expiresAt || 0, savedExpiryText: expiry.value };
    for (const input of [uid, name, expiry]) input.addEventListener('input', () => {
      submissionFor(row)?.edits.add(input);
      updateDraft();
    });
    remove.addEventListener('click', () => {
      const index = rows.indexOf(row);
      if (row.saved) removedUids.add(row.saved.uid);
      const submittedUid = submissionFor(row)?.uid;
      if (submittedUid) removedUids.add(submittedUid);
      rows.splice(index, 1);
      item.remove();
      updateDraft(true);
      (rows[index]?.uid || rows[index - 1]?.uid || addButton).focus();
    });
    for (const control of [uid, name, expiry, status, remove]) {
      const cell = documentRef.createElement('td');
      cell.append(control);
      item.append(cell);
    }
    list.append(item);
    rows.push(row);
    return row;
  }

  function render(rawValue = '[]') {
    const dirty = field.dataset.dirty === 'true';
    if (rawValue === renderedValue && (dirty || !hasDraft)) {
      const now = Date.now();
      if (now < expiryCheckedAt || now >= nextExpiryAt) updateExpiryLabels(now);
      return;
    }
    const entries = JSON.parse(rawValue || '[]');
    if (!dirty) removedUids.clear();
    const byUid = new Map(rows.filter(row => row.saved).map(row => [row.saved.uid, row]));
    const incomingUids = new Set(entries.map(entry => entry.uid));
    const byDraftUid = new Map();
    for (const row of rows) {
      if (incomingUids.has(row.saved?.uid)) continue;
      const submittedUid = submissionFor(row)?.uid;
      byDraftUid.set(incomingUids.has(submittedUid) ? submittedUid : row.uid.value.trim(), row);
    }
    const previousRows = rows;
    rows = [];
    for (const entry of entries) {
      const row = byUid.get(entry.uid) || byDraftUid.get(entry.uid);
      const submission = submissionFor(row);
      if (removedUids.has(entry.uid)) {
        if (submission?.uid !== entry.uid) continue;
        removedUids.delete(entry.uid);
      }
      if (!row) { appendUser(entry); continue; }
      const saved = row.saved;
      const edits = submission?.edits;
      if (!dirty || row.submittedReuse?.uid === entry.uid) delete row.submittedReuse;
      const accept = (control, unchanged) => !dirty || (unchanged && !edits?.has(control));
      if (row.uid.value !== entry.uid && accept(row.uid, row.uid.value === saved?.uid)) row.uid.value = entry.uid;
      const name = entry.name || '';
      if (row.name.value !== name && accept(row.name, row.name.value === (saved?.name || ''))) row.name.value = name;
      if (accept(row.expiry, readExpiry(row) === (saved?.expiresAt || 0))) {
        if (readExpiry(row) !== (entry.expiresAt || 0)) row.expiry.value = localDateTime(entry.expiresAt);
        row.savedExpiresAt = entry.expiresAt || 0;
        row.savedExpiryText = row.expiry.value;
      }
      row.saved = entry;
      rows.push(row);
    }
    const retained = new Set(rows);
    for (const row of previousRows) {
      if (retained.has(row)) continue;
      if (dirty && !row.saved) rows.push(row);
      else row.item.remove();
    }
    for (const [index, row] of rows.entries()) {
      if (list.children[index] === row.item) continue;
      if (index) rows[index - 1].item.after(row.item);
      else list.prepend(row.item);
    }
    renderedValue = rawValue;
    hasDraft = dirty;
    const nextValue = dirty ? draftValue() : rawValue;
    const changedDraft = dirty && nextValue !== field.value;
    field.value = nextValue;
    updateLabels();
    if (changedDraft) field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function init() {
    addButton.addEventListener('click', () => {
      const row = appendUser({ uid: '', name: '', expiresAt: 0 }, null);
      updateDraft(true);
      row.uid.focus();
    });
    eventBus.on(Events.STATE_LOADED, ({ state }) => render(state.settings?.songRequestUserBlacklist));
    render(getState()?.getAppState?.()?.settings?.songRequestUserBlacklist);
  }

  return { init, render, beginSave };
}

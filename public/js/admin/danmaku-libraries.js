'use strict';

const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createBlessingEditor({ document, saveSetting, toast }) {
  const elements = {
    list: document.getElementById('danmakuBlessingList'),
    count: document.getElementById('danmakuBlessingCount'),
    input: document.getElementById('danmakuBlessingInput'),
    addButton: document.getElementById('danmakuBlessingAddBtn'),
    saveButton: document.getElementById('danmakuBlessingSaveBtn'),
    status: document.getElementById('danmakuBlessingStatus')
  };
  if (Object.values(elements).some((element) => !element)) return null;

  let items = [];
  let dirty = false;

  const setStatus = (text, kind = '') => {
    elements.status.textContent = text;
    elements.status.className = `hint${kind ? ` ${kind}` : ''}`;
  };
  const markDirty = () => {
    dirty = true;
    elements.saveButton.disabled = false;
    setStatus('有尚未保存的更改', 'warn');
  };
  const render = () => {
    elements.list.replaceChildren();
    elements.count.textContent = `${items.length} 条`;
    if (items.length === 0) {
      appendEmptyState(document, elements.list, '还没有祝福语');
      return;
    }

    items.forEach((text, index) => {
      const row = document.createElement('div');
      row.className = 'danmaku-blessing-row';
      const number = createIndex(document, index);
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 60;
      input.value = text;
      input.setAttribute('aria-label', `第 ${index + 1} 条祝福语`);
      input.addEventListener('input', () => {
        items[index] = input.value;
        markDirty();
      });
      const deleteButton = createDeleteButton(document, `删除第 ${index + 1} 条祝福语`, () => {
        items.splice(index, 1);
        render();
        markDirty();
      });
      row.append(number, input, deleteButton);
      elements.list.appendChild(row);
    });
  };
  const add = () => {
    const text = elements.input.value.trim();
    if (!text) {
      toast('请输入祝福语');
      elements.input.focus();
      return;
    }
    items.push(text);
    elements.input.value = '';
    render();
    markDirty();
    elements.list.lastElementChild?.querySelector('input')?.focus();
  };

  elements.addButton.addEventListener('click', add);
  elements.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  });
  elements.saveButton.addEventListener('click', async () => {
    const cleaned = items.map((item) => item.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      toast('请至少保留一条祝福语');
      setStatus('至少需要一条祝福语', 'warn');
      return;
    }
    elements.saveButton.disabled = true;
    setStatus('正在保存');
    try {
      await saveSetting('checkinBlessings', JSON.stringify(cleaned));
      items = cleaned;
      dirty = false;
      render();
      setStatus(`已保存 ${items.length} 条`, 'good');
      toast('签到祝福语已保存');
    } catch (error) {
      elements.saveButton.disabled = false;
      setStatus('保存失败', 'warn');
      toast(error.message || '保存祝福语失败');
    }
  });

  return {
    load(rawValue) {
      if (dirty) return;
      items = parseJsonArray(rawValue)
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      render();
      elements.saveButton.disabled = true;
      setStatus(`已读取 ${items.length} 条`, 'good');
    }
  };
}

export function createFortuneEditor({ document, saveSetting, toast }) {
  const elements = {
    list: document.getElementById('danmakuFortuneList'),
    count: document.getElementById('danmakuFortuneCount'),
    levelInput: document.getElementById('danmakuFortuneLevelInput'),
    nameInput: document.getElementById('danmakuFortuneNameInput'),
    textInput: document.getElementById('danmakuFortuneTextInput'),
    adviceInput: document.getElementById('danmakuFortuneAdviceInput'),
    addButton: document.getElementById('danmakuFortuneAddBtn'),
    saveButton: document.getElementById('danmakuFortuneSaveBtn'),
    status: document.getElementById('danmakuFortuneStatus')
  };
  if (Object.values(elements).some((element) => !element)) return null;

  const addInputs = [elements.levelInput, elements.nameInput, elements.textInput, elements.adviceInput];
  let items = [];
  let dirty = false;

  const setStatus = (text, kind = '') => {
    elements.status.textContent = text;
    elements.status.className = `hint${kind ? ` ${kind}` : ''}`;
  };
  const markDirty = () => {
    dirty = true;
    elements.saveButton.disabled = false;
    setStatus('有尚未保存的更改', 'warn');
  };
  const createField = (fortune, index, field, labelText, maxLength) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = maxLength;
    input.value = fortune[field];
    input.setAttribute('aria-label', `第 ${index + 1} 条签文的${labelText}`);
    input.addEventListener('input', () => {
      items[index][field] = input.value;
      markDirty();
    });
    label.appendChild(input);
    return label;
  };
  const render = () => {
    elements.list.replaceChildren();
    elements.count.textContent = `${items.length} 条`;
    if (items.length === 0) {
      appendEmptyState(document, elements.list, '还没有抽签词条');
      return;
    }

    items.forEach((fortune, index) => {
      const row = document.createElement('div');
      row.className = 'danmaku-fortune-row';
      const heading = document.createElement('div');
      heading.className = 'danmaku-fortune-row-heading';
      const deleteButton = createDeleteButton(document, `删除第 ${index + 1} 条签文`, () => {
        items.splice(index, 1);
        render();
        markDirty();
      });
      heading.append(createIndex(document, index), deleteButton);
      const fields = document.createElement('div');
      fields.className = 'danmaku-fortune-fields';
      fields.append(
        createField(fortune, index, 'level', '签级', 16),
        createField(fortune, index, 'name', '签名', 24),
        createField(fortune, index, 'text', '签文', 80),
        createField(fortune, index, 'advice', '建议', 80)
      );
      row.append(heading, fields);
      elements.list.appendChild(row);
    });
  };
  const add = () => {
    const values = addInputs.map((input) => input.value.trim());
    const missingIndex = values.findIndex((value) => !value);
    if (missingIndex >= 0) {
      toast('请填写完整的签级、签名、签文和建议');
      addInputs[missingIndex].focus();
      return;
    }
    items.push({ level: values[0], name: values[1], text: values[2], advice: values[3] });
    addInputs.forEach((input) => { input.value = ''; });
    render();
    markDirty();
    elements.levelInput.focus();
  };

  elements.addButton.addEventListener('click', add);
  addInputs.forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });
  });
  elements.saveButton.addEventListener('click', async () => {
    const cleaned = items.map(normalizeFortune);
    if (cleaned.length === 0 || cleaned.some((item) => !isCompleteFortune(item))) {
      toast('请至少保留一条填写完整的签文');
      setStatus('每条签文都需要填写完整', 'warn');
      return;
    }
    elements.saveButton.disabled = true;
    setStatus('正在保存');
    try {
      await saveSetting('fortunePool', JSON.stringify(cleaned));
      items = cleaned;
      dirty = false;
      render();
      setStatus(`已保存 ${items.length} 条`, 'good');
      toast('抽签机器人词库已保存');
    } catch (error) {
      elements.saveButton.disabled = false;
      setStatus('保存失败', 'warn');
      toast(error.message || '保存抽签词库失败');
    }
  });

  return {
    load(rawValue) {
      if (dirty) return;
      items = parseJsonArray(rawValue).map(normalizeFortune).filter(isCompleteFortune);
      render();
      elements.saveButton.disabled = true;
      setStatus(`已读取 ${items.length} 条`, 'good');
    }
  };
}

export function createCustomReplyEditor({ document, saveSetting, toast }) {
  const elements = {
    list: document.getElementById('danmakuCustomReplyList'),
    count: document.getElementById('danmakuCustomReplyCount'),
    keywordInput: document.getElementById('danmakuCustomKeywordInput'),
    replyInput: document.getElementById('danmakuCustomReplyInput'),
    addButton: document.getElementById('danmakuCustomReplyAddBtn'),
    saveButton: document.getElementById('danmakuCustomReplySaveBtn'),
    status: document.getElementById('danmakuCustomReplyStatus')
  };
  if (Object.values(elements).some((element) => !element)) return null;

  let items = [];
  let dirty = false;

  const setStatus = (text, kind = '') => {
    elements.status.textContent = text;
    elements.status.className = `hint${kind ? ` ${kind}` : ''}`;
  };
  const markDirty = () => {
    dirty = true;
    elements.saveButton.disabled = false;
    setStatus('有尚未保存的更改', 'warn');
  };
  const createField = (rule, index, field, labelText, maxLength) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = maxLength;
    input.value = rule[field];
    input.setAttribute('aria-label', `第 ${index + 1} 条 DIY 回复的${labelText}`);
    input.addEventListener('input', () => {
      items[index][field] = input.value;
      markDirty();
    });
    label.appendChild(input);
    return label;
  };
  const render = () => {
    elements.list.replaceChildren();
    elements.count.textContent = `${items.length} 条`;
    if (items.length === 0) {
      appendEmptyState(document, elements.list, '还没有 DIY 回复规则');
      return;
    }

    items.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'danmaku-custom-reply-row';
      const fields = document.createElement('div');
      fields.className = 'danmaku-custom-reply-fields';
      fields.append(
        createField(rule, index, 'keyword', '关键词', 30),
        createField(rule, index, 'reply', '回复内容', 120)
      );
      const deleteButton = createDeleteButton(document, `删除第 ${index + 1} 条 DIY 回复`, () => {
        items.splice(index, 1);
        render();
        markDirty();
      });
      row.append(createIndex(document, index), fields, deleteButton);
      elements.list.appendChild(row);
    });
  };
  const add = () => {
    const keyword = elements.keywordInput.value.trim();
    const reply = elements.replyInput.value.trim();
    if (!keyword || !reply) {
      toast('请填写关键词和回复内容');
      (keyword ? elements.replyInput : elements.keywordInput).focus();
      return;
    }
    items.push({ keyword, reply, enabled: true });
    elements.keywordInput.value = '';
    elements.replyInput.value = '';
    render();
    markDirty();
    elements.keywordInput.focus();
  };

  elements.addButton.addEventListener('click', add);
  [elements.keywordInput, elements.replyInput].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });
  });
  elements.saveButton.addEventListener('click', async () => {
    const cleaned = items.map(normalizeCustomReply).filter((item) => item.keyword && item.reply);
    elements.saveButton.disabled = true;
    setStatus('正在保存');
    try {
      await saveSetting('customReplyRules', JSON.stringify(cleaned));
      items = cleaned;
      dirty = false;
      render();
      setStatus(`已保存 ${items.length} 条`, 'good');
      toast('DIY 关键词回复已保存');
    } catch (error) {
      elements.saveButton.disabled = false;
      setStatus('保存失败', 'warn');
      toast(error.message || '保存 DIY 关键词回复失败');
    }
  });

  return {
    load(rawValue) {
      if (dirty) return;
      items = parseJsonArray(rawValue).map(normalizeCustomReply).filter((item) => item.keyword && item.reply);
      render();
      elements.saveButton.disabled = true;
      setStatus(`已读取 ${items.length} 条`, 'good');
    }
  };
}

function parseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCustomReply(item = {}) {
  return {
    keyword: truncateUnicodeText(String(item?.keyword || '').trim(), 30),
    reply: truncateUnicodeText(String(item?.reply || '').trim(), 120),
    enabled: item?.enabled === false ? false : true
  };
}

function truncateUnicodeText(value, limit) {
  const text = String(value || '');
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (item) => item.segment)
      .slice(0, limit)
      .join('');
  }
  return Array.from(text).slice(0, limit).join('');
}

function normalizeFortune(item = {}) {
  return {
    level: String(item?.level || '').trim(),
    name: String(item?.name || '').trim(),
    text: String(item?.text || '').trim(),
    advice: String(item?.advice || '').trim()
  };
}

function isCompleteFortune(item) {
  return Boolean(item.level && item.name && item.text && item.advice);
}

function createIndex(document, index) {
  const number = document.createElement('span');
  number.className = 'danmaku-blessing-index';
  number.textContent = String(index + 1).padStart(2, '0');
  return number;
}

function createDeleteButton(document, ariaLabel, onClick) {
  const button = document.createElement('button');
  button.className = 'danmaku-blessing-delete';
  button.type = 'button';
  button.title = ariaLabel;
  button.setAttribute('aria-label', ariaLabel);
  button.innerHTML = DELETE_ICON;
  button.addEventListener('click', onClick);
  return button;
}

function appendEmptyState(document, container, text) {
  const empty = document.createElement('div');
  empty.className = 'danmaku-blessing-empty';
  empty.textContent = text;
  container.appendChild(empty);
}

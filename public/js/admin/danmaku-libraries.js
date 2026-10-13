'use strict';

import { showFieldError } from '../shared/field-feedback.js';

const DELETE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createCustomReplyEditor({ document, saveSetting, toast, kind = 'keyword' }) {
  const exact = kind === 'exact';
  const name = exact ? '自定义回复' : '自定义关键词回复';
  const fieldName = exact ? '触发词' : '关键词';
  const id = (suffix) => `danmaku${exact ? 'Exact' : 'Custom'}${suffix}`;
  const elements = {
    list: document.getElementById(id('ReplyList')),
    count: document.getElementById(id('ReplyCount')),
    keywordInput: document.getElementById(id('KeywordInput')),
    replyInput: document.getElementById(id('ReplyInput')),
    addButton: document.getElementById(id('ReplyAddBtn')),
    saveButton: document.getElementById(id('ReplySaveBtn')),
    status: document.getElementById(id('ReplyStatus')),
  };
  if (Object.values(elements).some((element) => !element)) return null;

  let items = [];
  let dirty = false;
  let editRevision = 0;
  let saving = false;
  let generation = 0;

  const setStatus = (text, kind = '') => {
    elements.status.textContent = text;
    elements.status.className = `hint${kind ? ` ${kind}` : ''}`;
  };
  const markDirty = () => {
    editRevision += 1;
    dirty = true;
    elements.saveButton.disabled = saving;
    setStatus('有尚未保存的更改', 'warn');
  };
  const createField = (rule, index, field, labelText, maxLength) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    if (!exact) input.maxLength = maxLength;
    input.value = rule[field];
    input.setAttribute('aria-label', `第 ${index + 1} 条自定义回复的${labelText}`);
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
    if (exact) {
      elements.list.appendChild(document.getElementById('danmakuExactBuiltInReply').content.cloneNode(true));
    }
    if (!exact && items.length === 0) {
      appendEmptyState(document, elements.list, '还没有自定义回复规则');
      return;
    }

    items.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'danmaku-custom-reply-row';
      const fields = document.createElement('div');
      fields.className = 'danmaku-custom-reply-fields';
      fields.append(
        createField(rule, index, 'keyword', fieldName, 30),
        createField(rule, index, 'reply', '回复内容', 120),
      );
      const deleteButton = createDeleteButton(document, `删除第 ${index + 1} 条自定义回复`, () => {
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
      showFieldError(keyword ? elements.replyInput : elements.keywordInput, `请填写${fieldName}和回复内容`, document);
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
    if (saving) return;
    const cleaned = exact
      ? items.map((item) => ({ keyword: item.keyword.trim(), reply: item.reply.trim() }))
      : items.map(normalizeCustomReply).filter((item) => item.keyword && item.reply);
    const submittedRevision = editRevision;
    const requested = generation;
    saving = true;
    elements.saveButton.disabled = true;
    setStatus('正在保存');
    try {
      await saveSetting(exact ? 'customExactReplies' : 'customReplyRules', JSON.stringify(cleaned));
      if (generation !== requested) return;
      if (editRevision === submittedRevision) {
        items = cleaned;
        dirty = false;
        render();
        setStatus(`已保存 ${items.length} 条`, 'good');
      } else {
        setStatus('本次已保存，仍有未保存的更改', 'warn');
      }
      toast(`${name}已保存`);
    } catch (error) {
      if (generation !== requested) return;
      setStatus('保存失败', 'warn');
      toast(error.message || `保存${name}失败`);
    } finally {
      if (generation === requested) {
        saving = false;
        elements.saveButton.disabled = !dirty;
      }
    }
  });

  return {
    reset() {
      generation += 1;
      items = [];
      dirty = saving = false;
      editRevision = 0;
      elements.keywordInput.value = elements.replyInput.value = '';
      elements.saveButton.disabled = true;
      render();
      setStatus('连接云端账号后可编辑');
    },
    load(rawValue) {
      if (dirty || saving) return;
      items = parseJsonArray(rawValue)
        .map(exact ? (item) => ({ keyword: item.keyword, reply: item.reply }) : normalizeCustomReply)
        .filter((item) => item.keyword && item.reply);
      render();
      elements.saveButton.disabled = true;
      setStatus(`已读取 ${items.length} 条`, 'good');
    },
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
    enabled: item?.enabled === false ? false : true,
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

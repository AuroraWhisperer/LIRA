'use strict';

import { readApi, setState } from './ai-assistant-config-view.js';
import { dangerConfirm } from '../shared/confirmation-dialog.js';

const BUILTIN_PRESENTATION = {
  general: { name: '通用人格' },
  cat: { name: '小猫人格', provider: 'deepseek', providerNote: '针对 DeepSeek' },
};

export function createPersonaControls({ flushPendingSave, acceptConfig, confirm: confirmAction = dangerConfirm }) {
  const byId = (suffix) => document.getElementById(`xiaomiAi${suffix}`);
  const select = byId('Persona');
  const legacyPrompt = byId('SystemPrompt');
  const dialog = byId('PersonaDialog');
  const editor = byId('PersonaEditor');
  const name = byId('PersonaName');
  const description = byId('PersonaDescription');
  const prompt = byId('PersonaPrompt');
  const state = byId('PersonaState');
  const fileInput = byId('PersonaFile');
  const manageButton = byId('PersonaManage');
  let personas = [];
  let detectedProvider = '';
  let selectedId = '';
  let providerPersonaIds = {};
  let selectionNotice = '';
  let editorId = null;
  let busy = false;
  manageButton.disabled = true;

  function currentProvider() {
    const provider = byId('ModelProvider').value;
    return provider === 'auto' ? detectedProvider : provider;
  }

  function renderSelection() {
    const persona = personas.find((entry) => entry.id === select.value);
    const description = [persona?.providerNote, persona?.description].filter(Boolean).join('；');
    byId('PersonaSummary').textContent = description ? `说明：${description}` : '';
    byId('PersonaSummary').hidden = !description;
    const unmatched = persona?.provider && persona.provider !== currentProvider();
    const note = selectionNotice || (unmatched ? '已保留原有选择；此预设针对 DeepSeek，当前平台尚未测试。' : '');
    byId('PersonaAvailability').textContent = note;
    byId('PersonaAvailability').hidden = !note;
  }

  function renderOptions(selected) {
    const entries = personas.filter((persona) => !persona.provider || persona.provider === currentProvider() || persona.id === selected);
    entries.push({ id: '__new__', name: '新建预设…' });
    select.replaceChildren(...entries.map((persona) => {
      const option = document.createElement('option');
      option.value = persona.id;
      option.textContent = persona.name;
      return option;
    }));
    select.value = selected;
    selectedId = selected;
    providerPersonaIds[byId('ModelProvider').value] = selected;
    renderSelection();
  }

  function loadEditor(id) {
    editorId = id;
    const persona = personas.find((entry) => entry.id === id);
    name.value = persona?.name || (id === 'custom' ? '原有自定义角色' : '');
    description.value = persona?.description || '';
    byId('PersonaProviderNote').textContent = persona?.providerNote ? `${persona.providerNote}；其他模型未测试。` : '';
    byId('PersonaProviderNote').hidden = !persona?.providerNote;
    prompt.value = persona?.prompt || (id === 'custom' ? legacyPrompt.value : '');
    name.disabled = Boolean(persona?.builtin) || id === 'custom';
    description.disabled = id === 'custom';
    byId('PersonaReset').hidden = !persona?.builtin;
    const canDelete = Boolean(persona && !persona.builtin && id !== 'custom');
    byId('PersonaDelete').hidden = !canDelete;
    byId('PersonaDelete').disabled = !canDelete;
    byId('PersonaExport').disabled = !id;
    byId('PersonaCreate').hidden = !id;
    byId('PersonaDialogTitle').textContent = id ? `编辑预设 · ${name.value}` : '新建预设';
    setState(state, persona?.builtin ? '内置预设可修改、恢复默认。' : '点击「保存预设」生效。');
  }

  manageButton.addEventListener('click', () => {
    loadEditor(select.value);
    dialog.showModal();
  });
  byId('PersonaCancel').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  byId('PersonaNew').addEventListener('click', () => {
    if (busy) return;
    loadEditor(null);
    name.focus();
  });
  byId('PersonaCreate').addEventListener('click', () => {
    if (busy) return;
    const draft = { name: name.value, description: description.value, prompt: prompt.value };
    loadEditor(null);
    name.value = `${draft.name}（副本）`.slice(0, 40);
    description.value = draft.description;
    prompt.value = draft.prompt;
    name.focus();
  });

  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editor.reportValidity()) return;
    const id = editorId;
    const draft = { name: name.value.trim(), description: description.value.trim(), prompt: prompt.value };
    void runOperation(async () => {
      const url = id === 'custom' ? '/api/ai/config' : `/api/ai/personas/${id ? 'update' : 'create'}`;
      const body = id === 'custom' ? { personaId: 'custom', systemPrompt: draft.prompt } : { ...draft, ...(id ? { id } : {}) };
      const config = await readApi(url, { method: id === 'custom' ? 'PUT' : 'POST', body: JSON.stringify(body) });
      acceptConfig(config);
      loadEditor(id || config.personaId);
      setState(state, '预设已保存，后续新弹幕立即生效。', 'good');
    });
  });
  byId('PersonaReset').addEventListener('click', () => void runOperation(async () => {
    const config = await readApi('/api/ai/personas/update', {
      method: 'POST', body: JSON.stringify({ id: editorId, reset: true }),
    });
    acceptConfig(config);
    loadEditor(editorId);
    setState(state, '已恢复内置角色指南。', 'good');
  }, {
    title: '恢复角色默认内容？',
    description: '将覆盖此预设已保存及正在编辑的说明和角色指南。需要保留已保存内容时，请先导出。',
    confirmLabel: '恢复默认',
  }));
  byId('PersonaDelete').addEventListener('click', () => void runOperation(async () => {
    const config = await readApi('/api/ai/personas/delete', { method: 'POST', body: JSON.stringify({ id: editorId }) });
    acceptConfig(config);
    loadEditor(config.personaId);
    setState(state, '已删除预设。', 'good');
  }, {
    title: `删除预设「${name.value}」？`,
    description: '此预设及当前未保存的编辑将被删除，无法恢复。需要保留已保存内容时，请先导出。',
    confirmLabel: '删除预设',
  }));
  byId('PersonaImport').addEventListener('click', () => { if (!busy) fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      if (file.size > 64 * 1024) throw new Error('角色包文件不能超过 64 KB。');
      const pack = JSON.parse(await file.text());
      await runOperation(async () => {
        const config = await readApi('/api/ai/personas/import', { method: 'POST', body: JSON.stringify(pack) });
        acceptConfig(config);
        loadEditor(config.personaId);
        setState(state, '已导入并选中预设。', 'good');
      });
    } catch (error) {
      setState(state, error instanceof SyntaxError ? '文件不是有效的 JSON，请检查角色包。' : error.message, 'warn');
    }
  });
  byId('PersonaExport').addEventListener('click', () => void runOperation(async () => {
    const pack = await readApi('/api/ai/personas/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${pack.id}.lira-persona.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setState(state, '已导出当前预设的已保存内容。', 'good');
  }));

  async function runOperation(work, confirmation) {
    if (busy) return;
    busy = true;
    dialog.inert = true;
    const reopen = Boolean(confirmation && dialog.open);
    if (reopen) dialog.close();
    try {
      if (confirmation && !(await confirmAction(confirmation))) {
        setState(state, '已取消，预设内容未改动。');
        return;
      }
      if (!(await flushPendingSave())) throw new Error('请先保存当前设置，再操作预设。');
      setState(state, '正在保存…');
      await work();
    } catch (error) {
      setState(state, error.message || '预设操作失败，请重试。', 'warn');
    } finally {
      dialog.inert = false;
      busy = false;
      if (reopen) dialog.showModal();
    }
  }

  return {
    changeSelection() {
      selectionNotice = '';
      if (select.value === '__new__') {
        renderOptions(selectedId);
        loadEditor(null);
        dialog.showModal();
        name.focus();
        return false;
      }
      renderOptions(select.value);
      return true;
    },
    changeProvider() {
      if (!personas.length) return false;
      detectedProvider = '';
      selectionNotice = '';
      const remembered = providerPersonaIds[byId('ModelProvider').value];
      const candidate = personas.some((entry) => entry.id === remembered) ? remembered : select.value;
      const persona = personas.find((entry) => entry.id === candidate);
      const unmatched = Boolean(persona?.provider && byId('ModelProvider').value !== 'auto' && persona.provider !== currentProvider());
      const selected = unmatched ? 'general' : candidate;
      const changed = selected !== select.value;
      if (unmatched) selectionNotice = '已切换为通用人格；切回 DeepSeek 时会恢复上次选择。';
      renderOptions(selected);
      return changed;
    },
    render(config, preservedFieldIds = new Set()) {
      personas = (config.personas || []).map((persona) => ({
        ...persona,
        ...(persona.builtin ? BUILTIN_PRESENTATION[persona.id] : {}),
      }));
      detectedProvider = config.modelProvider === 'auto' ? config.modelEndpoint?.provider || '' : '';
      manageButton.disabled = false;
      if (!preservedFieldIds.has(legacyPrompt.id)) legacyPrompt.value = config.systemPrompt || '';
      const preserveSelection = preservedFieldIds.has(select.id) || preservedFieldIds.has(byId('ModelProvider').id);
      if (!preserveSelection) providerPersonaIds = { ...config.providerPersonaIds };
      const selected = preserveSelection ? select.value : config.personaId || 'custom';
      if (selected !== selectedId) selectionNotice = '';
      if (config.hasCustomPersona || selected === 'custom') personas.push({ id: 'custom', name: '原有自定义角色', description: '保留的自定义角色指南' });
      renderOptions(selected);
    },
  };
}

'use strict';

import { readApi, setState } from './ai-assistant-config-view.js';

export function createPersonaControls({ flushPendingSave, acceptConfig }) {
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
  let editorId = null;
  let busy = false;
  manageButton.disabled = true;

  function loadEditor(id) {
    editorId = id;
    const persona = personas.find((entry) => entry.id === id);
    name.value = persona?.name || (id === 'custom' ? '原有自定义角色' : '');
    description.value = persona?.description || '';
    prompt.value = persona?.prompt || (id === 'custom' ? legacyPrompt.value : '');
    name.disabled = Boolean(persona?.builtin) || id === 'custom';
    description.disabled = id === 'custom';
    byId('PersonaReset').hidden = !persona?.builtin;
    byId('PersonaDelete').hidden = !persona || persona.builtin;
    byId('PersonaDelete').disabled = !persona || persona.builtin;
    byId('PersonaExport').disabled = !id;
    byId('PersonaCreate').hidden = !id;
    byId('PersonaDialogTitle').textContent = id ? `编辑预设 · ${name.value}` : '新建预设';
    setState(state, persona?.builtin ? '内置预设会始终保留，修改后可以恢复默认。' : '修改后点击保存，取消则放弃本次编辑。');
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
  }));
  byId('PersonaDelete').addEventListener('click', () => void runOperation(async () => {
    const config = await readApi('/api/ai/personas/delete', { method: 'POST', body: JSON.stringify({ id: editorId }) });
    acceptConfig(config);
    loadEditor(config.personaId);
    setState(state, '已删除预设。', 'good');
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
    setState(state, '已导出保存过的预设，未保存的编辑不会包含在文件里。', 'good');
  }));

  async function runOperation(work) {
    if (busy) return;
    busy = true;
    dialog.inert = true;
    try {
      if (!(await flushPendingSave())) throw new Error('请先保存当前设置，再操作预设。');
      setState(state, '正在保存…');
      await work();
    } catch (error) {
      setState(state, error.message || '预设操作失败，请重试。', 'warn');
    } finally {
      dialog.inert = false;
      busy = false;
    }
  }

  return {
    render(config, preservedFieldIds = new Set()) {
      personas = config.personas || [];
      manageButton.disabled = false;
      if (!preservedFieldIds.has(legacyPrompt.id)) legacyPrompt.value = config.systemPrompt || '';
      const selected = preservedFieldIds.has(select.id) ? select.value : config.personaId || 'custom';
      const entries = [...personas];
      if (config.hasCustomPersona || selected === 'custom') entries.push({ id: 'custom', name: '原有自定义角色', description: '保留的自定义角色指南' });
      select.replaceChildren(...entries.map((persona) => {
        const option = document.createElement('option');
        option.value = persona.id;
        option.textContent = persona.description ? `${persona.name}（${persona.description}）` : persona.name;
        return option;
      }));
      select.value = selected;
    },
  };
}

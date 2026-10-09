'use strict';

import { readApi, setState } from './ai-assistant-config-view.js';

export function createPersonaControls({ flushPendingSave, acceptConfig, markEdited }) {
  const select = document.getElementById('xiaomiAiPersona');
  const prompt = document.getElementById('xiaomiAiSystemPrompt');
  const description = document.getElementById('xiaomiAiPersonaDescription');
  const fileInput = document.getElementById('xiaomiAiPersonaFile');
  const importButton = document.getElementById('xiaomiAiPersonaImport');
  const exportButton = document.getElementById('xiaomiAiPersonaExport');
  const deleteButton = document.getElementById('xiaomiAiPersonaDelete');
  const createButton = document.getElementById('xiaomiAiPersonaCreate');
  const nameInput = document.getElementById('xiaomiAiPersonaName');
  const state = document.getElementById('xiaomiAiPersonaState');
  const section = document.getElementById('xiaomiAiSection');
  let personas = [];
  let customPrompt = '';
  let busy = false;

  function showSelection(preservePrompt = false) {
    const persona = personas.find((entry) => entry.id === select.value);
    if (!preservePrompt) prompt.value = persona?.prompt || customPrompt;
    description.textContent = persona?.description || '编辑人设文本会保存为自定义角色，不会修改原角色包。';
    deleteButton.disabled = !persona || persona.builtin || busy;
  }

  select.addEventListener('change', () => showSelection());
  prompt.addEventListener('input', () => {
    customPrompt = prompt.value;
    select.value = 'custom';
    markEdited(select.id);
    showSelection(true);
  });

  importButton.addEventListener('click', () => fileInput.click());
  createButton.addEventListener('click', () => void runOperation(async () => {
    const config = await readApi('/api/ai/personas/create', {
      method: 'POST',
      body: JSON.stringify({ name: nameInput.value.trim(), prompt: prompt.value }),
    });
    acceptConfig(config);
    nameInput.value = '';
    setState(state, '已保存为角色包，可以随时切换或导出。', 'good');
  }));
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
        setState(state, '已导入并启用角色包。', 'good');
      });
    } catch (error) {
      setState(state, error instanceof SyntaxError ? '文件不是有效的 JSON，请检查角色包。' : error.message, 'warn');
    }
  });

  exportButton.addEventListener('click', () => void runOperation(async () => {
    const pack = await readApi('/api/ai/personas/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${pack.id}.lira-persona.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setState(state, '已导出当前角色。文件只包含人设，不包含密钥或聊天记录。', 'good');
  }));

  deleteButton.addEventListener('click', () => void runOperation(async () => {
    const config = await readApi('/api/ai/personas/delete', { method: 'POST', body: JSON.stringify({ id: select.value }) });
    acceptConfig(config);
    setState(state, '已删除角色包并切换为通用助手。', 'good');
  }));

  async function runOperation(work) {
    if (busy) return;
    busy = true;
    try {
      if (!(await flushPendingSave())) throw new Error('请先保存当前修改，再操作角色包。');
      section.inert = true;
      setState(state, '正在处理角色包…');
      await work();
    } catch (error) {
      setState(state, error.message || '角色包操作失败，请重试。', 'warn');
    } finally {
      section.inert = false;
      busy = false;
      showSelection(true);
    }
  }

  return {
    render(config, preservedFieldIds = new Set()) {
      personas = config.personas || [];
      if (!preservedFieldIds.has(prompt.id)) customPrompt = config.systemPrompt || '';
      const selected = preservedFieldIds.has(select.id) ? select.value : config.personaId || 'custom';
      select.replaceChildren(...[...personas, { id: 'custom', name: '自定义角色' }].map((persona) => {
        const option = document.createElement('option');
        option.value = persona.id;
        option.textContent = persona.name;
        return option;
      }));
      select.value = selected;
      showSelection(preservedFieldIds.has(prompt.id));
    },
  };
}

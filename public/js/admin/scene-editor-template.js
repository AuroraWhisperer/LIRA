import { previewElement } from './component-preview-surface.js';
import { exportSceneTemplate, importSceneTemplate } from './scene-template.js';
import { registerLocalFontSelect } from './local-font-library.js';

export function downloadSceneTemplate(document) {
  const url = URL.createObjectURL(new Blob([exportSceneTemplate(document)], { type: 'application/json' }));
  const link = previewElement('a');
  link.href = url;
  link.download = 'lira-scene.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function mountSceneTemplateImport(host, { onImport, report }) {
  const input = previewElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  const panel = previewElement('section', 'scene-editor-template');
  panel.setAttribute('aria-label', '模板资源重新绑定');
  panel.hidden = true;
  host.append(input, panel);
  let disposed = false;
  let generation = 0;
  let resources = [];
  function clearResources() { for (const stop of resources) stop?.(); resources = []; }
  input.addEventListener('change', async () => {
    const file = input.files[0];
    const request = ++generation;
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('模板不能超过 256 KiB。');
      const pending = importSceneTemplate(await file.text());
      if (disposed || request !== generation) return;
      clearResources();
      panel.replaceChildren(previewElement('h3', '', `导入模板：${pending.document.title}`),
        previewElement('p', 'hint', '导入为新场景。逐项确认当前设备的字体、素材和来源；确认前不会修改草稿或正式输出。'));
      const resolutions = new Map();
      for (const binding of pending.bindings) {
        const item = pending.document.items.find((entry) => entry.id === binding.itemId);
        const row = previewElement('div', 'scene-editor-binding');
        const label = previewElement('label', '', `${item.name} · ${{ font: '字体', media: '素材', source: '逻辑来源' }[binding.kind]}`);
        const value = previewElement(binding.kind === 'source' ? 'input' : 'select');
        if (binding.kind === 'source') {
          value.type = 'text'; value.value = binding.source; value.readOnly = true;
        } else {
          const options = binding.kind === 'font'
            ? binding.component === 'danmaku' ? [['default', '使用样式默认字体']]
              : [['', '移除此字体引用'], ['sans-serif', '系统无衬线字体'], ['serif', '系统衬线字体'], ['monospace', '系统等宽字体']]
            : [['', '移除此素材引用'], ...[...(document.getElementById('overtimeBackgroundPath')?.options || [])]
              .filter((option) => option.value).map((option) => [option.value, option.textContent])];
          for (const [optionValue, text] of options) {
            const option = previewElement('option', '', text); option.value = optionValue; value.append(option);
          }
          if (binding.kind === 'font') resources.push(registerLocalFontSelect(value));
          row.append(previewElement('p', '', `原引用：${binding.source}`));
        }
        label.append(value);
        const confirmation = previewElement('label', 'scene-editor-binding-confirm');
        const checkbox = previewElement('input');
        checkbox.type = 'checkbox';
        confirmation.append(checkbox, document.createTextNode(binding.kind === 'source'
          ? '确认绑定到当前账号的此组件' : '确认使用已选择的本机资源或移除引用'));
        row.append(label, confirmation);
        panel.append(row);
        resolutions.set(binding.id, { value, checkbox });
      }
      const actions = previewElement('div', 'scene-editor-actions');
      const cancel = previewElement('button', 'secondary', '取消导入');
      const apply = previewElement('button', 'primary', '确认绑定并创建新场景');
      cancel.type = apply.type = 'button';
      actions.append(cancel, apply);
      panel.append(actions);
      panel.hidden = false;
      cancel.addEventListener('click', () => { generation++; clearResources(); panel.hidden = true; panel.replaceChildren(); });
      apply.addEventListener('click', async () => {
        try {
          const resolved = pending.resolve(Object.fromEntries([...resolutions].map(([id, controls]) => [id,
            { confirmed: controls.checkbox.checked, value: controls.value.value }])));
          apply.disabled = cancel.disabled = true;
          await onImport(resolved);
          if (disposed) return;
          clearResources();
          panel.hidden = true;
          panel.replaceChildren();
        } catch (error) { if (!disposed) report(error.message); }
        finally { apply.disabled = cancel.disabled = false; }
      });
      (panel.querySelector('input') || cancel).focus();
    } catch (error) { if (!disposed) report(error.message || '模板无法读取。'); }
  });
  return { open() { input.click(); }, dispose() { disposed = true; generation++; clearResources(); input.remove(); panel.remove(); } };
}

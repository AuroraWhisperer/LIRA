import { localOverlayOrigin } from '../shared/utils.js';
import { cloneComponentPanel, componentField } from './component-preview-panel.js';

export function projectOvertimePreviewState(state = {}) {
  return { revision: state.revision || 0, status: state.status || 'disabled', serverNowMs: state.serverNowMs,
    effectiveRemainingMs: state.effectiveRemainingMs || 0,
    rules: (state.rules || []).map((rule) => ({ enabled: rule.enabled, giftId: rule.giftId, giftName: rule.giftName,
      imagePath: rule.imagePath, mode: rule.mode, displayText: rule.displayText, fixedSeconds: rule.fixedSeconds,
      ...(rule.fixedEffect ? { fixedEffect: { operation: rule.fixedEffect.operation, value: rule.fixedEffect.value } } : {}) })) };
}

export function bindOvertimeAppearance(root, targetController) {
  const node = (id) => componentField(root, id);
  for (const [key, id] of [['path', 'overtimeBackgroundPath'], ['fit', 'overtimeBackgroundFit']]) {
    node(id).addEventListener('change', () => targetController.edit({ [key]: node(id).value }));
  }
  return { dispose: targetController.subscribe(({ draft }) => {
    node('overtimeBackgroundPath').value = draft.path;
    node('overtimeBackgroundFit').value = draft.fit;
  }) };
}

export function createOvertimePreview({ controller, source = document, startActualData, embedded = false }) {
  let demoControls;
  let emitDemo = null;
  let demoState = null;
  const dataModes = [{ value: 'actual', label: '实际状态 · 只读' }, { value: 'running', label: '示例 · 运行中' },
    { value: 'paused', label: '示例 · 暂停' }, { value: 'finished', label: '示例 · 已结束' }, { value: 'disabled', label: '示例 · 未启用' }];
  let layerMode = 'actual';
  let stopLayerData;
  let layerData;
  const layerListeners = new Set();
  function startData({ mode, emit }) {
    if (demoControls) demoControls.hidden = mode === 'actual';
    if (mode === 'actual') return startActualData(emit);
    demoState = { revision: 1000, status: mode, serverNowMs: Date.now(),
      effectiveRemainingMs: mode === 'finished' ? 0 : 120000,
      rules: [{ enabled: true, giftId: 'sample', giftName: '示例礼物', mode: 'fixed', fixedSeconds: 60 }] };
    emitDemo = emit;
    emit(demoState);
    return () => { emitDemo = null; demoState = null; };
  }
  function restartLayerData() {
    stopLayerData?.();
    stopLayerData = null;
    if (demoControls) demoControls.hidden = layerMode === 'actual';
    if (!layerListeners.size) return;
    stopLayerData = startData({ mode: layerMode, emit(data) {
      layerData = data;
      for (const listener of layerListeners) listener(data);
    } });
  }
  function updateDemo(change, adjustment) {
    if (!demoState || !emitDemo) return;
    const now = Date.now();
    const remaining = Math.max(0, demoState.effectiveRemainingMs - (demoState.status === 'running' ? now - demoState.serverNowMs : 0));
    demoState = { ...demoState, effectiveRemainingMs: remaining, ...change(remaining),
      serverNowMs: now, revision: demoState.revision + 1 };
    emitDemo({ ...demoState, adjustment });
  }
  return { id: 'overtime', title: '加班机', controller,
    url: new URL('/overtime?quality=low&componentPreview=1', localOverlayOrigin()).href,
    size: () => [520, 160],
    dataModes,
    createPanel: (host, targetController = controller) => {
      const panel = cloneComponentPanel(source.querySelector('#overtimeAppearanceFields'), 'preview-overtime');
      const view = bindOvertimeAppearance(panel, targetController);
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = '这里只保存直播画面的外观；礼物规则和真实倒计时由客户端业务控制区管理。';
      demoControls = document.createElement('div');
      demoControls.className = 'stack';
      demoControls.hidden = !embedded || layerMode === 'actual';
      if (embedded) {
        const label = document.createElement('label');
        label.textContent = '展示数据';
        const select = document.createElement('select');
        select.setAttribute('aria-label', '加班机展示数据');
        for (const mode of dataModes) {
          const option = document.createElement('option');
          option.value = mode.value; option.textContent = mode.label; select.append(option);
        }
        select.value = layerMode;
        select.addEventListener('change', () => { layerMode = select.value; restartLayerData(); });
        label.append(select); host.append(label);
      }
      const demoHint = document.createElement('p');
      demoHint.textContent = '演示操作不会修改真实倒计时或礼物记录。';
      demoControls.append(demoHint);
      for (const [label, change, adjustment] of [
        ['演示加时 +1 分钟', (remaining) => ({ effectiveRemainingMs: remaining + 60000 }),
          { giftId: 'sample', giftName: '示例礼物', quantity: 1, appliedDeltaSeconds: 60 }],
        ['播放 / 暂停演示', () => ({ status: demoState.status === 'running' ? 'paused' : 'running' })],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = label;
        button.addEventListener('click', () => updateDemo(change, adjustment));
        demoControls.append(button);
      }
      host.append(panel, note, demoControls);
      return view;
    },
    startActualData,
    startData,
    startLayerData: ({ emit }) => {
      layerListeners.add(emit);
      if (layerListeners.size === 1) restartLayerData(); else emit(layerData);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        layerListeners.delete(emit);
        if (!layerListeners.size) { stopLayerData?.(); stopLayerData = null; }
      };
    },
  };
}

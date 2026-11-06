import { localOverlayOrigin, showConfirmationDialog } from '../shared/utils.js';
import { cloneComponentPanel, componentField, syncComponentFieldValue } from './component-preview-panel.js';

export function projectOvertimePreviewState(state = {}) {
  return { revision: state.revision || 0, status: state.status || 'disabled', serverNowMs: state.serverNowMs,
    initialSeconds: state.initialSeconds || 0,
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

export function createOvertimePreview({ controller, source = document, startActualData, control, embedded = false }) {
  let syncMode;
  const dataModes = [{ value: 'actual', label: '实际倒计时 · 与客户端同步' }, { value: 'running', label: '示例 · 运行中' },
    { value: 'paused', label: '示例 · 暂停' }, { value: 'finished', label: '示例 · 已结束' }, { value: 'disabled', label: '示例 · 未启用' }];
  let layerMode = 'actual';
  let stopLayerData;
  let layerData;
  const layerListeners = new Set();
  function startData({ mode, emit }) {
    syncMode?.(mode);
    if (mode === 'actual') return startActualData(emit);
    emit({ revision: 1000, status: mode, serverNowMs: Date.now(),
      effectiveRemainingMs: mode === 'finished' ? 0 : 120000,
      rules: [{ enabled: true, giftId: 'sample', giftName: '示例礼物', mode: 'fixed', fixedSeconds: 60 }] });
    return () => {};
  }
  function restartLayerData() {
    stopLayerData?.();
    stopLayerData = null;
    syncMode?.(layerMode);
    if (!layerListeners.size) return;
    stopLayerData = startData({ mode: layerMode, emit(data) {
      layerData = data;
      for (const listener of layerListeners) listener(data);
    } });
  }
  return { id: 'overtime', title: '加班机', controller, control,
    url: new URL('/overtime?quality=low&componentPreview=1', localOverlayOrigin()).href,
    size: () => [520, 160],
    dataModes,
    createPanel: (host, targetController = controller) => {
      const panel = cloneComponentPanel(source.querySelector('#overtimeAppearanceFields'), 'preview-overtime');
      const view = bindOvertimeAppearance(panel, targetController);
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = '背景设置与客户端共享；下方时间操作立即保存并同步实际倒计时。礼物规则在客户端管理。';
      const controls = document.createElement('fieldset');
      controls.className = 'stack';
      const sampleHint = document.createElement('p');
      sampleHint.className = 'hint';
      sampleHint.textContent = '当前仅查看示例。调整时间请切换到“实际倒计时 · 与客户端同步”。';
      syncMode = mode => { controls.hidden = mode !== 'actual'; sampleHint.hidden = mode === 'actual'; };
      syncMode(layerMode);
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
      let actual;
      let busy = false;
      let timeDirty = false;
      const fields = [ ['初始时长（小时）', 3600], ['初始时长（分钟）', 60], ['初始时长（秒）', 1] ].map(([text, unit]) => {
        const label = document.createElement('label'); label.textContent = text;
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '1'; input.required = true;
        if (unit !== 3600) input.max = '59';
        input.setAttribute('aria-label', text);
        input.addEventListener('input', () => { timeDirty = true; });
        label.append(input); controls.append(label);
        return { input, unit };
      });
      const status = document.createElement('p'); status.setAttribute('role', 'status');
      const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = '设置并重置倒计时';
      const enable = document.createElement('button'); enable.type = 'button';
      const play = document.createElement('button'); play.type = 'button';
      controls.append(apply, enable, play, status);
      function render() {
        controls.disabled = busy || !actual || !control;
        if (!timeDirty) for (const { input, unit } of fields) {
          const value = Math.floor((actual?.initialSeconds || 0) / unit);
          syncComponentFieldValue(input, unit === 3600 ? value : value % 60);
        }
        enable.textContent = actual?.status === 'disabled' ? '启用加班机' : '停用加班机';
        play.textContent = actual?.status === 'running' ? '暂停倒计时' : '开始倒计时';
        play.disabled = !actual || actual.status === 'disabled' || actual.effectiveRemainingMs <= 0;
      }
      async function perform(change) {
        if (busy || !control) return;
        busy = true; status.textContent = ''; render();
        try {
          if (change.action === 'time' && actual?.effectiveRemainingMs > 0 && !await showConfirmationDialog({
            title: '设置初始时间并重置倒计时？', variant: 'caution',
            message: `当前剩余时间将被替换为 ${change.seconds} 秒，倒计时会停止。已累积的剩余时间无法恢复。`,
            confirmLabel: '设置并重置',
          })) return;
          const next = await control(change);
          if (change.action === 'time') timeDirty = false;
          if (!actual || next.revision >= actual.revision) actual = next;
          status.textContent = '已保存并同步到客户端。';
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; render(); }
      }
      apply.addEventListener('click', () => {
        if (fields.every(({ input }) => input.reportValidity())) {
          void perform({ action: 'time', seconds: fields.reduce((total, { input, unit }) => total + Number(input.value) * unit, 0) });
        }
      });
      enable.addEventListener('click', () => { void perform({ action: actual?.status === 'disabled' ? 'enable' : 'disable' }); });
      play.addEventListener('click', () => { void perform({ action: actual?.status === 'running' ? 'pause' : 'start' }); });
      const stopActual = control && startActualData(next => {
        if (next && actual && next.revision < actual.revision) return;
        actual = next; render();
      });
      render();
      host.append(panel, note, controls, sampleHint);
      return { dispose() { view.dispose(); stopActual?.(); syncMode = null; } };
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

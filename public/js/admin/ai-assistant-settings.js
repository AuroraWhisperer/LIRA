'use strict';
import { showStackedToast } from '../shared/utils.js';
import { createPersonaControls } from './ai-assistant-personas.js';
import { createSubscriptionControls } from './ai-assistant-subscription.js';
import { createAiModelPicker } from './ai-model-picker.js';

import {
  readApi,
  collectConfig,
  renderConfig,
  renderConfigSummary,
  renderReasoningState,
  renderProviderSelection,
  renderToolSettings,
  syncReasoningEffortAvailability,
  selectReasoningEffort,
  renderStatus,
  renderDoubaoStatus,
  setState,
  providerLabel,
  providerErrorMessage,
  codedClientError,
} from './ai-assistant-config-view.js';

let initialized = false;
let refreshConfig = null;
const AUTOSAVE_DELAY_MS = 700;

function init({ notify = showStackedToast, confirm } = {}) {
  if (initialized) return;
  const form = document.getElementById('xiaomiAiForm');
  if (!form) return;
  initialized = true;
  const replySwitches = [
    { key: 'enabled', input: document.getElementById('xiaomiAiEnabled') },
    { key: 'autoReplyEnabled', input: document.getElementById('xiaomiAiAutoReplyEnabled') },
  ].map((entry) => ({ ...entry, promise: null, version: 0, error: '' }));
  const replySwitchIds = new Set(replySwitches.map(({ input }) => input.id));
  const saveState = document.getElementById('xiaomiAiSaveState');
  function setSaveState(message, kind) {
    const failure = replySwitches.find(state => state.error)?.error;
    const failed = Boolean(failure) || kind === 'warn';
    setState(saveState, failure || message, failed ? 'warn' : kind);
    document.getElementById('xiaomiAiSaveBtn').hidden = !failed;
    document.getElementById('xiaomiAiActions').hidden = !failed;
  }
  const providerTestButtons = [
    ['deepseek', document.getElementById('xiaomiAiTestBtn')],
    ['qweather', document.getElementById('xiaomiAiQWeatherTestBtn')],
    ['amap', document.getElementById('xiaomiAiAmapTestBtn')],
  ];
  const providerInput = document.getElementById('xiaomiAiModelProvider');
  providerInput.disabled = true;
  const reasoningInput = document.getElementById('xiaomiAiReasoning');
  let autosaveTimer = null;
  let saving = false;
  let pendingSave = false;
  let dirty = false;
  let configLoaded = false;
  let pendingConfigRefreshes = 0;
  let savingPromise = null;
  let editVersion = 0;
  let configRevision = 0;
  let accountRevision = 0;
  let initialLoadPromise = null;
  let restoreManualEndpointAfterProviderSave = false;
  let modelTestRevision = 0;
  const editedFieldIds = new Set();
  let personaControls;
  const modelPicker = createAiModelPicker({
    readApi,
    async onCatalog() {
      const revision = configRevision;
      const account = accountRevision;
      const config = await readApi('/api/ai/config');
      if (revision === configRevision && account === accountRevision && !saving && !dirty) renderReasoningState(config);
    },
    onSelect(id) {
      editedFieldIds.add(id);
      scheduleSave();
    },
  });

  function applyConfig(config) {
    // Provider, access mode and remembered endpoint are saved as one selection.
    if (configLoaded && (editedFieldIds.has(providerInput.id) || editedFieldIds.has('xiaomiAiModelAuthMode'))) return;
    const previousService = JSON.stringify(modelPicker.readService());
    renderConfig(config, editedFieldIds);
    personaControls.render(config, editedFieldIds);
    if (previousService !== JSON.stringify(modelPicker.readService())) {
      invalidateModelTest();
      modelPicker.invalidate({ preserveConfig: true });
    }
  }

  refreshConfig = async () => {
    const requestRevision = configRevision;
    let requestedAccount = accountRevision;
    const statusRead = subscriptionControls.beginStatusRead();
    pendingConfigRefreshes += 1;
    try {
      let [config, status] = await Promise.all([readApi('/api/ai/config'), readApi('/api/ai/status')]);
      if (requestRevision !== configRevision) return;
      const accountChanged = requestedAccount !== accountRevision;
      if (accountChanged) {
        // Config includes model capabilities from the account that answered the read.
        requestedAccount = accountRevision;
        config = await readApi('/api/ai/config');
        if (requestedAccount !== accountRevision || requestRevision !== configRevision) return;
      }
      applyConfig(config);
      renderStatus(status);
      if (status.chatgpt && !accountChanged) subscriptionControls.accept(status.chatgpt, statusRead);
      if (!configLoaded) {
        configLoaded = true;
        providerInput.disabled = false;
        if (dirty && form.checkValidity()) {
          clearTimeout(autosaveTimer);
          setSaveState('等待自动保存…');
          autosaveTimer = setTimeout(() => void saveConfig(), AUTOSAVE_DELAY_MS);
        }
      }
    } catch (error) {
      if (requestRevision === configRevision && requestedAccount === accountRevision) setSaveState(error.message || '无法读取 AI 配置', 'warn');
    } finally {
      pendingConfigRefreshes -= 1;
    }
  };

  const saveConfig = async () => {
    if (!dirty) return true;
    if (!configLoaded) {
      setSaveState('配置尚未加载，暂时无法保存；请等待或刷新页面重试。', 'warn');
      return false;
    }
    if (!form.checkValidity()) return false;
    if (saving) {
      pendingSave = true;
      await savingPromise;
      return saveConfig();
    }
    saving = true;
    dirty = false;
    const submittedConfig = collectConfig(editedFieldIds);
    // Each reply switch owns its saves; late form saves cannot turn it back on.
    for (const { key } of replySwitches) delete submittedConfig[key];
    const submittedEditVersion = editVersion;
    setSaveState('正在保存…');
    savingPromise = (async () => {
      try {
        const config = await readApi('/api/ai/config', {
          method: 'PUT',
          body: JSON.stringify(submittedConfig),
        });
        configRevision += 1;
        // Newer edits own the endpoint restoration flag and form rendering.
        if (submittedEditVersion !== editVersion) return true;
        if (restoreManualEndpointAfterProviderSave) {
          const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
          const protocolInput = document.getElementById('xiaomiAiModelApiProtocol');
          if (endpointInput) endpointInput.value = config.deepseekResponsesUrl || '';
          if (protocolInput) protocolInput.value = config.modelApiProtocol || 'auto';
          restoreManualEndpointAfterProviderSave = false;
        }
        if (Object.hasOwn(submittedConfig, 'model') && config.model !== submittedConfig.model) {
          document.getElementById('xiaomiAiModel').value = config.model;
        }
        renderConfigSummary(config, submittedConfig);
        personaControls.render(config);
        for (const id of editedFieldIds) if (!replySwitchIds.has(id)) editedFieldIds.delete(id);
        setSaveState('已保存，后续新弹幕立即生效。', 'good');
        return true;
      } catch (error) {
        dirty = true;
        setSaveState(error.message || '保存 AI 配置失败', 'warn');
        return false;
      } finally {
        saving = false;
      }
    })();
    const saved = await savingPromise;
    savingPromise = null;
    if (saved && (pendingSave || dirty)) {
      pendingSave = false;
      return saveConfig();
    }
    return saved;
  };

  const scheduleSave = (immediate = false) => {
    editVersion += 1;
    dirty = true;
    clearTimeout(autosaveTimer);
    if (!form.checkValidity()) {
      setSaveState('请先完成或修正当前输入，随后会自动保存。', 'warn');
      return;
    }
    setSaveState(immediate ? '正在保存…' : '等待自动保存…');
    if (immediate) void saveConfig();
    else autosaveTimer = setTimeout(() => void saveConfig(), AUTOSAVE_DELAY_MS);
  };

  const flushPendingSave = async () => {
    clearTimeout(autosaveTimer);
    while (replySwitches.some((state) => state.promise)) {
      const saved = await Promise.all(replySwitches.map((state) => state.promise || true));
      if (saved.some((result) => !result)) return false;
    }
    if (replySwitches.some(state => state.error)) return false;
    while (savingPromise || saving || dirty || pendingSave) {
      if (savingPromise) {
        if (!(await savingPromise)) return false;
        await Promise.resolve();
        continue;
      }
      if (dirty || pendingSave) {
        pendingSave = false;
        if (!(await saveConfig())) return false;
        continue;
      }
      await Promise.resolve();
    }
    return true;
  };

  personaControls = createPersonaControls({
    confirm,
    async flushPendingSave() {
      await initialLoadPromise;
      return configLoaded && flushPendingSave();
    },
    acceptConfig(config) {
      configRevision += 1;
      applyConfig(config);
    },
  });

  providerInput?.addEventListener('change', () => {
    invalidateModelTest();
    const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
    const official = ['deepseek', 'kimi', 'openai', 'anthropic', 'gemini', 'doubao'].includes(providerInput.value);
    restoreManualEndpointAfterProviderSave = !official && Boolean(endpointInput?.disabled);
    renderProviderSelection(providerInput.value, {
      keepEndpointLocked: restoreManualEndpointAfterProviderSave,
    });
    modelPicker.invalidate();
    if (personaControls.changeProvider()) editedFieldIds.add('xiaomiAiPersona');
    void refreshDoubaoStatus();
    void subscriptionControls.refresh();
  });
  document.getElementById('xiaomiAiModelAuthMode')?.addEventListener('change', () => {
    invalidateModelTest();
    renderProviderSelection(providerInput.value);
    modelPicker.invalidate();
    void subscriptionControls.refresh();
  });

  form.addEventListener('input', (event) => {
    modelPicker.invalidateField(event.target.id);
    if (event.target.matches('input[type="checkbox"], input[type="file"]') || event.target.id === 'xiaomiAiChatGptProfiles') return;
    if (event.target.id === 'xiaomiAiPersona') return;
    if (event.target.id) editedFieldIds.add(event.target.id);
    scheduleSave();
  });

  form.addEventListener('change', (event) => {
    if (event.target.id === 'xiaomiAiChatGptProfiles' || replySwitchIds.has(event.target.id)) return;
    modelPicker.invalidateField(event.target.id);
    if (event.target.id === 'xiaomiAiReasoningEffort') selectReasoningEffort();
    if (event.target.matches('input[type="checkbox"], input[type="number"], select')) {
      if (event.target.id === 'xiaomiAiPersona' && !personaControls.changeSelection()) return;
      if (event.target.id) editedFieldIds.add(event.target.id);
      if (event.target === reasoningInput) syncReasoningEffortAvailability();
      renderToolSettings();
      scheduleSave(true);
    }
  });

  const saveReplySwitch = (state) => {
    const enabled = state.input.checked;
    const version = ++state.version;
    editedFieldIds.add(state.input.id);
    const operation = (state.promise || Promise.resolve()).then(async () => {
      try {
        await initialLoadPromise;
        if (!configLoaded) throw new Error('配置尚未加载，暂时无法保存；请等待或刷新页面重试。');
        if (version === state.version) setSaveState('正在保存…');
        await readApi('/api/ai/config', { method: 'PUT', body: JSON.stringify({ [state.key]: enabled }) });
        configRevision += 1;
        if (version === state.version) {
          state.error = '';
          editedFieldIds.delete(state.input.id);
          if (state.key === 'enabled' && !enabled) renderStatus({ queued: 0 });
          const message = state.key === 'enabled'
            ? (enabled ? '已开启，只处理新弹幕。' : '已关闭，未完成的回复已取消；已发出的弹幕无法撤回。')
            : (enabled ? '自动接话已开启；启用 AI 后对新弹幕生效。' : '自动接话已关闭，尚未发送的接话已取消。');
          setSaveState(message, 'good');
        }
        return true;
      } catch (error) {
        if (version === state.version) {
          state.error = error.message || '保存 AI 开关失败';
          setSaveState(state.error, 'warn');
        }
        return false;
      }
    });
    state.promise = operation;
    void operation.then(() => { if (state.promise === operation) state.promise = null; });
  };
  for (const state of replySwitches) state.input.addEventListener('change', () => saveReplySwitch(state));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configLoaded) {
      if (pendingConfigRefreshes) return;
      initialLoadPromise = refreshConfig();
      await initialLoadPromise;
      if (!configLoaded) return;
      if (!dirty) setSaveState('已读取配置。', 'good');
    }
    for (const state of replySwitches) {
      if (editedFieldIds.has(state.input.id) && !state.promise) saveReplySwitch(state);
    }
    if (!form.reportValidity()) return;
    if (dirty) scheduleSave(true);
  });

  for (const [provider, button] of providerTestButtons) {
    button.addEventListener('click', () => void runProviderTest(provider, button));
  }

  function invalidateModelTest() {
    modelTestRevision++;
    const detail = document.getElementById('aiTestDetail-deepseek');
    if (detail) {
      setState(detail, '');
      providerTestButtons[0][1].disabled = false;
    }
  }

  async function runProviderTest(provider, button) {
    const revision = modelTestRevision;
    const current = () => provider !== 'deepseek' || revision === modelTestRevision;
    const label = providerLabel(provider);
    button.disabled = true;
    let testDetail = document.getElementById(`aiTestDetail-${provider}`);
    if (!testDetail) {
      testDetail = document.createElement('p');
      testDetail.id = `aiTestDetail-${provider}`;
      testDetail.className = 'hint ai-test-detail';
      testDetail.setAttribute('role', 'status');
      button.parentElement.after(testDetail);
    }
    setState(testDetail, `正在准备 ${label} 连接测试…`);
    try {
      await initialLoadPromise;
      if (!form.reportValidity()) throw codedClientError('FORM_INVALID', '请先修正表单中的网址或数值。');
      if (!(await flushPendingSave())) throw codedClientError('SAVE_FAILED', '配置保存失败，未运行连接测试。');
      if (!current()) return;
      setState(testDetail, `正在测试 ${label} 连接…`);
      const result = await readApi(`/api/ai/test/${provider}`, {
        method: 'POST',
        body: '{}',
      });
      if (!current()) return;
      const detail =
        provider === 'deepseek' && result.reply ? `模型 ${result.model} 回复：${result.reply}` : '地址与密钥均可用';
      setState(testDetail, `${label} 连接正常。${detail}`, 'good');
      showProviderToast(notify, {
        provider,
        good: true,
        title: `${label} 测试通过`,
        message: '测试详情已保留在测试区域',
      });
    } catch (error) {
      if (!current()) return;
      const message = providerErrorMessage(provider, error);
      setState(testDetail, `${label}：${message}`, 'warn');
      showProviderToast(notify, {
        provider,
        good: false,
        title: `${label} 测试未通过`,
        message: '请查看测试区域的错误详情',
      });
    } finally {
      if (current()) button.disabled = false;
    }
  }

  let doubaoRefreshPending = false;
  const subscriptionControls = createSubscriptionControls({ readApi,
    onAccountChange() {
      accountRevision++;
      invalidateModelTest();
      modelPicker.invalidate();
    },
    async flushPendingSave() {
      await initialLoadPromise;
      return configLoaded && flushPendingSave();
    },
  });
  async function refreshDoubaoStatus() {
    if (providerInput?.value !== 'doubao' || doubaoRefreshPending) return;
    doubaoRefreshPending = true;
    try { renderDoubaoStatus(await readApi('/api/ai/doubao/status')); }
    catch (error) { setState(document.getElementById('xiaomiAiDoubaoState'), error.message, 'warn'); }
    finally { doubaoRefreshPending = false; }
  }
  for (const [id, operation] of [['xiaomiAiDoubaoLogin', 'login'], ['xiaomiAiDoubaoLogout', 'logout']]) {
    const button = document.getElementById(id);
    button?.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (operation === 'login') {
          await initialLoadPromise;
          if (!configLoaded || !(await flushPendingSave())) return;
        }
        renderDoubaoStatus(await readApi(`/api/ai/doubao/${operation}`, { method: 'POST' }));
      } catch (error) {
        setState(document.getElementById('xiaomiAiDoubaoState'), error.message, 'warn');
      } finally { button.disabled = false; }
    });
  }
  if (typeof window?.addEventListener === 'function') {
    const page = document.getElementById('otherAssistantPage');
    const panel = document.getElementById('otherDanmakuFeature');
    let timer = null;
    let disposed = false;
    const visible = () => !document.hidden && page.classList.contains('active') && !form.closest('[hidden]');
    function refreshAccounts() {
      if (disposed || !visible()) return;
      void refreshDoubaoStatus();
      void subscriptionControls.refresh();
    }
    function syncPolling() {
      if (disposed || !visible()) {
        clearInterval(timer);
        timer = null;
        return;
      }
      if (timer !== null) return;
      // Feature navigation already includes account status in its full refresh.
      if (!pendingConfigRefreshes) refreshAccounts();
      timer = setInterval(refreshAccounts, 3000);
    }
    const observer = new MutationObserver(syncPolling);
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(document.getElementById('danmakuAiPanel'), { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', syncPolling);
    window.addEventListener('pagehide', () => {
      disposed = true;
      syncPolling();
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncPolling);
    }, { once: true });
    if (visible()) timer = setInterval(refreshAccounts, 3000);
  }
  initialLoadPromise = refreshConfig();
}

function showProviderToast(notify, { provider, good, title, message }) {
  notify({
    key: `xiaomi-ai-test:${provider}`,
    update: true,
    type: good ? 'success' : 'warning',
    title,
    message,
    className: `toast-with-icon toast-icon-${good ? 'success' : 'warn'}`,
    duration: good ? 3600 : 5200,
  });
}

function refresh() {
  return refreshConfig ? refreshConfig() : Promise.resolve();
}

export const aiAssistantSettings = { init, refresh };

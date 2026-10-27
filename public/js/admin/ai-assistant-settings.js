'use strict';
import { showStackedToast } from '../shared/utils.js';
import { publishAiAssistantSettings } from './legacy-admin-bridge.js';
import { createPersonaControls } from './ai-assistant-personas.js';
import { createSubscriptionControls } from './ai-assistant-subscription.js';

import {
  readApi,
  collectConfig,
  renderConfig,
  renderConfigSummary,
  renderProviderSelection,
  renderToolSettings,
  syncReasoningEffortAvailability,
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
  const enabledInput = document.getElementById('xiaomiAiEnabled');
  const saveState = document.getElementById('xiaomiAiSaveState');
  const providerTestButtons = [
    ['deepseek', document.getElementById('xiaomiAiTestBtn')],
    ['qweather', document.getElementById('xiaomiAiQWeatherTestBtn')],
    ['amap', document.getElementById('xiaomiAiAmapTestBtn')],
  ];
  const fetchModelsButton = document.getElementById('xiaomiAiFetchModelsBtn');
  const modelInput = document.getElementById('xiaomiAiModel');
  const modelMenu = document.getElementById('xiaomiAiModelMenu');
  const modelFetchState = document.getElementById('xiaomiAiModelFetchState');
  const providerInput = document.getElementById('xiaomiAiModelProvider');
  const reasoningInput = document.getElementById('xiaomiAiReasoning');
  let autosaveTimer = null;
  let saving = false;
  let pendingSave = false;
  let dirty = false;
  let configLoaded = false;
  let savingPromise = null;
  let enabledSavePromise = null;
  let enabledEditVersion = 0;
  let editVersion = 0;
  let initialLoadPromise = null;
  let restoreManualEndpointAfterProviderSave = false;
  let modelRequestGeneration = 0;
  const modelServiceFields = new Set(['xiaomiAiModelProvider', 'xiaomiAiModelAuthMode', 'xiaomiAiDeepSeekUrl',
    'xiaomiAiModelApiProtocol', 'xiaomiAiDeepSeekKey']);
  const editedFieldIds = new Set();
  let personaControls;

  refreshConfig = async () => {
    try {
      const [config, status] = await Promise.all([readApi('/api/ai/config'), readApi('/api/ai/status')]);
      const previousService = JSON.stringify(readModelService());
      renderConfig(config, editedFieldIds);
      if (previousService !== JSON.stringify(readModelService())) invalidateModelLookup();
      personaControls.render(config, editedFieldIds);
      renderStatus(status);
      if (!configLoaded) {
        configLoaded = true;
        if (dirty && form.checkValidity()) {
          clearTimeout(autosaveTimer);
          setState(saveState, '等待自动保存…');
          autosaveTimer = setTimeout(() => void saveConfig(), AUTOSAVE_DELAY_MS);
        }
      }
    } catch (error) {
      setState(saveState, error.message || '无法读取 AI 配置', 'warn');
    }
  };

  const saveConfig = async () => {
    if (!dirty) return true;
    if (!configLoaded) {
      setState(saveState, '配置尚未加载，暂时无法保存；请等待或刷新页面重试。', 'warn');
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
    const submittedConfig = collectConfig();
    // The switch owns its saves, so a late form save cannot turn AI back on.
    delete submittedConfig.enabled;
    const submittedEditVersion = editVersion;
    setState(saveState, '正在保存…');
    savingPromise = (async () => {
      try {
        const config = await readApi('/api/ai/config', {
          method: 'PUT',
          body: JSON.stringify(submittedConfig),
        });
        // Newer edits own the endpoint restoration flag and form rendering.
        if (submittedEditVersion !== editVersion) return true;
        if (restoreManualEndpointAfterProviderSave) {
          const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
          const protocolInput = document.getElementById('xiaomiAiModelApiProtocol');
          if (endpointInput) endpointInput.value = config.deepseekResponsesUrl || '';
          if (protocolInput) protocolInput.value = config.modelApiProtocol || 'auto';
          restoreManualEndpointAfterProviderSave = false;
        }
        renderConfigSummary(config, submittedConfig);
        personaControls.render(config);
        for (const id of editedFieldIds) if (id !== enabledInput.id) editedFieldIds.delete(id);
        setState(saveState, '已保存，后续新弹幕立即生效。', 'good');
        return true;
      } catch (error) {
        dirty = true;
        if (submittedEditVersion === editVersion && restoreManualEndpointAfterProviderSave) {
          restoreManualEndpointAfterProviderSave = false;
          renderProviderSelection(providerInput?.value);
        }
        setState(saveState, error.message || '保存 AI 配置失败', 'warn');
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
      setState(saveState, '请先完成或修正当前输入，随后会自动保存。', 'warn');
      return;
    }
    setState(saveState, immediate ? '正在保存…' : '等待自动保存…');
    if (immediate) void saveConfig();
    else autosaveTimer = setTimeout(() => void saveConfig(), AUTOSAVE_DELAY_MS);
  };

  const flushPendingSave = async () => {
    clearTimeout(autosaveTimer);
    while (enabledSavePromise) if (!(await enabledSavePromise)) return false;
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
      const previousService = JSON.stringify(readModelService());
      renderConfig(config, editedFieldIds);
      if (previousService !== JSON.stringify(readModelService())) invalidateModelLookup();
      personaControls.render(config, editedFieldIds);
    },
  });

  providerInput?.addEventListener('change', () => {
    const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
    const official = ['deepseek', 'kimi', 'openai', 'anthropic', 'gemini', 'doubao'].includes(providerInput.value);
    restoreManualEndpointAfterProviderSave = !official && Boolean(endpointInput?.disabled);
    renderProviderSelection(providerInput.value, {
      keepEndpointLocked: restoreManualEndpointAfterProviderSave,
    });
    invalidateModelLookup();
    if (personaControls.changeProvider()) editedFieldIds.add('xiaomiAiPersona');
    void refreshDoubaoStatus();
    void subscriptionControls.refresh();
  });
  document.getElementById('xiaomiAiModelAuthMode')?.addEventListener('change', () => {
    renderProviderSelection(providerInput.value);
    invalidateModelLookup();
    void subscriptionControls.refresh();
  });

  form.addEventListener('input', (event) => {
    if (modelServiceFields.has(event.target.id)) invalidateModelLookup();
    if (event.target.matches('input[type="checkbox"], input[type="file"]')) return;
    if (event.target.id === 'xiaomiAiPersona') return;
    if (event.target.id) editedFieldIds.add(event.target.id);
    scheduleSave();
  });

  form.addEventListener('change', (event) => {
    if (event.target.id === 'xiaomiAiChatGptProfiles') return;
    if (modelServiceFields.has(event.target.id)) invalidateModelLookup();
    if (event.target.matches('input[type="checkbox"], input[type="number"], select')) {
      if (event.target.id === 'xiaomiAiPersona' && !personaControls.changeSelection()) return;
      if (event.target.id) editedFieldIds.add(event.target.id);
      if (event.target === reasoningInput) syncReasoningEffortAvailability();
      renderToolSettings();
      scheduleSave(true);
    }
  });

  const saveEnabled = () => {
    const enabled = enabledInput.checked;
    const version = ++enabledEditVersion;
    editedFieldIds.add(enabledInput.id);
    const operation = (enabledSavePromise || Promise.resolve()).then(async () => {
      try {
        await initialLoadPromise;
        if (!configLoaded) throw new Error('配置尚未加载，暂时无法保存；请等待或刷新页面重试。');
        if (version === enabledEditVersion) setState(saveState, '正在保存…');
        await readApi('/api/ai/config', { method: 'PUT', body: JSON.stringify({ enabled }) });
        if (version === enabledEditVersion) {
          editedFieldIds.delete(enabledInput.id);
          if (!enabled) renderStatus({ queued: 0 });
          setState(saveState, enabled ? '已开启，只处理新的触发弹幕。' : '已关闭，未完成的回复已取消；已发出的弹幕无法撤回。', 'good');
        }
        return true;
      } catch (error) {
        if (version === enabledEditVersion) setState(saveState, error.message || '保存 AI 开关失败', 'warn');
        return false;
      }
    });
    enabledSavePromise = operation;
    void operation.then(() => { if (enabledSavePromise === operation) enabledSavePromise = null; });
  };
  enabledInput.addEventListener('change', saveEnabled);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (editedFieldIds.has(enabledInput.id) && !enabledSavePromise) saveEnabled();
    if (!form.reportValidity()) return;
    scheduleSave(true);
  });

  for (const [provider, button] of providerTestButtons) {
    button.addEventListener('click', () => void runProviderTest(provider, button));
  }

  async function runProviderTest(provider, button) {
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
      setState(testDetail, `正在测试 ${label} 连接…`);
      const result = await readApi(`/api/ai/test/${provider}`, {
        method: 'POST',
        body: '{}',
      });
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
      const message = providerErrorMessage(provider, error);
      setState(testDetail, `${label}：${message}`, 'warn');
      showProviderToast(notify, {
        provider,
        good: false,
        title: `${label} 测试未通过`,
        message: '请查看测试区域的错误详情',
      });
    } finally {
      button.disabled = false;
    }
  }

  function readModelService() {
    const input = document.getElementById('xiaomiAiDeepSeekKey');
    const key = input.disabled ? '' : input.value.trim();
    return {
      apiKey: key === '********' ? '' : key,
      apiUrl: document.getElementById('xiaomiAiDeepSeekUrl').value.trim(),
      modelProvider: providerInput?.value || 'auto',
      modelAuthMode: document.getElementById('xiaomiAiModelAuthMode')?.value || 'api',
      modelApiProtocol: document.getElementById('xiaomiAiModelApiProtocol')?.value || 'auto',
    };
  }

  function invalidateModelLookup() {
    modelRequestGeneration += 1;
    modelMenu.replaceChildren();
    closeModelMenu();
    setState(modelFetchState, '');
    fetchModelsButton.disabled = providerInput?.value === 'doubao';
    fetchModelsButton.textContent = '获取模型';
  }

  fetchModelsButton.addEventListener('click', async () => {
    const generation = ++modelRequestGeneration;
    const service = JSON.stringify(readModelService());
    const isCurrent = () => generation === modelRequestGeneration && service === JSON.stringify(readModelService());
    fetchModelsButton.disabled = true;
    fetchModelsButton.textContent = '获取中…';
    setState(modelFetchState, '正在从当前模型服务获取可用模型…');
    try {
      const result = await readApi('/api/ai/models', {
        method: 'POST',
        body: service,
      });
      if (!isCurrent()) return;
      const models = Array.isArray(result.models) ? result.models : [];
      const menuItems = models.map((model) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'xiaomi-ai-model-option lira-select-option';
        item.setAttribute('role', 'option');
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(model === modelInput.value));
        item.textContent = model;
        item.addEventListener('click', () => {
          if (!isCurrent()) return;
          modelInput.value = model;
          editedFieldIds.add(modelInput.id);
          closeModelMenu();
          scheduleSave();
        });
        return item;
      });
      modelMenu.replaceChildren(...menuItems);
      setState(
        modelFetchState,
        `已获取 ${menuItems.length} 个可用模型；可选择或直接输入。`,
        menuItems.length ? 'good' : 'warn',
      );
      modelMenu.hidden = menuItems.length === 0;
      modelInput.setAttribute('aria-expanded', String(menuItems.length > 0));
      fetchModelsButton.setAttribute('aria-expanded', String(menuItems.length > 0));
    } catch (error) {
      if (isCurrent()) setState(modelFetchState, error.message || '无法获取当前服务的模型列表。', 'warn');
    } finally {
      if (generation === modelRequestGeneration) {
        fetchModelsButton.disabled = false;
        fetchModelsButton.textContent = '获取模型';
      }
    }
  });

  modelInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModelMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !modelMenu.children.length) return;
    event.preventDefault();
    const options = [...modelMenu.querySelectorAll('[role="option"]')];
    const selectedIndex = options.findIndex((item) => item.getAttribute('aria-selected') === 'true');
    const nextIndex = modelMenu.hidden
      ? event.key === 'ArrowUp'
        ? options.length - 1
        : selectedIndex < 0
          ? 0
          : selectedIndex
      : event.key === 'ArrowUp'
        ? Math.max(0, selectedIndex < 0 ? options.length - 1 : selectedIndex - 1)
        : Math.min(options.length - 1, selectedIndex < 0 ? 0 : selectedIndex + 1);
    openModelMenu();
    focusModelOption(options[nextIndex]);
  });

  if (typeof modelMenu?.addEventListener === 'function')
    modelMenu.addEventListener('keydown', (event) => {
      const options = [...modelMenu.querySelectorAll('[role="option"]')];
      const currentIndex = options.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : event.key === 'ArrowUp'
                ? Math.max(0, currentIndex - 1)
                : Math.min(options.length - 1, currentIndex + 1);
        focusModelOption(options[nextIndex]);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options[currentIndex >= 0 ? currentIndex : 0]?.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeModelMenu();
        modelInput.focus();
      } else if (event.key === 'Tab') {
        closeModelMenu();
      }
    });

  if (typeof document?.addEventListener === 'function') {
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.xiaomi-ai-model-picker')) closeModelMenu();
    });
  }

  function openModelMenu() {
    if (!modelMenu.children.length) return;
    modelMenu.hidden = false;
    modelInput.setAttribute('aria-expanded', 'true');
    fetchModelsButton.setAttribute('aria-expanded', 'true');
  }

  function focusModelOption(option) {
    if (!option) return;
    option.focus({ preventScroll: true });
    option.scrollIntoView?.({ block: 'nearest' });
  }

  function closeModelMenu() {
    modelMenu.hidden = true;
    modelInput.setAttribute('aria-expanded', 'false');
    fetchModelsButton.setAttribute('aria-expanded', 'false');
  }

  let doubaoRefreshPending = false;
  const subscriptionControls = createSubscriptionControls({ readApi, onAccountChange: invalidateModelLookup,
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
        await initialLoadPromise;
        if (!configLoaded || !(await flushPendingSave())) return;
        renderDoubaoStatus(await readApi(`/api/ai/doubao/${operation}`, { method: 'POST' }));
      } catch (error) {
        setState(document.getElementById('xiaomiAiDoubaoState'), error.message, 'warn');
      } finally { button.disabled = false; }
    });
  }
  if (typeof window?.addEventListener === 'function') {
    const timer = setInterval(() => { void refreshDoubaoStatus(); void subscriptionControls.refresh(); }, 3000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
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
    className: `xiaomi-ai-test-toast xiaomi-ai-test-toast-${good ? 'good' : 'warn'}`,
    duration: good ? 3600 : 5200,
  });
}

function refresh() {
  return refreshConfig ? refreshConfig() : Promise.resolve();
}

export const aiAssistantSettings = { init, refresh };
publishAiAssistantSettings(aiAssistantSettings);

'use strict';

import {
  readApi,
  collectConfig,
  renderConfig,
  renderConfigSummary,
  renderProviderSelection,
  syncReasoningEffortAvailability,
  renderStatus,
  setState,
  providerLabel,
  providerErrorMessage,
  codedClientError,
} from './ai-assistant-config-view.js';

let initialized = false;
let refreshConfig = null;
const AUTOSAVE_DELAY_MS = 700;

function init() {
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
  let initialLoadPromise = null;
  let restoreManualEndpointAfterProviderSave = false;
  const editedFieldIds = new Set();

  refreshConfig = async () => {
    try {
      const [config, status] = await Promise.all([
        readApi('/api/ai/config'),
        readApi('/api/ai/status'),
      ]);
      renderConfig(config, editedFieldIds);
      renderStatus(status);
      if (!configLoaded) {
        configLoaded = true;
        if (dirty && form.checkValidity()) {
          clearTimeout(autosaveTimer);
          setState(saveState, '等待自动保存…');
          autosaveTimer = setTimeout(
            () => void saveConfig(),
            AUTOSAVE_DELAY_MS,
          );
        }
      }
    } catch (error) {
      setState(saveState, error.message || '无法读取 AI 配置', 'warn');
    }
  };

  const saveConfig = async () => {
    if (!dirty) return true;
    if (!configLoaded) {
      setState(
        saveState,
        '配置尚未加载，暂时无法保存；请等待或刷新页面重试。',
        'warn',
      );
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
    setState(saveState, '正在保存…');
    savingPromise = (async () => {
      try {
        const config = await readApi('/api/ai/config', {
          method: 'PUT',
          body: JSON.stringify(submittedConfig),
        });
        if (restoreManualEndpointAfterProviderSave) {
          const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
          const protocolInput = document.getElementById(
            'xiaomiAiModelApiProtocol',
          );
          if (endpointInput)
            endpointInput.value = config.deepseekResponsesUrl || '';
          if (protocolInput)
            protocolInput.value = config.modelApiProtocol || 'auto';
          restoreManualEndpointAfterProviderSave = false;
        }
        renderConfigSummary(config);
        editedFieldIds.clear();
        setState(saveState, '已保存，后续新弹幕立即生效。', 'good');
        return true;
      } catch (error) {
        dirty = true;
        if (restoreManualEndpointAfterProviderSave) {
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

  providerInput?.addEventListener('change', () => {
    const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
    const official = ['deepseek', 'openai', 'anthropic', 'gemini'].includes(
      providerInput.value,
    );
    restoreManualEndpointAfterProviderSave =
      !official && Boolean(endpointInput?.disabled);
    renderProviderSelection(providerInput.value, {
      keepEndpointLocked: restoreManualEndpointAfterProviderSave,
    });
  });

  form.addEventListener('input', (event) => {
    if (event.target.matches('input[type="checkbox"]')) return;
    if (event.target.id) editedFieldIds.add(event.target.id);
    scheduleSave();
  });

  form.addEventListener('change', (event) => {
    if (
      event.target.matches(
        'input[type="checkbox"], input[type="number"], select',
      )
    ) {
      if (event.target.id) editedFieldIds.add(event.target.id);
      if (event.target === reasoningInput) syncReasoningEffortAvailability();
      scheduleSave(true);
    }
  });

  enabledInput.addEventListener('change', () => {
    editedFieldIds.add(enabledInput.id);
    scheduleSave(true);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    scheduleSave(true);
  });

  for (const [provider, button] of providerTestButtons) {
    button.addEventListener(
      'click',
      () => void runProviderTest(provider, button),
    );
  }

  async function runProviderTest(provider, button) {
    const label = providerLabel(provider);
    button.disabled = true;
    setState(saveState, `正在准备 ${label} 连接测试…`);
    try {
      await initialLoadPromise;
      if (!form.reportValidity())
        throw codedClientError('FORM_INVALID', '请先修正表单中的网址或数值。');
      if (!(await flushPendingSave()))
        throw codedClientError('SAVE_FAILED', '配置保存失败，未运行连接测试。');
      setState(saveState, `正在测试 ${label} 连接…`);
      const result = await readApi(`/api/ai/test/${provider}`, {
        method: 'POST',
        body: '{}',
      });
      const detail =
        provider === 'deepseek' && result.reply
          ? `模型 ${result.model} 回复：${result.reply}`
          : '地址与密钥均可用';
      setState(saveState, `${label} 连接正常。`, 'good');
      showProviderToast({
        provider,
        good: true,
        title: `${label} 测试通过`,
        message: detail,
      });
    } catch (error) {
      const message = providerErrorMessage(provider, error);
      setState(saveState, message, 'warn');
      showProviderToast({
        provider,
        good: false,
        title: `${label} 测试未通过`,
        message,
      });
    } finally {
      button.disabled = false;
    }
  }

  fetchModelsButton.addEventListener('click', async () => {
    fetchModelsButton.disabled = true;
    fetchModelsButton.textContent = '获取中…';
    setState(modelFetchState, '正在从当前模型服务获取可用模型…');
    try {
      const apiKeyInput = document.getElementById('xiaomiAiDeepSeekKey');
      const apiKeyValue = apiKeyInput.value.trim();
      // A previously saved key is intentionally not populated in the input.
      // Keep this guard for older renderer state that may still contain the mask.
      const apiKey = apiKeyValue === '********' ? '' : apiKeyValue;
      const apiUrl = document
        .getElementById('xiaomiAiDeepSeekUrl')
        .value.trim();
      const modelProvider =
        document.getElementById('xiaomiAiModelProvider')?.value || 'auto';
      const modelApiProtocol =
        document.getElementById('xiaomiAiModelApiProtocol')?.value || 'auto';
      const result = await readApi('/api/ai/models', {
        method: 'POST',
        body: JSON.stringify({
          apiKey,
          apiUrl,
          modelProvider,
          modelApiProtocol,
        }),
      });
      const models = Array.isArray(result.models) ? result.models : [];
      const menuItems = models.map((model) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'xiaomi-ai-model-option';
        item.setAttribute('role', 'option');
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(model === modelInput.value));
        item.textContent = model;
        item.addEventListener('click', () => {
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
      fetchModelsButton.setAttribute(
        'aria-expanded',
        String(menuItems.length > 0),
      );
    } catch (error) {
      setState(
        modelFetchState,
        error.message || '无法获取当前服务的模型列表。',
        'warn',
      );
    } finally {
      fetchModelsButton.disabled = false;
      fetchModelsButton.textContent = '获取模型';
    }
  });

  modelInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModelMenu();
      return;
    }
    if (
      !['ArrowDown', 'ArrowUp'].includes(event.key) ||
      !modelMenu.children.length
    )
      return;
    event.preventDefault();
    const options = [...modelMenu.querySelectorAll('[role="option"]')];
    const selectedIndex = options.findIndex(
      (item) => item.getAttribute('aria-selected') === 'true',
    );
    const nextIndex = modelMenu.hidden
      ? event.key === 'ArrowUp'
        ? options.length - 1
        : selectedIndex < 0
          ? 0
          : selectedIndex
      : event.key === 'ArrowUp'
        ? Math.max(
            0,
            selectedIndex < 0 ? options.length - 1 : selectedIndex - 1,
          )
        : Math.min(
            options.length - 1,
            selectedIndex < 0 ? 0 : selectedIndex + 1,
          );
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

  initialLoadPromise = refreshConfig();
}

function showProviderToast({ provider, good, title, message }) {
  window.AdminApp?.utils?.showStackedToast?.({
    key: `xiaomi-ai-test:${provider}:${good ? 'good' : 'warn'}:${message}`,
    title,
    message,
    className: `xiaomi-ai-test-toast xiaomi-ai-test-toast-${good ? 'good' : 'warn'}`,
    duration: good ? 3600 : 5200,
  });
}

function refresh() {
  return refreshConfig ? refreshConfig() : Promise.resolve();
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.aiAssistantSettings = { init, refresh };

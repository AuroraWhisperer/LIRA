import { setState } from './ai-assistant-config-view.js';

export function createAiModelPicker({ readApi, onSelect }) {
  const fetchModelsButton = document.getElementById('xiaomiAiFetchModelsBtn');
  const modelInput = document.getElementById('xiaomiAiModel');
  const modelMenu = document.getElementById('xiaomiAiModelMenu');
  const modelFetchState = document.getElementById('xiaomiAiModelFetchState');
  const providerInput = document.getElementById('xiaomiAiModelProvider');
  let modelRequestGeneration = 0;
  const modelServiceFields = new Set(['xiaomiAiModelProvider', 'xiaomiAiModelAuthMode', 'xiaomiAiDeepSeekUrl',
    'xiaomiAiModelApiProtocol', 'xiaomiAiDeepSeekKey']);

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
    const service = readModelService();
    // Credential edits advance the generation; committing that same draft only clears its input.
    const signature = JSON.stringify({ ...service, apiKey: '' });
    const isCurrent = () => generation === modelRequestGeneration
      && signature === JSON.stringify({ ...readModelService(), apiKey: '' });
    fetchModelsButton.disabled = true;
    fetchModelsButton.textContent = '获取中…';
    setState(modelFetchState, '正在从当前模型服务获取可用模型…');
    try {
      const result = await readApi('/api/ai/models', {
        method: 'POST',
        body: JSON.stringify(service),
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
          closeModelMenu();
          onSelect(modelInput.id);
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

  return {
    readService: readModelService,
    invalidate: invalidateModelLookup,
    invalidateField(id) {
      if (modelServiceFields.has(id)) invalidateModelLookup();
    },
  };
}

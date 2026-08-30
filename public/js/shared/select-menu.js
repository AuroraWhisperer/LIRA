'use strict';

let selectMenuId = 0;
const enhancedSelects = new WeakMap();
let selectObserverInstalled = false;

const SELECT_VALUE = Object.getOwnPropertyDescriptor(
  HTMLSelectElement.prototype,
  'value',
);
const SELECTED_INDEX = Object.getOwnPropertyDescriptor(
  HTMLSelectElement.prototype,
  'selectedIndex',
);

function getVariant(select) {
  return (
    select.dataset.dropdownVariant ||
    select.closest('[data-dropdown-variant]')?.dataset.dropdownVariant ||
    'default'
  );
}

function getLabelText(select) {
  const label = select.labels?.[0];
  if (!label) return '';
  const clone = label.cloneNode(true);
  clone.querySelectorAll('select').forEach((node) => node.remove());
  return clone.textContent.trim().replace(/\s+/g, ' ');
}

function getOptionNodes(select) {
  const nodes = [];
  for (const child of select.children) {
    if (child.tagName === 'OPTGROUP') {
      const group = document.createElement('div');
      group.className = 'lira-select-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', child.label || '选项');
      const groupOptions = [];
      for (const option of child.children) {
        if (option.tagName === 'OPTION') groupOptions.push(option);
      }
      groupOptions.forEach((option) =>
        nodes.push({
          option,
          group,
          disabled: child.disabled || option.disabled,
        }),
      );
      continue;
    }
    if (child.tagName === 'OPTION')
      nodes.push({ option: child, group: null, disabled: child.disabled });
  }
  return nodes;
}

function syncSelectedState(state) {
  const { select, trigger, valueNode, menu, labelText } = state;
  const selected = select.options[select.selectedIndex];
  valueNode.textContent = selected?.textContent?.trim() || '请选择';
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-disabled', String(select.disabled));
  trigger.setAttribute(
    'aria-label',
    select.getAttribute('aria-label') || labelText || '选择',
  );
  menu.setAttribute(
    'aria-label',
    select.getAttribute('aria-label') || labelText || '选项',
  );

  menu.querySelectorAll('[role="option"]').forEach((optionNode) => {
    const isSelected =
      optionNode.dataset.value === select.value &&
      optionNode.dataset.index === String(select.selectedIndex);
    optionNode.setAttribute('aria-selected', String(isSelected));
    optionNode.classList.toggle('is-selected', isSelected);
  });
}

function focusOption(state, index) {
  const options = [
    ...state.menu.querySelectorAll(
      '[role="option"]:not([aria-disabled="true"])',
    ),
  ];
  if (!options.length) return;
  const next = options[Math.max(0, Math.min(index, options.length - 1))];
  options.forEach((option) =>
    option.classList.toggle('is-keyboard-focused', option === next),
  );
  next.focus();
}

function closeMenu(state, { restoreFocus = true } = {}) {
  if (!state.open) return;
  state.open = false;
  state.wrapper.classList.remove('is-open', 'is-above');
  state.trigger.setAttribute('aria-expanded', 'false');
  state.menu.hidden = true;
  state.menu.removeAttribute('aria-activedescendant');
  state.menu
    .querySelectorAll('.is-keyboard-focused')
    .forEach((option) => option.classList.remove('is-keyboard-focused'));
  if (restoreFocus) state.trigger.focus();
}

function openMenu(state, initialOffset = 0) {
  if (state.select.disabled || state.open) return;
  closeOpenMenus(state);
  state.open = true;
  state.wrapper.classList.add('is-open');
  state.trigger.setAttribute('aria-expanded', 'true');
  state.menu.hidden = false;

  const triggerRect = state.trigger.getBoundingClientRect();
  const menuRect = state.menu.getBoundingClientRect();
  const opensAbove =
    menuRect.bottom > window.innerHeight - 12 &&
    triggerRect.top > menuRect.height + 12;
  state.wrapper.classList.toggle('is-above', opensAbove);

  const options = [
    ...state.menu.querySelectorAll(
      '[role="option"]:not([aria-disabled="true"])',
    ),
  ];
  const selectedIndex = Math.max(
    0,
    options.findIndex(
      (option) => option.getAttribute('aria-selected') === 'true',
    ),
  );
  focusOption(state, selectedIndex + initialOffset);
}

function closeOpenMenus(except) {
  document.querySelectorAll('.lira-select.is-open').forEach((wrapper) => {
    const state = enhancedSelects.get(wrapper.querySelector('select'));
    if (state && state !== except) closeMenu(state, { restoreFocus: false });
  });
}

function selectOption(state, optionNode) {
  if (!optionNode || optionNode.getAttribute('aria-disabled') === 'true')
    return;
  const nextIndex = Number(optionNode.dataset.index);
  const changed = state.select.selectedIndex !== nextIndex;
  state.select.selectedIndex = nextIndex;
  syncSelectedState(state);
  closeMenu(state);
  if (changed)
    state.select.dispatchEvent(new Event('change', { bubbles: true }));
}

function buildOptions(state) {
  state.menu.replaceChildren();
  let optionIndex = 0;
  for (const { option, group, disabled } of getOptionNodes(state.select)) {
    if (group && !group.parentNode) {
      group.dataset.variant = state.variant;
      state.menu.append(group);
    }
    const optionNode = document.createElement('button');
    optionNode.type = 'button';
    optionNode.className = 'lira-select-option';
    optionNode.setAttribute('role', 'option');
    optionNode.dataset.value = option.value;
    optionNode.dataset.index = String(optionIndex);
    optionNode.textContent = option.textContent.trim();
    optionNode.setAttribute('aria-disabled', String(disabled));
    optionNode.disabled = disabled;
    (group || state.menu).append(optionNode);
    optionNode.addEventListener('click', () => selectOption(state, optionNode));
    optionIndex += 1;
  }
  if (!optionIndex) {
    const empty = document.createElement('div');
    empty.className = 'lira-select-empty';
    empty.textContent = '暂无可选项';
    state.menu.append(empty);
  }
  syncSelectedState(state);
  if (state.open) {
    const options = [
      ...state.menu.querySelectorAll(
        '[role="option"]:not([aria-disabled="true"])',
      ),
    ];
    const selectedIndex = Math.max(
      0,
      options.findIndex(
        (option) => option.getAttribute('aria-selected') === 'true',
      ),
    );
    focusOption(state, selectedIndex);
  }
}

function patchNativeValue(state) {
  const { select } = state;
  if (SELECT_VALUE?.get && SELECT_VALUE?.set) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() {
        return SELECT_VALUE.get.call(this);
      },
      set(nextValue) {
        SELECT_VALUE.set.call(this, nextValue);
        syncSelectedState(state);
      },
    });
  }
  if (SELECTED_INDEX?.get && SELECTED_INDEX?.set) {
    Object.defineProperty(select, 'selectedIndex', {
      configurable: true,
      get() {
        return SELECTED_INDEX.get.call(this);
      },
      set(nextIndex) {
        SELECTED_INDEX.set.call(this, nextIndex);
        syncSelectedState(state);
      },
    });
  }
}

function enhanceSelect(select) {
  if (
    !(select instanceof HTMLSelectElement) ||
    select.multiple ||
    enhancedSelects.has(select)
  )
    return null;
  const labelText = getLabelText(select);
  const wrapper = document.createElement('div');
  wrapper.className = 'lira-select';
  const variant = getVariant(select);
  wrapper.dataset.selectVariant = variant;
  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select);

  const id = select.id || `lira-select-${++selectMenuId}`;
  const menuId = `${id}-options`;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lira-select-trigger';
  trigger.id = `${id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', menuId);
  trigger.setAttribute('aria-expanded', 'false');
  if (select.hasAttribute('aria-label'))
    trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
  if (select.hasAttribute('aria-describedby'))
    trigger.setAttribute(
      'aria-describedby',
      select.getAttribute('aria-describedby'),
    );
  const valueNode = document.createElement('span');
  valueNode.className = 'lira-select-value';
  const chevron = document.createElement('span');
  chevron.className = 'lira-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(valueNode, chevron);

  const menu = document.createElement('div');
  menu.className = 'lira-select-menu';
  menu.id = menuId;
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('tabindex', '-1');
  menu.setAttribute('aria-label', select.getAttribute('aria-label') || '选项');
  const state = {
    select,
    wrapper,
    trigger,
    valueNode,
    menu,
    variant,
    labelText,
    open: false,
    observer: null,
  };
  enhancedSelects.set(select, state);

  select.classList.add('lira-select-native');
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');
  wrapper.append(trigger, menu);
  buildOptions(state);
  patchNativeValue(state);

  trigger.addEventListener('click', () =>
    state.open ? closeMenu(state) : openMenu(state),
  );
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      openMenu(state, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      openMenu(state, -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      state.open ? closeMenu(state) : openMenu(state);
    }
  });
  menu.addEventListener('keydown', (event) => {
    const options = [
      ...menu.querySelectorAll('[role="option"]:not([aria-disabled="true"])'),
    ];
    const current = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusOption(state, current < 0 ? 0 : (current + 1) % options.length);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      focusOption(
        state,
        current < 0
          ? options.length - 1
          : (current - 1 + options.length) % options.length,
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusOption(state, event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(state, document.activeElement);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(state);
    } else if (event.key === 'Tab') {
      closeMenu(state, { restoreFocus: false });
    }
  });
  menu.addEventListener('focusout', () => {
    setTimeout(() => {
      if (state.open && !wrapper.contains(document.activeElement))
        closeMenu(state, { restoreFocus: false });
    }, 0);
  });
  document.addEventListener('pointerdown', (event) => {
    if (state.open && !wrapper.contains(event.target))
      closeMenu(state, { restoreFocus: false });
  });
  select.addEventListener('change', () => syncSelectedState(state));
  select.form?.addEventListener('reset', () => {
    setTimeout(() => syncSelectedState(state), 0);
  });
  state.observer = new MutationObserver(() => buildOptions(state));
  state.observer.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'label', 'selected', 'value'],
  });
  return state;
}

function installSelectObserver() {
  if (
    selectObserverInstalled ||
    !document.body ||
    typeof MutationObserver === 'undefined'
  )
    return;
  selectObserverInstalled = true;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceSelects(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function enhanceSelects(root = document) {
  installSelectObserver();
  const selects = [];
  if (root?.tagName === 'SELECT') selects.push(root);
  if (root?.querySelectorAll) selects.push(...root.querySelectorAll('select'));
  selects.forEach(enhanceSelect);
  return selects.length;
}

export function refreshEnhancedSelect(select) {
  const state = enhancedSelects.get(select);
  if (!state) return false;
  buildOptions(state);
  return true;
}

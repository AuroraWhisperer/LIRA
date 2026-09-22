'use strict';

const EXIT_MS = 180;
const TYPE_LABELS = { info: '提示', success: '成功', warning: '注意', error: '错误' };

// Each stack owns its nodes, timers and pending results. No business state lives here.
export function createToastStack({
  container,
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  setTimeout: later = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
  now = Date.now,
  systemLimit = 3,
  giftLimit = 6,
} = {}) {
  const entries = new Map();
  const leaving = new Set();
  let sequence = 0;
  let disposed = false;
  const reduced = () => windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const announcer = documentRef.createElement('div');
  announcer.className = 'toast-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  container.after(announcer);

  function stopTimer(entry) {
    if (entry.timer !== null) cancel(entry.timer);
    entry.timer = null;
  }

  function resume(entry) {
    if (!entry.visible || entry.closed || entry.hovered || entry.focused || !entry.duration || entry.timer !== null)
      return;
    entry.started = now();
    entry.timer = later(() => close(entry), Math.max(0, entry.remaining));
  }

  function pause(entry) {
    if (entry.timer !== null) entry.remaining -= now() - entry.started;
    stopTimer(entry);
  }

  function announce(entry) {
    if (entry.gift || !entry.needsAnnouncement) return;
    announcer.setAttribute('role', entry.options.urgent ? 'alert' : 'status');
    announcer.setAttribute('aria-live', entry.options.urgent ? 'assertive' : 'polite');
    announcer.textContent = `${TYPE_LABELS[entry.type]}：${entry.content.textContent}`;
    entry.needsAnnouncement = false;
  }

  function layout() {
    if (disposed) return;
    const sorted = [...entries.values()].sort(
      (a, b) =>
        Number(b.focused || b.hovered) - Number(a.focused || a.hovered) ||
        Number(a.gift) - Number(b.gift) ||
        Number(b.type === 'error' || !!b.options.onClick) - Number(a.type === 'error' || !!a.options.onClick) ||
        b.order - a.order,
    );
    const oldTops = new Map(sorted.filter((e) => e.visible).map((e) => [e, e.node.getBoundingClientRect().top]));
    // CSS ordering preserves focused controls; re-appending a node would blur them.
    sorted.forEach((entry, index) => {
      entry.node.style.order = index;
    });
    let height = 0;
    let systems = 0;
    let gifts = 0;
    const top = container.getBoundingClientRect().top;
    const budget = Math.max(0, (windowRef?.innerHeight || 720) - top - 16);
    for (const entry of sorted) {
      entry.node.hidden = false;
      const size = entry.node.getBoundingClientRect().height;
      const fitsCount = entry.gift ? gifts < giftLimit : systems < systemLimit;
      const visible = fitsCount && height + size <= budget;
      entry.node.hidden = !visible;
      if (visible) {
        height += size + 10;
        if (entry.gift) gifts += 1;
        else systems += 1;
      }
      if (!visible) pause(entry);
      entry.visible = visible;
      if (visible) {
        resume(entry);
        announce(entry);
      }
    }
    if (!reduced()) {
      for (const entry of sorted.filter((item) => item.visible)) {
        const previous = oldTops.get(entry);
        const delta = previous === undefined ? 0 : previous - entry.node.getBoundingClientRect().top;
        if (delta)
          entry.node.animate?.([{ translate: `0 ${delta}px` }, { translate: '0 0' }], {
            duration: EXIT_MS,
            easing: 'ease-out',
          });
      }
    }
    // Gifts are transient events; hidden system results wait for available space.
    for (const entry of sorted) {
      if (entry.gift && !entry.visible) close(entry, true, false);
    }
  }

  function close(entry, immediate = false, relayout = true) {
    if (entry.closed) return;
    entry.closed = true;
    stopTimer(entry);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (entry.node.contains(documentRef.activeElement)) {
      const next = [...entries.values()].find((other) => other.visible && !other.action.hidden);
      if (next) next.action.focus();
      else if (entry.returnFocus?.isConnected) entry.returnFocus.focus();
      else documentRef.activeElement?.blur?.();
    }
    const remove = () => {
      entry.node.remove();
      leaving.delete(entry);
    };
    if (immediate || !entry.visible || reduced()) remove();
    else {
      const offset = entry.node.getBoundingClientRect().top - container.getBoundingClientRect().top;
      entry.node.style.position = 'absolute';
      entry.node.style.top = `${offset}px`;
      entry.node.style.right = '0';
      entry.node.style.pointerEvents = 'none';
      entry.node.classList.remove('show');
      leaving.add(entry);
      entry.exitTimer = later(remove, EXIT_MS);
    }
    if (relayout) layout();
  }

  function render(entry, options) {
    pause(entry);
    entry.options = options;
    entry.type = TYPE_LABELS[options.type] ? options.type : 'info';
    entry.gift = (options.className || '').includes('gift-notify-toast');
    entry.duration =
      options.duration === 0
        ? 0
        : Math.max(
            Number(options.duration) || 2600,
            options.onClick ? 8000 : ['error', 'warning'].includes(entry.type) ? 6000 : 0,
          );
    entry.remaining = entry.duration;
    const detailed = Boolean(options.title || options.html);
    entry.node.className = `toast toast-${entry.type}${detailed ? ' toast-detailed' : ''}${options.className ? ` ${options.className}` : ''}`;
    entry.content.className = `toast-content${detailed ? '' : ' toast-content-compact'}`;
    entry.content.replaceChildren();
    if (options.html) entry.content.innerHTML = options.html;
    else {
      if (options.title) {
        const title = documentRef.createElement('strong');
        title.textContent = options.title;
        entry.content.append(title);
      }
      if (options.message || !options.title) {
        const message = documentRef.createElement('span');
        message.className = 'toast-message';
        message.textContent = options.message || '';
        entry.content.append(message);
      }
    }
    if (!detailed) {
      const symbol = documentRef.createElement('span');
      symbol.className = 'toast-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      const paths =
        entry.type === 'warning'
          ? '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/>'
          : `<circle cx="12" cy="12" r="9"/>${
              entry.type === 'success'
                ? '<path d="m8 12 3 3 5-6"/>'
                : entry.type === 'error'
                  ? '<path d="M12 7v6m0 4h.01"/>'
                  : '<path d="M12 11v6m0-10h.01"/>'
            }`;
      symbol.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
      entry.content.prepend(symbol);
    }
    entry.action.hidden = typeof options.onClick !== 'function';
    entry.action.textContent = options.actionLabel || '查看';
    entry.node.setAttribute('aria-label', options.title || TYPE_LABELS[entry.type]);
    entry.needsAnnouncement = true;
    void entry.node.offsetWidth;
    entry.node.classList.add('show');
  }

  function show(options) {
    if (disposed) return;
    const key = options.key || `toast:${options.title || ''}:${options.message || ''}`;
    const existing = entries.get(key);
    if (existing) {
      if (options.update) {
        render(existing, options);
        layout();
      }
      return existing.handle;
    }
    const node = documentRef.createElement('div');
    const content = documentRef.createElement('div');
    content.className = 'toast-content';
    const action = documentRef.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    node.append(content, action);
    const entry = {
      key,
      node,
      content,
      action,
      order: ++sequence,
      returnFocus: documentRef.activeElement,
      timer: null,
      visible: false,
      hovered: false,
      focused: false,
      closed: false,
    };
    entry.handle = {
      node,
      update: (next) => show({ ...entry.options, ...next, key, update: true }),
      close: (immediate = false) => close(entry, immediate),
    };
    action.addEventListener('click', () => {
      if (entry.closed) return;
      const callback = entry.options.onClick;
      close(entry);
      callback?.();
    });
    node.addEventListener('mouseenter', () => {
      entry.hovered = true;
      pause(entry);
    });
    node.addEventListener('mouseleave', () => {
      entry.hovered = false;
      resume(entry);
    });
    node.addEventListener('focusin', () => {
      entry.focused = true;
      pause(entry);
    });
    node.addEventListener('focusout', (event) => {
      if (node.contains(event.relatedTarget)) return;
      entry.focused = false;
      resume(entry);
    });
    entries.set(key, entry);
    container.prepend(node);
    render(entry, options);
    layout();
    return entry.handle;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of entries.values()) close(entry, true, false);
    for (const entry of leaving) {
      cancel(entry.exitTimer);
      entry.node.remove();
    }
    leaving.clear();
    announcer.remove();
    windowRef?.removeEventListener?.('resize', layout);
    windowRef?.removeEventListener?.('pagehide', dispose);
  }
  windowRef?.addEventListener?.('resize', layout);
  windowRef?.addEventListener?.('pagehide', dispose, { once: true });
  return { show, dispose, refresh: layout };
}

const stacks = new WeakMap();
export function getToastStack(options) {
  let stack = stacks.get(options.container);
  if (!stack) {
    stack = createToastStack(options);
    stacks.set(options.container, stack);
  }
  return stack;
}

export function showStackedToast(options) {
  const container = document.getElementById('toast');
  if (!container) return;
  return getToastStack({ container }).show(options);
}

export function toast(message, options = {}) {
  return showStackedToast({ key: `toast:${message}`, message, ...options });
}

'use strict';

let confirmationId = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderList(label, items, className) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const list = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<section class="lira-confirm-details ${className}"><strong>${escapeHtml(label)}</strong><ul>${list}</ul></section>`;
}

/**
 * Render a small, accessible confirmation dialog without knowing anything about the caller's domain.
 * @param {Object} options
 * @returns {Promise<boolean>}
 */
export function showConfirmationDialog(options = {}) {
  const variant = ['normal', 'caution', 'destructive'].includes(options.variant)
    ? options.variant
    : 'normal';
  const title = String(options.title || '确认操作');
  const description = String(options.description ?? options.message ?? '');
  const confirmLabel = String(options.confirmLabel || options.confirmText || '继续');
  const cancelLabel = String(options.cancelLabel || options.cancelText || '取消');
  const closeOnBackdrop = options.closeOnBackdrop ?? variant !== 'destructive';
  const dialogId = ++confirmationId;
  const titleId = `lira-confirm-title-${dialogId}`;
  const descriptionId = `lira-confirm-description-${dialogId}`;
  const icon = options.icon ? `<span class="lira-confirm-indicator" aria-hidden="true">${escapeHtml(options.icon)}</span>` : '';
  const kicker = variant === 'destructive'
    ? '<span class="lira-confirm-kicker">这项操作无法撤销</span>'
    : variant === 'caution'
      ? '<span class="lira-confirm-kicker">请确认这一步</span>'
      : '';
  const deletes = renderList('将移除', options.deletes, 'is-destructive');
  const keeps = renderList('会保留', options.keeps, 'is-kept');
  const platform = options.platform
    ? `<p class="lira-confirm-context">${escapeHtml(options.platform)}</p>`
    : '';

  return new Promise((resolve) => {
    const previousFocus = document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement
      : null;
    const backdrop = document.createElement('div');
    backdrop.className = `lira-confirm-backdrop is-${variant}`;
    backdrop.dataset.variant = variant;
    backdrop.innerHTML = `
      <section class="lira-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descriptionId}" tabindex="-1">
        <header class="lira-confirm-header">
          ${icon}
          <div class="lira-confirm-heading">
            ${kicker}
            <h2 id="${titleId}">${escapeHtml(title)}</h2>
            ${platform}
          </div>
        </header>
        <div class="lira-confirm-content">
          <p id="${descriptionId}" class="lira-confirm-description">${escapeHtml(description)}</p>
          ${deletes}
          ${keeps}
        </div>
        <footer class="lira-confirm-actions">
          <button type="button" class="lira-confirm-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="lira-confirm-confirm">${escapeHtml(confirmLabel)}</button>
        </footer>
      </section>
    `;
    document.body.appendChild(backdrop);

    const inertSiblings = [...document.body.children]
      .filter((element) => element !== backdrop && element !== document.body)
      .map((element) => ({
        element,
        inert: Boolean(element.inert),
        ariaHidden: element.getAttribute('aria-hidden')
      }));
    inertSiblings.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });

    const dialog = backdrop.querySelector('.lira-confirm-dialog');
    const cancelButton = backdrop.querySelector('.lira-confirm-cancel');
    const confirmButton = backdrop.querySelector('.lira-confirm-confirm');
    let settled = false;
    let closeTimer = null;

    const restoreBackground = () => {
      inertSiblings.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (closeTimer) clearTimeout(closeTimer);
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      restoreBackground();
      previousFocus?.focus?.();
      resolve(result);
    };

    const close = (result) => {
      if (settled || closeTimer) return;
      backdrop.classList.add('is-closing');
      const reducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      closeTimer = setTimeout(() => finish(result), reducedMotion ? 0 : 170);
    };

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...backdrop.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focusOutsideDialog = !dialog.contains(document.activeElement);
      if (focusOutsideDialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (event) => {
      if (closeOnBackdrop && event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKeyDown);

    const focusInitial = () => {
      const initial = options.initialFocus === 'confirm' ? confirmButton : cancelButton;
      (initial || dialog).focus();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusInitial);
    else setTimeout(focusInitial, 0);
  });
}

export function dangerConfirm(options = {}) {
  return showConfirmationDialog({
    ...options,
    variant: 'destructive',
    description: options.description ?? options.message,
    confirmLabel: options.confirmLabel || '继续操作',
    closeOnBackdrop: false,
    initialFocus: 'cancel',
    icon: options.icon || '!'
  });
}

export function logoutConfirm(options = {}) {
  return showConfirmationDialog({
    ...options,
    variant: 'caution',
    description: options.description ?? options.message,
    confirmLabel: options.confirmLabel || '退出登录',
    cancelLabel: options.cancelLabel || '先不退出',
    initialFocus: 'cancel',
    icon: options.icon || '→'
  });
}

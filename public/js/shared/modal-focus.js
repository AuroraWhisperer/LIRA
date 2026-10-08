'use strict';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, summary, [tabindex], [contenteditable="true"]';

function canFocus(element) {
  return (
    element?.isConnected && element !== document.body && !element.matches(':disabled') &&
    !element.closest('[hidden], [inert]') && element.checkVisibility({ checkVisibilityCSS: true })
  );
}

/** Keep a visible modal's background inert until its owner closes it. */
export function activateModalFocus(dialog, {
  initialFocus,
  returnFocus = document.activeElement,
  backdrop,
  fallbackFocus,
  additionalRoots = [],
} = {}) {
  const roots = [dialog, ...additionalRoots.filter(Boolean)];
  const background = new Map();
  for (const root of roots) {
    let branch = root;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const element of parent.children) {
        if (element === branch || element === backdrop || roots.some((scope) => element.contains(scope))) continue;
        if (!background.has(element)) background.set(element, element.inert);
        element.inert = true;
      }
      if (parent === document.body) break;
      branch = parent;
    }
  }

  const onKeyDown = (event) => {
    if (event.key !== 'Tab' || event.defaultPrevented || dialog.closest('[inert]')) return;
    const focusable = roots
      .flatMap((root) => [...root.querySelectorAll(FOCUSABLE_SELECTOR)])
      .filter((element) => element.tabIndex >= 0 && canFocus(element));
    const current = focusable.indexOf(document.activeElement);
    const next = current < 0
      ? (event.shiftKey ? focusable.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    event.preventDefault();
    (focusable[next] || dialog).focus();
  };
  roots.forEach((root) => root.addEventListener('keydown', onKeyDown));
  let released = false;
  (initialFocus || dialog).focus();

  return () => {
    if (released) return;
    released = true;
    roots.forEach((root) => root.removeEventListener('keydown', onKeyDown));
    for (const [element, inert] of background) element.inert = inert;
    const target = canFocus(returnFocus) ? returnFocus : fallbackFocus;
    if (canFocus(target)) target.focus();
  };
}

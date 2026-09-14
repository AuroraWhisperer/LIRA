'use strict';

const errors = new WeakMap();
let errorId = 0;

export function showFieldError(input, message, documentRef = input?.ownerDocument) {
  if (!input) return;
  let feedback = errors.get(input);
  if (!feedback) {
    const node = documentRef.createElement('span');
    node.id = `field-error-${++errorId}`;
    node.className = 'field-error';
    input.after(node);
    const describedBy = input.getAttribute('aria-describedby');
    input.setAttribute('aria-describedby', [describedBy, node.id].filter(Boolean).join(' '));
    feedback = { node };
    errors.set(input, feedback);
    input.addEventListener('input', () => {
      node.remove();
      input.removeAttribute('aria-invalid');
      if (describedBy) input.setAttribute('aria-describedby', describedBy);
      else input.removeAttribute('aria-describedby');
      errors.delete(input);
    }, { once: true });
  }
  feedback.node.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

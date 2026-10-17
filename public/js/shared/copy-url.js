import { copyText, toast } from './utils.js';

const bindings = new WeakMap();

export function bindCopyUrl(button, {
  getUrl = () => button.textContent.trim(),
  onCopied = () => toast('地址已复制'),
  onError = error => toast(error.message || '复制失败，请重试'),
} = {}) {
  bindings.get(button)?.();
  button.type = 'button';
  button.classList.add('copy-url');
  let copying = false;

  const updateTitle = () => {
    const url = button.disabled ? '' : getUrl();
    button.title = url ? `点击复制地址\n${url}` : button.textContent.trim();
  };
  const copy = async () => {
    if (button.disabled || copying) return;
    const url = getUrl();
    if (!url) return;
    copying = true;
    try {
      await copyText(url);
      await onCopied(url);
    } catch (error) {
      onError(error, url);
    } finally {
      copying = false;
    }
  };
  button.addEventListener('click', copy);
  button.addEventListener('pointerenter', updateTitle);
  button.addEventListener('focus', updateTitle);
  updateTitle();

  const dispose = () => {
    button.removeEventListener('click', copy);
    button.removeEventListener('pointerenter', updateTitle);
    button.removeEventListener('focus', updateTitle);
    bindings.delete(button);
  };
  bindings.set(button, dispose);
  return dispose;
}

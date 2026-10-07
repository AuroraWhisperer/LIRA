import { isComponentWebSource } from '../shared/component-css-style.js';

export function createComponentCss() {
  let link = null;
  let pending = null;
  function dispose() {
    pending?.reject(new Error('CSS loading cancelled'));
    pending = null;
    link?.remove(); link = null;
  }
  return {
    update(config) {
      const source = config?.cssStyle?.src;
      if (!source) { dispose(); return; }
      if (!isComponentWebSource(source) || !/\.css$/i.test(source)) throw new Error('Invalid component CSS');
      if (link?.getAttribute('href') === source) return pending?.promise;
      dispose();
      link = document.createElement('link'); link.rel = 'stylesheet'; link.crossOrigin = 'anonymous';
      link.dataset.componentCss = ''; link.href = source;
      const stylesheet = link;
      let reject;
      const promise = new Promise((resolve, fail) => {
        reject = fail;
        link.addEventListener('load', () => {
          try {
            if (!stylesheet.sheet?.cssRules.length) throw new Error('Empty or invalid CSS');
            resolve();
          } catch (error) { fail(error); }
        }, { once: true });
        link.addEventListener('error', () => fail(new Error('CSS resource missing')), { once: true });
      });
      pending = { promise, reject };
      document.head.append(link);
      return promise;
    },
    dispose,
  };
}

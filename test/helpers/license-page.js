'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../../public/js/license.js'), 'utf8');

function createLicensePage(result = { state: 'needs_activation' }) {
  const elements = new Map();
  const submissions = [];
  function getElementById(id) {
    if (!elements.has(id)) {
      const attributes = new Map();
      elements.set(id, {
        value: '',
        type: id === 'licensePassword' ? 'password' : '',
        textContent: '',
        className: '',
        hidden: false,
        disabled: false,
        dataset: {},
        listeners: new Map(),
        addEventListener(event, listener) {
          this.listeners.set(event, listener);
        },
        setAttribute(name, value) {
          attributes.set(name, value);
        },
        getAttribute(name) {
          return attributes.get(name);
        },
      });
    }
    return elements.get(id);
  }
  vm.runInNewContext(SCRIPT, {
    document: { getElementById },
    window: {
      liraLicense: {
        async activate(input) {
          submissions.push(input);
          return result;
        },
      },
      addEventListener() {},
    },
  });
  getElementById('licenseAccountName').value = 'test-account';
  getElementById('licenseActivationCode').value = 'TEST-CODE';
  return {
    getElementById,
    submissions,
    submit: () =>
      getElementById('licenseForm').listeners.get('submit')({
        preventDefault() {},
      }),
    dispatchPasswordEvent(type, event = {}) {
      const listener = getElementById('licensePassword').listeners.get(type);
      const dispatchedEvent = {
        isComposing: false,
        data: null,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...event,
      };
      listener?.(dispatchedEvent);
      return dispatchedEvent;
    },
  };
}

module.exports = { createLicensePage };

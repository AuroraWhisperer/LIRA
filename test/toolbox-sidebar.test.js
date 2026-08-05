'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');

test('toolbox sidebar switches between labeled and icon-only layouts', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8'
  );

  assert.match(html, /data-other-sidebar-toggle/);
  assert.match(html, /data-other-feature="otherDanmakuFeature"[^>]*>[\s\S]*?弹幕姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/);
  assert.match(html, /data-other-feature="otherGiftFeature"[^>]*>[\s\S]*?礼物姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-workspace\s*\{[^}]*grid-template-columns:\s*76px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label/);
  assert.match(styles, /\.other-sidebar-toolbar\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(styles, /\.other-feature-button\s*\{[^}]*height:\s*56px[^}]*min-height:\s*56px[^}]*padding:\s*8px 10px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-button\s*\{[^}]*min-height:\s*56px/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-sidebar-toolbar\s*\{[^}]*display:\s*none/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*display:\s*grid/);
});

test('danmaku detail panel fills the workspace and keeps actions grouped', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8'
  );

  assert.match(html, /class="danmaku-feature-section danmaku-connection-section"[\s\S]*?id="danmakuAccountState"[\s\S]*?id="danmakuRoomState"[\s\S]*?id="danmakuToolStatus"/);
  assert.match(html, /class="danmaku-feature-section danmaku-compose-section"[\s\S]*?id="danmakuSendForm"[\s\S]*?id="danmakuSendResult"/);
  assert.match(styles, /\.danmaku-tool-panel\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/);
  assert.match(styles, /\.danmaku-feature-section\s*\{[^}]*border:\s*1px solid var\(--border\)/);
});

test('toolbox sidebar toggle updates accessibility state and stores the preference', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
    'utf8'
  );
  const classes = new Set();
  const attributes = new Map();
  const stored = new Map();
  const toggle = {
    title: '',
    setAttribute(name, value) { attributes.set(name, value); }
  };
  const root = {
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    },
    querySelector: () => toggle,
    querySelectorAll: () => []
  };
  const sandbox = {
    console,
    document: { getElementById: () => root },
    window: {
      AdminApp: {},
      localStorage: {
        getItem(key) { return stored.get(key) || null; },
        setItem(key, value) { stored.set(key, value); }
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.other.setSidebarCollapsed(root, true);

  assert.equal(classes.has('sidebar-collapsed'), true);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(toggle.title, '展开功能导航');
  assert.equal(stored.get('admin.toolboxSidebarCollapsed'), 'true');
});

test('desktop shell reveals the desktop update toolbox feature', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'desktop.js'), 'utf8');
  const desktopOnlyNodes = [{ hidden: true }, { hidden: true }];
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll(selector) {
        return selector === '.desktop-only' ? desktopOnlyNodes : [];
      }
    },
    window: {
      AdminApp: {
        utils: {
          toast() {},
          showStackedToast() {},
          showError() {},
          api: async () => ({})
        }
      },
      songAssistantDesktop: {
        onShowUpdatePage() {},
        onUpdateState() {},
        getInfo: () => new Promise(() => {})
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktop.initDesktopShell();

  assert.equal(desktopOnlyNodes.every((node) => node.hidden === false), true);
});

test('desktop update feature keeps its tab and panel mapping', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  assert.match(html, /id="otherDesktopUpdateFeatureTab"[\s\S]*data-other-feature="otherDesktopUpdateFeature"/);
  assert.match(html, /id="otherDesktopUpdateFeature"[\s\S]*data-other-feature-panel/);
  assert.match(html, /aria-labelledby="otherDesktopUpdateFeatureTab"/);
});

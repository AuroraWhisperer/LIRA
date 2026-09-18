import {
  PARAMETER_FIELDS, LIBRARIES, SWITCHES, SUGGESTED, parameterValues,
  validMessages, confirmedSettings, welcomePreview,
} from './danmaku-welcome-model.js';
import { createWelcomeLibrary } from './danmaku-welcome-library.js';

export function initDanmakuWelcome({
  documentRef = globalThis.document, windowRef = globalThis.window,
  bridge = windowRef?.liraLicense, toast = () => {},
} = {}) {
  const element = (suffix) => documentRef.getElementById(`danmakuWelcome${suffix}`);
  const toggle = element('Toggle'), list = element('List'), input = element('Input');
  const status = element('Status'), refresh = element('RefreshBtn');
  if (![toggle, list, input, status, refresh].every(Boolean)) return;
  const libraries = Object.fromEntries(Object.keys(LIBRARIES).map((key) => [key,
    { items: [], dirty: false, revision: 0, addition: '', page: 0 }]));
  const parameters = { values: {}, dirty: false, revision: 0 };
  let owner = '', generation = 0, settings = null, loading = false, saving = false, disposed = false;
  let view = 'parameters', notice = '', pinyinNotice = '', errors = {};
  const editor = createWelcomeLibrary({ documentRef, element, libraries, changed: libraryChanged });
  const isV2 = () => settings?.schemaVersion === 2;
  const hasDrafts = () => parameters.dirty || Object.values(libraries).some((domain) => domain.dirty || domain.addition);
  const parameterInputs = () => {
    for (const key of Object.keys(PARAMETER_FIELDS)) element(key).value = parameters.values[key] ?? '';
  };
  function displayNotice(text) {
    notice = text; status.textContent = text;
    element('OverviewStatus').textContent = text;
    element('ServerStatus').hidden = !/未确认|正在/.test(text);
  }
  function showView(next) {
    view = next;
    element('Parameters').hidden = view !== 'parameters';
    element('Libraries').hidden = view !== 'libraries';
    for (const button of documentRef.querySelectorAll('[data-welcome-view]'))
      button.setAttribute('aria-pressed', String(button.dataset.welcomeView === view));
  }
  function showErrors(next, focus = false) {
    errors = next;
    for (const key of Object.keys(PARAMETER_FIELDS)) {
      const field = element(key), message = element(`${key}Error`);
      field.setAttribute('aria-invalid', String(Boolean(errors[key])));
      message.hidden = !errors[key]; message.textContent = errors[key] || '';
    }
    if (focus && Object.keys(errors).length) {
      showView('parameters');
      element('Panel').dispatchEvent(new windowRef.CustomEvent('welcome:show-editor', { bubbles: true }));
      element(Object.keys(errors)[0]).focus();
    }
  }
  function updatePreview() {
    if (!isV2()) {
      element('PreviewSummary').textContent = '新增设置尚不可用';
      element('PreviewFirst').textContent = ''; element('PreviewSecond').textContent = ''; return;
    }
    const draft = element('PreviewSource').value !== 'confirmed';
    const parsed = parameterValues(parameters.values, settings);
    const config = draft ? { ...settings, ...parsed.values,
      ...Object.fromEntries(Object.keys(LIBRARIES).map((key) => [key, libraries[key].items])) } : settings;
    const invalid = draft && Object.keys(parsed.errors).length ? Object.values(parsed.errors)[0]
      : Object.keys(LIBRARIES).some((key) => !validMessages(config[key])) ? '词库需为 1～30 条，每条不超过 80 字' : '';
    if (invalid) {
      element('PreviewSummary').textContent = '草稿有错误';
      element('PreviewFirst').textContent = invalid; element('PreviewSecond').textContent = ''; return;
    }
    const levelSelect = element('PreviewLevel');
    const levels = [...new Set([0, 31, config.welcomeMinHonorLevel - 1, config.welcomeMinHonorLevel,
      config.greetingMinHonorLevel, config.attentionMinHonorLevel - 1, config.attentionMinHonorLevel])]
      .filter((level) => level >= 0).sort((a, b) => a - b);
    const signature = levels.join(',');
    if (levelSelect.dataset.levels !== signature) {
      const current = levelSelect.value || '31';
      levelSelect.replaceChildren();
      for (const value of ['unknown', ...levels.map(String)]) {
        const option = documentRef.createElement('option'); option.value = value;
        option.textContent = value === 'unknown' ? '等级未知' : `${value} 级`; levelSelect.appendChild(option);
      }
      levelSelect.value = current === 'unknown' || levels.includes(Number(current)) ? current : '31';
      levelSelect.dataset.levels = signature;
    }
    const result = welcomePreview(config, levelSelect.value === 'unknown' ? null : Number(levelSelect.value));
    element('PreviewFirst').textContent = result[0]; element('PreviewSecond').textContent = result[1];
    element('PreviewSummary').textContent = `${draft ? '编辑草稿' : '已确认设置'} · ${config.enabled ? config.greetingEnabled ? '最多两次' : '仅首次欢迎' : '欢迎已关闭'} · 不发送`;
  }
  function controls() {
    const loaded = Boolean(settings), busy = loading || saving;
    for (const [key, suffix] of Object.entries(SWITCHES)) {
      const field = element(suffix); field.checked = Boolean(settings?.[key]);
      field.disabled = !loaded || busy || (key !== 'enabled' && !isV2()) ||
        (['greetingEnabled', 'attentionEnabled'].includes(key) && !settings?.enabled);
      field.title = parameters.dirty && !settings?.[key] ? '开启并保存参数' : '';
    }
    input.disabled = !loaded;
    const library = libraries[editor.current()];
    element('AddBtn').disabled = !loaded || library.items.length >= 30;
    element('SaveBtn').disabled = !loaded || !library.dirty || busy;
    element('SaveBtn').textContent = `保存${LIBRARIES[editor.current()]}`;
    element('LibraryKind').disabled = !isV2();
    element('Count').textContent = loaded ? `${library.items.length} 条` : '未读取';
    element('LibraryStatus').textContent = library.addition ? '输入尚未添加，不会随词库保存' : library.dirty ? '当前词库有未保存修改'
      : loaded ? '当前词库已确认' : '词库尚未确认';
    const dirtyNames = Object.entries(libraries).filter(([, domain]) => domain.dirty).map(([key]) => LIBRARIES[key]);
    element('LibraryDrafts').textContent = dirtyNames.length ? `未保存：${dirtyNames.join('、')}` : '';
    refresh.disabled = !owner || busy;
    refresh.textContent = hasDrafts() ? '保留草稿并刷新' : '刷新';
    element('RefreshHint').hidden = !hasDrafts();
    element('Capability').hidden = !loaded || isV2();
    for (const key of Object.keys(PARAMETER_FIELDS)) element(key).disabled = !isV2();
    element('SuggestBtn').disabled = !isV2();
    element('DiscardBtn').disabled = !isV2() || !parameters.dirty;
    element('ParameterSaveBtn').disabled = !isV2() || !parameters.dirty || busy;
    element('ParameterStatus').textContent = !isV2() ? '参数尚未确认'
      : parameters.dirty ? '参数有未保存修改' : '参数已确认';
    element('EnableHint').textContent = parameters.dirty
      ? '开启并保存参数：启用开关时会一起提交当前参数，使用已保存词库。'
      : dirtyNames.length ? '词库尚未保存，启用时使用已保存词库。'
        : !settings?.enabled ? '先开启进场欢迎，再按需开启二次问候或重点关注。' : '';
    element('OverviewStatus').textContent = /未确认|正在/.test(notice) ? notice
      : parameters.dirty ? '参数未保存 · 开启并保存参数'
        : dirtyNames.length ? '词库有未保存修改' : '';
    const parsed = parameterValues(parameters.values, settings || {});
    const p = parsed.values;
    element('DependencyHint').textContent = !isV2() ? ''
      : !settings.greetingEnabled && p.greetingDelaySeconds <= p.welcomeDelaySeconds
        ? '重新开启问候前，需要把问候时间调到首次欢迎之后。'
        : p.greetingMinHonorLevel < p.welcomeMinHonorLevel
          ? `问候仍需首次欢迎发送成功，实际至少 ${p.welcomeMinHonorLevel} 级；专属文案也需满足阶段条件。`
          : settings.attentionEnabled && p.attentionMinHonorLevel < p.welcomeMinHonorLevel
            ? '专属文案仍需满足对应阶段条件。' : '';
    element('Summary').textContent = !loaded ? '尚未确认服务器设置'
      : isV2() ? `${settings.enabled ? '' : '已关闭 · '}${settings.welcomeDelaySeconds} 秒后欢迎 · ${settings.welcomeMinHonorLevel ? `至少 ${settings.welcomeMinHonorLevel} 级` : '等级不限'}`
        : `${settings.enabled ? '已开启' : '已关闭'} · 服务器暂不支持新增设置`;
    element('PinyinStatus').textContent = pinyinNotice || (!loaded ? '尚未确认'
      : !isV2() ? '服务器暂不支持此功能' : settings.rareNamePinyinEnabled ? '已开启' : '已关闭');
    updatePreview();
  }
  function libraryChanged(key) {
    if (key) {
      libraries[key].dirty = true; libraries[key].revision += 1;
      displayNotice('有尚未保存的词库更改');
    }
    controls();
  }
  function parametersChanged() {
    parameters.revision += 1; parameters.dirty = true;
    showErrors(parameterValues(parameters.values, settings || {}).errors);
    controls();
  }
  function accept(result, submitted = {}) {
    const next = confirmedSettings(result); settings = next;
    if (!parameters.dirty || submitted.parameters === parameters.revision) {
      parameters.values = Object.fromEntries(Object.keys(PARAMETER_FIELDS).map((key) => [key, String(next[key] ?? '')]));
      parameters.dirty = false; parameterInputs(); showErrors({});
    }
    let render = false;
    for (const key of Object.keys(LIBRARIES)) {
      const domain = libraries[key];
      if (!domain.dirty || submitted[key] === domain.revision) {
        domain.items = [...(next[key] || [])]; domain.dirty = false;
        if (editor.current() === key) render = true;
      }
    }
    if (!isV2()) { editor.select('messages'); showView('libraries'); }
    else if (render) editor.render();
  }
  async function reload() {
    if (!owner || loading || saving || disposed) return;
    const requested = generation;
    loading = true; displayNotice('正在读取服务器设置…'); controls();
    try {
      const result = bridge.getWelcomeSettingsV2 ? await bridge.getWelcomeSettingsV2() : await bridge.getWelcomeSettings();
      if (requested !== generation || disposed) return;
      accept(bridge.getWelcomeSettingsV2 ? result : { ...result, schemaVersion: 1 });
      pinyinNotice = '';
      displayNotice(hasDrafts() ? '已读取，仍有未保存的更改' : '已读取服务器设置');
    } catch {
      if (requested === generation && !disposed) displayNotice('尚未确认服务器设置，请检查连接后刷新核对。');
    } finally {
      if (requested === generation && !disposed) { loading = false; controls(); }
    }
  }
  async function write(patch, domains = []) {
    if (!settings || loading || saving || disposed) { controls(); return; }
    const requested = generation;
    const submitted = Object.fromEntries(domains.map((key) => [key, key === 'parameters' ? parameters.revision : libraries[key].revision]));
    saving = true; displayNotice('正在保存到服务器…');
    if ('rareNamePinyinEnabled' in patch) pinyinNotice = '正在同步…';
    controls();
    try {
      const response = isV2() ? await bridge.updateWelcomeSettingsV2(patch) : await bridge.updateWelcomeSettings(patch);
      if (requested !== generation || disposed) return;
      if (!response?.ok && response?.fieldErrors?.length) {
        const fieldErrors = {};
        for (const { field, reason } of response.fieldErrors) {
          if (PARAMETER_FIELDS[field]) fieldErrors[field] = reason === 'AFTER_WELCOME_REQUIRED'
            ? '问候时间需要大于首次欢迎时间' : `请检查${PARAMETER_FIELDS[field].label}`;
        }
        showErrors(fieldErrors, true);
      }
      accept(isV2() ? response : { ...response, schemaVersion: 1 }, submitted);
      pinyinNotice = '';
      const libraryKey = domains.find((key) => LIBRARIES[key]);
      displayNotice(hasDrafts() ? '本次已保存，仍有未保存的更改'
        : libraryKey ? `已保存 ${settings[libraryKey].length} 条${LIBRARIES[libraryKey]}`
          : domains.includes('parameters') ? '参数已保存'
            : patch.enabled === false ? '欢迎已关闭' : '开关已由服务器确认');
      toast(status.textContent);
    } catch (error) {
      if (requested !== generation || disposed) return;
      const closing = Object.keys(SWITCHES).some((key) => patch[key] === false);
      displayNotice(closing ? '关闭尚未确认，服务器可能仍在运行；请刷新核对。'
        : '保存未确认，请检查连接与输入后重试。');
      if ('rareNamePinyinEnabled' in patch) pinyinNotice = status.textContent;
      toast(status.textContent);
    } finally {
      if (requested === generation && !disposed) { saving = false; controls(); }
    }
  }
  function setSwitch(key) {
    const target = element(SWITCHES[key]).checked;
    if (target && parameters.dirty && isV2()) {
      const parsed = parameterValues(parameters.values, { ...settings, [key]: true });
      showErrors(parsed.errors, true);
      if (Object.keys(parsed.errors).length) { controls(); return; }
      void write({ ...parsed.values, [key]: true }, ['parameters']);
    } else {
      if (target && isV2()) {
        const parsed = parameterValues(settings, { ...settings, [key]: true });
        showErrors(parsed.errors, true);
        if (Object.keys(parsed.errors).length) { controls(); return; }
      }
      void write({ [key]: target });
    }
  }
  function addMessage() {
    const domain = libraries[editor.current()];
    if (!settings || domain.items.length >= 30) return;
    const text = input.value.trim();
    if (!validMessages([text])) { toast('请输入不超过 80 字的文案'); input.focus(); return; }
    domain.items.push(text); domain.addition = ''; domain.page = Math.floor((domain.items.length - 1) / 6);
    libraryChanged(editor.current()); editor.render(); input.focus();
  }
  function account(snapshot) {
    if (disposed) return;
    const nextOwner = snapshot?.state === 'authorized'
      ? JSON.stringify([snapshot.streamer?.accountName, snapshot.streamer?.songPageUrl]) : '';
    if (nextOwner === owner) {
      if (!owner) displayNotice('连接已授权账号后可设置进场欢迎');
      return;
    }
    owner = nextOwner; generation += 1; settings = null; loading = false; saving = false; pinyinNotice = '';
    parameters.values = {}; parameters.dirty = false; parameters.revision += 1;
    for (const domain of Object.values(libraries)) Object.assign(domain,
      { items: [], dirty: false, revision: domain.revision + 1, addition: '', page: 0 });
    parameterInputs(); showErrors({}); editor.select('messages');
    displayNotice('连接已授权账号后可设置进场欢迎'); controls(); void reload();
  }
  for (const key of Object.keys(SWITCHES)) element(SWITCHES[key]).addEventListener('change', () => setSwitch(key));
  for (const key of Object.keys(PARAMETER_FIELDS)) element(key).addEventListener('input', () => {
    parameters.values[key] = element(key).value; parametersChanged();
  });
  element('SuggestBtn').addEventListener('click', () => {
    parameters.values = Object.fromEntries(Object.entries(SUGGESTED).map(([key, value]) => [key, String(value)]));
    parameterInputs(); parametersChanged();
  });
  element('DiscardBtn').addEventListener('click', () => {
    parameters.values = Object.fromEntries(Object.keys(PARAMETER_FIELDS).map((key) => [key, String(settings[key])]));
    parameters.dirty = false; parameters.revision += 1; parameterInputs(); showErrors({}); controls();
  });
  element('ParameterSaveBtn').addEventListener('click', () => {
    const parsed = parameterValues(parameters.values, settings);
    showErrors(parsed.errors, true);
    if (!Object.keys(parsed.errors).length) void write(parsed.values, ['parameters']);
  });
  element('AddBtn').addEventListener('click', addMessage);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addMessage(); }
  });
  element('SaveBtn').addEventListener('click', () => {
    const key = editor.current(), messages = libraries[key].items.map((text) => text.trim());
    if (!validMessages(messages)) { toast('请保留 1～30 条文案，每条不超过 80 字'); return; }
    void write({ [key]: messages }, [key]);
  });
  for (const button of documentRef.querySelectorAll('[data-welcome-view]'))
    button.addEventListener('click', () => showView(button.dataset.welcomeView));
  for (const button of documentRef.querySelectorAll('[data-welcome-library]'))
    button.addEventListener('click', () => {
      if (!isV2() && button.dataset.welcomeLibrary !== 'messages') return;
      editor.select(button.dataset.welcomeLibrary); showView('libraries');
    });
  element('PreviewSource').addEventListener('change', updatePreview);
  element('PreviewLevel').addEventListener('change', updatePreview);
  refresh.addEventListener('click', reload);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initialGeneration = generation;
  Promise.resolve(bridge?.getProfile?.()).then((snapshot) => {
    if (generation === initialGeneration) account(snapshot);
  }).catch(() => {
    if (generation === initialGeneration && !disposed) displayNotice('账号信息尚未确认，请刷新核对。');
  });
  windowRef.addEventListener('pagehide', () => {
    disposed = true; generation += 1; unsubscribe?.();
  }, { once: true });
  parameterInputs(); editor.render(); controls(); showView('parameters');
  displayNotice(bridge?.getWelcomeSettings ? '正在读取账号信息…' : '请在已连接服务器的桌面客户端中设置');
}

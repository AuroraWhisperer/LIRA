import { validMessages } from './danmaku-welcome-model.js';

const SWITCHES = { enabled: 'Toggle', reportEnabled: 'ReportToggle', visitorWelcomeEnabled: 'VisitorToggle' };
const EXTENSION_FIELDS = ['reportEnabled', 'visitorWelcomeEnabled', 'visitorWelcomeDelaySeconds', 'visitorWelcomeMessages'];

function confirmed(result) {
  if (result?.ok !== true || typeof result.enabled !== 'boolean') throw new Error();
  const extended = EXTENSION_FIELDS.some((key) => Object.hasOwn(result, key));
  if (extended && (EXTENSION_FIELDS.some((key) => !Object.hasOwn(result, key)) ||
    typeof result.reportEnabled !== 'boolean' || typeof result.visitorWelcomeEnabled !== 'boolean' ||
    !Number.isInteger(result.visitorWelcomeDelaySeconds) || result.visitorWelcomeDelaySeconds < 0 ||
    result.visitorWelcomeDelaySeconds > 300 || !validMessages(result.visitorWelcomeMessages))) throw new Error();
  return result;
}

export function initDanmakuPkReport({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  bridge = windowRef?.liraLicense,
  toast = () => {},
} = {}) {
  const element = (suffix) => documentRef.getElementById('danmakuPkReport' + suffix);
  const toggle = element('Toggle'), status = element('Status'), list = element('List'), input = element('Input');
  if (!toggle || !status || !list || !input) return;
  const available = Boolean(bridge?.getPkReportSettings && bridge?.updatePkReportSettings);
  const draft = { delay: '', messages: [], addition: '', dirty: false, revision: 0, page: 0 };
  let owner = '', generation = 0, settings = null, pending = false, saving = false, disposed = false, notice = '';
  const supported = () => Boolean(settings && Object.hasOwn(settings, 'reportEnabled'));
  function controls() {
    element('Panel').setAttribute('aria-busy', String(pending));
    for (const [key, suffix] of Object.entries(SWITCHES)) {
      const field = element(suffix);
      field.checked = Boolean(settings?.[key]);
      field.disabled = !settings || pending || !available || (key !== 'enabled' && (!supported() || !settings.enabled));
    }
    element('Capability').hidden = !settings || supported();
    element('Delay').disabled = !supported();
    input.disabled = !supported();
    for (const row of list.children) {
      row.children[1].disabled = !supported();
      row.children[2].disabled = !supported();
    }
    element('AddBtn').disabled = !supported() || draft.messages.length >= 30;
    element('DiscardBtn').disabled = !supported() || !draft.dirty || pending;
    element('SaveBtn').disabled = !supported() || !draft.dirty || pending;
    element('Count').textContent = supported() ? draft.messages.length + ' 条' : '未读取';
    element('SaveStatus').textContent = saving ? '正在同步服务器设置…' : draft.dirty ? '欢迎设置有未保存修改' :
      draft.addition ? '输入尚未添加，不会随设置保存' : supported() ? '欢迎设置已确认' : '欢迎设置尚未确认';
    status.textContent = notice || (!settings ? available ? '连接 LIRA 账号后可设置 PK 播报与欢迎' : '请升级桌面客户端后设置 PK 播报与欢迎' :
      !settings.enabled ? '总开关已关闭 · 设置已保留' : !supported() ? 'PK 开始时播报对手概况' :
      [settings.reportEnabled ? '开场播报' : '', settings.visitorWelcomeEnabled ? settings.visitorWelcomeDelaySeconds + ' 秒后欢迎串门观众' : ''].filter(Boolean).join(' · ') || '请在设置中开启播报或欢迎');
  }
  function changed() {
    draft.dirty = true;
    draft.revision++;
    controls();
  }
  function renderLibrary() {
    const pages = Math.max(1, Math.ceil(draft.messages.length / 6));
    draft.page = Math.min(draft.page, pages - 1);
    list.replaceChildren();
    draft.messages.forEach((text, index) => {
      if (Math.floor(index / 6) !== draft.page) return;
      const row = documentRef.createElement('div'), number = documentRef.createElement('span');
      row.className = 'danmaku-blessing-row';
      number.className = 'danmaku-blessing-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const field = documentRef.createElement('input');
      field.type = 'text';
      field.maxLength = 80;
      field.value = text;
      field.disabled = !supported();
      field.setAttribute('aria-label', '串门欢迎词第 ' + (index + 1) + ' 条');
      field.addEventListener('input', () => { draft.messages[index] = field.value; changed(); });
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'danmaku-blessing-delete';
      remove.textContent = '×';
      remove.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 条串门欢迎词');
      remove.addEventListener('click', () => { draft.messages.splice(index, 1); changed(); renderLibrary(); });
      row.append(number, field, remove);
      list.appendChild(row);
    });
    element('Pagination').hidden = pages <= 1;
    element('PageLabel').textContent = '第 ' + (draft.page + 1) + ' / ' + pages + ' 页';
    element('PrevPage').disabled = draft.page === 0;
    element('NextPage').disabled = draft.page >= pages - 1;
    input.value = draft.addition;
  }
  function accept(result, submitted) {
    settings = confirmed(result);
    if (!draft.dirty || submitted === draft.revision) {
      draft.delay = String(settings.visitorWelcomeDelaySeconds ?? '');
      draft.messages = [...(settings.visitorWelcomeMessages || [])];
      draft.dirty = false;
      element('Delay').value = draft.delay;
      element('DelayError').hidden = true;
      element('Delay').setAttribute('aria-invalid', 'false');
      renderLibrary();
    }
  }
  async function sync(patch, submitted) {
    const writing = Boolean(patch);
    if (!owner || !available || disposed || pending || (writing && !settings)) { controls(); return; }
    const requested = generation;
    pending = true;
    saving = writing;
    if (writing) notice = '';
    else if (!settings) notice = '正在读取 PK 播报与欢迎设置…';
    controls();
    try {
      const result = confirmed(writing ? await bridge.updatePkReportSettings(patch) : await bridge.getPkReportSettings());
      if (disposed || generation !== requested) return;
      if (writing && Object.keys(patch).some((key) => key !== 'enabled') && !Object.hasOwn(result, 'reportEnabled'))
        throw new Error();
      accept(result, submitted);
      notice = '';
      if (writing) {
        const key = Object.keys(SWITCHES).find((field) => field in patch);
        if (!key) toast('串门欢迎设置已保存');
      }
    } catch {
      if (disposed || generation !== requested) return;
      const closing = writing && Object.keys(SWITCHES).some((key) => patch[key] === false);
      const message = closing ? '关闭尚未同步，服务器可能仍在播报；请刷新核对。' : writing ?
        'PK 设置保存未确认，请检查连接与输入后重试；草稿已保留。' :
        'PK 播报与欢迎暂不可用，请检查网络连接后重试；仍有问题时联系管理员。';
      if (writing) toast(message, { type: 'error' });
      else notice = message;
    } finally {
      if (!disposed && generation === requested) { pending = false; saving = false; controls(); }
    }
  }
  const reload = () => sync();
  function account(snapshot) {
    if (disposed) return;
    const name = snapshot?.streamer?.accountName, url = snapshot?.streamer?.songPageUrl;
    const next = snapshot?.state === 'authorized' && name ? JSON.stringify([name, url]) : '';
    if (next === owner) { controls(); return; }
    owner = next;
    generation++;
    settings = null;
    pending = false;
    saving = false;
    notice = '';
    Object.assign(draft, { delay: '', messages: [], addition: '', dirty: false, revision: draft.revision + 1, page: 0 });
    element('Delay').value = '';
    element('DelayError').hidden = true;
    element('Delay').setAttribute('aria-invalid', 'false');
    renderLibrary();
    controls();
    void reload();
  }
  for (const [key, suffix] of Object.entries(SWITCHES)) element(suffix).addEventListener('change', () => {
    if (key !== 'enabled' && (!supported() || !settings.enabled)) { controls(); return; }
    void sync({ [key]: element(suffix).checked });
  });
  element('Delay').addEventListener('input', () => { draft.delay = element('Delay').value; changed(); });
  input.addEventListener('input', () => { draft.addition = input.value; controls(); });
  function addMessage() {
    if (!supported() || draft.messages.length >= 30) return;
    const text = input.value.trim();
    if (!validMessages([text])) { toast('请输入 1～80 字的串门欢迎词，不能换行', { type: 'error' }); input.focus(); return; }
    draft.messages.push(text);
    draft.addition = '';
    draft.page = Math.floor((draft.messages.length - 1) / 6);
    changed();
    renderLibrary();
    input.focus();
  }
  element('AddBtn').addEventListener('click', addMessage);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addMessage(); } });
  element('PrevPage').addEventListener('click', () => { draft.page--; renderLibrary(); });
  element('NextPage').addEventListener('click', () => { draft.page++; renderLibrary(); });
  element('DiscardBtn').addEventListener('click', () => {
    if (!supported() || pending) return;
    draft.dirty = false;
    draft.revision++;
    draft.addition = '';
    accept(settings);
    controls();
  });
  element('SaveBtn').addEventListener('click', () => {
    if (!supported()) return;
    const raw = draft.delay.trim(), delay = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const error = !Number.isInteger(delay) || delay < 0 || delay > 300 ? '欢迎延时需为 0～300 的整数' : '';
    element('DelayError').textContent = error;
    element('DelayError').hidden = !error;
    element('Delay').setAttribute('aria-invalid', String(Boolean(error)));
    if (error) { element('Delay').focus(); return; }
    const messages = draft.messages.map((text) => text.trim());
    if (!validMessages(messages)) { toast('请保留 1～30 条文案，每条 1～80 字且不能换行', { type: 'error' }); return; }
    void sync({ visitorWelcomeDelaySeconds: delay, visitorWelcomeMessages: messages }, draft.revision);
  });
  windowRef.addEventListener('online', reload);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(bridge?.getState?.()).then((snapshot) => { if (generation === initial) account(snapshot); }).catch(() => {
    if (!disposed && generation === initial) { notice = '账号信息读取失败，请重新连接账号。'; controls(); }
  });
  windowRef.addEventListener('pagehide', () => {
    disposed = true;
    generation++;
    unsubscribe?.();
    windowRef.removeEventListener('online', reload);
  }, { once: true });
  controls();
  return { refresh: reload };
}

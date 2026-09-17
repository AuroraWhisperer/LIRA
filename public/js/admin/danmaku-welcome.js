export function initDanmakuWelcome({
  documentRef = globalThis.document, windowRef = globalThis.window,
  bridge = windowRef?.liraLicense, toast = () => {},
} = {}) {
  const element = (suffix) => documentRef.getElementById(`danmakuWelcome${suffix}`);
  const toggle = element('Toggle'), list = element('List'), count = element('Count');
  const input = element('Input'), add = element('AddBtn'), save = element('SaveBtn');
  const status = element('Status'), refresh = element('RefreshBtn');
  if (![toggle, list, count, input, add, save, status, refresh].every(Boolean)) return;
  let owner = '', generation = 0, revision = 0, items = [], enabled = false;
  let dirty = false, loaded = false, loading = false, saving = false, disposed = false;

  function controls() {
    toggle.checked = enabled;
    toggle.disabled = !loaded || loading || saving;
    input.disabled = !loaded;
    add.disabled = !loaded || items.length >= 30;
    save.disabled = !loaded || !dirty || saving || loading;
    refresh.disabled = !owner || loading || saving || dirty;
    count.textContent = loaded ? `${items.length} 条` : '未读取';
  }
  function changed() {
    dirty = true; revision += 1;
    status.textContent = '有尚未保存的更改';
    controls();
  }
  function renderList() {
    list.replaceChildren();
    items.forEach((text, index) => {
      const row = documentRef.createElement('div');
      row.className = 'danmaku-blessing-row';
      const number = documentRef.createElement('span');
      number.className = 'danmaku-blessing-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const field = documentRef.createElement('input');
      field.type = 'text'; field.maxLength = 80; field.value = text;
      field.setAttribute('aria-label', `第 ${index + 1} 条欢迎语`);
      field.addEventListener('input', () => { items[index] = field.value; changed(); });
      const remove = documentRef.createElement('button');
      remove.type = 'button'; remove.className = 'danmaku-blessing-delete';
      remove.title = `删除第 ${index + 1} 条欢迎语`;
      remove.setAttribute('aria-label', remove.title);
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      remove.addEventListener('click', () => { items.splice(index, 1); renderList(); changed(); });
      row.append(number, field, remove); list.appendChild(row);
    });
    controls();
  }
  function settingsFrom(result) {
    if (!result?.ok || typeof result.enabled !== 'boolean' || !Array.isArray(result.messages)) {
      throw new Error(result?.error === 'INVALID_WELCOME_MESSAGES'
        ? '请保留 1～30 条欢迎语，每条不超过 80 字。'
        : '欢迎设置未确认，请检查服务器连接和版本后重试。');
    }
    return result;
  }
  async function reload() {
    if (!owner || loading || saving || dirty || disposed) return;
    const requested = generation, requestedRevision = revision;
    loading = true; controls(); status.textContent = '正在读取欢迎词库…';
    try {
      const result = await bridge.getWelcomeSettings();
      if (requested !== generation || disposed) return;
      const settings = settingsFrom(result);
      enabled = settings.enabled; loaded = true;
      if (requestedRevision === revision) { items = [...settings.messages]; renderList(); }
      status.textContent = dirty ? '已读取开关状态，词库仍有未保存的更改'
        : `已读取 ${items.length} 条，${enabled ? '欢迎已开启' : '欢迎已关闭'}`;
    } catch (error) {
      if (requested === generation && !disposed) status.textContent = error.message;
    } finally {
      if (requested === generation && !disposed) { loading = false; controls(); }
    }
  }
  async function write(patch) {
    if (!loaded || loading || saving || disposed) { controls(); return; }
    const requested = generation, submittedRevision = revision;
    saving = true; controls(); status.textContent = '正在保存到服务器…';
    try {
      const response = await bridge.updateWelcomeSettings(patch);
      if (requested !== generation || disposed) return;
      const settings = settingsFrom(response);
      enabled = settings.enabled;
      if (patch.messages && submittedRevision === revision) {
        items = [...settings.messages]; dirty = false; renderList();
      }
      status.textContent = dirty ? '本次已保存，仍有未保存的词库更改'
        : patch.messages ? `已保存 ${items.length} 条欢迎语`
          : enabled ? '欢迎已开启，服务器会自动欢迎进场观众' : '欢迎已关闭';
      toast(patch.messages ? '欢迎词库已保存' : enabled ? '进场欢迎已开启' : '进场欢迎已关闭');
    } catch (error) {
      if (requested !== generation || disposed) return;
      status.textContent = patch.enabled === false
        ? '关闭尚未确认，服务器可能仍在欢迎；请刷新核对。' : error.message;
      toast(status.textContent);
    } finally {
      if (requested === generation && !disposed) { saving = false; controls(); }
    }
  }
  function addMessage() {
    if (!loaded || items.length >= 30) return;
    const text = input.value.trim();
    if (!text) { toast('请输入欢迎语'); input.focus(); return; }
    items.push(text); input.value = ''; renderList(); changed(); input.focus();
  }
  function account(snapshot) {
    if (disposed) return;
    const nextOwner = snapshot?.state === 'authorized'
      ? JSON.stringify([snapshot.streamer?.accountName, snapshot.streamer?.songPageUrl]) : '';
    if (nextOwner === owner) {
      if (!owner && bridge?.getWelcomeSettings) status.textContent = '连接已授权账号后可设置进场欢迎';
      return;
    }
    owner = nextOwner; generation += 1; revision += 1;
    items = []; enabled = false; dirty = false; loaded = false; loading = false; saving = false;
    input.value = ''; renderList(); status.textContent = '连接已授权账号后可设置进场欢迎';
    void reload();
  }
  toggle.addEventListener('change', () => { void write({ enabled: toggle.checked }); });
  add.addEventListener('click', addMessage);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addMessage(); }
  });
  save.addEventListener('click', () => {
    const messages = items.map((text) => text.trim()).filter(Boolean);
    if (!messages.length) { toast('请至少保留一条欢迎语'); return; }
    void write({ messages });
  });
  refresh.addEventListener('click', reload);
  windowRef.addEventListener('online', reload);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initialGeneration = generation;
  Promise.resolve(bridge?.getProfile?.()).then((snapshot) => {
    if (generation === initialGeneration) account(snapshot);
  }).catch(() => {});
  windowRef.addEventListener('pagehide', () => {
    disposed = true; generation += 1; unsubscribe?.();
    windowRef.removeEventListener('online', reload);
  }, { once: true });
  controls();
  status.textContent = bridge?.getWelcomeSettings
    ? '正在读取账号信息…' : '请在已连接服务器的桌面客户端中设置';
}

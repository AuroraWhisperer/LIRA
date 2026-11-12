import { createGiftThanksTextEditor } from './gift-thanks-text-editor.js';
import { GIFT_THANKS_SCENES, GIFT_THANKS_TOKENS, GIFT_THANKS_MESSAGE_LIMIT,
  createGiftThanksReplies, normalizeGiftThanksReplies, renderGiftThanksTemplate } from '../shared/gift-thanks-templates.js';

const EXAMPLES = {
  gift: ['谢谢{称呼}送来的{礼物}，这份心意收到啦！', '收到你的{礼物}啦，谢谢支持！', '感谢{称呼}的{礼物}；{金额}'],
  captain: ['欢迎{称呼}上船！感谢你的{礼物}，一起出发吧！', '谢谢你成为舰长，接下来的航程一起走！', '感谢{称呼}开通{礼物}；{金额}'],
  admiral: ['谢谢{称呼}的{礼物}，这份守护记在心里！', '欢迎提督！谢谢你为直播间加满动力！', '感谢{称呼}开通{礼物}；{金额}'],
  governor: ['感谢{称呼}的{礼物}！有你的陪伴，这段旅程更精彩。', '欢迎总督！谢谢你这么坚定地支持我！', '感谢{称呼}开通{礼物}；{金额}'],
};
const SAMPLES = {
  paid: { gifts: ['小心心×2'], amount: '共20电池', amountBlocks: ['共20电池'] },
  free: { gifts: ['辣条×5'], amount: '', amountBlocks: [] },
  blind: { gifts: ['爱心×2'], amount: '开出30电池（+10电池）', amountBlocks: ['开出30电池', '差额+10电池'] },
};

export function createGiftThanksLibrary(root, changed) {
  const doc = root.ownerDocument;
  let draft = createGiftThanksReplies(), kind = 'gift', disabled = true;
  let rows = [];
  const lifetime = new AbortController();
  root.innerHTML = `<div class="danmaku-thanks-library-controls">
    <label>答谢场景<select data-thanks-scene></select></label>
    <label>发送方式<select data-thanks-mode><option value="plain">普通 · 优先昵称</option><option value="mention">@ 对方</option></select></label>
    <label class="danmaku-thanks-enabled"><input type="checkbox" data-thanks-enabled>启用这个场景</label>
    <label data-thanks-sample-label>预览礼物<select data-thanks-sample><option value="paid">普通礼物</option><option value="blind">盲盒礼物</option><option value="free">免费礼物</option></select></label>
  </div>
  <div class="danmaku-thanks-library-description"><p class="hint" data-thanks-description></p>
    <lira-help label="场景文案说明">每个场景独立选择普通或 @，该场景下所有文案共用，每次随机选一条。普通回复优先使用已保存的昵称；@ 直接提及观众，正文可写“谢谢你”。</lira-help>
  </div>
  <div id="danmakuGiftThanksList" data-thanks-rows></div>
  <div class="danmaku-thanks-library-actions">
    <button type="button" class="secondary" data-thanks-add>添加文案</button>
    <label>示例文案<select data-thanks-example></select></label>
    <button type="button" class="secondary" data-thanks-use-example>加入示例</button>
    <span class="hint" data-thanks-count></span>
  </div>
  <p class="hint" role="status" data-thanks-validation></p>`;
  const find = selector => root.querySelector(selector);
  const scene = find('[data-thanks-scene]');
  const mode = find('[data-thanks-mode]');
  const enabled = find('[data-thanks-enabled]');
  const sample = find('[data-thanks-sample]');
  const examples = find('[data-thanks-example]');
  const list = find('[data-thanks-rows]');
  const listen = (element, type, handler) => element.addEventListener(type, handler, { signal: lifetime.signal });
  const option = (value, text) => { const node = doc.createElement('option'); node.value = value; node.textContent = text; return node; };
  for (const [key, label] of Object.entries(GIFT_THANKS_SCENES)) scene.append(option(key, label));

  function previewRow(row, message) {
    const example = kind === 'gift' ? SAMPLES[sample.value] : {
      gifts: [`${GIFT_THANKS_SCENES[kind].replace('答谢', '')}×1`], amount: '共1980电池', amountBlocks: ['共1980电池'],
    };
    const mention = draft[kind].mode === 'mention';
    const name = mention ? '小明的B站昵称' : '小明';
    const prefix = mention ? `@${name} ` : '';
    const segments = renderGiftThanksTemplate(message.text, { ...example, name }, 40 - prefix.length,
      { requireName: message.text.includes('{称呼}') });
    row.preview.textContent = segments ? segments.map(text => prefix + text).join('\n') : '这条文案无法完整发送，请缩短文字或调整参数。';
    row.node.setAttribute('aria-invalid', String(!segments));
  }
  function controls() {
    for (const element of [scene, mode, enabled, sample, examples]) element.disabled = disabled;
    const full = draft[kind].messages.length >= GIFT_THANKS_MESSAGE_LIMIT;
    find('[data-thanks-add]').disabled = disabled || full;
    find('[data-thanks-use-example]').disabled = disabled || full;
    rows.forEach((row, index) => {
      row.editor.setDisabled(disabled);
      row.remove.disabled = disabled || rows.length === 1;
      for (const button of row.tokens) button.disabled = disabled || draft[kind].messages[index].text.includes(button.dataset.thanksToken);
    });
    find('[data-thanks-count]').textContent = `${draft[kind].messages.length} / ${GIFT_THANKS_MESSAGE_LIMIT} 条`;
  }
  function notify() { controls(); changed(); }
  function render() {
    rows.forEach(row => row.editor.dispose());
    rows = [];
    list.replaceChildren();
    scene.value = kind;
    mode.value = draft[kind].mode;
    mode.setAttribute('aria-label', `${GIFT_THANKS_SCENES[kind]}发送方式`);
    enabled.checked = draft[kind].enabled;
    find('[data-thanks-sample-label]').hidden = kind !== 'gift';
    find('[data-thanks-description]').textContent = kind === 'gift'
      ? '收到普通、免费和盲盒礼物时使用。开通大航海使用对应等级的文案，不会再抽取这一组。'
      : `开通${GIFT_THANKS_SCENES[kind].replace('答谢', '')}时使用。观众以该身份送普通礼物时，仍使用礼物答谢。`;
    examples.replaceChildren(...EXAMPLES[kind].map((text, index) => option(String(index), text)));
    draft[kind].messages.forEach((message, index) => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'danmaku-thanks-reply';
      wrapper.innerHTML = `<div class="danmaku-thanks-reply-heading"><strong></strong>
        <div class="danmaku-thanks-insert" role="group"></div>
        <button type="button" class="secondary">删除</button></div>
        <div class="danmaku-thanks-text" role="textbox" contenteditable="false" aria-multiline="false" spellcheck="false"></div>
        <div class="danmaku-thanks-preview"><span class="hint">示例预览 · 不会发送</span><output></output></div>`;
      const label = `${GIFT_THANKS_SCENES[kind]}第 ${index + 1} 条`;
      wrapper.querySelector('strong').textContent = `文案 ${index + 1}`;
      const node = wrapper.querySelector('[role="textbox"]');
      node.setAttribute('aria-label', label);
      const remove = wrapper.querySelector('button');
      remove.setAttribute('aria-label', `删除${label}`);
      const preview = wrapper.querySelector('output');
      const editor = createGiftThanksTextEditor(node, () => {
        message.text = editor.read();
        previewRow(row, message);
        notify();
      });
      const row = { editor, node, remove, preview, tokens: [] };
      editor.setValue(message.text);
      const tokens = wrapper.querySelector('[role="group"]');
      tokens.setAttribute('aria-label', `${label}插入参数`);
      for (const [token, title] of Object.entries(GIFT_THANKS_TOKENS)) {
        const button = doc.createElement('button');
        button.type = 'button'; button.textContent = title; button.dataset.thanksToken = token;
        button.addEventListener('click', () => editor.insert(token));
        tokens.append(button); row.tokens.push(button);
      }
      remove.addEventListener('click', () => { draft[kind].messages.splice(index, 1); render(); notify(); });
      rows.push(row);
      list.append(wrapper);
      previewRow(row, message);
    });
    controls();
  }
  function add(message) {
    if (disabled || draft[kind].messages.length >= GIFT_THANKS_MESSAGE_LIMIT) return;
    draft[kind].messages.push(message);
    render(); notify(); rows.at(-1).node.focus();
  }
  listen(scene, 'change', () => { kind = scene.value; render(); });
  listen(mode, 'change', () => {
    draft[kind].mode = mode.value;
    rows.forEach((row, index) => previewRow(row, draft[kind].messages[index]));
    notify();
  });
  listen(enabled, 'change', () => { draft[kind].enabled = enabled.checked; notify(); });
  listen(sample, 'change', () => rows.forEach((row, index) => previewRow(row, draft[kind].messages[index])));
  listen(find('[data-thanks-add]'), 'click', () => add({ text: '' }));
  listen(find('[data-thanks-use-example]'), 'click', () => add({ text: EXAMPLES[kind][Number(examples.value)] }));
  render();
  return {
    read: () => structuredClone(draft),
    setValue(value) { draft = structuredClone(value); render(); },
    setDisabled(value) { disabled = value; controls(); },
    validate() {
      const error = find('[data-thanks-validation]');
      try { normalizeGiftThanksReplies(draft); error.textContent = ''; return true; }
      catch {
        error.textContent = '每条文案须为 1–120 字；参数可以省略，每种最多一次。请检查各场景是否有空文案或错误的参数。';
        return false;
      }
    },
    dispose() { lifetime.abort(); rows.forEach(row => row.editor.dispose()); },
  };
}

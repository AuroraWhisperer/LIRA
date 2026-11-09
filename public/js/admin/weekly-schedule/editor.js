import { createWeeklyScheduleTemplate, cloneWeeklyScheduleTemplate, clearWeeklyScheduleWeek, normalizeWeeklyScheduleTemplate, getWeekDates, WEEKLY_PALETTES, WEEKLY_FONTS, ASSET_KEYS, MAX_TEMPLATE_ASSET_BYTES, getWeeklyScheduleAssetBytes } from './model.js';
import { createWeeklyScheduleStorage } from './storage.js';
import { readWeeklyScheduleAsset } from './assets.js';
import { renderWeeklySchedule, fitWeeklyScheduleText, waitForWeeklyScheduleImages } from './renderer.js';
import { renderWeeklyScheduleFields, refreshWeeklyScheduleAsset } from './editor-fields.js';
import { registerFontSelect, ensureSavedFontOption } from '../../shared/font-library.js';
import { findSharedFont } from '../../shared/font-catalog.js';
import { initParameterRanges, disposeParameterRanges, refreshParameterRange } from '../../shared/parameter-range.js';
import { enhanceSelects } from '../../shared/select-menu.js';
import { enhanceColorControls } from '../../shared/color-control.js';
import { showConfirmationDialog } from '../../shared/confirmation-dialog.js';
import { toast } from '../../shared/toast.js';

export async function createWeeklyScheduleEditor(root, { storage = createWeeklyScheduleStorage(), bridge = window.weeklySchedule } = {}) {
  const fields = root.querySelector('[data-weekly-fields]');
  const preview = root.querySelector('[data-weekly-preview]');
  const viewport = root.querySelector('[data-weekly-preview-viewport]');
  const templateSelect = root.querySelector('[data-weekly-template]');
  const nameInput = root.querySelector('[data-weekly-template-name]');
  const saveState = root.querySelector('[data-weekly-save-state]');
  const errorLine = root.querySelector('[data-weekly-error]');
  const retry = root.querySelector('[data-weekly-action="retry"]');
  const exportButton = root.querySelector('[data-weekly-action="export"]');
  const overflowLine = root.querySelector('[data-weekly-overflow]');
  let state;
  let disposed = false;
  let revision = 0;
  let savedRevision = -1;
  let saveTimer;
  let savePending = Promise.resolve();
  let frame;
  let unregisterFont = () => {};
  let exporting = false;
  let loading = false;
  let lastSaveError = null;
  let previewGeneration = 0;
  let activeCategory = 'appearance';
  const uploadGenerations = new Map();
  const pendingUploads = new Map();
  const current = () => state.templates.find(template => template.id === state.activeId);

  function status(text, error = false) {
    if (disposed) return;
    saveState.textContent = text;
    saveState.classList.toggle('is-error', error);
    retry.hidden = !error;
  }
  function showError(error) {
    if (disposed) return;
    errorLine.hidden = !error;
    errorLine.textContent = error?.message || String(error || '');
  }
  function resizePreview() {
    const scale = viewport.clientWidth / 1920;
    preview.style.transform = `scale(${scale})`;
    viewport.style.height = `${1080 * scale}px`;
  }
  function updatePreview() {
    if (disposed || !state) return;
    const generation = ++previewGeneration;
    const template = current();
    const art = renderWeeklySchedule(preview, template);
    resizePreview();
    fitPreview();
    void Promise.all([
      root.ownerDocument.fonts.load(`32px ${template.fontId}`, art.textContent || '直播周表'),
      waitForWeeklyScheduleImages(art),
    ]).then(() => {
      if (!disposed && generation === previewGeneration) fitPreview();
    }).catch(error => {
      if (!disposed && generation === previewGeneration) showError(error);
    });
  }
  function fitPreview() {
    const art = preview.firstElementChild;
    if (!art || disposed) return [];
    const overflow = fitWeeklyScheduleText(art);
    overflowLine.hidden = overflow.length === 0;
    overflowLine.textContent = overflow.length ? `以下内容放不下：${overflow.join('、')}。请精简文字或换一种排版。` : '';
    return overflow;
  }
  function queuePreview() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; updatePreview(); });
  }
  function persist() {
    clearTimeout(saveTimer);
    if (!state || disposed) return Promise.resolve(false);
    const requestedRevision = revision;
    status('正在保存…');
    const pending = storage.save(state).then(() => {
      savedRevision = Math.max(savedRevision, requestedRevision);
      if (savedRevision === revision) {
        status('已保存到本机');
        if (lastSaveError && errorLine.textContent === lastSaveError.message) showError(null);
        lastSaveError = null;
      }
      return true;
    }, error => {
      if (requestedRevision >= savedRevision) status('保存失败，点击重试', true);
      lastSaveError = error;
      showError(error);
      return false;
    });
    savePending = pending;
    return pending;
  }
  function changed() {
    revision += 1;
    status('尚未保存');
    showError(null);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
    queuePreview();
  }
  function renderTemplateControls() {
    templateSelect.replaceChildren(...state.templates.map(template => {
      const option = root.ownerDocument.createElement('option');
      option.value = template.id;
      option.textContent = template.name;
      return option;
    }));
    templateSelect.value = state.activeId;
    nameInput.value = current().name;
  }
  function renderFields() {
    const expanded = new Map(Array.from(fields.querySelectorAll('[data-weekly-group]'), node => [node.dataset.weeklyGroup, node.open]));
    unregisterFont();
    disposeParameterRanges(fields);
    const template = current();
    const fontSelect = renderWeeklyScheduleFields(fields, template);
    fields.querySelectorAll('[data-weekly-group]').forEach(node => {
      if (expanded.has(node.dataset.weeklyGroup)) node.open = expanded.get(node.dataset.weeklyGroup);
    });
    selectCategory(activeCategory);
    unregisterFont = registerFontSelect(fontSelect) || (() => {});
    for (const font of WEEKLY_FONTS) {
      if (findSharedFont(font.value) || Array.from(fontSelect.options).some(option => option.value === font.value)) continue;
      const option = root.ownerDocument.createElement('option');
      option.value = font.value;
      option.textContent = font.label;
      fontSelect.append(option);
    }
    ensureSavedFontOption(fontSelect, template.fontId);
    fontSelect.value = template.fontId;
    initParameterRanges(fields);
    enhanceSelects(fields);
    enhanceColorControls(fields);
    renderTemplateControls();
    updatePreview();
  }
  function selectCategory(category, focus = false) {
    activeCategory = category;
    fields.querySelectorAll('[data-weekly-tab]').forEach(tab => {
      const selected = tab.dataset.weeklyTab === category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    fields.querySelectorAll('[data-weekly-panel]').forEach(panel => {
      panel.hidden = panel.dataset.weeklyPanel !== category;
    });
  }
  function replaceCurrent(template) {
    const index = state.templates.findIndex(item => item.id === state.activeId);
    state.templates[index] = template;
    renderFields();
    changed();
  }
  async function load() {
    if (loading || disposed) return;
    loading = true;
    try {
      state = await storage.load();
      if (disposed) return;
      root.querySelectorAll('[data-weekly-action], [data-weekly-template], [data-weekly-template-name]').forEach(input => { input.disabled = false; });
      exportButton.disabled = !bridge?.exportPng;
      if (!bridge?.exportPng) exportButton.title = '请在 LIRA 桌面应用中导出图片';
      renderFields();
      status('已保存到本机');
      showError(null);
    } catch (error) {
      showError(error);
      status('模板读取失败，点击重试', true);
    } finally {
      loading = false;
    }
  }
  function readField(input) {
    const path = input.dataset.weeklyField;
    if (!path || !state) return;
    const parts = path.split('.');
    let target = current();
    for (const part of parts.slice(0, -1)) target = target[part];
    const key = parts.at(-1);
    const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    if (path === 'monday' && !input.value) { input.value = current().monday; return; }
    if (target[key] === value) return;
    target[key] = value;
    if (path === 'monday') {
      current().monday = getWeekDates(input.value)[0];
      input.value = current().monday;
    }
    const exact = fields.querySelector(`[data-weekly-number="${path}"]`);
    if (exact) exact.value = input.value;
    if (path === 'monday' || path.startsWith('days.')) updateDaySummaries();
    if (path === 'primaryColor' || path === 'accentColor') updatePaletteButtons();
    changed();
  }
  function readNumber(input, commit = false) {
    const range = fields.querySelector(`[data-weekly-field="${input.dataset.weeklyNumber}"]`);
    if (!range) return;
    if (!input.value || !Number.isFinite(input.valueAsNumber)) {
      if (commit) input.value = range.value;
      return;
    }
    if (!commit && !input.validity.valid) return;
    // The native range owns clamping and step rounding for both entry methods.
    range.value = input.value;
    readField(range);
    if (commit) input.value = range.value;
    refreshParameterRange(range);
  }
  function updateDaySummaries() {
    const template = current();
    const dates = getWeekDates(template.monday);
    fields.querySelectorAll('[data-weekly-day]').forEach((details, index) => {
      details.querySelector('.weekly-day-label').textContent = `${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index]} · ${dates[index].slice(5).replace('-', '/')}`;
      details.querySelector('.weekly-day-description').textContent = template.days[index].theme || (template.days[index].rest ? '休息' : '待安排');
    });
  }
  function updatePaletteButtons() {
    const template = current();
    fields.querySelectorAll('[data-weekly-palette]').forEach(button => {
      const palette = WEEKLY_PALETTES.find(item => item.id === button.dataset.weeklyPalette);
      button.setAttribute('aria-pressed', String(template.primaryColor === palette.primaryColor && template.accentColor === palette.accentColor));
    });
  }
  async function upload(input) {
    const file = input.files?.[0];
    if (!file || !state) return;
    const template = current();
    const key = input.dataset.weeklyAsset;
    const slot = `${template.id}:${key}`;
    const generation = (uploadGenerations.get(slot) || 0) + 1;
    uploadGenerations.set(slot, generation);
    pendingUploads.set(slot, generation);
    exportButton.disabled = true;
    input.disabled = true;
    try {
      const data = await readWeeklyScheduleAsset(file, { allowSvg: key === 'icon' });
      if (disposed || uploadGenerations.get(slot) !== generation || !state.templates.includes(template)) return;
      const bytes = ASSET_KEYS.reduce((sum, assetKey) => sum + getWeeklyScheduleAssetBytes(assetKey === key ? data : template.assets[assetKey]), 0);
      if (bytes > MAX_TEMPLATE_ASSET_BYTES) throw new Error('每个模板的图片合计不能超过 48 MiB，请缩小图片后重试。');
      template.assets[key] = data;
      if (key === 'icon') template.icon = 'custom';
      if (current() === template) refreshWeeklyScheduleAsset(fields, template, key);
      changed();
    } catch (error) {
      showError(error);
    } finally {
      if (pendingUploads.get(slot) === generation) pendingUploads.delete(slot);
      input.value = '';
      input.disabled = false;
      if (!disposed) exportButton.disabled = exporting || pendingUploads.size > 0 || !bridge?.exportPng;
    }
  }
  async function confirm(title, message, confirmLabel) {
    return showConfirmationDialog({ title, message, confirmLabel, variant: 'caution' });
  }
  async function action(name) {
    if (name === 'retry') {
      if (state) await persist();
      else await load();
      return;
    }
    if (!state || disposed) return;
    const template = current();
    if (name === 'expand-days') {
      const days = Array.from(fields.querySelectorAll('[data-weekly-day]'));
      const open = days.some(day => !day.open);
      days.forEach(day => { day.open = open; });
      fields.querySelector('[data-weekly-action="expand-days"]').textContent = open ? '全部收起' : '全部展开';
    } else if (['previous-week', 'next-week', 'this-week'].includes(name)) {
      const date = new Date(`${template.monday}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + (name === 'next-week' ? 7 : -7));
      const monday = name === 'this-week' ? getWeekDates()[0] : getWeekDates(date.toISOString().slice(0, 10))[0];
      const input = fields.querySelector('[data-weekly-field="monday"]');
      input.value = monday;
      readField(input);
    } else if (name === 'apply-times') {
      const { time1, time2 } = template.days[0];
      if (!await confirm('统一一周的开播时间？', `将周一的时间「${[time1, time2].filter(Boolean).join(' / ') || '留空'}」应用到七天，保留每天的主题、备注与休息安排。`, '应用时间')) return;
      if (disposed || current() !== template) return;
      template.days.forEach((day, index) => {
        Object.assign(day, { time1, time2 });
        for (const key of ['time1', 'time2']) fields.querySelector(`[data-weekly-field="days.${index}.${key}"]`).value = day[key];
      });
      changed();
    } else if (name === 'new' || name === 'copy') {
      const next = name === 'copy'
        ? cloneWeeklyScheduleTemplate(template)
        : createWeeklyScheduleTemplate({ name: nameInput.value.trim() && nameInput.value.trim() !== template.name ? nameInput.value.trim() : '新周表' });
      state.templates.push(next);
      state.activeId = next.id;
      renderFields();
      changed();
    } else if (name === 'rename') {
      const value = nameInput.value.trim();
      if (!value) { showError(new Error('请填写模板名称。')); nameInput.focus(); return; }
      template.name = value;
      renderTemplateControls();
      changed();
    } else if (name === 'delete') {
      if (!await confirm('删除这个周表模板？', `「${template.name}」的排期和上传素材会一起删除。`, '删除模板')) return;
      if (disposed || current() !== template) return;
      state.templates = state.templates.filter(item => item !== template);
      if (!state.templates.length) state.templates.push(createWeeklyScheduleTemplate());
      state.activeId = state.templates[0].id;
      renderFields();
      changed();
    } else if (name === 'clear') {
      if (await confirm('开始新一周？', '清空七天主题、备注、休息和活动标记，保留开播时间与图片。', '清空本周内容') && !disposed && current() === template) replaceCurrent(clearWeeklyScheduleWeek(template));
    } else if (name === 'reset') {
      if (await confirm('重置当前模板？', '当前模板的内容、外观和上传素材将恢复为初始设置。', '重置模板') && !disposed && current() === template) replaceCurrent(createWeeklyScheduleTemplate({ id: template.id, name: template.name }));
    } else if (name === 'export' && !exporting && pendingUploads.size === 0 && bridge?.exportPng) {
      // Freeze at the click; subsequent typing or template switches belong to the next export.
      // The isolated renderer checks overflow after all fonts and images have loaded.
      const snapshot = normalizeWeeklyScheduleTemplate(template);
      exporting = true;
      exportButton.disabled = true;
      exportButton.textContent = '正在导出…';
      try {
        await persist();
        if (disposed) return;
        const result = await bridge.exportPng(snapshot);
        if (!result?.ok) throw new Error(result?.error || '周表导出失败，请重试。');
        if (result.saved) toast('周表图片已保存', { type: 'success' });
      } catch (error) {
        showError(error);
      } finally {
        exporting = false;
        if (!disposed) { exportButton.disabled = pendingUploads.size > 0; exportButton.textContent = '导出 PNG'; }
      }
    }
  }
  function onInput(event) {
    if (event.target.matches('[data-weekly-number]')) { readNumber(event.target); return; }
    const input = event.target.closest('[data-weekly-field]');
    if (input && input.tagName !== 'SELECT' && input.type !== 'checkbox' && input.type !== 'date') readField(input);
  }
  function onChange(event) {
    const input = event.target;
    if (input.matches('[data-weekly-number]')) readNumber(input, true);
    else if (input.matches('[data-weekly-asset]')) void upload(input);
    else if (input === templateSelect && state) {
      state.activeId = input.value;
      renderFields();
      changed();
    } else if (input.matches('[data-weekly-field]') && (input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'date')) readField(input);
  }
  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button) || !state) {
      if (button === retry) void action('retry');
      return;
    }
    if (button.dataset.weeklyTab) selectCategory(button.dataset.weeklyTab);
    else if (button.dataset.weeklyLayout) {
      current().layout = button.dataset.weeklyLayout;
      fields.querySelectorAll('[data-weekly-layout]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
      changed();
    } else if (button.dataset.weeklyReset) {
      const key = button.dataset.weeklyReset;
      current()[key] = createWeeklyScheduleTemplate()[key];
      renderFields();
      changed();
    } else if (button.dataset.weeklyAction) void action(button.dataset.weeklyAction);
    else if (button.dataset.weeklyPalette) {
      const palette = WEEKLY_PALETTES.find(item => item.id === button.dataset.weeklyPalette);
      Object.assign(current(), { palette: palette.id, primaryColor: palette.primaryColor, accentColor: palette.accentColor });
      for (const key of ['primaryColor', 'accentColor']) {
        const input = fields.querySelector(`[data-weekly-field="${key}"]`);
        input.value = palette[key];
      }
      enhanceColorControls(fields);
      updatePaletteButtons();
      changed();
    } else if (button.dataset.weeklyIcon) {
      current().icon = button.dataset.weeklyIcon;
      fields.querySelectorAll('[data-weekly-icon]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
      changed();
    } else if (button.dataset.weeklyRemoveAsset) {
      const key = button.dataset.weeklyRemoveAsset;
      const template = current();
      const slot = `${template.id}:${key}`;
      uploadGenerations.set(slot, (uploadGenerations.get(slot) || 0) + 1);
      template.assets[key] = '';
      if (key === 'icon' && template.icon === 'custom') template.icon = 'heart';
      refreshWeeklyScheduleAsset(fields, template, key);
      changed();
    }
  }
  function flush() {
    if (state && revision > savedRevision) void persist();
  }
  function onKeyDown(event) {
    const tab = event.target.closest('[data-weekly-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(fields.querySelectorAll('[data-weekly-tab]'));
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    selectCategory(tabs[next].dataset.weeklyTab, true);
  }
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', flush);
  const resize = new ResizeObserver(() => { resizePreview(); fitPreview(); });
  resize.observe(viewport);
  root.ownerDocument.fonts.addEventListener('loadingdone', fitPreview);
  await load();
  return {
    dispose() {
      flush();
      disposed = true;
      clearTimeout(saveTimer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      unregisterFont();
      disposeParameterRanges(fields);
      root.ownerDocument.fonts.removeEventListener('loadingdone', fitPreview);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pagehide', flush);
      void savePending.finally(() => storage.close());
    },
  };
}

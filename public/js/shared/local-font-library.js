'use strict';

const registeredSelects = new Set();
let localFontFamilies = null;
let localFontQuery = null;
let gestureRetryInstalled = false;

function quoteCssFontFamily(family) {
  return `"${family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function normalizeLocalFontFamilies(fonts) {
  const uniqueFamilies = new Map();
  Array.from(fonts || []).forEach((font) => {
    const family = String(font?.family || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 200);
    const key = family.toLocaleLowerCase();
    if (family && !uniqueFamilies.has(key)) uniqueFamilies.set(key, family);
  });
  return Array.from(uniqueFamilies.values()).sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true }),
  );
}

function firstCssFontFamily(value) {
  const source = String(value || '').trim();
  if (!source || source === 'default') return '';
  const quote = source[0];
  if (quote === '"' || quote === "'") {
    let escaped = false;
    for (let index = 1; index < source.length; index += 1) {
      const character = source[index];
      if (!escaped && character === quote) return source.slice(1, index);
      escaped = !escaped && character === '\\';
      if (character !== '\\') escaped = false;
    }
  }
  return source.split(',')[0].trim();
}

function replaceLocalFontOptions(select, families) {
  const currentValue = select.value;
  const currentOption = Array.from(select.options).find(option => option.value === currentValue);
  const currentFont = { label: currentOption?.textContent, fontFamily: currentOption?.dataset.fontFamily || currentValue };
  select.querySelector('optgroup[data-local-fonts="true"]')?.remove();
  const existingFamilies = new Set(
    Array.from(select.options)
      .filter(option => !option.dataset.savedLocalFont)
      .map((option) => firstCssFontFamily(option.dataset.fontFamily || option.value).toLocaleLowerCase())
      .filter(Boolean),
  );
  const group = document.createElement('optgroup');
  group.label = '系统字体库';
  group.dataset.localFonts = 'true';
  families.forEach((family) => {
    if (existingFamilies.has(family.toLocaleLowerCase())) return;
    const value = quoteCssFontFamily(family);
    if (Array.from(value).length > Number(select.dataset?.fontMaxLength || Infinity)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = family;
    option.dataset.fontFamily = value;
    group.appendChild(option);
  });

  if (group.children.length) select.appendChild(group);
  ensureSavedFontOption(select, currentValue, currentFont);
  select.value = currentValue;
}

function populateRegisteredSelects(families) {
  registeredSelects.forEach((select) => replaceLocalFontOptions(select, families));
}

function installGestureRetry() {
  if (gestureRetryInstalled || typeof window.addEventListener !== 'function') return;
  gestureRetryInstalled = true;
  const retry = () => {
    gestureRetryInstalled = false;
    window.removeEventListener?.('pointerdown', retry, true);
    window.removeEventListener?.('keydown', retry, true);
    void loadRegisteredLocalFonts();
  };
  window.addEventListener('pointerdown', retry, { once: true, capture: true });
  window.addEventListener('keydown', retry, { once: true, capture: true });
}

async function loadRegisteredLocalFonts() {
  if (localFontFamilies !== null) {
    populateRegisteredSelects(localFontFamilies);
    return;
  }
  if (localFontQuery || typeof window.queryLocalFonts !== 'function') return;
  try {
    localFontQuery = Promise.resolve()
      .then(() => window.queryLocalFonts())
      .then(normalizeLocalFontFamilies);
    localFontFamilies = await localFontQuery;
    if (localFontFamilies.length > 0) populateRegisteredSelects(localFontFamilies);
  } catch (error) {
    if (error?.name === 'SecurityError') {
      localFontQuery = null;
      installGestureRetry();
      return;
    }
    console.warn('Automatic local font detection failed:', error?.message || error);
  }
}

/** Preserve a persisted font value that is absent from this machine's current options. */
export function ensureSavedFontOption(select, value, { label, fontFamily = value } = {}) {
  if (!select?.options) return;
  const localOptions = Array.from(select.querySelector('optgroup[data-local-fonts="true"]')?.children || []);
  let existing = Array.from(select.options).find(option => option.value === value && !option.dataset.savedLocalFont);
  if (!existing && value) {
    const family = firstCssFontFamily(fontFamily).toLocaleLowerCase();
    existing = localOptions.find(option => firstCssFontFamily(option.dataset.fontFamily).toLocaleLowerCase() === family);
    if (existing && existing.value !== value) existing.value = value;
  }
  for (const option of localOptions) {
    if (option !== existing && option.value !== option.dataset.fontFamily) option.value = option.dataset.fontFamily;
  }
  for (const option of Array.from(select.options)) {
    if (option.dataset.savedLocalFont && (existing || option.value !== value)) option.remove();
  }
  let group = select.querySelector('optgroup[data-saved-fonts]');
  if (group && !group.children.length) {
    group.remove();
    group = null;
  }
  if (!value) return;
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists) return;

  if (!group) {
    group = document.createElement('optgroup');
    group.label = '当前设置';
    group.dataset.savedFonts = 'true';
    select.insertBefore(group, select.querySelector('optgroup[data-local-fonts="true"]'));
  }
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label || String(value).replace(/^"|"$/g, '');
  option.dataset.fontFamily = fontFamily;
  option.dataset.savedLocalFont = 'true';
  group.appendChild(option);
}

/** Register one selector to receive the shared, deduplicated local font inventory. */
export function registerLocalFontSelect(select) {
  if (!select) return;
  registeredSelects.add(select);
  if (localFontFamilies !== null) {
    replaceLocalFontOptions(select, localFontFamilies);
  } else {
    void loadRegisteredLocalFonts();
  }
  return () => registeredSelects.delete(select);
}

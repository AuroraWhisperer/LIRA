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
  return Array.from(uniqueFamilies.values())
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true }));
}

function firstCssFontFamily(value) {
  const source = String(value || '').trim();
  if (!source || source === 'default') return '';
  const quote = source[0];
  if (quote === '"' || quote === '\'') {
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
  select.querySelector('optgroup[data-local-fonts="true"]')?.remove();
  const existingFamilies = new Set(Array.from(select.options)
    .map((option) => firstCssFontFamily(option.value).toLocaleLowerCase())
    .filter(Boolean));
  const group = document.createElement('optgroup');
  group.label = '本机字体';
  group.dataset.localFonts = 'true';
  families.forEach((family) => {
    if (existingFamilies.has(family.toLocaleLowerCase())) return;
    const option = document.createElement('option');
    option.value = quoteCssFontFamily(family);
    option.textContent = family;
    group.appendChild(option);
  });

  select.appendChild(group);
  if (Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
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
export function ensureSavedFontOption(select, value) {
  if (!select?.options || !value) return;
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists) return;

  const option = document.createElement('option');
  option.value = value;
  option.textContent = `${String(value).replace(/^"|"$/g, '')}（当前设置）`;
  option.dataset.savedLocalFont = 'true';
  select.appendChild(option);
}

/** Register one selector to receive the shared, deduplicated local font inventory. */
export function registerLocalFontSelect(select) {
  if (!select) return;
  registeredSelects.add(select);
  if (localFontFamilies !== null) {
    replaceLocalFontOptions(select, localFontFamilies);
    return;
  }
  void loadRegisteredLocalFonts();
}

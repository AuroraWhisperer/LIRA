'use strict';

import { showError } from '../../shared/utils.js';
import { CITIES, DEFAULT_IDS, matchesCity } from './cities.js';
import { clockAt, dayDifference, differenceLabel, isDaylight, sunDirection } from './time.js';
import { createGlobe } from './globe.js';

const STORAGE_KEY = 'admin.worldClock';
const CITY_BY_ID = new Map(CITIES.map(city => [city.id, city]));
let initialized = false;

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#world-clock-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  svg.append(use);
  return svg;
}

function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function renderTime(node, clock) {
  if (!node.querySelector('span')) {
    const seconds = document.createElement('span');
    seconds.className = 'world-clock-seconds';
    node.replaceChildren(document.createTextNode(''), seconds);
  }
  const time = `${clock.hour}:${clock.minute}`;
  if (node.firstChild.nodeValue !== time) node.firstChild.nodeValue = time;
  setText(node.lastChild, `:${clock.second}`);
}

export function initWorldClock() {
  const root = document.getElementById('otherWorldClockFeature');
  if (initialized || !root) return;
  initialized = true;
  const mainPage = document.getElementById('otherAssistantPage');
  const elements = Object.fromEntries([...root.querySelectorAll('[data-world-clock]')]
    .map(node => [node.dataset.worldClock, node]));
  const get = name => elements[name];
  const events = new AbortController();
  const listen = (node, name, listener) => node.addEventListener(name, listener, { signal: events.signal });
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { saved = null; }
  let ids = Array.isArray(saved?.ids) ? [...new Set(saved.ids)].filter(id => CITY_BY_ID.has(id)) : [...DEFAULT_IDS];
  let format = saved?.format === '12' ? '12' : '24';
  let selectedId = ids.includes(saved?.selectedId) ? saved.selectedId : (ids[0] || null);
  let rows = [];
  let globe;
  let globeReady = false;
  let globeVisible = false;
  let timer;
  let active = false;
  let disposed = false;
  let lastSunMinute = -1;
  let catalogMinute = '';

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids, format, selectedId })); }
    catch { showError('世界时钟设置未保存，请重试。'); }
  }

  function syncMarkers(focus = false) {
    globe?.setCities(ids.map(id => CITY_BY_ID.get(id)), selectedId);
    if (focus && selectedId) globe?.focus(CITY_BY_ID.get(selectedId));
  }

  function selectCity(id) {
    selectedId = id;
    save();
    for (const row of rows) {
      row.card.classList.toggle('is-selected', row.city.id === id);
      row.button.setAttribute('aria-pressed', String(row.city.id === id));
    }
    syncMarkers(true);
    tick();
  }

  function renderCards() {
    const list = get('list');
    list.replaceChildren();
    rows = [];
    const visible = ids.map(id => CITY_BY_ID.get(id)).filter(city => matchesCity(city, get('filter').value));
    for (const city of visible) {
      const card = document.createElement('article');
      card.className = `world-clock-city${city.id === selectedId ? ' is-selected' : ''}`;
      card.dataset.worldClockCity = city.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'world-clock-city-select';
      button.setAttribute('aria-label', `查看${city.name}时间并定位`);
      button.setAttribute('aria-pressed', String(city.id === selectedId));
      button.innerHTML = '<div class="world-clock-city-heading"><span class="world-clock-city-name"></span><span class="world-clock-city-country"></span><span class="world-clock-city-offset"></span></div><div class="world-clock-city-time-row"><time class="world-clock-city-time"></time><span class="world-clock-city-period"></span></div><div class="world-clock-city-date"><span class="world-clock-date-text"></span><span class="world-clock-day-change"></span></div>';
      button.querySelector('.world-clock-city-name').textContent = city.name;
      button.querySelector('.world-clock-city-country').textContent = city.name === city.country ? '' : city.country;
      button.addEventListener('click', () => selectCity(city.id));
      const lightIcon = icon('sun', 'world-clock-light-icon');
      lightIcon.removeAttribute('aria-hidden');
      button.querySelector('.world-clock-city-time-row').append(lightIcon);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'world-clock-remove';
      remove.setAttribute('aria-label', `移除${city.name}`);
      remove.title = `移除${city.name}`;
      remove.append(icon('close'));
      remove.addEventListener('click', () => {
        const index = ids.indexOf(city.id);
        ids = ids.filter(id => id !== city.id);
        if (selectedId === city.id) selectedId = ids[Math.min(index, ids.length - 1)] || null;
        save();
        syncMarkers(true);
        renderCards();
        const nextRow = rows[Math.min(index, rows.length - 1)];
        (nextRow?.button || get('add')).focus();
        tick();
      });
      card.append(button, remove);
      list.append(card);
      rows.push({ city, card, button, lightIcon, time: button.querySelector('time'),
        period: button.querySelector('.world-clock-city-period'), offset: button.querySelector('.world-clock-city-offset'),
        date: button.querySelector('.world-clock-date-text'), difference: button.querySelector('.world-clock-day-change') });
    }
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'world-clock-empty';
      empty.textContent = ids.length ? '未找到城市' : '尚未添加城市';
      if (!ids.length) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'primary';
        add.textContent = '添加城市';
        add.addEventListener('click', openAdd);
        empty.append(add);
      }
      list.append(empty);
    }
    tick();
  }

  function tick() {
    if (!active || disposed) return;
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60000);
    if (get('dialog').open) {
      const key = `${minute}/${format}`;
      if (catalogMinute !== key) {
        for (const node of get('results').querySelectorAll('[data-world-clock-catalog-time]')) {
          const clock = clockAt(CITY_BY_ID.get(node.dataset.worldClockCatalogTime).zone, now, format);
          setText(node, `${clock.period ? `${clock.period} ` : ''}${clock.hour}:${clock.minute}`);
        }
        catalogMinute = key;
      }
      return;
    }
    const reference = clockAt('Asia/Shanghai', now, format);
    const sun = sunDirection(now);
    const clocks = new Map(ids.map(id => [id, clockAt(CITY_BY_ID.get(id).zone, now, format)]));
    for (const row of rows) {
      const clock = clocks.get(row.city.id);
      renderTime(row.time, clock);
      row.time.dateTime = now.toISOString();
      setText(row.period, clock.period);
      setText(row.offset, clock.offset);
      setText(row.date, `${clock.dateLabel} · ${clock.weekday}`);
      setText(row.difference, dayDifference(clock, reference));
      const daylight = isDaylight(row.city, sun);
      if (row.daylight !== daylight) {
        row.daylight = daylight;
        row.lightIcon.querySelector('use').setAttribute('href', `#world-clock-${daylight ? 'sun' : 'moon'}`);
        row.lightIcon.classList.toggle('is-night', !daylight);
        row.lightIcon.setAttribute('aria-label', daylight ? '白昼' : '黑夜');
      }
    }
    if (selectedId) {
      const city = CITY_BY_ID.get(selectedId);
      const clock = clocks.get(selectedId);
      setText(get('name'), city.name === city.country ? city.name : `${city.country} · ${city.name}`);
      setText(get('offset'), clock.offset);
      renderTime(get('time'), clock);
      get('time').dateTime = now.toISOString();
      setText(get('period'), clock.period);
      setText(get('date'), `${clock.fullDate} · ${clock.weekday}`);
      setText(get('difference'), city.id === 'beijing' ? '北京时间' : differenceLabel(clock, reference));
    } else {
      setText(get('name'), '');
      setText(get('time'), '--:--');
      get('time').removeAttribute('datetime');
      for (const name of ['offset', 'period', 'date', 'difference']) setText(get(name), '');
    }
    const focusDisabled = !selectedId || !globeReady;
    if (get('focus').disabled !== focusDisabled) get('focus').disabled = focusDisabled;
    for (const node of root.querySelectorAll('[data-world-clock-marker-time]')) {
      const clock = clocks.get(node.dataset.worldClockMarkerTime);
      setText(node, `${clock.period ? `${clock.period} ` : ''}${clock.hour}:${clock.minute}`);
    }
    if (globe && minute !== lastSunMinute) {
      globe.setSun(now);
      lastSunMinute = minute;
    }
  }

  function renderCatalog() {
    catalogMinute = '';
    const matches = CITIES.filter(city => matchesCity(city, get('search').value));
    const results = get('results');
    results.replaceChildren();
    for (const city of matches) {
      const added = ids.includes(city.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'world-clock-catalog-city';
      button.disabled = added;
      button.setAttribute('aria-label', added ? `${city.name}已添加` : `添加${city.name}`);
      const content = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = city.name;
      const details = document.createElement('p');
      details.textContent = `${city.country} · ${city.english}`;
      content.append(name, details);
      const time = document.createElement('time');
      time.dataset.worldClockCatalogTime = city.id;
      button.append(content, time, icon(added ? 'check' : 'plus'));
      if (added) {
        const note = document.createElement('span');
        note.className = 'world-clock-catalog-added';
        note.textContent = '已添加';
        button.append(note);
      }
      button.addEventListener('click', () => {
        ids.push(city.id);
        get('filter').value = '';
        get('dialog').close();
        renderCards();
        selectCity(city.id);
        rows.find(row => row.city.id === city.id)?.button.focus();
      });
      results.append(button);
    }
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'world-clock-empty';
      empty.textContent = '未找到城市';
      results.append(empty);
    }
    tick();
  }

  function openAdd() {
    get('search').value = '';
    renderCatalog();
    get('dialog').showModal();
    syncGlobeActivity();
    get('search').focus();
    tick();
  }

  function syncGlobeActivity() {
    globe?.setActive(active && globeVisible && !get('dialog').open);
  }

  function syncVisibility() {
    const visible = !document.hidden && !root.hidden && mainPage.classList.contains('active');
    if (visible === active) return;
    active = visible;
    syncGlobeActivity();
    clearInterval(timer);
    if (active) {
      tick();
      timer = setInterval(tick, 1000);
    } else if (get('dialog').open) get('dialog').close();
  }

  function globeError(message) {
    globeReady = false;
    get('message').textContent = message;
    get('message').hidden = false;
    for (const button of root.querySelectorAll('.world-clock-globe-controls button')) button.disabled = true;
  }

  listen(get('add'), 'click', openAdd);
  listen(get('close'), 'click', () => get('dialog').close());
  listen(get('dialog'), 'close', () => { syncGlobeActivity(); tick(); });
  listen(get('dialog'), 'click', event => {
    if (event.target !== get('dialog')) return;
    const rect = get('dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) get('dialog').close();
  });
  listen(get('filter'), 'input', renderCards);
  listen(get('search'), 'input', renderCatalog);
  for (const button of root.querySelectorAll('[data-world-clock-format]')) {
    button.setAttribute('aria-pressed', String(button.dataset.worldClockFormat === format));
    listen(button, 'click', () => {
      format = button.dataset.worldClockFormat;
      for (const item of root.querySelectorAll('[data-world-clock-format]')) item.setAttribute('aria-pressed', String(item.dataset.worldClockFormat === format));
      save();
      tick();
    });
  }
  listen(get('zoom-in'), 'click', () => globe?.zoom(0.12));
  listen(get('zoom-out'), 'click', () => globe?.zoom(-0.12));
  listen(get('rotate'), 'click', () => globe?.toggleRotation());
  listen(get('focus'), 'click', () => { if (selectedId) globe?.focus(CITY_BY_ID.get(selectedId)); });
  listen(document, 'visibilitychange', syncVisibility);
  const observer = new MutationObserver(syncVisibility);
  observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(mainPage, { attributes: true, attributeFilter: ['class'] });
  const intersection = new IntersectionObserver(entries => {
    globeVisible = entries[0].isIntersecting;
    syncGlobeActivity();
  });
  intersection.observe(get('globe'));
  listen(window, 'pagehide', () => {
    disposed = true;
    clearInterval(timer);
    observer.disconnect();
    intersection.disconnect();
    events.abort();
    globe?.destroy();
    if (get('dialog').open) get('dialog').close();
  });
  renderCards();
  syncVisibility();
  for (const button of root.querySelectorAll('.world-clock-globe-controls button')) button.disabled = true;
  createGlobe(get('globe'), get('markers'), selectCity, rotating => get('rotate').setAttribute('aria-pressed', String(rotating)), globeError)
    .then(instance => {
      if (disposed) { instance.destroy(); return; }
      globe = instance;
      globeReady = true;
      syncGlobeActivity();
      syncMarkers(true);
      get('message').hidden = true;
      for (const button of root.querySelectorAll('.world-clock-globe-controls button')) button.disabled = false;
      tick();
    })
    .catch(error => { if (!disposed) globeError(error.message); });
}

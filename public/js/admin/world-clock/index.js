'use strict';

import { CITIES, DEFAULT_IDS, matchesCity } from './cities.js';
import { clockAt, dayDifference, isDaylight, sunDirection } from './time.js';
import { createGlobe } from './globe.js';
import { createTemperatureController } from './temperature.js';

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
  let globeStarted = false;
  let globeReady = false;
  let globeVisible = false;
  let timer;
  let active = false;
  let disposed = false;
  let lastSunMinute = -1;
  let catalogMinute = '';
  const temperatures = createTemperatureController({
    getCities: () => ids.map(id => CITY_BY_ID.get(id)),
    onChange: renderTemperatures,
  });

  function renderTemperatures() {
    for (const row of rows) {
      const state = temperatures.get(row.city.id);
      const value = state?.data ? `${Math.round(state.data.temperature)}°C` : '—°C';
      const condition = state?.data?.condition || (state?.loading ? '天气更新中' : '暂无天气');
      setText(row.temperature, `${value}${state?.data && state.failed ? '*' : ''}`);
      setText(row.condition, `${condition}${state?.data?.condition && state.failed ? '*' : ''}`);
      row.temperature.classList.toggle('is-stale', Boolean(state?.failed));
      const updated = state?.data ? new Date(state.data.updatedAt).toLocaleString('zh-CN', {
        timeZone: row.city.zone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }) : '';
      const status = state?.loading ? '正在更新' : state?.failed ? (state.data ? '未更新，显示上次天气' : '天气暂不可用') : '当前天气';
      row.temperature.title = `${status}${updated ? ` · 微软天气更新于当地 ${updated}` : ''}`;
      row.condition.title = `${condition} · ${row.temperature.title}`;
      row.button.setAttribute('aria-label', `定位${row.city.name}，${value}，${condition}，${status}`);
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids, format, selectedId })); }
    catch (error) { console.warn('世界地图设置未保存。', error); }
  }

  function syncMarkers(focus = false) {
    globe?.setCities(ids.map(id => CITY_BY_ID.get(id)), selectedId);
    if (focus && selectedId) globe?.focus(CITY_BY_ID.get(selectedId));
  }

  function selectCity(id, showDetails = false) {
    selectedId = id;
    save();
    for (const row of rows) {
      row.card.classList.toggle('is-selected', row.city.id === id);
      row.button.setAttribute('aria-pressed', String(row.city.id === id));
    }
    syncMarkers(true);
    get('details').hidden = !showDetails;
    tick();
    if (showDetails) get('details').focus({ preventScroll: true });
  }

  function closeDetails() {
    const restoreFocus = get('details').contains(document.activeElement);
    get('details').hidden = true;
    if (restoreFocus) (rows.find(row => row.city.id === selectedId)?.button || get('globe')).focus({ preventScroll: true });
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
      button.setAttribute('aria-label', `定位${city.name}`);
      button.setAttribute('aria-pressed', String(city.id === selectedId));
      button.innerHTML = '<div class="world-clock-city-heading"><span class="world-clock-city-name"></span><span class="world-clock-city-country"></span><span class="world-clock-city-offset"></span></div><div class="world-clock-city-body"><div><div class="world-clock-city-time-row"><time class="world-clock-city-time"></time><span class="world-clock-city-period"></span></div><div class="world-clock-city-date"><span class="world-clock-date-text"></span><span class="world-clock-day-change"></span></div></div><div class="world-clock-weather"><span class="world-clock-temperature"></span><span class="world-clock-condition"></span></div></div>';
      button.querySelector('.world-clock-city-name').textContent = city.name;
      button.querySelector('.world-clock-city-country').textContent = city.name === city.country ? '' : city.country;
      button.addEventListener('click', () => selectCity(city.id));
      const lightIcon = icon('sun', 'world-clock-light-icon');
      const temperature = button.querySelector('.world-clock-temperature');
      const condition = button.querySelector('.world-clock-condition');
      lightIcon.removeAttribute('aria-hidden');
      button.querySelector('.world-clock-city-offset').before(lightIcon);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'world-clock-remove';
      remove.setAttribute('aria-label', `移除${city.name}`);
      remove.title = `移除${city.name}`;
      remove.append(icon('close'));
      remove.addEventListener('click', () => {
        const index = rows.findIndex(row => row.city.id === city.id);
        ids = ids.filter(id => id !== city.id);
        if (selectedId === city.id) {
          closeDetails();
          selectedId = (rows[index + 1] || rows[index - 1])?.city.id || ids[0] || null;
        }
        save();
        syncMarkers(true);
        renderCards();
        const nextRow = rows[Math.min(index, rows.length - 1)];
        (nextRow?.button || get('add')).focus();
        tick();
      });
      card.append(button, remove);
      list.append(card);
      rows.push({ city, card, button, lightIcon, temperature, condition, time: button.querySelector('time'),
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
    renderTemperatures();
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
    rows.sort((a, b) => clocks.get(a.city.id).offsetMinutes - clocks.get(b.city.id).offsetMinutes
      || ids.indexOf(a.city.id) - ids.indexOf(b.city.id));
    const list = get('list');
    rows.forEach((row, index) => {
      if (list.children[index] !== row.card) list.moveBefore(row.card, list.children[index]);
    });
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
    if (selectedId && !get('details').hidden) {
      const city = CITY_BY_ID.get(selectedId);
      const clock = clocks.get(selectedId);
      setText(get('name'), city.name);
      setText(get('country'), city.name === city.country ? '' : city.country);
      get('country').hidden = city.name === city.country;
      setText(get('zone'), city.zone);
      setText(get('offset'), clock.offset);
      renderTime(get('time'), clock);
      get('time').dateTime = now.toISOString();
      setText(get('period'), clock.period);
      setText(get('date'), `${clock.fullDate} · ${clock.weekday}`);
    }
    const focusDisabled = !selectedId || !globeReady;
    if (get('focus').disabled !== focusDisabled) get('focus').disabled = focusDisabled;
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
        temperatures.refreshCity(city);
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
      loadGlobe();
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

  function loadGlobe() {
    if (globeStarted) return;
    globeStarted = true;
    createGlobe(get('globe'), get('markers'), id => selectCity(id, true), rotating => get('rotate').setAttribute('aria-pressed', String(rotating)), globeError)
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

  listen(get('add'), 'click', openAdd);
  listen(get('details-close'), 'click', closeDetails);
  listen(document, 'keydown', event => {
    if (!active || event.key !== 'Escape' || get('details').hidden || get('dialog').open) return;
    event.preventDefault();
    event.stopPropagation();
    closeDetails();
  });
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
    temperatures.destroy();
    clearInterval(timer);
    observer.disconnect();
    intersection.disconnect();
    events.abort();
    globe?.destroy();
    if (get('dialog').open) get('dialog').close();
  });
  renderCards();
  for (const button of root.querySelectorAll('.world-clock-globe-controls button')) button.disabled = true;
  temperatures.start();
  syncVisibility();
}

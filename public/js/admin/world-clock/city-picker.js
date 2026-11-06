'use strict';

import { CITIES, matchesCity } from './cities.js';
import { clockAt } from './time.js';

export function createCityPicker({ dialog, search, results, footer, summary, more, closeButton,
  getSelectedIds, getFormat, createAddIcon, onAdd, onOpenChange }) {
  const events = new AbortController();
  const listen = (node, name, listener) => node.addEventListener(name, listener, { signal: events.signal });
  let matches = [];
  let shown = 0;
  let renderedTimes = [];
  let renderedMinute = '';

  function updateTime(now, format) {
    const key = `${Math.floor(now.getTime() / 60000)}/${format}`;
    if (renderedMinute === key) return;
    for (const { city, time } of renderedTimes) {
      const clock = clockAt(city.zone, now, format);
      const text = `${clock.period ? `${clock.period} ` : ''}${clock.hour}:${clock.minute}`;
      if (time.textContent !== text) time.textContent = text;
    }
    renderedMinute = key;
  }

  function render(append = false) {
    renderedMinute = '';
    const query = search.value.trim();
    if (!append) {
      const selectedIds = getSelectedIds();
      matches = query ? CITIES.filter(city => !selectedIds.includes(city.id) && matchesCity(city, query)) : [];
      shown = 0;
      renderedTimes = [];
      results.replaceChildren();
      results.scrollTop = 0;
    }
    const nextIndex = shown;
    for (const city of matches.slice(shown, shown + 100)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'world-clock-catalog-city';
      button.setAttribute('aria-label', `添加${city.name}`);
      const content = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = city.name;
      const details = document.createElement('p');
      details.textContent = [city.country, city.region, city.english].filter(Boolean).join(' · ');
      content.append(name, details);
      const time = document.createElement('time');
      time.dataset.worldClockCatalogTime = city.id;
      renderedTimes.push({ city, time });
      button.append(content, time, createAddIcon());
      button.addEventListener('click', () => {
        close();
        onAdd(city);
      });
      results.append(button);
    }
    shown = Math.min(shown + 100, matches.length);
    footer.hidden = !matches.length;
    summary.textContent = `共 ${matches.length.toLocaleString()} 座城市，已显示 ${shown.toLocaleString()} 座`;
    more.hidden = shown === matches.length;
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'world-clock-empty';
      empty.textContent = query ? '没有匹配的可添加城市' : '输入城市名称或国家开始搜索';
      results.append(empty);
    }
    if (append) results.children[nextIndex]?.focus();
    updateTime(new Date(), getFormat());
  }

  function open() {
    search.value = '';
    render();
    dialog.showModal();
    onOpenChange();
    search.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  listen(closeButton, 'click', close);
  listen(dialog, 'close', onOpenChange);
  listen(dialog, 'click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  listen(search, 'input', () => render());
  listen(more, 'click', () => render(true));

  function dispose() {
    events.abort();
    close();
  }

  return { open, close, updateTime, dispose };
}

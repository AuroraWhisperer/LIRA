'use strict';

import { readApiResponse } from '../../shared/json-response.js';

const REFRESH_MS = 60 * 60 * 1000;

export function createTemperatureController({ getCities, onChange }) {
  const states = new Map();
  const controller = new AbortController();
  const pendingCities = new Map();
  let started = false;
  let refreshing = false;
  let timer;
  let disposed = false;

  function fetchCity(city) {
    if (pendingCities.has(city.id)) return pendingCities.get(city.id);
    const previous = states.get(city.id);
    states.set(city.id, { ...previous, loading: true });
    onChange(city.id);
    const pending = (async () => {
      try {
        const headers = {};
        if (window.__API_TOKEN__) headers.Authorization = `Bearer ${window.__API_TOKEN__}`;
        const response = await fetch(`/api/world-clock/temperature?latitude=${city.lat}&longitude=${city.lon}`, {
          headers,
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        const payload = await readApiResponse(response, '温度更新失败');
        if (disposed || !getCities().some(item => item.id === city.id)) return;
        states.set(city.id, { data: payload.data, loading: false, failed: false });
        onChange(city.id);
      } catch {
        if (!disposed && getCities().some(item => item.id === city.id)) {
          states.set(city.id, { ...previous, loading: false, failed: true });
          onChange(city.id);
        }
      } finally {
        pendingCities.delete(city.id);
      }
    })();
    pendingCities.set(city.id, pending);
    return pending;
  }

  async function refreshCities(cities) {
    const queue = [...cities];
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (queue.length && !disposed) {
        const city = queue.shift();
        if (getCities().some(item => item.id === city.id)) await fetchCity(city);
      }
    }));
  }

  async function refresh() {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      await refreshCities(getCities());
    } finally {
      refreshing = false;
    }
  }

  function schedule() {
    timer = setTimeout(() => {
      schedule();
      void refresh();
    }, REFRESH_MS - Date.now() % REFRESH_MS);
  }

  return {
    get: id => states.get(id),
    start() {
      if (disposed || started) return;
      started = true;
      schedule();
      return refresh();
    },
    refreshCity(city) { if (started && !disposed) void fetchCity(city); },
    refreshCities,
    destroy() {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      states.clear();
    },
  };
}

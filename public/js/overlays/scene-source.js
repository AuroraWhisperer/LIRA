import { createDisplaySource } from './display-source.js';

export function createSceneSource({ sceneId, itemId, token, renderer, onError }) {
  return createDisplaySource({
    outputPath: '/api/scene/output', eventsPath: '/api/scene/events', token, renderer, onError,
    getCursor: (output) => output.data?.danmaku,
    query() {
      const values = new URLSearchParams({ id: sceneId, version: renderer.getVersion() });
      if (itemId) values.set('item', itemId);
      if (renderer.getProjection()) values.set('projection', renderer.getProjection());
      return values;
    },
  });
}

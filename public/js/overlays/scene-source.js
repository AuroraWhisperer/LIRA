import { createDisplaySource } from './display-source.js';

export function createSceneSource({ sceneId, itemId, token, renderer, onError }) {
  return createDisplaySource({
    outputPath: '/api/scene/output', eventsPath: '/api/scene/events', token, renderer, onError,
    conditionalData: true,
    getCursor: (output) => output.data?.danmaku,
    query() {
      const values = new URLSearchParams({ id: sceneId, version: renderer.getVersion() });
      values.set('incrementalParts', '1');
      if (itemId) values.set('item', itemId);
      if (renderer.getProjection()) values.set('projection', renderer.getProjection());
      return values;
    },
  });
}

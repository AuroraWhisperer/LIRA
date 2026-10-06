export const MIN_SCENE_ITEM_VISIBLE = 24;

export function getSceneItemPositionBounds(item, canvas) {
  return {
    minX: MIN_SCENE_ITEM_VISIBLE - item.width,
    maxX: canvas.width - MIN_SCENE_ITEM_VISIBLE,
    minY: MIN_SCENE_ITEM_VISIBLE - item.height,
    maxY: canvas.height - MIN_SCENE_ITEM_VISIBLE,
  };
}

export function clampSceneItemPosition(item, canvas) {
  const bounds = getSceneItemPositionBounds(item, canvas);
  item.x = Math.max(bounds.minX, Math.min(bounds.maxX, item.x));
  item.y = Math.max(bounds.minY, Math.min(bounds.maxY, item.y));
}

export function isSceneItemGeometryValid(item, canvas) {
  const bounds = getSceneItemPositionBounds(item, canvas);
  return [item.x, item.y, item.width, item.height].every(Number.isFinite)
    && item.width >= 32 && item.width <= canvas.width
    && item.height >= 32 && item.height <= canvas.height
    && item.x >= bounds.minX && item.x <= bounds.maxX
    && item.y >= bounds.minY && item.y <= bounds.maxY;
}

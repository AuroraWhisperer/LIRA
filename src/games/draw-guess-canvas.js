'use strict';

const DRAW_COLORS = new Set(['#222034', '#6c5ce7', '#ef476f', '#118ab2', '#06d6a0', '#f6bd60', '#ffffff']);
const DRAW_WIDTHS = new Set([2, 4, 8, 12]);
const MAX_STROKES = 160;
const MAX_POINTS_PER_STROKE = 500;
const MAX_POINTS_PER_OPERATION = 32;
const MAX_TOTAL_POINTS = 6000;

function createCanvasState() {
  return { revision: 0, totalPoints: 0, strokes: [] };
}

function cloneCanvasState(canvas) {
  return {
    revision: canvas.revision,
    totalPoints: canvas.totalPoints,
    strokes: canvas.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

function applyCanvasOperation(canvas, input = {}) {
  const clientId = normalizeIdentifier(input.clientId);
  if (!clientId) return reject('绘画客户端标识无效。', canvas);
  if (input.action === 'clear') {
    const revision = canvas.revision + 1;
    return {
      accepted: true,
      operation: { action: 'clear', clientId, revision },
      canvas: { revision, totalPoints: 0, strokes: [] },
    };
  }
  if (input.action === 'undo') {
    const stroke = canvas.strokes.at(-1);
    if (!stroke) return reject('没有可撤销的笔画。', canvas);
    const revision = canvas.revision + 1;
    return {
      accepted: true,
      operation: { action: 'undo', clientId, strokeId: stroke.id, revision },
      canvas: {
        revision,
        totalPoints: Math.max(0, canvas.totalPoints - stroke.points.length),
        strokes: canvas.strokes.slice(0, -1),
      },
    };
  }
  if (input.action !== 'append') return reject('不支持这个绘画操作。', canvas);

  const strokeId = normalizeIdentifier(input.strokeId);
  const color = String(input.color || '').toLowerCase();
  const width = Number(input.width);
  const points = normalizePoints(input.points);
  if (!strokeId) return reject('笔画标识无效。', canvas);
  if (!DRAW_COLORS.has(color)) return reject('画笔颜色无效。', canvas);
  if (!DRAW_WIDTHS.has(width)) return reject('画笔粗细无效。', canvas);
  if (!points) return reject(`每次请提交 1-${MAX_POINTS_PER_OPERATION} 个有效坐标。`, canvas);

  const strokeIndex = canvas.strokes.findIndex((stroke) => stroke.id === strokeId);
  const existing = strokeIndex >= 0 ? canvas.strokes[strokeIndex] : null;
  if (!existing && canvas.strokes.length >= MAX_STROKES) return reject('本局笔画数量已达上限。', canvas);
  if (existing && (existing.color !== color || existing.width !== width))
    return reject('同一笔画的样式不能改变。', canvas);
  if ((existing?.points.length || 0) + points.length > MAX_POINTS_PER_STROKE)
    return reject('单笔坐标数量已达上限。', canvas);
  if (canvas.totalPoints + points.length > MAX_TOTAL_POINTS) return reject('本局画布坐标数量已达上限。', canvas);

  const strokes = canvas.strokes.slice();
  if (existing) strokes[strokeIndex] = { ...existing, points: [...existing.points, ...points] };
  else strokes.push({ id: strokeId, color, width, points: [...points] });
  const revision = canvas.revision + 1;
  return {
    accepted: true,
    operation: { action: 'append', clientId, strokeId, color, width, points, revision },
    canvas: { revision, totalPoints: canvas.totalPoints + points.length, strokes },
  };
}

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS_PER_OPERATION) return null;
  const normalized = [];
  for (const point of points) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    normalized.push({
      x: Math.round(x * 10000) / 10000,
      y: Math.round(y * 10000) / 10000,
    });
  }
  return normalized;
}

function normalizeIdentifier(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : '';
}

function reject(reason, canvas) {
  return { accepted: false, reason, canvas };
}

module.exports = { createCanvasState, cloneCanvasState, applyCanvasOperation };

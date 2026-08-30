import { showConfirmationDialog } from '../shared/confirmation-dialog.js';
import {
  colorDistance,
  createShapePoints,
  isShapeTool,
} from './games-drawing-geometry.js';
import { createDrawControls } from './games-drawing-controls.js';

const DRAW_TOOLS = ['pen', 'eraser', 'line', 'rectangle', 'ellipse', 'picker'];
const DRAW_TOOL_BUTTONS = {
  pen: 'drawPenBtn',
  eraser: 'drawEraserBtn',
  line: 'drawLineBtn',
  rectangle: 'drawRectangleBtn',
  ellipse: 'drawEllipseBtn',
  picker: 'drawPickerBtn',
};

export function createDrawController({
  byId,
  canDraw,
  getSession,
  loadSnapshot,
  renderDanmaku,
}) {
  let drawColor = '#222034';
  let drawWidth = 4;
  let drawTool = 'pen';
  let drawFlushTimer = null;
  let activeStroke = null;
  let drawSendChain = Promise.resolve();
  let drawDanmakuRenderTimer = null;
  let pendingDrawDanmakuItems = null;
  let drawDanmakuUpdateTimes = [];
  let drawDanmakuLastRenderedAt = 0;
  let drawDanmakuLastRenderDurationMs = 0;
  let drawClock = null;

  const drawControls = createDrawControls({
    byId,
    canDraw,
    getSession,
    onDisable: () => {
      clearTimeout(drawFlushTimer);
      drawFlushTimer = null;
      activeStroke = null;
      redrawCanvas(getSession()?.state?.canvas);
    },
  });

  const drawClientId = `draw-${
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;

  function init() {
    const canvas = byId('drawCanvas');
    redrawCanvas({ strokes: [] });
    document.querySelectorAll('[data-draw-color]').forEach((button) =>
      button.addEventListener('click', () => {
        drawColor = button.dataset.drawColor;
        setActiveDrawTool('pen');
        updateDrawColorButtons();
      }),
    );
    byId('drawPenBtn').addEventListener('click', () =>
      setActiveDrawTool('pen'),
    );
    byId('drawEraserBtn').addEventListener('click', () =>
      setActiveDrawTool('eraser'),
    );
    byId('drawLineBtn').addEventListener('click', () =>
      setActiveDrawTool('line'),
    );
    byId('drawRectangleBtn').addEventListener('click', () =>
      setActiveDrawTool('rectangle'),
    );
    byId('drawEllipseBtn').addEventListener('click', () =>
      setActiveDrawTool('ellipse'),
    );
    byId('drawPickerBtn').addEventListener('click', () =>
      setActiveDrawTool('picker'),
    );
    document.querySelectorAll('[data-draw-width]').forEach((button) =>
      button.addEventListener('click', () => {
        setDrawWidth(Number(button.dataset.drawWidth));
      }),
    );
    byId('drawUndoBtn').addEventListener('click', undoLastDrawStroke);
    byId('drawClearBtn').addEventListener('click', clearDrawCanvas);
    document.addEventListener('keydown', handleDrawShortcut);
    canvas.addEventListener('pointerdown', startDrawing);
    canvas.addEventListener('pointermove', continueDrawing);
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
  }

  function scheduleDrawDanmakuRender(items) {
    pendingDrawDanmakuItems = Array.isArray(items) ? items : [];
    const now = performance.now();
    drawDanmakuUpdateTimes.push(now);
    drawDanmakuUpdateTimes = drawDanmakuUpdateTimes.filter(
      (timestamp) => now - timestamp < 1000,
    );
    if (drawDanmakuRenderTimer) return;
    const interval = getDrawDanmakuRenderInterval(now);
    const elapsed = drawDanmakuLastRenderedAt
      ? now - drawDanmakuLastRenderedAt
      : interval;
    const waitMs = Math.max(0, interval - elapsed);
    if (waitMs > 0)
      drawDanmakuRenderTimer = setTimeout(flushDrawDanmakuRender, waitMs);
    else flushDrawDanmakuRender();
  }

  function getDrawDanmakuRenderInterval(now = performance.now()) {
    const updatesPerSecond = drawDanmakuUpdateTimes.length;
    const renderWasRecentlySlow =
      drawDanmakuLastRenderedAt > 0 && now - drawDanmakuLastRenderedAt < 1000;
    if (
      updatesPerSecond >= 20 ||
      (renderWasRecentlySlow && drawDanmakuLastRenderDurationMs >= 16)
    )
      return 500;
    if (
      updatesPerSecond >= 8 ||
      (renderWasRecentlySlow && drawDanmakuLastRenderDurationMs >= 8)
    )
      return 200;
    return 0;
  }

  function flushDrawDanmakuRender() {
    clearTimeout(drawDanmakuRenderTimer);
    drawDanmakuRenderTimer = null;
    if (!pendingDrawDanmakuItems) return;
    const items = pendingDrawDanmakuItems;
    pendingDrawDanmakuItems = null;
    const startedAt = performance.now();
    renderDanmaku(items);
    drawDanmakuLastRenderedAt = performance.now();
    drawDanmakuLastRenderDurationMs = drawDanmakuLastRenderedAt - startedAt;
  }

  function resetDanmakuRenderScheduler() {
    clearTimeout(drawDanmakuRenderTimer);
    drawDanmakuRenderTimer = null;
    pendingDrawDanmakuItems = null;
    drawDanmakuUpdateTimes = [];
    drawDanmakuLastRenderedAt = 0;
    drawDanmakuLastRenderDurationMs = 0;
  }

  function updateCountdown() {
    const currentSession = getSession();
    if (
      currentSession?.game !== 'draw-guess' ||
      currentSession.state?.phase !== 'drawing' ||
      !drawClock
    )
      return;
    const remaining = Math.max(
      0,
      drawClock.remainingMs - (performance.now() - drawClock.receivedAt),
    );
    const seconds = Math.ceil(remaining / 1000);
    const countdown = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    byId('drawCountdown').textContent = countdown;
    byId('gameTurn').textContent =
      `第 ${currentSession.state.round} / ${currentSession.state.totalRounds} 局 · ${countdown}`;
  }

  function setDrawingClock(nextClock) {
    drawClock = nextClock;
  }

  function setActiveDrawTool(tool) {
    drawTool = DRAW_TOOLS.includes(tool) ? tool : 'pen';
    const canvas = byId('drawCanvas');
    canvas.classList.toggle('is-eraser', drawTool === 'eraser');
    canvas.classList.toggle(
      'is-shape',
      ['line', 'rectangle', 'ellipse'].includes(drawTool),
    );
    canvas.classList.toggle('is-picker', drawTool === 'picker');
    Object.entries(DRAW_TOOL_BUTTONS).forEach(([name, id]) => {
      byId(id).setAttribute('aria-pressed', String(drawTool === name));
    });
  }

  function updateDrawColorButtons() {
    document.querySelectorAll('[data-draw-color]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.drawColor === drawColor),
      );
    });
  }

  function setDrawWidth(width) {
    const nextWidth = Number(width);
    if (![2, 4, 8, 12].includes(nextWidth)) return;
    drawWidth = nextWidth;
    document.querySelectorAll('[data-draw-width]').forEach((item) => {
      item.setAttribute(
        'aria-pressed',
        String(Number(item.dataset.drawWidth) === drawWidth),
      );
    });
  }

  function stepDrawWidth(direction) {
    const widths = [...document.querySelectorAll('[data-draw-width]')]
      .map((button) => Number(button.dataset.drawWidth))
      .filter((width) => Number.isFinite(width));
    const currentIndex = Math.max(0, widths.indexOf(drawWidth));
    const nextIndex = Math.max(
      0,
      Math.min(widths.length - 1, currentIndex + direction),
    );
    setDrawWidth(widths[nextIndex]);
  }

  function handleDrawShortcut(event) {
    if (
      !canDraw() ||
      isDrawTextInput(event.target) ||
      event.target?.closest?.('.lira-confirm-backdrop')
    )
      return;
    const key = String(event.key || '').toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') {
      event.preventDefault();
      undoLastDrawStroke();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'b') {
      event.preventDefault();
      setActiveDrawTool('pen');
    } else if (key === 'e') {
      event.preventDefault();
      setActiveDrawTool('eraser');
    } else if (key === 'l') {
      event.preventDefault();
      setActiveDrawTool('line');
    } else if (key === 'r') {
      event.preventDefault();
      setActiveDrawTool('rectangle');
    } else if (key === 'o') {
      event.preventDefault();
      setActiveDrawTool('ellipse');
    } else if (key === 'i') {
      event.preventDefault();
      setActiveDrawTool('picker');
    } else if (key === '[') {
      event.preventDefault();
      stepDrawWidth(-1);
    } else if (key === ']') {
      event.preventDefault();
      stepDrawWidth(1);
    }
  }

  function isDrawTextInput(target) {
    const tagName = String(target?.tagName || '').toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      Boolean(target?.isContentEditable)
    );
  }

  function startDrawing(event) {
    if (!canDraw() || (event.pointerType === 'mouse' && event.button !== 0))
      return;
    event.preventDefault();
    if (drawTool === 'picker') {
      pickDrawColor(event);
      return;
    }
    const canvas = byId('drawCanvas');
    canvas.setPointerCapture(event.pointerId);
    const point = drawPointFromEvent(event);
    activeStroke = {
      pointerId: event.pointerId,
      tool: drawTool,
      strokeId: `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      color: drawTool === 'eraser' ? '#ffffff' : drawColor,
      width: drawWidth,
      startPoint: point,
      lastPoint: point,
      pendingPoints: isShapeTool(drawTool) ? [] : [point],
    };
    if (isShapeTool(drawTool)) {
      previewActiveShape();
      return;
    }
    drawCanvasPoints([point], activeStroke.color, drawWidth);
    scheduleDrawFlush();
  }

  function continueDrawing(event) {
    if (
      !activeStroke ||
      activeStroke.pointerId !== event.pointerId ||
      !canDraw()
    )
      return;
    event.preventDefault();
    const point = drawPointFromEvent(event);
    if (isShapeTool(activeStroke.tool)) {
      activeStroke.lastPoint = point;
      previewActiveShape();
      return;
    }
    if (
      Math.abs(point.x - activeStroke.lastPoint.x) +
        Math.abs(point.y - activeStroke.lastPoint.y) <
      0.001
    )
      return;
    drawCanvasPoints(
      [activeStroke.lastPoint, point],
      activeStroke.color,
      activeStroke.width,
    );
    activeStroke.lastPoint = point;
    activeStroke.pendingPoints.push(point);
    if (activeStroke.pendingPoints.length >= 16) flushActiveStroke();
    else scheduleDrawFlush();
  }

  function stopDrawing(event) {
    if (!activeStroke || activeStroke.pointerId !== event.pointerId) return;
    event.preventDefault();
    finalizeActiveStroke();
  }

  function finalizeActiveStroke() {
    if (!activeStroke) return;
    if (isShapeTool(activeStroke.tool)) {
      const points = createShapePoints(
        activeStroke.tool,
        activeStroke.startPoint,
        activeStroke.lastPoint,
      );
      activeStroke.pendingPoints = points;
      redrawCanvas(getSession()?.state?.canvas);
      drawCanvasPoints(points, activeStroke.color, activeStroke.width);
    }
    flushActiveStroke();
    clearTimeout(drawFlushTimer);
    drawFlushTimer = null;
    activeStroke = null;
  }

  function previewActiveShape() {
    if (!activeStroke || !isShapeTool(activeStroke.tool)) return;
    const points = createShapePoints(
      activeStroke.tool,
      activeStroke.startPoint,
      activeStroke.lastPoint,
    );
    redrawCanvas(getSession()?.state?.canvas);
    drawCanvasPoints(points, activeStroke.color, activeStroke.width);
  }

  function pickDrawColor(event) {
    const canvas = byId('drawCanvas');
    const point = drawPointFromEvent(event);
    const context = canvas.getContext('2d');
    const pixel = context.getImageData(
      Math.min(
        canvas.width - 1,
        Math.max(0, Math.floor(point.x * canvas.width)),
      ),
      Math.min(
        canvas.height - 1,
        Math.max(0, Math.floor(point.y * canvas.height)),
      ),
      1,
      1,
    ).data;
    if (pixel[0] > 245 && pixel[1] > 245 && pixel[2] > 245) return;
    const palette = [...document.querySelectorAll('[data-draw-color]')].map(
      (button) => button.dataset.drawColor,
    );
    drawColor = palette.reduce(
      (nearest, color) =>
        colorDistance(color, pixel) < colorDistance(nearest, pixel)
          ? color
          : nearest,
      palette[0] || drawColor,
    );
    updateDrawColorButtons();
    setActiveDrawTool('pen');
  }

  function scheduleDrawFlush() {
    clearTimeout(drawFlushTimer);
    drawFlushTimer = setTimeout(flushActiveStroke, 40);
  }

  function flushActiveStroke() {
    if (!activeStroke?.pendingPoints.length) return;
    clearTimeout(drawFlushTimer);
    drawFlushTimer = null;
    while (activeStroke?.pendingPoints.length) {
      const operation = {
        action: 'append',
        clientId: drawClientId,
        strokeId: activeStroke.strokeId,
        color: activeStroke.color,
        width: activeStroke.width,
        points: activeStroke.pendingPoints.splice(0, 32),
      };
      mergeDrawOperation(operation, false);
      queueDrawOperation(operation);
    }
  }

  async function clearDrawCanvas() {
    if (!canDraw()) return;
    finalizeActiveStroke();
    if (!getSession().state.canvas.strokes.length) return;
    const confirmed = await showConfirmationDialog({
      variant: 'caution',
      title: '清空当前画布？',
      description: '当前画布上的所有笔画都会被移除，且会同步到其他游戏网页。',
      confirmLabel: '清空画布',
      cancelLabel: '取消',
    });
    if (!confirmed || !canDraw()) return;
    const operation = { action: 'clear', clientId: drawClientId };
    mergeDrawOperation(operation, true);
    queueDrawOperation(operation);
  }

  function undoLastDrawStroke() {
    if (!canDraw()) return;
    finalizeActiveStroke();
    if (!getSession().state.canvas.strokes.length) return;
    const operation = { action: 'undo', clientId: drawClientId };
    mergeDrawOperation(operation, true);
    queueDrawOperation(operation);
  }

  function queueDrawOperation(operation) {
    drawSendChain = drawSendChain
      .then(async () => {
        const response = await fetch('/api/games/session/draw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation),
        });
        const payload = await response.json();
        if (!payload.ok) throw new Error(payload.error || '画笔同步失败');
      })
      .catch(() => {
        byId('gameTurn').textContent = '画笔同步失败 · 正在恢复';
        loadSnapshot();
      });
  }

  function applyBroadcast(operation) {
    if (!operation || getSession()?.game !== 'draw-guess') return;
    if (operation.clientId === drawClientId) {
      if (getSession().state?.canvas)
        getSession().state.canvas.revision = operation.revision;
      return;
    }
    mergeDrawOperation(operation, true);
  }

  function mergeDrawOperation(operation, drawIncrement) {
    if (!getSession()?.state?.canvas) return;
    const canvasState = getSession().state.canvas;
    if (operation.action === 'clear') {
      canvasState.strokes = [];
      canvasState.totalPoints = 0;
      canvasState.revision = Number(operation.revision) || canvasState.revision;
      redrawCanvas(canvasState);
      drawControls.syncUndoState();
      return;
    }
    if (operation.action === 'undo') {
      const strokeIndex = canvasState.strokes.findIndex(
        (stroke) => stroke.id === operation.strokeId,
      );
      if (strokeIndex >= 0) {
        canvasState.totalPoints = Math.max(
          0,
          canvasState.totalPoints -
            canvasState.strokes[strokeIndex].points.length,
        );
        canvasState.strokes.splice(strokeIndex, 1);
        redrawCanvas(canvasState);
      }
      canvasState.revision = Number(operation.revision) || canvasState.revision;
      drawControls.syncUndoState();
      return;
    }
    if (operation.action !== 'append' || !Array.isArray(operation.points))
      return;
    let stroke = canvasState.strokes.find(
      (item) => item.id === operation.strokeId,
    );
    const previous = stroke?.points.at(-1) || null;
    if (!stroke) {
      stroke = {
        id: operation.strokeId,
        color: operation.color,
        width: operation.width,
        points: [],
      };
      canvasState.strokes.push(stroke);
    }
    stroke.points.push(
      ...operation.points.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
      })),
    );
    canvasState.totalPoints =
      (Number(canvasState.totalPoints) || 0) + operation.points.length;
    canvasState.revision = Number(operation.revision) || canvasState.revision;
    if (drawIncrement)
      drawCanvasPoints(
        previous ? [previous, ...operation.points] : operation.points,
        operation.color,
        operation.width,
      );
    drawControls.syncUndoState();
  }

  function redrawCanvas(canvasState = {}) {
    const canvas = byId('drawCanvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of canvasState.strokes || [])
      drawCanvasPoints(stroke.points, stroke.color, stroke.width);
  }

  function drawCanvasPoints(points, color, width) {
    if (!Array.isArray(points) || !points.length) return;
    const canvas = byId('drawCanvas');
    const context = canvas.getContext('2d');
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = Number(width) * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (points.length === 1) {
      context.beginPath();
      context.arc(
        points[0].x * canvas.width,
        points[0].y * canvas.height,
        Number(width),
        0,
        Math.PI * 2,
      );
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(
        points[index].x * canvas.width,
        points[index].y * canvas.height,
      );
    }
    context.stroke();
  }

  function drawPointFromEvent(event) {
    const rect = byId('drawCanvas').getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  return {
    applyBroadcast,
    init,
    redrawCanvas,
    resetDanmakuRenderScheduler,
    scheduleDrawDanmakuRender,
    setToolsEnabled: drawControls.setToolsEnabled,
    setDrawingClock,
    updateCountdown,
  };
}

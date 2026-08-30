export function createDrawControls({ byId, canDraw, getSession, onDisable }) {
  function setToolsEnabled(enabled) {
    if (!enabled) onDisable();
    byId('drawCanvas').classList.toggle('is-disabled', !enabled);
    document
      .querySelectorAll(
        '[data-draw-color], [data-draw-width], #drawClearBtn, #drawUndoBtn, #drawPenBtn, #drawEraserBtn, #drawLineBtn, #drawRectangleBtn, #drawEllipseBtn, #drawPickerBtn',
      )
      .forEach((button) => {
        button.disabled = !enabled;
      });
    syncUndoState();
  }

  function syncUndoState() {
    const button = byId('drawUndoBtn');
    if (!button) return;
    button.disabled =
      !canDraw() || !getSession()?.state?.canvas?.strokes?.length;
  }

  return { setToolsEnabled, syncUndoState };
}

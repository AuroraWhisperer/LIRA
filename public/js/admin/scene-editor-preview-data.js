import { eventBus, Events } from '../shared/event-bus.js';
import { stateService } from './state.js';
import { projectOvertimePreviewState } from './overtime-preview.js';

export function startSceneEditorOvertimeData({ emit }) {
  emit(projectOvertimePreviewState(stateService.getAppState()?.overtime));
  const stopState = eventBus.on(Events.STATE_LOADED, ({ state }) => {
    if (state?.overtime) emit(projectOvertimePreviewState(state.overtime));
  });
  const stopOvertime = eventBus.on(Events.OVERTIME_UPDATED, ({ state }) => {
    emit(projectOvertimePreviewState(state));
  });
  return () => { stopState(); stopOvertime(); };
}

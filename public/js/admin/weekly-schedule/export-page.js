import { renderWeeklySchedule, waitForWeeklyScheduleImages, fitWeeklyScheduleText } from './renderer.js';

const stage = document.getElementById('weeklyScheduleExportStage');

// This fixed, unprivileged export page receives a frozen template from its owning main process.
window.renderWeeklyScheduleExport = async (template) => {
  const root = renderWeeklySchedule(stage, template);
  await document.fonts.load(`32px ${template.fontId}`, root.textContent || '直播周表');
  await document.fonts.ready;
  await waitForWeeklyScheduleImages(root);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const overflow = fitWeeklyScheduleText(root);
  // The second frame lets the offscreen compositor paint the fitted text before capturePage.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    width: root.offsetWidth,
    height: root.offsetHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    overflow,
  };
};

import { sceneAppearanceFromSettings, sceneAppearanceSettingsPatch } from '../shared/scene-shared-appearance.js';
import { createComponentConfigController } from './component-config-controller.js';
import { registerComponentSettings } from './component-settings-sync.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';
import { stateService } from './state.js';

export function createSharedSceneSettingsController(type) {
  const fromSettings = settings => sceneAppearanceFromSettings(type, settings);
  const toSettings = patch => sceneAppearanceSettingsPatch(type, patch);
  const controller = createComponentConfigController({
    initial: fromSettings(stateService.getAppState()?.settings),
    confirm: async () => fromSettings(await confirmComponentSettings()),
    persist: async (_draft, patch) => fromSettings(await saveComponentSettings(toSettings(patch))),
  });
  const unregister = registerComponentSettings(type, controller, fromSettings, toSettings);
  let pending;
  function save() {
    if (pending) return pending;
    pending = (async () => {
      while (controller.getStatus().dirty) if (!await controller.save()) return false;
      return true;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { controller, save, dispose: unregister };
}

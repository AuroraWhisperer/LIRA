const registrations = new Map();
let latestSettings = null;

export function registerComponentSettings(id, controller, fromSettings, toSettings) {
  registrations.set(id, { controller, fromSettings, toSettings });
  if (latestSettings) controller.receive(fromSettings(latestSettings));
  return () => registrations.delete(id);
}

export function receiveComponentSettings(settings) {
  latestSettings = settings;
  for (const { controller, fromSettings } of registrations.values()) controller.receive(fromSettings(settings));
}

export function projectComponentDrafts(settings) {
  const projected = { ...settings };
  for (const { controller, toSettings } of registrations.values()) {
    if (controller.getState().loaded) Object.assign(projected, toSettings(controller.getState().draft));
  }
  return projected;
}

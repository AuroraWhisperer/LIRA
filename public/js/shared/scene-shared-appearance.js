// Scene placement and the selected style belong to the scene. These fields belong
// to the existing component owner, including when the item was saved as a snapshot.
export const SHARED_CONTROLLER_TYPES = ['clock', 'queue', 'danmaku', 'overtime'];

export function hasInstalledAppearance(config = {}) {
  return Boolean(config.resourceStyle || config.mediaStyle || config.cssStyle);
}

export function sharedControllerAppearance(type, config, defaults) {
  if (!defaults || hasInstalledAppearance(config) || !SHARED_CONTROLLER_TYPES.includes(type)) return {};
  if (type === 'clock' && defaults.styleOptions?.[config?.style]) {
    return { ...defaults.styleOptions[config.style], styleOptions: { [config.style]: defaults.styleOptions[config.style] },
      styleParameters: defaults.styleParameters || {} };
  }
  const identity = type === 'queue' ? 'overlayQueueStyle' : 'style';
  return { ...Object.fromEntries(Object.entries(defaults).filter(([key]) => key !== identity
    && !(type === 'danmaku' && key === 'layout'))),
    ...(['clock', 'danmaku'].includes(type) ? { styleParameters: defaults.styleParameters || {} } : {}),
    ...(type === 'danmaku' ? { styleOptions: defaults.styleOptions || {} } : {}) };
}

export function sceneAppearanceKey(type, config = {}) {
  return JSON.stringify([type, config.resourceStyle?.id || config.mediaStyle?.id || config.cssStyle?.id || '',
    config.resourceStyle ? '' : config.style || config.displayStyle || config.overlayQueueStyle || config.kind || '']);
}

export function mergeSharedAppearancePatch(current, patch, config, type) {
  if (type === 'clock' && current.styleOptions) {
    const { styleOptions, styleParameters, ...fields } = patch;
    const profile = { ...current.styleOptions[config.style], ...styleOptions?.[config.style], ...fields };
    return { ...(current.style === config.style ? profile : {}),
      styleOptions: { ...current.styleOptions, [config.style]: profile },
      ...(styleParameters ? { styleParameters: { ...current.styleParameters, [config.style]: styleParameters[config.style] || {} } } : {}) };
  }
  const result = { ...patch };
  // A canvas for one style cannot overwrite another style from an older snapshot.
  for (const field of ['styleOptions', 'styleParameters']) {
    if (!Object.hasOwn(patch, field)) continue;
    const style = config.resourceStyle ? `resource:${config.resourceStyle.id}`
      : config.cssStyle ? `css:${config.cssStyle.id}` : config.mediaStyle ? `media:${config.mediaStyle.id}` : config.style;
    result[field] = { ...current[field], [style]: patch[field]?.[style] || {} };
  }
  return result;
}

'use strict';

const initializedPanels = new WeakSet();

export function initDesktopNotificationSettings({ documentRef = document, bridge = window.desktopNotifications } = {}) {
  const panel = documentRef.getElementById('settingsNotificationsPanel');
  if (!panel || initializedPanels.has(panel)) return;
  initializedPanels.add(panel);
  const planner = documentRef.getElementById('plannerNotificationsEnabled');
  const gifts = documentRef.getElementById('largeGiftNotificationsEnabled');
  const threshold = documentRef.getElementById('largeGiftNotificationThreshold');
  const feedback = documentRef.getElementById('desktopNotificationsFeedback');
  let settings = null;
  let supported = false;
  let pending = null;

  function render() {
    const values = pending || settings;
    if (values) {
      planner.checked = values.plannerRemindersEnabled;
      gifts.checked = values.largeGiftEnabled;
      threshold.value = values.largeGiftThresholdRmb;
    }
    planner.disabled = gifts.disabled = !supported || !settings || Boolean(pending);
    threshold.disabled = gifts.disabled || !values?.largeGiftEnabled;
    panel.setAttribute('aria-busy', String(Boolean(pending)));
  }

  async function save(patch) {
    if (!settings || pending || !supported) return;
    pending = { ...settings, ...patch };
    feedback.textContent = '正在保存…';
    render();
    try {
      const result = await bridge.update(patch);
      if (!result?.ok) throw new Error('Notification settings were not saved');
      settings = result.settings;
      feedback.textContent = '通知设置已保存';
    } catch {
      feedback.textContent = '通知设置未保存，请重试。';
    } finally {
      pending = null;
      render();
    }
  }

  planner.addEventListener('change', () => void save({ plannerRemindersEnabled: planner.checked }));
  gifts.addEventListener('change', () => void save({ largeGiftEnabled: gifts.checked }));
  threshold.addEventListener('change', () => {
    if (!threshold.reportValidity()) return;
    void save({ largeGiftThresholdRmb: Number(threshold.value) });
  });

  async function load() {
    if (!bridge?.getState || !bridge?.update) {
      feedback.textContent = '请在 LIRA 桌面客户端设置系统通知。';
      return;
    }
    try {
      const result = await bridge.getState();
      if (!result?.ok) throw new Error('Notification settings unavailable');
      settings = result.settings;
      supported = result.supported;
      feedback.textContent = supported ? '' : '当前系统不支持桌面通知。';
    } catch {
      feedback.textContent = '通知设置读取失败，请重启 LIRA 后重试。';
    }
    render();
  }

  render();
  void load();
}

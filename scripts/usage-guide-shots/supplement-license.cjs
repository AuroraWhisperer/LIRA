'use strict';

const SHOTS = [
  {
    id: 'A1',
    file: 'client-login-window',
    title: '注册 LIRA',
    kind: 'license',
    annotations: ['#licenseAccountName', '#licensePassword', '#licenseActivationCode', '#licenseSubmitBtn'],
  },
  {
    id: 'A2',
    file: 'client-login-existing-mode',
    title: '登录已有账号与短效登录码',
    kind: 'license',
    click: '#licenseLoginMode',
  },
  {
    id: 'A3',
    file: 'client-login-username-help',
    title: '用户名规则',
    kind: 'license',
    size: [880, 800],
    hover: 'lira-help[label="用户名说明"]',
  },
  {
    id: 'A4',
    file: 'client-login-password-help',
    title: '密码规则',
    kind: 'license',
    size: [880, 800],
    hover: 'lira-help[label="密码规则"]',
  },
  {
    id: 'A5',
    file: 'client-login-activation-code',
    title: '注册激活码与一次性使用提示',
    kind: 'license',
    clip: '#licenseLoginCard',
    annotations: ['#licenseActivationCode', '#licenseCodeHelp'],
  },
  {
    id: 'A6',
    file: 'client-login-preparing',
    title: '正在准备直播工具（演示状态）',
    kind: 'license',
    license: { state: 'authorized' },
    catalog: { status: 'running', phase: 'catalog', percent: 42 },
  },
  {
    id: 'A7',
    file: 'client-login-failed-retry',
    title: '连接失败与重试连接（演示状态）',
    kind: 'license',
    license: { state: 'needs_connection', error: 'NETWORK_UNAVAILABLE' },
  },
  {
    id: 'A7b',
    file: 'client-preparation-failed',
    title: '准备未完成与重新准备（演示状态）',
    kind: 'license',
    license: { state: 'authorized' },
    catalog: { status: 'error', percent: 42, error: 'NETWORK_UNAVAILABLE' },
  },
  { id: 'A8', file: 'client-main-first-open', title: '主界面四个主标签与直播状态' },
  {
    id: 'A9',
    file: 'client-tour-bubble',
    title: '聚光灯引导：登录你的直播账号',
    feature: 'otherUsageGuideFeature',
    click: ['#reopenInteractiveTourBtn', '.lira-tour-next', '.lira-tour-next'],
  },
  { id: 'A10', file: 'client-topbar-status', title: '顶部导航、直播状态与窗口按钮', clip: '.topbar' },
];

module.exports = { SHOTS };

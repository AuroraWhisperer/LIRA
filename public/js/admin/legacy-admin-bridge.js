'use strict';

export function getLegacyAdminModules() {
  return window.AdminApp || {};
}

export function publishNavigation(navigation) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.navigation = navigation;
}

export function publishOnboarding(controller) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.onboarding = controller;
}

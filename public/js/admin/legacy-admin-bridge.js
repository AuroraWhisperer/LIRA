'use strict';

export function getLegacyAdminModules() {
  return window.AdminApp || {};
}

export function publishNavigation(navigation) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.navigation = navigation;
}

'use strict';

function toSerializableCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    expirationDate: cookie.expirationDate,
  };
}

function toElectronCookieDetails(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const protocol = cookie.secure === false ? 'http' : 'https';
  const details = {
    url: `${protocol}://${domain}${cookie.path || '/'}`,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
  };
  if (Number.isFinite(Number(cookie.expirationDate))) {
    details.expirationDate = Number(cookie.expirationDate);
  }
  return details;
}

module.exports = { toSerializableCookie, toElectronCookieDetails };

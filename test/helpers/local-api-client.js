'use strict';

// Authenticated JSON POST against a locally started LIRA runtime.
async function postJson(baseUrl, token, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

module.exports = { postJson };

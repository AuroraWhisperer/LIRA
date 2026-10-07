'use strict';

// Calls a route-table handler directly and captures its JSON response.
async function invokeRoute(handler, context, request) {
  let status = 0;
  let body = null;
  const response = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(content) {
      body = JSON.parse(content);
    },
  };
  await handler(context, request, response);
  return { status, body };
}

function invokeBodyRoute(handler, context, body) {
  return invokeRoute(handler, context, { body: async () => body });
}

function invokeQueryRoute(handler, context, query) {
  return invokeRoute(handler, context, { query: new URLSearchParams(query) });
}

module.exports = { invokeBodyRoute, invokeQueryRoute };

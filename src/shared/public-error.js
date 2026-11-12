'use strict';

function createPublicError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, publicMessage: message });
}

module.exports = { createPublicError };

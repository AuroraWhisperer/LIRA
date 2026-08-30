'use strict';

const crypto = require('node:crypto');

const WEAPI_NONCE = '0CoJUm6Qyw8W8jud';
const WEAPI_IV = '0102030405060708';
const WEAPI_PUBLIC_KEY = '010001';
const WEAPI_MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5f5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741ad8f16f4353b8b1cb4d20a7e1cdde46f';

function encryptNeteaseWeapiPayload(payload) {
  const secretKey = crypto.randomBytes(16).toString('hex').slice(0, 16);
  return {
    params: aesEncrypt(
      aesEncrypt(JSON.stringify(payload), WEAPI_NONCE),
      secretKey,
    ),
    encSecKey: rsaEncrypt(secretKey),
  };
}

function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    Buffer.from(key),
    Buffer.from(WEAPI_IV),
  );
  return Buffer.concat([
    cipher.update(String(text), 'utf8'),
    cipher.final(),
  ]).toString('base64');
}

function rsaEncrypt(secretKey) {
  const reversedHex = Buffer.from(secretKey).reverse().toString('hex');
  return modularPower(
    BigInt(`0x${reversedHex}`),
    BigInt(`0x${WEAPI_PUBLIC_KEY}`),
    BigInt(`0x${WEAPI_MODULUS}`),
  )
    .toString(16)
    .padStart(256, '0');
}

function modularPower(base, exponent, modulus) {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

module.exports = { encryptNeteaseWeapiPayload };

'use strict';

const { buildBilibiliWbiQuery, createBilibiliWbiMixinKey } = require('../wbi-signer');
const { normalizeDynamicLink } = require('./link');
const { parseReactionPage } = require('./reaction-parser');
const { readResponseBytes } = require('../../shared/response-body');
const {
  LotteryProviderError,
  fail,
  hasOwn,
  normalizeDecimalId,
  normalizeSafeInteger,
  parseCommentPage,
  parseCursor,
  parseDynamicTarget,
  parseVideoTarget,
  readPreferredId,
  relationResult,
} = require('./provider-parsers');

const API_ORIGIN = 'https://api.bilibili.com';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WBI_CACHE_MS = 10 * 60 * 1000;
const MAX_SHORT_LINK_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36';

function getNow(nowMs) {
  const value = Number(nowMs());
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Lottery provider clock must return milliseconds.');
  }
  return value;
}

function apiHeaders(context) {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: context.cookieHeader,
    Referer: 'https://www.bilibili.com/',
    'User-Agent': USER_AGENT,
  };
}

function linkHeaders() {
  return {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': USER_AGENT,
  };
}

async function readLimitedJson(response) {
  if (!response || typeof response.arrayBuffer !== 'function') {
    fail('LOTTERY_UPSTREAM_INVALID', 'Upstream response object is invalid.');
  }
  const body = await readResponseBytes(
    response,
    MAX_RESPONSE_BYTES,
    () => new LotteryProviderError('LOTTERY_RESPONSE_TOO_LARGE', 'Upstream response exceeds four MiB.'),
  );
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (_) {
    fail('LOTTERY_UPSTREAM_INVALID', 'Upstream response is not valid UTF-8.');
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    fail('LOTTERY_UPSTREAM_INVALID', 'Upstream response is not valid JSON.');
  }
}

function throwApiError(response, payload) {
  const bilibiliCode = Number(payload?.code);
  if (response.status === 401 || bilibiliCode === -101 || bilibiliCode === -111) {
    fail('LOTTERY_BILIBILI_AUTH_REQUIRED', 'Bilibili login is unavailable.', {
      httpStatus: response.status,
      bilibiliCode,
    });
  }
  if (response.status === 429) {
    fail('LOTTERY_BILIBILI_RATE_LIMITED', 'Bilibili rate limit reached.', {
      httpStatus: response.status,
      bilibiliCode,
      retryAfter: response.headers?.get?.('retry-after') || '',
    });
  }
  if (response.status === 403 || response.status === 412 || bilibiliCode === -352 || bilibiliCode === -412) {
    fail('LOTTERY_BILIBILI_CHALLENGE', 'Bilibili verification or risk control interrupted the request.', {
      httpStatus: response.status,
      bilibiliCode,
    });
  }
  fail('LOTTERY_BILIBILI_API_ERROR', 'Bilibili API request failed.', {
    httpStatus: response.status,
    bilibiliCode: Number.isFinite(bilibiliCode) ? bilibiliCode : null,
  });
}

function createLotteryProvider({ request, getContext, nowMs = Date.now }) {
  if (typeof request !== 'function' || typeof getContext !== 'function') {
    throw new TypeError('Lottery provider request and session ports are required.');
  }
  if (typeof nowMs !== 'function') {
    throw new TypeError('Lottery provider clock must be a function.');
  }

  let accountCache = null;

  async function ensureCurrentContext(context) {
    const current = await getContext();
    if (
      current.streamerId !== context.streamerId ||
      current.authorizationEpoch !== context.authorizationEpoch ||
      current.sessionEpoch !== context.sessionEpoch
    ) {
      fail('LOTTERY_SESSION_CHANGED', 'The trusted account session changed during the request.');
    }
  }

  async function performRequest(input, signal) {
    return request({ ...input, signal });
  }

  async function requestApiJson(context, kind, url, signal) {
    const parsed = new URL(url);
    if (
      parsed.origin !== API_ORIGIN ||
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      throw new TypeError('Lottery provider API origin is not allowed.');
    }
    const response = await performRequest(
      {
        scope: context.streamerId,
        kind,
        beforeRequest: () => ensureCurrentContext(context),
        url: parsed.toString(),
        init: {
          method: 'GET',
          redirect: 'error',
          headers: apiHeaders(context),
        },
      },
      signal,
    );
    const payload = await readLimitedJson(response);
    await ensureCurrentContext(context);
    if (!response.ok || payload?.code !== 0) throwApiError(response, payload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail('LOTTERY_UPSTREAM_INVALID', 'Bilibili API payload is invalid.');
    }
    return payload;
  }

  function cacheMatches(context, now) {
    return (
      accountCache &&
      accountCache.streamerId === context.streamerId &&
      accountCache.authorizationEpoch === context.authorizationEpoch &&
      accountCache.sessionEpoch === context.sessionEpoch &&
      accountCache.expiresAtMs > now
    );
  }

  async function getVerifiedAccount(context, signal) {
    const now = getNow(nowMs);
    if (cacheMatches(context, now)) return accountCache;
    const payload = await requestApiJson(context, 'account_and_wbi', `${API_ORIGIN}/x/web-interface/nav`, signal);
    const data = payload.data;
    if (!data || data.isLogin !== true) {
      fail('LOTTERY_BILIBILI_AUTH_REQUIRED', 'Bilibili did not verify the current login session.');
    }
    const ownerUid = readPreferredId(data, ['mid_str', 'mid'], 'account UID');
    const imageInfo = data.wbi_img;
    if (!imageInfo || typeof imageInfo.img_url !== 'string' || typeof imageInfo.sub_url !== 'string') {
      fail('LOTTERY_UPSTREAM_INVALID', 'WBI signing material is missing.');
    }
    let mixinKey;
    try {
      mixinKey = createBilibiliWbiMixinKey(imageInfo.img_url, imageInfo.sub_url);
    } catch (_) {
      fail('LOTTERY_UPSTREAM_INVALID', 'WBI signing material is invalid.');
    }
    accountCache = {
      streamerId: context.streamerId,
      authorizationEpoch: context.authorizationEpoch,
      sessionEpoch: context.sessionEpoch,
      ownerUid,
      mixinKey,
      expiresAtMs: now + WBI_CACHE_MS,
    };
    return accountCache;
  }

  async function resolveDynamicLink(value, context, signal) {
    let link = normalizeDynamicLink(value);
    if (!link.needsRedirect) return link;
    for (let index = 0; index < MAX_SHORT_LINK_REDIRECTS; index += 1) {
      const response = await performRequest(
        {
          scope: context.streamerId,
          kind: 'dynamic_link_redirect',
          beforeRequest: () => ensureCurrentContext(context),
          url: link.url,
          init: {
            method: 'GET',
            redirect: 'manual',
            headers: linkHeaders(),
          },
        },
        signal,
      );
      await ensureCurrentContext(context);
      if (![301, 302, 303, 307, 308].includes(response?.status)) {
        fail('LOTTERY_DYNAMIC_LINK_INVALID', 'Bilibili short link did not return an allowed redirect.');
      }
      const location = response.headers?.get?.('location');
      if (!location) {
        fail('LOTTERY_DYNAMIC_LINK_INVALID', 'Bilibili short link redirect is missing its destination.');
      }
      let destination;
      try {
        destination = new URL(location, link.url).toString();
      } catch (_) {
        fail('LOTTERY_DYNAMIC_LINK_INVALID', 'Short link destination is invalid.');
      }
      link = normalizeDynamicLink(destination);
      if (!link.needsRedirect) return link;
    }
    fail('LOTTERY_DYNAMIC_LINK_INVALID', 'Bilibili short link exceeded the redirect limit.');
  }

  async function inspectDynamic(url, signal) {
    const context = await getContext();
    const link = await resolveDynamicLink(url, context, signal);
    const account = await getVerifiedAccount(context, signal);
    const payload = await requestApiJson(
      context,
      'dynamic_detail',
      link.bvid
        ? `${API_ORIGIN}/x/web-interface/view?bvid=${encodeURIComponent(link.bvid)}`
        : `${API_ORIGIN}/x/polymer/web-dynamic/v1/detail?id=${encodeURIComponent(link.dynamicId)}`,
      signal,
    );
    const target = link.bvid ? parseVideoTarget(payload, link.bvid) : parseDynamicTarget(payload, link.dynamicId);
    target.url = link.url;
    if (target.ownerUid !== account.ownerUid) {
      fail('LOTTERY_DYNAMIC_OWNER_MISMATCH', 'The dynamic does not belong to the verified Bilibili account.');
    }
    return {
      target,
      owner: {
        streamerId: context.streamerId,
        ownerUid: account.ownerUid,
        sessionEpoch: context.sessionEpoch,
      },
    };
  }

  async function verifyOwner(ownerUid, signal) {
    const context = await getContext();
    const account = await getVerifiedAccount(context, signal);
    if (account.ownerUid !== ownerUid) fail('LOTTERY_DYNAMIC_OWNER_MISMATCH', 'Log in as the content author.');
    await ensureCurrentContext(context);
  }

  async function readReactions({ target, cursor = null, signal }) {
    if (target.kind === 'video') fail('LOTTERY_VIDEO_SOURCE_UNAVAILABLE', 'Video reaction lists are unavailable.');
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 2048)) {
      fail('LOTTERY_UPSTREAM_INVALID', 'Invalid reaction cursor.');
    }
    const context = await getContext();
    const account = await getVerifiedAccount(context, signal);
    if (target.ownerUid !== account.ownerUid) fail('LOTTERY_DYNAMIC_OWNER_MISMATCH', 'Log in as the content author.');
    const query = buildBilibiliWbiQuery(
      {
        id: normalizeDecimalId(target.dynamicId, 'dynamic ID'),
        ...(cursor ? { offset: cursor } : {}),
      },
      account.mixinKey,
      getNow(nowMs),
    );
    const payload = await requestApiJson(
      context,
      'reaction_page',
      `${API_ORIGIN}/x/polymer/web-dynamic/v1/detail/reaction?${query}`,
      signal,
    );
    return parseReactionPage(payload, cursor);
  }

  async function readPage({ target, source, cursor = null, signal } = {}) {
    if (['like', 'repost'].includes(source)) {
      const page = await readReactions({ target, cursor, signal });
      return {
        ...page,
        records: page.records.filter((record) => record.source === source),
      };
    }
    if (source !== 'comment') {
      fail('LOTTERY_SOURCE_UNAVAILABLE', 'This interaction source has not passed capability verification.');
    }
    const context = await getContext();
    const account = await getVerifiedAccount(context, signal);
    if (normalizeDecimalId(target?.ownerUid, 'target owner UID') !== account.ownerUid) {
      fail('LOTTERY_DYNAMIC_OWNER_MISMATCH', 'The target does not belong to the verified Bilibili account.');
    }
    const previousCursor = parseCursor(cursor);
    const params = {
      type: normalizeSafeInteger(target?.commentType, 'comment type', {
        minimum: 1,
      }),
      oid: normalizeDecimalId(target?.commentOid, 'comment object ID'),
      mode: 2,
      ps: 30,
      ...(previousCursor ? { pagination_str: previousCursor } : {}),
    };
    const query = buildBilibiliWbiQuery(params, account.mixinKey, getNow(nowMs));
    const payload = await requestApiJson(context, 'comment_page', `${API_ORIGIN}/x/v2/reply/wbi/main?${query}`, signal);
    return parseCommentPage(payload, previousCursor);
  }

  async function readRelation(uid, signal) {
    const subjectUid = normalizeDecimalId(uid, 'relation subject UID');
    const context = await getContext();
    const account = await getVerifiedAccount(context, signal);
    const query = buildBilibiliWbiQuery({ mid: subjectUid }, account.mixinKey, getNow(nowMs));
    const payload = await requestApiJson(
      context,
      'relation',
      `${API_ORIGIN}/x/space/wbi/acc/relation?${query}`,
      signal,
    );
    const relation = payload.data?.be_relation;
    let attribute = null;
    if (relation && hasOwn(relation, 'attribute')) {
      attribute = Number.isSafeInteger(relation.attribute) ? relation.attribute : null;
    }
    return relationResult({
      attribute,
      ownerUid: account.ownerUid,
      subjectUid,
      checkedAtMs: getNow(nowMs),
    });
  }

  return { inspectDynamic, verifyOwner, readPage, readReactions, readRelation };
}

module.exports = { LotteryProviderError, createLotteryProvider };

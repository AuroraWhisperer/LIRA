'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeDynamicLink,
} = require('../src/bilibili/dynamic-lottery/link');
const {
  createLotteryProvider,
} = require('../src/bilibili/dynamic-lottery/provider');

const OWNER_UID = '9007199254740993123';
const DYNAMIC_ID = '9007199254740993999';
const IMG_URL =
  'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB_URL =
  'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function redirectResponse(location) {
  return new Response(null, { status: 302, headers: { location } });
}

function navPayload(mid = OWNER_UID) {
  return {
    code: 0,
    data: {
      isLogin: true,
      mid,
      wbi_img: { img_url: IMG_URL, sub_url: SUB_URL },
    },
  };
}

function detailPayload(overrides = {}) {
  return {
    code: 0,
    data: {
      item: {
        id_str: DYNAMIC_ID,
        type: 'DYNAMIC_TYPE_DRAW',
        basic: { comment_id_str: '8123456789012345678', comment_type: 11 },
        modules: {
          module_author: { mid: OWNER_UID, pub_ts: 1_700_000_000 },
        },
        ...overrides,
      },
    },
  };
}

function createFixture(responses, options = {}) {
  const calls = [];
  const queue = [...responses];
  const context = {
    streamerId: '42',
    authorizationEpoch: 3,
    sessionEpoch: 1,
    cookieHeader:
      'DedeUserID=9007199254740993123; SESSDATA=fixture; bili_jct=fixture',
  };
  const request = async (input) => {
    calls.push(input);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(input);
    assert.ok(next, `unexpected request: ${input.kind} ${input.url}`);
    return next;
  };
  const provider = createLotteryProvider({
    request,
    getContext: options.getContext || (async () => ({ ...context })),
    nowMs: options.nowMs || (() => 1_700_000_123_456),
  });
  return { provider, calls, queue, context };
}

test('dynamic link normalization preserves decimal IDs and rejects unsafe origins', () => {
  assert.deepEqual(
    normalizeDynamicLink(`https://t.bilibili.com/${DYNAMIC_ID}?share_source=copy_link`),
    {
      url: `https://t.bilibili.com/${DYNAMIC_ID}`,
      dynamicId: DYNAMIC_ID,
      needsRedirect: false,
    },
  );
  assert.deepEqual(
    normalizeDynamicLink(`https://www.bilibili.com/opus/${DYNAMIC_ID}`),
    {
      url: `https://www.bilibili.com/opus/${DYNAMIC_ID}`,
      dynamicId: DYNAMIC_ID,
      needsRedirect: false,
    },
  );
  assert.deepEqual(normalizeDynamicLink('https://b23.tv/AbC_123'), {
    url: 'https://b23.tv/AbC_123',
    dynamicId: null,
    needsRedirect: true,
  });

  for (const value of [
    'https://bilibili.com.evil.invalid/opus/1',
    'http://127.0.0.1/opus/1',
    'https://user@www.bilibili.com/opus/1',
    'https://www.bilibili.com:444/opus/1',
    'https://space.bilibili.com/1',
    'https://www.bilibili.com/opus/1/extra',
    'https://b23.tv/a/b',
  ]) {
    assert.throws(() => normalizeDynamicLink(value), /dynamic link/i);
  }
});

test('short links are manually resolved without forwarding credentials', async () => {
  const fixture = createFixture([
    redirectResponse(`https://www.bilibili.com/opus/${DYNAMIC_ID}`),
    jsonResponse(navPayload()),
    jsonResponse(detailPayload()),
  ]);

  const result = await fixture.provider.inspectDynamic('https://b23.tv/abc');

  assert.equal(fixture.calls[0].kind, 'dynamic_link_redirect');
  assert.equal(fixture.calls[0].init.redirect, 'manual');
  assert.equal(fixture.calls[0].init.headers.Cookie, undefined);
  assert.equal(result.target.dynamicId, DYNAMIC_ID);
  assert.equal(result.owner.ownerUid, OWNER_UID);
});

test('short links reject an off-list redirect before any credentialed request', async () => {
  const fixture = createFixture([
    redirectResponse('https://example.com/steal'),
  ]);

  await assert.rejects(
    fixture.provider.inspectDynamic('https://b23.tv/abc'),
    (error) => error.code === 'LOTTERY_DYNAMIC_LINK_INVALID',
  );
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].init.headers.Cookie, undefined);
});

test('short links stop after five validated redirects', async () => {
  const fixture = createFixture([
    redirectResponse('https://b23.tv/one'),
    redirectResponse('https://b23.tv/two'),
    redirectResponse('https://b23.tv/three'),
    redirectResponse('https://b23.tv/four'),
    redirectResponse('https://b23.tv/five'),
  ]);

  await assert.rejects(
    fixture.provider.inspectDynamic('https://b23.tv/start'),
    (error) => error.code === 'LOTTERY_DYNAMIC_LINK_INVALID',
  );
  assert.equal(fixture.calls.length, 5);
  assert.ok(
    fixture.calls.every((call) => call.init.headers.Cookie === undefined),
  );
});

test('dynamic inspection verifies the logged-in owner and strict target fields', async () => {
  const fixture = createFixture([
    jsonResponse(navPayload()),
    jsonResponse(detailPayload()),
  ]);

  const result = await fixture.provider.inspectDynamic(
    `https://t.bilibili.com/${DYNAMIC_ID}`,
  );

  assert.deepEqual(result.owner, {
    streamerId: '42',
    ownerUid: OWNER_UID,
    sessionEpoch: 1,
  });
  assert.deepEqual(result.target, {
    dynamicId: DYNAMIC_ID,
    ownerUid: OWNER_UID,
    commentOid: '8123456789012345678',
    commentType: 11,
    publishedAtMs: 1_700_000_000_000,
    capabilities: {
      comment: {
        available: false,
        canEnumerate: false,
        hasEventTime: true,
        reason: 'PENDING_CONTROLLED_VERIFICATION',
      },
      repost: {
        available: false,
        canEnumerate: false,
        hasEventTime: false,
        reason: 'UNVERIFIED_SOURCE',
      },
      like: {
        available: false,
        canEnumerate: false,
        hasEventTime: false,
        reason: 'UNVERIFIED_SOURCE',
      },
      relation: {
        available: false,
        canEnumerate: false,
        hasEventTime: true,
        reason: 'PENDING_CONTROLLED_VERIFICATION',
      },
      threadReplies: {
        available: false,
        canEnumerate: false,
        hasEventTime: false,
        reason: 'UNVERIFIED_SOURCE',
      },
      level: {
        available: false,
        canEnumerate: false,
        hasEventTime: false,
        reason: 'UNVERIFIED_SOURCE',
      },
    },
  });
  assert.equal(fixture.calls.length, 2);
  assert.match(fixture.calls[0].init.headers.Cookie, /SESSDATA=fixture/u);
  assert.match(fixture.calls[1].init.headers.Cookie, /SESSDATA=fixture/u);
});

test('dynamic inspection rejects non-owner and precision-lost numeric IDs', async () => {
  const nonOwner = createFixture([
    jsonResponse(navPayload('123')),
    jsonResponse(detailPayload()),
  ]);
  await assert.rejects(
    nonOwner.provider.inspectDynamic(`https://t.bilibili.com/${DYNAMIC_ID}`),
    (error) => error.code === 'LOTTERY_DYNAMIC_OWNER_MISMATCH',
  );

  const unsafeOwner = createFixture([
    jsonResponse(navPayload()),
    jsonResponse(
      detailPayload({
        modules: {
          module_author: {
            mid: 9_007_199_254_740_999_999,
            pub_ts: 1_700_000_000,
          },
        },
      }),
    ),
  ]);
  await assert.rejects(
    unsafeOwner.provider.inspectDynamic(`https://t.bilibili.com/${DYNAMIC_ID}`),
    (error) => error.code === 'LOTTERY_UPSTREAM_INVALID',
  );
});

test('dynamic inspection rejects a response from a changed session', async () => {
  let contextReads = 0;
  const fixture = createFixture(
    [jsonResponse(navPayload()), jsonResponse(detailPayload())],
    {
      getContext: async () => {
        contextReads += 1;
        return {
          streamerId: '42',
          authorizationEpoch: 3,
          sessionEpoch: contextReads >= 3 ? 2 : 1,
          cookieHeader:
            'DedeUserID=9007199254740993123; SESSDATA=fixture; bili_jct=fixture',
        };
      },
    },
  );

  await assert.rejects(
    fixture.provider.inspectDynamic(`https://t.bilibili.com/${DYNAMIC_ID}`),
    (error) => error.code === 'LOTTERY_SESSION_CHANGED',
  );
});

test('comment pages require an explicit cursor and preserve root evidence', async () => {
  const fixture = createFixture([
    jsonResponse(navPayload()),
    jsonResponse(detailPayload()),
    jsonResponse({
      code: 0,
      data: {
        replies: [
          {
            rpid_str: '7000000000000000001',
            ctime: 1_700_000_010,
            member: {
              mid: '6000000000000000001',
              level_info: { current_level: 5 },
            },
            content: { message: '<img src=x onerror=alert(1)> 参加抽奖' },
            replies: [
              {
                rpid_str: '7000000000000000002',
                ctime: 1_700_000_011,
                member: { mid: '6000000000000000002' },
                content: { message: '楼中楼不参加' },
              },
            ],
          },
        ],
        cursor: {
          is_end: false,
          pagination_reply: { next_offset: 'next-30' },
        },
      },
    }),
  ]);
  const { target } = await fixture.provider.inspectDynamic(
    `https://www.bilibili.com/opus/${DYNAMIC_ID}`,
  );

  const page = await fixture.provider.readPage({
    target,
    source: 'comment',
    cursor: null,
  });

  assert.deepEqual(page, {
    records: [
      {
        source: 'comment',
        recordId: '7000000000000000001',
        uid: '6000000000000000001',
        occurredAtMs: 1_700_000_010_000,
        text: '<img src=x onerror=alert(1)> 参加抽奖',
        parentId: null,
        level: 5,
      },
    ],
    nextCursor: '{"offset":"next-30"}',
    ended: false,
  });
  assert.match(fixture.calls[2].url, /\/x\/v2\/reply\/wbi\/main\?/u);
  assert.match(fixture.calls[2].url, /w_rid=[a-f0-9]{32}/u);
});

test('comment pages reject missing pagination and malformed records', async () => {
  const fixture = createFixture([
    jsonResponse(navPayload()),
    jsonResponse(detailPayload()),
    jsonResponse({ code: 0, data: { replies: [], cursor: {} } }),
  ]);
  const { target } = await fixture.provider.inspectDynamic(
    `https://t.bilibili.com/${DYNAMIC_ID}`,
  );
  await assert.rejects(
    fixture.provider.readPage({ target, source: 'comment', cursor: null }),
    (error) => error.code === 'LOTTERY_UPSTREAM_INVALID',
  );
});

test('relation parsing distinguishes eligible, ineligible, blocked, and unknown', async () => {
  const fixture = createFixture([
    jsonResponse(navPayload()),
    ...[2, 6, 0, 128, 7].map((attribute) =>
      jsonResponse({
        code: 0,
        data: { be_relation: { attribute } },
      }),
    ),
    jsonResponse({ code: 0, data: { be_relation: {} } }),
  ]);

  const states = [];
  for (const uid of ['1', '2', '3', '4', '5', '6']) {
    states.push(await fixture.provider.readRelation(uid));
  }

  assert.deepEqual(
    states.map(({ state, attribute, reason }) => ({ state, attribute, reason })),
    [
      { state: 'eligible', attribute: 2, reason: 'FOLLOWING' },
      { state: 'eligible', attribute: 6, reason: 'MUTUAL_FOLLOW' },
      { state: 'ineligible', attribute: 0, reason: 'NOT_FOLLOWING' },
      { state: 'ineligible', attribute: 128, reason: 'BLOCKED' },
      { state: 'unknown', attribute: 7, reason: 'UNKNOWN_ATTRIBUTE' },
      { state: 'unknown', attribute: null, reason: 'MISSING_ATTRIBUTE' },
    ],
  );
  assert.ok(states.every((state) => state.ownerUid === OWNER_UID));
  assert.ok(states.every((state) => state.checkedAtMs === 1_700_000_123_456));
});

test('business auth failures are not interpreted as an unknown relation', async () => {
  const fixture = createFixture([
    jsonResponse(navPayload()),
    jsonResponse({ code: -101, message: '账号未登录', data: null }),
  ]);

  await assert.rejects(
    fixture.provider.readRelation('123'),
    (error) => error.code === 'LOTTERY_BILIBILI_AUTH_REQUIRED',
  );
});

test('responses larger than four MiB are rejected before parsing', async () => {
  const oversized = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(4 * 1024 * 1024 + 1) }),
    arrayBuffer: async () => {
      throw new Error('body should not be read');
    },
  };
  const fixture = createFixture([oversized]);

  await assert.rejects(
    fixture.provider.inspectDynamic(`https://t.bilibili.com/${DYNAMIC_ID}`),
    (error) => error.code === 'LOTTERY_RESPONSE_TOO_LARGE',
  );
});

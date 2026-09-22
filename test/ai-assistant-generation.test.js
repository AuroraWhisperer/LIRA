'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestService, waitUntil } = require('./helpers/ai-assistant-service-fixture');

test('generation and tool follow-up requests have enough output room for route reasoning and tool JSON', async () => {
  const requests = [];
  const deliveries = [];
  let mainCalls = 0;
  const service = createTestService({
    config: { trigger: 'AI' },
    deepseek: {
      async createResponse(request) {
        requests.push(request);
        if (request.purpose === 'input_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        if (request.purpose === 'output_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":"查到了"}',
            functionCalls: [],
            usage: {},
          };
        }
        mainCalls += 1;
        if (mainCalls === 1) {
          return {
            id: 'tool-round',
            text: '',
            usage: {},
            functionCalls: [
              {
                callId: 'place-1',
                name: 'resolve_location',
                arguments: { address: '白河湿地公园', city: '南阳' },
              },
            ],
          };
        }
        return {
          id: 'answer-round',
          text: '查到了',
          functionCalls: [],
          usage: {},
        };
      },
    },
    tools: {
      qweather: {},
      amap: {
        async resolveLocation() {
          return { location: '112.6,33.0' };
        },
      },
      getCurrentTime: () => ({}),
    },
    sendReply: async (value) => deliveries.push(value),
  });

  service.handleDanmaku({
    uid: '42',
    userName: '哈极光dd_',
    message: 'AI 白河湿地公园附近酒店',
  });
  await waitUntil(() => deliveries.length === 1);

  assert.ok(
    requests
      .filter((request) => ['generation', 'tool_followup'].includes(request.purpose))
      .every((request) => request.maxOutputTokens === 3072),
  );
  assert.ok(
    requests
      .filter((request) => ['input_review', 'output_review'].includes(request.purpose))
      .every((request) => request.maxOutputTokens === 384),
  );
});

test('reasoning-enabled generation gets extra room for thinking and route tool calls', async () => {
  const requests = [];
  const service = createTestService({
    config: { trigger: 'AI', reasoningEnabled: true },
    deepseek: {
      async createResponse(request) {
        requests.push(request);
        if (request.purpose === 'input_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        if (request.purpose === 'output_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":"ok"}',
            functionCalls: [],
            usage: {},
          };
        }
        return { text: 'ok', functionCalls: [], usage: {} };
      },
    },
    tools: { qweather: {}, amap: {}, getCurrentTime: () => ({}) },
    sendReply: async () => {},
  });
  service.handleDanmaku({
    uid: '42',
    userName: 'Alice',
    message: 'AI 太原火车站到机场怎么规划',
  });
  await waitUntil(() => requests.some((request) => request.purpose === 'output_review'));
  assert.equal(requests.find((request) => request.purpose === 'generation').maxOutputTokens, 4096);
});

test('Suzhou route planning keeps a concise useful reply after the route tool round', async () => {
  const deliveries = [];
  let generationCalls = 0;
  const service = createTestService({
    config: { trigger: '\u5c0f\u7c73', reasoningEnabled: true },
    deepseek: {
      async createResponse(request) {
        if (request.purpose === 'input_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        if (request.purpose === 'output_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":"建议乘地铁，约 30 分钟。"}',
            functionCalls: [],
            usage: {},
          };
        }
        generationCalls += 1;
        if (generationCalls === 1) {
          return {
            id: 'suzhou-route',
            text: '',
            functionCalls: [
              {
                callId: 'route-1',
                name: 'get_route',
                arguments: {
                  origin: '\u82cf\u5dde\u91d1\u9e21\u6e56',
                  destination: '\u82cf\u5dde\u56ed\u533a\u7ad9',
                  city: '\u82cf\u5dde',
                  mode: 'transit',
                },
              },
            ],
            usage: {},
          };
        }
        return {
          id: 'suzhou-answer',
          text: '\u5efa\u8bae\u4e58\u5730\u94c1\uff0c\u7ea6 30 \u5206\u949f\u3002',
          functionCalls: [],
          usage: {},
        };
      },
    },
    tools: {
      qweather: {},
      amap: {
        async getRoute() {
          return {
            mode: 'transit',
            distanceMeters: 12000,
            durationSeconds: 1800,
          };
        },
      },
      getCurrentTime: () => ({}),
    },
    sendReply: async (value) => deliveries.push(value),
  });
  service.handleDanmaku({
    uid: 'route-viewer',
    userName: 'Alice',
    message:
      '\u5c0f\u7c73\u5e2e\u6211\u89c4\u5212\u4e00\u4e0b\u82cf\u5dde\u91d1\u9e21\u6e56\u5230\u82cf\u5dde\u56ed\u533a\u7ad9\u7684\u8def\u7ebf',
  });
  await waitUntil(() => deliveries.length === 1);
  assert.equal(deliveries[0].message, '\u5efa\u8bae\u4e58\u5730\u94c1\uff0c\u7ea6 30 \u5206\u949f\u3002');
  assert.ok(Array.from(deliveries[0].message).length < 40);
  assert.doesNotMatch(deliveries[0].message, /\u6682\u65f6|\u65e0\u6cd5/);
});

test('a monthly API quota result makes the next tool round rely on web search', async () => {
  const deliveries = [];
  let mainCalls = 0;
  const service = createTestService({
    config: { trigger: 'AI' },
    deepseek: {
      async createResponse(request) {
        if (!request.tools.length) {
          const isOutputReview = String(request.input).includes('web result');
          return {
            text: isOutputReview
              ? '{"allowed":true,"riskType":"","safeText":"web result"}'
              : '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        mainCalls += 1;
        if (mainCalls === 1) {
          return {
            id: 'tool-round',
            text: '',
            usage: {},
            functionCalls: [{ callId: 'weather-1', name: 'get_weather', arguments: {} }],
          };
        }
        assert.ok(request.tools.some((tool) => tool.type === 'web_search'));
        assert.ok(!request.tools.some((tool) => tool.name === 'get_weather'));
        assert.ok(request.tools.some((tool) => tool.name === 'search_places'));
        assert.match(String(request.input[0].output), /web_search/);
        return {
          id: 'web-round',
          text: 'web result',
          functionCalls: [],
          usage: {},
        };
      },
    },
    tools: {
      qweather: {
        async getWeather() {
          const error = new Error('monthly limit reached');
          error.code = 'QWEATHER_MONTHLY_LIMIT';
          error.quotaCategory = 'qweather';
          throw error;
        },
      },
      amap: {},
      getCurrentTime: () => ({}),
    },
    sendReply: async (value) => deliveries.push(value),
  });

  service.handleDanmaku({
    uid: 'quota-user',
    userName: 'Alice',
    message: 'AI weather',
  });
  await waitUntil(() => deliveries.length === 1);
  assert.equal(deliveries[0].message, 'web result');
});

test('model requests identify review, generation, and output review stages', async () => {
  const purposes = [];
  const deliveries = [];
  const service = createTestService({
    deepseek: {
      async createResponse(request) {
        purposes.push(request.purpose);
        if (request.purpose === 'input_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        if (request.purpose === 'output_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":"回答"}',
            functionCalls: [],
            usage: {},
          };
        }
        return { text: '回答', functionCalls: [], usage: {} };
      },
    },
    sendReply: async (value) => deliveries.push(value),
  });

  service.handleDanmaku({ uid: '42', userName: 'Alice', message: '小米 问题' });
  await waitUntil(() => deliveries.length === 1);

  assert.deepEqual(purposes, ['input_review', 'generation', 'output_review']);
});

test('output review receives the original question and can replace an off-target interrogation', async () => {
  const deliveries = [];
  let outputReviewInput = '';
  let outputReviewInstructions = '';
  const service = createTestService({
    config: { trigger: 'AI' },
    deepseek: {
      async createResponse(request) {
        if (request.purpose === 'input_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        if (request.purpose === 'output_review') {
          outputReviewInput = String(request.input);
          outputReviewInstructions = String(request.instructions);
          return {
            text: '{"allowed":true,"riskType":"","safeText":"给你三首低缓情歌，每首都走轻柔路线。"}',
            functionCalls: [],
            usage: {},
          };
        }
        return {
          text: '你喜欢男声还是女声？想听哪个年代？还有偏好的歌手吗？',
          functionCalls: [],
          usage: {},
        };
      },
    },
    sendReply: async (value) => deliveries.push(value),
  });

  service.handleDanmaku({
    uid: 'recommend-user',
    userName: 'Alice',
    message: 'AI 推荐几首舒缓低缓的情歌',
  });
  await waitUntil(() => deliveries.length === 1);

  assert.match(outputReviewInput, /推荐几首舒缓低缓的情歌/);
  assert.match(outputReviewInput, /男声还是女声/);
  assert.match(outputReviewInstructions, /安全与质量校验/);
  assert.equal(deliveries[0].message, '给你三首低缓情歌，每首都走轻柔路线。');
});

test('official-chat web search calls are executed and returned to the model', async () => {
  const deliveries = [];
  let generationCalls = 0;
  const service = createTestService({
    config: { trigger: 'AI' },
    deepseek: {
      async createResponse(request) {
        if (request.purpose === 'input_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":""}',
            functionCalls: [],
            usage: {},
          };
        }
        if (request.purpose === 'output_review') {
          return {
            text: '{"allowed":true,"riskType":"","safeText":"已核实"}',
            functionCalls: [],
            usage: {},
          };
        }
        generationCalls += 1;
        if (generationCalls === 1) {
          return {
            id: 'search-1',
            text: '',
            functionCalls: [
              {
                callId: 'search-call',
                name: 'web_search',
                arguments: { query: '郑州演唱会' },
              },
            ],
            usage: {},
          };
        }
        assert.match(String(request.input[0].output), /郑州演唱会/);
        return {
          id: 'answer-1',
          text: '查到最新演唱会信息。',
          functionCalls: [],
          usage: {},
        };
      },
    },
    tools: {
      qweather: {},
      amap: {},
      webSearch: {
        async search(_config, input) {
          return { query: input.query, results: [{ title: '郑州演唱会' }] };
        },
      },
      getCurrentTime: () => ({}),
    },
    sendReply: async (value) => deliveries.push(value),
  });
  service.handleDanmaku({
    uid: 'search-user',
    userName: 'Alice',
    message: 'AI 查一下郑州演唱会',
  });
  await waitUntil(() => deliveries.length === 1);
  assert.equal(deliveries[0].message, '已核实');
});

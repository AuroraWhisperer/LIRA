'use strict';

const { randomUUID } = require('node:crypto');
const { SAFE_REFUSAL, DOUBAO_CHAT_POLICY, checkLocalInput, buildInputReviewPrompt,
  buildOutputReviewPrompt, parseSafetyReview } = require('./safety');
const { getQuotaToolNames } = require('./api-quota-store');
const { resolvePersona } = require('./personas');
const { getCurrentTime } = require('./tools/current-time-tool');
const { normalizeConversationContext } = require('./conversation-context');
const { buildAvailableTools, buildConversationInput, buildReplyInstructions, getReplyLengthBudget,
  cleanModelText, truncateReply, addUsage, getModelOutputTokens, codedError, isShutdownError,
  failureReply } = require('./ai-assistant-helpers');

const REVIEW_OUTPUT_TOKENS = 384;

function createAiReplyGenerator({ store, modelClient, tools, quotaStore, now, onError }) {
  function createTurn({ uid, roomId, userName, question, localRefusal, modelSessionRevision }) {
    const canRemember = Boolean(roomId && uid && !uid.startsWith('name:'));
    const endConversation = /^(?:结束对话|清空对话)[。！!？?\s]*$/u.test(question);
    let persona;
    let personaScope;
    let conversationInitialized = false;
    let conversationContext;
    let conversationSessionId;

    async function generateReply(options) {
      const { signal, assertCurrent } = options;
      const startedAt = now();
      const config = store.getConfig();
      const accountChat = config.modelProvider === 'doubao';
      if (localRefusal) {
        return {
          text: localRefusal,
          category: 'safety',
          usage: {},
          toolCalls: 0,
        };
      }
      const usage = { inputTokens: 0, outputTokens: 0 };
      let toolCallCount = 0;
      try {
        persona ||= resolvePersona(config);
        personaScope = JSON.stringify([roomId, persona.id, persona.prompt]);
        if (endConversation) {
          if (canRemember) store.clearContext(uid, personaScope);
          return { text: '这段对话结束啦，下次叫我会重新开始～', category: 'conversation_reset', usage, toolCalls: 0 };
        }
        if (!conversationInitialized) {
          conversationContext = canRemember ? normalizeConversationContext(store.getContext(uid, personaScope)) : null;
          conversationInitialized = true;
        }
        const context = conversationContext;
        conversationSessionId ||= context?.sessionId || randomUUID();
        const input = buildConversationInput(question, context);
        const excludedToolNames = new Set(quotaStore?.getExcludedToolNames?.() || []);
        // The store persists only the key hash, not config secrets or context text.
        const cacheKey = JSON.stringify([
          'reply-v7',
          config,
          modelSessionRevision,
          personaScope,
          uid,
          userName,
          question,
          input,
          [...excludedToolNames].sort(),
        ]);
        const cached = options.bypassCache ? null : store.getCache(cacheKey);
        if (cached?.text) {
          return { ...cached, category: 'cache' };
        }
        if (!accountChat) {
          const inputReview = await runSafetyReview(config, buildInputReviewPrompt(input), usage, 'input_review', signal);
          assertCurrent();
          if (!inputReview.allowed) {
            return { text: SAFE_REFUSAL, category: 'safety', usage, toolCalls: 0 };
          }
        }

        const currentTime = getCurrentTime({}, { now: new Date(now()) }).formatted;
        const replyBudget = getReplyLengthBudget(userName, config.replyMaxChars);
        const replyLimit = options.singleMessage ? replyBudget.oneMessage : replyBudget.threeMessages;
        let response = await modelClient.createResponse({
          config,
          instructions: buildReplyInstructions(
            persona.prompt,
            config.replyMaxChars,
            buildAvailableTools(config, excludedToolNames),
            userName,
            currentTime,
            options.singleMessage,
          ) + (accountChat ? `\n${DOUBAO_CHAT_POLICY}` : ''),
          input,
          tools: buildAvailableTools(config, excludedToolNames),
          maxOutputTokens: getModelOutputTokens(config),
          purpose: 'generation',
          ...(accountChat ? { conversationKey: JSON.stringify([uid, personaScope, conversationSessionId]) } : {}),
          signal: signal,
        });
        assertCurrent();
        addUsage(usage, response.usage);

        while (response.functionCalls.length) {
          if (toolCallCount + response.functionCalls.length > config.maxToolCalls) {
            throw codedError('TOOL_LIMIT', '工具调用次数太多，这次先不继续查了。');
          }
          const outputs = [];
          for (const call of response.functionCalls) {
            const result = await executeToolWithQuotaFallback(call, config, excludedToolNames, signal);
            assertCurrent();
            outputs.push({
              type: 'function_call_output',
              call_id: call.callId,
              output: JSON.stringify(result),
            });
            toolCallCount += 1;
          }
          response = await modelClient.createResponse({
            config,
            instructions: buildReplyInstructions(
              persona.prompt,
              config.replyMaxChars,
              buildAvailableTools(config, excludedToolNames),
              userName,
              currentTime,
              options.singleMessage,
            ),
            input: outputs,
            tools: buildAvailableTools(config, excludedToolNames),
            previousResponseId: response.id,
            maxOutputTokens: getModelOutputTokens(config),
            purpose: 'tool_followup',
            signal: signal,
          });
          assertCurrent();
          addUsage(usage, response.usage);
        }

        const rawText = cleanModelText(response.text);
        let approvedText = rawText;
        if (!accountChat) {
          const outputReview = await runSafetyReview(
            config,
            buildOutputReviewPrompt(question, rawText, input, replyLimit),
            usage,
            'output_review',
            signal,
          );
          assertCurrent();
          if (!outputReview.allowed) return { text: SAFE_REFUSAL, category: 'safety', usage, toolCalls: toolCallCount };
          approvedText = cleanModelText(outputReview.safeText || rawText);
        }
        if (!checkLocalInput(approvedText).allowed || approvedText === SAFE_REFUSAL) {
          return { text: SAFE_REFUSAL, category: 'safety', usage, toolCalls: toolCallCount };
        }
        const text = truncateReply(approvedText, replyLimit);
        const result = {
          text,
          category: toolCallCount ? 'tool' : 'chat',
          usage,
          toolCalls: toolCallCount,
        };
        assertCurrent();
        store.setCache(cacheKey, result, config.cacheTtlSeconds);
        assertCurrent();
        store.logRequest({
          uid,
          userName,
          category: result.category,
          status: 'generated',
          latencyMs: now() - startedAt,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          toolCalls: toolCallCount,
        });
        return result;
      } catch (error) {
        assertCurrent();
        if (isShutdownError(error)) throw error;
        onError(error);
        store.logRequest({
          uid,
          userName,
          category: 'generation',
          status: 'failed',
          latencyMs: now() - startedAt,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          toolCalls: toolCallCount,
          errorCode: String(error?.code || 'GENERATION_FAILED'),
        });
        return {
          text: failureReply(error),
          category: 'failure',
          usage,
          toolCalls: toolCallCount,
        };
      }
    }

    return {
      async generate(options) {
        const result = await generateReply(options);
        return {
          ...result,
          ...(canRemember && conversationInitialized ? { memory: {
            uid, question, personaScope, context: conversationContext, sessionId: conversationSessionId,
          } } : {}),
        };
      },
    };
  }

  async function runSafetyReview(config, prompt, usage, purpose, signal) {
    const response = await modelClient.createResponse({
      config: { ...config, reasoningEnabled: false },
      instructions: prompt.instructions,
      input: prompt.input,
      tools: [],
      maxOutputTokens: REVIEW_OUTPUT_TOKENS,
      purpose,
      signal,
    });
    addUsage(usage, response.usage);
    return parseSafetyReview(response.text);
  }

  async function executeTool(call, config, signal) {
    const options = { signal };
    if (call.name === 'get_weather') return tools.qweather.getWeather(config, call.arguments, options);
    if (call.name === 'search_places') return tools.amap.searchPlaces(config, call.arguments, options);
    if (call.name === 'resolve_location') return tools.amap.resolveLocation(config, call.arguments, options);
    if (call.name === 'get_route') return tools.amap.getRoute(config, call.arguments, options);
    if (call.name === 'web_search') return tools.webSearch.search(config, call.arguments, options);
    throw codedError('UNKNOWN_TOOL', '模型请求了未开放的工具。');
  }

  async function executeToolWithQuotaFallback(call, config, excludedToolNames, signal) {
    const offered = (candidate) => candidate.functionCallingEnabled && buildAvailableTools(candidate, excludedToolNames)
      .some((tool) => (tool.name || tool.type) === call.name);
    if (!offered(config) || !offered(store.getConfig())) {
      excludedToolNames.add(call.name);
      return { unavailable: true, reason: 'tool_unavailable', instruction: '此工具本次不可用，请使用已提供的其他能力，或说明无法核实，不要编造结果。' };
    }
    try {
      return await executeTool(call, config, signal);
    } catch (error) {
      const quotaToolNames = getQuotaToolNames(error);
      if (!quotaToolNames.length) throw error;
      for (const name of quotaToolNames) excludedToolNames.add(name);
      const searchAvailable = [config, store.getConfig()].every((candidate) =>
        buildAvailableTools(candidate, excludedToolNames).some((tool) => tool.type === 'web_search'),
      );
      return {
        unavailable: true,
        reason: 'monthly_api_quota_reached',
        instruction: searchAvailable
          ? '该第三方 API 已达到本月安全用量上限。不要再次调用这个函数，请改用 web_search 回答。'
          : '该第三方 API 已达到本月安全用量上限，当前没有可用的联网搜索。请说明无法核实，并提供一般建议，不要编造实时数据。',
      };
    }
  }

  return { createTurn };
}

module.exports = { createAiReplyGenerator };

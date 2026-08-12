# AI Non-Thinking Answer Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve DeepSeek's direct-answer and recommendation accuracy while keeping thinking disabled and limiting the editable persona preset to tone rather than question interpretation.

**Architecture:** Keep the existing request pipeline and its existing input/output review calls. Add a non-editable runtime task policy after the persona preset, then give the existing output reviewer both the original question and candidate answer so it can correct off-target recommendations or unnecessary follow-up questions without another model request.

**Tech Stack:** Node.js 24, CommonJS, `node:test`, DeepSeek Chat/Responses adapters.

## Global Constraints

- Keep `reasoningEnabled: false` behavior unchanged: Responses uses `reasoning.effort = 'none'` and Chat Completions uses `thinking.type = 'disabled'`.
- Persona controls wording, warmth, and character only; it must not change the user's intent, explicit constraints, facts, tool choice, or recommendation criteria.
- Do not add song-title special cases or new dependencies.
- Do not add another model call; reuse the existing output review call.
- Preserve unrelated working-tree changes and do not create a commit unless requested.

---

### Task 1: Add an invariant non-thinking task policy

**Files:**
- Modify: `src/ai/prompt.js`
- Modify: `src/ai/xiaomi-ai-service.js`
- Test: `test/xiaomi-ai-service.test.js`

**Interfaces:**
- Produces: `ANSWER_QUALITY_POLICY` exported by `src/ai/prompt.js`.
- Consumes: `buildReplyInstructions(systemPrompt, replyMaxChars, excludedToolNames, webSearchEnabled, mentionName)` appends the policy after any built-in or custom persona.

- [x] **Step 1: Write the failing policy test**

```js
test('runtime policy keeps persona separate from intent and avoids unnecessary interrogation', () => {
  const instructions = buildReplyInstructions('只影响语气的人格', 50);
  assert.match(instructions, /人格预设只影响语气和措辞/);
  assert.match(instructions, /不得改变用户问题的含义/);
  assert.match(instructions, /信息足够时直接回答/);
  assert.match(instructions, /最多只问一个澄清问题/);
  assert.match(instructions, /明确条件都视为硬约束/);
  assert.match(instructions, /不展示分析过程/);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/xiaomi-ai-service.test.js`

Expected: FAIL because the runtime instructions do not yet contain the invariant policy.

- [x] **Step 3: Add the policy and append it after the persona**

Add an exported `ANSWER_QUALITY_POLICY` in `src/ai/prompt.js` with these exact behavioral requirements:

```js
const ANSWER_QUALITY_POLICY = `人格预设只影响语气、措辞和角色表现，不得改变用户问题的含义、主题、事实、明确条件、工具选择或推荐标准。
使用非思考模式简洁作答：先在内部识别用户真正目标和明确条件，不展示分析过程。信息足够时直接回答，不要用连续追问拖延；只有缺少一个会实质改变答案的关键条件时才澄清，而且一次最多只问一个问题。能够采用常见且安全的默认口径时，简短说明口径后直接给答案。
推荐任务中，用户给出的类型、情绪、节奏、音域或难度、场景、预算、地点和排除项都视为硬约束。默认给出 2–3 个最匹配选项并用短语说明匹配点；逐项核对所有硬约束，宁可少给也不要用知名但不匹配的选项凑数。不确定的属性不要编造。当前问题的明确要求优先于短期上下文，短期上下文只能补全省略信息。`;
```

Include it in the new default `SYSTEM_PROMPT`, and append it from `buildReplyInstructions()` after `systemPrompt` so existing stored and custom personas receive the invariant policy without overwriting their saved text.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/xiaomi-ai-service.test.js`

Expected: all tests pass.

---

### Task 2: Make the existing output review check answer fit

**Files:**
- Modify: `src/ai/safety.js`
- Modify: `src/ai/xiaomi-ai-service.js`
- Create: `test/ai-safety.test.js`
- Test: `test/xiaomi-ai-service.test.js`

**Interfaces:**
- Changes: `buildOutputReviewPrompt(question, candidateAnswer)` replaces `buildOutputReviewPrompt(candidateAnswer)`.
- The JSON review schema remains `{ allowed, riskType, safeText }` so downstream parsing is unchanged.

- [x] **Step 1: Write the failing output-review unit test**

```js
test('output review compares the candidate with the original question', () => {
  const prompt = buildOutputReviewPrompt(
    '推荐几首舒缓的情歌',
    '你喜欢男声还是女声？你想听哪个年代？'
  );
  assert.match(prompt, /推荐几首舒缓的情歌/);
  assert.match(prompt, /男声还是女声/);
  assert.match(prompt, /逐项满足用户明确条件/);
  assert.match(prompt, /不必要的追问/);
  assert.match(prompt, /不得改变已有的确定事实/);
});
```

- [x] **Step 2: Run the unit test and verify it fails**

Run: `node --test test/ai-safety.test.js`

Expected: FAIL because the current function accepts only the candidate answer and performs safety review only.

- [x] **Step 3: Extend the review prompt without adding a model call**

Change `buildOutputReviewPrompt` to include separately JSON-encoded `question` and `candidateAnswer`. Tell the reviewer to preserve safe, accurate content; remove recommendations that violate explicit constraints; replace unnecessary follow-up questions with a direct useful answer when the question is already answerable; avoid inventing facts or recommendation attributes; and never alter confirmed numbers, names, times, or tool results merely for style.

Change the service call to:

```js
buildOutputReviewPrompt(item.question, rawText)
```

- [x] **Step 4: Add a service regression test for the review handoff**

Create a mocked generation response that only asks multiple follow-up questions. Capture the `output_review` request and assert that it contains both the original recommendation request and the candidate answer; return a corrected `safeText` and assert that the delivered reply uses it.

- [x] **Step 5: Run focused validation**

Run: `node --test test/ai-safety.test.js test/xiaomi-ai-service.test.js test/ai-provider-adapters.test.js`

Expected: all tests pass, including the existing assertions that thinking remains disabled.

- [x] **Step 6: Run repository validation**

Run: `npm run check`

Expected: syntax checks pass.

Run: `npm test`

Expected: full serial test suite passes.

---

## Self-Review

- Spec coverage: non-thinking remains disabled; persona/task separation, fewer questions, constraint-aware recommendations, and output correction all have implementation and tests.
- Placeholder scan: no deferred implementation or unspecified error handling remains.
- Interface consistency: `buildOutputReviewPrompt(question, candidateAnswer)` is used consistently by the service and test; `ANSWER_QUALITY_POLICY` is appended by `buildReplyInstructions`.

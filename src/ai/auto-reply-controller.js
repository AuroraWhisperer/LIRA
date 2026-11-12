'use strict';

const WINDOW_MS = 30000;
const CANDIDATE_MS = 12000;
const MERGE_MS = 600;
const WAIT_MS = 2500;
const EVALUATION_INTERVAL_MS = 5000;
const REPLY_INTERVAL_MS = 15000;

function createAutoReplyController({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, canRun, enqueue }) {
  let roomId = '';
  let sessionKey;
  let hasSession = false;
  let messages = [];
  let botReplies = [];
  const seen = new Map();
  let nextId = 1;
  let consumedThrough = 0;
  let pending = null;
  let timer = null;
  let disposed = false;
  let lastEvaluationAt = -Infinity;
  let lastSubmittedAt = -Infinity;

  function clearScheduled() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(at) {
    clearScheduled();
    timer = setTimer(() => { timer = null; tick(); }, Math.max(0, at - now()));
    timer?.unref?.();
  }

  function prune() {
    const cutoff = now() - WINDOW_MS;
    messages = messages.filter(message => message.receivedAt > cutoff).slice(-40);
    botReplies = botReplies.filter(reply => reply.sentAt > cutoff).slice(-8);
    for (const [key, entry] of seen) if (entry.receivedAt <= cutoff) seen.delete(key);
  }

  function observe(event = {}) {
    if (disposed) return { accepted: false, reason: 'stopped' };
    const text = String(event.message || '').trim();
    const eventRoom = String(event.roomId || '').trim();
    const uid = String(event.uid || '').trim();
    const timestamp = parseTimestamp(event.messageTimestamp);
    if (event.source !== 'danmaku' || !eventRoom || !uid || !text) return { accepted: false, reason: 'auto_ineligible' };
    if (timestamp !== null && (!Number.isFinite(timestamp) || timestamp < now() - WINDOW_MS || timestamp > now() + 5000)) {
      return { accepted: false, reason: 'auto_stale' };
    }
    if (roomId !== eventRoom || (hasSession && sessionKey !== event.sessionKey)) reset();
    roomId = eventRoom;
    sessionKey = event.sessionKey;
    hasSession = true;
    try { assertSession(event); } catch { reset(); return { accepted: false, reason: 'session_changed' }; }
    prune();
    const key = JSON.stringify([uid, text, timestamp]);
    const previous = seen.get(key);
    if (previous && (timestamp !== null || now() - previous.receivedAt < 2000)) {
      return { accepted: false, reason: 'auto_duplicate' };
    }
    seen.delete(key);
    seen.set(key, { receivedAt: now() });
    if (seen.size > 200) seen.delete(seen.keys().next().value);
    const message = {
      id: String(nextId++), uid, userName: [...String(event.userName || '观众').trim()].slice(0, 80).join(''),
      text: [...text].slice(0, 200).join(''), receivedAt: now(), event,
    };
    messages.push(message);
    if (messages.length > 40) messages.shift();
    if (pending?.participants.has(uid)) pending.latestByUid.set(uid, Number(message.id));
    if (!pending) startNext();
    else if (pending.waitUid === uid) schedule(now());
    return { accepted: true, reason: 'auto_buffered' };
  }

  function startNext() {
    if (disposed || pending) return;
    prune();
    let available = messages.filter(message => Number(message.id) > consumedThrough);
    if (!available.length) return;
    const readyAt = Math.max(lastEvaluationAt + EVALUATION_INTERVAL_MS, lastSubmittedAt + REPLY_INTERVAL_MS);
    if (now() < readyAt) { schedule(readyAt); return; }
    const afterCooldown = available[0].receivedAt < readyAt;
    if (afterCooldown) {
      const latest = available.at(-1);
      if (now() - latest.receivedAt >= CANDIDATE_MS) {
        consumedThrough = Number(latest.id);
        return;
      }
      // Cooldown collects chat, not an ageing draft. Start with the newest batch.
      available = available.filter(message => message.receivedAt >= latest.receivedAt - MERGE_MS);
      consumedThrough = Number(available[0].id) - 1;
    }
    for (const first of available) {
      const firstAt = afterCooldown ? now() : first.receivedAt;
      const dueAt = Math.max(now(), first.receivedAt + MERGE_MS);
      if (dueAt >= firstAt + CANDIDATE_MS) {
        consumedThrough = Number(first.id);
        continue;
      }
      try { assertSession(first.event); } catch { reset(); return; }
      let replySession;
      try { replySession = first.event.captureReplySession?.(); } catch (error) { replySession = Promise.reject(error); }
      pending = {
        firstAt, expiresAt: firstAt + CANDIDATE_MS,
        startId: Number(first.id), endId: Number(first.id), attempts: 0, event: first.event,
        controller: new AbortController(), participants: new Set(), latestByUid: new Map(),
        replySession: Promise.resolve(replySession).then(assert => ({ assert }), error => ({ error })),
        job: null, waitUid: '', waitAfterId: 0, submitted: false,
      };
      schedule(dueAt);
      return;
    }
  }

  function finish(candidate) {
    if (pending !== candidate) return;
    clearScheduled();
    consumedThrough = Math.max(consumedThrough, candidate.endId);
    pending = null;
    startNext();
  }

  function tick() {
    if (disposed) return;
    const candidate = pending;
    if (!candidate) { startNext(); return; }
    if (candidate.submitted) return;
    try { assertSession(candidate.event); } catch { reset(); return; }
    if (now() >= candidate.expiresAt) {
      candidate.controller.abort(cancelledError());
      finish(candidate);
      return;
    }
    if (candidate.job) { schedule(candidate.expiresAt); return; }
    if (candidate.waitUid) {
      if (now() >= candidate.firstAt + WAIT_MS) { finish(candidate); return; }
      if ((candidate.latestByUid.get(candidate.waitUid) || 0) <= candidate.waitAfterId) {
        schedule(candidate.firstAt + WAIT_MS);
        return;
      }
    }
    const ready = canRun();
    if (pending !== candidate) return;
    if (!ready) {
      schedule(Math.min(now() + 250, candidate.waitUid ? candidate.firstAt + WAIT_MS : candidate.expiresAt));
      return;
    }
    prune();
    const selected = messages.filter(message => Number(message.id) >= candidate.startId && Number(message.id) > consumedThrough);
    if (!selected.length) { finish(candidate); return; }
    const snapshot = {
      roomId,
      messages: selected.map(({ event, ...message }) => message),
      contextMessages: messages.filter(message => Number(message.id) < Number(selected[0].id))
        .map(({ event, ...message }) => message),
      botReplies: botReplies.map(reply => ({ ...reply })),
      waitAllowed: candidate.attempts === 0 && now() < candidate.firstAt + WAIT_MS,
    };
    const endId = Number(selected.at(-1).id);
    for (const message of selected) {
      candidate.participants.add(message.uid);
      candidate.latestByUid.set(message.uid, Number(message.id));
    }
    let completed = false;
    let lastTarget = null;
    const job = {
      snapshot,
      signal: candidate.controller.signal,
      replySession: candidate.replySession,
      assertFresh(targetMessageId = null) {
        candidate.controller.signal.throwIfAborted();
        assertSession(candidate.event);
        if (candidate.submitted) return;
        lastTarget = targetMessageId;
        const target = targetMessageId === null ? null : snapshot.messages.find(message => message.id === targetMessageId);
        const relevantUids = target ? [target.uid] : snapshot.messages.map(message => message.uid);
        if (pending !== candidate || now() >= candidate.expiresAt || (targetMessageId !== null && !target)
          || relevantUids.some(uid => (candidate.latestByUid.get(uid) || 0) > endId)) {
          throw Object.assign(new Error('自动接话候选已过期或有新的补充。'), { code: 'AI_AUTO_STALE' });
        }
      },
      markSubmitted() {
        job.assertFresh(lastTarget);
        candidate.submitted = true;
        lastSubmittedAt = now();
        clearScheduled();
      },
      complete(result = {}) {
        if (completed) return;
        completed = true;
        if (pending !== candidate) return;
        candidate.job = null;
        if (result.reason === 'AI_AUTO_INPUT_BLOCKED') {
          const rejectedIds = new Set([...snapshot.contextMessages, ...snapshot.messages].map(message => message.id));
          messages = messages.filter(message => !rejectedIds.has(message.id));
          botReplies = botReplies.filter(reply => !snapshot.botReplies.some(reviewed =>
            reviewed.sentAt === reply.sentAt && reviewed.text === reply.text));
        }
        if (candidate.submitted || candidate.controller.signal.aborted) { finish(candidate); return; }
        if (result.action === 'wait' && candidate.attempts < 2 && now() < candidate.firstAt + WAIT_MS) {
          const target = snapshot.messages.find(message => message.id === result.targetMessageId);
          if (target) {
            candidate.waitUid = target.uid;
            candidate.waitAfterId = endId;
            schedule(now());
            return;
          }
        }
        if (result.error?.code === 'AI_AUTO_STALE' && candidate.attempts < 2 && now() < candidate.expiresAt) {
          candidate.waitUid = '';
          schedule(now());
          return;
        }
        finish(candidate);
      },
    };
    candidate.job = job;
    candidate.waitUid = '';
    candidate.endId = endId;
    let accepted;
    try { accepted = enqueue(job); } catch { finish(candidate); return; }
    if (!accepted) {
      candidate.job = null;
      schedule(Math.min(now() + 250, candidate.expiresAt));
      return;
    }
    candidate.attempts += 1;
    lastEvaluationAt = now();
    schedule(candidate.expiresAt);
  }

  function interrupt() {
    consumedThrough = nextId - 1;
    clearScheduled();
    if (!pending || pending.submitted) return;
    pending.controller.abort(cancelledError());
    pending = null;
  }

  function reset() {
    clearScheduled();
    pending?.controller.abort(cancelledError());
    pending = null;
    messages = [];
    botReplies = [];
    seen.clear();
    roomId = '';
    sessionKey = undefined;
    hasSession = false;
    consumedThrough = nextId - 1;
    lastEvaluationAt = -Infinity;
    lastSubmittedAt = -Infinity;
  }

  function rememberReply(reply) {
    if (disposed || !reply.text || !reply.roomId || (roomId && roomId !== reply.roomId)) return;
    roomId = reply.roomId;
    botReplies.push({ text: String(reply.text), sentAt: reply.sentAt ?? now(),
      targetUid: reply.targetUid || null, targetUserName: reply.targetUserName || '',
      question: [...String(reply.question || '')].slice(0, 200).join('') });
    prune();
  }

  return { observe, interrupt, reset, rememberReply, dispose() { disposed = true; reset(); } };
}

function assertSession(event) {
  if (event.isSessionCurrent?.() === false) {
    throw Object.assign(new Error('弹幕会话已变更。'), { code: 'DANMAKU_SESSION_CHANGED' });
  }
}

function cancelledError() {
  return Object.assign(new Error('自动接话已取消。'), { code: 'AI_AUTO_CANCELLED' });
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/u.test(String(value))) {
    const numeric = Number(value);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  return Date.parse(value);
}

module.exports = { createAutoReplyController };

'use strict';

const DYNAMIC_LOTTERY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS lottery_tasks (
    id TEXT PRIMARY KEY,
    streamer_id TEXT NOT NULL,
    owner_uid TEXT NOT NULL,
    dynamic_id TEXT NOT NULL,
    target_json TEXT NOT NULL,
    rules_json TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    request_id TEXT NOT NULL DEFAULT '',
    active_scan_id TEXT,
    previous_task_id TEXT,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_tasks_create_request
    ON lottery_tasks(streamer_id, request_id)
    WHERE request_id != '';
  CREATE INDEX IF NOT EXISTS idx_lottery_tasks_owner_updated
    ON lottery_tasks(streamer_id, updated_at_ms DESC, id);

  CREATE TABLE IF NOT EXISTS lottery_scans (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES lottery_tasks(id) ON DELETE CASCADE,
    session_epoch INTEGER NOT NULL CHECK (session_epoch >= 0),
    status TEXT NOT NULL,
    source_state_json TEXT NOT NULL,
    read_count INTEGER NOT NULL DEFAULT 0 CHECK (read_count >= 0),
    pause_reason TEXT NOT NULL DEFAULT '',
    started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
    completed_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
  );

  CREATE INDEX IF NOT EXISTS idx_lottery_scans_task_started
    ON lottery_scans(task_id, started_at_ms DESC, id);

  CREATE TABLE IF NOT EXISTS lottery_evidence (
    scan_id TEXT NOT NULL REFERENCES lottery_scans(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    record_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    occurred_at_ms INTEGER,
    text TEXT,
    parent_id TEXT,
    level INTEGER,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    PRIMARY KEY (scan_id, source, record_id)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_lottery_evidence_scan_uid
    ON lottery_evidence(scan_id, uid, source, record_id);

  CREATE TABLE IF NOT EXISTS lottery_rounds (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES lottery_tasks(id) ON DELETE CASCADE,
    scan_id TEXT NOT NULL REFERENCES lottery_scans(id),
    rules_json TEXT NOT NULL,
    member_digest TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    current_order_id TEXT,
    result_version INTEGER NOT NULL DEFAULT 0 CHECK (result_version >= 0),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
  );

  CREATE INDEX IF NOT EXISTS idx_lottery_rounds_task_created
    ON lottery_rounds(task_id, created_at_ms DESC, id);

  CREATE TABLE IF NOT EXISTS lottery_round_members (
    round_id TEXT NOT NULL REFERENCES lottery_rounds(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,
    evidence_source TEXT NOT NULL,
    evidence_record_id TEXT NOT NULL,
    qualification_state TEXT NOT NULL DEFAULT 'unverified',
    qualification_reason TEXT NOT NULL DEFAULT '',
    checked_at_ms INTEGER,
    PRIMARY KEY (round_id, uid)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS lottery_orders (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES lottery_rounds(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    kind TEXT NOT NULL,
    request_id TEXT NOT NULL,
    order_json TEXT NOT NULL,
    next_index INTEGER NOT NULL DEFAULT 0 CHECK (next_index >= 0),
    status TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    UNIQUE (round_id, scope, generation)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_orders_request
    ON lottery_orders(round_id, request_id);

  CREATE TABLE IF NOT EXISTS lottery_awards (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES lottery_rounds(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES lottery_orders(id),
    prize_id TEXT NOT NULL,
    prize_label TEXT NOT NULL,
    slot_index INTEGER NOT NULL CHECK (slot_index >= 0),
    uid TEXT NOT NULL,
    status TEXT NOT NULL,
    verification_json TEXT NOT NULL,
    drawn_at_ms INTEGER NOT NULL CHECK (drawn_at_ms >= 0),
    published_at_ms INTEGER,
    claim_deadline_ms INTEGER,
    replaced_award_id TEXT REFERENCES lottery_awards(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    UNIQUE (round_id, prize_id, uid)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_awards_active_slot
    ON lottery_awards(round_id, prize_id, slot_index)
    WHERE active = 1;

  CREATE TABLE IF NOT EXISTS lottery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_id TEXT NOT NULL,
    task_id TEXT REFERENCES lottery_tasks(id) ON DELETE CASCADE,
    round_id TEXT REFERENCES lottery_rounds(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    request_id TEXT NOT NULL DEFAULT '',
    request_hash TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_events_request
    ON lottery_events(streamer_id, request_id)
    WHERE request_id != '';

  CREATE TABLE IF NOT EXISTS lottery_request_budget (
    scope_key TEXT PRIMARY KEY,
    request_times_json TEXT NOT NULL DEFAULT '[]',
    consecutive_count INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_count >= 0),
    last_finished_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (last_finished_at_ms >= 0),
    earliest_resume_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (earliest_resume_at_ms >= 0),
    hold_reason TEXT NOT NULL DEFAULT '',
    rate_limit_strikes INTEGER NOT NULL DEFAULT 0 CHECK (rate_limit_strikes >= 0),
    updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (updated_at_ms >= 0)
  );
`;

module.exports = { DYNAMIC_LOTTERY_SCHEMA };

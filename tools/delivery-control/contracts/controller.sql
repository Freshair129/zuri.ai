-- Repository-local v4 delivery controller state. This database lives in the
-- private Git common directory, never in an application database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS controller_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS delivery_runs (
  task_id TEXT PRIMARY KEY,
  worktree_root TEXT NOT NULL,
  objective TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  task_json TEXT NOT NULL,
  trusted_mandate_json TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  initial_head_commit TEXT NOT NULL,
  initial_snapshot_digest TEXT NOT NULL,
  proof_scope_json TEXT NOT NULL,
  changed_paths_json TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  state TEXT NOT NULL,
  current_cycle INTEGER NOT NULL,
  candidate_head_commit TEXT,
  candidate_snapshot_digest TEXT,
  root_integration_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS delivery_cycles (
  task_id TEXT NOT NULL REFERENCES delivery_runs(task_id),
  cycle_no INTEGER NOT NULL,
  state TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  admission_reason TEXT,
  admission_evidence_json TEXT,
  started_at TEXT,
  paused_at TEXT,
  submissions INTEGER NOT NULL DEFAULT 0,
  implementation_repairs INTEGER NOT NULL DEFAULT 0,
  tool_retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, cycle_no)
) STRICT;

CREATE TABLE IF NOT EXISTS delivery_nodes (
  task_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  role TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  repair_round INTEGER NOT NULL DEFAULT 0,
  input_digest TEXT NOT NULL,
  required_head_commit TEXT,
  required_snapshot_digest TEXT,
  candidate_head_commit TEXT,
  candidate_snapshot_digest TEXT,
  session_id TEXT,
  model TEXT,
  effort TEXT,
  backend_ref TEXT,
  result_digest TEXT,
  evidence_json TEXT,
  effect_state TEXT NOT NULL DEFAULT 'NONE',
  failure_class TEXT,
  dispatch_operation_id TEXT,
  dispatch_input_digest TEXT,
  lease_owner TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, cycle_no, node_id),
  FOREIGN KEY(task_id, cycle_no) REFERENCES delivery_cycles(task_id, cycle_no)
) STRICT;

CREATE INDEX IF NOT EXISTS delivery_nodes_ready_idx ON delivery_nodes(state, stage);

CREATE TABLE IF NOT EXISTS delivery_write_locks (
  task_id TEXT NOT NULL REFERENCES delivery_runs(task_id),
  scope_path TEXT NOT NULL,
  PRIMARY KEY(task_id, scope_path)
) STRICT;

CREATE INDEX IF NOT EXISTS delivery_write_locks_path_idx ON delivery_write_locks(scope_path);

CREATE TABLE IF NOT EXISTS delivery_domain_locks (
  domain_or_feature_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES delivery_runs(task_id)
) STRICT;

CREATE INDEX IF NOT EXISTS delivery_domain_locks_task_idx ON delivery_domain_locks(task_id);

CREATE TABLE IF NOT EXISTS delivery_no_progress (
  task_id TEXT NOT NULL REFERENCES delivery_runs(task_id),
  fingerprint TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  semantic_input_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, fingerprint)
) STRICT;

CREATE TABLE IF NOT EXISTS delivery_unknown_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  state TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  resolution_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(task_id, operation_id),
  FOREIGN KEY(task_id, cycle_no, node_id) REFERENCES delivery_nodes(task_id, cycle_no, node_id)
) STRICT;

CREATE TABLE IF NOT EXISTS delivery_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  cycle_no INTEGER,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE
) STRICT;

CREATE TRIGGER IF NOT EXISTS delivery_events_no_update
BEFORE UPDATE ON delivery_events BEGIN
  SELECT RAISE(ABORT, 'delivery_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS delivery_events_no_delete
BEFORE DELETE ON delivery_events BEGIN
  SELECT RAISE(ABORT, 'delivery_events is append-only');
END;

INSERT OR IGNORE INTO controller_meta(key, value) VALUES ('schemaVersion', 'delivery-controller/v1');
INSERT OR IGNORE INTO controller_meta(key, value) VALUES ('eventChainHead', 'GENESIS');

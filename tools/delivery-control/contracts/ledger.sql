CREATE TABLE ledger_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  ledger_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  head_sequence INTEGER NOT NULL CHECK (head_sequence >= 0),
  head_hash TEXT NOT NULL CHECK (length(head_hash) = 64)
);

CREATE TABLE node_state (
  node_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL CHECK (acceptance_revision >= 1),
  packet_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY','RUNNING','COMPLETED','FAILED','DEFERRED','NEEDS_DECISION','PARKED')),
  version INTEGER NOT NULL CHECK (version >= 1),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  assignment_id TEXT NOT NULL UNIQUE,
  assigned_actor TEXT NOT NULL,
  authority_receipt_ref TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  output_digest TEXT NOT NULL,
  run_disposition TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (node_id, acceptance_revision)
) WITHOUT ROWID;

CREATE TABLE assignments (
  assignment_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  actor TEXT NOT NULL,
  authority_receipt_ref TEXT NOT NULL,
  created_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (node_id, acceptance_revision),
  FOREIGN KEY (node_id, acceptance_revision) REFERENCES node_state(node_id, acceptance_revision)
);

CREATE TABLE canonical_pr (
  node_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL,
  pr_json TEXT NOT NULL,
  observed_receipt_ref TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, acceptance_revision),
  FOREIGN KEY (node_id, acceptance_revision) REFERENCES node_state(node_id, acceptance_revision)
) WITHOUT ROWID;

CREATE TABLE transitions (
  sequence INTEGER PRIMARY KEY CHECK (sequence >= 1),
  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
  current_hash TEXT NOT NULL UNIQUE CHECK (length(current_hash) = 64),
  event_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  event_type TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE requests (
  event_id TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  request_json TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  transition_sequence INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transition_sequence) REFERENCES transitions(sequence)
);

CREATE TABLE request_conflicts (
  original_event_id TEXT NOT NULL,
  conflicting_digest TEXT NOT NULL CHECK (length(conflicting_digest) = 64),
  conflicting_request_json TEXT NOT NULL,
  conflict_event_id TEXT NOT NULL UNIQUE,
  transition_sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (original_event_id, conflicting_digest),
  FOREIGN KEY (transition_sequence) REFERENCES transitions(sequence)
) WITHOUT ROWID;

CREATE TABLE outbox_events (
  event_id TEXT PRIMARY KEY,
  transition_sequence INTEGER NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (transition_sequence) REFERENCES transitions(sequence)
);

CREATE TABLE park_records (
  node_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  mapping_digest TEXT NOT NULL,
  raw_record_json TEXT NOT NULL,
  lifecycle_disposition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, acceptance_revision),
  FOREIGN KEY (node_id, acceptance_revision) REFERENCES node_state(node_id, acceptance_revision),
  FOREIGN KEY (event_id) REFERENCES transitions(event_id)
) WITHOUT ROWID;

CREATE TABLE consumer_inbox (
  consumer_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  application_id TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (consumer_id, event_id),
  FOREIGN KEY (event_id) REFERENCES outbox_events(event_id)
) WITHOUT ROWID;

CREATE TABLE consumer_applications (
  application_id TEXT PRIMARY KEY,
  consumer_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  application_json TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE (consumer_id, event_id),
  FOREIGN KEY (consumer_id, event_id) REFERENCES consumer_inbox(consumer_id, event_id)
);

CREATE TABLE consumer_node_state (
  consumer_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  last_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (consumer_id, node_id, acceptance_revision)
) WITHOUT ROWID;

CREATE TRIGGER transitions_no_update BEFORE UPDATE ON transitions BEGIN SELECT RAISE(ABORT, 'immutable transitions'); END;
CREATE TRIGGER transitions_no_delete BEFORE DELETE ON transitions BEGIN SELECT RAISE(ABORT, 'immutable transitions'); END;
CREATE TRIGGER assignments_no_update BEFORE UPDATE ON assignments BEGIN SELECT RAISE(ABORT, 'immutable assignments'); END;
CREATE TRIGGER assignments_no_delete BEFORE DELETE ON assignments BEGIN SELECT RAISE(ABORT, 'immutable assignments'); END;
CREATE TRIGGER canonical_pr_no_update BEFORE UPDATE ON canonical_pr BEGIN SELECT RAISE(ABORT, 'immutable canonical PR'); END;
CREATE TRIGGER canonical_pr_no_delete BEFORE DELETE ON canonical_pr BEGIN SELECT RAISE(ABORT, 'immutable canonical PR'); END;
CREATE TRIGGER requests_no_update BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT, 'immutable requests'); END;
CREATE TRIGGER requests_no_delete BEFORE DELETE ON requests BEGIN SELECT RAISE(ABORT, 'immutable requests'); END;
CREATE TRIGGER request_conflicts_no_update BEFORE UPDATE ON request_conflicts BEGIN SELECT RAISE(ABORT, 'immutable conflicts'); END;
CREATE TRIGGER request_conflicts_no_delete BEFORE DELETE ON request_conflicts BEGIN SELECT RAISE(ABORT, 'immutable conflicts'); END;
CREATE TRIGGER outbox_no_update BEFORE UPDATE ON outbox_events BEGIN SELECT RAISE(ABORT, 'immutable outbox'); END;
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON outbox_events BEGIN SELECT RAISE(ABORT, 'immutable outbox'); END;
CREATE TRIGGER park_records_no_update BEFORE UPDATE ON park_records BEGIN SELECT RAISE(ABORT, 'immutable PARK records'); END;
CREATE TRIGGER park_records_no_delete BEFORE DELETE ON park_records BEGIN SELECT RAISE(ABORT, 'immutable PARK records'); END;
CREATE TRIGGER consumer_inbox_no_update BEFORE UPDATE ON consumer_inbox BEGIN SELECT RAISE(ABORT, 'immutable consumer inbox'); END;
CREATE TRIGGER consumer_inbox_no_delete BEFORE DELETE ON consumer_inbox BEGIN SELECT RAISE(ABORT, 'immutable consumer inbox'); END;
CREATE TRIGGER consumer_applications_no_update BEFORE UPDATE ON consumer_applications BEGIN SELECT RAISE(ABORT, 'immutable consumer applications'); END;
CREATE TRIGGER consumer_applications_no_delete BEFORE DELETE ON consumer_applications BEGIN SELECT RAISE(ABORT, 'immutable consumer applications'); END;

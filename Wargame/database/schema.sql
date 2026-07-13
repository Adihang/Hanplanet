DROP TABLE IF EXISTS level12_flag;
DROP TABLE IF EXISTS level2_users;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS solves;
DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_instances (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    owner_key_hash TEXT NOT NULL,
    access_token_hash TEXT NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lab_instances_owner_expires
    ON lab_instances(owner_key_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_lab_instances_challenge_expires
    ON lab_instances(challenge_id, expires_at);

CREATE TABLE IF NOT EXISTS lab_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(instance_id) REFERENCES lab_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lab_events_instance_created
    ON lab_events(instance_id, created_at);

CREATE TABLE IF NOT EXISTS completion_tickets (
    ticket_hash TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    owner_key_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    FOREIGN KEY(instance_id) REFERENCES lab_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_completion_tickets_instance
    ON completion_tickets(instance_id);
CREATE INDEX IF NOT EXISTS idx_completion_tickets_owner_expires
    ON completion_tickets(owner_key_hash, expires_at);

CREATE TABLE IF NOT EXISTS mission_dispatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key_hash TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    transport TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE(owner_key_hash, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_mission_dispatches_status_created
    ON mission_dispatches(status, created_at);

INSERT OR IGNORE INTO schema_meta(version, applied_at)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER));

PRAGMA user_version = 1;

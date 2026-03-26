-- Handsync 로컬 SQLite 스키마

CREATE TABLE IF NOT EXISTS files (
    path        TEXT PRIMARY KEY,
    hash        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    version     INTEGER NOT NULL,
    file_id     TEXT NOT NULL,  -- 서버 SyncFile.id (UUID)
    synced_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,   -- UPLOAD / DOWNLOAD / DELETE / MOVE
    path        TEXT NOT NULL,
    old_path    TEXT,            -- MOVE 시 이전 경로
    retry       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);
-- meta 테이블 용도: sync cursor 저장
-- INSERT OR REPLACE INTO meta VALUES ('sync_cursor', '0');

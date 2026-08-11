import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Schema versioning via PRAGMA user_version: each entry runs once, in order,
 * inside a transaction. Append new migrations; never edit shipped ones.
 */
const MIGRATIONS: string[] = [
  // 001 — initial schema (spec §4.2)
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- root_path is relative to the configured libraries root (parent mount).
  CREATE TABLE libraries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    root_path     TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE library_shares (
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (library_id, user_id)
  );
  CREATE INDEX idx_library_shares_user ON library_shares(user_id);

  -- rel_path is relative to the library root; updated if a course dir moves.
  CREATE TABLE courses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    rel_path   TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (library_id, rel_path)
  );

  -- lesson_path is relative to the course dir and is the progress key;
  -- file moves/renames must update it in the same transaction (spec §6.10).
  CREATE TABLE progress (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_path      TEXT NOT NULL,
    completed        INTEGER NOT NULL DEFAULT 0,
    position_seconds REAL NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, course_id, lesson_path)
  );
  CREATE INDEX idx_progress_course ON progress(course_id);

  -- Opaque session IDs; SQLite is the source of truth, the in-memory cache
  -- (auth module) is a write-through accelerator (spec §4.4).
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  `,
];

export type AppDatabase = Database.Database;

export function openDatabase(dataDir: string): AppDatabase {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "courseo.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** In-memory database for tests. */
export function openTestDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: AppDatabase): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

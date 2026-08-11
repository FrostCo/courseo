import type { User } from "@courseo/shared";
import type { AppDatabase } from "./db.js";

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}

export function countUsers(db: AppDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  return row.n;
}

export function getUserById(db: AppDatabase, id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export function getUserByUsername(
  db: AppDatabase,
  username: string,
): UserRow | undefined {
  // username is UNIQUE COLLATE NOCASE, so this lookup is case-insensitive.
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
}

export function createUser(
  db: AppDatabase,
  input: {
    username: string;
    displayName: string;
    passwordHash: string;
    isAdmin: boolean;
  },
): UserRow {
  const result = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, is_admin)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.username,
      input.displayName,
      input.passwordHash,
      input.isAdmin ? 1 : 0,
    );
  return getUserById(db, Number(result.lastInsertRowid))!;
}

export function listUsers(db: AppDatabase): UserRow[] {
  return db
    .prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE")
    .all() as UserRow[];
}

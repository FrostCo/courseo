import argon2 from "argon2";
import { Router } from "express";
import {
  isValidDisplayName,
  isValidPassword,
  isValidUsername,
  type CreateUserRequest,
  type User,
} from "@courseo/shared";
import { requireAdmin, requireAuth } from "./auth.js";
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

// ---------------------------------------------------------------------------
// Routes: /api/users
// ---------------------------------------------------------------------------

export function usersRouter(db: AppDatabase): Router {
  const router = Router();

  // Any authenticated user may list users: library owners (who need not be
  // admins) pick share targets from this list. Public fields only.
  router.get("/", requireAuth, (_req, res) => {
    res.json(listUsers(db).map(toUser));
  });

  router.post("/", requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateUserRequest>;
    const { username, displayName, password } = body;
    if (
      typeof username !== "string" ||
      typeof displayName !== "string" ||
      typeof password !== "string" ||
      !isValidUsername(username) ||
      !isValidDisplayName(displayName) ||
      !isValidPassword(password)
    ) {
      res.status(400).json({ error: "invalid username, display name, or password" });
      return;
    }
    if (getUserByUsername(db, username)) {
      res.status(409).json({ error: "username already taken" });
      return;
    }
    const row = createUser(db, {
      username,
      displayName: displayName.trim(),
      passwordHash: await argon2.hash(password),
      isAdmin: body.isAdmin === true,
    });
    res.status(201).json(toUser(row));
  });

  return router;
}

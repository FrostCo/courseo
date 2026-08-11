import argon2 from "argon2";
import { Router } from "express";
import {
  isValidDisplayName,
  isValidPassword,
  isValidUsername,
  type CreateUserRequest,
  type UpdateUserRequest,
  type User,
} from "@courseo/shared";
import { requireAdmin, requireAuth, type SessionStore } from "./auth.js";
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

export function usersRouter(db: AppDatabase, sessions: SessionStore): Router {
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

  router.patch("/:id", requireAdmin, async (req, res) => {
    const target = getUserById(db, Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    const body = (req.body ?? {}) as UpdateUserRequest;
    const { displayName, isAdmin, password } = body;
    if (
      (displayName !== undefined &&
        (typeof displayName !== "string" || !isValidDisplayName(displayName))) ||
      (isAdmin !== undefined && typeof isAdmin !== "boolean") ||
      (password !== undefined &&
        (typeof password !== "string" || !isValidPassword(password)))
    ) {
      res.status(400).json({ error: "invalid display name, role, or password" });
      return;
    }
    if (isAdmin === false && target.is_admin === 1 && countAdmins(db) === 1) {
      res.status(400).json({ error: "cannot demote the last admin" });
      return;
    }

    if (displayName !== undefined || isAdmin !== undefined) {
      db.prepare(
        "UPDATE users SET display_name = ?, is_admin = ? WHERE id = ?",
      ).run(
        displayName !== undefined ? displayName.trim() : target.display_name,
        (isAdmin !== undefined ? isAdmin : target.is_admin === 1) ? 1 : 0,
        target.id,
      );
    }
    if (password !== undefined) {
      // A reset signs the user out everywhere: existing sessions may not
      // belong to the account's rightful owner anymore.
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        await argon2.hash(password),
        target.id,
      );
      sessions.deleteForUser(target.id);
    }
    res.json(toUser(getUserById(db, target.id)!));
  });

  router.delete("/:id", requireAdmin, (req, res) => {
    const target = getUserById(db, Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (target.id === req.user!.id) {
      res.status(400).json({ error: "cannot delete your own account" });
      return;
    }
    // libraries.owner_user_id deliberately has no ON DELETE CASCADE — a
    // user deletion must never silently take a whole library (and every
    // user's progress in it) with it.
    const owned = db
      .prepare("SELECT COUNT(*) AS n FROM libraries WHERE owner_user_id = ?")
      .get(target.id) as { n: number };
    if (owned.n > 0) {
      res.status(409).json({
        error: "user still owns libraries; remove them first",
      });
      return;
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
    sessions.deleteForUser(target.id); // clears the in-memory cache too
    res.json({ ok: true });
  });

  return router;
}

function countAdmins(db: AppDatabase): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1")
    .get() as { n: number };
  return row.n;
}

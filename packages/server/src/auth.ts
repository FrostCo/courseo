import crypto from "node:crypto";
import argon2 from "argon2";
import { parseCookie as parseCookieHeader } from "cookie";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  isValidDisplayName,
  isValidPassword,
  isValidUsername,
  type ChangePasswordRequest,
  type LoginRequest,
  type SetupRequest,
  type User,
} from "@courseo/shared";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { countUsers, createUser, getUserById, getUserByUsername, toUser } from "./users.js";

export const SESSION_COOKIE = "courseo_session";

declare module "express-serve-static-core" {
  interface Request {
    /** Authenticated user, resolved fresh from the DB per request. */
    user?: User;
    /** Session ID backing req.user, for logout. */
    sessionId?: string;
  }
}

// ---------------------------------------------------------------------------
// Session store — SQLite source of truth + write-through in-memory cache.
// The cache maps session → identity ONLY (user id + expiry); shares/roles/
// is_admin are always resolved fresh so revocation is instant (spec §4.4).
// ---------------------------------------------------------------------------

interface CachedSession {
  userId: number;
  /** ms since epoch */
  expiresAt: number;
}

export class SessionStore {
  private readonly cache = new Map<string, CachedSession>();

  constructor(
    private readonly db: AppDatabase,
    private readonly ttlMs: number,
  ) {
    const rows = this.db
      .prepare("SELECT id, user_id, expires_at FROM sessions WHERE expires_at > ?")
      .all(new Date().toISOString()) as {
      id: string;
      user_id: number;
      expires_at: string;
    }[];
    for (const row of rows) {
      this.cache.set(row.id, {
        userId: row.user_id,
        expiresAt: Date.parse(row.expires_at),
      });
    }
  }

  get ttlMilliseconds(): number {
    return this.ttlMs;
  }

  create(userId: number): { id: string; expiresAt: number } {
    const id = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(id, userId, new Date(expiresAt).toISOString());
    this.cache.set(id, { userId, expiresAt });
    return { id, expiresAt };
  }

  /** Resolve a session to a user id, expiring lazily. */
  getUserId(id: string): number | null {
    const session = this.cache.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.delete(id);
      return null;
    }
    return session.userId;
  }

  delete(id: string): void {
    this.cache.delete(id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  /** Invalidate every session of a user (e.g. when an admin disables one). */
  deleteForUser(userId: number): void {
    for (const [id, session] of this.cache) {
      if (session.userId === userId) this.cache.delete(id);
    }
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  /** Remove expired rows from both cache and DB; run periodically. */
  sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.cache) {
      if (session.expiresAt <= now) this.cache.delete(id);
    }
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(new Date(now).toISOString());
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function setSessionCookie(
  res: Response,
  config: Config,
  session: { id: string; expiresAt: number },
): void {
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    // The app itself speaks plain HTTP; mark the cookie Secure when a
    // TLS-terminating proxy is declared in front (spec §5.1).
    secure: config.trustProxy,
    path: "/",
    maxAge: session.expiresAt - Date.now(),
  });
}

/**
 * Resolves the session cookie to req.user. The cache lookup gives identity;
 * the user row (and therefore is_admin) is read fresh from the DB so
 * account-level changes apply on the very next request.
 */
export function authContext(db: AppDatabase, sessions: SessionStore) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      const userId = sessions.getUserId(sessionId);
      if (userId !== null) {
        const row = getUserById(db, userId);
        if (row) {
          req.user = toUser(row);
          req.sessionId = sessionId;
        } else {
          // User was deleted; drop the orphaned session.
          sessions.delete(sessionId);
        }
      }
    }
    next();
  };
}

/**
 * Opt-in SSO auto-login (spec §4.4): when a trusted proxy injects an
 * identity header (dash form, e.g. Remote-User — spec §6.7), log the
 * matching app user in, auto-provisioning a regular account on first sight.
 * Config guarantees trustProxy; never mounted otherwise. Skipped until
 * first-run setup has created the admin.
 */
export function ssoAutoLogin(
  db: AppDatabase,
  sessions: SessionStore,
  config: Config,
  headerName: string,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user) return next();
    const username = req.headers[headerName.toLowerCase()];
    if (typeof username !== "string" || !isValidUsername(username)) {
      return next();
    }
    if (countUsers(db) === 0) return next();

    let row = getUserByUsername(db, username);
    if (!row) {
      // Random unguessable hash input: the account exists for SSO only
      // until an admin sets a real password.
      row = createUser(db, {
        username,
        displayName: username,
        passwordHash: `!sso:${crypto.randomBytes(32).toString("base64url")}`,
        isAdmin: false,
      });
    }
    const session = sessions.create(row.id);
    setSessionCookie(res, config, session);
    req.user = toUser(row);
    req.sessionId = session.id;
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: "admin required" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes: /api/setup, /api/auth/login, /api/auth/logout, /api/me
// ---------------------------------------------------------------------------

export function authRouter(
  db: AppDatabase,
  sessions: SessionStore,
  config: Config,
): Router {
  const router = Router();

  router.get("/setup", (_req, res) => {
    res.json({ needsSetup: countUsers(db) === 0 });
  });

  // First-run setup: creates the initial admin and logs them in.
  router.post("/setup", async (req, res) => {
    if (countUsers(db) > 0) {
      res.status(409).json({ error: "setup already completed" });
      return;
    }
    const body = (req.body ?? {}) as Partial<SetupRequest>;
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
    const passwordHash = await argon2.hash(password);
    const row = createUser(db, {
      username,
      displayName: displayName.trim(),
      passwordHash,
      isAdmin: true,
    });
    const session = sessions.create(row.id);
    setSessionCookie(res, config, session);
    res.status(201).json(toUser(row));
  });

  router.post("/auth/login", async (req, res) => {
    const body = (req.body ?? {}) as Partial<LoginRequest>;
    const { username, password } = body;
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password required" });
      return;
    }
    const row = username ? getUserByUsername(db, username) : undefined;
    // Verify against a dummy hash on unknown users so the response time
    // does not reveal whether the username exists.
    const verified = row
      ? await argon2.verify(row.password_hash, password).catch(() => false)
      : ((await argon2.verify(await dummyHash(), password).catch(() => false)) &&
          false);
    if (!row || !verified) {
      res.status(401).json({ error: "invalid username or password" });
      return;
    }
    const session = sessions.create(row.id);
    setSessionCookie(res, config, session);
    res.json(toUser(row));
  });

  router.post("/auth/logout", (req, res) => {
    if (req.sessionId) {
      sessions.delete(req.sessionId);
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json(req.user);
  });

  // Change own password: verifies the current one, then signs out every
  // other session ("sign out everywhere else") and re-issues this one.
  router.put("/me/password", requireAuth, async (req, res) => {
    const body = (req.body ?? {}) as Partial<ChangePasswordRequest>;
    const { currentPassword, newPassword } = body;
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !isValidPassword(newPassword)
    ) {
      res.status(400).json({ error: "invalid password" });
      return;
    }
    const row = getUserById(db, req.user!.id)!;
    const verified = await argon2
      .verify(row.password_hash, currentPassword)
      .catch(() => false);
    if (!verified) {
      res.status(403).json({ error: "current password is incorrect" });
      return;
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      await argon2.hash(newPassword),
      row.id,
    );
    sessions.deleteForUser(row.id);
    const session = sessions.create(row.id);
    setSessionCookie(res, config, session);
    res.json({ ok: true });
  });

  return router;
}

/** Hash of a random value, computed once; only equalizes login timing. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(crypto.randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

import fs from "node:fs";
import path from "node:path";
import { Router, type RequestHandler } from "express";
import {
  isSafeRelPath,
  type CreateLibraryRequest,
  type CreateShareRequest,
  type Library,
  type LibraryAccess,
  type LibraryShare,
  type ShareRole,
  type UpdateLibraryRequest,
} from "@courseo/shared";
import { requireAdmin, requireAuth } from "./auth.js";
import type { Config } from "./config.js";
import { listCourses, syncLibraryCourses } from "./courses.js";
import type { AppDatabase } from "./db.js";
import {
  canManageLibrary,
  getLibraryAccess,
  getLibraryRow,
  type LibraryRow,
} from "./permissions.js";
import { getUserById } from "./users.js";

function toLibrary(row: LibraryRow, access: LibraryAccess): Library {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    ownerUserId: row.owner_user_id,
    access,
    createdAt: row.created_at,
  };
}

/**
 * Validate that a requested library subfolder is a real directory inside
 * the configured libraries root (spec §6.9: resolve the real path and check
 * containment — shape checks alone don't catch symlink escapes).
 * Returns the normalized relative path, or null if invalid.
 */
function resolveLibrarySubfolder(
  librariesRoot: string,
  rootPath: string,
): string | null {
  if (!isSafeRelPath(rootPath)) return null;
  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = fs.realpathSync(librariesRoot);
    realTarget = fs.realpathSync(path.join(librariesRoot, rootPath));
  } catch {
    return null; // does not exist
  }
  if (
    realTarget !== realRoot &&
    !realTarget.startsWith(realRoot + path.sep)
  ) {
    return null; // symlink escape
  }
  if (realTarget === realRoot) return null; // must be a subfolder, not the root
  if (!fs.statSync(realTarget).isDirectory()) return null;
  return rootPath;
}

export function librariesRouter(db: AppDatabase, config: Config): Router {
  const router = Router();
  router.use(requireAuth);

  // Libraries the current user owns or can access, with their access level.
  router.get("/", (req, res) => {
    const rows = db
      .prepare(
        `SELECT DISTINCT l.* FROM libraries l
         LEFT JOIN library_shares s ON s.library_id = l.id
         WHERE l.owner_user_id = ? OR s.user_id = ?
         ORDER BY l.name COLLATE NOCASE`,
      )
      .all(req.user!.id, req.user!.id) as LibraryRow[];
    res.json(
      rows.map((row) => toLibrary(row, getLibraryAccess(db, req.user!, row)!)),
    );
  });

  // Unclaimed subfolders of the libraries root, for the "add library"
  // picker (spec §7 decision: pick an existing subfolder, never type an
  // arbitrary path).
  router.get("/roots", requireAdmin, (_req, res) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(config.librariesRoot, { withFileTypes: true });
    } catch {
      res.json([]);
      return;
    }
    const claimed = new Set(
      (db.prepare("SELECT root_path FROM libraries").all() as {
        root_path: string;
      }[]).map((r) => r.root_path),
    );
    const available = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .filter((name) => !claimed.has(name))
      .sort((a, b) => a.localeCompare(b));
    res.json(available);
  });

  router.post("/", requireAdmin, (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateLibraryRequest>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rootPath = typeof body.rootPath === "string" ? body.rootPath : "";
    if (name.length === 0 || name.length > 128) {
      res.status(400).json({ error: "invalid library name" });
      return;
    }
    const resolved = resolveLibrarySubfolder(config.librariesRoot, rootPath);
    if (resolved === null) {
      res.status(400).json({
        error: "rootPath must be an existing subfolder of the libraries root",
      });
      return;
    }
    const existing = db
      .prepare("SELECT id FROM libraries WHERE root_path = ?")
      .get(resolved);
    if (existing) {
      res.status(409).json({ error: "folder already used by another library" });
      return;
    }
    const result = db
      .prepare(
        "INSERT INTO libraries (name, root_path, owner_user_id) VALUES (?, ?, ?)",
      )
      .run(name, resolved, req.user!.id);
    const row = getLibraryRow(db, Number(result.lastInsertRowid))!;
    res.status(201).json(toLibrary(row, "owner"));
  });

  // Load the library for all /:id routes; access is checked per route
  // (management ops below need owner/admin, future course routes need
  // view access).
  router.use("/:id", (req, res, next) => {
    const row = getLibraryRow(db, Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: "library not found" });
      return;
    }
    res.locals.library = row;
    next();
  });

  const requireManage: RequestHandler = (req, res, next) => {
    if (!canManageLibrary(req.user!, res.locals.library as LibraryRow)) {
      res.status(403).json({ error: "owner or admin required" });
      return;
    }
    next();
  };

  const requireView: RequestHandler = (req, res, next) => {
    const access = getLibraryAccess(db, req.user!, res.locals.library as LibraryRow);
    if (access === null) {
      res.status(403).json({ error: "no access to this library" });
      return;
    }
    res.locals.access = access;
    next();
  };

  router.get("/:id", requireView, (req, res) => {
    const library = res.locals.library as LibraryRow;
    res.json(toLibrary(library, res.locals.access as LibraryAccess));
  });

  // Course listing syncs the courses table with the directory on every
  // call, so newly added content shows up without a manual rescan; the
  // explicit rescan endpoint exists for a refresh button.
  const listLibraryCourses: RequestHandler = (req, res) => {
    const library = res.locals.library as LibraryRow;
    syncLibraryCourses(db, library, config.librariesRoot);
    res.json(listCourses(db, library.id, req.user!.id));
  };
  router.get("/:id/courses", requireView, listLibraryCourses);
  router.post("/:id/rescan", requireView, listLibraryCourses);

  router.patch("/:id", requireManage, (req, res) => {
    const library = res.locals.library as LibraryRow;
    const body = (req.body ?? {}) as Partial<UpdateLibraryRequest>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0 || name.length > 128) {
      res.status(400).json({ error: "invalid library name" });
      return;
    }
    db.prepare("UPDATE libraries SET name = ? WHERE id = ?").run(
      name,
      library.id,
    );
    const row = getLibraryRow(db, library.id)!;
    res.json(toLibrary(row, getLibraryAccess(db, req.user!, row) ?? "owner"));
  });

  // Unregisters the library (cascades shares/courses/progress rows).
  // Never touches files on disk.
  router.delete("/:id", requireManage, (req, res) => {
    const library = res.locals.library as LibraryRow;
    db.prepare("DELETE FROM libraries WHERE id = ?").run(library.id);
    res.json({ ok: true });
  });

  router.get("/:id/shares", requireManage, (req, res) => {
    const library = res.locals.library as LibraryRow;
    const rows = db
      .prepare(
        `SELECT s.library_id, s.user_id, s.role, s.created_at,
                u.username, u.display_name
         FROM library_shares s JOIN users u ON u.id = s.user_id
         WHERE s.library_id = ?
         ORDER BY u.username COLLATE NOCASE`,
      )
      .all(library.id) as {
      library_id: number;
      user_id: number;
      role: ShareRole;
      created_at: string;
      username: string;
      display_name: string;
    }[];
    const shares: LibraryShare[] = rows.map((r) => ({
      libraryId: r.library_id,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      createdAt: r.created_at,
    }));
    res.json(shares);
  });

  // Grant or update a share (upsert): role changes apply on the target
  // user's next request.
  router.post("/:id/shares", requireManage, (req, res) => {
    const library = res.locals.library as LibraryRow;
    const body = (req.body ?? {}) as Partial<CreateShareRequest>;
    const { userId, role } = body;
    if (typeof userId !== "number" || (role !== "viewer" && role !== "editor")) {
      res.status(400).json({ error: "userId and role (viewer|editor) required" });
      return;
    }
    if (!getUserById(db, userId)) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (userId === library.owner_user_id) {
      res.status(400).json({ error: "owner already has full access" });
      return;
    }
    db.prepare(
      `INSERT INTO library_shares (library_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (library_id, user_id) DO UPDATE SET role = excluded.role`,
    ).run(library.id, userId, role);
    res.status(201).json({ ok: true });
  });

  router.delete("/:id/shares/:userId", requireManage, (req, res) => {
    const library = res.locals.library as LibraryRow;
    db.prepare(
      "DELETE FROM library_shares WHERE library_id = ? AND user_id = ?",
    ).run(library.id, Number(req.params.userId));
    res.json({ ok: true });
  });

  return router;
}

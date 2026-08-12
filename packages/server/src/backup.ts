import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { requireAdmin, requireAuth } from "./auth.js";
import type { AppDatabase } from "./db.js";

/**
 * GET /api/backup (admin) — download a consistent snapshot of the SQLite
 * database. VACUUM INTO produces a compact single-file copy that is safe
 * to take while the app is serving requests, so no downtime is needed.
 * Course files are not included; they are plain files the operator backs
 * up separately.
 */
export function backupRouter(db: AppDatabase): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get("/", (_req, res) => {
    const tmp = path.join(
      os.tmpdir(),
      `courseo-backup-${process.pid}-${Date.now()}.db`,
    );
    try {
      db.prepare("VACUUM INTO ?").run(tmp);
    } catch (err) {
      console.error("backup failed:", err);
      fs.rmSync(tmp, { force: true });
      res.status(500).json({ error: "backup failed" });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    res.download(tmp, `courseo-backup-${stamp}.db`, () => {
      fs.rmSync(tmp, { force: true });
    });
  });

  return router;
}

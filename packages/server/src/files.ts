import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { isSafeRelPath } from "@courseo/shared";
import { requireAuth } from "./auth.js";
import type { Config } from "./config.js";
import type { CourseRow } from "./courses.js";
import type { AppDatabase } from "./db.js";
import { getLibraryAccess, getLibraryRow } from "./permissions.js";

/**
 * GET /api/courses/:id/files/<lesson path> — stream a course file.
 *
 * Course-scoped so the access check is one library lookup and the URL path
 * mirrors the progress key. The client percent-encodes each segment but
 * keeps real "/" separators, avoiding the %2F-rejecting-proxy gotcha
 * (spec §6.2). res.sendFile provides Range/206 responses and extension-
 * based Content-Types (spec §6.4/§6.6).
 *
 * This is the highest-risk surface in the app (spec §6.9): the relative
 * path is shape-checked, then the real path is resolved and verified to
 * stay inside the course directory, which also defeats symlink escapes.
 */
export function filesRouter(db: AppDatabase, config: Config): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/:id/files/*lessonPath", (req, res) => {
    const course = db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .get(Number(req.params.id)) as CourseRow | undefined;
    if (!course) {
      res.status(404).json({ error: "course not found" });
      return;
    }
    const library = getLibraryRow(db, course.library_id)!;
    if (getLibraryAccess(db, req.user!, library) === null) {
      res.status(403).json({ error: "no access to this library" });
      return;
    }

    const splat = req.params.lessonPath as unknown as string | string[];
    const relPath = Array.isArray(splat) ? splat.join("/") : splat;
    if (!isSafeRelPath(relPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }

    const courseDir = path.join(
      config.librariesRoot,
      library.root_path,
      course.rel_path,
    );
    let realCourseDir: string;
    let realFile: string;
    try {
      realCourseDir = fs.realpathSync(courseDir);
      realFile = fs.realpathSync(path.join(courseDir, relPath));
    } catch {
      res.status(404).json({ error: "file not found" });
      return;
    }
    if (!realFile.startsWith(realCourseDir + path.sep)) {
      res.status(403).json({ error: "path escapes the course directory" });
      return;
    }
    if (!fs.statSync(realFile).isFile()) {
      res.status(404).json({ error: "file not found" });
      return;
    }

    res.sendFile(realFile, { dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: "file not found" });
      }
    });
  });

  return router;
}

import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import {
  baseName,
  detectLessonType,
  isSafeRelPath,
  isSubtitleSidecarFor,
  isValidName,
  parentPath,
  type Course,
  type MoveCourseRequest,
  type MoveRequest,
} from "@courseo/shared";
import { requireAdmin, requireAuth } from "./auth.js";
import type { Config } from "./config.js";
import type { CourseRow } from "./courses.js";
import type { AppDatabase } from "./db.js";
import { getLibraryRow } from "./permissions.js";

/**
 * The move+update invariant (spec §6.10): a rename on disk and its
 * database bookkeeping succeed or fail together. The disk rename runs
 * first; if the database work then throws, the rename is reversed before
 * the error propagates.
 */
export function renameOnDiskThen(
  db: AppDatabase,
  oldAbs: string,
  newAbs: string,
  dbWork: () => void,
): void {
  fs.renameSync(oldAbs, newAbs);
  try {
    db.transaction(dbWork)();
  } catch (err) {
    fs.renameSync(newAbs, oldAbs);
    throw err;
  }
}

/**
 * Remap progress keys after a path inside a course changed: the exact key
 * (a renamed file) and everything under it (a renamed folder) in one
 * statement. Stale rows already sitting at the destination keys (files
 * deleted out-of-band) are dropped first so the unique key can't collide.
 * Prefix matching uses substr, not LIKE — file names may contain % and _.
 */
function remapProgressKeys(
  db: AppDatabase,
  courseId: number,
  from: string,
  to: string,
): void {
  const params = { courseId, from, to, fromLen: from.length };
  const keyMatches = `(lesson_path = @from OR substr(lesson_path, 1, @fromLen + 1) = @from || '/')`;
  const destMatches = `(lesson_path = @to OR substr(lesson_path, 1, length(@to) + 1) = @to || '/')`;
  db.prepare(
    `DELETE FROM progress WHERE course_id = @courseId AND ${destMatches}`,
  ).run(params);
  db.prepare(
    `UPDATE progress
     SET lesson_path = @to || substr(lesson_path, @fromLen + 1)
     WHERE course_id = @courseId AND ${keyMatches}`,
  ).run(params);
}

/** All file-management routes are admin-only (spec §7 decision). */
export function fileOpsRouter(db: AppDatabase, config: Config): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  const loadCourse = (id: string): CourseRow | undefined =>
    db.prepare("SELECT * FROM courses WHERE id = ?").get(Number(id)) as
      | CourseRow
      | undefined;

  // Move/rename a course: new name, new author folder, and/or new library.
  router.post("/:id/move", (req, res) => {
    const course = loadCourse(req.params.id);
    if (!course) {
      res.status(404).json({ error: "course not found" });
      return;
    }
    const library = getLibraryRow(db, course.library_id)!;
    const body = (req.body ?? {}) as MoveCourseRequest;

    const targetLibrary =
      body.libraryId === undefined ? library : getLibraryRow(db, body.libraryId);
    if (!targetLibrary) {
      res.status(404).json({ error: "target library not found" });
      return;
    }

    // Courses always live under an author folder; only a course that is
    // already ungrouped may stay ungrouped (via a pure rename). There is
    // deliberately no way to move a course *to* the top level — a course
    // with chapter subfolders there would scan as an author group.
    const currentAuthor = course.rel_path.includes("/")
      ? course.rel_path.slice(0, course.rel_path.indexOf("/"))
      : null;
    const author = body.author === undefined ? currentAuthor : body.author;
    const name = body.name === undefined ? course.name : body.name;
    if (!isValidName(name) || (author !== null && !isValidName(author))) {
      res.status(400).json({ error: "invalid name" });
      return;
    }
    if (author === null && targetLibrary.id !== library.id) {
      res.status(400).json({ error: "author folder required for this move" });
      return;
    }

    const newRelPath = author === null ? name : `${author}/${name}`;
    if (targetLibrary.id === library.id && newRelPath === course.rel_path) {
      res.json(toCourse(course));
      return;
    }

    const oldAbs = path.join(
      config.librariesRoot,
      library.root_path,
      course.rel_path,
    );
    const newAbs = path.join(
      config.librariesRoot,
      targetLibrary.root_path,
      newRelPath,
    );
    if (author !== null) {
      const authorAbs = path.join(
        config.librariesRoot,
        targetLibrary.root_path,
        author,
      );
      if (!fs.existsSync(authorAbs) || !fs.statSync(authorAbs).isDirectory()) {
        res.status(400).json({ error: "author folder does not exist" });
        return;
      }
    }
    if (fs.existsSync(newAbs)) {
      res.status(409).json({ error: "destination already exists" });
      return;
    }

    try {
      renameOnDiskThen(db, oldAbs, newAbs, () => {
        db.prepare(
          "UPDATE courses SET library_id = ?, rel_path = ?, name = ? WHERE id = ?",
        ).run(targetLibrary.id, newRelPath, name, course.id);
      });
    } catch (err) {
      res.status(400).json({ error: moveErrorMessage(err) });
      return;
    }
    res.json(toCourse(loadCourse(req.params.id)!));
  });

  // Move/rename a file or folder within a course, remapping progress keys.
  router.post("/:id/files/move", (req, res) => {
    const course = loadCourse(req.params.id);
    if (!course) {
      res.status(404).json({ error: "course not found" });
      return;
    }
    const library = getLibraryRow(db, course.library_id)!;
    const body = (req.body ?? {}) as Partial<MoveRequest>;
    const { from, to } = body;
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !isSafeRelPath(from) ||
      !isSafeRelPath(to) ||
      !isValidName(baseName(to))
    ) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (from === to) {
      res.json({ ok: true });
      return;
    }
    if (to.startsWith(from + "/")) {
      res.status(400).json({ error: "cannot move a folder into itself" });
      return;
    }

    const courseDir = path.join(
      config.librariesRoot,
      library.root_path,
      course.rel_path,
    );
    // Containment (spec §6.9): resolve real paths for the source and the
    // destination's parent, and require both inside the course directory.
    let realCourseDir: string;
    let realFrom: string;
    try {
      realCourseDir = fs.realpathSync(courseDir);
      realFrom = fs.realpathSync(path.join(courseDir, from));
    } catch {
      res.status(404).json({ error: "source not found" });
      return;
    }
    if (!realFrom.startsWith(realCourseDir + path.sep)) {
      res.status(403).json({ error: "path escapes the course directory" });
      return;
    }
    let realToParent: string;
    try {
      realToParent = fs.realpathSync(
        path.join(courseDir, parentPath(to) || "."),
      );
    } catch {
      res.status(400).json({ error: "destination folder does not exist" });
      return;
    }
    if (
      realToParent !== realCourseDir &&
      !realToParent.startsWith(realCourseDir + path.sep)
    ) {
      res.status(403).json({ error: "path escapes the course directory" });
      return;
    }
    const toAbs = path.join(realToParent, baseName(to));
    if (fs.existsSync(toAbs)) {
      res.status(409).json({ error: "destination already exists" });
      return;
    }

    // Sidecar subtitles follow a renamed media file, so the cc association
    // survives ("video.mp4" + "video.en.vtt" stay a pair).
    const fromAbs = path.join(courseDir, from);
    const isMediaFile = ["video", "audio"].includes(
      detectLessonType(baseName(from)) ?? "",
    );
    const sidecars =
      isMediaFile && fs.statSync(realFrom).isFile()
        ? findSidecars(path.dirname(fromAbs), baseName(from), baseName(to))
        : [];

    try {
      renameOnDiskThen(db, fromAbs, toAbs, () => {
        remapProgressKeys(db, course.id, from, to);
      });
    } catch (err) {
      res.status(400).json({ error: moveErrorMessage(err) });
      return;
    }
    for (const sidecar of sidecars) {
      // Best-effort: a failed sidecar rename should not undo the move.
      try {
        fs.renameSync(sidecar.abs, path.join(path.dirname(toAbs), sidecar.newName));
      } catch {
        /* leave the sidecar behind */
      }
    }
    res.json({ ok: true });
  });

  return router;
}

function toCourse(row: CourseRow): Course {
  return {
    id: row.id,
    libraryId: row.library_id,
    relPath: row.rel_path,
    name: row.name,
    createdAt: row.created_at,
  };
}

/** "video.srt" and "video.en.vtt" both pair with "video.mp4". */
function findSidecars(
  dirAbs: string,
  fromFileName: string,
  toFileName: string,
): { abs: string; newName: string }[] {
  const oldBase = stripExtension(fromFileName);
  const newBase = stripExtension(toFileName);
  let entries: string[];
  try {
    entries = fs.readdirSync(dirAbs);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => isSubtitleSidecarFor(entry, oldBase))
    .map((entry) => ({
      abs: path.join(dirAbs, entry),
      newName: newBase + entry.slice(oldBase.length),
    }));
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function moveErrorMessage(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "EXDEV") {
    return "source and destination are on different filesystems";
  }
  return "move failed";
}

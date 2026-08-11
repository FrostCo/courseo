import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import {
  isSafeRelPath,
  type LessonProgress,
  type ProgressUpdateRequest,
} from "@courseo/shared";
import { requireAuth } from "./auth.js";
import type { Config } from "./config.js";
import type { CourseRow } from "./courses.js";
import type { AppDatabase } from "./db.js";
import { getLibraryAccess, getLibraryRow } from "./permissions.js";

/**
 * PUT /api/progress — upsert the current user's progress for one lesson.
 * `completed` and `positionSeconds` are independently optional so the
 * player can save playback position without touching completion and the
 * UI can toggle completion without knowing the position.
 */
export function progressRouter(db: AppDatabase, config: Config): Router {
  const router = Router();
  router.use(requireAuth);

  router.put("/", (req, res) => {
    const body = (req.body ?? {}) as Partial<ProgressUpdateRequest>;
    const { courseId, lessonPath, completed, positionSeconds } = body;
    if (
      typeof courseId !== "number" ||
      typeof lessonPath !== "string" ||
      !isSafeRelPath(lessonPath) ||
      (completed !== undefined && typeof completed !== "boolean") ||
      (positionSeconds !== undefined &&
        (typeof positionSeconds !== "number" ||
          !Number.isFinite(positionSeconds) ||
          positionSeconds < 0))
    ) {
      res.status(400).json({ error: "invalid progress payload" });
      return;
    }
    if (completed === undefined && positionSeconds === undefined) {
      res.status(400).json({ error: "nothing to update" });
      return;
    }

    const course = db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .get(courseId) as CourseRow | undefined;
    if (!course) {
      res.status(404).json({ error: "course not found" });
      return;
    }
    const library = getLibraryRow(db, course.library_id)!;
    if (getLibraryAccess(db, req.user!, library) === null) {
      res.status(403).json({ error: "no access to this library" });
      return;
    }

    // Progress keys must reference real content, or moved/deleted files
    // would accumulate junk rows that never remap.
    const lessonFile = path.join(
      config.librariesRoot,
      library.root_path,
      course.rel_path,
      lessonPath,
    );
    if (!fs.existsSync(lessonFile)) {
      res.status(404).json({ error: "lesson file not found" });
      return;
    }

    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO progress (user_id, course_id, lesson_path, completed, position_seconds, updated_at)
       VALUES (@userId, @courseId, @lessonPath, COALESCE(@completed, 0), COALESCE(@positionSeconds, 0), @updatedAt)
       ON CONFLICT (user_id, course_id, lesson_path) DO UPDATE SET
         completed = COALESCE(@completed, completed),
         position_seconds = COALESCE(@positionSeconds, position_seconds),
         updated_at = @updatedAt`,
    ).run({
      userId: req.user!.id,
      courseId,
      lessonPath,
      completed: completed === undefined ? null : completed ? 1 : 0,
      positionSeconds: positionSeconds ?? null,
      updatedAt,
    });

    const row = db
      .prepare(
        `SELECT completed, position_seconds, updated_at FROM progress
         WHERE user_id = ? AND course_id = ? AND lesson_path = ?`,
      )
      .get(req.user!.id, courseId, lessonPath) as {
      completed: number;
      position_seconds: number;
      updated_at: string;
    };
    const progress: LessonProgress = {
      completed: row.completed === 1,
      positionSeconds: row.position_seconds,
      updatedAt: row.updated_at,
    };
    res.json(progress);
  });

  return router;
}

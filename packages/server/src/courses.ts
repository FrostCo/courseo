import path from "node:path";
import { Router } from "express";
import type {
  Course,
  CourseTreeNode,
  CourseTreeResponse,
  LessonProgress,
} from "@courseo/shared";
import { requireAuth } from "./auth.js";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { getLibraryAccess, getLibraryRow, type LibraryRow } from "./permissions.js";
import { scanCourseTree, scanLibraryCourses } from "./scan.js";

export interface CourseRow {
  id: number;
  library_id: number;
  rel_path: string;
  name: string;
  total_lessons: number;
  created_at: string;
}

/**
 * Sync the courses table with what's on disk: new directories appear,
 * missing ones are removed (cascading their progress — the content is
 * gone), and surviving rows keep their ids so progress sticks.
 */
export function syncLibraryCourses(
  db: AppDatabase,
  library: LibraryRow,
  librariesRoot: string,
): void {
  const scanned = scanLibraryCourses(path.join(librariesRoot, library.root_path));
  db.transaction(() => {
    const existing = db
      .prepare("SELECT id, rel_path FROM courses WHERE library_id = ?")
      .all(library.id) as { id: number; rel_path: string }[];
    const existingByRel = new Map(existing.map((c) => [c.rel_path, c]));
    const seen = new Set<string>();
    for (const course of scanned) {
      seen.add(course.relPath);
      const current = existingByRel.get(course.relPath);
      if (current) {
        db.prepare(
          "UPDATE courses SET name = ?, total_lessons = ? WHERE id = ?",
        ).run(course.name, course.totalLessons, current.id);
      } else {
        db.prepare(
          `INSERT INTO courses (library_id, rel_path, name, total_lessons)
           VALUES (?, ?, ?, ?)`,
        ).run(library.id, course.relPath, course.name, course.totalLessons);
      }
    }
    for (const course of existing) {
      if (!seen.has(course.rel_path)) {
        db.prepare("DELETE FROM courses WHERE id = ?").run(course.id);
      }
    }
  })();
}

/** Course list with the given user's completion counts merged in. */
export function listCourses(
  db: AppDatabase,
  libraryId: number,
  userId: number,
): Course[] {
  const rows = db
    .prepare(
      `SELECT c.*, COALESCE(p.completed_count, 0) AS completed_count
       FROM courses c
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS completed_count
         FROM progress WHERE user_id = ? AND completed = 1
         GROUP BY course_id
       ) p ON p.course_id = c.id
       WHERE c.library_id = ?
       ORDER BY c.rel_path COLLATE NOCASE`,
    )
    .all(userId, libraryId) as (CourseRow & { completed_count: number })[];
  return rows.map((row) => ({
    id: row.id,
    libraryId: row.library_id,
    relPath: row.rel_path,
    name: row.name,
    createdAt: row.created_at,
    stats: {
      totalLessons: row.total_lessons,
      completedLessons: Math.min(row.completed_count, row.total_lessons),
    },
  }));
}

// ---------------------------------------------------------------------------
// Routes: /api/courses/:id/tree
// ---------------------------------------------------------------------------

export function coursesRouter(db: AppDatabase, config: Config): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/:id/tree", (req, res) => {
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

    const courseDir = path.join(
      config.librariesRoot,
      library.root_path,
      course.rel_path,
    );
    const tree = scanCourseTree(courseDir);

    const progressRows = db
      .prepare(
        `SELECT lesson_path, completed, position_seconds, updated_at
         FROM progress WHERE user_id = ? AND course_id = ?`,
      )
      .all(req.user!.id, course.id) as {
      lesson_path: string;
      completed: number;
      position_seconds: number;
      updated_at: string;
    }[];
    const progressByPath = new Map<string, LessonProgress>(
      progressRows.map((row) => [
        row.lesson_path,
        {
          completed: row.completed === 1,
          positionSeconds: row.position_seconds,
          updatedAt: row.updated_at,
        },
      ]),
    );
    const completedLessons = attachProgress(tree.children, progressByPath);

    const response: CourseTreeResponse = {
      course: {
        id: course.id,
        libraryId: course.library_id,
        relPath: course.rel_path,
        name: course.name,
        createdAt: course.created_at,
      },
      library: { id: library.id, name: library.name },
      children: tree.children,
      stats: { totalLessons: tree.totalLessons, completedLessons },
    };
    res.json(response);
  });

  return router;
}

function attachProgress(
  nodes: CourseTreeNode[],
  progressByPath: Map<string, LessonProgress>,
): number {
  let completed = 0;
  for (const node of nodes) {
    if (node.kind === "dir") {
      completed += attachProgress(node.children, progressByPath);
    } else {
      const progress = progressByPath.get(node.path);
      if (progress) {
        node.progress = progress;
        if (progress.completed) completed += 1;
      }
    }
  }
  return completed;
}

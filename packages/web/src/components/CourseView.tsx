import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  joinPath,
  parentPath,
  type CourseTreeNode,
  type CourseTreeResponse,
  type DirectoryNode,
  type LessonNode,
  type User,
} from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";
import { FriendlyName } from "./FriendlyName.js";
import { InlineRename } from "./InlineRename.js";
import { flattenLessons, lessonLink } from "./LessonView.js";
import { ProgressIndicator } from "./ProgressIndicator.js";

export function CourseView({
  user,
  editMode,
}: {
  user: User;
  editMode: boolean;
}) {
  const courseId = Number(useParams().courseId);
  const [tree, setTree] = useState<CourseTreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(() => {
    api.courses
      .tree(courseId)
      .then(setTree)
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "failed to load course",
        ),
      );
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  // Default expansion: only the section you'd continue in is open. Applied
  // once per course, so reloads (rename, checkbox toggles) don't clobber
  // the user's expand/collapse state.
  const expansionInitFor = useRef<number | null>(null);
  useEffect(() => {
    if (!tree || expansionInitFor.current === courseId) return;
    expansionInitFor.current = courseId;
    const target = findContinueTarget(tree.children);
    setExpanded(new Set(target ? ancestorDirs(target.lesson.path) : []));
  }, [tree, courseId]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renameNode =
    user.isAdmin && editMode
      ? async (node: CourseTreeNode, newName: string) => {
          await api.courses.moveFile(courseId, {
            from: node.path,
            to: joinPath(parentPath(node.path), newName),
          });
          load();
        }
      : undefined;

  const setLessonCompleted = useCallback(
    async (node: LessonNode, completed: boolean) => {
      try {
        await api.progress.update({
          courseId,
          lessonPath: node.path,
          completed,
        });
      } catch {
        // fall through to reload, which shows the real state
      }
      load();
    },
    [courseId, load],
  );

  const setSectionCompleted = useCallback(
    async (dir: DirectoryNode, completed: boolean) => {
      const lessonPaths = flattenLessons(dir.children).map((l) => l.path);
      if (lessonPaths.length === 0) return;
      try {
        await api.progress.bulk({ courseId, lessonPaths, completed });
      } catch {
        // fall through to reload, which shows the real state
      }
      load();
    },
    [courseId, load],
  );

  if (error) return <p className="form-error">{error}</p>;
  if (!tree) return null;

  const dirPaths = collectDirPaths(tree.children);
  const allExpanded = dirPaths.length > 0 && dirPaths.every((p) => expanded.has(p));
  const continueTarget = findContinueTarget(tree.children);

  return (
    <div className="page">
      <nav className="breadcrumbs">
        <Link to="/libraries">Libraries</Link>
        <span>/</span>
        <Link to={`/libraries/${tree.library.id}`}>{tree.library.name}</Link>
        <span>/</span>
        <span>{tree.course.name}</span>
      </nav>
      <div className="page-heading">
        <h2>{tree.course.name}</h2>
        <span className="heading-actions">
          <ProgressIndicator
            completed={tree.stats.completedLessons}
            total={tree.stats.totalLessons}
          />
          {dirPaths.length > 0 && (
            <button
              className="link-button"
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(dirPaths))
              }
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
        </span>
      </div>

      {continueTarget && (
        <div className="continue-bar">
          <Link
            className="primary-button continue-button"
            to={lessonLink(courseId, continueTarget.lesson)}
          >
            {continueTarget.started ? "Continue" : "Start course"}
          </Link>
          <span className="continue-name" title={continueTarget.lesson.path}>
            <FriendlyName name={continueTarget.lesson.name} file />
          </span>
        </div>
      )}

      {tree.children.length === 0 ? (
        <p className="tagline">No lessons found in this course folder.</p>
      ) : (
        <TreeLevel
          nodes={tree.children}
          courseId={courseId}
          expanded={expanded}
          onToggle={toggleDir}
          onRename={renameNode}
          onSetLesson={setLessonCompleted}
          onSetSection={setSectionCompleted}
        />
      )}
    </div>
  );
}

function ancestorDirs(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

/**
 * Where the user should pick the course back up: the most recently touched
 * lesson if it's unfinished, otherwise the next uncompleted lesson after
 * it. Null when every lesson is complete (or the course is empty).
 */
function findContinueTarget(
  nodes: CourseTreeNode[],
): { lesson: LessonNode; started: boolean } | null {
  const lessons = flattenLessons(nodes);
  if (lessons.length === 0) return null;

  let lastIndex = -1;
  let lastTime = "";
  lessons.forEach((lesson, i) => {
    const time = lesson.progress?.updatedAt;
    if (time && time > lastTime) {
      lastTime = time;
      lastIndex = i;
    }
  });
  if (lastIndex === -1) return { lesson: lessons[0]!, started: false };

  const last = lessons[lastIndex]!;
  if (!last.progress?.completed) return { lesson: last, started: true };
  for (let i = lastIndex + 1; i < lessons.length; i++) {
    if (!lessons[i]!.progress?.completed) {
      return { lesson: lessons[i]!, started: true };
    }
  }
  const remaining = lessons.find((lesson) => !lesson.progress?.completed);
  return remaining ? { lesson: remaining, started: true } : null;
}

function collectDirPaths(nodes: CourseTreeNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "dir") {
      out.push(node.path, ...collectDirPaths(node.children));
    }
  }
  return out;
}

function countLessons(nodes: CourseTreeNode[]): {
  total: number;
  completed: number;
} {
  let total = 0;
  let completed = 0;
  for (const node of nodes) {
    if (node.kind === "dir") {
      const counts = countLessons(node.children);
      total += counts.total;
      completed += counts.completed;
    } else {
      total += 1;
      if (node.progress?.completed) completed += 1;
    }
  }
  return { total, completed };
}

/**
 * Tri-state section checkbox: checked when every lesson underneath is
 * complete, indeterminate when some are. Checking completes the whole
 * section; unchecking clears it.
 */
function SectionCheckbox({
  name,
  completed,
  total,
  onSet,
}: {
  name: string;
  completed: number;
  total: number;
  onSet: (completed: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = completed > 0 && completed < total;
    }
  }, [completed, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="tree-check"
      checked={total > 0 && completed === total}
      onChange={(e) => onSet(e.target.checked)}
      aria-label={`Mark section ${name} ${
        total > 0 && completed === total ? "not complete" : "complete"
      }`}
    />
  );
}

function TreeLevel({
  nodes,
  courseId,
  expanded,
  onToggle,
  onRename,
  onSetLesson,
  onSetSection,
}: {
  nodes: CourseTreeNode[];
  courseId: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onRename?: (node: CourseTreeNode, newName: string) => Promise<void>;
  onSetLesson: (node: LessonNode, completed: boolean) => void;
  onSetSection: (node: DirectoryNode, completed: boolean) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((node) => {
        if (node.kind === "dir") {
          const counts = countLessons(node.children);
          return (
            <li key={node.path} className="tree-dir">
              <span className="tree-dir-name">
                <SectionCheckbox
                  name={node.name}
                  completed={counts.completed}
                  total={counts.total}
                  onSet={(completed) => onSetSection(node, completed)}
                />
                <button
                  className="tree-toggle"
                  aria-expanded={expanded.has(node.path)}
                  onClick={() => onToggle(node.path)}
                >
                  <span className="tree-chevron" aria-hidden>
                    {expanded.has(node.path) ? "▾" : "▸"}
                  </span>
                  <FriendlyName name={node.name} />
                </button>
                {counts.total > 0 && (
                  <span
                    className={
                      counts.completed === counts.total
                        ? "tree-count tree-count--done"
                        : "tree-count"
                    }
                  >
                    {counts.completed}/{counts.total}
                  </span>
                )}
                {onRename && (
                  <InlineRename
                    name={node.name}
                    label={`Rename ${node.name}`}
                    onRename={(newName) => onRename(node, newName)}
                  />
                )}
              </span>
              {expanded.has(node.path) && (
                <TreeLevel
                  nodes={node.children}
                  courseId={courseId}
                  expanded={expanded}
                  onToggle={onToggle}
                  onRename={onRename}
                  onSetLesson={onSetLesson}
                  onSetSection={onSetSection}
                />
              )}
            </li>
          );
        }
        const completed = node.progress?.completed ?? false;
        return (
          <li key={node.path} className="tree-lesson">
            <input
              type="checkbox"
              className="tree-check"
              checked={completed}
              onChange={(e) => onSetLesson(node, e.target.checked)}
              aria-label={`Mark ${node.name} ${
                completed ? "not complete" : "complete"
              }`}
            />
            <span className={`type-badge type-badge--${node.type}`}>
              {node.type}
            </span>
            <Link
              className="tree-lesson-name"
              to={lessonLink(courseId, node)}
              title={node.path}
            >
              <FriendlyName name={node.name} file />
            </Link>
            {onRename && (
              <InlineRename
                name={node.name}
                label={`Rename ${node.name}`}
                onRename={(newName) => onRename(node, newName)}
              />
            )}
            {node.subtitles && (
              <span className="tree-subtle">cc</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  joinPath,
  parentPath,
  type CourseTreeNode,
  type CourseTreeResponse,
  type LessonNode,
  type User,
} from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";
import { FriendlyName } from "./FriendlyName.js";
import { InlineRename } from "./InlineRename.js";
import { flattenLessons, lessonLink } from "./LessonView.js";
import { ProgressIndicator } from "./ProgressIndicator.js";

export function CourseView({ user }: { user: User }) {
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

  // Default expansion: only the section you'd continue in is open.
  useEffect(() => {
    if (!tree) return;
    const target = findContinueTarget(tree.children);
    setExpanded(new Set(target ? ancestorDirs(target.lesson.path) : []));
  }, [tree]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renameNode = user.isAdmin
    ? async (node: CourseTreeNode, newName: string) => {
        await api.courses.moveFile(courseId, {
          from: node.path,
          to: joinPath(parentPath(node.path), newName),
        });
        load();
      }
    : undefined;

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

function SectionCount({ nodes }: { nodes: CourseTreeNode[] }) {
  const { total, completed } = countLessons(nodes);
  if (total === 0) return null;
  const done = completed === total;
  return (
    <span className={done ? "tree-count tree-count--done" : "tree-count"}>
      {completed}/{total}
    </span>
  );
}

function TreeLevel({
  nodes,
  courseId,
  expanded,
  onToggle,
  onRename,
}: {
  nodes: CourseTreeNode[];
  courseId: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onRename?: (node: CourseTreeNode, newName: string) => Promise<void>;
}) {
  return (
    <ul className="tree">
      {nodes.map((node) =>
        node.kind === "dir" ? (
          <li key={node.path} className="tree-dir">
            <span className="tree-dir-name">
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
              <SectionCount nodes={node.children} />
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
              />
            )}
          </li>
        ) : (
          <li key={node.path} className="tree-lesson">
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
            {node.progress?.completed && (
              <span className="tree-done" title="completed">
                done
              </span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

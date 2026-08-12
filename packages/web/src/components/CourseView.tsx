import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  joinPath,
  parentPath,
  type CourseTreeNode,
  type CourseTreeResponse,
  type User,
} from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";
import { InlineRename } from "./InlineRename.js";
import { lessonLink } from "./LessonView.js";

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
          <span className="tagline">
            {tree.stats.completedLessons}/{tree.stats.totalLessons} lessons
            completed
          </span>
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

function collectDirPaths(nodes: CourseTreeNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "dir") {
      out.push(node.path, ...collectDirPaths(node.children));
    }
  }
  return out;
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
                {node.name}
              </button>
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
              {node.name}
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

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CourseTreeNode, CourseTreeResponse } from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";
import { lessonLink } from "./LessonView.js";

export function CourseView() {
  const courseId = Number(useParams().courseId);
  const [tree, setTree] = useState<CourseTreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.courses
      .tree(courseId)
      .then(setTree)
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "failed to load course",
        ),
      );
  }, [courseId]);

  if (error) return <p className="form-error">{error}</p>;
  if (!tree) return null;

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
        <span className="tagline">
          {tree.stats.completedLessons}/{tree.stats.totalLessons} lessons
          completed
        </span>
      </div>

      {tree.children.length === 0 ? (
        <p className="tagline">No lessons found in this course folder.</p>
      ) : (
        <TreeLevel nodes={tree.children} courseId={courseId} />
      )}
    </div>
  );
}

function TreeLevel({
  nodes,
  courseId,
}: {
  nodes: CourseTreeNode[];
  courseId: number;
}) {
  return (
    <ul className="tree">
      {nodes.map((node) =>
        node.kind === "dir" ? (
          <li key={node.path} className="tree-dir">
            <span className="tree-dir-name">{node.name}</span>
            <TreeLevel nodes={node.children} courseId={courseId} />
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

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  encodePathForUrl,
  fileExtension,
  type CourseTreeNode,
  type CourseTreeResponse,
  type LessonNode,
} from "@courseo/shared";
import { api, ApiRequestError, fileUrl } from "../api.js";
import { MediaPlayer } from "./viewers/MediaPlayer.js";
import { TextViewer } from "./viewers/TextViewer.js";

export function LessonView() {
  const courseId = Number(useParams().courseId);
  const lessonPath = useParams()["*"] ?? "";
  const [tree, setTree] = useState<CourseTreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    api.courses
      .tree(courseId)
      .then(setTree)
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "failed to load lesson",
        ),
      );
  }, [courseId]);

  const lessons = tree ? flattenLessons(tree.children) : [];
  const index = lessons.findIndex((l) => l.path === lessonPath);
  const lesson = index === -1 ? null : lessons[index]!;

  useEffect(() => {
    setCompleted(lesson?.progress?.completed ?? false);
  }, [lesson]);

  const setCompletion = useCallback(
    (value: boolean) => {
      setCompleted(value);
      api.progress
        .update({ courseId, lessonPath, completed: value })
        .catch(() => setCompleted(!value));
    },
    [courseId, lessonPath],
  );

  const savePosition = useCallback(
    (positionSeconds: number) => {
      api.progress
        .update({ courseId, lessonPath, positionSeconds })
        .catch(() => undefined);
    },
    [courseId, lessonPath],
  );

  if (error) return <p className="form-error">{error}</p>;
  if (!tree) return null;
  if (!lesson) {
    return <p className="form-error">lesson not found in this course</p>;
  }

  const prev = index > 0 ? lessons[index - 1] : undefined;
  const next = index < lessons.length - 1 ? lessons[index + 1] : undefined;

  return (
    <div className="page">
      <nav className="breadcrumbs">
        <Link to="/libraries">Libraries</Link>
        <span>/</span>
        <Link to={`/libraries/${tree.library.id}`}>{tree.library.name}</Link>
        <span>/</span>
        <Link to={`/courses/${tree.course.id}`}>{tree.course.name}</Link>
        <span>/</span>
        <span>{lesson.name}</span>
      </nav>

      <div className="page-heading">
        <h2 className="lesson-title">{lesson.name}</h2>
        <button
          className={completed ? "primary-button" : "secondary-button"}
          onClick={() => setCompletion(!completed)}
        >
          {completed ? "Completed ✓" : "Mark complete"}
        </button>
      </div>

      <Viewer
        lesson={lesson}
        courseId={courseId}
        completed={completed}
        onComplete={() => setCompletion(true)}
        onPosition={savePosition}
      />

      <nav className="lesson-nav">
        {prev ? (
          <Link to={lessonLink(courseId, prev)} title={prev.path}>
            ← {prev.name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={lessonLink(courseId, next)} title={next.path}>
            {next.name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

export function lessonLink(courseId: number, lesson: LessonNode): string {
  return `/courses/${courseId}/lessons/${encodePathForUrl(lesson.path)}`;
}

export function flattenLessons(nodes: CourseTreeNode[]): LessonNode[] {
  const out: LessonNode[] = [];
  for (const node of nodes) {
    if (node.kind === "dir") out.push(...flattenLessons(node.children));
    else out.push(node);
  }
  return out;
}

function Viewer({
  lesson,
  courseId,
  completed,
  onComplete,
  onPosition,
}: {
  lesson: LessonNode;
  courseId: number;
  completed: boolean;
  onComplete: () => void;
  onPosition: (seconds: number) => void;
}) {
  const src = fileUrl(courseId, lesson.path);

  // Quiz is a classification, not a format — render quizzes by extension.
  const ext = fileExtension(lesson.name);
  const kind =
    lesson.type === "quiz"
      ? ext === ".pdf"
        ? "pdf"
        : ext === ".html" || ext === ".htm"
          ? "html"
          : "text"
      : lesson.type;

  switch (kind) {
    case "video":
    case "audio":
      return (
        <MediaPlayer
          key={lesson.path}
          kind={kind}
          src={src}
          subtitleTracks={(lesson.subtitles ?? [])
            .filter((s) => s.endsWith(".vtt"))
            .map((s) => ({
              src: fileUrl(courseId, s),
              label: subtitleLabel(s),
            }))}
          initialPosition={lesson.progress?.positionSeconds ?? 0}
          completed={completed}
          onPosition={onPosition}
          onComplete={onComplete}
        />
      );
    case "pdf":
      // Native viewer in an iframe — never fetch-as-text (spec §6.5);
      // works because files are served with application/pdf and our own
      // origin allows same-origin framing (§6.3/§6.4).
      return <iframe className="doc-frame" src={src} title={lesson.name} />;
    case "html":
      return <iframe className="doc-frame" src={src} title={lesson.name} />;
    case "text":
      return (
        <TextViewer key={lesson.path} src={src} markdown={ext === ".md"} />
      );
    case "document":
      return (
        <p className="tagline">
          No in-browser viewer for {ext} files —{" "}
          <a className="download-link" href={src} download={lesson.name}>
            download {lesson.name}
          </a>{" "}
          and mark it complete when done.
        </p>
      );
  }
}

function subtitleLabel(subtitlePath: string): string {
  const base = subtitlePath.split("/").at(-1)!.replace(/\.vtt$/i, "");
  const lang = base.match(/\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/i);
  return lang ? lang[1]! : "subtitles";
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  parentPath,
  type Course,
  type Library,
  type User,
} from "@courseo/shared";
import { api, ApiRequestError, fileUrl } from "../api.js";
import { FriendlyName } from "./FriendlyName.js";
import { InlineRename } from "./InlineRename.js";

export function CourseBrowser({
  user,
  editMode,
}: {
  user: User;
  editMode: boolean;
}) {
  const canEdit = user.isAdmin && editMode;
  const libraryId = Number(useParams().libraryId);
  const [library, setLibrary] = useState<Library | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [addingAuthor, setAddingAuthor] = useState(false);
  const [movingId, setMovingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [lib, courseList] = await Promise.all([
        api.libraries.get(libraryId),
        api.libraries.courses(libraryId),
      ]);
      setLibrary(lib);
      setCourses(courseList);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "failed to load courses",
      );
    }
  }, [libraryId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRescan() {
    setRescanning(true);
    try {
      setCourses(await api.libraries.rescan(libraryId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "rescan failed");
    } finally {
      setRescanning(false);
    }
  }

  if (error) return <p className="form-error">{error}</p>;
  if (!library || !courses) return null;

  // Group by the author/organization folder; ungrouped courses sit at the
  // library root.
  const groups = new Map<string, Course[]>();
  for (const course of courses) {
    const author = parentPath(course.relPath);
    const list = groups.get(author);
    if (list) list.push(course);
    else groups.set(author, [course]);
  }

  return (
    <div className="page">
      <nav className="breadcrumbs">
        <Link to="/libraries">Libraries</Link>
        <span>/</span>
        <span>{library.name}</span>
      </nav>
      <div className="page-heading">
        <h2>{library.name}</h2>
        <span className="heading-actions">
          {canEdit && !addingAuthor && (
            <button
              className="link-button"
              onClick={() => setAddingAuthor(true)}
            >
              New author
            </button>
          )}
          <button
            className="link-button"
            onClick={handleRescan}
            disabled={rescanning}
          >
            {rescanning ? "Rescanning…" : "Rescan"}
          </button>
        </span>
      </div>

      {addingAuthor && (
        <AddAuthor
          libraryId={libraryId}
          onDone={(created) => {
            setAddingAuthor(false);
            if (created) void load();
          }}
        />
      )}

      {courses.length === 0 && (
        <p className="tagline">
          No courses found. Expected layout: an author/organization folder
          containing course folders.
        </p>
      )}

      {[...groups.entries()].map(([author, groupCourses]) => (
        <section key={author || "(root)"} className="course-group">
          {author && (
            <h3 className="course-group-title">
              {author}
              {canEdit && (
                <InlineRename
                  name={author}
                  label={`Rename ${author}`}
                  onRename={async (newName) => {
                    await api.libraries.renameAuthor(libraryId, author, newName);
                    await load();
                  }}
                />
              )}
            </h3>
          )}
          <ul className="course-grid">
            {groupCourses.map((course) => (
              <li key={course.id} className="course-cell">
                <CoursePoster course={course} />
                <div className="course-cell-meta">
                  <Link
                    className="course-cell-name"
                    to={`/courses/${course.id}`}
                    title={course.name}
                  >
                    <FriendlyName name={course.name} />
                  </Link>
                  {course.stats && course.stats.totalLessons > 0 && (
                    <span className="course-cell-count">
                      {course.stats.completedLessons}/{course.stats.totalLessons}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <button
                    className="link-button course-cell-move"
                    onClick={() =>
                      setMovingId(movingId === course.id ? null : course.id)
                    }
                  >
                    {movingId === course.id ? "Close" : "Move"}
                  </button>
                )}
                {canEdit && movingId === course.id && (
                  <CourseMover
                    course={course}
                    onDone={(moved) => {
                      setMovingId(null);
                      if (moved) void load();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Movie-style poster: the course's cover image when one exists
 * (cover.jpg/png/webp in the course root), otherwise a colored tile with
 * the course name. A thin bar at the bottom shows progress once started.
 */
function CoursePoster({ course }: { course: Course }) {
  const percent =
    course.stats && course.stats.totalLessons > 0
      ? Math.round(
          (course.stats.completedLessons / course.stats.totalLessons) * 100,
        )
      : 0;
  return (
    <Link
      className="poster-card"
      to={`/courses/${course.id}`}
      style={course.cover ? undefined : { background: posterColor(course.name) }}
    >
      {course.cover ? (
        <img
          className="poster-img"
          src={fileUrl(course.id, course.cover)}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="poster-title">
          <FriendlyName name={course.name} />
        </span>
      )}
      {percent > 0 && (
        <span className="poster-progress-track">
          <span
            className="poster-progress-fill"
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
    </Link>
  );
}

/** Stable per-course tile color derived from the name. */
function posterColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(160deg, hsl(${hue} 45% 32%), hsl(${hue} 50% 20%))`;
}

function AddAuthor({
  libraryId,
  onDone,
}: {
  libraryId: number;
  onDone: (created: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.libraries.createAuthor(libraryId, name.trim());
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "creation failed");
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <label>
        Author / organization folder name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jane Author"
          autoFocus
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="panel-actions">
        <button className="link-button" type="button" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create folder"}
        </button>
      </div>
    </form>
  );
}

/**
 * Rename a course and/or move it to a different author folder or library.
 * The author list follows the selected target library.
 */
function CourseMover({
  course,
  onDone,
}: {
  course: Course;
  onDone: (moved: boolean) => void;
}) {
  const currentAuthor = parentPath(course.relPath);
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [libraryId, setLibraryId] = useState(course.libraryId);
  const [authors, setAuthors] = useState<string[] | null>(null);
  const [author, setAuthor] = useState(currentAuthor);
  const [name, setName] = useState(course.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.libraries
      .list()
      .then(setLibraries)
      .catch(() => setError("could not list libraries"));
  }, []);

  useEffect(() => {
    setAuthors(null);
    api.libraries
      .authors(libraryId)
      .then((list) => {
        setAuthors(list);
        setAuthor(
          libraryId === course.libraryId && list.includes(currentAuthor)
            ? currentAuthor
            : (list[0] ?? ""),
        );
      })
      .catch(() => setError("could not list author folders"));
  }, [libraryId, course.libraryId, currentAuthor]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.courses.move(course.id, {
        libraryId: libraryId !== course.libraryId ? libraryId : undefined,
        author: author !== currentAuthor ? author : undefined,
        name: name.trim() !== course.name ? name.trim() : undefined,
      });
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "move failed");
      setBusy(false);
    }
  }

  const libraryChanged = libraryId !== course.libraryId;
  const needsAuthor = (libraryChanged || currentAuthor !== "") && author === "";

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <label>
        Course name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Library
        <select
          value={libraryId}
          onChange={(e) => setLibraryId(Number(e.target.value))}
        >
          {(libraries ?? []).map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Author / organization
        <select value={author} onChange={(e) => setAuthor(e.target.value)}>
          {authors === null && <option value="">Loading…</option>}
          {authors !== null && currentAuthor === "" && !libraryChanged && (
            <option value="">(none — library root)</option>
          )}
          {authors?.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      {authors !== null && authors.length === 0 && (
        <p className="tagline">
          No author folders in this library yet — create one first.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="panel-actions">
        <button className="link-button" type="button" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={busy || needsAuthor}
        >
          {busy ? "Moving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
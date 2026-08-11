import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { parentPath, type Course, type Library } from "@courseo/shared";
import { api, ApiRequestError } from "../api.js";

export function CourseBrowser() {
  const libraryId = Number(useParams().libraryId);
  const [library, setLibrary] = useState<Library | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

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
        <button
          className="link-button"
          onClick={handleRescan}
          disabled={rescanning}
        >
          {rescanning ? "Rescanning…" : "Rescan"}
        </button>
      </div>

      {courses.length === 0 && (
        <p className="tagline">
          No courses found. Expected layout: an author/organization folder
          containing course folders.
        </p>
      )}

      {[...groups.entries()].map(([author, groupCourses]) => (
        <section key={author || "(root)"} className="course-group">
          {author && <h3 className="course-group-title">{author}</h3>}
          <ul className="course-list">
            {groupCourses.map((course) => (
              <li key={course.id}>
                <Link className="course-card" to={`/courses/${course.id}`}>
                  <span className="course-name">{course.name}</span>
                  {course.stats && (
                    <CourseProgress
                      completed={course.stats.completedLessons}
                      total={course.stats.totalLessons}
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CourseProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <span className="course-progress">
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${percent}%` }} />
      </span>
      {completed}/{total}
    </span>
  );
}

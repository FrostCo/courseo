import fs from "node:fs";
import path from "node:path";
import {
  detectLessonType,
  isSubtitleFile,
  joinPath,
  type CourseTreeNode,
  type LessonNode,
} from "@courseo/shared";

/** Natural ordering so "2 Basics" sorts before "10 Advanced". */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export interface ScannedCourse {
  /** Relative to the library root, e.g. "Jane Author/Course One". */
  relPath: string;
  name: string;
  totalLessons: number;
}

interface DirEntries {
  dirs: string[];
  files: string[];
}

function listDir(absDir: string): DirEntries {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return { dirs: [], files: [] };
  }
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) dirs.push(entry.name);
    else if (entry.isFile()) files.push(entry.name);
  }
  dirs.sort(collator.compare);
  files.sort(collator.compare);
  return { dirs, files };
}

/**
 * Discover courses in a library using the documented convention
 * (library → author/organization → course), tolerantly:
 *
 * - A top-level directory is normally an author/organization group, and
 *   each of its subdirectories is a course.
 * - A top-level directory that has no subdirectories, or that directly
 *   contains media files (video/audio), is treated as an ungrouped course
 *   instead — content people can see on disk should not silently vanish.
 */
export function scanLibraryCourses(libraryRoot: string): ScannedCourse[] {
  const courses: ScannedCourse[] = [];
  const top = listDir(libraryRoot);
  for (const groupName of top.dirs) {
    const groupAbs = path.join(libraryRoot, groupName);
    const group = listDir(groupAbs);
    const hasDirectMedia = group.files.some((f) => {
      const type = detectLessonType(f);
      return type === "video" || type === "audio";
    });
    if (group.dirs.length === 0 || hasDirectMedia) {
      // A leaf directory with no lessons at all is an (empty) author
      // folder waiting for content, not a zero-lesson course.
      const candidate = makeCourse(libraryRoot, groupName);
      if (candidate.totalLessons > 0) courses.push(candidate);
    } else {
      for (const courseName of group.dirs) {
        courses.push(makeCourse(libraryRoot, joinPath(groupName, courseName)));
      }
    }
  }
  return courses;
}

/**
 * Top-level directories that act as author/organization groups — every
 * top-level directory that is not itself an ungrouped course. Includes
 * empty folders, so a freshly created author shows up as a destination.
 */
export function listAuthorFolders(libraryRoot: string): string[] {
  const ungrouped = new Set(
    scanLibraryCourses(libraryRoot)
      .filter((c) => !c.relPath.includes("/"))
      .map((c) => c.relPath),
  );
  return listDir(libraryRoot).dirs.filter((dir) => !ungrouped.has(dir));
}

function makeCourse(libraryRoot: string, relPath: string): ScannedCourse {
  const { totalLessons } = scanCourseTree(path.join(libraryRoot, relPath));
  return {
    relPath,
    name: relPath.split("/").at(-1)!,
    totalLessons,
  };
}

export interface ScannedTree {
  children: CourseTreeNode[];
  totalLessons: number;
}

/**
 * Recursively scan a course directory into a tree of lessons. Paths are
 * relative to the course directory and double as progress keys. Files with
 * unknown extensions are omitted; subtitle sidecars (.srt/.vtt) attach to
 * the lesson sharing their basename instead of appearing standalone;
 * directories with no lessons anywhere below are pruned.
 */
export function scanCourseTree(courseDir: string): ScannedTree {
  return scanDir(courseDir, "");
}

function scanDir(absDir: string, relDir: string): ScannedTree {
  const { dirs, files } = listDir(absDir);

  const subtitleFiles = files.filter(isSubtitleFile);
  /** "video.srt" and "video.en.srt" both attach to "video.mp4". */
  const subtitlesFor = (lessonBase: string): string[] =>
    subtitleFiles
      .filter((s) => {
        const base = stripExtension(s);
        return base === lessonBase || base.startsWith(lessonBase + ".");
      })
      .map((s) => joinPath(relDir, s));

  const nodes: CourseTreeNode[] = [];
  let totalLessons = 0;

  for (const dir of dirs) {
    const child = scanDir(path.join(absDir, dir), joinPath(relDir, dir));
    if (child.totalLessons === 0) continue;
    nodes.push({
      kind: "dir",
      name: dir,
      path: joinPath(relDir, dir),
      children: child.children,
    });
    totalLessons += child.totalLessons;
  }

  for (const file of files) {
    if (isSubtitleFile(file)) continue;
    const type = detectLessonType(file);
    if (!type) continue;
    const lesson: LessonNode = {
      kind: "lesson",
      name: file,
      path: joinPath(relDir, file),
      type,
    };
    if (type === "video" || type === "audio") {
      const subtitles = subtitlesFor(stripExtension(file));
      if (subtitles.length > 0) lesson.subtitles = subtitles;
    }
    nodes.push(lesson);
    totalLessons += 1;
  }

  nodes.sort((a, b) => collator.compare(a.name, b.name));
  return { children: nodes, totalLessons };
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

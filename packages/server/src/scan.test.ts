import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanCourseTree, scanLibraryCourses } from "./scan.js";

let root: string;

/** Build a directory tree from a list of relative file paths. */
function makeTree(files: string[]): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-scan-"));
  for (const file of files) {
    const abs = path.join(root, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x");
  }
  return root;
}

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("scanLibraryCourses", () => {
  it("finds courses at author/course depth per the convention", () => {
    makeTree([
      "Jane Author/Course One/intro.mp4",
      "Jane Author/Course Two/notes.md",
      "Some Org/Course Three/lesson.pdf",
    ]);
    const courses = scanLibraryCourses(root);
    expect(courses.map((c) => c.relPath)).toEqual([
      "Jane Author/Course One",
      "Jane Author/Course Two",
      "Some Org/Course Three",
    ]);
    expect(courses[0]).toMatchObject({ name: "Course One", totalLessons: 1 });
  });

  it("treats a top-level dir with direct media as an ungrouped course", () => {
    makeTree([
      "Standalone Course/welcome.mp4",
      "Standalone Course/01 Section/lesson.mp4",
    ]);
    const courses = scanLibraryCourses(root);
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      relPath: "Standalone Course",
      totalLessons: 2,
    });
  });

  it("treats a top-level dir with only files as an ungrouped course", () => {
    makeTree(["Flat Course/slides.pdf", "Flat Course/notes.txt"]);
    expect(scanLibraryCourses(root)).toHaveLength(1);
  });

  it("keeps a group with only stray text files as a group", () => {
    makeTree(["Jane Author/readme.md", "Jane Author/Course One/intro.mp4"]);
    const courses = scanLibraryCourses(root);
    expect(courses.map((c) => c.relPath)).toEqual(["Jane Author/Course One"]);
  });

  it("ignores dotfiles, loose top-level files, and missing roots", () => {
    makeTree(["loose.mp4", ".hidden/Course/intro.mp4"]);
    expect(scanLibraryCourses(root)).toEqual([]);
    expect(scanLibraryCourses(path.join(root, "nope"))).toEqual([]);
  });
});

describe("scanCourseTree", () => {
  it("builds a naturally sorted tree with detected types", () => {
    makeTree([
      "c/2 Basics/b.mp4",
      "c/10 Advanced/a.mp4",
      "c/1 Intro/slides.pdf",
      "c/1 Intro/Final Exam.md",
    ]);
    const tree = scanCourseTree(path.join(root, "c"));
    expect(tree.totalLessons).toBe(4);
    expect(tree.children.map((n) => n.name)).toEqual([
      "1 Intro",
      "2 Basics",
      "10 Advanced",
    ]);
    const intro = tree.children[0]!;
    expect(intro.kind).toBe("dir");
    if (intro.kind === "dir") {
      expect(intro.children).toEqual([
        expect.objectContaining({
          kind: "lesson",
          path: "1 Intro/Final Exam.md",
          type: "quiz",
        }),
        expect.objectContaining({
          kind: "lesson",
          path: "1 Intro/slides.pdf",
          type: "pdf",
        }),
      ]);
    }
  });

  it("attaches subtitles to their video and hides them as lessons", () => {
    makeTree([
      "c/lesson.mp4",
      "c/lesson.srt",
      "c/lesson.en.vtt",
      "c/other.srt",
    ]);
    const tree = scanCourseTree(path.join(root, "c"));
    expect(tree.totalLessons).toBe(1);
    expect(tree.children).toEqual([
      expect.objectContaining({
        name: "lesson.mp4",
        subtitles: ["lesson.en.vtt", "lesson.srt"],
      }),
    ]);
  });

  it("gives the sidecar to the video when audio shares its basename", () => {
    makeTree(["c/course.mp4", "c/course.mp3", "c/course.srt"]);
    const tree = scanCourseTree(path.join(root, "c"));
    const byName = new Map(tree.children.map((n) => [n.name, n]));
    expect(byName.get("course.mp4")).toMatchObject({
      subtitles: ["course.srt"],
    });
    expect(byName.get("course.mp3")).not.toHaveProperty("subtitles");
  });

  it("still attaches subtitles to audio without a matching video", () => {
    makeTree(["c/podcast.mp3", "c/podcast.srt"]);
    const tree = scanCourseTree(path.join(root, "c"));
    expect(tree.children).toEqual([
      expect.objectContaining({
        name: "podcast.mp3",
        subtitles: ["podcast.srt"],
      }),
    ]);
  });

  it("does not attach a subtitle to a lesson that is merely a name prefix", () => {
    makeTree(["c/1.mp4", "c/1.1.mp4", "c/1.1.srt"]);
    const tree = scanCourseTree(path.join(root, "c"));
    const byName = new Map(tree.children.map((n) => [n.name, n]));
    expect(byName.get("1.mp4")).not.toHaveProperty("subtitles");
    expect(byName.get("1.1.mp4")).toMatchObject({ subtitles: ["1.1.srt"] });
  });

  it("skips unknown extensions and prunes empty directories", () => {
    makeTree([
      "c/resources/data.zip",
      "c/empty-ish/.keep",
      "c/01/lesson.mp4",
      "c/01/thumb.png",
    ]);
    const tree = scanCourseTree(path.join(root, "c"));
    expect(tree.totalLessons).toBe(1);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.name).toBe("01");
  });
});

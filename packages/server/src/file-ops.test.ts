import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Course, CourseTreeResponse, Library } from "@courseo/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  TestClient,
  type TestServer,
} from "./test-utils.js";

const ADMIN = {
  username: "richard",
  displayName: "Richard",
  password: "correct horse battery",
};

let server: TestServer;
let admin: TestClient;
let librariesRoot: string;
let personal: Library;
let family: Library;
let course: Course;

async function getCourses(library: Library): Promise<Course[]> {
  const res = await admin.get(`/api/libraries/${library.id}/courses`);
  return (await res.json()) as Course[];
}

beforeEach(async () => {
  librariesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-fileops-"));
  const courseDir = path.join(librariesRoot, "Personal/Jane/Course One");
  fs.mkdirSync(path.join(courseDir, "01 Intro"), { recursive: true });
  fs.writeFileSync(path.join(courseDir, "01 Intro/video.mp4"), "v");
  fs.writeFileSync(path.join(courseDir, "01 Intro/video.en.vtt"), "s");
  fs.writeFileSync(path.join(courseDir, "notes.md"), "n");
  fs.mkdirSync(path.join(librariesRoot, "Personal/Empty Author"));
  fs.mkdirSync(path.join(librariesRoot, "Family/Bob/Old Course"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(librariesRoot, "Family/Bob/Old Course/intro.md"),
    "x",
  );

  server = await startTestServer({ librariesRoot });
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", ADMIN);
  personal = (await (
    await admin.post("/api/libraries", { name: "Personal", rootPath: "Personal" })
  ).json()) as Library;
  family = (await (
    await admin.post("/api/libraries", { name: "Family", rootPath: "Family" })
  ).json()) as Library;
  course = (await getCourses(personal)).find((c) => c.name === "Course One")!;
  await getCourses(family);
});

afterEach(async () => {
  await server.close();
  fs.rmSync(librariesRoot, { recursive: true, force: true });
});

describe("author folders", () => {
  it("lists author folders including empty ones", async () => {
    const res = await admin.get(`/api/libraries/${personal.id}/authors`);
    expect(await res.json()).toEqual(["Empty Author", "Jane"]);
  });

  it("creates an author folder", async () => {
    const res = await admin.post(`/api/libraries/${personal.id}/authors`, {
      name: "New Org",
    });
    expect(res.status).toBe(201);
    expect(
      fs.statSync(path.join(librariesRoot, "Personal/New Org")).isDirectory(),
    ).toBe(true);
  });

  it("rejects invalid and duplicate folder names", async () => {
    for (const name of ["", "a/b", "..", ".hidden", " padded "]) {
      const res = await admin.post(`/api/libraries/${personal.id}/authors`, {
        name,
      });
      expect(res.status, name).toBe(400);
    }
    const dup = await admin.post(`/api/libraries/${personal.id}/authors`, {
      name: "Jane",
    });
    expect(dup.status).toBe(409);
  });

  it("renames an author folder and keeps course ids and progress", async () => {
    await admin.request("/api/progress", {
      method: "PUT",
      json: { courseId: course.id, lessonPath: "notes.md", completed: true },
    });

    const res = await admin.request(
      `/api/libraries/${personal.id}/authors/Jane`,
      { method: "PATCH", json: { name: "Jane Q. Author" } },
    );
    expect(res.status).toBe(200);
    expect(
      fs.existsSync(path.join(librariesRoot, "Personal/Jane Q. Author/Course One")),
    ).toBe(true);

    const after = await getCourses(personal);
    const moved = after.find((c) => c.id === course.id)!;
    expect(moved.relPath).toBe("Jane Q. Author/Course One");
    expect(moved.stats).toEqual({ totalLessons: 2, completedLessons: 1 });
  });

  it("refuses renaming onto an existing folder", async () => {
    const res = await admin.request(
      `/api/libraries/${personal.id}/authors/Jane`,
      { method: "PATCH", json: { name: "Empty Author" } },
    );
    expect(res.status).toBe(409);
  });
});

describe("course move/rename", () => {
  it("renames a course in place", async () => {
    const res = await admin.post(`/api/courses/${course.id}/move`, {
      name: "Course One (2026)",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Course;
    expect(updated.relPath).toBe("Jane/Course One (2026)");
    expect(updated.name).toBe("Course One (2026)");
    expect(
      fs.existsSync(
        path.join(librariesRoot, "Personal/Jane/Course One (2026)/notes.md"),
      ),
    ).toBe(true);
  });

  it("moves a course to another author", async () => {
    const res = await admin.post(`/api/courses/${course.id}/move`, {
      author: "Empty Author",
    });
    const updated = (await res.json()) as Course;
    expect(updated.relPath).toBe("Empty Author/Course One");
  });

  it("moves a course to another library keeping id and progress", async () => {
    await admin.request("/api/progress", {
      method: "PUT",
      json: { courseId: course.id, lessonPath: "notes.md", completed: true },
    });
    const res = await admin.post(`/api/courses/${course.id}/move`, {
      libraryId: family.id,
      author: "Bob",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Course;
    expect(updated.libraryId).toBe(family.id);
    expect(updated.relPath).toBe("Bob/Course One");

    const familyCourses = await getCourses(family);
    const moved = familyCourses.find((c) => c.id === course.id)!;
    expect(moved.stats).toEqual({ totalLessons: 2, completedLessons: 1 });
    expect((await getCourses(personal)).map((c) => c.id)).not.toContain(
      course.id,
    );
  });

  it("requires the author folder to exist", async () => {
    const res = await admin.post(`/api/courses/${course.id}/move`, {
      author: "No Such Author",
    });
    expect(res.status).toBe(400);
  });

  it("refuses a destination that already exists", async () => {
    fs.mkdirSync(path.join(librariesRoot, "Personal/Empty Author/Course One"));
    const res = await admin.post(`/api/courses/${course.id}/move`, {
      author: "Empty Author",
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid names", async () => {
    for (const name of ["a/b", "..", ".hidden", ""]) {
      const res = await admin.post(`/api/courses/${course.id}/move`, { name });
      expect(res.status, name).toBe(400);
    }
  });

  it("requires admin", async () => {
    await admin.post("/api/users", {
      username: "spouse",
      displayName: "Spouse",
      password: "another passphrase",
    });
    const spouse = new TestClient(server.baseUrl);
    await spouse.post("/api/auth/login", {
      username: "spouse",
      password: "another passphrase",
    });
    const res = await spouse.post(`/api/courses/${course.id}/move`, {
      name: "Hacked",
    });
    expect(res.status).toBe(403);
  });
});

describe("in-course file/folder move", () => {
  function move(from: string, to: string): Promise<Response> {
    return admin.post(`/api/courses/${course.id}/files/move`, { from, to });
  }

  it("renames a file and remaps its progress key", async () => {
    await admin.request("/api/progress", {
      method: "PUT",
      json: {
        courseId: course.id,
        lessonPath: "01 Intro/video.mp4",
        positionSeconds: 33,
      },
    });
    const res = await move("01 Intro/video.mp4", "01 Intro/lecture.mp4");
    expect(res.status).toBe(200);

    const tree = (await (
      await admin.get(`/api/courses/${course.id}/tree`)
    ).json()) as CourseTreeResponse;
    const intro = tree.children.find((n) => n.name === "01 Intro")!;
    expect(intro.kind).toBe("dir");
    const lesson = (intro.kind === "dir" ? intro.children : []).find(
      (n) => n.name === "lecture.mp4",
    );
    expect(lesson?.kind).toBe("lesson");
    expect(
      lesson?.kind === "lesson" ? lesson.progress?.positionSeconds : undefined,
    ).toBe(33);
  });

  it("renames subtitle sidecars along with their media file", async () => {
    await move("01 Intro/video.mp4", "01 Intro/lecture.mp4");
    const dir = fs.readdirSync(
      path.join(librariesRoot, "Personal/Jane/Course One/01 Intro"),
    );
    expect(dir.sort()).toEqual(["lecture.en.vtt", "lecture.mp4"]);
  });

  it("leaves the sidecar with the video when renaming a same-name audio file", async () => {
    const introDir = path.join(
      librariesRoot,
      "Personal/Jane/Course One/01 Intro",
    );
    fs.writeFileSync(path.join(introDir, "video.mp3"), "a");
    await move("01 Intro/video.mp3", "01 Intro/talk.mp3");
    const dir = fs.readdirSync(introDir);
    expect(dir.sort()).toEqual(["talk.mp3", "video.en.vtt", "video.mp4"]);
  });

  it("moves the sidecar with an audio file that has no matching video", async () => {
    const introDir = path.join(
      librariesRoot,
      "Personal/Jane/Course One/01 Intro",
    );
    fs.writeFileSync(path.join(introDir, "podcast.mp3"), "a");
    fs.writeFileSync(path.join(introDir, "podcast.srt"), "s");
    await move("01 Intro/podcast.mp3", "01 Intro/interview.mp3");
    const dir = fs.readdirSync(introDir);
    expect(dir).toContain("interview.mp3");
    expect(dir).toContain("interview.srt");
    expect(dir).not.toContain("podcast.srt");
  });

  it("renames a folder and remaps progress keys by prefix", async () => {
    await admin.request("/api/progress", {
      method: "PUT",
      json: {
        courseId: course.id,
        lessonPath: "01 Intro/video.mp4",
        completed: true,
      },
    });
    const res = await move("01 Intro", "01 Getting Started");
    expect(res.status).toBe(200);

    const tree = (await (
      await admin.get(`/api/courses/${course.id}/tree`)
    ).json()) as CourseTreeResponse;
    expect(tree.stats.completedLessons).toBe(1);
    const dir = tree.children.find((n) => n.name === "01 Getting Started")!;
    const lesson = (dir.kind === "dir" ? dir.children : []).find(
      (n) => n.name === "video.mp4",
    );
    expect(
      lesson?.kind === "lesson" ? lesson.progress?.completed : undefined,
    ).toBe(true);
  });

  it("moves a file between folders", async () => {
    const res = await move("notes.md", "01 Intro/notes.md");
    expect(res.status).toBe(200);
    expect(
      fs.existsSync(
        path.join(librariesRoot, "Personal/Jane/Course One/01 Intro/notes.md"),
      ),
    ).toBe(true);
  });

  it("rejects traversal, escapes, and self-nesting", async () => {
    expect((await move("../secret", "x")).status).toBe(400);
    expect((await move("notes.md", "../../escape.md")).status).toBe(400);
    expect((await move("01 Intro", "01 Intro/sub")).status).toBe(400);

    fs.symlinkSync(
      path.join(librariesRoot, "Family"),
      path.join(librariesRoot, "Personal/Jane/Course One/link"),
    );
    expect((await move("link/Bob", "stolen")).status).toBe(403);
  });

  it("refuses to overwrite and requires an existing destination folder", async () => {
    expect((await move("notes.md", "01 Intro/video.mp4")).status).toBe(409);
    expect((await move("notes.md", "no such dir/notes.md")).status).toBe(400);
  });

  it("404s for a missing source", async () => {
    expect((await move("ghost.md", "renamed.md")).status).toBe(404);
  });
});

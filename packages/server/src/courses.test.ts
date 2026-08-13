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
let library: Library;

beforeEach(async () => {
  librariesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-courses-"));
  for (const file of [
    "Personal/Jane Author/Course One/01 Intro/welcome.mp4",
    "Personal/Jane Author/Course One/01 Intro/welcome.srt",
    "Personal/Jane Author/Course One/02 Wrap/notes.md",
    "Personal/Jane Author/Course Two/lesson.pdf",
  ]) {
    const abs = path.join(librariesRoot, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x");
  }
  server = await startTestServer({ librariesRoot });
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", ADMIN);
  const res = await admin.post("/api/libraries", {
    name: "Personal",
    rootPath: "Personal",
  });
  library = (await res.json()) as Library;
});

afterEach(async () => {
  await server.close();
  fs.rmSync(librariesRoot, { recursive: true, force: true });
});

async function getCourses(client: TestClient): Promise<Course[]> {
  const res = await client.get(`/api/libraries/${library.id}/courses`);
  expect(res.status).toBe(200);
  return (await res.json()) as Course[];
}

describe("course listing", () => {
  it("scans courses on first listing with lesson counts", async () => {
    const courses = await getCourses(admin);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({
      relPath: "Jane Author/Course One",
      name: "Course One",
      stats: { totalLessons: 2, completedLessons: 0 },
    });
  });

  it("keeps course ids stable across rescans and marks removed dirs missing", async () => {
    const before = await getCourses(admin);
    fs.rmSync(path.join(librariesRoot, "Personal/Jane Author/Course Two"), {
      recursive: true,
    });
    fs.mkdirSync(
      path.join(librariesRoot, "Personal/New Org/Course Three"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(librariesRoot, "Personal/New Org/Course Three/a.mp4"),
      "x",
    );

    const res = await admin.post(`/api/libraries/${library.id}/rescan`);
    const after = (await res.json()) as Course[];
    expect(after.map((c) => [c.relPath, c.missing ?? false])).toEqual([
      ["Jane Author/Course One", false],
      ["Jane Author/Course Two", true],
      ["New Org/Course Three", false],
    ]);
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it("reports a cover image when one exists in the course root", async () => {
    fs.writeFileSync(
      path.join(librariesRoot, "Personal/Jane Author/Course One/Cover.JPG"),
      "img",
    );
    const courses = await getCourses(admin);
    const courseOne = courses.find((c) => c.name === "Course One")!;
    // Matched case-insensitively, reported with the on-disk name.
    expect(courseOne.cover).toBe("Cover.JPG");
    expect(courses.find((c) => c.name === "Course Two")!.cover).toBeUndefined();
  });

  it("requires view access", async () => {
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

    let res = await spouse.get(`/api/libraries/${library.id}/courses`);
    expect(res.status).toBe(403);

    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "viewer",
    });
    res = await spouse.get(`/api/libraries/${library.id}/courses`);
    expect(res.status).toBe(200);
  });
});

describe("course tree", () => {
  it("returns the scanned tree with breadcrumb and progress merged", async () => {
    const courses = await getCourses(admin);
    const courseOne = courses.find((c) => c.name === "Course One")!;

    // Seed a progress row directly; the progress endpoint comes later.
    server.db
      .prepare(
        `INSERT INTO progress (user_id, course_id, lesson_path, completed, position_seconds)
         VALUES (1, ?, '01 Intro/welcome.mp4', 1, 42)`,
      )
      .run(courseOne.id);

    const res = await admin.get(`/api/courses/${courseOne.id}/tree`);
    expect(res.status).toBe(200);
    const tree = (await res.json()) as CourseTreeResponse;

    expect(tree.library).toEqual({ id: library.id, name: "Personal" });
    expect(tree.course.name).toBe("Course One");
    expect(tree.stats).toEqual({ totalLessons: 2, completedLessons: 1 });

    const intro = tree.children[0]!;
    expect(intro).toMatchObject({ kind: "dir", name: "01 Intro" });
    if (intro.kind === "dir") {
      expect(intro.children[0]).toMatchObject({
        name: "welcome.mp4",
        type: "video",
        subtitles: ["01 Intro/welcome.srt"],
        progress: { completed: true, positionSeconds: 42 },
      });
    }
  });

  it("enforces access through the owning library", async () => {
    const courses = await getCourses(admin);
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
    const res = await spouse.get(`/api/courses/${courses[0]!.id}/tree`);
    expect(res.status).toBe(403);
  });

  it("404s for unknown courses", async () => {
    const res = await admin.get("/api/courses/999/tree");
    expect(res.status).toBe(404);
  });
});

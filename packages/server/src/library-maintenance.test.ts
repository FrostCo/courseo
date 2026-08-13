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
let courses: Course[];

const libraryDir = () => path.join(librariesRoot, library.rootPath);

async function listLibraryCourses(): Promise<Course[]> {
  return (await (
    await admin.get(`/api/libraries/${library.id}/courses`)
  ).json()) as Course[];
}

beforeEach(async () => {
  librariesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-maint-"));
  const jane = path.join(librariesRoot, "Personal/Jane");
  fs.mkdirSync(path.join(jane, "Course A"), { recursive: true });
  fs.writeFileSync(path.join(jane, "Course A/lesson.mp4"), "x");
  fs.mkdirSync(path.join(jane, "Course B"), { recursive: true });
  fs.writeFileSync(path.join(jane, "Course B/notes.md"), "x");

  server = await startTestServer({ librariesRoot });
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", ADMIN);
  const libRes = await admin.post("/api/libraries", {
    name: "Personal",
    rootPath: "Personal",
  });
  library = (await libRes.json()) as Library;
  courses = await listLibraryCourses();
});

afterEach(async () => {
  await server.close();
  fs.rmSync(librariesRoot, { recursive: true, force: true });
});

describe("missing courses", () => {
  it("marks a vanished course missing instead of deleting it", async () => {
    const courseA = courses.find((c) => c.name === "Course A")!;
    await admin.request("/api/progress", {
      method: "PUT",
      json: { courseId: courseA.id, lessonPath: "lesson.mp4", completed: true },
    });

    fs.rmSync(path.join(libraryDir(), "Jane/Course A"), { recursive: true });
    const after = await listLibraryCourses();

    const gone = after.find((c) => c.id === courseA.id);
    expect(gone).toBeDefined();
    expect(gone!.missing).toBe(true);
    // Progress survives with the record.
    expect(gone!.stats!.completedLessons).toBe(1);

    const tree = (await (
      await admin.get(`/api/courses/${courseA.id}/tree`)
    ).json()) as CourseTreeResponse;
    expect(tree.course.missing).toBe(true);
  });

  it("clears the mark when the folder comes back", async () => {
    const courseA = courses.find((c) => c.name === "Course A")!;
    const dir = path.join(libraryDir(), "Jane/Course A");
    const parked = path.join(librariesRoot, "parked");
    fs.renameSync(dir, parked);
    expect(
      (await listLibraryCourses()).find((c) => c.id === courseA.id)!.missing,
    ).toBe(true);

    fs.renameSync(parked, dir);
    const restored = (await listLibraryCourses()).find(
      (c) => c.id === courseA.id,
    )!;
    expect(restored.missing).toBeUndefined();
  });

  it("does not touch anything when the library root is unreachable", async () => {
    // Simulates an unmounted volume: the whole root vanishes at once.
    fs.renameSync(libraryDir(), path.join(librariesRoot, "unmounted"));
    const during = await listLibraryCourses();
    expect(during).toHaveLength(2);
    expect(during.every((c) => !c.missing)).toBe(true);

    fs.renameSync(path.join(librariesRoot, "unmounted"), libraryDir());
    const after = await listLibraryCourses();
    expect(after).toHaveLength(2);
    expect(after.every((c) => !c.missing)).toBe(true);
  });

  it("purges a single missing course, but refuses a present one", async () => {
    const courseA = courses.find((c) => c.name === "Course A")!;
    let res = await admin.request(`/api/courses/${courseA.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(409);

    fs.rmSync(path.join(libraryDir(), "Jane/Course A"), { recursive: true });
    await listLibraryCourses(); // sync marks it missing
    res = await admin.request(`/api/courses/${courseA.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await listLibraryCourses()).toHaveLength(1);
  });

  it("purges all missing courses in a library at once", async () => {
    fs.rmSync(path.join(libraryDir(), "Jane/Course A"), { recursive: true });
    await listLibraryCourses();

    const res = await admin.post(`/api/libraries/${library.id}/purge-missing`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 1 });
    const remaining = await listLibraryCourses();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe("Course B");
  });

  it("requires admin for purging", async () => {
    await admin.post("/api/users", {
      username: "spouse",
      displayName: "Spouse",
      password: "another passphrase",
    });
    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "editor",
    });
    const spouse = new TestClient(server.baseUrl);
    await spouse.post("/api/auth/login", {
      username: "spouse",
      password: "another passphrase",
    });

    const single = await spouse.request(`/api/courses/${courses[0]!.id}`, {
      method: "DELETE",
    });
    expect(single.status).toBe(403);
    const bulk = await spouse.post(
      `/api/libraries/${library.id}/purge-missing`,
    );
    expect(bulk.status).toBe(403);
  });
});

describe("library folder rename", () => {
  it("renames the folder on disk and keeps courses and progress", async () => {
    const courseA = courses.find((c) => c.name === "Course A")!;
    await admin.request("/api/progress", {
      method: "PUT",
      json: { courseId: courseA.id, lessonPath: "lesson.mp4", completed: true },
    });

    const res = await admin.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      json: { folderName: "Personal Renamed" },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Library;
    expect(updated.rootPath).toBe("Personal Renamed");
    expect(
      fs.existsSync(path.join(librariesRoot, "Personal Renamed/Jane/Course A")),
    ).toBe(true);
    expect(fs.existsSync(path.join(librariesRoot, "Personal"))).toBe(false);

    library = updated;
    const after = await listLibraryCourses();
    expect(after).toHaveLength(2);
    const stillA = after.find((c) => c.id === courseA.id)!;
    expect(stillA.missing).toBeUndefined();
    expect(stillA.stats!.completedLessons).toBe(1);
  });

  it("can rename the folder and display name together", async () => {
    const res = await admin.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      json: { name: "Mine", folderName: "Mine" },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Library;
    expect(updated.name).toBe("Mine");
    expect(updated.rootPath).toBe("Mine");
  });

  it("validates the folder rename", async () => {
    fs.mkdirSync(path.join(librariesRoot, "Occupied"));
    const conflict = await admin.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      json: { folderName: "Occupied" },
    });
    expect(conflict.status).toBe(409);

    for (const bad of ["", "../escape", "a/b", ".hidden"]) {
      const res = await admin.request(`/api/libraries/${library.id}`, {
        method: "PATCH",
        json: { folderName: bad },
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("requires admin to rename the folder", async () => {
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
    const res = await spouse.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      json: { folderName: "Grabbed" },
    });
    expect(res.status).toBe(403);
  });
});

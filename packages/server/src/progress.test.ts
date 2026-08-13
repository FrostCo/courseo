import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  Course,
  CourseTreeResponse,
  LessonProgress,
  Library,
} from "@courseo/shared";
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
let course: Course;

beforeEach(async () => {
  librariesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-progress-"));
  const courseDir = path.join(librariesRoot, "Personal/Jane/Course One");
  fs.mkdirSync(courseDir, { recursive: true });
  fs.writeFileSync(path.join(courseDir, "lesson.mp4"), "x");
  fs.writeFileSync(path.join(courseDir, "notes.md"), "x");

  server = await startTestServer({ librariesRoot });
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", ADMIN);
  const libRes = await admin.post("/api/libraries", {
    name: "Personal",
    rootPath: "Personal",
  });
  const library = (await libRes.json()) as Library;
  const courses = (await (
    await admin.get(`/api/libraries/${library.id}/courses`)
  ).json()) as Course[];
  course = courses[0]!;
});

afterEach(async () => {
  await server.close();
  fs.rmSync(librariesRoot, { recursive: true, force: true });
});

function put(client: TestClient, json: unknown): Promise<Response> {
  return client.request("/api/progress", { method: "PUT", json });
}

describe("progress", () => {
  it("saves playback position and completion independently", async () => {
    let res = await put(admin, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      positionSeconds: 42.5,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as LessonProgress).toMatchObject({
      completed: false,
      positionSeconds: 42.5,
    });

    // Completing must not clobber the stored position.
    res = await put(admin, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      completed: true,
    });
    expect((await res.json()) as LessonProgress).toMatchObject({
      completed: true,
      positionSeconds: 42.5,
    });

    // And saving position must not clobber completion.
    res = await put(admin, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      positionSeconds: 60,
    });
    expect((await res.json()) as LessonProgress).toMatchObject({
      completed: true,
      positionSeconds: 60,
    });
  });

  it("shows up in the course tree and stats", async () => {
    await put(admin, {
      courseId: course.id,
      lessonPath: "notes.md",
      completed: true,
    });
    const tree = (await (
      await admin.get(`/api/courses/${course.id}/tree`)
    ).json()) as CourseTreeResponse;
    expect(tree.stats).toEqual({ totalLessons: 2, completedLessons: 1 });
  });

  it("can un-complete a lesson", async () => {
    await put(admin, {
      courseId: course.id,
      lessonPath: "notes.md",
      completed: true,
    });
    const res = await put(admin, {
      courseId: course.id,
      lessonPath: "notes.md",
      completed: false,
    });
    expect((await res.json()) as LessonProgress).toMatchObject({
      completed: false,
    });
  });

  it("lets shared viewers track their own progress", async () => {
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

    // No access yet.
    let res = await put(spouse, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      completed: true,
    });
    expect(res.status).toBe(403);

    await admin.post(`/api/libraries/${course.libraryId}/shares`, {
      userId: 2,
      role: "viewer",
    });
    res = await put(spouse, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      completed: true,
    });
    expect(res.status).toBe(200);

    // Progress is per-user: the owner's tree is unaffected.
    const tree = (await (
      await admin.get(`/api/courses/${course.id}/tree`)
    ).json()) as CourseTreeResponse;
    expect(tree.stats.completedLessons).toBe(0);
  });

  it("validates the payload", async () => {
    for (const bad of [
      { courseId: course.id },
      { courseId: course.id, lessonPath: "../escape", completed: true },
      { courseId: course.id, lessonPath: "lesson.mp4", positionSeconds: -1 },
      { courseId: course.id, lessonPath: "lesson.mp4" },
      { lessonPath: "lesson.mp4", completed: true },
    ]) {
      const res = await put(admin, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("rejects progress for files that do not exist", async () => {
    const res = await put(admin, {
      courseId: course.id,
      lessonPath: "ghost.mp4",
      completed: true,
    });
    expect(res.status).toBe(404);
  });
});

function putBulk(client: TestClient, json: unknown): Promise<Response> {
  return client.request("/api/progress/bulk", { method: "PUT", json });
}

describe("bulk progress", () => {
  it("marks and clears many lessons at once", async () => {
    let res = await putBulk(admin, {
      courseId: course.id,
      lessonPaths: ["lesson.mp4", "notes.md"],
      completed: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });

    let tree = (await (
      await admin.get(`/api/courses/${course.id}/tree`)
    ).json()) as CourseTreeResponse;
    expect(tree.stats).toEqual({ totalLessons: 2, completedLessons: 2 });

    res = await putBulk(admin, {
      courseId: course.id,
      lessonPaths: ["lesson.mp4", "notes.md"],
      completed: false,
    });
    expect(await res.json()).toEqual({ updated: 2 });
    tree = (await (
      await admin.get(`/api/courses/${course.id}/tree`)
    ).json()) as CourseTreeResponse;
    expect(tree.stats.completedLessons).toBe(0);
  });

  it("does not clobber playback position", async () => {
    await put(admin, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      positionSeconds: 42.5,
    });
    await putBulk(admin, {
      courseId: course.id,
      lessonPaths: ["lesson.mp4"],
      completed: true,
    });
    const res = await put(admin, {
      courseId: course.id,
      lessonPath: "lesson.mp4",
      positionSeconds: 43,
    });
    expect((await res.json()) as LessonProgress).toMatchObject({
      completed: true,
      positionSeconds: 43,
    });
  });

  it("skips paths whose files no longer exist", async () => {
    const res = await putBulk(admin, {
      courseId: course.id,
      lessonPaths: ["lesson.mp4", "ghost.mp4"],
      completed: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
  });

  it("validates the payload", async () => {
    for (const bad of [
      { courseId: course.id, lessonPaths: [], completed: true },
      { courseId: course.id, lessonPaths: ["../escape"], completed: true },
      { courseId: course.id, lessonPaths: ["lesson.mp4"] },
      { lessonPaths: ["lesson.mp4"], completed: true },
      { courseId: course.id, lessonPaths: "lesson.mp4", completed: true },
    ]) {
      const res = await putBulk(admin, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("requires library access", async () => {
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
    const res = await putBulk(spouse, {
      courseId: course.id,
      lessonPaths: ["lesson.mp4"],
      completed: true,
    });
    expect(res.status).toBe(403);
  });
});

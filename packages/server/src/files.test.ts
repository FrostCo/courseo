import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Course, Library } from "@courseo/shared";
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
  librariesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-files-"));
  const courseDir = path.join(librariesRoot, "Personal/Jane/Course One");
  fs.mkdirSync(path.join(courseDir, "01 Intro"), { recursive: true });
  fs.writeFileSync(path.join(courseDir, "01 Intro/video.mp4"), "0123456789");
  fs.writeFileSync(path.join(courseDir, "01 Intro/slides & notes.pdf"), "%PDF-fake");
  fs.writeFileSync(path.join(librariesRoot, "Personal/secret.txt"), "secret");

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

function fileUrl(rel: string): string {
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  return `/api/courses/${course.id}/files/${encoded}`;
}

describe("file serving", () => {
  it("serves files with correct content types", async () => {
    const video = await admin.get(fileUrl("01 Intro/video.mp4"));
    expect(video.status).toBe(200);
    expect(video.headers.get("content-type")).toBe("video/mp4");
    expect(await video.text()).toBe("0123456789");

    const pdf = await admin.get(fileUrl("01 Intro/slides & notes.pdf"));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
  });

  it("supports range requests with 206 responses", async () => {
    const res = await admin.get(fileUrl("01 Intro/video.mp4"), {
      headers: { Range: "bytes=2-5" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("2345");
  });

  it("rejects traversal attempts", async () => {
    for (const rel of ["../secret.txt", "01 Intro/../../secret.txt", "/etc/passwd"]) {
      const encoded = rel.split("/").map(encodeURIComponent).join("/");
      const res = await admin.get(`/api/courses/${course.id}/files/${encoded}`);
      expect([400, 404]).toContain(res.status);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("rejects symlinks escaping the course directory", async () => {
    fs.symlinkSync(
      path.join(librariesRoot, "Personal/secret.txt"),
      path.join(librariesRoot, "Personal/Jane/Course One/link.txt"),
    );
    const res = await admin.get(fileUrl("link.txt"));
    expect(res.status).toBe(403);
  });

  it("enforces library access", async () => {
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
    const res = await spouse.get(fileUrl("01 Intro/video.mp4"));
    expect(res.status).toBe(403);
  });

  it("404s for missing files and unknown courses", async () => {
    expect((await admin.get(fileUrl("01 Intro/nope.mp4"))).status).toBe(404);
    expect(
      (await admin.get("/api/courses/999/files/x.mp4")).status,
    ).toBe(404);
  });

  it("requires authentication", async () => {
    const anon = new TestClient(server.baseUrl);
    expect((await anon.get(fileUrl("01 Intro/video.mp4"))).status).toBe(401);
  });
});

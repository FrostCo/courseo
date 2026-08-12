import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  TestClient,
  type TestServer,
} from "./test-utils.js";

let server: TestServer;
let admin: TestClient;

beforeEach(async () => {
  server = await startTestServer();
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", {
    username: "richard",
    displayName: "Richard",
    password: "correct horse battery",
  });
});

afterEach(async () => {
  await server.close();
});

describe("GET /api/backup", () => {
  it("streams a valid SQLite snapshot as a download", async () => {
    const res = await admin.get("/api/backup");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="courseo-backup-.*\.db"$/,
    );

    const bytes = Buffer.from(await res.arrayBuffer());
    // SQLite files start with the magic header "SQLite format 3\0".
    expect(bytes.subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("is admin-only", async () => {
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

    const res = await spouse.get("/api/backup");
    expect(res.status).toBe(403);

    const anonymous = new TestClient(server.baseUrl);
    expect((await anonymous.get("/api/backup")).status).toBe(401);
  });
});

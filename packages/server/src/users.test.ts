import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { User } from "@courseo/shared";
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

beforeEach(async () => {
  server = await startTestServer();
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", ADMIN);
});

afterEach(() => server.close());

async function createRegularUser(): Promise<TestClient> {
  await admin.post("/api/users", {
    username: "viewer",
    displayName: "Viewer",
    password: "another passphrase",
  });
  const client = new TestClient(server.baseUrl);
  await client.post("/api/auth/login", {
    username: "viewer",
    password: "another passphrase",
  });
  return client;
}

describe("user management", () => {
  it("requires auth to list users, and returns public fields only", async () => {
    expect((await new TestClient(server.baseUrl).get("/api/users")).status).toBe(401);

    const res = await admin.get("/api/users");
    expect(res.status).toBe(200);
    const users = (await res.json()) as User[];
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ username: "richard", isAdmin: true });
    expect(users[0]).not.toHaveProperty("passwordHash");
    expect(users[0]).not.toHaveProperty("password_hash");
  });

  it("lets admins create users who can then log in", async () => {
    const res = await admin.post("/api/users", {
      username: "spouse",
      displayName: "Spouse",
      password: "a fine password",
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as User).toMatchObject({
      username: "spouse",
      isAdmin: false,
    });

    const client = new TestClient(server.baseUrl);
    const login = await client.post("/api/auth/login", {
      username: "spouse",
      password: "a fine password",
    });
    expect(login.status).toBe(200);
  });

  it("can create additional admins explicitly", async () => {
    const res = await admin.post("/api/users", {
      username: "co-admin",
      displayName: "Co Admin",
      password: "a fine password",
      isAdmin: true,
    });
    expect(((await res.json()) as User).isAdmin).toBe(true);
  });

  it("rejects duplicate usernames case-insensitively", async () => {
    const res = await admin.post("/api/users", {
      username: "RICHARD",
      displayName: "Impostor",
      password: "a fine password",
    });
    expect(res.status).toBe(409);
  });

  it("forbids non-admins from creating users but lets them list", async () => {
    const viewer = await createRegularUser();
    const create = await viewer.post("/api/users", {
      username: "sneaky",
      displayName: "Sneaky",
      password: "a fine password",
    });
    expect(create.status).toBe(403);

    const list = await viewer.get("/api/users");
    expect(list.status).toBe(200);
    expect((await list.json()) as User[]).toHaveLength(2);
  });

  it("validates new-user fields", async () => {
    const res = await admin.post("/api/users", {
      username: "ok",
      displayName: "Ok",
      password: "short",
    });
    expect(res.status).toBe(400);
  });
});

describe("user updates (admin)", () => {
  function patchUser(
    client: TestClient,
    id: number,
    json: unknown,
  ): Promise<Response> {
    return client.request(`/api/users/${id}`, { method: "PATCH", json });
  }

  it("updates display name and admin flag", async () => {
    await createRegularUser();
    let res = await patchUser(admin, 2, {
      displayName: "Renamed Viewer",
      isAdmin: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as User).toMatchObject({
      displayName: "Renamed Viewer",
      isAdmin: true,
    });

    res = await patchUser(admin, 2, { isAdmin: false });
    expect(((await res.json()) as User).isAdmin).toBe(false);
  });

  it("refuses to demote the last admin", async () => {
    const res = await patchUser(admin, 1, { isAdmin: false });
    expect(res.status).toBe(400);

    // With a second admin present, demotion works.
    await admin.post("/api/users", {
      username: "co-admin",
      displayName: "Co Admin",
      password: "a fine password",
      isAdmin: true,
    });
    expect((await patchUser(admin, 1, { isAdmin: false })).status).toBe(200);
  });

  it("resets a password and signs the user out everywhere", async () => {
    const viewer = await createRegularUser();
    expect((await viewer.get("/api/me")).status).toBe(200);

    const res = await patchUser(admin, 2, { password: "a brand new secret" });
    expect(res.status).toBe(200);

    // Old session is dead; the new password works.
    expect((await viewer.get("/api/me")).status).toBe(401);
    const login = await viewer.post("/api/auth/login", {
      username: "viewer",
      password: "a brand new secret",
    });
    expect(login.status).toBe(200);
  });

  it("validates fields and 404s on unknown users", async () => {
    expect((await patchUser(admin, 99, { isAdmin: true })).status).toBe(404);
    await createRegularUser();
    expect((await patchUser(admin, 2, { password: "short" })).status).toBe(400);
    expect((await patchUser(admin, 2, { displayName: "" })).status).toBe(400);
  });

  it("is admin-only", async () => {
    const viewer = await createRegularUser();
    const res = await patchUser(viewer, 2, { displayName: "Self Serve" });
    expect(res.status).toBe(403);
  });
});

describe("user deletion (admin)", () => {
  it("deletes a user and invalidates their sessions", async () => {
    const viewer = await createRegularUser();
    const res = await admin.request("/api/users/2", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await viewer.get("/api/me")).status).toBe(401);
    expect((await admin.get("/api/users").then((r) => r.json())) as User[]).toHaveLength(1);
  });

  it("refuses self-deletion", async () => {
    const res = await admin.request("/api/users/1", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("refuses deleting a user who still owns libraries", async () => {
    const librariesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-users-"));
    fs.mkdirSync(path.join(librariesRoot, "Theirs"));
    const ownServer = await startTestServer({ librariesRoot });
    try {
      const owner = new TestClient(ownServer.baseUrl);
      await owner.post("/api/setup", ADMIN);
      // A second admin who owns a library.
      await owner.post("/api/users", {
        username: "co-admin",
        displayName: "Co Admin",
        password: "a fine password",
        isAdmin: true,
      });
      const coAdmin = new TestClient(ownServer.baseUrl);
      await coAdmin.post("/api/auth/login", {
        username: "co-admin",
        password: "a fine password",
      });
      const created = await coAdmin.post("/api/libraries", {
        name: "Theirs",
        rootPath: "Theirs",
      });
      expect(created.status).toBe(201);

      const res = await owner.request("/api/users/2", { method: "DELETE" });
      expect(res.status).toBe(409);
    } finally {
      await ownServer.close();
      fs.rmSync(librariesRoot, { recursive: true, force: true });
    }
  });
});

describe("change own password", () => {
  function changePassword(client: TestClient, json: unknown): Promise<Response> {
    return client.request("/api/me/password", { method: "PUT", json });
  }

  it("requires the correct current password", async () => {
    const res = await changePassword(admin, {
      currentPassword: "wrong password",
      newPassword: "a new long password",
    });
    expect(res.status).toBe(403);
  });

  it("changes the password, keeps this session, kills others", async () => {
    // A second session for the same account (another device).
    const otherDevice = new TestClient(server.baseUrl);
    await otherDevice.post("/api/auth/login", {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    expect((await otherDevice.get("/api/me")).status).toBe(200);

    const res = await changePassword(admin, {
      currentPassword: ADMIN.password,
      newPassword: "a new long password",
    });
    expect(res.status).toBe(200);

    // The changing session got re-issued and still works; the other died.
    expect((await admin.get("/api/me")).status).toBe(200);
    expect((await otherDevice.get("/api/me")).status).toBe(401);

    // Only the new password logs in now.
    const oldLogin = await new TestClient(server.baseUrl).post("/api/auth/login", {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await new TestClient(server.baseUrl).post("/api/auth/login", {
      username: ADMIN.username,
      password: "a new long password",
    });
    expect(newLogin.status).toBe(200);
  });

  it("validates the new password", async () => {
    const res = await changePassword(admin, {
      currentPassword: ADMIN.password,
      newPassword: "short",
    });
    expect(res.status).toBe(400);
  });
});

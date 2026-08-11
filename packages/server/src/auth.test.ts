import type { User } from "@courseo/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./auth.js";
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

afterEach(() => server.close());

describe("first-run setup", () => {
  beforeEach(async () => {
    server = await startTestServer();
  });

  it("reports needsSetup until the first user exists", async () => {
    const client = new TestClient(server.baseUrl);
    let res = await client.get("/api/setup");
    expect(await res.json()).toEqual({ needsSetup: true });

    res = await client.post("/api/setup", ADMIN);
    expect(res.status).toBe(201);
    const user = await res.json();
    expect(user).toMatchObject({
      username: "richard",
      displayName: "Richard",
      isAdmin: true,
    });

    res = await client.get("/api/setup");
    expect(await res.json()).toEqual({ needsSetup: false });
  });

  it("logs the admin in immediately", async () => {
    const client = new TestClient(server.baseUrl);
    await client.post("/api/setup", ADMIN);
    const res = await client.get("/api/me");
    expect(res.status).toBe(200);
    expect(((await res.json()) as User).username).toBe("richard");
  });

  it("rejects setup once completed", async () => {
    const client = new TestClient(server.baseUrl);
    await client.post("/api/setup", ADMIN);
    const res = await client.post("/api/setup", {
      ...ADMIN,
      username: "intruder",
    });
    expect(res.status).toBe(409);
  });

  it("validates username and password", async () => {
    const client = new TestClient(server.baseUrl);
    for (const bad of [
      { ...ADMIN, username: "../etc" },
      { ...ADMIN, username: "" },
      { ...ADMIN, password: "short" },
      { ...ADMIN, displayName: "   " },
      { username: ADMIN.username },
    ]) {
      const res = await client.post("/api/setup", bad);
      expect(res.status).toBe(400);
    }
  });

  it("sets an httpOnly lax session cookie", async () => {
    const res = await fetch(`${server.baseUrl}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ADMIN),
    });
    const cookie = res.headers.getSetCookie()[0]!;
    expect(cookie).toContain("courseo_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("login and sessions", () => {
  beforeEach(async () => {
    server = await startTestServer();
    await new TestClient(server.baseUrl).post("/api/setup", ADMIN);
  });

  it("rejects requests without a session", async () => {
    const res = await new TestClient(server.baseUrl).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("logs in with correct credentials, case-insensitive username", async () => {
    const client = new TestClient(server.baseUrl);
    const res = await client.post("/api/auth/login", {
      username: "RICHARD",
      password: ADMIN.password,
    });
    expect(res.status).toBe(200);
    const me = (await (await client.get("/api/me")).json()) as User;
    expect(me.username).toBe("richard");
  });

  it("rejects wrong passwords and unknown users identically", async () => {
    const client = new TestClient(server.baseUrl);
    for (const attempt of [
      { username: ADMIN.username, password: "wrong password" },
      { username: "nobody", password: "wrong password" },
    ]) {
      const res = await client.post("/api/auth/login", attempt);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "invalid username or password",
      });
    }
  });

  it("logout invalidates the session immediately", async () => {
    const client = new TestClient(server.baseUrl);
    await client.post("/api/auth/login", {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    expect((await client.get("/api/me")).status).toBe(200);
    await client.post("/api/auth/logout");
    expect((await client.get("/api/me")).status).toBe(401);
  });

  it("server-side session deletion revokes access on the next request", async () => {
    const client = new TestClient(server.baseUrl);
    await client.post("/api/auth/login", {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    server.sessions.deleteForUser(1);
    expect((await client.get("/api/me")).status).toBe(401);
  });

  it("sessions survive a restart (new store from the same DB)", async () => {
    const client = new TestClient(server.baseUrl);
    await client.post("/api/auth/login", {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    const restarted = new SessionStore(server.db, 1000 * 60);
    const row = server.db
      .prepare("SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1")
      .get() as { id: string };
    expect(restarted.getUserId(row.id)).toBe(1);
  });

  it("expired sessions are rejected and swept", async () => {
    const expired = server.sessions.create(1);
    server.db
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), expired.id);
    // Cache still holds the old expiry; force-reload to simulate restart.
    const reloaded = new SessionStore(server.db, 1000);
    expect(reloaded.getUserId(expired.id)).toBeNull();

    server.sessions.sweep();
    const count = server.db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?")
      .get(expired.id) as { n: number };
    expect(count.n).toBe(0);
  });
});

describe("sso auto-login", () => {
  const ssoConfig = { trustProxy: true, ssoUserHeader: "Remote-User" };

  it("logs in an existing user from the identity header", async () => {
    server = await startTestServer(ssoConfig);
    const client = new TestClient(server.baseUrl);
    await client.post("/api/setup", ADMIN);

    const res = await fetch(`${server.baseUrl}/api/me`, {
      headers: { "Remote-User": "richard" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as User).username).toBe("richard");
    expect(res.headers.getSetCookie()[0]).toContain("courseo_session=");
  });

  it("auto-provisions a regular user on first sight", async () => {
    server = await startTestServer(ssoConfig);
    await new TestClient(server.baseUrl).post("/api/setup", ADMIN);

    const res = await fetch(`${server.baseUrl}/api/me`, {
      headers: { "Remote-User": "spouse" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      username: "spouse",
      isAdmin: false,
    });
  });

  it("does nothing before first-run setup", async () => {
    server = await startTestServer(ssoConfig);
    const res = await fetch(`${server.baseUrl}/api/me`, {
      headers: { "Remote-User": "spouse" },
    });
    expect(res.status).toBe(401);
  });

  it("ignores the header entirely when sso is not configured", async () => {
    server = await startTestServer();
    await new TestClient(server.baseUrl).post("/api/setup", ADMIN);
    const res = await fetch(`${server.baseUrl}/api/me`, {
      headers: { "Remote-User": "richard" },
    });
    expect(res.status).toBe(401);
  });
});

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

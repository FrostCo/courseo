import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Library, LibraryShare } from "@courseo/shared";
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

/** Fresh parent mount with the given subfolders, like /libraries in Docker. */
function makeLibrariesRoot(subfolders: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-libs-"));
  for (const dir of subfolders) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
}

beforeEach(async () => {
  librariesRoot = makeLibrariesRoot(["Personal", "Family"]);
  server = await startTestServer({ librariesRoot });
  admin = new TestClient(server.baseUrl);
  await admin.post("/api/setup", ADMIN);
});

afterEach(async () => {
  await server.close();
  fs.rmSync(librariesRoot, { recursive: true, force: true });
});

async function loginAs(
  username: string,
  opts: { isAdmin?: boolean } = {},
): Promise<TestClient> {
  await admin.post("/api/users", {
    username,
    displayName: username,
    password: "another passphrase",
    isAdmin: opts.isAdmin ?? false,
  });
  const client = new TestClient(server.baseUrl);
  await client.post("/api/auth/login", {
    username,
    password: "another passphrase",
  });
  return client;
}

async function createLibrary(
  client: TestClient,
  name = "Personal",
  rootPath = "Personal",
): Promise<Library> {
  const res = await client.post("/api/libraries", { name, rootPath });
  expect(res.status).toBe(201);
  return (await res.json()) as Library;
}

describe("library creation", () => {
  it("lets an admin register an existing subfolder as a library", async () => {
    const library = await createLibrary(admin);
    expect(library).toMatchObject({
      name: "Personal",
      rootPath: "Personal",
      ownerUserId: 1,
      access: "owner",
    });
  });

  it("forbids non-admins", async () => {
    const user = await loginAs("viewer");
    const res = await user.post("/api/libraries", {
      name: "Nope",
      rootPath: "Family",
    });
    expect(res.status).toBe(403);
  });

  it("rejects traversal, absolute, and nonexistent rootPaths", async () => {
    for (const rootPath of [
      "../outside",
      "/etc",
      "Personal/../..",
      "DoesNotExist",
      "",
      ".",
    ]) {
      const res = await admin.post("/api/libraries", {
        name: "Bad",
        rootPath,
      });
      expect(res.status, `rootPath=${JSON.stringify(rootPath)}`).toBe(400);
    }
  });

  it("rejects symlinks that escape the libraries root", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "courseo-out-"));
    fs.symlinkSync(outside, path.join(librariesRoot, "sneaky"));
    const res = await admin.post("/api/libraries", {
      name: "Sneaky",
      rootPath: "sneaky",
    });
    expect(res.status).toBe(400);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("rejects a folder already claimed by another library", async () => {
    await createLibrary(admin);
    const res = await admin.post("/api/libraries", {
      name: "Duplicate",
      rootPath: "Personal",
    });
    expect(res.status).toBe(409);
  });

  it("lists only unclaimed subfolders for the picker", async () => {
    let res = await admin.get("/api/libraries/roots");
    expect(await res.json()).toEqual(["Family", "Personal"]);

    await createLibrary(admin);
    res = await admin.get("/api/libraries/roots");
    expect(await res.json()).toEqual(["Family"]);
  });
});

describe("library visibility and sharing", () => {
  it("hides libraries until shared, then applies the shared role", async () => {
    const library = await createLibrary(admin);
    const spouse = await loginAs("spouse");

    expect(await (await spouse.get("/api/libraries")).json()).toEqual([]);

    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "viewer",
    });
    const visible = (await (await spouse.get("/api/libraries")).json()) as Library[];
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ id: library.id, access: "viewer" });
  });

  it("revokes access on the very next request", async () => {
    const library = await createLibrary(admin);
    const spouse = await loginAs("spouse");
    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "viewer",
    });
    expect(
      (await (await spouse.get("/api/libraries")).json()) as Library[],
    ).toHaveLength(1);

    await admin.request(`/api/libraries/${library.id}/shares/2`, {
      method: "DELETE",
    });
    expect(await (await spouse.get("/api/libraries")).json()).toEqual([]);
  });

  it("upserts role changes", async () => {
    const library = await createLibrary(admin);
    const spouse = await loginAs("spouse");
    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "viewer",
    });
    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "editor",
    });

    const shares = (await (
      await admin.get(`/api/libraries/${library.id}/shares`)
    ).json()) as LibraryShare[];
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ userId: 2, role: "editor" });

    const visible = (await (await spouse.get("/api/libraries")).json()) as Library[];
    expect(visible[0]!.access).toBe("editor");
  });

  it("rejects invalid roles, unknown users, and sharing with the owner", async () => {
    const library = await createLibrary(admin);
    await loginAs("spouse");
    const cases: [unknown, number][] = [
      [{ userId: 2, role: "root" }, 400],
      [{ userId: 999, role: "viewer" }, 404],
      [{ userId: 1, role: "viewer" }, 400],
      [{ role: "viewer" }, 400],
    ];
    for (const [body, expected] of cases) {
      const res = await admin.post(`/api/libraries/${library.id}/shares`, body);
      expect(res.status, JSON.stringify(body)).toBe(expected);
    }
  });

  it("forbids share management by non-owner non-admins, even with a share", async () => {
    const library = await createLibrary(admin);
    const spouse = await loginAs("spouse");
    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "editor",
    });
    const res = await spouse.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "editor",
    });
    expect(res.status).toBe(403);
  });
});

describe("library management", () => {
  it("owner can rename; a shared editor cannot", async () => {
    const library = await createLibrary(admin);
    const spouse = await loginAs("spouse");
    await admin.post(`/api/libraries/${library.id}/shares`, {
      userId: 2,
      role: "editor",
    });

    const renamed = await admin.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      json: { name: "My Courses" },
    });
    expect(((await renamed.json()) as Library).name).toBe("My Courses");

    const forbidden = await spouse.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      json: { name: "Hijacked" },
    });
    expect(forbidden.status).toBe(403);
  });

  it("a global admin can manage another owner's library without content access", async () => {
    const owner = await loginAs("owner", { isAdmin: true });
    const library = await createLibrary(owner, "Family", "Family");

    // Admin (richard) does not see it in their list...
    const list = (await (await admin.get("/api/libraries")).json()) as Library[];
    expect(list.map((l) => l.id)).not.toContain(library.id);

    // ...but can manage shares on it.
    const res = await admin.get(`/api/libraries/${library.id}/shares`);
    expect(res.status).toBe(200);
  });

  it("delete unregisters the library but leaves files on disk", async () => {
    const library = await createLibrary(admin);
    const res = await admin.request(`/api/libraries/${library.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await (await admin.get("/api/libraries")).json()).toEqual([]);
    expect(fs.existsSync(path.join(librariesRoot, "Personal"))).toBe(true);
  });

  it("returns 404 for unknown libraries", async () => {
    const res = await admin.get("/api/libraries/999/shares");
    expect(res.status).toBe(404);
  });
});

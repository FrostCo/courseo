import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { openTestDatabase } from "./db.js";

const testConfig: Config = {
  port: 0,
  dataDir: "/tmp/unused",
  librariesRoot: "/tmp/unused",
  trustProxy: false,
  ssoUserHeader: null,
  sessionTtlDays: 30,
  webDistDir: null,
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(testConfig, openTestDatabase());
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("app", () => {
  it("responds to health checks", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("sets iframe-friendly, nosniff-safe security headers", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("returns JSON 404 for unknown api routes", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

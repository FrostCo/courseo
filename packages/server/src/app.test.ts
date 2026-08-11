import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./test-utils.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

describe("app", () => {
  it("responds to health checks", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("sets iframe-friendly, nosniff-safe security headers", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("returns JSON 404 for unknown api routes", async () => {
    const res = await fetch(`${server.baseUrl}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns JSON 400 for malformed JSON bodies", async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

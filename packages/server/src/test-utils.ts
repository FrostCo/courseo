import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { SessionStore } from "./auth.js";
import type { Config } from "./config.js";
import { openTestDatabase, type AppDatabase } from "./db.js";

const baseConfig: Config = {
  port: 0,
  dataDir: "/tmp/unused",
  librariesRoot: "/tmp/unused",
  trustProxy: false,
  ssoUserHeader: null,
  sessionTtlDays: 30,
  webDistDir: null,
};

export interface TestServer {
  baseUrl: string;
  db: AppDatabase;
  sessions: SessionStore;
  config: Config;
  close: () => Promise<void>;
}

export async function startTestServer(
  overrides: Partial<Config> = {},
): Promise<TestServer> {
  const config = { ...baseConfig, ...overrides };
  const db = openTestDatabase();
  const sessions = new SessionStore(db, config.sessionTtlDays * 24 * 60 * 60 * 1000);
  const app = createApp(config, db, sessions);
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    sessions,
    config,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** Minimal fetch wrapper that remembers cookies like a browser would. */
export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async request(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(init.json);
    }
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      );
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    for (const setCookie of res.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get(path: string, init?: RequestInit): Promise<Response> {
    return this.request(path, init);
  }

  post(path: string, json?: unknown, init?: RequestInit): Promise<Response> {
    return this.request(path, { ...init, method: "POST", json });
  }
}

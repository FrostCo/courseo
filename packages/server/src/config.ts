import path from "node:path";

export interface Config {
  /** HTTP port the single-image deployment listens on. */
  port: number;
  /** Directory for mutable state (SQLite DB). */
  dataDir: string;
  /**
   * Parent mount containing one subfolder per library (spec §7 decision:
   * "add library" in the UI means picking an existing subfolder here).
   */
  librariesRoot: string;
  /** Honor X-Forwarded-* headers. Only enable behind a trusted proxy. */
  trustProxy: boolean;
  /**
   * Opt-in SSO auto-login: name of the identity header injected by a
   * trusted proxy (dash form, e.g. "Remote-User" — spec §6.7). Requires
   * trustProxy; ignored otherwise. Null disables SSO entirely.
   */
  ssoUserHeader: string | null;
  /** Session lifetime; expired rows are swept periodically. */
  sessionTtlDays: number;
  /** Built web UI to serve statically; null runs the API alone (dev). */
  webDistDir: string | null;
}

function envBool(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes"].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const trustProxy = envBool(env.TRUST_PROXY);
  const ssoUserHeader = env.SSO_USER_HEADER?.trim() || null;
  if (ssoUserHeader && !trustProxy) {
    // Never honor identity headers when the app may be directly reachable.
    throw new Error("SSO_USER_HEADER requires TRUST_PROXY=true");
  }
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? "./data"),
    librariesRoot: path.resolve(env.LIBRARIES_ROOT ?? "/libraries"),
    trustProxy,
    ssoUserHeader,
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    webDistDir: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
  };
}

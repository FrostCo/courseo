import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import { authContext, authRouter, ssoAutoLogin, type SessionStore } from "./auth.js";
import { backupRouter } from "./backup.js";
import type { Config } from "./config.js";
import { coursesRouter } from "./courses.js";
import type { AppDatabase } from "./db.js";
import { fileOpsRouter } from "./file-ops.js";
import { filesRouter } from "./files.js";
import { librariesRouter } from "./libraries.js";
import { progressRouter } from "./progress.js";
import { usersRouter } from "./users.js";

export function createApp(
  config: Config,
  db: AppDatabase,
  sessions: SessionStore,
): Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) {
    app.set("trust proxy", true);
  }

  // Baseline security headers (spec §6.3/§6.4): iframe-friendly for our own
  // origin (in-page PDF/HTML viewers), strict Content-Types under nosniff.
  app.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use(express.json());

  // Unauthenticated; used by the Docker healthcheck (spec §6.1).
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(authContext(db, sessions));
  if (config.ssoUserHeader) {
    // loadConfig guarantees trustProxy is set when this header is configured.
    app.use(ssoAutoLogin(db, sessions, config, config.ssoUserHeader));
  }

  app.use("/api", authRouter(db, sessions, config));
  app.use("/api/backup", backupRouter(db));
  app.use("/api/users", usersRouter(db, sessions));
  app.use("/api/libraries", librariesRouter(db, config));
  app.use("/api/courses", coursesRouter(db, config));
  app.use("/api/courses", filesRouter(db, config));
  app.use("/api/courses", fileOpsRouter(db, config));
  app.use("/api/progress", progressRouter(db, config));

  // API routes (libraries, courses, files, progress, fileops) mount here as
  // they are built.

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // JSON error responses for API failures (bad JSON bodies, handler errors)
  // instead of Express's HTML error page.
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err.status ?? 500;
      if (status >= 500) console.error(err);
      res.status(status).json({ error: status >= 500 ? "internal error" : err.message });
    },
  );

  // Serve the built web UI; SPA fallback for client-side routes.
  if (config.webDistDir && fs.existsSync(config.webDistDir)) {
    const indexHtml = path.join(config.webDistDir, "index.html");
    app.use(express.static(config.webDistDir));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(indexHtml);
    });
  }

  return app;
}

import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";

export function createApp(config: Config, _db: AppDatabase): Express {
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

  // API routes (auth, libraries, courses, files, progress, fileops) mount
  // here as they are built.

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

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

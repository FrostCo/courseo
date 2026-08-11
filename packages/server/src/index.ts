import { createApp } from "./app.js";
import { SessionStore } from "./auth.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";

const config = loadConfig();
const db = openDatabase(config.dataDir);
const sessions = new SessionStore(db, config.sessionTtlDays * 24 * 60 * 60 * 1000);
const app = createApp(config, db, sessions);

// Hourly sweep of expired session rows (spec §4.4).
setInterval(() => sessions.sweep(), 60 * 60 * 1000).unref();

const server = app.listen(config.port, () => {
  console.log(`Courseo listening on http://localhost:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

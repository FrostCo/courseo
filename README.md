# Courseo

**Organize, share, and watch your self-hosted courses.**

Courseo is a self-hosted course library, viewer, and organizer. Point it at folders of downloaded course content (video, audio, PDFs, docs, quizzes) and it turns them into navigable, progress-tracking dashboards — for multiple users, across multiple libraries, with explicit sharing.

The name plays on *course(s)*; the "o" is for **Organizer** — or "**Own** your courses," pick your favorite.

## The "Own" philosophy

- **Own your data** — content stays on your filesystem; Courseo reads and organizes it in place. No lock-in, no cloud dependency — plain files you can back up or move.
- **Own your access** — self-hosted with app-managed accounts and explicit per-library sharing; you decide who sees what.
- **Own your library** — organize, rename, and move content from the UI to keep it the way you want.

## Features

- **Multiple libraries** — several top-level content roots (e.g. Personal, Family), each holding many courses.
- **Multi-user with sharing** — app-managed accounts; owners grant per-library `viewer`/`editor` access, enforced on every endpoint. Admins manage users from the UI; everyone can change their own password.
- **Auto-scanned courses** — folders become navigable trees with lesson types detected by extension (video, audio, PDF, text/markdown, HTML, docs, quizzes).
- **In-page viewers** — stream video/audio with seeking (HTTP range) and `.vtt` subtitle tracks, render PDFs and text/markdown/HTML inline.
- **Per-user progress** — playback position, completion, resume-where-you-left-off, per-course stats.
- **In-UI file management** (admin) — create/rename author folders, move/rename courses across libraries, rename chapters and files; progress and subtitle sidecars follow the files. (No upload or delete in v1.)

## Quick start (Docker)

Courseo ships as a single image serving the API and UI on one HTTP port — no reverse proxy required.

```bash
docker run -d --name courseo \
  -p 3000:3000 \
  -v ./data:/data \
  -v /path/to/your/courses:/libraries \
  ghcr.io/frostco/courseo:latest
```

Or use the [`docker-compose.yml`](docker-compose.yml) in this repo. Then open `http://localhost:3000` — the first run walks you through creating the admin account.

- `/data` holds the SQLite database (all app state).
- `/libraries` is the parent mount: **one subfolder per library** (e.g. `Personal/`, `Family/`). Adding a library in the UI means picking one of these subfolders. Mount it **read-write** — in-UI move/rename needs it; scope the mount tightly.

### Library layout

Courseo expects one directory convention inside the mount:

```text
courses/                  ← the parent mount (→ /libraries)
├── Personal/             ← a library: a shareable group of courses
│   ├── Jane Author/      ← an author or organization
│   │   ├── Course One/   ← a course
│   │   └── Course Two/
│   └── Some Org/
│       └── Course Three/
└── Family/               ← another library
    └── ...
```

- **Library** (top level) — the unit of ownership and sharing. Split by audience (`Personal/`, `Family/`) or however you like. Only want one? Make a single `Courses/` folder and register that — the group level is always required, so a collection can grow into multiple libraries later without moving files.
- **Author / organization** (second level) — who the course is from. This keeps large collections browsable and avoids name collisions between courses.
- **Course** (third level) — a course directory; everything inside it (sections, lessons, resources) is scanned into the course tree.

### Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `/data` | SQLite/state directory |
| `LIBRARIES_ROOT` | `/libraries` | Parent mount containing library subfolders |
| `SESSION_TTL_DAYS` | `30` | Login session lifetime |
| `TRUST_PROXY` | `false` | Honor `X-Forwarded-*` — only behind a trusted proxy |
| `SSO_USER_HEADER` | unset | Opt-in SSO auto-login header (e.g. `Remote-User`); requires `TRUST_PROXY` |

### Behind a reverse proxy (optional)

Courseo is compatible with — but not dependent on — a reverse proxy and SSO (Traefik/Caddy/nginx + Authelia). It serves correct Content-Types, is iframe-friendly on its own origin, survives `nosniff`, and avoids `%2F` in file URLs. To auto-login from a proxy-injected identity header, set `TRUST_PROXY=true` and `SSO_USER_HEADER=Remote-User`; app login always works regardless.

## Development

Requirements: Node 22 (`.nvmrc`) and pnpm (pinned via `packageManager` — `corepack enable` handles it).

```bash
pnpm install
pnpm dev        # server (:3000) + web (Vite, :5173, proxies /api)
pnpm test       # all workspace tests
pnpm typecheck
pnpm build
```

The monorepo has three workspace packages:

- `packages/shared` — API contract types + pure helpers (lesson-type detection, path safety) used by both sides.
- `packages/server` — Express 5 + better-sqlite3 API; serves the built UI in production.
- `packages/web` — React + Vite UI.

See [`docs/spec.md`](docs/spec.md) for the full design (including the hard-won deployment gotchas in §6) and [`DEVELOPMENT.md`](DEVELOPMENT.md) for commit conventions.
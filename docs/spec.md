# Courseo — Project Spec / Handoff

Status: planning. This document is a self-contained brief for building **Courseo**, a **self-hosted course library, viewer, and organizer** built in **Node + React**, replacing the current Python/Flask app (`OfflineU`). It captures what the existing app does, how it can be deployed (standalone by default, optionally behind a reverse proxy/SSO), and the hard-won gotchas discovered while deploying it. It is written to be read cold in a separate agent session with no prior context.

**Tagline:** *Courseo — organize, share, and watch your self-hosted courses.*

---

## Name & philosophy

**Courseo** is a play on *course(s)*; the **"o" stands for Organizer** — Courseo doesn't just play courses, it organizes them across multiple libraries with browsing, sharing, and in-UI move/rename. (Lampshade it in the README: *"the 'o' is for Organizer — or 'Own your courses,' pick your favorite."*)

### The "Own" philosophy
Courseo deliberately drops the "offline" framing of its predecessor. The point isn't being disconnected — it's **ownership**: your course content lives on your hardware, under your accounts, shared on your terms. "Own your courses" captures the value better than "offline":

- **Own your data** — content stays on your filesystem; Courseo reads and organizes it in place. No lock-in, no cloud dependency — plain files you can back up or move.
- **Own your access** — self-hosted with app-managed accounts and explicit per-library sharing; you decide who sees what.
- **Own your library** — organize, rename, and move content from the UI to keep it the way you want.

This ethos should guide product decisions: prefer transparency (plain files, portable data), user control (explicit sharing, no surprises), and no external dependencies for core functionality.

---

## 1. Goal

Replace [`SkippySteve/OfflineU`](https://github.com/SkippySteve/OfflineU) (a fork of [`WhiskeyCoder/OfflineU`](https://github.com/WhiskeyCoder/OfflineU)) with a small, owned Node/React app that:

1. Turns folders of downloaded course content (video/audio/docs/quizzes) into navigable, progress-tracking dashboards.
2. Supports **multiple users** (initially: me, my wife, a shared account) in a **single deployment** — the current app is single-user (one JSON progress file), which would otherwise require running 3 separate containers.
3. Supports **multiple "library" roots** (e.g. Personal, Family) and **browsing many courses** within each — not the single fixed root the current app is limited to.
4. Lets users **share libraries/courses** with other users via permissions.
5. Lets users **manage content from the UI** — scan a course, then move/rename files.
6. Has **simple app-managed login** that works standalone, and can *optionally* defer to a reverse-proxy SSO when one is present (see §4.4).
7. **Runs standalone via Docker** (self-contained: API + static UI + app login), and is **compatible with — but not dependent on — a reverse proxy and SSO** (e.g. Traefik + Authelia) if the operator wants them (see §5).

### Why replace instead of maintain
- The app is tiny (~600 lines of real Python logic + ~1k lines of templates; Flask-only, no DB).
- Both upstream and the fork are effectively abandoned (upstream last commit ~Sep 2025, the fork we run stopped ~Aug 2025 and is behind upstream).
- We already carry a local patch (bind-mounted template) to make PDFs render — a maintenance smell.
- I'm more fluent in Node/React than Python/Flask, and multi-user is a real feature win.

---

## 2. What the existing app does (reference behavior to crib)

Single-file Flask app (`offlineu_core.py`) + 3 Jinja templates. No database; progress is a JSON file on disk.

### Core model
- **Course**: a root directory chosen/loaded by the user (mounted at `/app/courses`).
- **DirectoryNode**: recursive tree of the course folder.
- **Lesson**: a content item derived from a file, with a detected type.
- Progress persisted per-course as JSON under `/app/data`.

### Lesson-type detection (by extension / filename)
- **Video**: `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`
- **Audio**: `.mp3`, `.wav`, `.aac`
- **Text/Docs**: `.txt`, `.md`, `.html`, `.htm`, `.pdf`, `.docx`, `.doc`, `.rtf`
- **Subtitles**: `.srt`, `.vtt` (attached to a video, not standalone lessons)
- **Quiz**: detected when the filename contains `quiz`, `exam`, `test`, etc.

### Routes (≈8)
- `GET /` — landing / current course dashboard
- `GET /browse?path=…` — filesystem browser to pick a course dir (returns JSON)
- `POST /load_course` — set the active course
- `GET /lesson/<path:lesson_path>` — render a lesson (video/audio/text/pdf/quiz)
- `POST /api/progress` — mark completion / save playback position (JSON body)
- `GET /files/<path:filepath>` — **serve the actual media/doc file** (supports HTTP range via Flask `send_file`)
- `GET /health` — health endpoint
- `GET /reset_course` — clear active course

### Progress tracking
- Video/audio: JS `timeupdate` handler POSTs playback seconds to `/api/progress` periodically; completion marked near end.
- Text/pdf/quiz: marked complete via UI.
- Completion stats computed by walking the tree.

### Known limitations to fix in the rebuild
- **Single user** (one progress store).
- **Single course / single root** — you load one course directory at a time; no concept of multiple library roots or browsing many courses side by side.
- **Read-only consumption** — no way to organize/move/rename content from the UI.
- **No sharing model** — nothing to grant one user access to another's content.
- In-page viewer only framed `.html`; everything else (incl. `.pdf`) was `fetch().text()`'d and dumped as raw bytes — we patched it to iframe PDFs too.
- No auth of its own (relies entirely on the reverse proxy).
- No tests, no build step, templates embedded in Python.

---

## 3. Requirements for the new app

### Must have
- **Multiple library roots**: manage several top-level library folders (e.g. Personal, Family), each containing many courses. Users can add/edit/remove libraries from the UI (backed by configured/mounted paths — see §6/§7).
- **Course browsing**: within a library, list and open any course; not limited to one active root at a time.
- Auto-scan a course directory into a navigable tree, with the same lesson-type detection as above (this is the app's real "product knowledge").
- Stream video/audio with **HTTP range support** (seeking/scrubbing).
- Render in-page: video, audio, PDF (native viewer or `pdf.js`), text/markdown, basic HTML.
- **Per-user progress** (playback position + completion) across multiple accounts, keyed per library+course+lesson.
- Resume where you left off; per-course and overall completion stats.
- **Sharing / permissions**: an owner can grant other users access to a library (and/or individual courses). Enforce access on every read/file/progress endpoint.
- **In-UI file management**: scan a course and **move/rename** files/folders from the interface. Must be path-traversal-safe and must keep progress records consistent when paths change (see §6).
- **Simple app-managed login**: username + password, sessions/cookies. Keep it minimal (see §4.4).

### Nice to have
- Quiz rendering (parse quiz files into interactive questions) — current app only detects them.
- Search across courses/lessons.
- Subtitle track support for video (`.srt`/`.vtt`).
- Mobile-friendly layout.
- Bulk file operations, drag-and-drop reorganization, and an undo for moves/renames.
- Optional: interoperate with reverse-proxy SSO headers (e.g. Authelia) when present (see §4.4).

### Explicit non-goals (for v1)
- **Uploading** new content through the browser (move/rename of existing files *is* in scope; ingesting new files is not).
- Deleting content from the UI (leave destructive ops out of v1, or gate them hard).
- Transcoding (serve files as-is; the browser handles playback).

---

## 4. Proposed architecture (Node + React)

Nothing here is prescriptive — adjust to preference.

### Stack
- **Backend**: Node + Express (or Fastify). Express `res.sendFile` / the `send` package gives HTTP range support out of the box (cleaner than Flask here).
- **DB**: SQLite (via `better-sqlite3` or Prisma) for users, libraries, sharing, and progress. SQLite is plenty for a handful of users and makes the multi-user/permissions queries trivial.
- **Frontend**: React (Vite). Component-based viewers per media type.
- **Auth**: simple app-managed login (username + password) — decided; see §4.4.

### 4.1 Suggested layout (pnpm-workspaces monorepo)
Single repo, one deployable Docker image. Three workspace packages so the API and UI can share a typed contract:
```
courseo/
  package.json            # workspace root (private): shared scripts + devDeps
  pnpm-workspace.yaml     # packages: ["packages/*"]
  Dockerfile              # multi-stage: build web -> bundle static build into the server image
  packages/
    shared/               # types shared by server + web (API contracts, enums)
      src/                # keep to types + small PURE helpers (e.g. lesson-type
                          #   detection, path normalization) — no server-only code
    server/               # Node + Express + SQLite
      src/
        index.ts          # express app; serves the API + the built web assets
        auth.ts           # login/logout, sessions (sqlite + in-memory cache), password hashing, current-user
        libraries.ts      # library CRUD + membership/sharing
        permissions.ts    # access checks (does user X have access to library/course Y)
        scan.ts           # recursive course scan + lesson-type detection
        files.ts          # GET /api/files/* with range support (access-checked)
        fileops.ts        # move/rename (path-traversal-safe, updates progress rows)
        progress.ts       # progress + completion endpoints
        db.ts             # sqlite schema + queries + migrations
    web/                  # React (Vite)
      src/
        components/
          Login.tsx
          LibraryList.tsx     # pick/manage library roots
          LibraryManager.tsx  # add/edit/remove libraries + sharing UI
          CourseBrowser.tsx   # list courses within a library
          CourseTree.tsx
          FileManager.tsx     # move/rename UI for a course
          LessonView.tsx      # dispatches to the right viewer
          VideoPlayer.tsx     # <video> + timeupdate -> progress
          AudioPlayer.tsx
          PdfViewer.tsx       # <iframe>/<embed> or pdf.js
          TextViewer.tsx      # md/txt/html
          QuizView.tsx
          ProgressBar.tsx
        api.ts
        App.tsx
```
Notes:
- **Tooling:** pnpm (or npm) workspaces is enough for three packages. Skip Turborepo/Nx unless build times or package count grow — they layer on later without a rewrite.
- **Pin the toolchain:** set an `engines.node` range and a `packageManager` field (e.g. `"packageManager": "pnpm@<x.y.z>"`) in the root `package.json`, and add an `.nvmrc`/`.node-version`. Keeps contributors and the Docker build on the same Node/pnpm and avoids "works on my machine" drift.
- **`shared/` boundary:** types and *pure* helpers only. Putting lesson-type detection here lets server and client classify files identically; keep server-only/runtime code out to avoid import tangles.
- The server serves the built web assets, so the whole app ships as **one image on one port** (see §5.1).

### 4.2 Data model (SQLite)
- `users(id, username, display_name, password_hash, is_admin, created_at)` — password hashed with bcrypt/argon2. `is_admin` can gate library creation / user management.
- `libraries(id, name, root_path, owner_user_id, created_at)` — a top-level content root (e.g. Personal → `/libraries/personal`). Multiple libraries per deployment.
- `library_shares(id, library_id, user_id, role, created_at)` — grants a user access to a library. `role` ∈ {`viewer`, `editor`} where `editor` may move/rename files. Owner implicitly has full access. (Course-level sharing can be added later; start at library granularity.)
- `courses(id, library_id, rel_path, name, created_at)` — a course is a directory within a library. Derive/refresh from scanning; `rel_path` is relative to the library root.
- `progress(id, user_id, course_id, lesson_path, completed, position_seconds, updated_at)` — unique on `(user_id, course_id, lesson_path)`. `lesson_path` is relative to the course; **must be updated when files are moved/renamed** (see §6).
- `sessions(id, user_id, expires_at, created_at)` — opaque random session IDs for the cookie-based login. SQLite is the source of truth; the app keeps a write-through in-memory cache of active sessions for cheap per-request auth checks (see §4.4). Sweep expired rows.

Access rule: a user can see/act on a library if they own it or have a `library_shares` row; `editor`/owner required for file operations.

### 4.3 API sketch
Auth
- `POST /api/auth/login` — `{ username, password }` → sets session cookie
- `POST /api/auth/logout`
- `GET  /api/me` — current user

Libraries & sharing (owner/admin)
- `GET  /api/libraries` — libraries the current user owns or can access
- `POST /api/libraries` — `{ name, rootPath }` (rootPath restricted to allowed/mounted roots — see §7)
- `PATCH/DELETE /api/libraries/:id`
- `GET  /api/libraries/:id/shares` / `POST` `{ userId, role }` / `DELETE /api/libraries/:id/shares/:userId`

Browsing & playback (access-checked)
- `GET  /api/libraries/:id/courses` — browse courses in a library
- `POST /api/libraries/:id/rescan` — re-scan the library/courses
- `GET  /api/courses/:id/tree` — scanned tree with the current user's progress merged in
- `GET  /api/files/*` — stream a file **with range support**
- `POST /api/progress` — `{ courseId, lessonPath, completed?, positionSeconds? }`

File management (editor/owner; access-checked, path-traversal-safe)
- `POST /api/courses/:id/move` — `{ from, to }` (rename or move within the library root)
- (v1: no upload, no delete — see non-goals)

### 4.4 Auth (decided: simple app-managed login)
Chosen approach: **the app owns login** — username + password with hashed passwords (bcrypt/argon2) and a signed session cookie. Keep it minimal: a small user table, a login page, session middleware, and an admin-seeded first user. This makes the app self-contained and independent of the SSO perimeter, which matters now that users have distinct owned/shared content and can move files.

Notes / guardrails:
- App login is the source of truth for identity and permissions, and works **standalone** — no proxy or SSO required.
- **Sessions (decided): SQLite-backed with a write-through in-memory cache.** Use an opaque, `httpOnly` / `secure` / `sameSite=lax` session-ID cookie backed by a `sessions` table (chosen over stateless JWT so access can be revoked *immediately* when a share/role/user changes). Keep active sessions in an in-memory map so the per-request auth check is a lookup, not a DB read: load non-expired sessions on startup, add on login, and on logout/invalidation delete from **both** the cache and the DB. SQLite remains the source of truth (survives restarts); the cache is just an accelerator. Expire by TTL and periodically sweep expired rows. (Single container only — if the app is ever scaled to multiple instances, drop the in-process cache or add cross-instance invalidation.)
- **Cache only the session → identity mapping, never permissions.** The in-memory cache (and the `sessions` row) should map a session ID to `user_id` + `expires_at` only. **Do not** cache shares/roles/`is_admin` in the session — resolve those fresh from the DB on each request (they're cheap SQLite lookups). This preserves *instant revocation*: when an owner removes a share, changes a role, or disables a user, the very next request reflects it, even though the session itself is still valid. Baking permissions into the session (or a token) would reintroduce exactly the staleness problem that made us pick DB sessions over JWT.
- **Optional SSO compatibility:** if deployed behind a trusted proxy that injects a `Remote-User` header (e.g. Authelia/oauth2-proxy), optionally auto-provision/log in a matching app user to avoid a double login. Make this **opt-in** (e.g. a `TRUST_PROXY_HEADERS` / `SSO_USER_HEADER` setting) and only honor the header from a trusted source — never when the app is directly reachable. Some proxies strip underscore headers, so use the dash form (`Remote-User`).
- Seed the initial admin user via env vars or a one-time setup screen; don't hardcode credentials.

---

## 5. Deployment

Courseo is **standalone-first** and **reverse-proxy/SSO-compatible, but not dependent on them**. A user should be able to `docker run` it and have a working, self-contained app; running it behind Traefik/Cloudflare/Authelia is an *optional* enhancement, not a requirement.

### 5.1 Standalone (default)
- Ships as a **single Docker image** that serves the API and the built web UI on **one HTTP port**.
- Configured via env vars (port, session secret, DB path, allowed library root(s), admin seed).
- Volumes: a data dir for the SQLite DB/state, and one or more library roots mounted **read-write** (write access is needed for in-UI move/rename — scope the mount tightly).
- TLS is optional and typically terminated by whatever proxy (if any) sits in front; the app itself speaks plain HTTP and only trusts `X-Forwarded-*` when explicitly configured to.
- Ship a `docker run` example and a minimal `docker-compose.yml` in the README as the primary install path.
- Healthcheck: use a check the image actually supports (see §6) — e.g. a Node one-liner or `wget`, **not** `curl` unless it's installed.

### 5.2 Optional: behind a reverse proxy + SSO
Courseo should also run cleanly behind common proxies (Traefik, Caddy, nginx) with optional SSO (Authelia/oauth2-proxy). Design for the §6 compatibility gotchas — encoded slashes, `X-Frame-Options`, `nosniff`, HTTP range requests, underscore headers — so it "just works" when proxied. SSO header auto-login is opt-in (see §4.4). Document a sample reverse-proxy config (labels/vhost) in the README, but keep it out of the app's required config.

### 5.3 Reference: my homelab (one specific target, not a requirement)
For my own deployment via an Ansible `docker` role — captured here as *one* concrete example, none of which should be baked into the app:
- Traefik **v3.7.10** (Docker provider via socket-proxy, dynamic config via file provider); services discovered by labels.
- External `t3_proxy` network — Traefik routes by container name, **no published ports**.
- Wildcard TLS via **Cloudflare** DNS challenge; hostnames like `courseo.<domain>` (site also fronted by Cloudflare).
- Authelia SSO via a `chain-authelia@file` middleware chain (also rate-limiting + security headers: `nosniff`, HSTS, `X-Frame-Options: SAMEORIGIN`, etc.).
- App state under `$DOCKERDIR/appdata/courseo`; library content bind-mounted **read-write**.
- Added as a per-app `compose/courseo.yml.j2` template registered in `defaults/main.yml` (`all_containers`) + the host's `containers`, with a `setup.yml` task to create appdata dirs.

---

## 6. Hard-won gotchas from deploying the current app (carry these forward)

These caused real, time-consuming bugs. Some are **universal** (correct Content-Types, HTTP range support, path-traversal safety, JS/HTML escaping, progress-key updates); others are **reverse-proxy-specific** (encoded slashes, `X-Frame-Options`, `nosniff`, underscore headers) and only bite when Courseo runs behind a proxy. Since that's a supported deployment (§5.2), design for them anyway so the app is proxy-compatible out of the box.

1. **Traefik skips `unhealthy` containers.** A broken Docker `healthcheck` (the upstream used `curl`, which wasn't in the image) made the container `unhealthy`, and Traefik v3 refused to register a router for it — looked like a routing problem but wasn't. **Lesson:** only use a healthcheck the image can actually run.

2. **URL-encoded slashes (`%2F`) in paths.** Course subfolders produce file URLs like `/files/Section%201%2Flesson.pdf` (an encoded `/` inside one path segment). Traefik v3.6.4–3.6.6 rejected these with `400` before routing; v3.6.7+ allows them by default. We explicitly set `entrypoints.*.http.encodedCharacters.allowEncodedSlash=true`. **Lesson:** if the frontend encodes path separators as `%2F` (e.g. `encodeURIComponent(fullPath)`), the proxy must allow encoded slashes — or avoid `%2F` by passing path segments differently (e.g. real `/`, or a query param, or base64url the path).

3. **`X-Frame-Options` + in-page embeds.** The proxy sent `X-Frame-Options: allow-from …`, which is deprecated/ignored by modern browsers and effectively blocked same-origin iframes. In-page HTML/PDF viewers rely on iframes. We changed it to `SAMEORIGIN`. **Lesson:** if you embed content in an iframe from your own origin, ensure `X-Frame-Options: SAMEORIGIN` (or use CSP `frame-ancestors 'self'`).

4. **`nosniff` + correct Content-Type.** With `X-Content-Type-Options: nosniff`, the browser strictly obeys the declared `Content-Type`. Serve files with the **correct** type (e.g. `application/pdf`) or the browser won't rescue a mislabeled response. Node's `send`/`res.sendFile` set types from extension; verify PDFs/mp4s get correct types.

5. **PDFs must not be fetched-as-text.** The original in-page viewer did `fetch(url).then(r => r.text())` for everything non-HTML, dumping raw PDF bytes into the DOM. Render PDFs via `<iframe>`/`<embed>`/`pdf.js`, not text.

6. **Range requests matter.** Video scrubbing and PDF viewers issue `Range` requests; the file endpoint must return `206 Partial Content`. Express `res.sendFile`/`send` handles this; don't hand-roll a naive `readFile`.

7. **Underscore headers are stripped.** The proxy is configured with `underscoreHeadersStrategy=delete`. If reading identity from proxy headers, use the dash form (`Remote-User`), not `Remote_User`.

8. **Content mounts must be writable for file management.** The current app mounts courses read-only. Move/rename requires the library roots to be mounted **read-write**. Scope the mounts tightly (only the library roots) and consider per-library `editor` permissions before allowing writes.

9. **Path-traversal safety is mandatory for file ops (and file serving).** Every path from the client (`from`/`to` in move, `/api/files/*`) must be resolved and confirmed to stay **inside the owning library root** (resolve real path, reject `..`, symlink escapes, and absolute paths). This is the highest-risk surface in the app now that it writes to disk.

10. **Moving/renaming files invalidates progress keys.** `progress.lesson_path` is relative to the course; a move/rename changes it. On any file op, update the affected `progress` rows (and `courses.rel_path` if a course dir moves) in the same transaction, or progress silently detaches from the content.

11. **Concurrent scan vs. file ops.** A rescan can race with a move/rename. Serialize writes per library (or lock during file ops) so the scanned tree and DB stay consistent.

12. **JS/HTML injection when echoing filenames (from this project's own bug).** When rendering filenames into the UI or building URLs, don't hand-splice them into HTML/JS strings. In React this is largely handled, but building `/files/...` URLs still needs `encodeURIComponent` per path segment, and any server-rendered surface must escape for the correct context. (The Flask app broke on a filename containing `&` because it was HTML-escaped into a `<script>` literal.)

---

## 7. Open decisions for the build session
- **How library roots are provided:** a single parent mount (e.g. `/libraries/*`) that users point at via subfolder, vs. one bind mount per library configured in compose. Determines whether "add library from UI" means "pick an existing subfolder" (safer) vs. "type an arbitrary path" (needs strict allow-listing). Recommend: one parent mount + pick-a-subfolder.
- **Permission granularity:** library-level sharing only (recommended for v1) vs. also per-course sharing.
- **Roles:** is `viewer`/`editor` enough, or is a separate `admin` (manage users/libraries) needed too? (Spec assumes `is_admin` + per-library `viewer`/`editor`.)
- **File ops scope:** move/rename only (recommended) vs. also create-folder/delete; whether to add an undo/trash.
- SQLite vs JSON for progress (recommend SQLite — now required for multi-user + permissions).
- **Password/user seeding:** env-var-seeded admin vs. first-run setup screen.
- Quiz files: render interactively, or just link/mark-complete like today?
- Whether to wire the optional Authelia `Remote-User` auto-login convenience, or require app login always.

---

## 8. Current deployment reference (what exists today)
- Image: `ghcr.io/skippysteve/offlineu:main` (dormant fork, pinned via a bind-mounted patched `lesson_view.html`).
- Container `offlineu` on `t3_proxy`, port 5000, host `offlineu.<domain>`, `chain-authelia@file`.
- Courses: `/mnt/media/Courses/Personal` → `/app/courses` (ro-ish); state in `appdata/offlineu/data`.
- Local patch: `roles/docker/files/offlineu/lesson_view.html` (iframes PDFs) mounted over `/app/templates/lesson_view.html`.

Once **Courseo** is live, remove the `offlineu` container, the bind-mounted template patch, and the related Ansible entries.
